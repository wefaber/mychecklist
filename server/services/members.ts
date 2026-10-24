import type { Database } from 'bun:sqlite'
import type { OrgSummary, Role } from '../db/accounts'
import {
  countInvitations,
  countMembers,
  countOwnedTeamOrgs,
  countOwners,
  deleteInvitation,
  deleteMember,
  findInvitation,
  getInvitation,
  getMember,
  insertInvitation,
  insertMember,
  insertTeamOrg,
  invitationsFor,
  listInvitations as dbListInvitations,
  listMembers as dbListMembers,
  loginOf,
  setMemberRole as dbSetMemberRole,
  type InvitationRow,
  type InviteRole,
  type MemberRow,
} from '../db/members'
import { openScope, type Scope } from '../db/scoped'
import { revokeApiTokensIn } from '../db/tokens'
import { DomainError } from '../errors'
import type { Caller, Deps } from './types'
import { cleanText, MAX_NAME } from './validate'

export type MemberView = MemberRow
export type InvitationView = InvitationRow

export const MAX_MEMBERS = 50
export const MAX_PENDING_INVITATIONS = 50
export const MAX_OWNED_TEAM_ORGS = 10
export const INVITATION_DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000

/** Reglas de login de GitHub: 1 a 39 caracteres alfanuméricos o guiones, sin guion al borde ni doble guion. */
const LOGIN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i

const via = (c: Caller) => c.via ?? 'web'

const isAdmin = (role: Role) => role === 'owner' || role === 'admin'

/** Todo lo de equipo es de la tailnet (ADR 0009): por el listener público no se crea, invita ni acepta nada. */
function requireTailnet(caller: Caller) {
  if (caller.ingress !== 'tailnet')
    throw new DomainError(
      'FORBIDDEN',
      'Las organizaciones de equipo solo se usan desde la tailnet',
    )
}

/** Abre la org y exige que sea de equipo: la personal no admite miembros. */
function teamScope(db: Database, caller: Caller, orgId: string): Scope {
  const scope = openScope(db, { orgId, ...caller })
  if (scope.org.kind !== 'team')
    throw new DomainError(
      'INVALID_INPUT',
      'La organización personal no admite miembros',
    )
  return scope
}

function changed({ bus }: Pick<Deps, 'bus'>, caller: Caller, orgId: string) {
  bus.publish({ orgId, scope: 'members', actorId: caller.userId })
}

/** Crea una org de equipo; quien la crea queda como `owner`. Solo por la tailnet. */
export function createTeamOrg(
  db: Database,
  caller: Caller,
  input: { name: string },
  now = Date.now(),
): OrgSummary {
  requireTailnet(caller)
  const name = cleanText(input.name, { max: MAX_NAME, label: 'El nombre' })
  if (countOwnedTeamOrgs(db, caller.userId) >= MAX_OWNED_TEAM_ORGS)
    throw new DomainError(
      'LIMIT_REACHED',
      `Podés crear hasta ${MAX_OWNED_TEAM_ORGS} organizaciones de equipo`,
    )
  return db.transaction(() => {
    const org = insertTeamOrg(db, name, caller.userId, now)
    openScope(db, { orgId: org.id, ...caller }).activity.append(
      {
        type: 'org.created',
        entityType: 'org',
        entityId: org.id,
        via: via(caller),
      },
      now,
    )
    return org
  })()
}

/** Miembros de la org, visibles para cualquier miembro. */
export function listMembers(
  db: Database,
  caller: Caller,
  orgId: string,
): MemberView[] {
  openScope(db, { orgId, ...caller })
  return dbListMembers(db, orgId)
}

/** Invitaciones vigentes de la org, para quien administra. */
export function listInvitations(
  db: Database,
  caller: Caller,
  orgId: string,
  now = Date.now(),
): InvitationView[] {
  const scope = openScope(db, { orgId, ...caller })
  if (!isAdmin(scope.role))
    throw new DomainError(
      'FORBIDDEN',
      'Solo quien administra la organización ve las invitaciones',
    )
  return dbListInvitations(db, orgId, now)
}

/** Las invitaciones pendientes de la persona que mira. Por el listener público no existen. */
export function myInvitations(
  db: Database,
  caller: Caller,
  now = Date.now(),
): InvitationView[] {
  if (caller.ingress !== 'tailnet') return []
  const login = loginOf(db, caller.userId)
  return login ? invitationsFor(db, login, now) : []
}

export function inviteMember(
  deps: Deps,
  caller: Caller,
  input: { orgId: string; login: string; role: InviteRole },
  now = Date.now(),
): InvitationView {
  const { db } = deps
  requireTailnet(caller)
  const login = input.login.trim().replace(/^@/, '').toLowerCase()
  if (!LOGIN.test(login))
    throw new DomainError('INVALID_INPUT', 'Ese no es un login de GitHub')
  if (input.role !== 'admin' && input.role !== 'member')
    throw new DomainError('INVALID_INPUT', 'El rol es admin o member')
  const scope = teamScope(db, caller, input.orgId)
  if (!isAdmin(scope.role))
    throw new DomainError('FORBIDDEN', 'Solo quien administra puede invitar')
  if (input.role === 'admin' && scope.role !== 'owner')
    throw new DomainError('FORBIDDEN', 'Solo un owner invita a un admin')
  const existing = dbListMembers(db, input.orgId).find(
    (m) => m.login.toLowerCase() === login,
  )
  if (existing)
    throw new DomainError('CONFLICT', `${existing.login} ya es miembro`)
  if (findInvitation(db, input.orgId, login, now))
    throw new DomainError('CONFLICT', `Ya hay una invitación para ${login}`)
  if (countInvitations(db, input.orgId, now) >= MAX_PENDING_INVITATIONS)
    throw new DomainError(
      'LIMIT_REACHED',
      `Hasta ${MAX_PENDING_INVITATIONS} invitaciones pendientes por organización`,
    )
  const id = db.transaction(() => {
    const made = insertInvitation(
      db,
      {
        orgId: input.orgId,
        login,
        role: input.role,
        invitedBy: caller.userId,
        expiresAt: now + INVITATION_DAYS * DAY_MS,
      },
      now,
    )
    scope.activity.append(
      {
        type: 'member.invited',
        entityType: 'invitation',
        entityId: made,
        via: via(caller),
      },
      now,
    )
    return made
  })()
  changed(deps, caller, input.orgId)
  return getInvitation(db, id, now)!
}

/** Revoca una invitación pendiente. Un admin solo revoca las de `member`. */
export function revokeInvitation(
  deps: Deps,
  caller: Caller,
  input: { orgId: string; id: string },
  now = Date.now(),
): void {
  const { db } = deps
  const scope = teamScope(db, caller, input.orgId)
  if (!isAdmin(scope.role))
    throw new DomainError('FORBIDDEN', 'Solo quien administra revoca')
  const invitation = getInvitation(db, input.id, now)
  if (!invitation || invitation.orgId !== input.orgId)
    throw new DomainError('NOT_FOUND', 'La invitación no existe')
  if (invitation.role === 'admin' && scope.role !== 'owner')
    throw new DomainError('FORBIDDEN', 'Solo un owner revoca la de un admin')
  db.transaction(() => {
    deleteInvitation(db, invitation.id)
    scope.activity.append(
      {
        type: 'member.invite_revoked',
        entityType: 'invitation',
        entityId: invitation.id,
        via: via(caller),
      },
      now,
    )
  })()
  changed(deps, caller, input.orgId)
}

/** La invitación es para quien la pide: mismo login, vigente. Cualquier otro caso es `NOT_FOUND`, no revela nada. */
function mine(
  db: Database,
  caller: Caller,
  id: string,
  now: number,
): InvitationView {
  const invitation = getInvitation(db, id, now)
  if (!invitation || invitation.login !== loginOf(db, caller.userId))
    throw new DomainError('NOT_FOUND', 'La invitación no existe o venció')
  return invitation
}

export function acceptInvitation(
  deps: Deps,
  caller: Caller,
  input: { id: string },
  now = Date.now(),
): OrgSummary {
  const { db } = deps
  requireTailnet(caller)
  const invitation = mine(db, caller, input.id, now)
  if (countMembers(db, invitation.orgId) >= MAX_MEMBERS)
    throw new DomainError(
      'LIMIT_REACHED',
      `Una organización admite hasta ${MAX_MEMBERS} miembros`,
    )
  const org = db.transaction(() => {
    // Si ya era miembro (se sumó por otro lado) la invitación igual se consume.
    if (!getMember(db, invitation.orgId, caller.userId))
      insertMember(db, invitation.orgId, caller.userId, invitation.role, now)
    deleteInvitation(db, invitation.id)
    const scope = openScope(db, { orgId: invitation.orgId, ...caller })
    scope.activity.append(
      {
        type: 'member.joined',
        entityType: 'user',
        entityId: caller.userId,
        via: via(caller),
      },
      now,
    )
    return {
      id: scope.org.id,
      kind: scope.org.kind,
      name: scope.org.name,
      role: scope.role,
    }
  })()
  changed(deps, caller, invitation.orgId)
  return org
}

export function declineInvitation(
  deps: Deps,
  caller: Caller,
  input: { id: string },
  now = Date.now(),
): void {
  const { db } = deps
  requireTailnet(caller)
  const invitation = mine(db, caller, input.id, now)
  deleteInvitation(db, invitation.id)
  changed(deps, caller, invitation.orgId)
}

/** Cambia el rol de un miembro. Solo `owner`; la org nunca se queda sin `owner`. */
export function setMemberRole(
  deps: Deps,
  caller: Caller,
  input: { orgId: string; userId: string; role: Role },
  now = Date.now(),
): MemberView {
  const { db } = deps
  const scope = teamScope(db, caller, input.orgId)
  if (scope.role !== 'owner')
    throw new DomainError('FORBIDDEN', 'Solo un owner cambia roles')
  const target = getMember(db, input.orgId, input.userId)
  if (!target) throw new DomainError('NOT_FOUND', 'No es miembro')
  if (
    target.role === 'owner' &&
    input.role !== 'owner' &&
    countOwners(db, input.orgId) <= 1
  )
    throw new DomainError(
      'CONFLICT',
      'La organización necesita al menos un owner: promové a otro primero',
    )
  if (target.role !== input.role)
    db.transaction(() => {
      dbSetMemberRole(db, input.orgId, input.userId, input.role)
      scope.activity.append(
        {
          type: 'member.role_changed',
          entityType: 'user',
          entityId: input.userId,
          via: via(caller),
        },
        now,
      )
    })()
  changed(deps, caller, input.orgId)
  return getMember(db, input.orgId, input.userId)!
}

/** Saca a un miembro. Un admin solo saca a `member`; nadie se saca a sí mismo (para eso `leaveOrg`). */
export function removeMember(
  deps: Deps,
  caller: Caller,
  input: { orgId: string; userId: string },
  now = Date.now(),
): void {
  const { db } = deps
  const scope = teamScope(db, caller, input.orgId)
  if (!isAdmin(scope.role))
    throw new DomainError('FORBIDDEN', 'Solo quien administra saca miembros')
  if (input.userId === caller.userId)
    throw new DomainError('INVALID_INPUT', 'Para irte usá "Salir"')
  const target = getMember(db, input.orgId, input.userId)
  if (!target) throw new DomainError('NOT_FOUND', 'No es miembro')
  if (target.role !== 'member' && scope.role !== 'owner')
    throw new DomainError(
      'FORBIDDEN',
      'Solo un owner saca a un admin o a otro owner',
    )
  db.transaction(() => {
    scope.activity.append(
      {
        type: 'member.removed',
        entityType: 'user',
        entityId: input.userId,
        via: via(caller),
      },
      now,
    )
    deleteMember(db, input.orgId, input.userId)
    revokeApiTokensIn(db, input.userId, input.orgId, now)
  })()
  changed(deps, caller, input.orgId)
}

/** Salir de una org de equipo. El último `owner` no puede. */
export function leaveOrg(
  deps: Deps,
  caller: Caller,
  input: { orgId: string },
  now = Date.now(),
): void {
  const { db } = deps
  const scope = teamScope(db, caller, input.orgId)
  if (scope.role === 'owner' && countOwners(db, input.orgId) <= 1)
    throw new DomainError(
      'CONFLICT',
      'Sos el único owner: promové a otro antes de irte',
    )
  db.transaction(() => {
    scope.activity.append(
      {
        type: 'member.left',
        entityType: 'user',
        entityId: caller.userId,
        via: via(caller),
      },
      now,
    )
    deleteMember(db, input.orgId, caller.userId)
    revokeApiTokensIn(db, caller.userId, input.orgId, now)
  })()
  changed(deps, caller, input.orgId)
}
