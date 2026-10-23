import type { Database } from 'bun:sqlite'
import { openScope, type ActivityEntry } from '../db/scoped'
import type { OrgKind, Role } from '../db/accounts'
import type { Caller } from './types'

export type OrgView = { id: string; kind: OrgKind; name: string; role: Role }

const MAX_PAGE = 100

export function getOrg(db: Database, caller: Caller, orgId: string): OrgView {
  const scope = openScope(db, { orgId, ...caller })
  return { ...scope.org, role: scope.role }
}

export function listActivity(
  db: Database,
  caller: Caller,
  orgId: string,
  first: number,
): ActivityEntry[] {
  const limit = Math.min(Math.max(Math.trunc(first), 1), MAX_PAGE)
  return openScope(db, { orgId, ...caller }).activity.list(limit)
}
