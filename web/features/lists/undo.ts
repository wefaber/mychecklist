import { create } from 'zustand'

/** Una acción deshacible: `undo` ejecuta la inversa (restaurar, volver a mover, reabrir, volver el texto). */
export type UndoEntry = { label: string; undo: () => Promise<unknown> }

const LIMIT = 50

type UndoState = {
  stack: UndoEntry[]
  push(entry: UndoEntry): void
  /** Saca y devuelve la última; el que llama la ejecuta. */
  pop(): UndoEntry | null
  clear(): void
}

export const useUndoStack = create<UndoState>((set, get) => ({
  stack: [],
  push(entry) {
    set({ stack: [...get().stack, entry].slice(-LIMIT) })
  },
  pop() {
    const stack = get().stack
    const entry = stack.at(-1) ?? null
    if (entry) set({ stack: stack.slice(0, -1) })
    return entry
  },
  clear() {
    set({ stack: [] })
  },
}))
