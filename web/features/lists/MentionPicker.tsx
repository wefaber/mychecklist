import { Dialog } from '@wefaber/ui'
import { Square, SquareCheck } from 'lucide-react'
import { titleOf } from '@shared/title'
import { useEffect, useRef, useState } from 'react'
import { TextField } from '../../components/TextField'
import { t } from '../../i18n'
import { useSearch, type Hit } from './api'

/**
 * Elegir el item que se menciona con `[[id]]`: busca en el servidor, igual que la paleta, y devuelve el id. Se abre con
 * el botón del detalle o al escribir `[[` en el texto.
 */
export function MentionPicker({
  open,
  orgId,
  exclude,
  onPick,
  onClose,
}: {
  open: boolean
  orgId: string
  /** El item que se está editando: mencionarse a sí mismo no sirve. */
  exclude: string
  onPick: (id: string, hit: Hit) => void
  onClose: () => void
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('mention.title')}
      closeLabel={t('toast.dismiss')}
      className="self-start sm:mt-[12vh]"
    >
      <PickerBody orgId={orgId} exclude={exclude} onPick={onPick} />
    </Dialog>
  )
}

function PickerBody({
  orgId,
  exclude,
  onPick,
}: {
  orgId: string
  exclude: string
  onPick: (id: string, hit: Hit) => void
}) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const hits = (useSearch(orgId, debounced).data ?? []).filter(
    (h) => h.id !== exclude,
  )
  const at = Math.min(active, Math.max(hits.length - 1, 0))

  useEffect(() => {
    // El diálogo enfoca su botón de cerrar; el selector quiere el campo.
    const id = requestAnimationFrame(() => input.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [])
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 150)
    return () => clearTimeout(id)
  }, [query])

  return (
    <div
      className="flex flex-col gap-3"
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          const n = hits.length
          if (n) setActive((at + (e.key === 'ArrowDown' ? 1 : -1) + n) % n)
        } else if (e.key === 'Enter') {
          e.preventDefault()
          const hit = hits[at]
          if (hit) onPick(hit.id, hit)
        }
      }}
    >
      <TextField
        ref={input}
        role="combobox"
        aria-expanded
        aria-controls="mention-list"
        aria-activedescendant={hits[at] ? `mention-${hits[at].id}` : undefined}
        aria-label={t('mention.label')}
        placeholder={t('mention.placeholder')}
        value={query}
        autoComplete="off"
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
        }}
      />
      <div
        id="mention-list"
        role="listbox"
        aria-label={t('mention.title')}
        className="flex max-h-[50vh] flex-col gap-0.5 overflow-y-auto"
      >
        {debounced.trim() && hits.length === 0 ? (
          <p className="px-1 text-body text-muted">{t('mention.empty')}</p>
        ) : (
          hits.map((h, i) => {
            const Icon = h.done ? SquareCheck : Square
            return (
              <div
                key={h.id}
                id={`mention-${h.id}`}
                role="option"
                aria-selected={i === at}
                onClick={() => onPick(h.id, h)}
                onMouseMove={() => setActive(i)}
                className={`flex cursor-pointer items-center gap-2 rounded-control px-2 py-2 text-body ${i === at ? 'bg-text/12' : ''}`}
              >
                <Icon aria-hidden size={14} className="shrink-0 text-muted" />
                <span
                  className={`min-w-0 flex-1 truncate ${h.done ? 'line-through' : ''}`}
                >
                  {titleOf(h.text) || t('md.untitled')}
                </span>
                <span className="shrink-0 text-meta text-muted">
                  {t('mention.inList', { name: h.listName })}
                </span>
              </div>
            )
          })
        )}
      </div>
      <p className="text-meta text-muted">{t('mention.hint')}</p>
    </div>
  )
}
