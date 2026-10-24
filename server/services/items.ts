import { between } from '../../shared/order'
import { extractRefs } from '../../shared/refs'
import { titleOf } from '../../shared/title'
import { ulid } from '../db/ids'
import {
  openScope,
  type ItemRow,
  type RefHit,
  type Scope,
  type SearchHit,
} from '../db/scoped'
import { DomainError } from '../errors'
import type { Caller, Deps } from './types'
import { cleanText, MAX_ITEMS_PER_LIST, MAX_TEXT } from './validate'

/** Un item mencionado por otro (o que lo menciona): lo mínimo para dibujar un chip. */
export type Mention = {
  id: string
  listId: string
  listName: string
  /** Primera línea con contenido, sin marcas de Markdown y acotada (`shared/title.ts`); puede quedar vacío. */
  title: string
  done: boolean
}

const mention = (h: RefHit): Mention => ({
  id: h.id,
  listId: h.listId,
  listName: h.listName,
  title: titleOf(h.text),
  done: h.doneAt !== null,
})

export type ItemView = {
  id: string
  orgId: string
  listId: string
  parentId: string | null
  position: string
  text: string
  doneAt: number | null
  createdAt: number
  updatedAt: number
  /** Items que este menciona con `[[id]]` y que siguen vivos. */
  mentions: Mention[]
}

const view = (orgId: string, i: ItemRow, mentions: Mention[]): ItemView => ({
  id: i.id,
  orgId,
  listId: i.listId,
  parentId: i.parentId,
  position: i.position,
  text: i.text,
  doneAt: i.doneAt,
  createdAt: i.createdAt,
  updatedAt: i.updatedAt,
  mentions,
})

const present = (scope: Scope, orgId: string, i: ItemRow) =>
  view(orgId, i, scope.refs.from(i.id).map(mention))

/**
 * Deja el índice de referencias igual al texto: solo cuentan ids de items de esta org (borrados incluidos, por si
 * vuelven) y nunca el propio item. El resto del texto sigue como lo escribió la persona.
 */
export function syncRefs(scope: Scope, id: string, text: string) {
  scope.refs.replace(
    id,
    extractRefs(text).filter((to) => to !== id && scope.items.get(to, true)),
  )
}

/** Tope de backlinks que se devuelven por item. */
const MAX_BACKLINKS = 100

const via = (c: Caller) => c.via ?? 'web'

function must(scope: Scope, id: string, withDeleted = false): ItemRow {
  const item = scope.items.get(id, withDeleted)
  if (!item) throw new DomainError('NOT_FOUND', 'El item no existe')
  return item
}

function mustList(scope: Scope, id: string) {
  const list = scope.lists.get(id)
  if (!list) throw new DomainError('NOT_FOUND', 'La lista no existe')
  return list
}

/** Un solo nivel de subitems: el padre es de primer nivel y de la misma lista. */
function checkParent(scope: Scope, listId: string, parentId: string | null) {
  if (parentId === null) return
  const parent = must(scope, parentId)
  if (parent.listId !== listId)
    throw new DomainError('INVALID_INPUT', 'El padre es de otra lista')
  if (parent.parentId !== null)
    throw new DomainError('INVALID_INPUT', 'Los subitems admiten un solo nivel')
}

export function listItems(
  { db }: Pick<Deps, 'db'>,
  caller: Caller,
  orgId: string,
  listId: string,
): ItemView[] {
  const scope = openScope(db, { orgId, ...caller })
  mustList(scope, listId)
  const mentions = scope.refs.fromList(listId)
  return scope.items
    .inList(listId)
    .map((i) => view(orgId, i, (mentions.get(i.id) ?? []).map(mention)))
}

/** Un item vivo por id, o `null` si no existe (o está borrado). */
export function getItem(
  { db }: Pick<Deps, 'db'>,
  caller: Caller,
  orgId: string,
  id: string,
): ItemView | null {
  const scope = openScope(db, { orgId, ...caller })
  const row = scope.items.get(id)
  return row ? present(scope, orgId, row) : null
}

/** Items vivos que mencionan a `itemId` con `[[id]]`. */
export function listBacklinks(
  { db }: Pick<Deps, 'db'>,
  caller: Caller,
  orgId: string,
  itemId: string,
): Mention[] {
  const scope = openScope(db, { orgId, ...caller })
  must(scope, itemId)
  return scope.refs.to(itemId, MAX_BACKLINKS).map(mention)
}

export function searchItems(
  { db }: Pick<Deps, 'db'>,
  caller: Caller,
  orgId: string,
  query: string,
  first: number,
): SearchHit[] {
  const q = query.trim()
  const scope = openScope(db, { orgId, ...caller })
  if (!q) return []
  const limit = Math.min(Math.max(Math.trunc(first), 1), 50)
  return scope.items.search(q, limit)
}

export function createItem(
  { db, bus }: Deps,
  caller: Caller,
  input: {
    orgId: string
    listId: string
    parentId: string | null
    afterId: string | null
    text: string
  },
  now = Date.now(),
): ItemView {
  const text = cleanText(input.text, {
    max: MAX_TEXT,
    label: 'El texto',
    multiline: true,
  })
  const scope = openScope(db, { orgId: input.orgId, ...caller })
  mustList(scope, input.listId)
  checkParent(scope, input.listId, input.parentId)
  if (scope.items.countInList(input.listId) >= MAX_ITEMS_PER_LIST)
    throw new DomainError(
      'LIMIT_REACHED',
      `Una lista admite hasta ${MAX_ITEMS_PER_LIST} items`,
    )
  const id = ulid(now)
  db.transaction(() => {
    const gap = scope.items.gap(input.listId, input.parentId, input.afterId)
    scope.items.insert(
      {
        id,
        listId: input.listId,
        parentId: input.parentId,
        position: between(gap.before, gap.after),
        text,
      },
      now,
    )
    syncRefs(scope, id, text)
    scope.activity.append(
      {
        type: 'item.created',
        entityType: 'item',
        entityId: id,
        via: via(caller),
      },
      now,
    )
  })()
  bus.publish({
    orgId: input.orgId,
    scope: 'list',
    listId: input.listId,
    actorId: caller.userId,
  })
  bus.publish({ orgId: input.orgId, scope: 'lists', actorId: caller.userId })
  return present(scope, input.orgId, must(scope, id))
}

export function updateItemText(
  { db, bus }: Deps,
  caller: Caller,
  input: { orgId: string; id: string; text: string },
  now = Date.now(),
): ItemView {
  const text = cleanText(input.text, {
    max: MAX_TEXT,
    label: 'El texto',
    multiline: true,
  })
  const scope = openScope(db, { orgId: input.orgId, ...caller })
  const item = must(scope, input.id)
  db.transaction(() => {
    scope.items.setText(input.id, text, now)
    syncRefs(scope, input.id, text)
    scope.activity.append(
      {
        type: 'item.edited',
        entityType: 'item',
        entityId: input.id,
        via: via(caller),
      },
      now,
    )
  })()
  bus.publish({
    orgId: input.orgId,
    scope: 'list',
    listId: item.listId,
    actorId: caller.userId,
  })
  return present(scope, input.orgId, must(scope, input.id))
}

export function setItemDone(
  { db, bus }: Deps,
  caller: Caller,
  input: { orgId: string; id: string; done: boolean },
  now = Date.now(),
): ItemView {
  const scope = openScope(db, { orgId: input.orgId, ...caller })
  const item = must(scope, input.id)
  if ((item.doneAt !== null) !== input.done) {
    db.transaction(() => {
      scope.items.setDone(input.id, input.done ? now : null, now)
      scope.activity.append(
        {
          type: input.done ? 'item.completed' : 'item.reopened',
          entityType: 'item',
          entityId: input.id,
          via: via(caller),
        },
        now,
      )
    })()
    bus.publish({
      orgId: input.orgId,
      scope: 'list',
      listId: item.listId,
      actorId: caller.userId,
    })
    bus.publish({ orgId: input.orgId, scope: 'lists', actorId: caller.userId })
  }
  return present(scope, input.orgId, must(scope, input.id))
}

/**
 * Mueve un item a `listId`/`parentId` justo después de `afterId` (al principio si es `null`). Omitir `listId` o
 * `parentId` es "donde está": mover dentro de la misma lista o del mismo padre.
 */
export function moveItem(
  { db, bus }: Deps,
  caller: Caller,
  input: {
    orgId: string
    id: string
    listId?: string | null
    parentId?: string | null
    afterId: string | null
  },
  now = Date.now(),
): ItemView {
  const scope = openScope(db, { orgId: input.orgId, ...caller })
  const item = must(scope, input.id)
  const listId = input.listId ?? item.listId
  const parentId = input.parentId === undefined ? item.parentId : input.parentId
  if (input.afterId === input.id || parentId === input.id)
    throw new DomainError(
      'INVALID_INPUT',
      'Un item no puede ir dentro ni después de sí mismo',
    )
  mustList(scope, listId)
  checkParent(scope, listId, parentId)
  const children = scope.items.childCount(input.id)
  // Un item con subitems no puede volverse subitem: serían dos niveles.
  if (parentId !== null && children > 0)
    throw new DomainError(
      'INVALID_INPUT',
      'Un item con subitems no puede ser subitem',
    )
  if (
    listId !== item.listId &&
    scope.items.countInList(listId) + 1 + children > MAX_ITEMS_PER_LIST
  )
    throw new DomainError(
      'LIMIT_REACHED',
      `Una lista admite hasta ${MAX_ITEMS_PER_LIST} items`,
    )
  db.transaction(() => {
    const gap = scope.items.gap(listId, parentId, input.afterId, input.id)
    scope.items.place(
      input.id,
      { listId, parentId, position: between(gap.before, gap.after) },
      now,
    )
    scope.activity.append(
      {
        type: 'item.moved',
        entityType: 'item',
        entityId: input.id,
        via: via(caller),
      },
      now,
    )
  })()
  for (const id of new Set([item.listId, listId]))
    bus.publish({
      orgId: input.orgId,
      scope: 'list',
      listId: id,
      actorId: caller.userId,
    })
  if (listId !== item.listId)
    bus.publish({ orgId: input.orgId, scope: 'lists', actorId: caller.userId })
  return present(scope, input.orgId, must(scope, input.id))
}

/** Borrado lógico del item y sus subitems: `restoreItem` lo deshace. */
export function deleteItem(
  { db, bus }: Deps,
  caller: Caller,
  input: { orgId: string; id: string },
  now = Date.now(),
): ItemView {
  const scope = openScope(db, { orgId: input.orgId, ...caller })
  const item = must(scope, input.id)
  db.transaction(() => {
    scope.items.setDeleted(input.id, now, now)
    scope.activity.append(
      {
        type: 'item.deleted',
        entityType: 'item',
        entityId: input.id,
        via: via(caller),
      },
      now,
    )
  })()
  bus.publish({
    orgId: input.orgId,
    scope: 'list',
    listId: item.listId,
    actorId: caller.userId,
  })
  bus.publish({ orgId: input.orgId, scope: 'lists', actorId: caller.userId })
  return present(scope, input.orgId, item)
}

export function restoreItem(
  { db, bus }: Deps,
  caller: Caller,
  input: { orgId: string; id: string },
  now = Date.now(),
): ItemView {
  const scope = openScope(db, { orgId: input.orgId, ...caller })
  const item = must(scope, input.id, true)
  mustList(scope, item.listId)
  // Un subitem no vuelve solo si su padre sigue borrado: quedaría huérfano y oculto.
  if (item.parentId !== null) must(scope, item.parentId)
  db.transaction(() => {
    scope.items.setDeleted(input.id, null, now)
    scope.activity.append(
      {
        type: 'item.restored',
        entityType: 'item',
        entityId: input.id,
        via: via(caller),
      },
      now,
    )
  })()
  bus.publish({
    orgId: input.orgId,
    scope: 'list',
    listId: item.listId,
    actorId: caller.userId,
  })
  bus.publish({ orgId: input.orgId, scope: 'lists', actorId: caller.userId })
  return present(scope, input.orgId, must(scope, input.id))
}
