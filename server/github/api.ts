import { createPrivateKey, sign } from 'node:crypto'
import type { GithubRef } from '../../shared/github'
import type { GithubKind, GithubState } from '../db/github'

/**
 * Habla con la API de GitHub (ADR 0006): una consulta GraphQL por lote de links y el token de instalación de la App.
 * No toca la base: el caché y la decisión de qué token usar viven en `services/github.ts`.
 */

/** Hasta cuántos links van en una consulta GraphQL (y cuántos alias se arman). */
export const BATCH_SIZE = 25

export type Rate = { remaining: number; resetAt: number }

/** Lo que GitHub dijo de un issue o PR; `null` si no existe o el token no lo ve. */
export type FoundLink = {
  kind: GithubKind
  title: string
  state: GithubState
} | null

/** Un repo del lote: `found: false` = no existe o el token no lo ve (no se distingue). */
export type RepoResult = {
  owner: string
  repo: string
  found: boolean
  isPrivate: boolean
  links: Map<number, FoundLink>
}

export type QueryResult = { repos: RepoResult[]; rate: Rate | null }

export type FailureKind = 'unauthorized' | 'rate_limited' | 'unavailable'

/** Fallo de la API; `kind` decide qué hace el servicio (renovar el token, esperar, reintentar más tarde). */
export class GithubApiError extends Error {
  readonly kind: FailureKind
  /** Epoch ms en que se puede volver a intentar, si GitHub lo dijo. */
  readonly retryAt: number | null
  constructor(
    kind: FailureKind,
    message: string,
    retryAt: number | null = null,
  ) {
    super(message)
    this.name = 'GithubApiError'
    this.kind = kind
    this.retryAt = retryAt
  }
}

export type GithubApi = {
  /** Token de instalación de la App, o `null` si la App no está configurada o no se pudo obtener. */
  installationToken(): Promise<string | null>
  /** Consulta el lote con ese token. Los refs ya vienen normalizados y son a lo sumo `BATCH_SIZE`. */
  query(token: string, refs: GithubRef[]): Promise<QueryResult>
}

const ENDPOINT = 'https://api.github.com'

const ITEM_FIELDS = `__typename
  ... on Issue { title state stateReason }
  ... on PullRequest { title state isDraft merged }`

/**
 * Arma la consulta: un alias `r<i>` por repo y un alias `i<j>` por número, todo con variables (nada del usuario se
 * interpola en el texto de la consulta). Devuelve también la lista de repos en el orden de los alias.
 */
export function buildQuery(refs: GithubRef[]): {
  query: string
  variables: Record<string, string | number>
  repos: { owner: string; repo: string; numbers: number[] }[]
} {
  const byRepo = new Map<
    string,
    { owner: string; repo: string; numbers: number[] }
  >()
  for (const ref of refs) {
    const key = `${ref.owner}/${ref.repo}`
    const entry = byRepo.get(key) ?? {
      owner: ref.owner,
      repo: ref.repo,
      numbers: [],
    }
    if (!entry.numbers.includes(ref.number)) entry.numbers.push(ref.number)
    byRepo.set(key, entry)
  }
  const repos = [...byRepo.values()]
  const declarations: string[] = []
  const body: string[] = []
  const variables: Record<string, string | number> = {}
  repos.forEach((r, i) => {
    declarations.push(`$o${i}: String!`, `$n${i}: String!`)
    variables[`o${i}`] = r.owner
    variables[`n${i}`] = r.repo
    const items = r.numbers.map((number, j) => {
      declarations.push(`$k${i}_${j}: Int!`)
      variables[`k${i}_${j}`] = number
      return `i${j}: issueOrPullRequest(number: $k${i}_${j}) { ${ITEM_FIELDS} }`
    })
    body.push(
      `r${i}: repository(owner: $o${i}, name: $n${i}) { isPrivate ${items.join(' ')} }`,
    )
  })
  return {
    query: `query(${declarations.join(', ')}) { ${body.join(' ')} rateLimit { remaining resetAt } }`,
    variables,
    repos,
  }
}

type RawItem =
  | {
      __typename: 'Issue'
      title: string
      state: 'OPEN' | 'CLOSED'
      stateReason?: string | null
    }
  | {
      __typename: 'PullRequest'
      title: string
      state: 'OPEN' | 'CLOSED' | 'MERGED'
      isDraft?: boolean
      merged?: boolean
    }
  | null

type RawResponse = {
  data?: Record<string, unknown> | null
  errors?: { type?: string; message?: string }[]
}

function toLink(raw: RawItem): FoundLink {
  if (!raw || typeof raw.title !== 'string') return null
  if (raw.__typename === 'Issue')
    return {
      kind: 'issue',
      title: raw.title,
      state:
        raw.state === 'OPEN'
          ? 'open'
          : raw.stateReason === 'NOT_PLANNED'
            ? 'not_planned'
            : 'closed',
    }
  if (raw.__typename === 'PullRequest')
    return {
      kind: 'pull',
      title: raw.title,
      state:
        raw.state === 'MERGED' || raw.merged
          ? 'merged'
          : raw.state === 'CLOSED'
            ? 'closed'
            : raw.isDraft
              ? 'draft'
              : 'open',
    }
  return null
}

/** Lee la respuesta de GraphQL contra el lote que se pidió. Lanza si GitHub no devolvió datos. */
export function parseResponse(
  body: RawResponse,
  repos: { owner: string; repo: string; numbers: number[] }[],
): QueryResult {
  const data = body.data
  if (!data) {
    const limited = body.errors?.some((e) => e.type === 'RATE_LIMITED')
    throw new GithubApiError(
      limited ? 'rate_limited' : 'unavailable',
      body.errors?.[0]?.message ?? 'GitHub no devolvió datos',
    )
  }
  const results = repos.map((r, i): RepoResult => {
    const raw = data[`r${i}`] as
      | ({ isPrivate: boolean } & Record<string, RawItem>)
      | null
      | undefined
    const links = new Map<number, FoundLink>()
    if (!raw) {
      for (const n of r.numbers) links.set(n, null)
      return {
        owner: r.owner,
        repo: r.repo,
        found: false,
        isPrivate: false,
        links,
      }
    }
    r.numbers.forEach((n, j) => links.set(n, toLink(raw[`i${j}`] ?? null)))
    return {
      owner: r.owner,
      repo: r.repo,
      found: true,
      isPrivate: raw.isPrivate === true,
      links,
    }
  })
  const rl = data.rateLimit as
    | { remaining?: number; resetAt?: string }
    | undefined
  const resetAt = rl?.resetAt ? Date.parse(rl.resetAt) : NaN
  return {
    repos: results,
    rate:
      typeof rl?.remaining === 'number' && Number.isFinite(resetAt)
        ? { remaining: rl.remaining, resetAt }
        : null,
  }
}

const b64url = (value: string | Buffer) =>
  Buffer.from(value).toString('base64url')

/** JWT de la App (RS256, 9 minutos): con él se pide el token de instalación. */
export function appJwt(
  app: { appId: string; privateKey: string },
  nowMs: number,
): string {
  const iat = Math.floor(nowMs / 1000) - 60 // GitHub tolera poco desfase de reloj
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(
    JSON.stringify({ iat, exp: iat + 9 * 60 + 60, iss: app.appId }),
  )
  const signature = sign(
    'RSA-SHA256',
    Buffer.from(`${head}.${claims}`),
    createPrivateKey(app.privateKey),
  )
  return `${head}.${claims}.${b64url(signature)}`
}

const headers = (authorization: string) => ({
  accept: 'application/vnd.github+json',
  authorization,
  'user-agent': 'mychecklist',
  'x-github-api-version': '2022-11-28',
})

export function createGithubApi(
  app: { appId: string; privateKey: string } | null,
  fetchFn: typeof fetch = fetch,
  now: () => number = Date.now,
): GithubApi {
  let installation: { token: string; expiresAt: number } | null = null
  let inflight: Promise<string | null> | null = null
  let retryAfter = 0

  async function mintInstallationToken(
    config: NonNullable<typeof app>,
  ): Promise<string | null> {
    try {
      const auth = `Bearer ${appJwt(config, now())}`
      const list = await fetchFn(`${ENDPOINT}/app/installations?per_page=1`, {
        headers: headers(auth),
      })
      if (!list.ok) throw new Error(`installations ${list.status}`)
      const first = ((await list.json()) as { id: number }[])[0]
      if (!first) throw new Error('la App no está instalada en ninguna cuenta')
      const res = await fetchFn(
        `${ENDPOINT}/app/installations/${first.id}/access_tokens`,
        {
          method: 'POST',
          headers: { ...headers(auth), 'content-type': 'application/json' },
          // Lo mínimo que hace falta para leer issues y PRs.
          body: JSON.stringify({
            permissions: { issues: 'read', pull_requests: 'read' },
          }),
        },
      )
      if (!res.ok) throw new Error(`access_tokens ${res.status}`)
      const body = (await res.json()) as { token: string; expires_at: string }
      installation = {
        token: body.token,
        expiresAt: Date.parse(body.expires_at),
      }
      return body.token
    } catch (error) {
      // Sin token de instalación el servicio sigue por el camino de quien mira; se reintenta en un minuto.
      console.error(
        'github app token failed:',
        error instanceof Error ? error.message : error,
      )
      retryAfter = now() + 60_000
      return null
    }
  }

  return {
    async installationToken() {
      if (!app) return null
      if (installation && installation.expiresAt - now() > 2 * 60_000)
        return installation.token
      if (now() < retryAfter) return null
      inflight ??= mintInstallationToken(app).finally(() => {
        inflight = null
      })
      return inflight
    },

    async query(token, refs) {
      const { query, variables, repos } = buildQuery(refs)
      let res: Response
      try {
        res = await fetchFn(`${ENDPOINT}/graphql`, {
          method: 'POST',
          headers: {
            ...headers(`Bearer ${token}`),
            'content-type': 'application/json',
          },
          body: JSON.stringify({ query, variables }),
        })
      } catch (error) {
        throw new GithubApiError(
          'unavailable',
          error instanceof Error ? error.message : 'sin conexión',
        )
      }
      if (res.status === 401)
        throw new GithubApiError('unauthorized', 'Token rechazado por GitHub')
      if (res.status === 403 || res.status === 429) {
        const reset = Number(res.headers.get('x-ratelimit-reset'))
        throw new GithubApiError(
          'rate_limited',
          `GitHub respondió ${res.status}`,
          Number.isFinite(reset) && reset > 0 ? reset * 1000 : null,
        )
      }
      if (!res.ok)
        throw new GithubApiError(
          'unavailable',
          `GitHub respondió ${res.status}`,
        )
      return parseResponse((await res.json()) as RawResponse, repos)
    },
  }
}
