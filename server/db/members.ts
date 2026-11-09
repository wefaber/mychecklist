import type { Database } from 'bun:sqlite'
import { ulid } from './ids'
import type { OrgSummary, Role } from './accounts'

/**
 * Miembros e invitaciones de una org (M7, ADR 0009). `org_members` y `org_invitations` no son tablas "con dueño" de
 * `scoped.ts`: la persona invitada todavía no es miembro y se la busca por login. Los servicios abren `openScope`
 * (membresía y puerta) antes de llamar a cualquiera de estas funciones.
 */

export type InviteRole = 'admin' | 'member'

/** `github`: entró por el vínculo con una org de GitHub y el sync lo mantiene; `manual`: invitado o creador. */
export type MemberSource = 'manual' | 'github'

export type MemberRow = {
  userId: string
  login: string
  name: string | null
  avatarUrl: string | null
  role: Role
  source: MemberSource
  joinedAt: number
}

export type InvitationRow = {
  id: string
  orgId: string
  orgName: string
  login: string
  role: InviteRole
  /** Login de quien invitó, si todavía existe. */
  invitedBy: string | null
  createdAt: number
  expiresAt: number
}

type MemberSql = {
  user_id: string
  login: string
  name: string | null
  avatar_url: string | null
  role: Role
  source: MemberSource
  created_at: number
}

const toMember = (r: MemberSql): MemberRow => ({
  userId: r.user_id,
  login: r.login,
  name: r.name,
  avatarUrl: r.avatar_url,
  role: r.role,
  source: r.source,
  joinedAt: r.created_at,
})

type InvitationSql = {
  id: string
  org_id: string
  org_name: string
  login: string
  role: InviteRole
  invited_by: string | null
  created_at: number
  expires_at: number
}

const toInvitation = (r: InvitationSql): InvitationRow => ({
  id: r.id,
  orgId: r.org_id,
  orgName: r.org_name,
  login: r.login,
  role: r.role,
  invitedBy: r.invited_by,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
})

const INVITATION_SELECT = `SELECT i.id, i.org_id, o.name AS org_name, i.login, i.role, u.login AS invited_by,
  i.created_at, i.expires_at
  FROM org_invitations i JOIN orgs o ON o.id = i.org_id LEFT JOIN users u ON u.id = i.invited_by`

/** Crea una org de equipo con `ownerId` como único miembro (`owner`). */
export function insertTeamOrg(
  db: Database,
  name: string,
  ownerId: string,
  now: number,
): OrgSummary {
  const id = ulid(now)
  db.query(
    "INSERT INTO orgs (id, kind, name, created_at) VALUES (?, 'team', ?, ?)",
  ).run(id, name, now)
  db.query(
    "INSERT INTO org_members (org_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)",
  ).run(id, ownerId, now)
  return { id, kind: 'team', name, role: 'owner' }
}

/** Orgs de equipo donde la persona es `owner` (tope por creadora). */
export function countOwnedTeamOrgs(db: Database, userId: string): number {
  return db
    .query<{ n: number }, [string]>(
      `SELECT COUNT(*) AS n FROM org_members m JOIN orgs o ON o.id = m.org_id
       WHERE m.user_id = ? AND m.role = 'owner' AND o.kind = 'team'`,
    )
    .get(userId)!.n
}

/** Dueños primero, después admins y miembros; dentro de cada rol por login. */
export function listMembers(db: Database, orgId: string): MemberRow[] {
  return db
    .query<MemberSql, [string]>(
      `SELECT m.user_id, u.login, u.name, u.avatar_url, m.role, m.source, m.created_at
       FROM org_members m JOIN users u ON u.id = m.user_id
       WHERE m.org_id = ?
       ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.login`,
    )
    .all(orgId)
    .map(toMember)
}

export function getMember(
  db: Database,
  orgId: string,
  userId: string,
): MemberRow | null {
  const row = db
    .query<MemberSql, [string, string]>(
      `SELECT m.user_id, u.login, u.name, u.avatar_url, m.role, m.source, m.created_at
       FROM org_members m JOIN users u ON u.id = m.user_id
       WHERE m.org_id = ? AND m.user_id = ?`,
    )
    .get(orgId, userId)
  return row ? toMember(row) : null
}

export function countMembers(db: Database, orgId: string): number {
  return db
    .query<{ n: number }, [string]>(
      'SELECT COUNT(*) AS n FROM org_members WHERE org_id = ?',
    )
    .get(orgId)!.n
}

export function countOwners(db: Database, orgId: string): number {
  return db
    .query<{ n: number }, [string]>(
      "SELECT COUNT(*) AS n FROM org_members WHERE org_id = ? AND role = 'owner'",
    )
    .get(orgId)!.n
}

export function insertMember(
  db: Database,
  orgId: string,
  userId: string,
  role: Role,
  now: number,
  source: MemberSource = 'manual',
) {
  db.query(
    'INSERT INTO org_members (org_id, user_id, role, source, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(orgId, userId, role, source, now)
}

/** Cambio de rol hecho por una persona: desde ahí el sync de GitHub no lo vuelve a tocar (`source = 'manual'`). */
export function setMemberRole(
  db: Database,
  orgId: string,
  userId: string,
  role: Role,
) {
  db.query(
    "UPDATE org_members SET role = ?, source = 'manual' WHERE org_id = ? AND user_id = ?",
  ).run(role, orgId, userId)
}

/** Rol que viene de GitHub: conserva `source = 'github'`. */
export function setSyncedRole(
  db: Database,
  orgId: string,
  userId: string,
  role: Role,
) {
  db.query(
    'UPDATE org_members SET role = ? WHERE org_id = ? AND user_id = ?',
  ).run(role, orgId, userId)
}

export function deleteMember(db: Database, orgId: string, userId: string) {
  db.query('DELETE FROM org_members WHERE org_id = ? AND user_id = ?').run(
    orgId,
    userId,
  )
}

/** Login actual de la persona (el de su última sesión), en minúsculas. */
export function loginOf(db: Database, userId: string): string | null {
  const row = db
    .query<{ login: string }, [string]>('SELECT login FROM users WHERE id = ?')
    .get(userId)
  return row ? row.login.toLowerCase() : null
}

/** Invitaciones vigentes de una org, las últimas primero. */
export function listInvitations(
  db: Database,
  orgId: string,
  now: number,
): InvitationRow[] {
  return db
    .query<InvitationSql, [string, number]>(
      `${INVITATION_SELECT} WHERE i.org_id = ? AND i.expires_at > ? ORDER BY i.id DESC`,
    )
    .all(orgId, now)
    .map(toInvitation)
}

export function countInvitations(
  db: Database,
  orgId: string,
  now: number,
): number {
  return db
    .query<{ n: number }, [string, number]>(
      'SELECT COUNT(*) AS n FROM org_invitations WHERE org_id = ? AND expires_at > ?',
    )
    .get(orgId, now)!.n
}

/** Invitaciones vigentes dirigidas a un login (en minúsculas). */
export function invitationsFor(
  db: Database,
  login: string,
  now: number,
): InvitationRow[] {
  return db
    .query<InvitationSql, [string, number]>(
      `${INVITATION_SELECT} WHERE i.login = ? AND i.expires_at > ? ORDER BY i.id DESC`,
    )
    .all(login, now)
    .map(toInvitation)
}

export function getInvitation(
  db: Database,
  id: string,
  now: number,
): InvitationRow | null {
  const row = db
    .query<InvitationSql, [string, number]>(
      `${INVITATION_SELECT} WHERE i.id = ? AND i.expires_at > ?`,
    )
    .get(id, now)
  return row ? toInvitation(row) : null
}

/** Una por `(org, login)`: una vencida se reemplaza, una vigente la rechaza el servicio antes de llegar acá. */
export function insertInvitation(
  db: Database,
  input: {
    orgId: string
    login: string
    role: InviteRole
    invitedBy: string
    expiresAt: number
  },
  now: number,
): string {
  const id = ulid(now)
  db.query('DELETE FROM org_invitations WHERE org_id = ? AND login = ?').run(
    input.orgId,
    input.login,
  )
  db.query(
    'INSERT INTO org_invitations (id, org_id, login, role, invited_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    id,
    input.orgId,
    input.login,
    input.role,
    input.invitedBy,
    now,
    input.expiresAt,
  )
  return id
}

export function deleteInvitation(db: Database, id: string) {
  db.query('DELETE FROM org_invitations WHERE id = ?').run(id)
}

/** Invitación vigente de ese login en esa org, si hay. */
export function findInvitation(
  db: Database,
  orgId: string,
  login: string,
  now: number,
): InvitationRow | null {
  const row = db
    .query<InvitationSql, [string, string, number]>(
      `${INVITATION_SELECT} WHERE i.org_id = ? AND i.login = ? AND i.expires_at > ?`,
    )
    .get(orgId, login, now)
  return row ? toInvitation(row) : null
}

/** Vínculo de una org con una org de GitHub, si lo tiene. */
export type OrgGithubLink = { githubOrgId: number; login: string }

export function getOrgLink(db: Database, orgId: string): OrgGithubLink | null {
  const row = db
    .query<
      { github_org_id: number | null; github_org_login: string },
      [string]
    >('SELECT github_org_id, github_org_login FROM orgs WHERE id = ?')
    .get(orgId)
  return row?.github_org_id != null
    ? { githubOrgId: row.github_org_id, login: row.github_org_login }
    : null
}

/** Todas las orgs de equipo vinculadas: pocas, y el sync las recorre en cada login. */
export function listLinkedOrgs(
  db: Database,
): { orgId: string; githubOrgId: number; login: string }[] {
  return db
    .query<{ id: string; github_org_id: number; github_org_login: string }, []>(
      "SELECT id, github_org_id, github_org_login FROM orgs WHERE kind = 'team' AND github_org_id IS NOT NULL ORDER BY id",
    )
    .all()
    .map((r) => ({
      orgId: r.id,
      githubOrgId: r.github_org_id,
      login: r.github_org_login,
    }))
}

/** Id de la org de checklist que ya tiene vinculada esa org de GitHub, si hay. */
export function findOrgByGithubId(
  db: Database,
  githubOrgId: number,
): string | null {
  return (
    db
      .query<{ id: string }, [number]>(
        'SELECT id FROM orgs WHERE github_org_id = ?',
      )
      .get(githubOrgId)?.id ?? null
  )
}

export function setOrgLink(
  db: Database,
  orgId: string,
  link: OrgGithubLink | null,
) {
  db.query(
    'UPDATE orgs SET github_org_id = ?, github_org_login = ? WHERE id = ?',
  ).run(link?.githubOrgId ?? null, link?.login ?? null, orgId)
}

/** Al desvincular, quienes entraron por GitHub conservan el acceso: pasan a `manual`. */
export function detachGithubMembers(db: Database, orgId: string) {
  db.query(
    "UPDATE org_members SET source = 'manual' WHERE org_id = ? AND source = 'github'",
  ).run(orgId)
}
