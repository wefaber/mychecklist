import {
  Type,
  type Static,
  type TObject,
  type TSchema,
} from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { DomainError } from '../errors'
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
} from './items'
import {
  createList,
  deleteList,
  getList,
  listLists,
  moveList,
  renameList,
  restoreList,
  type ListView,
} from './lists'
import { getOrg, listActivity } from './orgs'
import type { Caller, Deps } from './types'
import { MAX_NAME, MAX_TEXT } from './validate'

/**
 * Registry de Code Mode (ADR 0002 y 0007): cada operación de la API de agentes se declara una vez, con su esquema de
 * entrada y de salida (TypeBox). De acá salen `checklist.d.ts` y `spec.json` (`scripts/gen-codemode.ts`), el objeto
 * `checklist` que ve el sandbox y la validación de lo que manda el código. Cada `run` llama a `services/*`: la única
 * vía de mutación. La org, el usuario y la puerta salen del token y las operaciones no los reciben nunca por
 * parámetro.
 */

export type Mode = 'read' | 'write'

/** Lo que el servidor sabe de quien llama: sale del token, no del código del agente. */
export type OpContext = { deps: Deps; caller: Caller; orgId: string }

export type Op = {
  name: string
  mode: Mode
  summary: string
  input: TObject
  output: TSchema
  run(ctx: OpContext, input: never): unknown
}

export function defineOp<I extends TObject, O extends TSchema>(def: {
  name: string
  mode: Mode
  summary: string
  input: I
  output: O
  run: (ctx: OpContext, input: Static<I>) => Static<O>
}): Op {
  return def as Op
}

// ---- Esquemas con nombre: el generador los emite una vez y los referencia por nombre -----------------------------

const Id = Type.String({ minLength: 1, maxLength: 40 })
const NullableId = Type.Union([Id, Type.Null()])
const Iso = Type.String({ description: 'Fecha ISO 8601.' })

const List = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    open: Type.Integer({ description: 'Items sin completar.' }),
    total: Type.Integer({ description: 'Items vivos.' }),
  },
  { $id: 'List' },
)

const MentionSchema = Type.Object(
  {
    id: Type.String(),
    listId: Type.String(),
    listName: Type.String(),
    title: Type.String(),
    done: Type.Boolean(),
  },
  { $id: 'Mention', description: 'Un item enlazado con `[[id]]`.' },
)

const Item = Type.Object(
  {
    id: Type.String(),
    listId: Type.String(),
    parentId: Type.Union([Type.String(), Type.Null()]),
    text: Type.String({ description: 'Markdown.' }),
    done: Type.Boolean(),
    doneAt: Type.Union([Iso, Type.Null()]),
    createdAt: Iso,
    updatedAt: Iso,
    mentions: Type.Array(MentionSchema),
  },
  { $id: 'Item' },
)

const Hit = Type.Object(
  {
    id: Type.String(),
    listId: Type.String(),
    listName: Type.String(),
    text: Type.String(),
    done: Type.Boolean(),
  },
  { $id: 'SearchHit' },
)

const Activity = Type.Object(
  {
    id: Type.String(),
    type: Type.String(),
    entityType: Type.Union([Type.String(), Type.Null()]),
    entityId: Type.Union([Type.String(), Type.Null()]),
    via: Type.String({ description: 'web, mcp, import o job.' }),
    at: Iso,
  },
  { $id: 'Activity' },
)

const Org = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    kind: Type.Union([Type.Literal('personal'), Type.Literal('team')]),
    role: Type.Union([
      Type.Literal('owner'),
      Type.Literal('admin'),
      Type.Literal('member'),
    ]),
  },
  { $id: 'Org', description: 'La organización del token.' },
)

/** Los esquemas con nombre, para que el generador los emita una vez. */
export const NAMED: TSchema[] = [List, MentionSchema, Item, Hit, Activity, Org]

/** Máximos por llamada de lectura (ADR 0007). */
export const MAX_ITEMS_PER_READ = 500
const MAX_ACTIVITY = 100
const MAX_HITS = 50

// ---- Conversión de las vistas del dominio ----------------------------------------------------------------------

const iso = (ms: number) => new Date(ms).toISOString()

const listOut = (l: ListView): Static<typeof List> => ({
  id: l.id,
  name: l.name,
  open: l.open,
  total: l.total,
})

const mentionOut = (m: Mention): Static<typeof MentionSchema> => ({ ...m })

const itemOut = (i: ItemView): Static<typeof Item> => ({
  id: i.id,
  listId: i.listId,
  parentId: i.parentId,
  text: i.text,
  done: i.doneAt !== null,
  doneAt: i.doneAt === null ? null : iso(i.doneAt),
  createdAt: iso(i.createdAt),
  updatedAt: iso(i.updatedAt),
  mentions: i.mentions.map(mentionOut),
})

/**
 * `afterId` omitido es "al final" (lo natural para un agente que agrega), `null` es "al principio". El dominio solo
 * conoce el `afterId` explícito, así que acá se resuelve el último.
 */
function lastList(ctx: OpContext, exclude?: string): string | null {
  return (
    listLists(ctx.deps, ctx.caller, ctx.orgId)
      .filter((l) => l.id !== exclude)
      .at(-1)?.id ?? null
  )
}

function lastItem(
  ctx: OpContext,
  listId: string,
  parentId: string | null,
  exclude?: string,
): string | null {
  const siblings = listItems(ctx.deps, ctx.caller, ctx.orgId, listId).filter(
    (i) => i.parentId === parentId && i.id !== exclude,
  )
  return siblings.at(-1)?.id ?? null
}

const AFTER_DOC =
  '`afterId`: el item o la lista tras la que va; omitido va al final y `null` al principio.'

const Empty = Type.Object({}, { additionalProperties: false })
const OnlyId = Type.Object({ id: Id }, { additionalProperties: false })

// ---- Operaciones ---------------------------------------------------------------------------------------------------

export const OPS: Op[] = [
  defineOp({
    name: 'org.get',
    mode: 'read',
    summary: 'La organización del token y el rol del usuario en ella.',
    input: Empty,
    output: Org,
    run: (ctx) => {
      const o = getOrg(ctx.deps.db, ctx.caller, ctx.orgId)
      return { id: o.id, name: o.name, kind: o.kind, role: o.role }
    },
  }),
  defineOp({
    name: 'lists.list',
    mode: 'read',
    summary: 'Las listas vivas, en orden.',
    input: Empty,
    output: Type.Array(List),
    run: (ctx) => listLists(ctx.deps, ctx.caller, ctx.orgId).map(listOut),
  }),
  defineOp({
    name: 'lists.get',
    mode: 'read',
    summary: 'Una lista por id.',
    input: OnlyId,
    output: List,
    run: (ctx, { id }) => listOut(getList(ctx.deps, ctx.caller, ctx.orgId, id)),
  }),
  defineOp({
    name: 'lists.create',
    mode: 'write',
    summary: `Crea una lista. ${AFTER_DOC}`,
    input: Type.Object(
      {
        name: Type.String({ maxLength: MAX_NAME }),
        afterId: Type.Optional(NullableId),
      },
      { additionalProperties: false },
    ),
    output: List,
    run: (ctx, input) =>
      listOut(
        createList(ctx.deps, ctx.caller, {
          orgId: ctx.orgId,
          name: input.name,
          afterId: input.afterId === undefined ? lastList(ctx) : input.afterId,
        }),
      ),
  }),
  defineOp({
    name: 'lists.rename',
    mode: 'write',
    summary: 'Cambia el nombre de una lista.',
    input: Type.Object(
      { id: Id, name: Type.String({ maxLength: MAX_NAME }) },
      { additionalProperties: false },
    ),
    output: List,
    run: (ctx, input) =>
      listOut(renameList(ctx.deps, ctx.caller, { orgId: ctx.orgId, ...input })),
  }),
  defineOp({
    name: 'lists.move',
    mode: 'write',
    summary: `Mueve una lista. ${AFTER_DOC}`,
    input: Type.Object(
      { id: Id, afterId: Type.Optional(NullableId) },
      { additionalProperties: false },
    ),
    output: List,
    run: (ctx, input) =>
      listOut(
        moveList(ctx.deps, ctx.caller, {
          orgId: ctx.orgId,
          id: input.id,
          afterId:
            input.afterId === undefined
              ? lastList(ctx, input.id)
              : input.afterId,
        }),
      ),
  }),
  defineOp({
    name: 'lists.delete',
    mode: 'write',
    summary: 'Borra una lista (borrado lógico: `lists.restore` la devuelve).',
    input: OnlyId,
    output: List,
    run: (ctx, { id }) =>
      listOut(deleteList(ctx.deps, ctx.caller, { orgId: ctx.orgId, id })),
  }),
  defineOp({
    name: 'lists.restore',
    mode: 'write',
    summary: 'Restaura una lista borrada.',
    input: OnlyId,
    output: List,
    run: (ctx, { id }) =>
      listOut(restoreList(ctx.deps, ctx.caller, { orgId: ctx.orgId, id })),
  }),
  defineOp({
    name: 'items.list',
    mode: 'read',
    summary: `Items vivos de una lista, planos y en orden (los subitems traen \`parentId\`). Hasta ${MAX_ITEMS_PER_READ} por llamada; seguí con \`offset\`.`,
    input: Type.Object(
      {
        listId: Id,
        limit: Type.Optional(
          Type.Integer({ minimum: 1, maximum: MAX_ITEMS_PER_READ }),
        ),
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
      },
      { additionalProperties: false },
    ),
    output: Type.Array(Item),
    run: (ctx, input) => {
      const offset = input.offset ?? 0
      const limit = input.limit ?? MAX_ITEMS_PER_READ
      return listItems(ctx.deps, ctx.caller, ctx.orgId, input.listId)
        .slice(offset, offset + limit)
        .map(itemOut)
    },
  }),
  defineOp({
    name: 'items.get',
    mode: 'read',
    summary: 'Un item vivo por id, o null si no existe.',
    input: OnlyId,
    output: Type.Union([Item, Type.Null()]),
    run: (ctx, { id }) => {
      const item = getItem(ctx.deps, ctx.caller, ctx.orgId, id)
      return item ? itemOut(item) : null
    },
  }),
  defineOp({
    name: 'items.search',
    mode: 'read',
    summary: `Busca items por texto en toda la organización (hasta ${MAX_HITS}).`,
    input: Type.Object(
      {
        query: Type.String({ maxLength: 200 }),
        first: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_HITS })),
      },
      { additionalProperties: false },
    ),
    output: Type.Array(Hit),
    run: (ctx, input) =>
      searchItems(
        ctx.deps,
        ctx.caller,
        ctx.orgId,
        input.query,
        input.first ?? 20,
      ).map((h) => ({
        id: h.id,
        listId: h.listId,
        listName: h.listName,
        text: h.text,
        done: h.doneAt !== null,
      })),
  }),
  defineOp({
    name: 'items.backlinks',
    mode: 'read',
    summary: 'Items vivos cuyo texto enlaza a este con `[[id]]`.',
    input: OnlyId,
    output: Type.Array(MentionSchema),
    run: (ctx, { id }) =>
      listBacklinks(ctx.deps, ctx.caller, ctx.orgId, id).map(mentionOut),
  }),
  defineOp({
    name: 'items.create',
    mode: 'write',
    summary: `Crea un item en una lista (con \`parentId\`, un subitem). ${AFTER_DOC}`,
    input: Type.Object(
      {
        listId: Id,
        text: Type.String({ maxLength: MAX_TEXT, description: 'Markdown.' }),
        parentId: Type.Optional(NullableId),
        afterId: Type.Optional(NullableId),
      },
      { additionalProperties: false },
    ),
    output: Item,
    run: (ctx, input) => {
      const parentId = input.parentId ?? null
      return itemOut(
        createItem(ctx.deps, ctx.caller, {
          orgId: ctx.orgId,
          listId: input.listId,
          text: input.text,
          parentId,
          afterId:
            input.afterId === undefined
              ? lastItem(ctx, input.listId, parentId)
              : input.afterId,
        }),
      )
    },
  }),
  defineOp({
    name: 'items.updateText',
    mode: 'write',
    summary: 'Reemplaza el texto (Markdown) de un item.',
    input: Type.Object(
      { id: Id, text: Type.String({ maxLength: MAX_TEXT }) },
      { additionalProperties: false },
    ),
    output: Item,
    run: (ctx, input) =>
      itemOut(
        updateItemText(ctx.deps, ctx.caller, { orgId: ctx.orgId, ...input }),
      ),
  }),
  defineOp({
    name: 'items.setDone',
    mode: 'write',
    summary: 'Completa o reabre un item.',
    input: Type.Object(
      { id: Id, done: Type.Boolean() },
      { additionalProperties: false },
    ),
    output: Item,
    run: (ctx, input) =>
      itemOut(
        setItemDone(ctx.deps, ctx.caller, { orgId: ctx.orgId, ...input }),
      ),
  }),
  defineOp({
    name: 'items.move',
    mode: 'write',
    summary: `Mueve un item (a otra lista o de padre con \`listId\` y \`parentId\`; omitidos, donde está; \`parentId: null\` lo pasa a primer nivel). ${AFTER_DOC}`,
    input: Type.Object(
      {
        id: Id,
        afterId: Type.Optional(NullableId),
        listId: Type.Optional(Id),
        parentId: Type.Optional(NullableId),
      },
      { additionalProperties: false },
    ),
    output: Item,
    run: (ctx, input) => {
      let afterId = input.afterId
      if (afterId === undefined) {
        const current = getItem(ctx.deps, ctx.caller, ctx.orgId, input.id)
        if (!current) throw new DomainError('NOT_FOUND', 'El item no existe')
        const listId = input.listId ?? current.listId
        const parentId =
          input.parentId === undefined ? current.parentId : input.parentId
        afterId = lastItem(ctx, listId, parentId, input.id)
      }
      return itemOut(
        moveItem(ctx.deps, ctx.caller, {
          orgId: ctx.orgId,
          id: input.id,
          afterId,
          listId: input.listId,
          parentId: input.parentId,
        }),
      )
    },
  }),
  defineOp({
    name: 'items.delete',
    mode: 'write',
    summary:
      'Borra un item y sus subitems (borrado lógico: `items.restore` los devuelve).',
    input: OnlyId,
    output: Item,
    run: (ctx, { id }) =>
      itemOut(deleteItem(ctx.deps, ctx.caller, { orgId: ctx.orgId, id })),
  }),
  defineOp({
    name: 'items.restore',
    mode: 'write',
    summary: 'Restaura un item borrado.',
    input: OnlyId,
    output: Item,
    run: (ctx, { id }) =>
      itemOut(restoreItem(ctx.deps, ctx.caller, { orgId: ctx.orgId, id })),
  }),
  defineOp({
    name: 'activity.list',
    mode: 'read',
    summary: `Los últimos cambios de la organización, los más nuevos primero (hasta ${MAX_ACTIVITY}).`,
    input: Type.Object(
      {
        first: Type.Optional(
          Type.Integer({ minimum: 1, maximum: MAX_ACTIVITY }),
        ),
      },
      { additionalProperties: false },
    ),
    output: Type.Array(Activity),
    run: (ctx, input) =>
      listActivity(ctx.deps.db, ctx.caller, ctx.orgId, input.first ?? 20).map(
        (a) => ({
          id: a.id,
          type: a.type,
          entityType: a.entityType,
          entityId: a.entityId,
          via: a.via,
          at: iso(a.at),
        }),
      ),
  }),
]

const BY_NAME = new Map(OPS.map((op) => [op.name, op]))

/** Las operaciones que un token del modo dado puede ver: `read` no tiene las de escritura, ni existen en su objeto. */
export function opsFor(mode: Mode): Op[] {
  return mode === 'write' ? OPS : OPS.filter((op) => op.mode === 'read')
}

/** Valida la entrada contra el esquema y corre la operación con el contexto del token. */
export function callOp(
  mode: Mode,
  ctx: OpContext,
  name: string,
  args: unknown,
): unknown {
  const op = BY_NAME.get(name)
  if (!op || (op.mode === 'write' && mode !== 'write'))
    throw new DomainError(
      'FORBIDDEN',
      `La operación ${name} no está disponible`,
    )
  const input = args ?? {}
  if (!Value.Check(op.input, input)) {
    const first = Value.Errors(op.input, input).First()
    throw new DomainError(
      'INVALID_INPUT',
      `${name}: ${first ? `${first.path || 'entrada'} ${first.message}` : 'entrada inválida'}`,
    )
  }
  return op.run(ctx, input as never)
}
