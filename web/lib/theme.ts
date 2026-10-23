import { create } from 'zustand'

export const PALETTES = ['forest', 'azul', 'teal', 'vault'] as const
export type Palette = (typeof PALETTES)[number]
export type Mode = 'dark' | 'light'

const PALETTE_KEY = 'mychecklist.palette'
const MODE_KEY = 'mychecklist.mode'

/** Vault es solo claro: ahí el modo no se elige. */
export const lightOnly = (palette: Palette) => palette === 'vault'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Sin almacenamiento el tema vale para esta sesión.
  }
}

export function initialPalette(): Palette {
  const saved = read(PALETTE_KEY)
  return PALETTES.find((p) => p === saved) ?? 'forest'
}

export function initialMode(): Mode {
  const saved = read(MODE_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

/** Pone los atributos que leen los selectores de `palettes.css`. El script de `index.html` hace lo mismo antes del primer render. */
export function applyTheme(palette: Palette, mode: Mode) {
  const root = document.documentElement
  root.dataset.palette = palette
  root.dataset.theme = lightOnly(palette) ? 'light' : mode
}

type ThemeState = {
  palette: Palette
  mode: Mode
  setPalette(palette: Palette): void
  setMode(mode: Mode): void
}

export const useTheme = create<ThemeState>((set, get) => ({
  palette: initialPalette(),
  mode: initialMode(),
  setPalette(palette) {
    write(PALETTE_KEY, palette)
    set({ palette })
    applyTheme(palette, get().mode)
  },
  setMode(mode) {
    write(MODE_KEY, mode)
    set({ mode })
    applyTheme(get().palette, mode)
  },
}))
