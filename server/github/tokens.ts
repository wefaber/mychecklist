import type { Database } from 'bun:sqlite'
import { open, seal } from '../auth/crypto'
import type { GithubClient } from '../auth/github'
import { loadGithubTokens, saveGithubTokens } from '../db/accounts'

/** Margen para renovar antes de que el token venza en pleno pedido. */
const SKEW_MS = 60_000

type Deps = {
  db: Database
  login: GithubClient | null
  tokenKey: Uint8Array | null
  now: () => number
}

/**
 * Token de GitHub de un usuario para consultar (ADR 0006). Lo abre de la base y, si venció o está por vencer, lo
 * renueva con el refresh token y guarda el par nuevo. El refresh token es de un solo uso: una sola renovación a la vez
 * por usuario, o la segunda gastaría un token ya cambiado. Devuelve `null` si no hay token usable (nunca entró, sin
 * clave, refresh vencido o rechazado); quien llama sigue sin él.
 */
export function userTokens({ db, login, tokenKey, now }: Deps) {
  const renewing = new Map<string, Promise<string | null>>()

  async function renew(userId: string): Promise<string | null> {
    if (!tokenKey || !login) return null
    const sealed = loadGithubTokens(db, userId)
    if (!sealed?.refreshEnc) return null
    if (sealed.refreshExpiresAt !== null && sealed.refreshExpiresAt <= now())
      return null
    try {
      const fresh = await login.refresh(await open(tokenKey, sealed.refreshEnc))
      saveGithubTokens(
        db,
        userId,
        {
          accessEnc: await seal(tokenKey, fresh.accessToken),
          refreshEnc: fresh.refreshToken
            ? await seal(tokenKey, fresh.refreshToken)
            : null,
          accessExpiresAt: fresh.expiresAt,
          refreshExpiresAt: fresh.refreshExpiresAt,
        },
        now(),
      )
      return fresh.accessToken
    } catch (error) {
      console.error(
        'github token refresh failed:',
        error instanceof Error ? error.message : error,
      )
      return null
    }
  }

  return {
    /** `force`: el token que había fue rechazado por GitHub, se renueva aunque no figure como vencido. */
    async get(userId: string, force = false): Promise<string | null> {
      if (!tokenKey) return null
      const sealed = loadGithubTokens(db, userId)
      if (!sealed) return null
      const expired =
        sealed.accessExpiresAt !== null &&
        sealed.accessExpiresAt - now() < SKEW_MS
      if (!expired && !force) {
        try {
          return await open(tokenKey, sealed.accessEnc)
        } catch {
          return null
        }
      }
      let pending = renewing.get(userId)
      if (!pending) {
        pending = renew(userId).finally(() => renewing.delete(userId))
        renewing.set(userId, pending)
      }
      return pending
    },
  }
}

export type UserTokens = ReturnType<typeof userTokens>
