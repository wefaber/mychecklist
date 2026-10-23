/**
 * Login con una GitHub App usada solo para tokens de usuario (ADR 0003). Si se cambia por una OAuth App, el cambio
 * queda acotado a este archivo.
 */
export type GithubTokens = {
  accessToken: string
  refreshToken: string | null
  /** Epoch ms; `null` si el token no vence. */
  expiresAt: number | null
  refreshExpiresAt: number | null
}

export type GithubProfile = {
  id: number
  login: string
  name: string | null
  avatarUrl: string | null
}

export type GithubClient = {
  authorizeUrl(state: string, redirectUri: string): string
  exchangeCode(code: string, redirectUri: string): Promise<GithubTokens>
  fetchProfile(accessToken: string): Promise<GithubProfile>
}

type TokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  refresh_token_expires_in?: number
  error?: string
}

type UserResponse = {
  id: number
  login: string
  name?: string | null
  avatar_url?: string | null
}

export function githubClient(
  cfg: { clientId: string; clientSecret: string },
  fetchFn: typeof fetch = fetch,
  now: () => number = Date.now,
): GithubClient {
  return {
    authorizeUrl(state, redirectUri) {
      const url = new URL('https://github.com/login/oauth/authorize')
      url.searchParams.set('client_id', cfg.clientId)
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('state', state)
      return url.toString()
    },

    async exchangeCode(code, redirectUri) {
      const res = await fetchFn('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      })
      const body = (await res.json()) as TokenResponse
      if (!res.ok || !body.access_token)
        throw new Error(
          `GitHub token exchange failed: ${body.error ?? res.status}`,
        )
      return {
        accessToken: body.access_token,
        refreshToken: body.refresh_token ?? null,
        expiresAt: body.expires_in ? now() + body.expires_in * 1000 : null,
        refreshExpiresAt: body.refresh_token_expires_in
          ? now() + body.refresh_token_expires_in * 1000
          : null,
      }
    },

    async fetchProfile(accessToken) {
      const res = await fetchFn('https://api.github.com/user', {
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${accessToken}`,
          'user-agent': 'mychecklist',
        },
      })
      if (!res.ok) throw new Error(`GitHub profile failed: ${res.status}`)
      const body = (await res.json()) as UserResponse
      return {
        id: body.id,
        login: body.login,
        name: body.name ?? null,
        avatarUrl: body.avatar_url ?? null,
      }
    },
  }
}
