import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { gql } from '../../lib/graphql'
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
}

export type Hit = {
  id: string
  listId: string
  listName: string
  text: string
  done: boolean
}

const LIST = 'id name position open total'
const ITEM = 'id listId parentId position text done doneAt createdAt updatedAt'

export const keys = {
  lists: (orgId: string) => ['lists', orgId] as const,
  items: (orgId: string, listId: string) => ['items', orgId, listId] as const,
  search: (orgId: string, q: string) => ['search', orgId, q] as const,
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
    }
    source.addEventListener('change', (e) => {
      const data = JSON.parse((e as MessageEvent<string>).data) as {
        scope: 'lists' | 'list'
        listId: string | null
      }
      if (data.scope === 'lists')
        void client.invalidateQueries({ queryKey: ['lists', orgId] })
      else
        void client.invalidateQueries({
          queryKey: data.listId
            ? keys.items(orgId, data.listId)
            : ['items', orgId],
        })
    })
    source.addEventListener('open', refreshAll)
    return () => source.close()
  }, [orgId, client])
}
