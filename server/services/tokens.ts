import type { Database } from 'bun:sqlite'
import {
  countActiveApiTokens,
  insertApiToken,
  listApiTokens,
  revokeApiToken as revokeRow,
  type ApiTokenRow,
  type TokenMode,
} from '../db/tokens'
import { openScope } from '../db/scoped'
import { DomainError } from '../errors'
import type { Caller } from './types'
import { cleanText } from './validate'

export const MAX_TOKEN_NAME = 40
/** Tokens vigentes por usuario y org: alcanza para un puñado de agentes y acota lo que se puede filtrar. */
export const MAX_ACTIVE_TOKENS = 20
export const DEFAULT_EXPIRY_DAYS = 90
export const EXPIRY_DAYS = [30, 90, 365] as const
const DAY_MS = 24 * 60 * 60 * 1000

export type TokenView = {
  id: string
  orgId: string
  name: string
  mode: TokenMode
  /** Últimos 4 caracteres del secreto, para reconocerlo en la lista. */
  hint: string
  createdAt: number
  lastUsedAt: number | null
  expiresAt: number | null
  revokedAt: number | null
}

const view = (r: ApiTokenRow): TokenView => ({
  id: r.id,
  orgId: r.orgId,
  name: r.name,
  mode: r.mode,
  hint: r.hint,
  createdAt: r.createdAt,
  lastUsedAt: r.lastUsedAt,
  expiresAt: r.expiresAt,
  revokedAt: r.revokedAt,
})

/**
 * Crea un token para la org. Solo `owner` y `admin` (en la org personal, su dueño) y solo con la puerta de la
 * sesión: el token queda atado a ella (ADR 0007). Un token de API nunca llega acá: GraphQL arma el `Caller` con la
 * cookie de sesión.
 */
export function createApiToken(
  db: Database,
  caller: Caller,
  input: {
    orgId: string
    name: string
    mode: TokenMode
    /** `null` = sin vencimiento. */
    expiresInDays: number | null
  },
  now = Date.now(),
): { token: TokenView; secret: string } {
  const name = cleanText(input.name, {
    max: MAX_TOKEN_NAME,
    label: 'El nombre',
  })
  if (
    input.expiresInDays !== null &&
    !(EXPIRY_DAYS as readonly number[]).includes(input.expiresInDays)
  )
    throw new DomainError(
      'INVALID_INPUT',
      `El vencimiento es de ${EXPIRY_DAYS.join(', ')} días o ninguno`,
    )
  const scope = openScope(db, { orgId: input.orgId, ...caller })
  if (scope.role !== 'owner' && scope.role !== 'admin')
    throw new DomainError(
      'FORBIDDEN',
      'Solo quien administra la organización crea tokens',
    )
  if (
    countActiveApiTokens(db, caller.userId, input.orgId, now) >=
    MAX_ACTIVE_TOKENS
  )
    throw new DomainError(
      'LIMIT_REACHED',
      `Hasta ${MAX_ACTIVE_TOKENS} tokens vigentes por organización`,
    )
  const { row, secret } = db.transaction(() => {
    const made = insertApiToken(
      db,
      {
        userId: caller.userId,
        orgId: input.orgId,
        ingress: caller.ingress,
        mode: input.mode,
        name,
        expiresAt:
          input.expiresInDays === null
            ? null
            : now + input.expiresInDays * DAY_MS,
      },
      now,
    )
    scope.activity.append(
      {
        type: 'token.created',
        entityType: 'token',
        entityId: made.row.id,
        via: caller.via ?? 'web',
      },
      now,
    )
    return made
  })()
  return { token: view(row), secret }
}

/** Los tokens del usuario en esa org. Nunca incluyen el secreto. */
export function listTokens(
  db: Database,
  caller: Caller,
  orgId: string,
): TokenView[] {
  openScope(db, { orgId, ...caller })
  return listApiTokens(db, caller.userId, orgId).map(view)
}

/** Revoca un token propio. Se puede aunque el rol ya no administre la org: quien lo tiene siempre puede apagarlo. */
export function revokeToken(
  db: Database,
  caller: Caller,
  input: { orgId: string; id: string },
  now = Date.now(),
): void {
  const scope = openScope(db, { orgId: input.orgId, ...caller })
  db.transaction(() => {
    if (!revokeRow(db, caller.userId, input.id, now))
      throw new DomainError(
        'NOT_FOUND',
        'El token no existe o ya está revocado',
      )
    scope.activity.append(
      {
        type: 'token.revoked',
        entityType: 'token',
        entityId: input.id,
        via: caller.via ?? 'web',
      },
      now,
    )
  })()
}
