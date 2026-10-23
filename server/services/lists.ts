import { between } from '../../shared/order'
import { ulid } from '../db/ids'
import { openScope, type ListRow, type Scope } from '../db/scoped'
import { DomainError } from '../errors'
import type { Caller, Deps } from './types'
import { cleanText, MAX_LISTS, MAX_NAME } from './validate'

export type ListView = {
  id: string
  orgId: string
  name: string
  position: string
  open: number
  total: number
}

const view = (orgId: string, l: ListRow): ListView => ({
  id: l.id,
  orgId,
  name: l.name,
  position: l.position,
  open: l.open,
  total: l.total,
})

function must(scope: Scope, id: string, withDeleted = false): ListRow {
  const list = scope.lists.get(id, withDeleted)
  if (!list) throw new DomainError('NOT_FOUND', 'La lista no existe')
  return list
}

const via = (c: Caller) => c.via ?? 'web'

export function listLists(
  { db }: Pick<Deps, 'db'>,
  caller: Caller,
  orgId: string,
): ListView[] {
  const scope = openScope(db, { orgId, ...caller })
  return scope.lists.all().map((l) => view(orgId, l))
}

export function getList(
  { db }: Pick<Deps, 'db'>,
  caller: Caller,
  orgId: string,
  id: string,
): ListView {
  const scope = openScope(db, { orgId, ...caller })
  return view(orgId, must(scope, id))
}

/** Crea una lista después de `afterId`; con `null` va al principio (el cliente pasa la última para ir al final). */
export function createList(
  { db, bus }: Deps,
  caller: Caller,
  input: { orgId: string; name: string; afterId: string | null },
  now = Date.now(),
): ListView {
  const name = cleanText(input.name, { max: MAX_NAME, label: 'El nombre' })
  const scope = openScope(db, { orgId: input.orgId, ...caller })
  if (scope.lists.count() >= MAX_LISTS)
    throw new DomainError(
      'LIMIT_REACHED',
      `Una organización admite hasta ${MAX_LISTS} listas`,
    )
  const id = ulid(now)
  db.transaction(() => {
    const gap = scope.lists.gap(input.afterId)
    scope.lists.insert(
      { id, name, position: between(gap.before, gap.after) },
      now,
    )
    scope.activity.append(
      {
        type: 'list.created',
        entityType: 'list',
        entityId: id,
        via: via(caller),
      },
      now,
    )
  })()
  bus.publish({ orgId: input.orgId, scope: 'lists', actorId: caller.userId })
  return view(input.orgId, must(scope, id))
}

export function renameList(
  { db, bus }: Deps,
  caller: Caller,
  input: { orgId: string; id: string; name: string },
  now = Date.now(),
): ListView {
  const name = cleanText(input.name, { max: MAX_NAME, label: 'El nombre' })
  const scope = openScope(db, { orgId: input.orgId, ...caller })
  must(scope, input.id)
  db.transaction(() => {
    scope.lists.rename(input.id, name, now)
    scope.activity.append(
      {
        type: 'list.renamed',
        entityType: 'list',
        entityId: input.id,
        via: via(caller),
      },
      now,
    )
  })()
  bus.publish({ orgId: input.orgId, scope: 'lists', actorId: caller.userId })
  return view(input.orgId, must(scope, input.id))
}

export function moveList(
  { db, bus }: Deps,
  caller: Caller,
  input: { orgId: string; id: string; afterId: string | null },
  now = Date.now(),
): ListView {
  if (input.afterId === input.id)
    throw new DomainError(
      'INVALID_INPUT',
      'Una lista no puede ir después de sí misma',
    )
  const scope = openScope(db, { orgId: input.orgId, ...caller })
  must(scope, input.id)
  db.transaction(() => {
    const gap = scope.lists.gap(input.afterId, input.id)
    scope.lists.setPosition(input.id, between(gap.before, gap.after), now)
    scope.activity.append(
      {
        type: 'list.moved',
        entityType: 'list',
        entityId: input.id,
        via: via(caller),
      },
      now,
    )
  })()
  bus.publish({ orgId: input.orgId, scope: 'lists', actorId: caller.userId })
  return view(input.orgId, must(scope, input.id))
}

/** Borrado lógico: `restoreList` lo deshace. Los items quedan intactos. */
export function deleteList(
  { db, bus }: Deps,
  caller: Caller,
  input: { orgId: string; id: string },
  now = Date.now(),
): ListView {
  const scope = openScope(db, { orgId: input.orgId, ...caller })
  const list = must(scope, input.id)
  db.transaction(() => {
    scope.lists.setDeleted(input.id, now, now)
    scope.activity.append(
      {
        type: 'list.deleted',
        entityType: 'list',
        entityId: input.id,
        via: via(caller),
      },
      now,
    )
  })()
  bus.publish({ orgId: input.orgId, scope: 'lists', actorId: caller.userId })
  return view(input.orgId, list)
}

export function restoreList(
  { db, bus }: Deps,
  caller: Caller,
  input: { orgId: string; id: string },
  now = Date.now(),
): ListView {
  const scope = openScope(db, { orgId: input.orgId, ...caller })
  must(scope, input.id, true)
  db.transaction(() => {
    scope.lists.setDeleted(input.id, null, now)
    scope.activity.append(
      {
        type: 'list.restored',
        entityType: 'list',
        entityId: input.id,
        via: via(caller),
      },
      now,
    )
  })()
  bus.publish({ orgId: input.orgId, scope: 'lists', actorId: caller.userId })
  return view(input.orgId, must(scope, input.id))
}
