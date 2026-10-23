import { describe, expect, spyOn, test } from 'bun:test'
import { createApp } from '../app'
import { alice, config, fakeGithub, setupServer, TOKEN_KEY } from '../testing'
import { open } from './crypto'

const ORIGIN = 'https://checklist.test'

type Ctx = ReturnType<typeof setupServer>

function cookieValue(res: Response, name: string): string | undefined {
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(';')
    if (pair?.startsWith(`${name}=`)) return pair.slice(name.length + 1)
  }
}

async function startLogin(ctx: Ctx, query = '') {
  const res = await ctx.apps.public.handle(
    new Request(`${ORIGIN}/auth/github/login${query}`),
  )
  const location = new URL(res.headers.get('location') ?? ORIGIN)
  return {
    res,
    state: location.searchParams.get('state') ?? '',
    stateCookie: cookieValue(res, '__Host-mc_oauth') ?? '',
    location,
  }
}

function callback(ctx: Ctx, params: string, cookie: string) {
  return ctx.apps.public.handle(
    new Request(`${ORIGIN}/auth/github/callback?${params}`, {
      headers: { cookie },
    }),
  )
}

/** Login completo con éxito; devuelve la respuesta del callback. */
async function fullLogin(ctx: Ctx, query = '') {
  const { state, stateCookie } = await startLogin(ctx, query)
  return callback(
    ctx,
    `code=good-code&state=${state}`,
    `__Host-mc_oauth=${stateCookie}`,
  )
}

const count = (ctx: Ctx, table: string) =>
  ctx.db.query<{ n: number }, []>(`SELECT count(*) AS n FROM ${table}`).get()!.n

describe('login con GitHub', () => {
  test('redirige a GitHub con el estado y el callback de esta puerta', async () => {
    const ctx = setupServer(fakeGithub(alice))
    const { res, state, location } = await startLogin(ctx)
    expect(res.status).toBe(302)
    expect(location.host).toBe('github.test')
    expect(state.length).toBeGreaterThan(20)
    expect(location.searchParams.get('redirect_uri')).toBe(
      `${ORIGIN}/auth/github/callback`,
    )
  })

  test('la cookie del estado es HttpOnly, Lax, Secure y __Host-', async () => {
    const ctx = setupServer(fakeGithub(alice))
    const { res } = await startLogin(ctx)
    const line = res.headers.getSetCookie()[0]!
    expect(line).toStartWith('__Host-mc_oauth=')
    expect(line).toContain('HttpOnly')
    expect(line).toContain('SameSite=Lax')
    expect(line).toContain('Secure')
  })

  test('el callback abre sesión, crea al usuario y su org personal', async () => {
    const ctx = setupServer(fakeGithub(alice))
    const res = await fullLogin(ctx, '?return=/listas')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/listas')
    const session = cookieValue(res, '__Host-mc_session')!
    expect(session).toBeTruthy()

    const { data } = await ctx.gql.public(
      '{ me { login orgs { kind name role activity { type } } } }',
      `__Host-mc_session=${session}`,
    )
    expect(data?.me.login).toBe('alice')
    expect(data?.me.orgs).toEqual([
      {
        kind: 'personal',
        name: 'alice',
        role: 'owner',
        activity: [{ type: 'org.created' }],
      },
    ])
  })

  test('un segundo login no duplica ni el usuario ni la org', async () => {
    const ctx = setupServer(fakeGithub(alice))
    await fullLogin(ctx)
    await fullLogin(ctx)
    expect(count(ctx, 'users')).toBe(1)
    expect(count(ctx, 'orgs')).toBe(1)
    expect(count(ctx, 'sessions')).toBe(2)
  })

  test('los tokens de GitHub quedan cifrados y se descifran con la clave', async () => {
    const ctx = setupServer(fakeGithub(alice))
    await fullLogin(ctx)
    const row = ctx.db
      .query<{ access_enc: string; refresh_enc: string }, []>(
        'SELECT access_enc, refresh_enc FROM github_tokens',
      )
      .get()!
    expect(row.access_enc).not.toContain('ghu_access')
    expect(await open(TOKEN_KEY, row.access_enc)).toBe('ghu_access')
    expect(await open(TOKEN_KEY, row.refresh_enc)).toBe('ghr_refresh')
  })

  test('el token de sesión se guarda solo como sha256', async () => {
    const ctx = setupServer(fakeGithub(alice))
    const token = cookieValue(await fullLogin(ctx), '__Host-mc_session')!
    const id = ctx.db
      .query<{ id: string }, []>('SELECT id FROM sessions')
      .get()!.id
    expect(id).not.toBe(token)
    expect(id).toHaveLength(64)
  })

  test('un estado que no coincide con la cookie no abre sesión', async () => {
    const ctx = setupServer(fakeGithub(alice))
    const { stateCookie } = await startLogin(ctx)
    const res = await callback(
      ctx,
      'code=good-code&state=otro',
      `__Host-mc_oauth=${stateCookie}`,
    )
    expect(res.headers.get('location')).toBe('/?auth=error')
    expect(cookieValue(res, '__Host-mc_session')).toBeUndefined()
  })

  test('sin cookie del estado (login iniciado en otro navegador) no abre sesión', async () => {
    const ctx = setupServer(fakeGithub(alice))
    const { state } = await startLogin(ctx)
    const res = await callback(ctx, `code=good-code&state=${state}`, '')
    expect(res.headers.get('location')).toBe('/?auth=error')
    expect(count(ctx, 'sessions')).toBe(0)
  })

  test('un código que GitHub rechaza vuelve con error y no crea nada', async () => {
    const ctx = setupServer(fakeGithub(alice))
    const { state, stateCookie } = await startLogin(ctx)
    const log = spyOn(console, 'error').mockImplementation(() => {})
    const res = await callback(
      ctx,
      `code=bad&state=${state}`,
      `__Host-mc_oauth=${stateCookie}`,
    )
    expect(log).toHaveBeenCalledTimes(1)
    log.mockRestore()
    expect(res.headers.get('location')).toBe('/?auth=error')
    expect(count(ctx, 'users')).toBe(0)
  })

  test('si el usuario niega el acceso vuelve con denied', async () => {
    const ctx = setupServer(fakeGithub(alice))
    const { state, stateCookie } = await startLogin(ctx)
    const res = await callback(
      ctx,
      `error=access_denied&state=${state}`,
      `__Host-mc_oauth=${stateCookie}`,
    )
    expect(res.headers.get('location')).toBe('/?auth=denied')
  })

  test('return no puede ser una redirección abierta', async () => {
    const ctx = setupServer(fakeGithub(alice))
    const res = await fullLogin(ctx, '?return=//evil.test')
    expect(res.headers.get('location')).toBe('/')
  })

  test('sin credenciales de GitHub el login da 503 AUTH_NOT_CONFIGURED', async () => {
    const ctx = setupServer(null)
    const res = await ctx.apps.public.handle(
      new Request(`${ORIGIN}/auth/github/login`),
    )
    expect(res.status).toBe(503)
    expect(((await res.json()) as any).error.code).toBe('AUTH_NOT_CONFIGURED')
  })

  test('sin clave de cifrado falla cerrado: no se guarda ningún token', async () => {
    const ctx = setupServer(fakeGithub(alice))
    const app = createApp(ctx.db, {
      config: { ...config, tokenKey: null },
      github: fakeGithub(alice),
      logging: false,
    })
    const res = await app.handle(new Request(`${ORIGIN}/auth/github/login`))
    expect(res.status).toBe(503)
    expect(count(ctx, 'github_tokens')).toBe(0)
  })

  test('limita los intentos por dirección', async () => {
    const ctx = setupServer(fakeGithub(alice))
    const hit = (address: string) =>
      ctx.apps.public.handle(
        new Request(`${ORIGIN}/auth/github/login`, {
          headers: { 'x-forwarded-for': address },
        }),
      )
    let last = 0
    for (let i = 0; i < 25; i++) last = (await hit('203.0.113.9')).status
    expect(last).toBe(429)
    expect((await hit('203.0.113.10')).status).toBe(302)
  })

  test('el logout borra la sesión y la cookie', async () => {
    const ctx = setupServer(fakeGithub(alice))
    const cookie = `__Host-mc_session=${cookieValue(await fullLogin(ctx), '__Host-mc_session')}`
    const out = await ctx.apps.public.handle(
      new Request(`${ORIGIN}/auth/logout`, {
        method: 'POST',
        headers: { cookie },
      }),
    )
    expect(out.status).toBe(204)
    expect(out.headers.getSetCookie()[0]).toContain('Max-Age=0')
    const { data } = await ctx.gql.public('{ me { login } }', cookie)
    expect(data?.me).toBeNull()
  })
})
