import { Dock, EmptyState, IconButton, Textarea } from '@wefaber/ui'
import { Square, SquareCheck, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import type { Actions } from './actions'
import type { Item, List } from './api'
import { Composer } from './Composer'

const WIDTH = 420
/** El panel mide `WIDTH` más su margen; la lista deja ese lugar libre mientras está abierto. */
const INSET = WIDTH + 16

const when = (iso: string) =>
  new Date(iso).toLocaleString('es-UY', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

/** Detalle del item en el panel de la derecha (DESIGN.md › Shell): flota sobre la lista, no le saca ancho. */
export function ItemDock({
  item,
  items,
  lists,
  actions,
  onClose,
}: {
  item: Item | null
  items: Item[]
  lists: List[]
  actions: Actions
  onClose: () => void
}) {
  const open = item !== null
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--dock-inset',
      open ? `${INSET}px` : '0px',
    )
    return () =>
      document.documentElement.style.setProperty('--dock-inset', '0px')
  }, [open])
  return (
    <Dock open={open} width={WIDTH}>
      {item ? (
        <DockBody
          key={item.id}
          item={item}
          items={items}
          lists={lists}
          actions={actions}
          onClose={onClose}
        />
      ) : null}
    </Dock>
  )
}

function DockBody({
  item,
  items,
  lists,
  actions,
  onClose,
}: {
  item: Item
  items: Item[]
  lists: List[]
  actions: Actions
  onClose: () => void
}) {
  // Mientras se escribe vale el borrador; si no, el texto del servidor (así un cambio de otro dispositivo se refleja).
  const [draft, setDraft] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const text = draft ?? item.text
  const children = items.filter((i) => i.parentId === item.id)
  const parent = item.parentId
    ? items.find((i) => i.id === item.parentId)
    : null

  const save = async () => {
    if (draft === null) return
    const next = draft
    setDraft(null)
    if (!next.trim() || next.trim() === item.text) return
    if (await actions.editText(item, next)) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    }
  }

  return (
    <div
      role="complementary"
      aria-label={t('dock.title')}
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-panel border border-border bg-surface p-4 shadow-float"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-h3 font-semibold">{t('dock.title')}</h2>
        <IconButton
          label={t('dock.close')}
          icon={<X size={18} />}
          onClick={onClose}
        />
      </header>

      {parent ? (
        <p className="text-meta text-muted">
          {t('dock.parent', { text: parent.text })}
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="dock-text" className="text-meta font-medium">
          {t('dock.text')}
        </label>
        <Textarea
          id="dock-text"
          value={text}
          rows={4}
          maxLength={4000}
          aria-describedby="dock-text-help"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              void save()
            }
          }}
        />
        <p
          id="dock-text-help"
          className="flex items-center justify-between gap-2 text-meta text-muted"
        >
          <span>{t('dock.textHelp')}</span>
          <span role="status" className="text-success">
            {saved ? t('dock.saved') : ''}
          </span>
        </p>
      </div>

      <button
        type="button"
        role="checkbox"
        aria-checked={item.done}
        onClick={() => actions.setDone(item, !item.done)}
        className="flex items-center gap-2 self-start rounded-control px-1 py-1 text-body"
      >
        {item.done ? (
          <SquareCheck aria-hidden size={18} className="text-accent" />
        ) : (
          <Square aria-hidden size={18} className="text-muted" />
        )}
        {t('dock.done')}
      </button>

      {!item.parentId ? (
        <section aria-labelledby="dock-subs" className="flex flex-col gap-2">
          <h3 id="dock-subs" className="text-body font-semibold">
            {t('dock.subitems')}
          </h3>
          {children.length === 0 ? (
            <EmptyState>{t('dock.noSubitems')}</EmptyState>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {children.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center gap-1 rounded-card bg-surface-2 py-0.5 pr-1"
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={c.done}
                    aria-label={t('item.toggle', { text: c.text })}
                    onClick={() => actions.setDone(c, !c.done)}
                    className="grid size-8 shrink-0 place-items-center rounded-control"
                  >
                    {c.done ? (
                      <SquareCheck
                        aria-hidden
                        size={16}
                        className="text-accent"
                      />
                    ) : (
                      <Square aria-hidden size={16} className="text-muted" />
                    )}
                  </button>
                  <span
                    className={`min-w-0 flex-1 break-words text-body ${c.done ? 'text-muted line-through' : ''}`}
                  >
                    {c.text}
                  </span>
                  <IconButton
                    label={`${t('item.delete')}: ${c.text}`}
                    icon={<Trash2 size={14} />}
                    onClick={() => actions.deleteItem(c)}
                  />
                </li>
              ))}
            </ul>
          )}
          <Composer
            label={t('dock.subLabel')}
            placeholder={t('dock.subPlaceholder')}
            density="compact"
            onSubmit={(value) =>
              actions.createItem(item.listId, value, {
                parentId: item.id,
                afterId: children.at(-1)?.id ?? null,
              })
            }
          />
        </section>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="dock-list" className="text-meta font-medium">
          {t('dock.list')}
        </label>
        <select
          id="dock-list"
          value={item.listId}
          onChange={(e) =>
            actions.moveItem(items, item, {
              listId: e.target.value,
              parentId: null,
              afterId: null,
            })
          }
          className="h-10 w-full rounded-control border border-border bg-surface px-3 text-body-lg text-text"
        >
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>

      <footer className="mt-auto flex flex-col gap-1 border-t border-border pt-3 text-meta text-muted">
        <span>{t('dock.created', { date: when(item.createdAt) })}</span>
        <span>{t('dock.updated', { date: when(item.updatedAt) })}</span>
      </footer>
    </div>
  )
}
