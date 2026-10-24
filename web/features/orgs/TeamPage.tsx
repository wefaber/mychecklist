import { Button, EmptyState, Tile } from '@wefaber/ui'
import {
  Check,
  LogOut,
  MailPlus,
  Plus,
  Trash2,
  UserMinus,
  X,
} from 'lucide-react'
import { useId, useState } from 'react'
import { TextField } from '../../components/TextField'
import { t } from '../../i18n'
import type { MessageKey } from '../../i18n/es'
import { GraphQLRequestError } from '../../lib/graphql'
import { useToast } from '../../lib/toast'
import { useViewer, type OrgRole } from '../auth/useViewer'
import {
  canRemove,
  useAnswerInvitation,
  useCreateTeamOrg,
  useInviteMember,
  useLeaveOrg,
  useMembers,
  useMyInvitations,
  useOrgInvitations,
  useRemoveMember,
  useRevokeInvitation,
  useSetMemberRole,
  type InviteRole,
  type Invitation,
  type Member,
} from './api'

const ROLES: OrgRole[] = ['owner', 'admin', 'member']

const field =
  'h-8 rounded-control bg-text/8 px-2 text-body text-text focus-visible:outline-2 focus-visible:outline-accent'

const date = (iso: string) =>
  new Date(iso).toLocaleDateString('es-UY', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

const roleLabel = (role: OrgRole) => t(`team.role.${role}` as MessageKey)

/**
 * Los mensajes de dominio del servidor ya vienen en español y dicen qué regla chocó (ya es miembro, único dueño,
 * tope de miembros); para lo demás se usa el texto genérico.
 */
function failure(error: unknown): string {
  if (
    error instanceof GraphQLRequestError &&
    (error.code === 'CONFLICT' ||
      error.code === 'LIMIT_REACHED' ||
      error.code === 'INVALID_INPUT' ||
      error.code === 'FORBIDDEN')
  )
    return error.message
  return t('team.fallback')
}

/** Equipo (M7, ADR 0009): crear una org de equipo, invitaciones, miembros y roles. */
export function TeamPage() {
  const { org, ingress } = useViewer()
  const mine = useMyInvitations(ingress === 'tailnet')

  return (
    <div className="flex flex-col gap-4 pt-4">
      <h1 className="font-display text-h2">{t('team.title')}</h1>
      <p className="max-w-prose text-body text-muted">{t('team.intro')}</p>

      {ingress !== 'tailnet' ? (
        <EmptyState>{t('team.publicOnly')}</EmptyState>
      ) : (
        <>
          {mine.data?.length ? <MyInvitations invitations={mine.data} /> : null}
          <CreateTeam />
          {org?.kind === 'team' ? (
            <TeamOrg orgId={org.id} orgName={org.name} role={org.role} />
          ) : (
            <EmptyState>{t('team.noOrg')}</EmptyState>
          )}
        </>
      )}
    </div>
  )
}

function MyInvitations({ invitations }: { invitations: Invitation[] }) {
  const answer = useAnswerInvitation()
  const { setOrg } = useViewer()
  const show = useToast((s) => s.show)
  const respond = async (inv: Invitation, accept: boolean) => {
    try {
      const joined = await answer.mutateAsync({ id: inv.id, accept })
      if (joined) setOrg(joined.id)
      show({
        kind: 'info',
        text: accept
          ? t('team.accepted', { org: inv.orgName })
          : t('team.declined'),
      })
    } catch (error) {
      show({ kind: 'error', text: failure(error) })
    }
  }
  return (
    <Tile title={t('team.invitesForYou')}>
      <ul className="flex flex-col gap-2">
        {invitations.map((inv) => (
          <li
            key={inv.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card bg-surface-2 px-3 py-2"
          >
            <span className="text-body">
              {inv.invitedBy
                ? t('team.invitedAs', {
                    by: inv.invitedBy,
                    org: inv.orgName,
                    role: roleLabel(inv.role),
                  })
                : t('team.invitedAnon', {
                    org: inv.orgName,
                    role: roleLabel(inv.role),
                  })}
            </span>
            <span className="ml-auto flex gap-2">
              <Button
                variant="primary"
                disabled={answer.isPending}
                aria-label={t('team.acceptAria', { org: inv.orgName })}
                onClick={() => void respond(inv, true)}
              >
                <Check aria-hidden size={14} />
                {t('team.accept')}
              </Button>
              <Button
                disabled={answer.isPending}
                aria-label={t('team.declineAria', { org: inv.orgName })}
                onClick={() => void respond(inv, false)}
              >
                <X aria-hidden size={14} />
                {t('team.decline')}
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </Tile>
  )
}

function CreateTeam() {
  const create = useCreateTeamOrg()
  const { setOrg } = useViewer()
  const show = useToast((s) => s.show)
  const [name, setName] = useState('')
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const value = name.trim()
    if (!value) return
    try {
      const made = await create.mutateAsync(value)
      setOrg(made.id)
      setName('')
      show({ kind: 'info', text: t('team.created', { name: value }) })
    } catch (error) {
      show({ kind: 'error', text: failure(error) })
    }
  }
  return (
    <Tile title={t('team.createTitle')}>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-meta text-muted">
          {t('team.nameLabel')}
          <TextField
            value={name}
            maxLength={80}
            autoComplete="off"
            placeholder={t('team.namePlaceholder')}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <Button
          type="submit"
          variant="primary"
          disabled={!name.trim() || create.isPending}
        >
          <Plus aria-hidden size={14} />
          {t('team.create')}
        </Button>
      </form>
    </Tile>
  )
}

function TeamOrg({
  orgId,
  orgName,
  role,
}: {
  orgId: string
  orgName: string
  role: OrgRole
}) {
  const admin = role === 'owner' || role === 'admin'
  return (
    <>
      <Members orgId={orgId} orgName={orgName} role={role} />
      {admin ? <Invite orgId={orgId} role={role} /> : null}
      {admin ? <Pending orgId={orgId} role={role} /> : null}
    </>
  )
}

function Members({
  orgId,
  orgName,
  role,
}: {
  orgId: string
  orgName: string
  role: OrgRole
}) {
  const members = useMembers(orgId)
  const setRole = useSetMemberRole(orgId)
  const remove = useRemoveMember(orgId)
  const leave = useLeaveOrg(orgId)
  const { viewer } = useViewer()
  const show = useToast((s) => s.show)
  const fail = (error: unknown) => show({ kind: 'error', text: failure(error) })

  return (
    <Tile title={t('team.members', { org: orgName })}>
      {members.isPending ? (
        <p role="status" className="text-meta text-muted">
          {t('team.loading')}
        </p>
      ) : members.isError ? (
        <p role="alert" className="text-body text-danger">
          {t('team.failed')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {members.data.map((m) => (
            <MemberRow
              key={m.userId}
              member={m}
              me={m.login === viewer?.login}
              myRole={role}
              busy={setRole.isPending || remove.isPending}
              onRole={async (next) => {
                try {
                  await setRole.mutateAsync({ userId: m.userId, role: next })
                  show({
                    kind: 'info',
                    text: t('team.roleChanged', { login: m.login }),
                  })
                } catch (error) {
                  fail(error)
                }
              }}
              onRemove={async () => {
                try {
                  await remove.mutateAsync(m.userId)
                  show({
                    kind: 'info',
                    text: t('team.removed', { login: m.login }),
                  })
                } catch (error) {
                  fail(error)
                }
              }}
            />
          ))}
        </ul>
      )}
      <div className="mt-3">
        <Button
          disabled={leave.isPending}
          onClick={async () => {
            try {
              await leave.mutateAsync()
              show({ kind: 'info', text: t('team.left', { org: orgName }) })
            } catch (error) {
              fail(error)
            }
          }}
        >
          <LogOut aria-hidden size={14} />
          {t('team.leave')}
        </Button>
      </div>
    </Tile>
  )
}

function MemberRow({
  member,
  me,
  myRole,
  busy,
  onRole,
  onRemove,
}: {
  member: Member
  me: boolean
  myRole: OrgRole
  busy: boolean
  onRole: (role: OrgRole) => void
  onRemove: () => void
}) {
  const roleId = useId()
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-card bg-surface-2 px-3 py-2">
      {member.avatarUrl ? (
        <img src={member.avatarUrl} alt="" className="size-6 rounded-full" />
      ) : null}
      <span className="text-body font-medium">
        {member.name ?? member.login}
      </span>
      <span className="font-mono text-meta text-muted">@{member.login}</span>
      {me ? (
        <span className="text-meta text-muted">{t('team.you')}</span>
      ) : null}
      <span className="text-meta text-muted">
        {t('team.joinedOn', { date: date(member.joinedAt) })}
      </span>
      <span className="ml-auto flex items-center gap-2">
        {myRole === 'owner' ? (
          <>
            <label htmlFor={roleId} className="sr-only">
              {t('team.roleOf', { login: member.login })}
            </label>
            <select
              id={roleId}
              className={field}
              value={member.role}
              disabled={busy}
              onChange={(e) => onRole(e.target.value as OrgRole)}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
          </>
        ) : (
          <span className="text-meta">{roleLabel(member.role)}</span>
        )}
        {!me && canRemove(myRole, member.role) ? (
          <Button
            disabled={busy}
            aria-label={t('team.removeAria', { login: member.login })}
            onClick={onRemove}
          >
            <UserMinus aria-hidden size={14} />
            {t('team.remove')}
          </Button>
        ) : null}
      </span>
    </li>
  )
}

function Invite({ orgId, role }: { orgId: string; role: OrgRole }) {
  const invite = useInviteMember(orgId)
  const show = useToast((s) => s.show)
  const [login, setLogin] = useState('')
  const [inviteRole, setInviteRole] = useState<InviteRole>('member')
  const roleId = useId()
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const value = login.trim().replace(/^@/, '')
    if (!value) return
    try {
      await invite.mutateAsync({
        login: value,
        // Un admin solo invita members: el servidor lo exige igual.
        role: role === 'owner' ? inviteRole : 'member',
      })
      setLogin('')
      show({ kind: 'info', text: t('team.invited', { login: value }) })
    } catch (error) {
      show({ kind: 'error', text: failure(error) })
    }
  }
  return (
    <Tile title={t('team.inviteTitle')}>
      <p className="mb-3 max-w-prose text-meta text-muted">
        {t('team.inviteHelp')}
      </p>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-meta text-muted">
          {t('team.inviteLogin')}
          <TextField
            value={login}
            maxLength={40}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={t('team.inviteLoginPlaceholder')}
            onChange={(e) => setLogin(e.target.value)}
          />
        </label>
        {role === 'owner' ? (
          <div className="flex flex-col gap-1">
            <label htmlFor={roleId} className="text-meta text-muted">
              {t('team.inviteRole')}
            </label>
            <select
              id={roleId}
              className={field}
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as InviteRole)}
            >
              <option value="member">{roleLabel('member')}</option>
              <option value="admin">{roleLabel('admin')}</option>
            </select>
          </div>
        ) : null}
        <Button
          type="submit"
          variant="primary"
          disabled={!login.trim() || invite.isPending}
        >
          <MailPlus aria-hidden size={14} />
          {t('team.invite')}
        </Button>
      </form>
    </Tile>
  )
}

function Pending({ orgId, role }: { orgId: string; role: OrgRole }) {
  const invitations = useOrgInvitations(orgId, true)
  const revoke = useRevokeInvitation(orgId)
  const show = useToast((s) => s.show)
  return (
    <Tile title={t('team.pendingTitle')}>
      {invitations.isPending ? (
        <p role="status" className="text-meta text-muted">
          {t('team.loading')}
        </p>
      ) : invitations.isError ? (
        <p role="alert" className="text-body text-danger">
          {t('team.failed')}
        </p>
      ) : invitations.data.length === 0 ? (
        <EmptyState>{t('team.pendingNone')}</EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {invitations.data.map((inv) => (
            <li
              key={inv.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-card bg-surface-2 px-3 py-2"
            >
              <span className="text-body font-medium">@{inv.login}</span>
              <span className="text-meta">{roleLabel(inv.role)}</span>
              <span className="text-meta text-muted">
                {t('team.expiresOn', { date: date(inv.expiresAt) })}
              </span>
              {inv.role === 'admin' && role !== 'owner' ? null : (
                <Button
                  className="ml-auto"
                  disabled={revoke.isPending}
                  aria-label={t('team.revokeAria', { login: inv.login })}
                  onClick={async () => {
                    try {
                      await revoke.mutateAsync(inv.id)
                      show({
                        kind: 'info',
                        text: t('team.revoked', { login: inv.login }),
                      })
                    } catch (error) {
                      show({ kind: 'error', text: failure(error) })
                    }
                  }}
                >
                  <Trash2 aria-hidden size={14} />
                  {t('team.revoke')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Tile>
  )
}
