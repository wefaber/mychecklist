import type { Database } from 'bun:sqlite'
import { DomainError } from '../errors'
import type { Ingress } from '../ingress'
import { ulid } from './ids'
import type { OrgKind, Role } from './accounts'

export type Via = 'web' | 'mcp' | 'import' | 'job'

export type ActivityEntry = {
  id: string
  actorId: string | null
  type: string
  entityType: string | null
  entityId: string | null
  via: Via
  at: number
}

export type NewActivity = {
  type: string
  entityType?: string
  entityId?: string
  via: Via
}

/** Todo el acceso a datos de una org pasa por acá, ya con el `org_id` fijado y la puerta verificada. */
export type Scope = {
  org: { id: string; kind: OrgKind; name: string }
  role: Role
  activity: {
    append(entry: NewActivity, now?: number): ActivityEntry
    list(limit: number): ActivityEntry[]
  }
}

type ActivityRow = {
  id: string
  actor_id: string | null
  type: string
  entity_type: string | null
  entity_id: string | null
  via: Via
  at: number
}

const toEntry = (r: ActivityRow): ActivityEntry => ({
  id: r.id,
  actorId: r.actor_id,
  type: r.type,
  entityType: r.entity_type,
  entityId: r.entity_id,
  via: r.via,
  at: r.at,
})

/**
 * Abre el scope de una org para un usuario por una puerta. Lanza `FORBIDDEN` si la org no existe, si el usuario no es
 * miembro o si es una org `team` pedida por el listener público (ADR 0001). Todos los casos dan el mismo código: no
 * se revela qué ids existen.
 */
export function openScope(
  db: Database,
  opts: { orgId: string; userId: string; ingress: Ingress },
): Scope {
  const org = db
    .query<{ id: string; kind: OrgKind; name: string }, [string]>(
      'SELECT id, kind, name FROM orgs WHERE id = ?',
    )
    .get(opts.orgId)
  const member = org
    ? db
        .query<{ role: Role }, [string, string]>(
          'SELECT role FROM org_members WHERE org_id = ? AND user_id = ?',
        )
        .get(org.id, opts.userId)
    : null
  if (!org || !member || (org.kind === 'team' && opts.ingress !== 'tailnet'))
    throw new DomainError('FORBIDDEN', 'Sin acceso a esta organización')

  const orgId = org.id
  return {
    org,
    role: member.role,
    activity: {
      append(entry, now = Date.now()) {
        const row: ActivityRow = {
          id: ulid(now),
          actor_id: opts.userId,
          type: entry.type,
          entity_type: entry.entityType ?? null,
          entity_id: entry.entityId ?? null,
          via: entry.via,
          at: now,
        }
        db.query(
          'INSERT INTO activity (id, org_id, actor_id, type, entity_type, entity_id, via, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(
          row.id,
          orgId,
          row.actor_id,
          row.type,
          row.entity_type,
          row.entity_id,
          row.via,
          row.at,
        )
        return toEntry(row)
      },
      list(limit) {
        return db
          .query<ActivityRow, [string, number]>(
            'SELECT id, actor_id, type, entity_type, entity_id, via, at FROM activity WHERE org_id = ? ORDER BY id DESC LIMIT ?',
          )
          .all(orgId, limit)
          .map(toEntry)
      },
    },
  }
}
