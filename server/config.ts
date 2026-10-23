import type { Ingress } from './ingress'

export type Config = {
  ports: Record<Ingress, number>
  /** Origen externo de cada puerta; arma el callback de OAuth y decide `Secure` en las cookies. */
  origins: Record<Ingress, string>
  github: { clientId: string; clientSecret: string } | null
  /** Clave AES-256 de los tokens guardados. Sin clave, el login falla cerrado. */
  tokenKey: Uint8Array | null
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
    github: clientId && clientSecret ? { clientId, clientSecret } : null,
    tokenKey: env.MYCHECKLIST_TOKEN_KEY
      ? decodeKey(env.MYCHECKLIST_TOKEN_KEY)
      : null,
  }
}
