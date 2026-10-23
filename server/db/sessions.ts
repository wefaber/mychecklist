import type { Database } from 'bun:sqlite'
import { randomToken, sha256Hex } from '../auth/crypto'
import type { Ingress } from '../ingress'
import { toUser, USER_COLUMNS, type User } from './accounts'

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** Crea una sesión y devuelve el token en claro (va a la cookie); en la base queda solo su sha256. */
export function createSession(
  db: Database,
  opts: { userId: string; ingress: Ingress; now: number },
): string {
  const token = randomToken()
  db.query('DELETE FROM sessions WHERE expires_at <= ?').run(opts.now)
  db.query(
    'INSERT INTO sessions (id, user_id, ingress, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  ).run(
    sha256Hex(token),
    opts.userId,
    opts.ingress,
    opts.now,
    opts.now + SESSION_TTL_MS,
  )
  return token
}

/** La sesión solo vale en la puerta donde se emitió: una de la tailnet no sirve en el listener público. */
export function findSessionUser(
  db: Database,
  token: string,
  ingress: Ingress,
  now: number,
): User | null {
  const row = db
    .query<
      {
        id: string
        github_id: number
        login: string
        name: string | null
        avatar_url: string | null
      },
      [string, string, number]
    >(
      `SELECT ${USER_COLUMNS}
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.ingress = ? AND s.expires_at > ?`,
    )
    .get(sha256Hex(token), ingress, now)
  return row ? toUser(row) : null
}

export function deleteSession(db: Database, token: string) {
  db.query('DELETE FROM sessions WHERE id = ?').run(sha256Hex(token))
}
