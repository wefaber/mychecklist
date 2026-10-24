import type { Database } from 'bun:sqlite'
import { ulid } from './ids'

/** Ayudas de los tests que necesitan SQL (solo se permite bajo server/db/). */

export function personalOrgId(db: Database, userId: string): string {
  return db
    .query<{ id: string }, [string]>(
      'SELECT id FROM orgs WHERE personal_for = ?',
    )
    .get(userId)!.id
}

/** Hasta M7 no hay API para crear una org de equipo: los tests la arman a mano. */
export function createTeamOrg(
  db: Database,
  name: string,
  members: { userId: string; role: 'owner' | 'admin' | 'member' }[],
): string {
  const id = ulid()
  db.query(
    "INSERT INTO orgs (id, kind, name, created_at) VALUES (?, 'team', ?, ?)",
  ).run(id, name, Date.now())
  for (const m of members)
    db.query(
      'INSERT INTO org_members (org_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
    ).run(id, m.userId, m.role, Date.now())
  return id
}

export function removeMember(db: Database, orgId: string, userId: string) {
  db.query('DELETE FROM org_members WHERE org_id = ? AND user_id = ?').run(
    orgId,
    userId,
  )
}

/** Mueve el vencimiento de un token (los tests no esperan días reales). */
export function expireToken(db: Database, id: string, at: number) {
  db.query('UPDATE api_tokens SET expires_at = ? WHERE id = ?').run(at, id)
}
