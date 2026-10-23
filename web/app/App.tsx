import { EmptyState, Tile } from '@wefaber/ui'
import { useQuery } from '@tanstack/react-query'
import { CircleAlert, CircleCheck, LoaderCircle } from 'lucide-react'
import { apiUrl } from '../lib/server'

type Status = 'cargando' | 'listo' | 'caído'

/** Pregunta a `/ready`: el mismo chequeo que usa el deploy antes de cambiar de slot. */
function useServerStatus(): Status {
  const { status } = useQuery({
    queryKey: ['ready'],
    queryFn: async () => {
      const res = await fetch(apiUrl('/ready'))
      if (!res.ok) throw new Error(`ready ${res.status}`)
      return true
    },
    refetchInterval: 30_000,
  })
  return status === 'pending'
    ? 'cargando'
    : status === 'success'
      ? 'listo'
      : 'caído'
}

const LABEL: Record<Status, string> = {
  cargando: 'Conectando con el servidor…',
  listo: 'Servidor listo.',
  caído: 'No se pudo conectar con el servidor. Reintentamos solos.',
}

export function App() {
  const status = useServerStatus()
  const Icon =
    status === 'cargando'
      ? LoaderCircle
      : status === 'listo'
        ? CircleCheck
        : CircleAlert
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 p-4">
      <h1 className="font-display text-2xl">MyChecklist</h1>
      <Tile title="Tus listas">
        <EmptyState>
          Todavía no hay listas. Las listas, los items y el login con GitHub
          llegan en los próximos pasos.
        </EmptyState>
      </Tile>
      <p
        role="status"
        className={`flex items-center gap-2 text-meta ${status === 'caído' ? 'text-danger' : 'text-muted'}`}
      >
        <Icon aria-hidden size={14} />
        {LABEL[status]}
      </p>
    </main>
  )
}
