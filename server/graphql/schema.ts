import type { Database } from 'bun:sqlite'
import SchemaBuilder from '@pothos/core'
import type { OrgSummary, User } from '../db/accounts'
import type { ActivityEntry, SearchHit } from '../db/scoped'
import { DomainError } from '../errors'
import type { Bus } from '../events'
import type { Ingress } from '../ingress'
import { listOrgs } from '../services/accounts'
import type { GithubLinks, GithubLinkView } from '../services/github'
import {
  createItem,
  deleteItem,
  getItem,
  listBacklinks,
  listItems,
  moveItem,
  restoreItem,
  searchItems,
  setItemDone,
  updateItemText,
  type ItemView,
  type Mention,
} from '../services/items'
import {
  createList,
  deleteList,
  getList,
  listLists,
  moveList,
  renameList,
  restoreList,
  type ListView,
} from '../services/lists'
import {
  acceptInvitation,
  createTeamOrg,
  declineInvitation,
  inviteMember,
  leaveOrg,
  listInvitations,
  listMembers,
  myInvitations,
  removeMember,
  revokeInvitation,
  setMemberRole,
  type InvitationView,
  type MemberView,
} from '../services/members'
import { getOrg, listActivity } from '../services/orgs'
import {
  createApiToken,
  listTokens,
  revokeToken,
  type TokenView,
} from '../services/tokens'
import type { Caller } from '../services/types'

export type Context = {
  db: Database
  bus: Bus
  ingress: Ingress
  /** Usuario de la sesión de esta puerta, o `null`. */
  viewer: User | null
  /** Hay credenciales de GitHub y clave de cifrado: el login puede completarse. */
  loginAvailable: boolean
  /** Resuelve links a issues y PRs de GitHub (M4, ADR 0006). */
  githubLinks: GithubLinks
}

function caller(ctx: Context): Caller {
  if (!ctx.viewer)
    throw new DomainError('UNAUTHENTICATED', 'Hay que iniciar sesión')
  return { userId: ctx.viewer.id, ingress: ctx.ingress, via: 'web' }
}

const iso = (ms: number | null) =>
  ms === null ? null : new Date(ms).toISOString()

/** Code-first schema. M1: identidad y organizaciones. M2: listas e items. M3: menciones y backlinks entre items. */
export function buildSchema() {
  const builder = new SchemaBuilder<{ Context: Context }>({})

  const OrgKind = builder.enumType('OrgKind', {
    values: ['personal', 'team'] as const,
  })
  const Role = builder.enumType('Role', {
    values: ['owner', 'admin', 'member'] as const,
  })

  const InviteRole = builder.enumType('InviteRole', {
    values: ['admin', 'member'] as const,
  })
  const IngressEnum = builder.enumType('Ingress', {
    description:
      'Por qué puerta entró la request: `tailnet` es la única que ve las organizaciones de equipo.',
    values: ['public', 'tailnet'] as const,
  })

  const MemberRef = builder.objectRef<MemberView>('Member')
  MemberRef.implement({
    fields: (t) => ({
      userId: t.exposeID('userId'),
      login: t.exposeString('login'),
      name: t.exposeString('name', { nullable: true }),
      avatarUrl: t.exposeString('avatarUrl', { nullable: true }),
      role: t.field({ type: Role, resolve: (m) => m.role }),
      joinedAt: t.string({ resolve: (m) => iso(m.joinedAt)! }),
    }),
  })

  const InvitationRef = builder.objectRef<InvitationView>('Invitation')
  InvitationRef.implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      orgId: t.exposeID('orgId'),
      orgName: t.exposeString('orgName'),
      login: t.exposeString('login'),
      role: t.field({ type: InviteRole, resolve: (i) => i.role }),
      invitedBy: t.exposeString('invitedBy', { nullable: true }),
      createdAt: t.string({ resolve: (i) => iso(i.createdAt)! }),
      expiresAt: t.string({ resolve: (i) => iso(i.expiresAt)! }),
    }),
  })

  const ActivityRef = builder.objectRef<ActivityEntry>('Activity')
  ActivityRef.implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      type: t.exposeString('type'),
      entityType: t.exposeString('entityType', { nullable: true }),
      entityId: t.exposeString('entityId', { nullable: true }),
      via: t.exposeString('via'),
      at: t.string({ resolve: (a) => new Date(a.at).toISOString() }),
    }),
  })

  const TokenMode = builder.enumType('TokenMode', {
    description: '`read` solo ve las operaciones de lectura; `write` ve todas.',
    values: ['read', 'write'] as const,
  })
  const TokenExpiry = builder.enumType('TokenExpiry', {
    values: {
      DAYS_30: { value: 30 },
      DAYS_90: { value: 90 },
      DAYS_365: { value: 365 },
      NEVER: { value: 0 },
    } as const,
  })

  const ApiTokenRef = builder.objectRef<TokenView>('ApiToken')
  ApiTokenRef.implement({
    description:
      'Token de API de Code Mode. El secreto solo se ve al crearlo (`createApiToken`).',
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      mode: t.field({ type: TokenMode, resolve: (k) => k.mode }),
      hint: t.exposeString('hint'),
      createdAt: t.string({ resolve: (k) => iso(k.createdAt)! }),
      lastUsedAt: t.string({
        nullable: true,
        resolve: (k) => iso(k.lastUsedAt),
      }),
      expiresAt: t.string({ nullable: true, resolve: (k) => iso(k.expiresAt) }),
      revokedAt: t.string({ nullable: true, resolve: (k) => iso(k.revokedAt) }),
    }),
  })

  const CreatedApiTokenRef = builder.objectRef<{
    token: TokenView
    secret: string
  }>('CreatedApiToken')
  CreatedApiTokenRef.implement({
    fields: (t) => ({
      token: t.field({ type: ApiTokenRef, resolve: (c) => c.token }),
      secret: t.exposeString('secret', {
        description: 'El token en claro. No se vuelve a mostrar.',
      }),
    }),
  })

  const MentionRef = builder.objectRef<Mention>('Mention')
  MentionRef.implement({
    description:
      'Un item enlazado con `[[id]]`, con lo mínimo para dibujar un chip.',
    fields: (t) => ({
      id: t.exposeID('id'),
      listId: t.exposeID('listId'),
      listName: t.exposeString('listName'),
      title: t.exposeString('title'),
      done: t.exposeBoolean('done'),
    }),
  })

  const ItemRef = builder.objectRef<ItemView>('Item')
  ItemRef.implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      listId: t.exposeID('listId'),
      parentId: t.exposeID('parentId', { nullable: true }),
      position: t.exposeString('position'),
      text: t.exposeString('text'),
      done: t.boolean({ resolve: (i) => i.doneAt !== null }),
      doneAt: t.string({ nullable: true, resolve: (i) => iso(i.doneAt) }),
      createdAt: t.string({ resolve: (i) => iso(i.createdAt)! }),
      updatedAt: t.string({ resolve: (i) => iso(i.updatedAt)! }),
      mentions: t.field({
        type: [MentionRef],
        description: 'Items vivos que este texto enlaza con `[[id]]`.',
        resolve: (i) => i.mentions,
      }),
      backlinks: t.field({
        type: [MentionRef],
        description: 'Items vivos cuyo texto enlaza a este.',
        resolve: (i, _a, ctx) =>
          listBacklinks({ db: ctx.db }, caller(ctx), i.orgId, i.id),
      }),
    }),
  })

  const ListRef = builder.objectRef<ListView>('List')
  ListRef.implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      position: t.exposeString('position'),
      open: t.exposeInt('open'),
      total: t.exposeInt('total'),
      items: t.field({
        type: [ItemRef],
        resolve: (l, _a, ctx) =>
          listItems({ db: ctx.db }, caller(ctx), l.orgId, l.id),
      }),
    }),
  })

  const SearchHitRef = builder.objectRef<SearchHit>('SearchHit')
  SearchHitRef.implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      listId: t.exposeID('listId'),
      listName: t.exposeString('listName'),
      text: t.exposeString('text'),
      done: t.boolean({ resolve: (h) => h.doneAt !== null }),
    }),
  })

  const GithubKind = builder.enumType('GithubKind', {
    values: ['issue', 'pull'] as const,
  })
  const GithubState = builder.enumType('GithubState', {
    values: ['open', 'closed', 'not_planned', 'draft', 'merged'] as const,
  })
  const GithubLinkStatus = builder.enumType('GithubLinkStatus', {
    description:
      '`unavailable`: no hay dato (sin token, límite agotado o GitHub caído); el cliente muestra solo el link.',
    values: ['ok', 'not_found', 'unavailable'] as const,
  })
  const GithubLinkInput = builder.inputType('GithubLinkInput', {
    fields: (t) => ({
      owner: t.string({ required: true }),
      repo: t.string({ required: true }),
      number: t.int({ required: true }),
    }),
  })
  const GithubLinkRef = builder.objectRef<GithubLinkView>('GithubLink')
  GithubLinkRef.implement({
    description:
      'Estado de un issue o PR de GitHub. `owner` y `repo` vuelven en minúsculas.',
    fields: (t) => ({
      owner: t.exposeString('owner'),
      repo: t.exposeString('repo'),
      number: t.exposeInt('number'),
      status: t.field({ type: GithubLinkStatus, resolve: (l) => l.status }),
      kind: t.field({
        type: GithubKind,
        nullable: true,
        resolve: (l) => l.kind,
      }),
      title: t.exposeString('title', { nullable: true }),
      state: t.field({
        type: GithubState,
        nullable: true,
        resolve: (l) => l.state,
      }),
      stale: t.exposeBoolean('stale'),
      fetchedAt: t.string({
        nullable: true,
        resolve: (l) => iso(l.fetchedAt),
      }),
    }),
  })

  const OrgRef = builder.objectRef<OrgSummary>('Org')
  OrgRef.implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      kind: t.field({ type: OrgKind, resolve: (o) => o.kind }),
      name: t.exposeString('name'),
      role: t.field({ type: Role, resolve: (o) => o.role }),
      activity: t.field({
        type: [ActivityRef],
        args: { first: t.arg.int({ defaultValue: 20 }) },
        resolve: (o, args, ctx) =>
          listActivity(ctx.db, caller(ctx), o.id, args.first ?? 20),
      }),
      lists: t.field({
        type: [ListRef],
        resolve: (o, _a, ctx) => listLists({ db: ctx.db }, caller(ctx), o.id),
      }),
      members: t.field({
        type: [MemberRef],
        resolve: (o, _a, ctx) => listMembers(ctx.db, caller(ctx), o.id),
      }),
      invitations: t.field({
        type: [InvitationRef],
        description:
          'Invitaciones vigentes de la organización. Solo `owner` o `admin`.',
        resolve: (o, _a, ctx) => listInvitations(ctx.db, caller(ctx), o.id),
      }),
      apiTokens: t.field({
        type: [ApiTokenRef],
        description: 'Tus tokens de API en esta organización.',
        resolve: (o, _a, ctx) => listTokens(ctx.db, caller(ctx), o.id),
      }),
      list: t.field({
        type: ListRef,
        nullable: true,
        args: { id: t.arg.id({ required: true }) },
        resolve: (o, args, ctx) =>
          getList({ db: ctx.db }, caller(ctx), o.id, String(args.id)),
      }),
      item: t.field({
        type: ItemRef,
        nullable: true,
        args: { id: t.arg.id({ required: true }) },
        resolve: (o, args, ctx) =>
          getItem({ db: ctx.db }, caller(ctx), o.id, String(args.id)),
      }),
      search: t.field({
        type: [SearchHitRef],
        args: {
          query: t.arg.string({ required: true }),
          first: t.arg.int({ defaultValue: 20 }),
        },
        resolve: (o, args, ctx) =>
          searchItems(
            { db: ctx.db },
            caller(ctx),
            o.id,
            args.query,
            args.first ?? 20,
          ),
      }),
    }),
  })

  const UserRef = builder.objectRef<User>('User')
  UserRef.implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      login: t.exposeString('login'),
      name: t.exposeString('name', { nullable: true }),
      avatarUrl: t.exposeString('avatarUrl', { nullable: true }),
      orgs: t.field({
        type: [OrgRef],
        resolve: (_u, _a, ctx) => listOrgs(ctx.db, caller(ctx)),
      }),
      invitations: t.field({
        type: [InvitationRef],
        description:
          'Invitaciones pendientes dirigidas a tu login. Vacío fuera de la tailnet.',
        resolve: (_u, _a, ctx) => myInvitations(ctx.db, caller(ctx)),
      }),
    }),
  })

  builder.queryType({
    fields: (t) => ({
      version: t.string({ resolve: () => process.env.APP_VERSION ?? 'dev' }),
      ingress: t.field({
        type: IngressEnum,
        resolve: (_r, _a, ctx) => ctx.ingress,
      }),
      loginAvailable: t.boolean({
        resolve: (_r, _a, ctx) => ctx.loginAvailable,
      }),
      me: t.field({
        type: UserRef,
        nullable: true,
        resolve: (_r, _a, ctx) => ctx.viewer,
      }),
      org: t.field({
        type: OrgRef,
        nullable: true,
        args: { id: t.arg.id({ required: true }) },
        resolve: (_r, args, ctx) =>
          getOrg(ctx.db, caller(ctx), String(args.id)),
      }),
      githubLinks: t.field({
        type: [GithubLinkRef],
        description:
          'Estado vivo de hasta 50 issues o PRs de GitHub, con el token de quien pregunta (ADR 0006).',
        args: {
          refs: t.arg({ type: [GithubLinkInput], required: true }),
        },
        resolve: (_r, args, ctx) =>
          ctx.githubLinks.resolve(caller(ctx), args.refs),
      }),
    }),
  })

  // Las mutaciones solo arman el `Caller` y llaman a `services/*` (única vía de mutación).
  builder.mutationType({
    fields: (t) => ({
      createList: t.field({
        type: ListRef,
        args: {
          orgId: t.arg.id({ required: true }),
          name: t.arg.string({ required: true }),
          afterId: t.arg.id(),
        },
        resolve: (_r, a, ctx) =>
          createList(ctx, caller(ctx), {
            orgId: String(a.orgId),
            name: a.name,
            afterId: a.afterId ? String(a.afterId) : null,
          }),
      }),
      renameList: t.field({
        type: ListRef,
        args: {
          orgId: t.arg.id({ required: true }),
          id: t.arg.id({ required: true }),
          name: t.arg.string({ required: true }),
        },
        resolve: (_r, a, ctx) =>
          renameList(ctx, caller(ctx), {
            orgId: String(a.orgId),
            id: String(a.id),
            name: a.name,
          }),
      }),
      moveList: t.field({
        type: ListRef,
        args: {
          orgId: t.arg.id({ required: true }),
          id: t.arg.id({ required: true }),
          afterId: t.arg.id(),
        },
        resolve: (_r, a, ctx) =>
          moveList(ctx, caller(ctx), {
            orgId: String(a.orgId),
            id: String(a.id),
            afterId: a.afterId ? String(a.afterId) : null,
          }),
      }),
      deleteList: t.field({
        type: ListRef,
        args: {
          orgId: t.arg.id({ required: true }),
          id: t.arg.id({ required: true }),
        },
        resolve: (_r, a, ctx) =>
          deleteList(ctx, caller(ctx), {
            orgId: String(a.orgId),
            id: String(a.id),
          }),
      }),
      restoreList: t.field({
        type: ListRef,
        args: {
          orgId: t.arg.id({ required: true }),
          id: t.arg.id({ required: true }),
        },
        resolve: (_r, a, ctx) =>
          restoreList(ctx, caller(ctx), {
            orgId: String(a.orgId),
            id: String(a.id),
          }),
      }),
      createItem: t.field({
        type: ItemRef,
        args: {
          orgId: t.arg.id({ required: true }),
          listId: t.arg.id({ required: true }),
          text: t.arg.string({ required: true }),
          parentId: t.arg.id(),
          afterId: t.arg.id(),
        },
        resolve: (_r, a, ctx) =>
          createItem(ctx, caller(ctx), {
            orgId: String(a.orgId),
            listId: String(a.listId),
            text: a.text,
            parentId: a.parentId ? String(a.parentId) : null,
            afterId: a.afterId ? String(a.afterId) : null,
          }),
      }),
      updateItemText: t.field({
        type: ItemRef,
        args: {
          orgId: t.arg.id({ required: true }),
          id: t.arg.id({ required: true }),
          text: t.arg.string({ required: true }),
        },
        resolve: (_r, a, ctx) =>
          updateItemText(ctx, caller(ctx), {
            orgId: String(a.orgId),
            id: String(a.id),
            text: a.text,
          }),
      }),
      setItemDone: t.field({
        type: ItemRef,
        args: {
          orgId: t.arg.id({ required: true }),
          id: t.arg.id({ required: true }),
          done: t.arg.boolean({ required: true }),
        },
        resolve: (_r, a, ctx) =>
          setItemDone(ctx, caller(ctx), {
            orgId: String(a.orgId),
            id: String(a.id),
            done: a.done,
          }),
      }),
      moveItem: t.field({
        type: ItemRef,
        description:
          'Mueve el item después de `afterId` (al principio si es null). `listId` y `parentId` omitidos = donde está; `parentId: null` explícito lo pasa a primer nivel.',
        args: {
          orgId: t.arg.id({ required: true }),
          id: t.arg.id({ required: true }),
          afterId: t.arg.id(),
          listId: t.arg.id(),
          parentId: t.arg.id(),
        },
        resolve: (_r, a, ctx) =>
          moveItem(ctx, caller(ctx), {
            orgId: String(a.orgId),
            id: String(a.id),
            afterId: a.afterId ? String(a.afterId) : null,
            listId: a.listId ? String(a.listId) : undefined,
            // GraphQL distingue "omitido" (undefined) de `null`: solo un `parentId: null` explícito lo pasa a primer nivel.
            parentId: a.parentId == null ? a.parentId : String(a.parentId),
          }),
      }),
      deleteItem: t.field({
        type: ItemRef,
        args: {
          orgId: t.arg.id({ required: true }),
          id: t.arg.id({ required: true }),
        },
        resolve: (_r, a, ctx) =>
          deleteItem(ctx, caller(ctx), {
            orgId: String(a.orgId),
            id: String(a.id),
          }),
      }),
      createApiToken: t.field({
        type: CreatedApiTokenRef,
        description:
          'Crea un token de Code Mode para esta organización, atado a la puerta de tu sesión. Devuelve el secreto una sola vez.',
        args: {
          orgId: t.arg.id({ required: true }),
          name: t.arg.string({ required: true }),
          mode: t.arg({ type: TokenMode, required: true }),
          expiry: t.arg({ type: TokenExpiry, defaultValue: 90 }),
        },
        resolve: (_r, a, ctx) =>
          createApiToken(ctx.db, caller(ctx), {
            orgId: String(a.orgId),
            name: a.name,
            mode: a.mode,
            expiresInDays: a.expiry === 0 ? null : (a.expiry ?? 90),
          }),
      }),
      revokeApiToken: t.boolean({
        args: {
          orgId: t.arg.id({ required: true }),
          id: t.arg.id({ required: true }),
        },
        resolve: (_r, a, ctx) => {
          revokeToken(ctx.db, caller(ctx), {
            orgId: String(a.orgId),
            id: String(a.id),
          })
          return true
        },
      }),
      createTeamOrg: t.field({
        type: OrgRef,
        description: 'Crea una organización de equipo. Solo por la tailnet.',
        args: { name: t.arg.string({ required: true }) },
        resolve: (_r, a, ctx) =>
          createTeamOrg(ctx.db, caller(ctx), { name: a.name }),
      }),
      inviteMember: t.field({
        type: InvitationRef,
        description: 'Invita a un login de GitHub. Vence a los 14 días.',
        args: {
          orgId: t.arg.id({ required: true }),
          login: t.arg.string({ required: true }),
          role: t.arg({ type: InviteRole, defaultValue: 'member' }),
        },
        resolve: (_r, a, ctx) =>
          inviteMember(ctx, caller(ctx), {
            orgId: String(a.orgId),
            login: a.login,
            role: a.role ?? 'member',
          }),
      }),
      revokeInvitation: t.boolean({
        args: {
          orgId: t.arg.id({ required: true }),
          id: t.arg.id({ required: true }),
        },
        resolve: (_r, a, ctx) => {
          revokeInvitation(ctx, caller(ctx), {
            orgId: String(a.orgId),
            id: String(a.id),
          })
          return true
        },
      }),
      acceptInvitation: t.field({
        type: OrgRef,
        args: { id: t.arg.id({ required: true }) },
        resolve: (_r, a, ctx) =>
          acceptInvitation(ctx, caller(ctx), { id: String(a.id) }),
      }),
      declineInvitation: t.boolean({
        args: { id: t.arg.id({ required: true }) },
        resolve: (_r, a, ctx) => {
          declineInvitation(ctx, caller(ctx), { id: String(a.id) })
          return true
        },
      }),
      setMemberRole: t.field({
        type: MemberRef,
        args: {
          orgId: t.arg.id({ required: true }),
          userId: t.arg.id({ required: true }),
          role: t.arg({ type: Role, required: true }),
        },
        resolve: (_r, a, ctx) =>
          setMemberRole(ctx, caller(ctx), {
            orgId: String(a.orgId),
            userId: String(a.userId),
            role: a.role,
          }),
      }),
      removeMember: t.boolean({
        args: {
          orgId: t.arg.id({ required: true }),
          userId: t.arg.id({ required: true }),
        },
        resolve: (_r, a, ctx) => {
          removeMember(ctx, caller(ctx), {
            orgId: String(a.orgId),
            userId: String(a.userId),
          })
          return true
        },
      }),
      leaveOrg: t.boolean({
        args: { orgId: t.arg.id({ required: true }) },
        resolve: (_r, a, ctx) => {
          leaveOrg(ctx, caller(ctx), { orgId: String(a.orgId) })
          return true
        },
      }),
      restoreItem: t.field({
        type: ItemRef,
        args: {
          orgId: t.arg.id({ required: true }),
          id: t.arg.id({ required: true }),
        },
        resolve: (_r, a, ctx) =>
          restoreItem(ctx, caller(ctx), {
            orgId: String(a.orgId),
            id: String(a.id),
          }),
      }),
    }),
  })

  return builder.toSchema()
}
