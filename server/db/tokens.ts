import type { Database } from 'bun:sqlite'
import { randomToken, sha256Hex } from '../auth/crypto'
import type { Ingress } from '../ingress'
import { ulid } from './ids'

export type TokenMode = 'read' | 'write'

/** Prefijo reconocible por los escáneres de secretos. */
export const TOKEN_PREFIX = 'mck_'

/** `last_used_at` se actualiza a lo sumo una vez por minuto: no hace falta una escritura por llamada. */
const TOUCH_EVERY_MS = 60_000

export type ApiTokenRow = {
  id: string
  userId: string
  orgId: string
  ingress: Ingress
  mode: TokenMode
  name: string
  hint: string
  createdAt: number
  lastUsedAt: number | null
  expiresAt: number | null
  revokedAt: number | null
}

type Raw = {
  id: string
  user_id: string
  org_id: string
  ingress: Ingress
  mode: TokenMode
  name: string
  hint: string
  created_at: number
  last_used_at: number | null
  expires_at: number | null
  revoked_at: number | null
}

const COLUMNS =
  'id, user_id, org_id, ingress, mode, name, hint, created_at, last_used_at, expires_at, revoked_at'

const toRow = (r: Raw): ApiTokenRow => ({
  id: r.id,
  userId: r.user_id,
  orgId: r.org_id,
  ingress: r.ingress,
  mode: r.mode,
  name: r.name,
  hint: r.hint,
  createdAt: r.created_at,
  lastUsedAt: r.last_used_at,
  expiresAt: r.expires_at,
  revokedAt: r.revoked_at,
})

/** Crea el token y devuelve el secreto en claro, que no se vuelve a poder leer. */
export function insertApiToken(
  db: Database,
  input: {
    userId: string
    orgId: string
    ingress: Ingress
    mode: TokenMode
    name: string
    expiresAt: number | null
  },
  now: number,
): { row: ApiTokenRow; secret: string } {
  const secret = TOKEN_PREFIX + randomToken(32)
  const id = ulid(now)
  db.query(
    `INSERT INTO api_tokens (id, user_id, org_id, ingress, mode, name, token_sha256, hint, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.userId,
    input.orgId,
    input.ingress,
    input.mode,
    input.name,
    sha256Hex(secret),
    secret.slice(-4),
    now,
    input.expiresAt,
  )
  const row = db
    .query<Raw, [string]>(`SELECT ${COLUMNS} FROM api_tokens WHERE id = ?`)
    .get(id)!
  return { row: toRow(row), secret }
}

/**
 * El token vigente con ese secreto en esa puerta: no revocado ni vencido. La puerta es la de emisión (ADR 0001):
 * un token de la tailnet no sirve en el listener público.
 */
export function findApiToken(
  db: Database,
  secret: string,
  ingress: Ingress,
  now: number,
): ApiTokenRow | null {
  if (!secret.startsWith(TOKEN_PREFIX)) return null
  const row = db
    .query<Raw, [string, string, number]>(
      `SELECT ${COLUMNS} FROM api_tokens
       WHERE token_sha256 = ? AND ingress = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`,
    )
    .get(sha256Hex(secret), ingress, now)
  return row ? toRow(row) : null
}

export function touchApiToken(db: Database, row: ApiTokenRow, now: number) {
  if (row.lastUsedAt !== null && now - row.lastUsedAt < TOUCH_EVERY_MS) return
  db.query('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(
    now,
    row.id,
  )
}

/** Los tokens de un usuario en una org, vigentes o no, los últimos primero. */
export function listApiTokens(
  db: Database,
  userId: string,
  orgId: string,
): ApiTokenRow[] {
  return db
    .query<Raw, [string, string]>(
      `SELECT ${COLUMNS} FROM api_tokens WHERE user_id = ? AND org_id = ? ORDER BY id DESC`,
    )
    .all(userId, orgId)
    .map(toRow)
}

/** Tokens sin revocar ni vencer de un usuario en una org (tope por usuario y org). */
export function countActiveApiTokens(
  db: Database,
  userId: string,
  orgId: string,
  now: number,
): number {
  return db
    .query<{ n: number }, [string, string, number]>(
      `SELECT COUNT(*) AS n FROM api_tokens
       WHERE user_id = ? AND org_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`,
    )
    .get(userId, orgId, now)!.n
}

/** Revoca un token propio; `false` si no existe, no es del usuario o ya estaba revocado. */
export function revokeApiToken(
  db: Database,
  userId: string,
  id: string,
  now: number,
): boolean {
  return (
    db
      .query(
        'UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
      )
      .run(now, id, userId).changes > 0
  )
}
