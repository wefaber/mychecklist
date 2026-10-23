import { create } from 'zustand'

export type Toast = {
  id: number
  text: string
  kind: 'info' | 'error'
  /** Acción del aviso (por ejemplo, Deshacer). */
  action?: { label: string; run: () => void }
}

type ToastState = {
  toast: Toast | null
  show(toast: Omit<Toast, 'id'>): void
  dismiss(): void
}

let next = 1
let timer: ReturnType<typeof setTimeout> | undefined

/** Un aviso a la vez, abajo, con región `aria-live`. Los errores duran más que las confirmaciones. */
export const useToast = create<ToastState>((set) => ({
  toast: null,
  show(toast) {
    clearTimeout(timer)
    set({ toast: { ...toast, id: next++ } })
    timer = setTimeout(
      () => set({ toast: null }),
      toast.kind === 'error' ? 8000 : 6000,
    )
  },
  dismiss() {
    clearTimeout(timer)
    set({ toast: null })
  },
}))
