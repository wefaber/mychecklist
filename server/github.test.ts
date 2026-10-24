import { describe, expect, test } from 'bun:test'
import type { Database } from 'bun:sqlite'
import { githubKey, type GithubRef } from '../shared/github'
import { sessionCookieName } from './auth/cookies'
import { open } from './auth/crypto'
import { loadGithubTokens } from './db/accounts'
import type { GithubKind, GithubState } from './db/github'
import {
  BATCH_SIZE,
  GithubApiError,
  type FoundLink,
  type GithubApi,
  type QueryResult,
  type Rate,
} from './github/api'
import { createGithubLinks, LOW_WATER, TTL } from './services/github'
import { signIn } from './services/accounts'
import {
  alice,
  bob,
  config,
  fakeGithub,
  setupServer,
  TOKEN_KEY,
} from './testing'

type Repo = {
  isPrivate: boolean
  /** Tokens que ven el repo si es privado. */
  seenBy: string[]
  links: Record<number, NonNullable<FoundLink>>
}

const link = (
  kind: GithubKind,
  title: string,
  state: GithubState,
): NonNullable<FoundLink> => ({ kind, title, state })

/** GitHub de mentira: un mundo de repos y quién ve qué. Registra cada consulta. */
function fakeApi(world: Record<string, Repo>, opts: { app?: boolean } = {}) {
  const calls: { token: string; refs: string[] }[] = []
  const state: {
    rate: Rate | null
    reject: Set<string>
    failWith: GithubApiError | null
  } = { rate: null, reject: new Set(), failWith: null }
  const api: GithubApi = {
    installationToken: async () => (opts.app === false ? null : 'app-token'),
    query: async (token, refs): Promise<QueryResult> => {
      calls.push({ token, refs: refs.map(githubKey) })
      if (state.failWith) throw state.failWith
      if (state.reject.has(token))
        throw new GithubApiError('unauthorized', 'rechazado')
      const byRepo = new Map<string, GithubRef[]>()
      for (const r of refs) {
        const k = `${r.owner}/${r.repo}`
        byRepo.set(k, [...(byRepo.get(k) ?? []), r])
      }
      const repos = [...byRepo].map(([k, list]) => {
        const [owner, repo] = k.split('/') as [string, string]
        const w = world[k]
        const visible = !!w && (!w.isPrivate || w.seenBy.includes(token))
        const links = new Map<number, FoundLink>(
          list.map((r) => [
            r.number,
            visible ? (w!.links[r.number] ?? null) : null,
          ]),
        )
        return {
          owner,
          repo,
          found: visible,
          isPrivate: visible && w!.isPrivate,
          links,
        }
      })
      return { repos, rate: state.rate }
    },
  }
  return { api, calls, state }
}

const PUBLIC = 'oven-sh/bun'
const SECRET = 'wefaber/secreto'
const baseWorld = (): Record<string, Repo> => ({
  [PUBLIC]: {
    isPrivate: false,
    seenBy: [],
    links: {
      1: link('issue', 'Abrir el detalle', 'open'),
      2: link('pull', 'Mergeado', 'merged'),
    },
  },
  [SECRET]: {
    isPrivate: true,
    seenBy: ['alice-token'],
    links: { 5: link('pull', 'Titulo secreto', 'draft') },
  },
})

const r = (full: string, number: number): GithubRef => {
  const [owner, repo] = full.split('/') as [string, string]
  return { owner, repo, number }
}

async function setup(
  world = baseWorld(),
  opts: {
    app?: boolean
    accessAlice?: string
    refreshAlice?: string | null
  } = {},
) {
  const ctx = setupServer(fakeGithub(alice))
  const clock = { t: 1_800_000_000_000 }
  const fake = fakeApi(world, opts)
  const login = fakeGithub(alice)
  const links = createGithubLinks({
    db: ctx.db,
    api: fake.api,
    login,
    tokenKey: TOKEN_KEY,
    now: () => clock.t,
  })
  const user = async (
    profile: typeof alice,
    access: string,
    refresh: string | null = null,
  ) => {
    const { user } = await signIn(ctx.db, {
      profile,
      tokens: {
        accessToken: access,
        refreshToken: refresh,
        expiresAt: null,
        refreshExpiresAt: null,
      },
      ingress: 'public',
      tokenKey: TOKEN_KEY,
    })
    return { userId: user.id, ingress: 'public' as const }
  }
  const a = await user(
    alice,
    opts.accessAlice ?? 'alice-token',
    opts.refreshAlice ?? null,
  )
  const b = await user(bob, 'bob-token')
  return { ...ctx, clock, ...fake, links, a, b, user }
}

const count = (db: Database, table: string) =>
  db.query<{ n: number }, []>(`SELECT count(*) AS n FROM ${table}`).get()!.n

describe('repos públicos: caché global con el token de la App', () => {
  test('se consulta con la App y lo ve cualquiera sin volver a GitHub', async () => {
    const s = await setup()
    const [first] = await s.links.resolve(s.a, [r(PUBLIC, 1)])
    expect(first).toMatchObject({
      status: 'ok',
      kind: 'issue',
      title: 'Abrir el detalle',
      state: 'open',
      stale: false,
    })
    expect(s.calls).toEqual([{ token: 'app-token', refs: ['oven-sh/bun#1'] }])
    expect(count(s.db, 'github_public_links')).toBe(1)
    expect(count(s.db, 'github_private_links')).toBe(0)

    const [second] = await s.links.resolve(s.b, [r(PUBLIC, 1)])
    expect(second?.title).toBe('Abrir el detalle')
    expect(s.calls).toHaveLength(1)
  })

  test('mayúsculas en dueño y repo dan el mismo link', async () => {
    const s = await setup()
    await s.links.resolve(s.a, [r(PUBLIC, 1)])
    const [again] = await s.links.resolve(s.b, [
      { owner: 'Oven-SH', repo: 'BUN', number: 1 },
    ])
    expect(again).toMatchObject({
      owner: 'oven-sh',
      repo: 'bun',
      title: 'Abrir el detalle',
    })
    expect(s.calls).toHaveLength(1)
  })

  test('un issue que no existe en un repo público queda como no encontrado para todos', async () => {
    const s = await setup()
    const [missing] = await s.links.resolve(s.a, [r(PUBLIC, 999)])
    expect(missing).toMatchObject({ status: 'not_found', title: null })
    await s.links.resolve(s.b, [r(PUBLIC, 999)])
    expect(s.calls).toHaveLength(1)
  })

  test('pide los dos links del mismo repo en una sola consulta', async () => {
    const s = await setup()
    const out = await s.links.resolve(s.a, [
      r(PUBLIC, 1),
      r(PUBLIC, 2),
      r(PUBLIC, 1),
    ])
    expect(out.map((l) => l.number)).toEqual([1, 2])
    expect(s.calls).toHaveLength(1)
    expect(s.calls[0]!.refs).toEqual(['oven-sh/bun#1', 'oven-sh/bun#2'])
  })
})

describe('repos privados: caché por usuario con el token de quien mira', () => {
  test('la App que sí lo ve no lo publica: va al caché del usuario con su token', async () => {
    const world = baseWorld()
    world[SECRET]!.seenBy.push('app-token') // la App está instalada en el repo privado
    const s = await setup(world)
    const [got] = await s.links.resolve(s.a, [r(SECRET, 5)])
    expect(got).toMatchObject({ status: 'ok', title: 'Titulo secreto' })
    // 1) la App, que lo ve y avisa que es privado; 2) el token de alice.
    expect(s.calls.map((c) => c.token)).toEqual(['app-token', 'alice-token'])
    expect(count(s.db, 'github_public_links')).toBe(0)
    expect(count(s.db, 'github_private_links')).toBe(1)
    expect(
      s.db
        .query<{ private: number }, []>('SELECT private FROM github_repos')
        .get()?.private,
    ).toBe(1)
  })

  test('otra persona no ve el título, ni de su propio caché ni del de alice', async () => {
    const s = await setup()
    await s.links.resolve(s.a, [r(SECRET, 5)])
    const [forBob] = await s.links.resolve(s.b, [r(SECRET, 5)])
    expect(forBob).toMatchObject({
      status: 'not_found',
      title: null,
      state: null,
    })
    // Y lo de alice sigue siendo de alice.
    const [again] = await s.links.resolve(s.a, [r(SECRET, 5)])
    expect(again?.title).toBe('Titulo secreto')
    const rows = s.db
      .query<{ user_id: string }, []>(
        'SELECT user_id FROM github_private_links',
      )
      .all()
    expect(rows.map((x) => x.user_id).sort()).toEqual(
      [s.a.userId, s.b.userId].sort(),
    )
  })

  test('repo conocido como privado: no vuelve a probar con la App', async () => {
    const s = await setup()
    await s.links.resolve(s.a, [r(SECRET, 5)])
    s.calls.length = 0
    s.clock.t += TTL.live + 1
    await s.links.resolve(s.a, [r(SECRET, 5)])
    expect(s.calls.map((c) => c.token)).toEqual(['alice-token'])
  })

  test('un repo que pasa a privado se borra del caché global', async () => {
    const world = baseWorld()
    const s = await setup(world)
    await s.links.resolve(s.b, [r(PUBLIC, 1)])
    expect(count(s.db, 'github_public_links')).toBe(1)
    world[PUBLIC]!.isPrivate = true
    world[PUBLIC]!.seenBy = ['alice-token', 'app-token']
    s.clock.t += TTL.live + 1
    const [forBob] = await s.links.resolve(s.b, [r(PUBLIC, 1)])
    expect(count(s.db, 'github_public_links')).toBe(0)
    expect(forBob?.title).toBeNull()
  })

  test('nada de un repo privado entra jamás a la tabla pública', async () => {
    const world = baseWorld()
    world[SECRET]!.seenBy.push('app-token', 'bob-token')
    const s = await setup(world)
    await s.links.resolve(s.a, [r(SECRET, 5), r(PUBLIC, 1)])
    await s.links.resolve(s.b, [r(SECRET, 5)])
    const titles = s.db
      .query<{ title: string }, []>('SELECT title FROM github_public_links')
      .all()
      .map((x) => x.title)
    expect(titles).toEqual(['Abrir el detalle'])
  })
})

describe('sin la App configurada', () => {
  test('se resuelve con el token de quien mira y lo público igual se comparte', async () => {
    const s = await setup(baseWorld(), { app: false })
    await s.links.resolve(s.a, [r(PUBLIC, 1)])
    expect(s.calls.map((c) => c.token)).toEqual(['alice-token'])
    expect(count(s.db, 'github_public_links')).toBe(1)
    await s.links.resolve(s.b, [r(PUBLIC, 1)])
    expect(s.calls).toHaveLength(1)
  })
})

describe('refresco', () => {
  test('un link abierto vence a los 5 minutos y se vuelve a consultar', async () => {
    const world = baseWorld()
    const s = await setup(world)
    await s.links.resolve(s.a, [r(PUBLIC, 1)])
    s.clock.t += TTL.live - 1
    await s.links.resolve(s.a, [r(PUBLIC, 1)])
    expect(s.calls).toHaveLength(1)

    world[PUBLIC]!.links[1] = link('issue', 'Abrir el detalle', 'closed')
    s.clock.t += 2
    const [updated] = await s.links.resolve(s.a, [r(PUBLIC, 1)])
    expect(s.calls).toHaveLength(2)
    expect(updated).toMatchObject({ state: 'closed', stale: false })
  })

  test('uno mergeado dura una hora', async () => {
    const s = await setup()
    await s.links.resolve(s.a, [r(PUBLIC, 2)])
    s.clock.t += TTL.live + 1
    await s.links.resolve(s.a, [r(PUBLIC, 2)])
    expect(s.calls).toHaveLength(1)
    s.clock.t += TTL.done
    await s.links.resolve(s.a, [r(PUBLIC, 2)])
    expect(s.calls).toHaveLength(2)
  })

  test('un no encontrado se reintenta a los 10 minutos', async () => {
    const world = baseWorld()
    const s = await setup(world)
    await s.links.resolve(s.a, [r(PUBLIC, 3)])
    world[PUBLIC]!.links[3] = link('issue', 'Recién creado', 'open')
    s.clock.t += TTL.missing - 1
    expect((await s.links.resolve(s.a, [r(PUBLIC, 3)]))[0]?.status).toBe(
      'not_found',
    )
    s.clock.t += 2
    expect((await s.links.resolve(s.a, [r(PUBLIC, 3)]))[0]).toMatchObject({
      status: 'ok',
      title: 'Recién creado',
    })
  })

  test('si GitHub falla se muestra lo guardado, marcado vencido', async () => {
    const s = await setup()
    await s.links.resolve(s.a, [r(PUBLIC, 1)])
    s.clock.t += TTL.live + 1
    s.state.failWith = new GithubApiError('unavailable', 'caído')
    const quiet = console.error
    console.error = () => {}
    try {
      const [old] = await s.links.resolve(s.a, [r(PUBLIC, 1)])
      expect(old).toMatchObject({
        status: 'ok',
        title: 'Abrir el detalle',
        stale: true,
      })
    } finally {
      console.error = quiet
    }
  })

  test('sin dato guardado y sin poder consultar, el link queda no disponible', async () => {
    const s = await setup()
    s.state.failWith = new GithubApiError('unavailable', 'caído')
    const quiet = console.error
    console.error = () => {}
    try {
      const [none] = await s.links.resolve(s.a, [r(PUBLIC, 1)])
      expect(none).toMatchObject({
        status: 'unavailable',
        title: null,
        state: null,
        fetchedAt: null,
      })
    } finally {
      console.error = quiet
    }
  })
})

describe('límite de la API', () => {
  test('por debajo del piso deja de consultar con ese token hasta el reinicio', async () => {
    const s = await setup(baseWorld(), { app: false })
    s.state.rate = {
      remaining: LOW_WATER - 1,
      resetAt: s.clock.t + 10 * 60_000,
    }
    await s.links.resolve(s.a, [r(PUBLIC, 1)])
    expect(s.calls).toHaveLength(1)

    s.clock.t += TTL.live + 1 // el link venció, pero el token de alice está frenado
    const [served] = await s.links.resolve(s.a, [r(PUBLIC, 1)])
    expect(s.calls).toHaveLength(1)
    expect(served).toMatchObject({ title: 'Abrir el detalle', stale: true })

    s.clock.t += 10 * 60_000 // pasó el reinicio
    s.state.rate = null
    await s.links.resolve(s.a, [r(PUBLIC, 1)])
    expect(s.calls).toHaveLength(2)
  })

  test('con el token de la App frenado, el pedido sigue con el de quien mira', async () => {
    const s = await setup()
    s.state.rate = {
      remaining: LOW_WATER - 1,
      resetAt: s.clock.t + 10 * 60_000,
    }
    await s.links.resolve(s.a, [r(PUBLIC, 1)])
    s.clock.t += TTL.live + 1
    await s.links.resolve(s.a, [r(PUBLIC, 1)])
    expect(s.calls.map((c) => c.token)).toEqual(['app-token', 'alice-token'])
  })

  test('un 403 de límite frena el token un rato', async () => {
    const s = await setup()
    s.state.failWith = new GithubApiError('rate_limited', 'límite')
    const quiet = console.error
    console.error = () => {}
    try {
      await s.links.resolve(s.a, [r(PUBLIC, 1)])
      s.state.failWith = null
      await s.links.resolve(s.a, [r(PUBLIC, 1)])
      // El primer pedido frenó la App y el token de alice; el segundo no consultó nada.
      expect(s.calls.map((c) => c.token)).toEqual(['app-token', 'alice-token'])
    } finally {
      console.error = quiet
    }
  })

  test('los lotes se parten de a BATCH_SIZE links', async () => {
    const links: Record<number, NonNullable<FoundLink>> = {}
    for (let i = 1; i <= 30; i++) links[i] = link('issue', `Issue ${i}`, 'open')
    const s = await setup({ [PUBLIC]: { isPrivate: false, seenBy: [], links } })
    const out = await s.links.resolve(
      s.a,
      Array.from({ length: 30 }, (_, i) => r(PUBLIC, i + 1)),
    )
    expect(out.every((l) => l.status === 'ok')).toBe(true)
    expect(s.calls.map((c) => c.refs.length)).toEqual([
      BATCH_SIZE,
      30 - BATCH_SIZE,
    ])
  })
})

describe('token de usuario', () => {
  test('si GitHub rechaza el token se renueva con el refresh token y se reintenta', async () => {
    const world = baseWorld()
    world[SECRET]!.seenBy = ['ghu_access_2']
    const s = await setup(world, {
      accessAlice: 'ghu_access',
      refreshAlice: 'ghr_refresh',
    })
    s.state.reject.add('ghu_access')
    const [got] = await s.links.resolve(s.a, [r(SECRET, 5)])
    expect(got).toMatchObject({ status: 'ok', title: 'Titulo secreto' })
    expect(s.calls.map((c) => c.token)).toEqual([
      'app-token',
      'ghu_access',
      'ghu_access_2',
    ])

    // El par nuevo quedó guardado (cifrado) para el próximo pedido.
    const sealed = loadGithubTokens(s.db, s.a.userId)!
    expect(await open(TOKEN_KEY, sealed.accessEnc)).toBe('ghu_access_2')
    expect(await open(TOKEN_KEY, sealed.refreshEnc!)).toBe('ghr_refresh_2')
  })

  test('un token vencido se renueva antes de usarlo', async () => {
    const world = baseWorld()
    world[SECRET]!.seenBy = ['ghu_access_2']
    const s = await setup(world, {
      accessAlice: 'viejo',
      refreshAlice: 'ghr_refresh',
    })
    s.db
      .query('UPDATE github_tokens SET access_expires_at = ? WHERE user_id = ?')
      .run(s.clock.t - 1, s.a.userId)
    const [got] = await s.links.resolve(s.a, [r(SECRET, 5)])
    expect(got?.title).toBe('Titulo secreto')
    expect(s.calls.map((c) => c.token)).not.toContain('viejo')
  })

  test('sin refresh token y rechazado: el link queda no disponible y no se insiste', async () => {
    const s = await setup(baseWorld(), { app: false })
    s.state.reject.add('alice-token')
    const quiet = console.error
    console.error = () => {}
    try {
      const [none] = await s.links.resolve(s.a, [r(SECRET, 5)])
      expect(none?.status).toBe('unavailable')
      await s.links.resolve(s.a, [r(SECRET, 5)])
      expect(s.calls).toHaveLength(1)
    } finally {
      console.error = quiet
    }
  })

  test('una persona sin token guardado solo ve lo que resuelve la App', async () => {
    const s = await setup()
    s.db.query('DELETE FROM github_tokens WHERE user_id = ?').run(s.b.userId)
    const [pub] = await s.links.resolve(s.b, [r(PUBLIC, 1)])
    expect(pub?.title).toBe('Abrir el detalle')
    const [priv] = await s.links.resolve(s.b, [r(SECRET, 5)])
    expect(priv).toMatchObject({ status: 'unavailable', title: null })
  })
})

describe('GraphQL', () => {
  const QUERY = `query($refs: [GithubLinkInput!]!) {
    githubLinks(refs: $refs) { owner repo number status kind title state stale fetchedAt }
  }`

  async function api() {
    const ctx = setupServer(fakeGithub(alice))
    const fake = fakeApi(baseWorld())
    const links = createGithubLinks({
      db: ctx.db,
      api: fake.api,
      login: null,
      tokenKey: TOKEN_KEY,
    })
    const { createApp } = await import('./app')
    const { createBus } = await import('./events')
    const app = createApp(ctx.db, {
      ingress: 'public',
      config,
      github: null,
      bus: createBus(),
      githubLinks: links,
      logging: false,
    })
    const { loginAs } = await import('./testing')
    const login = await loginAs(ctx.db, alice, 'public')
    const post = async (variables: unknown, cookie?: string) =>
      (
        await app.handle(
          new Request('https://checklist.test/graphql', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(cookie ? { cookie } : {}),
            },
            body: JSON.stringify({ query: QUERY, variables }),
          }),
        )
      ).json() as Promise<{
        data?: { githubLinks: Record<string, unknown>[] } | null
        errors?: { extensions?: { code?: string } }[]
      }>
    return { post, cookie: login.cookie, fake }
  }

  test('sin sesión no consulta nada', async () => {
    const { post, fake } = await api()
    const res = await post({
      refs: [{ owner: 'oven-sh', repo: 'bun', number: 1 }],
    })
    expect(res.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED')
    expect(fake.calls).toHaveLength(0)
  })

  test('devuelve el estado de cada link', async () => {
    const { post, cookie } = await api()
    const res = await post(
      {
        refs: [
          { owner: 'oven-sh', repo: 'bun', number: 1 },
          { owner: 'oven-sh', repo: 'bun', number: 2 },
        ],
      },
      cookie,
    )
    expect(res.errors).toBeUndefined()
    expect(res.data!.githubLinks).toMatchObject([
      {
        number: 1,
        status: 'ok',
        kind: 'issue',
        state: 'open',
        title: 'Abrir el detalle',
        stale: false,
      },
      { number: 2, status: 'ok', kind: 'pull', state: 'merged' },
    ])
  })

  test('rechaza más de 50 links, dueños con forma inválida y números fuera de rango', async () => {
    const { post, cookie, fake } = await api()
    const many = Array.from({ length: 51 }, (_, i) => ({
      owner: 'a',
      repo: 'b',
      number: i + 1,
    }))
    for (const refs of [
      many,
      [{ owner: 'a b', repo: 'b', number: 1 }],
      [{ owner: 'a', repo: '..', number: 1 }],
      [{ owner: 'a', repo: 'b', number: 0 }],
      [{ owner: 'a', repo: 'b', number: -3 }],
    ]) {
      const res = await post({ refs }, cookie)
      expect(res.errors?.[0]?.extensions?.code).toBe('INVALID_INPUT')
    }
    expect(fake.calls).toHaveLength(0)
  })

  test('el nombre de la cookie no se confunde con la sesión de otra puerta', async () => {
    const { post, fake } = await api()
    const res = await post(
      { refs: [{ owner: 'oven-sh', repo: 'bun', number: 1 }] },
      `${sessionCookieName(true)}=nada`,
    )
    expect(res.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED')
    expect(fake.calls).toHaveLength(0)
  })
})
