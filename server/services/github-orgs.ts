import type { Database } from 'bun:sqlite'
import type { GithubClient } from '../auth/github'
import {
  countMembers,
  deleteMember,
  detachGithubMembers,
  findOrgByGithubId,
  getMember,
  getOrgLink,
  insertMember,
  listLinkedOrgs,
  setOrgLink,
  setSyncedRole,
  type OrgGithubLink,
} from '../db/members'
import { openScope } from '../db/scoped'
import { revokeApiTokensIn } from '../db/tokens'
import { DomainError } from '../errors'
import type { UserTokens } from '../github/tokens'
import { MAX_MEMBERS } from './members'
import type { Caller, Deps } from './types'

/**
 * Orgs de equipo vinculadas a una org de GitHub (ADR 0011). Quien administra la org de GitHub la vincula una vez; desde
 * ahí, cada login por la tailnet suma, sube, baja o saca a la persona según su membresía en GitHub. Lo invitado a mano
 * (`source = 'manual'`) no se toca.
 */

const via = (c: Caller) => c.via ?? 'web'

/** Reglas de login de GitHub: 1 a 39 caracteres alfanuméricos o guiones, sin guion al borde ni doble guion. */
const LOGIN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i

type Client = Pick<GithubClient, 'fetchOrgMembership'>

/**
 * Ajusta la membresía de `caller` en cada org vinculada según lo que dice GitHub con su token. Devuelve las orgs de
 * checklist que cambiaron. Un fallo de GitHub en una org (límite, 5xx, permisos) la deja como estaba: nunca se saca a
 * nadie por no haber podido preguntar. Solo por la tailnet: las orgs de equipo no existen para el listener público.
 */
export async function syncGithubMemberships(
  db: Database,
  caller: Caller,
  input: { accessToken: string; client: Client },
  now = Date.now(),
): Promise<string[]> {
  if (caller.ingress !== 'tailnet') return []
  const changed: string[] = []
  for (const org of listLinkedOrgs(db)) {
    let membership
    try {
      membership = await input.client.fetchOrgMembership(
        input.accessToken,
        org.login,
      )
    } catch (error) {
      console.error(
        `github org sync skipped for ${org.login}:`,
        error instanceof Error ? error.message : error,
      )
      continue
    }
    // Si el login se reasignó a otra org, el id no coincide: el vínculo es por id, no por nombre.
    if (membership && membership.orgId !== org.githubOrgId) membership = null
    const current = getMember(db, org.orgId, caller.userId)
    const act = (type: string) =>
      openScope(db, { orgId: org.orgId, ...caller }).activity.append(
        {
          type,
          entityType: 'user',
          entityId: caller.userId,
          via: via(caller),
        },
        now,
      )
    if (membership) {
      const role = membership.role
      if (!current) {
        if (countMembers(db, org.orgId) >= MAX_MEMBERS) continue
        db.transaction(() => {
          insertMember(db, org.orgId, caller.userId, role, now, 'github')
          act('member.joined')
        })()
        changed.push(org.orgId)
      } else if (current.source === 'github' && current.role !== role) {
        db.transaction(() => {
          setSyncedRole(db, org.orgId, caller.userId, role)
          act('member.role_changed')
        })()
        changed.push(org.orgId)
      }
    } else if (current?.source === 'github') {
      db.transaction(() => {
        act('member.removed')
        deleteMember(db, org.orgId, caller.userId)
        revokeApiTokensIn(db, caller.userId, org.orgId, now)
      })()
      changed.push(org.orgId)
    }
  }
  return changed
}

type GithubOrgsDeps = Deps & { login: Client | null; tokens: UserTokens }

/** Vincular, desvincular y sincronizar, con el token de GitHub de quien llama. */
export function githubOrgs({ db, bus, login, tokens }: GithubOrgsDeps) {
  async function tokenOf(caller: Caller): Promise<string> {
    const token = await tokens.get(caller.userId)
    if (!login || !token)
      throw new DomainError(
        'INVALID_INPUT',
        'No hay una sesión de GitHub usable: salí y volvé a entrar',
      )
    return token
  }

  const notify = (orgIds: string[], caller: Caller) => {
    for (const orgId of orgIds)
      bus.publish({ orgId, scope: 'members', actorId: caller.userId })
  }

  return {
    /** Vincula una org de equipo con una org de GitHub de la que quien llama es admin. Solo `owner`, solo tailnet. */
    async link(
      caller: Caller,
      input: { orgId: string; login: string },
      now = Date.now(),
    ): Promise<OrgGithubLink> {
      if (caller.ingress !== 'tailnet')
        throw new DomainError(
          'FORBIDDEN',
          'Las organizaciones de equipo solo se usan desde la tailnet',
        )
      const name = input.login.trim().replace(/^@/, '')
      if (!LOGIN.test(name))
        throw new DomainError('INVALID_INPUT', 'Ese no es un login de GitHub')
      const scope = openScope(db, { orgId: input.orgId, ...caller })
      if (scope.org.kind !== 'team')
        throw new DomainError(
          'INVALID_INPUT',
          'La organización personal no se vincula',
        )
      if (scope.role !== 'owner')
        throw new DomainError('FORBIDDEN', 'Solo un owner vincula con GitHub')
      if (getOrgLink(db, input.orgId))
        throw new DomainError(
          'CONFLICT',
          'La organización ya está vinculada: desvinculala primero',
        )
      const token = await tokenOf(caller)
      let membership
      try {
        membership = await login!.fetchOrgMembership(token, name)
      } catch {
        throw new DomainError(
          'INVALID_INPUT',
          'GitHub no respondió: probá de nuevo en un rato',
        )
      }
      // Sin ser admin de esa org no se la puede reclamar; el 404 también cubre "la App no está instalada ahí".
      if (!membership || membership.role !== 'admin')
        throw new DomainError(
          'INVALID_INPUT',
          `Tenés que ser admin de ${name} en GitHub, con la GitHub App instalada en esa org`,
        )
      if (findOrgByGithubId(db, membership.orgId))
        throw new DomainError(
          'CONFLICT',
          `${membership.login} ya está vinculada a otra organización`,
        )
      const link = { githubOrgId: membership.orgId, login: membership.login }
      db.transaction(() => {
        setOrgLink(db, input.orgId, link)
        scope.activity.append(
          {
            type: 'org.github_linked',
            entityType: 'org',
            entityId: input.orgId,
            via: via(caller),
          },
          now,
        )
      })()
      notify([input.orgId], caller)
      return link
    },

    /** Desvincula: quienes entraron por GitHub conservan el acceso como miembros normales. Solo `owner`. */
    unlink(caller: Caller, input: { orgId: string }, now = Date.now()): void {
      const scope = openScope(db, { orgId: input.orgId, ...caller })
      if (scope.role !== 'owner')
        throw new DomainError('FORBIDDEN', 'Solo un owner desvincula de GitHub')
      if (!getOrgLink(db, input.orgId))
        throw new DomainError('NOT_FOUND', 'La organización no está vinculada')
      db.transaction(() => {
        detachGithubMembers(db, input.orgId)
        setOrgLink(db, input.orgId, null)
        scope.activity.append(
          {
            type: 'org.github_unlinked',
            entityType: 'org',
            entityId: input.orgId,
            via: via(caller),
          },
          now,
        )
      })()
      notify([input.orgId], caller)
    },

    /** Vuelve a leer en GitHub la membresía de quien llama (el botón "Sincronizar"). */
    async sync(caller: Caller, now = Date.now()): Promise<string[]> {
      if (caller.ingress !== 'tailnet') return []
      const accessToken = await tokenOf(caller)
      const changed = await syncGithubMemberships(
        db,
        caller,
        { accessToken, client: login! },
        now,
      )
      notify(changed, caller)
      return changed
    },
  }
}

export type GithubOrgs = ReturnType<typeof githubOrgs>

/** Vínculo de la org para mostrar; cualquier miembro lo ve. */
export function orgGithubLink(
  db: Database,
  caller: Caller,
  orgId: string,
): OrgGithubLink | null {
  openScope(db, { orgId, ...caller })
  return getOrgLink(db, orgId)
}
