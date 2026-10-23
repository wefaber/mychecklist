import type { Database } from 'bun:sqlite'
import SchemaBuilder from '@pothos/core'
import type { OrgSummary, User } from '../db/accounts'
import type { ActivityEntry, SearchHit } from '../db/scoped'
import { DomainError } from '../errors'
import type { Bus } from '../events'
import type { Ingress } from '../ingress'
import { listOrgs } from '../services/accounts'
import {
  createItem,
  deleteItem,
  listItems,
  moveItem,
  restoreItem,
  searchItems,
  setItemDone,
  updateItemText,
  type ItemView,
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
}

function caller(ctx: Context): Caller {
  if (!ctx.viewer)
    throw new DomainError('UNAUTHENTICATED', 'Hay que iniciar sesión')
  return { userId: ctx.viewer.id, ingress: ctx.ingress, via: 'web' }
}

const iso = (ms: number | null) =>
  ms === null ? null : new Date(ms).toISOString()

/** Code-first schema. M1: identidad y organizaciones. M2: listas e items. */
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
