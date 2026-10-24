import { create } from 'zustand'

const KEY = 'mychecklist.org'

function read(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

/**
 * La org en pantalla (M7). Se recuerda entre visitas; si la persona ya no pertenece a ella (la sacaron, o está en
 * otra puerta) `useViewer` cae a la personal sin tocar lo guardado.
 */
export const useActiveOrg = create<{
  id: string | null
  set(id: string): void
}>((set) => ({
  id: read(),
  set: (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      // Recordar la org es una comodidad.
    }
    set({ id })
  },
}))

/** La org activa si sigue en la lista; si no, la personal. */
export function pickOrg<T extends { id: string; kind: 'personal' | 'team' }>(
  orgs: T[],
  activeId: string | null,
): T | null {
  return (
    orgs.find((o) => o.id === activeId) ??
    orgs.find((o) => o.kind === 'personal') ??
    null
  )
}
