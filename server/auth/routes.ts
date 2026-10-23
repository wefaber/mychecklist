import type { Database } from 'bun:sqlite'
import { Elysia } from 'elysia'
import type { Config } from '../config'
import { DomainError } from '../errors'
import type { Ingress } from '../ingress'
import { signIn, signOut } from '../services/accounts'
import {
  clearCookie,
  parseCookies,
  serializeCookie,
  sessionCookieName,
  stateCookieName,
} from './cookies'
import { randomToken } from './crypto'
import type { GithubClient } from './github'

const STATE_TTL_S = 600
const SESSION_TTL_S = 30 * 24 * 60 * 60
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 20

type Deps = {
  db: Database
  ingress: Ingress
  config: Config
  github: GithubClient | null
  now: () => number
}

/** Solo rutas del mismo sitio: `/algo`, nunca `//host` ni `/\host`. */
export function safeReturnTo(raw: string | null | undefined): string {
  return raw && /^\/(?![/\\])[^\s]*$/.test(raw) ? raw : '/'
}

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location })
  for (const c of cookies) headers.append('set-cookie', c)
  return new Response(null, { status: 302, headers })
}

function errorJson(error: DomainError, status: number): Response {
  return Response.json(
    { error: { code: error.code, message: error.message } },
    { status },
  )
}

/** Límite por dirección, solo en memoria: no se guarda ni se loguea ninguna IP. */
function rateLimiter(now: () => number) {
  const hits = new Map<string, { start: number; count: number }>()
  return (address: string): boolean => {
    const t = now()
    const entry = hits.get(address)
    if (!entry || t - entry.start >= WINDOW_MS) {
      if (hits.size > 10_000) hits.clear()
      hits.set(address, { start: t, count: 1 })
      return true
    }
    entry.count++
    return entry.count <= MAX_PER_WINDOW
  }
}

/**
 * Login de GitHub, cierre de sesión. Es HTTP plano porque el flujo de OAuth son redirecciones y cookies, no una API
 * de datos (ARCHITECTURE.md › API).
 */
export function authRoutes({ db, ingress, config, github, now }: Deps) {
  const origin = config.origins[ingress]
  const secure = origin.startsWith('https:')
  const redirectUri = `${origin}/auth/github/callback`
  const allowed = rateLimiter(now)
  const addressOf = (request: Request) =>
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'

  return new Elysia()
    .get('/auth/github/login', ({ request }) => {
      if (!allowed(addressOf(request)))
        return Response.json(
          { error: { code: 'RATE_LIMITED', message: 'Demasiados intentos' } },
          { status: 429 },
        )
      if (!github || !config.tokenKey)
        return errorJson(
          new DomainError(
            'AUTH_NOT_CONFIGURED',
            'El login con GitHub no está configurado en este servidor',
          ),
          503,
        )
      const state = randomToken()
      const returnTo = safeReturnTo(
        new URL(request.url).searchParams.get('return'),
      )
      // El estado viaja en una cookie del navegador que inició el login: ata el callback a ese navegador.
      const cookie = serializeCookie(
        stateCookieName(secure),
        `${state}.${Buffer.from(returnTo).toString('base64url')}`,
        { maxAge: STATE_TTL_S, secure },
      )
      return redirect(github.authorizeUrl(state, redirectUri), [cookie])
    })

    .get('/auth/github/callback', async ({ request }) => {
      if (!allowed(addressOf(request)))
        return Response.json(
          { error: { code: 'RATE_LIMITED', message: 'Demasiados intentos' } },
          { status: 429 },
        )
      const params = new URL(request.url).searchParams
      const raw = parseCookies(request.headers.get('cookie'))[
        stateCookieName(secure)
      ]
      const [state, encodedReturn] = raw?.split('.') ?? []
      const clear = clearCookie(stateCookieName(secure), secure)
      const failed = (reason: string) => redirect(`/?auth=${reason}`, [clear])

      if (params.get('error')) return failed('denied')
      const code = params.get('code')
      if (!github || !config.tokenKey) return failed('error')
      if (!code || !state || params.get('state') !== state)
        return failed('error')

      try {
        const tokens = await github.exchangeCode(code, redirectUri)
        const profile = await github.fetchProfile(tokens.accessToken)
        const { token } = await signIn(db, {
          profile,
          tokens,
          ingress,
          tokenKey: config.tokenKey,
          now: now(),
        })
        const returnTo = safeReturnTo(
          encodedReturn
            ? Buffer.from(encodedReturn, 'base64url').toString()
            : null,
        )
        return redirect(returnTo, [
          clear,
          serializeCookie(sessionCookieName(secure), token, {
            maxAge: SESSION_TTL_S,
            secure,
          }),
        ])
      } catch (error) {
        console.error('github login failed', error)
        return failed('error')
      }
    })

    .post('/auth/logout', ({ request }) => {
      const token = parseCookies(request.headers.get('cookie'))[
        sessionCookieName(secure)
      ]
      if (token) signOut(db, token)
      return new Response(null, {
        status: 204,
        headers: {
          'set-cookie': clearCookie(sessionCookieName(secure), secure),
        },
      })
    })
}
