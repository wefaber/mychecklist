import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { t } from '../../i18n'
import { gql, GraphQLRequestError } from '../../lib/graphql'
import { useToast } from '../../lib/toast'
import { keys, MENTION, type Item, type List } from './api'
import { previousSibling, type Placement } from './tree'
import { useUndoStack } from './undo'

const LIST = 'id name position open total'
const ITEM = `id listId parentId position text done doneAt createdAt updatedAt mentions { ${MENTION} }`

/** Llamadas crudas al servidor, sin deshacer ni avisos: las usan las acciones y también sus inversas. */
function raw(orgId: string) {
  const o = { o: orgId }
  return {
    createList: (name: string, afterId: string | null) =>
      gql<{ createList: List }>(
        `mutation($o: ID!, $n: String!, $a: ID) { createList(orgId: $o, name: $n, afterId: $a) { ${LIST} } }`,
        { ...o, n: name, a: afterId },
      ).then((r) => r.createList),
    renameList: (id: string, name: string) =>
      gql(
        `mutation($o: ID!, $id: ID!, $n: String!) { renameList(orgId: $o, id: $id, name: $n) { id } }`,
        { ...o, id, n: name },
      ),
    moveList: (id: string, afterId: string | null) =>
      gql(
        `mutation($o: ID!, $id: ID!, $a: ID) { moveList(orgId: $o, id: $id, afterId: $a) { id } }`,
        { ...o, id, a: afterId },
      ),
    deleteList: (id: string) =>
      gql(
        `mutation($o: ID!, $id: ID!) { deleteList(orgId: $o, id: $id) { id } }`,
        { ...o, id },
      ),
    restoreList: (id: string) =>
      gql(
        `mutation($o: ID!, $id: ID!) { restoreList(orgId: $o, id: $id) { id } }`,
        { ...o, id },
      ),
    createItem: (
      listId: string,
      text: string,
      place: { parentId?: string | null; afterId?: string | null },
    ) =>
      gql<{ createItem: Item }>(
        `mutation($o: ID!, $l: ID!, $t: String!, $p: ID, $a: ID) { createItem(orgId: $o, listId: $l, text: $t, parentId: $p, afterId: $a) { ${ITEM} } }`,
        {
          ...o,
          l: listId,
          t: text,
          p: place.parentId ?? null,
          a: place.afterId ?? null,
        },
      ).then((r) => r.createItem),
    setDone: (id: string, done: boolean) =>
      gql(
        `mutation($o: ID!, $id: ID!, $d: Boolean!) { setItemDone(orgId: $o, id: $id, done: $d) { id } }`,
        { ...o, id, d: done },
      ),
    editText: (id: string, text: string) =>
      gql(
        `mutation($o: ID!, $id: ID!, $t: String!) { updateItemText(orgId: $o, id: $id, text: $t) { id } }`,
        { ...o, id, t: text },
      ),
    moveItem: (id: string, listId: string, place: Placement) =>
      gql(
        `mutation($o: ID!, $id: ID!, $l: ID, $p: ID, $a: ID) { moveItem(orgId: $o, id: $id, listId: $l, parentId: $p, afterId: $a) { id } }`,
        { ...o, id, l: listId, p: place.parentId, a: place.afterId },
      ),
    deleteItem: (id: string) =>
      gql(
        `mutation($o: ID!, $id: ID!) { deleteItem(orgId: $o, id: $id) { id } }`,
        { ...o, id },
      ),
    restoreItem: (id: string) =>
      gql(
        `mutation($o: ID!, $id: ID!) { restoreItem(orgId: $o, id: $id) { id } }`,
        { ...o, id },
      ),
  }
}

const KNOWN = new Set([
  'INVALID_INPUT',
  'LIMIT_REACHED',
  'NOT_FOUND',
  'FORBIDDEN',
])

/** El mensaje del servidor ya viene en español; lo que no es un fallo del dominio sale genérico. */
export function errorText(e: unknown): string {
  return e instanceof GraphQLRequestError && e.code && KNOWN.has(e.code)
    ? e.message
    : t('error.generic')
}

function refresh(client: QueryClient, orgId: string) {
  void client.invalidateQueries({ queryKey: ['lists', orgId] })
  void client.invalidateQueries({ queryKey: ['items', orgId] })
  void client.invalidateQueries({ queryKey: ['backlinks', orgId] })
}

/** Deshace la última acción (botón del aviso y `Mod+Z`). */
export async function undoLast() {
  const entry = useUndoStack.getState().pop()
  const { show } = useToast.getState()
  if (!entry) {
    show({ kind: 'info', text: t('undo.nothing') })
    return
  }
  try {
    await entry.undo()
    show({ kind: 'info', text: t('undo.done', { label: entry.label }) })
  } catch (e) {
    show({ kind: 'error', text: errorText(e) })
  }
}

/**
 * Todas las acciones de la pantalla. Cada una llama al servidor, avisa si falla y, si se puede deshacer, deja su
 * inversa en la pila y ofrece "Deshacer" en el aviso (DESIGN.md: deshacer, no confirmar).
 */
export function useActions(orgId: string) {
  const client = useQueryClient()
  const api = raw(orgId)
  const { show } = useToast.getState()

  async function attempt<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
      const result = await fn()
      refresh(client, orgId)
      return result
    } catch (e) {
      show({ kind: 'error', text: errorText(e) })
      refresh(client, orgId)
      return null
    }
  }

  /** Registra la inversa; `inverse` corre sin avisos propios y refresca al terminar. */
  function undoable(
    label: string,
    text: string,
    inverse: () => Promise<unknown>,
  ) {
    useUndoStack.getState().push({
      label,
      undo: async () => {
        await inverse()
        refresh(client, orgId)
      },
    })
    show({
      kind: 'info',
      text,
      action: { label: t('undo.action'), run: () => void undoLast() },
    })
  }

  return {
    createList: (name: string, afterId: string | null) =>
      attempt(() => api.createList(name, afterId)),

    async renameList(list: List, name: string) {
      const ok = await attempt(() => api.renameList(list.id, name))
      if (ok)
        undoable(t('undo.renameList'), t('toast.listRenamed'), () =>
          api.renameList(list.id, list.name),
        )
    },

    async moveList(lists: List[], list: List, afterId: string | null) {
      const at = lists.findIndex((l) => l.id === list.id)
      const prevAfter = at > 0 ? lists[at - 1]!.id : null
      const ok = await attempt(() => api.moveList(list.id, afterId))
      if (ok)
        undoable(t('undo.moveList'), t('toast.listMoved'), () =>
          api.moveList(list.id, prevAfter),
        )
    },

    async deleteList(list: List) {
      const ok = await attempt(() => api.deleteList(list.id))
      if (ok)
        undoable(
          t('undo.deleteList'),
          t('toast.listDeleted', { name: list.name }),
          () => api.restoreList(list.id),
        )
      return ok !== null
    },

    async createItem(
      listId: string,
      text: string,
      place: { parentId?: string | null; afterId?: string | null } = {},
    ) {
      const item = await attempt(() => api.createItem(listId, text, place))
      if (item)
        useUndoStack.getState().push({
          label: t('undo.createItem'),
          undo: async () => {
            await api.deleteItem(item.id)
            refresh(client, orgId)
          },
        })
      return item
    },

    async setDone(item: Item, done: boolean) {
      // Optimista: la casilla responde al instante; el servidor confirma o se revierte con el refresco.
      client.setQueryData<Item[]>(keys.items(orgId, item.listId), (old) =>
        old?.map((i) => (i.id === item.id ? { ...i, done } : i)),
      )
      const ok = await attempt(() => api.setDone(item.id, done))
      if (ok)
        useUndoStack.getState().push({
          label: done ? t('undo.complete') : t('undo.reopen'),
          undo: async () => {
            await api.setDone(item.id, !done)
            refresh(client, orgId)
          },
        })
    },

    async editText(item: Item, text: string) {
      if (text.trim() === item.text) return true
      const ok = await attempt(() => api.editText(item.id, text))
      if (ok)
        undoable(t('undo.editItem'), t('toast.itemEdited'), () =>
          api.editText(item.id, item.text),
        )
      return ok !== null
    },

    /** Mueve `item` (en `items`, la lista que se está viendo) a `to`; sin `listId` se queda en su lista. */
    async moveItem(
      items: Item[],
      item: Item,
      to: Placement & { listId?: string },
    ) {
      const prev: Placement = {
        parentId: item.parentId,
        afterId: previousSibling(items, item)?.id ?? null,
      }
      const listId = to.listId ?? item.listId
      const ok = await attempt(() => api.moveItem(item.id, listId, to))
      if (ok)
        undoable(t('undo.moveItem'), t('toast.itemMoved'), () =>
          api.moveItem(item.id, item.listId, prev),
        )
      return ok !== null
    },

    async deleteItem(item: Item) {
      const ok = await attempt(() => api.deleteItem(item.id))
      if (ok)
        undoable(t('undo.deleteItem'), t('toast.itemDeleted'), () =>
          api.restoreItem(item.id),
        )
      return ok !== null
    },
  }
}

export type Actions = ReturnType<typeof useActions>
