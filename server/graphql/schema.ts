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
import { getOrg, listActivity } from '../services/orgs'
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
    }),
  })

  builder.queryType({
    fields: (t) => ({
      version: t.string({ resolve: () => process.env.APP_VERSION ?? 'dev' }),
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
