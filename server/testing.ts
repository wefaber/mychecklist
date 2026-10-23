import type { Database } from 'bun:sqlite'
import { createApp } from './app'
import { sessionCookieName } from './auth/cookies'
import type { GithubClient, GithubProfile } from './auth/github'
import { loadConfig, type Config } from './config'
import { openDb } from './db/connection'
import { migrate } from './db/migrate'
import type { Ingress } from './ingress'
import { signIn } from './services/accounts'

export const TOKEN_KEY = Uint8Array.from({ length: 32 }, (_, i) => i + 1)

export const config: Config = {
  ...loadConfig({}),
  origins: {
    public: 'https://checklist.test',
    tailnet: 'https://checklist.tailnet.test',
  },
  tokenKey: TOKEN_KEY,
  github: { clientId: 'cid', clientSecret: 'secret' },
}

/** GitHub de mentira: los tests nunca hablan con terceros. */
export function fakeGithub(profile: GithubProfile): GithubClient {
  return {
    authorizeUrl: (state, redirectUri) =>
      `https://github.test/authorize?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    exchangeCode: async (code) => {
      if (code !== 'good-code') throw new Error('bad code')
      return {
        accessToken: 'ghu_access',
        refreshToken: 'ghr_refresh',
        expiresAt: 2_000_000_000_000,
        refreshExpiresAt: 2_100_000_000_000,
      }
    },
    fetchProfile: async () => profile,
  }
}

export const alice: GithubProfile = {
  id: 1,
  login: 'alice',
  name: 'Alice',
  avatarUrl: null,
}
export const bob: GithubProfile = {
  id: 2,
  login: 'bob',
  name: null,
  avatarUrl: null,
}

export type Gql = (
  query: string,
  cookie?: string,
) => Promise<{
  data?: Record<string, any> | null
  errors?: { message: string; extensions?: { code?: string } }[]
}>

/** Una base en memoria con las dos puertas encendidas, como en producción. */
export function setupServer(github: GithubClient | null = null) {
  const db: Database = openDb(':memory:')
  migrate(db)
  const apps = {
    public: createApp(db, {
      ingress: 'public',
      config,
      github,
      logging: false,
    }),
    tailnet: createApp(db, {
      ingress: 'tailnet',
      config,
      github,
      logging: false,
    }),
  }
  const gqlOn =
    (ingress: Ingress): Gql =>
    async (query, cookie) => {
      const res = await apps[ingress].handle(
        new Request('https://checklist.test/graphql', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(cookie ? { cookie } : {}),
          },
          body: JSON.stringify({ query }),
        }),
      )
      return res.json() as ReturnType<Gql>
    }
  return {
    db,
    apps,
    gql: { public: gqlOn('public'), tailnet: gqlOn('tailnet') },
  }
}

/** Inicia sesión como `profile` por la puerta dada y devuelve el valor de `Cookie`. */
export async function loginAs(
  db: Database,
  profile: GithubProfile,
  ingress: Ingress,
): Promise<{ cookie: string; userId: string }> {
  const { token, user } = await signIn(db, {
    profile,
    tokens: {
      accessToken: 'a',
      refreshToken: null,
      expiresAt: null,
      refreshExpiresAt: null,
    },
    ingress,
    tokenKey: TOKEN_KEY,
  })
  return { cookie: `${sessionCookieName(true)}=${token}`, userId: user.id }
}
