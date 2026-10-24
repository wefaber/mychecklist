import { describe, expect, test } from 'bun:test'
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto'
import type { GithubRef } from '../../shared/github'
import {
  appJwt,
  buildQuery,
  createGithubApi,
  GithubApiError,
  parseResponse,
} from './api'
import batchMixed from './fixtures/batch-mixed.json'
import rateLimited from './fixtures/rate-limited.json'

const ref = (owner: string, repo: string, number: number): GithubRef => ({
  owner,
  repo,
  number,
})

/** El lote que corresponde a `batch-mixed.json`: cuatro repos, en el orden de los alias. */
const MIXED: GithubRef[] = [
  ref('oven-sh', 'bun', 1),
  ref('oven-sh', 'bun', 2),
  ref('oven-sh', 'bun', 3),
  ref('oven-sh', 'bun', 4),
  ref('wefaber', 'secreto', 10),
  ref('wefaber', 'secreto', 11),
  ref('wefaber', 'secreto', 12),
  ref('nadie', 'nada', 1),
  ref('wefaber', 'mychecklist', 99),
]

const asFetch = (fn: (url: string, init?: RequestInit) => Promise<Response>) =>
  fn as unknown as typeof fetch

describe('buildQuery', () => {
  test('un alias por repo, uno por número, y todo por variables', () => {
    const { query, variables, repos } = buildQuery(MIXED)
    expect(
      repos.map((r) => `${r.owner}/${r.repo}:${r.numbers.join(',')}`),
    ).toEqual([
      'oven-sh/bun:1,2,3,4',
      'wefaber/secreto:10,11,12',
      'nadie/nada:1',
      'wefaber/mychecklist:99',
    ])
    expect(variables).toMatchObject({
      o0: 'oven-sh',
      n0: 'bun',
      k0_3: 4,
      o1: 'wefaber',
      n1: 'secreto',
      k1_2: 12,
    })
    expect(query).toContain('r0: repository(owner: $o0, name: $n0)')
    expect(query).toContain('i3: issueOrPullRequest(number: $k0_3)')
    expect(query).toContain('rateLimit { remaining resetAt }')
    // Nada que venga de la persona se interpola en el texto de la consulta.
    expect(query).not.toContain('oven-sh')
    expect(query).not.toContain('secreto')
  })

  test('un número repetido en el mismo repo se pide una vez', () => {
    const { repos } = buildQuery([ref('a', 'b', 1), ref('a', 'b', 1)])
    expect(repos[0]!.numbers).toEqual([1])
  })
})

describe('parseResponse (fixture de GitHub)', () => {
  const { repos } = buildQuery(MIXED)
  const result = parseResponse(batchMixed, repos)

  test('issues: abierto, cerrado como no planeado y cerrado', () => {
    const bun = result.repos[0]!
    expect(bun).toMatchObject({ found: true, isPrivate: false })
    expect(bun.links.get(1)).toEqual({
      kind: 'issue',
      title: 'Abrir el detalle con Enter',
      state: 'open',
    })
    expect(bun.links.get(2)?.state).toBe('not_planned')
    expect(bun.links.get(4)?.state).toBe('closed')
  })

  test('PRs: mergeado, borrador, abierto y cerrado', () => {
    expect(result.repos[0]!.links.get(3)).toEqual({
      kind: 'pull',
      title: 'feat(m3): Markdown y backlinks',
      state: 'merged',
    })
    const secret = result.repos[1]!
    expect(secret.isPrivate).toBe(true)
    expect(secret.links.get(10)?.state).toBe('draft')
    expect(secret.links.get(11)?.state).toBe('open')
    expect(secret.links.get(12)?.state).toBe('closed')
  })

  test('un repo que no se ve viene como no encontrado, con sus números en null', () => {
    expect(result.repos[2]).toMatchObject({ found: false, isPrivate: false })
    expect(result.repos[2]!.links.get(1)).toBeNull()
  })

  test('un número que no existe en un repo que sí', () => {
    expect(result.repos[3]).toMatchObject({ found: true })
    expect(result.repos[3]!.links.get(99)).toBeNull()
  })

  test('el límite de la API viaja con la respuesta', () => {
    expect(result.rate).toEqual({
      remaining: 4987,
      resetAt: Date.parse('2026-10-23T18:00:00Z'),
    })
  })

  test('sin datos es un fallo: de límite o de disponibilidad', () => {
    const kind = (body: Parameters<typeof parseResponse>[0]) => {
      try {
        parseResponse(body, repos)
      } catch (e) {
        expect(e).toBeInstanceOf(GithubApiError)
        return (e as GithubApiError).kind
      }
      return null
    }
    expect(kind(rateLimited)).toBe('rate_limited')
    expect(kind({ data: null, errors: [{ message: 'boom' }] })).toBe(
      'unavailable',
    )
  })
})

describe('createGithubApi().query', () => {
  const setup = (respond: () => Response | Promise<Response>) => {
    const seen: { url: string; init?: RequestInit }[] = []
    const api = createGithubApi(
      null,
      asFetch(async (url, init) => {
        seen.push({ url, init })
        return respond()
      }),
    )
    return { api, seen }
  }
  const failure = async (api: ReturnType<typeof createGithubApi>) => {
    try {
      await api.query('tok', MIXED)
    } catch (e) {
      return e as GithubApiError
    }
    throw new Error('no falló')
  }

  test('manda una sola consulta POST con el token y las variables', async () => {
    const { api, seen } = setup(() => Response.json(batchMixed))
    const result = await api.query('tok', MIXED)
    expect(result.repos).toHaveLength(4)
    expect(seen).toHaveLength(1)
    expect(seen[0]!.url).toBe('https://api.github.com/graphql')
    const init = seen[0]!.init!
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe(
      'Bearer tok',
    )
    const body = JSON.parse(init.body as string)
    expect(body.variables.o0).toBe('oven-sh')
    expect(typeof body.query).toBe('string')
  })

  test('401: token rechazado', async () => {
    const { api } = setup(() => new Response('{}', { status: 401 }))
    expect((await failure(api)).kind).toBe('unauthorized')
  })

  test('403 y 429: límite, con la hora de reinicio si GitHub la da', async () => {
    const { api } = setup(
      () =>
        new Response('{}', {
          status: 403,
          headers: { 'x-ratelimit-reset': '1800000000' },
        }),
    )
    const e = await failure(api)
    expect(e.kind).toBe('rate_limited')
    expect(e.retryAt).toBe(1_800_000_000_000)
    const { api: other } = setup(() => new Response('{}', { status: 429 }))
    expect((await failure(other)).retryAt).toBeNull()
  })

  test('5xx y red caída: no disponible', async () => {
    const { api } = setup(() => new Response('{}', { status: 502 }))
    expect((await failure(api)).kind).toBe('unavailable')
    const down = createGithubApi(
      null,
      asFetch(async () => {
        throw new Error('ECONNREFUSED')
      }),
    )
    expect((await failure(down)).kind).toBe('unavailable')
  })
})

describe('token de instalación', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    // GitHub entrega la clave en PKCS#1 (`BEGIN RSA PRIVATE KEY`).
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  const app = { appId: '12345', privateKey }

  test('el JWT es RS256 con la clave de la App y dura menos de 10 minutos', () => {
    const jwt = appJwt(app, 1_800_000_000_000)
    const [head, claims, sig] = jwt.split('.') as [string, string, string]
    expect(JSON.parse(Buffer.from(head, 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    })
    const body = JSON.parse(Buffer.from(claims, 'base64url').toString())
    expect(body.iss).toBe('12345')
    expect(body.exp - body.iat).toBeLessThanOrEqual(600)
    expect(
      verify(
        'RSA-SHA256',
        Buffer.from(`${head}.${claims}`),
        createPublicKey(publicKey),
        Buffer.from(sig, 'base64url'),
      ),
    ).toBe(true)
  })

  function server(clock: { t: number }) {
    const urls: string[] = []
    const bodies: unknown[] = []
    const fetchFn = asFetch(async (url, init) => {
      urls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.includes('/app/installations?'))
        return Response.json([{ id: 777 }])
      bodies.push(JSON.parse(String(init?.body)))
      return Response.json({
        token: `ghs_${urls.length}`,
        expires_at: new Date(clock.t + 3_600_000).toISOString(),
      })
    })
    return { urls, bodies, fetchFn }
  }

  test('lo pide una vez, lo guarda y lo renueva cerca del vencimiento', async () => {
    const clock = { t: 1_800_000_000_000 }
    const { urls, bodies, fetchFn } = server(clock)
    const api = createGithubApi(app, fetchFn, () => clock.t)
    expect(await api.installationToken()).toBe('ghs_2')
    expect(urls).toEqual([
      'GET https://api.github.com/app/installations?per_page=1',
      'POST https://api.github.com/app/installations/777/access_tokens',
    ])
    expect(bodies[0]).toEqual({
      permissions: { issues: 'read', pull_requests: 'read' },
    })
    expect(await api.installationToken()).toBe('ghs_2')
    expect(urls).toHaveLength(2)
    clock.t += 3_600_000 - 60_000 // queda menos del margen
    expect(await api.installationToken()).toBe('ghs_4')
  })

  test('pedidos a la vez comparten un solo canje', async () => {
    const clock = { t: 1_800_000_000_000 }
    const { urls, fetchFn } = server(clock)
    const api = createGithubApi(app, fetchFn, () => clock.t)
    const tokens = await Promise.all([
      api.installationToken(),
      api.installationToken(),
      api.installationToken(),
    ])
    expect(new Set(tokens).size).toBe(1)
    expect(urls).toHaveLength(2)
  })

  test('sin App configurada no hay token', async () => {
    expect(await createGithubApi(null).installationToken()).toBeNull()
  })

  test('si falla, devuelve null y espera un minuto antes de reintentar', async () => {
    const clock = { t: 1_800_000_000_000 }
    let calls = 0
    const api = createGithubApi(
      app,
      asFetch(async () => {
        calls++
        return new Response('{}', { status: 500 })
      }),
      () => clock.t,
    )
    const quiet = console.error
    console.error = () => {}
    try {
      expect(await api.installationToken()).toBeNull()
      expect(await api.installationToken()).toBeNull()
      expect(calls).toBe(1)
      clock.t += 61_000
      expect(await api.installationToken()).toBeNull()
      expect(calls).toBe(2)
    } finally {
      console.error = quiet
    }
  })
})
