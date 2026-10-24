import { dirname, join } from 'node:path'
import type { Ingress } from './ingress'

export type Config = {
  ports: Record<Ingress, number>
  /** Origen externo de cada puerta; arma el callback de OAuth y decide `Secure` en las cookies. */
  origins: Record<Ingress, string>
  github: { clientId: string; clientSecret: string } | null
  /** La GitHub App como app (no como login): firma el JWT que da el token de instalación (ADR 0006). */
  githubApp: { appId: string; privateKey: string } | null
  /** Carpeta de los adjuntos (`files/<aa>/<sha256>`); por defecto al lado de la base. */
  filesDir: string
  /** Clave AES-256 de los tokens guardados. Sin clave, el login falla cerrado. */
  tokenKey: Uint8Array | null
  /** Solo desarrollo: habilita `GET /auth/dev` (sesión de prueba sin GitHub). Nunca en producción. */
  devLogin: boolean
}

function decodeKey(raw: string): Uint8Array {
  const key = Uint8Array.from(Buffer.from(raw, 'base64'))
  if (key.length !== 32)
    throw new Error('MYCHECKLIST_TOKEN_KEY debe ser base64 de 32 bytes')
  return key
}

/** Lee la configuración del entorno (`~/deploy/env/mychecklist.env` en el servidor, `.env.local` en local). */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): Config {
  const clientId = env.GITHUB_CLIENT_ID
  const clientSecret = env.GITHUB_CLIENT_SECRET
  const dev = 'http://localhost:5191'
  return {
    ports: {
      public: Number(env.MYCHECKLIST_PORT ?? 4161),
      tailnet: Number(env.MYCHECKLIST_TAILNET_PORT ?? 4163),
    },
    origins: {
      public: env.MYCHECKLIST_PUBLIC_URL ?? dev,
      tailnet: env.MYCHECKLIST_TAILNET_URL ?? dev,
    },
    filesDir:
      env.MYCHECKLIST_FILES ??
      join(dirname(env.MYCHECKLIST_DB ?? './data/mychecklist.db'), 'files'),
    devLogin:
      env.MYCHECKLIST_DEV_LOGIN === '1' && env.NODE_ENV !== 'production',
    github: clientId && clientSecret ? { clientId, clientSecret } : null,
    githubApp:
      env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY
        ? {
            appId: env.GITHUB_APP_ID,
            // Un archivo de entorno de una sola línea guarda los saltos de la clave como `\n` literales.
            privateKey: env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, '\n'),
          }
        : null,
    tokenKey: env.MYCHECKLIST_TOKEN_KEY
      ? decodeKey(env.MYCHECKLIST_TOKEN_KEY)
      : null,
  }
}
