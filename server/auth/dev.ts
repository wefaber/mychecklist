import type { Database } from 'bun:sqlite'
import { Elysia } from 'elysia'
import type { Config } from '../config'
import type { Ingress } from '../ingress'
import { signIn } from '../services/accounts'
import { serializeCookie, sessionCookieName } from './cookies'
import { safeReturnTo } from './routes'

const SESSION_TTL_S = 30 * 24 * 60 * 60

type Deps = {
  db: Database
  ingress: Ingress
  config: Config
  now: () => number
}

/**
 * `GET /auth/dev?return=/`: sesión de prueba para desarrollo (la UI y el shell de Tauri se prueban sin GitHub).
 * Se monta solo con `MYCHECKLIST_DEV_LOGIN=1` fuera de producción, en la puerta pública y si el origen configurado
 * es `http://localhost`: un servidor desplegado nunca la expone. Los tokens son falsos y no salen de la base local.
 */
export function devLoginRoute({ db, ingress, config, now }: Deps) {
  const enabled =
    config.devLogin &&
    ingress === 'public' &&
    config.origins.public.startsWith('http://localhost')
  if (!enabled) return new Elysia()

  return new Elysia().get('/auth/dev', async ({ request }) => {
    const returnTo = safeReturnTo(
      new URL(request.url).searchParams.get('return'),
    )
    const { token } = await signIn(db, {
      profile: {
        id: 999_001,
        login: 'dev',
        name: 'Dev Local',
        avatarUrl: null,
      },
      tokens: {
        accessToken: 'dev',
        refreshToken: null,
        expiresAt: null,
        refreshExpiresAt: null,
      },
      ingress,
      // Clave descartable: los tokens de esta sesión son falsos.
      tokenKey: Uint8Array.from({ length: 32 }, (_, i) => i + 1),
      now: now(),
    })
    const headers = new Headers({ location: returnTo })
    headers.append(
      'set-cookie',
      serializeCookie(sessionCookieName(false), token, {
        maxAge: SESSION_TTL_S,
        secure: false,
      }),
    )
    return new Response(null, { status: 302, headers })
  })
}
