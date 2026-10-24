import { create } from 'zustand'

/** Estado de las capas que cuelgan de toda la app (paleta, ayuda de atajos, alta de lista). */
type UiState = {
  paletteOpen: boolean
  shortcutsOpen: boolean
  newListOpen: boolean
  transferOpen: boolean
  setPalette(open: boolean): void
  setShortcuts(open: boolean): void
  setNewList(open: boolean): void
  setTransfer(open: boolean): void
}

export const useUi = create<UiState>((set) => ({
  paletteOpen: false,
  shortcutsOpen: false,
  newListOpen: false,
  transferOpen: false,
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setShortcuts: (shortcutsOpen) => set({ shortcutsOpen }),
  setNewList: (newListOpen) => set({ newListOpen }),
  setTransfer: (transferOpen) => set({ transferOpen }),
}))
