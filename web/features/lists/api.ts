import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { gql } from '../../lib/graphql'
import type { Mention } from '../../lib/mentions'
import { apiUrl } from '../../lib/server'

export type List = {
  id: string
  name: string
  position: string
  open: number
  total: number
}

export type Item = {
  id: string
  listId: string
  parentId: string | null
  position: string
  text: string
  done: boolean
  doneAt: string | null
  createdAt: string
  updatedAt: string
  /** Items vivos que el texto enlaza con `[[id]]`. */
  mentions: Mention[]
}

export type Hit = {
  id: string
  listId: string
  listName: string
  text: string
  done: boolean
}

const LIST = 'id name position open total'
export const MENTION = 'id listId listName title done'
const ITEM = `id listId parentId position text done doneAt createdAt updatedAt mentions { ${MENTION} }`

export const keys = {
  lists: (orgId: string) => ['lists', orgId] as const,
  items: (orgId: string, listId: string) => ['items', orgId, listId] as const,
  search: (orgId: string, q: string) => ['search', orgId, q] as const,
  backlinks: (orgId: string, itemId: string) =>
    ['backlinks', orgId, itemId] as const,
}

export function useLists(orgId: string | null) {
  return useQuery({
    queryKey: keys.lists(orgId ?? ''),
    enabled: orgId !== null,
    queryFn: async () =>
      (
        await gql<{ org: { lists: List[] } }>(
          `query($o: ID!) { org(id: $o) { lists { ${LIST} } } }`,
          { o: orgId },
        )
      ).org.lists,
  })
}

export function useItems(orgId: string | null, listId: string | null) {
  return useQuery({
    queryKey: keys.items(orgId ?? '', listId ?? ''),
    enabled: orgId !== null && listId !== null,
    queryFn: async () =>
      (
        await gql<{ org: { list: { items: Item[] } } }>(
          `query($o: ID!, $l: ID!) { org(id: $o) { list(id: $l) { items { ${ITEM} } } } }`,
          { o: orgId, l: listId },
        )
      ).org.list.items,
  })
}

/** Items que mencionan a `itemId`; se vuelve a pedir cuando cambia cualquier cosa de la org. */
export function useBacklinks(orgId: string | null, itemId: string | null) {
  return useQuery({
    queryKey: keys.backlinks(orgId ?? '', itemId ?? ''),
    enabled: orgId !== null && itemId !== null,
    queryFn: async () =>
      (
        await gql<{ org: { item: { backlinks: Mention[] } | null } }>(
          `query($o: ID!, $i: ID!) { org(id: $o) { item(id: $i) { backlinks { ${MENTION} } } } }`,
          { o: orgId, i: itemId },
        )
      ).org.item?.backlinks ?? [],
  })
}

/** Búsqueda en el servidor para la paleta; con texto vacío no pide nada. */
export function useSearch(orgId: string | null, query: string) {
  const q = query.trim()
  return useQuery({
    queryKey: keys.search(orgId ?? '', q),
    enabled: orgId !== null && q.length > 0,
    staleTime: 5_000,
    queryFn: async () =>
      (
        await gql<{ org: { search: Hit[] } }>(
          `query($o: ID!, $q: String!) { org(id: $o) { search(query: $q, first: 8) { id listId listName text done } } }`,
          { o: orgId, q },
        )
      ).org.search,
  })
}

/**
 * Cambios de otras pestañas, dispositivos o agentes: el servidor avisa por SSE y acá se invalida lo que haya en
 * pantalla. `EventSource` reconecta solo; al volver se refresca todo por si se perdió algún aviso.
 */
export function useOrgEvents(orgId: string | null) {
  const client = useQueryClient()
  useEffect(() => {
    if (!orgId) return
    const source = new EventSource(
      apiUrl(`/events?org=${encodeURIComponent(orgId)}`),
      {
        withCredentials: true,
      },
    )
    const refreshAll = () => {
      void client.invalidateQueries({ queryKey: ['lists', orgId] })
      void client.invalidateQueries({ queryKey: ['items', orgId] })
      void client.invalidateQueries({ queryKey: ['backlinks', orgId] })
    }
    source.addEventListener('change', (e) => {
      const data = JSON.parse((e as MessageEvent<string>).data) as {
        scope: 'lists' | 'list'
        listId: string | null
      }
      if (data.scope === 'lists')
        void client.invalidateQueries({ queryKey: ['lists', orgId] })
      else {
        // Un cambio en una lista puede mover el título de un chip o un backlink en cualquier otra: se pide todo lo que
        // esté en pantalla (las listas que no se ven quedan viejas y se piden al abrirlas).
        void client.invalidateQueries({ queryKey: ['items', orgId] })
        void client.invalidateQueries({ queryKey: ['backlinks', orgId] })
      }
    })
    source.addEventListener('open', refreshAll)
    return () => source.close()
  }, [orgId, client])
}
