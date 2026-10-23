import { isTyping } from '@wefaber/ui'
import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import type { MessageKey } from '../i18n/es'

/**
 * Un solo registro de atajos (DESIGN.md › Navigation): la paleta, el diálogo `?` y el teclado leen de acá.
 * `keys` va como en `@wefaber/ui` (`Kbd`): pasos separados por espacio, teclas unidas con `+`, `Mod` = Ctrl o Cmd.
 */
export type Shortcut = {
  id: string
  keys: string
  label: MessageKey
  group: MessageKey
  run: () => void
  /** Si es `false` el atajo no se ofrece (por ejemplo, sin una lista abierta). */
  enabled?: boolean
  /** Los atajos de una sola tecla no se disparan mientras se escribe; los de `Mod` sí. */
  allowTyping?: boolean
  /** Lo resuelve el propio componente (una fila, un diálogo): el registro solo lo lista en la ayuda. */
  local?: boolean
}

const MODS = new Set(['Mod', 'Alt', 'Shift'])

export type KeyLike = {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/** ¿El evento es este paso (`Mod+K`, `Alt+ArrowUp`, `?`)? Shift cuenta solo si el paso lo pide o la tecla ya es un símbolo. */
export function matchesStep(e: KeyLike, step: string): boolean {
  const parts = step.split('+')
  const key = parts.at(-1)!
  const mods = new Set(parts.slice(0, -1).filter((p) => MODS.has(p)))
  const mod = e.ctrlKey || e.metaKey
  if (mods.has('Mod') !== mod) return false
  if (mods.has('Alt') !== e.altKey) return false
  const symbol = key.length === 1 && !/[a-z0-9]/i.test(key)
  if (!symbol && mods.has('Shift') !== e.shiftKey) return false
  return e.key.length === 1
    ? e.key.toLowerCase() === key.toLowerCase()
    : e.key === key
}

type Registry = {
  shortcuts: Shortcut[]
  set(owner: string, list: Shortcut[]): void
  clear(owner: string): void
  owners: Record<string, Shortcut[]>
}

export const useRegistry = create<Registry>((set, get) => ({
  shortcuts: [],
  owners: {},
  set(owner, list) {
    const owners = { ...get().owners, [owner]: list }
    set({ owners, shortcuts: Object.values(owners).flat() })
  },
  clear(owner) {
    const { [owner]: _, ...owners } = get().owners
    set({ owners, shortcuts: Object.values(owners).flat() })
  },
}))

/** Registra los atajos de una parte de la pantalla mientras está montada. */
export function useShortcuts(owner: string, list: Shortcut[]) {
  useEffect(() => {
    useRegistry.getState().set(owner, list)
  })
  useEffect(() => () => useRegistry.getState().clear(owner), [owner])
}

const CHORD_MS = 1200

/** Escucha el teclado una sola vez para toda la app. Un acorde (`G L`) espera el segundo paso 1,2 s. */
export function useShortcutListener() {
  const pending = useRef<{ steps: string[]; at: number }>({ steps: [], at: 0 })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented) return
      if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) return
      const typing = isTyping(e.target)
      const list = useRegistry
        .getState()
        .shortcuts.filter((s) => s.enabled !== false && !s.local)
      const now = performance.now()
      const done =
        pending.current.steps.length && now - pending.current.at < CHORD_MS
      const before = done ? pending.current.steps : []
      pending.current = { steps: [], at: now }

      let chordStart: string | null = null
      for (const s of list) {
        const steps = s.keys.split(' ')
        const plain = !steps[0]!.includes('Mod') && !steps[0]!.includes('Alt')
        if (typing && plain && !s.allowTyping) continue
        if (steps.length <= before.length) continue
        if (!before.every((k, i) => steps[i] === k)) continue
        const step = steps[before.length]!
        if (!matchesStep(e, step)) continue
        if (steps.length === before.length + 1) {
          e.preventDefault()
          s.run()
          return
        }
        chordStart ??= step
      }
      if (chordStart) {
        e.preventDefault()
        pending.current = { steps: [...before, chordStart], at: now }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
