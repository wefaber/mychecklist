import type { Database } from 'bun:sqlite'
import SchemaBuilder from '@pothos/core'
import type { OrgSummary, User } from '../db/accounts'
import type { ActivityEntry } from '../db/scoped'
import { DomainError } from '../errors'
import type { Ingress } from '../ingress'
import { listOrgs } from '../services/accounts'
import { getOrg, listActivity } from '../services/orgs'
import type { Caller } from '../services/types'

export type Context = {
  db: Database
  ingress: Ingress
  /** Usuario de la sesión de esta puerta, o `null`. */
  viewer: User | null
  /** Hay credenciales de GitHub y clave de cifrado: el login puede completarse. */
  loginAvailable: boolean
}

function caller(ctx: Context): Caller {
  if (!ctx.viewer)
    throw new DomainError('UNAUTHENTICATED', 'Hay que iniciar sesión')
  return { userId: ctx.viewer.id, ingress: ctx.ingress }
}

/** Code-first schema. M1: identidad y organizaciones; listas e items llegan con M2. */
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

  return builder.toSchema()
}
