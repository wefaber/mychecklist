/** Qué cambió en una org; el cliente invalida lo que tenga en pantalla y vuelve a pedirlo por GraphQL. */
export type ChangeEvent = {
  orgId: string
  /**
   * `lists` = cambió el conjunto, el orden o los contadores de listas; `list` = cambió el contenido de `listId`;
   * `members` = cambiaron los miembros, sus roles o las invitaciones de la org.
   */
  scope: 'lists' | 'list' | 'members'
  listId?: string
  actorId: string
}

export type Bus = {
  publish(event: ChangeEvent): void
  subscribe(orgId: string, fn: (event: ChangeEvent) => void): () => void
}

/**
 * Bus en memoria de un proceso: los dos listeners comparten uno. Con un solo proceso por slot alcanza; si hubiera más
 * de uno, el SSE de un slot no vería los cambios del otro hasta recargar (se documenta en ARCHITECTURE.md).
 */
export function createBus(): Bus {
  const subs = new Map<string, Set<(event: ChangeEvent) => void>>()
  return {
    publish(event) {
      for (const fn of subs.get(event.orgId) ?? []) fn(event)
    },
    subscribe(orgId, fn) {
      let set = subs.get(orgId)
      if (!set) subs.set(orgId, (set = new Set()))
      set.add(fn)
      return () => {
        set.delete(fn)
        if (!set.size) subs.delete(orgId)
      }
    },
  }
}
