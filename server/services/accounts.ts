import type { Database } from 'bun:sqlite'
import { seal } from '../auth/crypto'
import type { GithubProfile, GithubTokens } from '../auth/github'
import {
  createPersonalOrg,
  listOrgsFor,
  saveGithubTokens,
  upsertUser,
  type OrgSummary,
  type User,
} from '../db/accounts'
import { openScope } from '../db/scoped'
import { createSession, deleteSession } from '../db/sessions'
import { DomainError } from '../errors'
import type { Ingress } from '../ingress'
import type { Caller } from './types'

/**
 * Cierra el login de GitHub: crea o actualiza al usuario, le arma su org personal la primera vez, guarda los tokens
 * cifrados y abre la sesión. Devuelve el token de la cookie.
 */
export async function signIn(
  db: Database,
  input: {
    profile: GithubProfile
    tokens: GithubTokens
    ingress: Ingress
    tokenKey: Uint8Array | null
    now?: number
  },
): Promise<{ token: string; user: User }> {
  const now = input.now ?? Date.now()
  // Sin clave no se guarda ningún token: falla cerrado.
  if (!input.tokenKey)
    throw new DomainError(
      'AUTH_NOT_CONFIGURED',
      'Falta MYCHECKLIST_TOKEN_KEY en el servidor',
    )
  const sealed = {
    accessEnc: await seal(input.tokenKey, input.tokens.accessToken),
    refreshEnc: input.tokens.refreshToken
      ? await seal(input.tokenKey, input.tokens.refreshToken)
      : null,
    accessExpiresAt: input.tokens.expiresAt,
    refreshExpiresAt: input.tokens.refreshExpiresAt,
  }
  return db.transaction(() => {
    const { user, created } = upsertUser(db, input.profile, now)
    if (created) {
      const org = createPersonalOrg(db, user, now)
      openScope(db, {
        orgId: org.id,
        userId: user.id,
        ingress: input.ingress,
      }).activity.append(
        {
          type: 'org.created',
          entityType: 'org',
          entityId: org.id,
          via: 'web',
        },
        now,
      )
    }
    saveGithubTokens(db, user.id, sealed, now)
    const token = createSession(db, {
      userId: user.id,
      ingress: input.ingress,
      now,
    })
    return { token, user }
  })()
}

export function signOut(db: Database, token: string) {
  deleteSession(db, token)
}

export function listOrgs(db: Database, caller: Caller): OrgSummary[] {
  return listOrgsFor(db, caller.userId, caller.ingress)
}
