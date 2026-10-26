import {
  Type,
  type Static,
  type TObject,
  type TSchema,
} from '@sinclair/typebox'
import {
  createRegistry,
  defineOp as define,
  type Scope,
} from '@wefaber/codemode'
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

/** Los scopes de un token según su modo (ADR 0007): `write` incluye `read`. */
export const scopesFor = (mode: Mode): string[] => [`checklist:${mode}`]

/** Lo que el servidor sabe de quien llama: sale del token, no del código del agente. */
export type OpContext = { deps: Deps; caller: Caller; orgId: string }

/** `defineOp` del toolkit con el contexto de este producto ya fijado. */
function defineOp<I extends TObject, O extends TSchema>(def: {
  id: string
  scope: Scope
  summary: string
  input: I
  output: O
  verbException?: string
  handler: (ctx: OpContext, input: Static<I>) => Static<O>
}) {
  return define<OpContext, I, O>(def)
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

const OPS = [
  defineOp({
    id: 'checklist.org.get',
    scope: 'checklist:read',
    summary: 'La organización del token y el rol del usuario en ella.',
    input: Empty,
    output: Org,
    handler: (ctx) => {
      const o = getOrg(ctx.deps.db, ctx.caller, ctx.orgId)
      return { id: o.id, name: o.name, kind: o.kind, role: o.role }
    },
  }),
  defineOp({
    id: 'checklist.lists.list',
    scope: 'checklist:read',
    summary: 'Las listas vivas, en orden.',
    input: Empty,
    output: Type.Array(List),
    handler: (ctx) => listLists(ctx.deps, ctx.caller, ctx.orgId).map(listOut),
  }),
  defineOp({
    id: 'checklist.lists.get',
    scope: 'checklist:read',
    summary: 'Una lista por id.',
    input: OnlyId,
    output: List,
    handler: (ctx, { id }) =>
      listOut(getList(ctx.deps, ctx.caller, ctx.orgId, id)),
  }),
  defineOp({
    id: 'checklist.lists.create',
    scope: 'checklist:write',
    summary: `Crea una lista. ${AFTER_DOC}`,
    input: Type.Object(
      {
        name: Type.String({ maxLength: MAX_NAME }),
        afterId: Type.Optional(NullableId),
      },
      { additionalProperties: false },
    ),
    output: List,
    handler: (ctx, input) =>
      listOut(
        createList(ctx.deps, ctx.caller, {
          orgId: ctx.orgId,
          name: input.name,
          afterId: input.afterId === undefined ? lastList(ctx) : input.afterId,
        }),
      ),
  }),
  defineOp({
    id: 'checklist.lists.rename',
    scope: 'checklist:write',
    verbException:
      'Cambia solo el nombre; `update` sugeriría que se puede cambiar cualquier campo.',
    summary: 'Cambia el nombre de una lista.',
    input: Type.Object(
      { id: Id, name: Type.String({ maxLength: MAX_NAME }) },
      { additionalProperties: false },
    ),
    output: List,
    handler: (ctx, input) =>
      listOut(renameList(ctx.deps, ctx.caller, { orgId: ctx.orgId, ...input })),
  }),
  defineOp({
    id: 'checklist.lists.move',
    scope: 'checklist:write',
    summary: `Mueve una lista. ${AFTER_DOC}`,
    input: Type.Object(
      { id: Id, afterId: Type.Optional(NullableId) },
      { additionalProperties: false },
    ),
    output: List,
    handler: (ctx, input) =>
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
    id: 'checklist.lists.delete',
    scope: 'checklist:write',
    summary: 'Borra una lista (borrado lógico: `lists.restore` la devuelve).',
    input: OnlyId,
    output: List,
    handler: (ctx, { id }) =>
      listOut(deleteList(ctx.deps, ctx.caller, { orgId: ctx.orgId, id })),
  }),
  defineOp({
    id: 'checklist.lists.restore',
    scope: 'checklist:write',
    summary: 'Restaura una lista borrada.',
    input: OnlyId,
    output: List,
    handler: (ctx, { id }) =>
      listOut(restoreList(ctx.deps, ctx.caller, { orgId: ctx.orgId, id })),
  }),
  defineOp({
    id: 'checklist.items.list',
    scope: 'checklist:read',
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
    handler: (ctx, input) => {
      const offset = input.offset ?? 0
      const limit = input.limit ?? MAX_ITEMS_PER_READ
      return listItems(ctx.deps, ctx.caller, ctx.orgId, input.listId)
        .slice(offset, offset + limit)
        .map(itemOut)
    },
  }),
  defineOp({
    id: 'checklist.items.get',
    scope: 'checklist:read',
    summary: 'Un item vivo por id, o null si no existe.',
    input: OnlyId,
    output: Type.Union([Item, Type.Null()]),
    handler: (ctx, { id }) => {
      const item = getItem(ctx.deps, ctx.caller, ctx.orgId, id)
      return item ? itemOut(item) : null
    },
  }),
  defineOp({
    id: 'checklist.items.search',
    scope: 'checklist:read',
    summary: `Busca items por texto en toda la organización (hasta ${MAX_HITS}).`,
    input: Type.Object(
      {
        query: Type.String({ maxLength: 200 }),
        first: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_HITS })),
      },
      { additionalProperties: false },
    ),
    output: Type.Array(Hit),
    handler: (ctx, input) =>
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
    id: 'checklist.items.backlinks',
    scope: 'checklist:read',
    verbException:
      'Lectura de los items que enlazan a uno con `[[id]]`; no es una lista del recurso.',
    summary: 'Items vivos cuyo texto enlaza a este con `[[id]]`.',
    input: OnlyId,
    output: Type.Array(MentionSchema),
    handler: (ctx, { id }) =>
      listBacklinks(ctx.deps, ctx.caller, ctx.orgId, id).map(mentionOut),
  }),
  defineOp({
    id: 'checklist.items.create',
    scope: 'checklist:write',
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
    handler: (ctx, input) => {
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
    id: 'checklist.items.updateText',
    scope: 'checklist:write',
    verbException: 'Cambia solo el texto (Markdown) y reindexa las menciones.',
    summary: 'Reemplaza el texto (Markdown) de un item.',
    input: Type.Object(
      { id: Id, text: Type.String({ maxLength: MAX_TEXT }) },
      { additionalProperties: false },
    ),
    output: Item,
    handler: (ctx, input) =>
      itemOut(
        updateItemText(ctx.deps, ctx.caller, { orgId: ctx.orgId, ...input }),
      ),
  }),
  defineOp({
    id: 'checklist.items.setDone',
    scope: 'checklist:write',
    verbException:
      'Marca o desmarca como hecho; es la acción más frecuente y no es un `update` genérico.',
    summary: 'Completa o reabre un item.',
    input: Type.Object(
      { id: Id, done: Type.Boolean() },
      { additionalProperties: false },
    ),
    output: Item,
    handler: (ctx, input) =>
      itemOut(
        setItemDone(ctx.deps, ctx.caller, { orgId: ctx.orgId, ...input }),
      ),
  }),
  defineOp({
    id: 'checklist.items.move',
    scope: 'checklist:write',
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
    handler: (ctx, input) => {
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
    id: 'checklist.items.delete',
    scope: 'checklist:write',
    summary:
      'Borra un item y sus subitems (borrado lógico: `items.restore` los devuelve).',
    input: OnlyId,
    output: Item,
    handler: (ctx, { id }) =>
      itemOut(deleteItem(ctx.deps, ctx.caller, { orgId: ctx.orgId, id })),
  }),
  defineOp({
    id: 'checklist.items.restore',
    scope: 'checklist:write',
    summary: 'Restaura un item borrado.',
    input: OnlyId,
    output: Item,
    handler: (ctx, { id }) =>
      itemOut(restoreItem(ctx.deps, ctx.caller, { orgId: ctx.orgId, id })),
  }),
  defineOp({
    id: 'checklist.activity.list',
    scope: 'checklist:read',
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
    handler: (ctx, input) =>
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

/** El registry de agentes de mychecklist (SPEC R1): de acá salen el spec, el d.ts y el objeto `codemode.checklist`. */
export const registry = createRegistry<OpContext>({
  product: 'checklist',
  version: '1.0.0',
  types: NAMED,
  ops: OPS,
})
