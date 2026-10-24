import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { gql } from '../../lib/graphql'
import type { OrgRole } from '../auth/useViewer'

export type InviteRole = 'admin' | 'member'

export type Member = {
  userId: string
  login: string
  name: string | null
  avatarUrl: string | null
  role: OrgRole
  joinedAt: string
}

export type Invitation = {
  id: string
  orgId: string
  orgName: string
  login: string
  role: InviteRole
  invitedBy: string | null
  createdAt: string
  expiresAt: string
}

const MEMBER = 'userId login name avatarUrl role joinedAt'
const INVITATION = 'id orgId orgName login role invitedBy createdAt expiresAt'

export function useMembers(orgId: string | null) {
  return useQuery({
    queryKey: ['members', orgId ?? ''],
    enabled: orgId !== null,
    queryFn: async () =>
      (
        await gql<{ org: { members: Member[] } }>(
          `query($o: ID!) { org(id: $o) { members { ${MEMBER} } } }`,
          { o: orgId },
        )
      ).org.members,
  })
}

/** Las invitaciones vigentes de la org: solo para quien administra (si no, el servidor da FORBIDDEN). */
export function useOrgInvitations(orgId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['org-invitations', orgId ?? ''],
    enabled: enabled && orgId !== null,
    queryFn: async () =>
      (
        await gql<{ org: { invitations: Invitation[] } }>(
          `query($o: ID!) { org(id: $o) { invitations { ${INVITATION} } } }`,
          { o: orgId },
        )
      ).org.invitations,
  })
}

/** Las invitaciones pendientes a mi login. Vacío fuera de la tailnet. */
export function useMyInvitations(enabled = true) {
  return useQuery({
    queryKey: ['my-invitations'],
    enabled,
    refetchInterval: 60_000,
    queryFn: async () =>
      (
        await gql<{ me: { invitations: Invitation[] } | null }>(
          `{ me { invitations { ${INVITATION} } } }`,
        )
      ).me?.invitations ?? [],
  })
}

/** Cualquier cambio de miembros, roles o invitaciones: se vuelve a pedir todo lo que depende de eso. */
function useRefreshTeam() {
  const client = useQueryClient()
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ['me'] }),
      client.invalidateQueries({ queryKey: ['members'] }),
      client.invalidateQueries({ queryKey: ['org-invitations'] }),
      client.invalidateQueries({ queryKey: ['my-invitations'] }),
    ])
}

export function useCreateTeamOrg() {
  const refresh = useRefreshTeam()
  return useMutation({
    mutationFn: async (name: string) =>
      (
        await gql<{ createTeamOrg: { id: string } }>(
          `mutation($n: String!) { createTeamOrg(name: $n) { id } }`,
          { n: name },
        )
      ).createTeamOrg,
    onSuccess: refresh,
  })
}

export function useInviteMember(orgId: string) {
  const refresh = useRefreshTeam()
  return useMutation({
    mutationFn: async (input: { login: string; role: InviteRole }) =>
      gql(
        `mutation($o: ID!, $l: String!, $r: InviteRole) { inviteMember(orgId: $o, login: $l, role: $r) { id } }`,
        { o: orgId, l: input.login, r: input.role },
      ),
    onSuccess: refresh,
  })
}

export function useRevokeInvitation(orgId: string) {
  const refresh = useRefreshTeam()
  return useMutation({
    mutationFn: async (id: string) =>
      gql(
        `mutation($o: ID!, $i: ID!) { revokeInvitation(orgId: $o, id: $i) }`,
        { o: orgId, i: id },
      ),
    onSuccess: refresh,
  })
}

/** Aceptar devuelve la org a la que se entró; rechazar, `null`. */
export function useAnswerInvitation() {
  const refresh = useRefreshTeam()
  return useMutation({
    mutationFn: async (input: {
      id: string
      accept: boolean
    }): Promise<{ id: string } | null> => {
      if (input.accept)
        return (
          await gql<{ acceptInvitation: { id: string } }>(
            `mutation($i: ID!) { acceptInvitation(id: $i) { id } }`,
            { i: input.id },
          )
        ).acceptInvitation
      await gql(`mutation($i: ID!) { declineInvitation(id: $i) }`, {
        i: input.id,
      })
      return null
    },
    onSuccess: refresh,
  })
}

export function useSetMemberRole(orgId: string) {
  const refresh = useRefreshTeam()
  return useMutation({
    mutationFn: async (input: { userId: string; role: OrgRole }) =>
      gql(
        `mutation($o: ID!, $u: ID!, $r: Role!) { setMemberRole(orgId: $o, userId: $u, role: $r) { userId } }`,
        { o: orgId, u: input.userId, r: input.role },
      ),
    onSuccess: refresh,
  })
}

export function useRemoveMember(orgId: string) {
  const refresh = useRefreshTeam()
  return useMutation({
    mutationFn: async (userId: string) =>
      gql(
        `mutation($o: ID!, $u: ID!) { removeMember(orgId: $o, userId: $u) }`,
        { o: orgId, u: userId },
      ),
    onSuccess: refresh,
  })
}

export function useLeaveOrg(orgId: string) {
  const refresh = useRefreshTeam()
  return useMutation({
    mutationFn: async () =>
      gql(`mutation($o: ID!) { leaveOrg(orgId: $o) }`, { o: orgId }),
    onSuccess: refresh,
  })
}

/** Qué puede hacer cada rol sobre otro miembro (ADR 0009); el servidor vuelve a verificar. */
export function canRemove(myRole: OrgRole, target: OrgRole): boolean {
  return myRole === 'owner' || (myRole === 'admin' && target === 'member')
}
