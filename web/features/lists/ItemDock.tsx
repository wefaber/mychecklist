import { useNavigate } from '@tanstack/react-router'
import { titleOf } from '@shared/title'
import { Dock, EmptyState, IconButton } from '@wefaber/ui'
import { AtSign, Paperclip, Square, SquareCheck, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { TextArea } from '../../components/TextField'
import { t } from '../../i18n'
import { Markdown } from '../../lib/markdown'
import type { Mention } from '../../lib/mentions'
import { useToast } from '../../lib/toast'
import { errorText, type Actions } from './actions'
import { useBacklinks, type Item, type List } from './api'
import {
  asBlock,
  attachmentMarkdown,
  insertAt,
  uploadFile,
} from './attachments'
import { Composer } from './Composer'
import { MentionPicker } from './MentionPicker'

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
  orgId,
  item,
  items,
  lists,
  actions,
  onClose,
}: {
  orgId: string
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
          orgId={orgId}
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
  orgId,
  item,
  items,
  lists,
  actions,
  onClose,
}: {
  orgId: string
  item: Item
  items: Item[]
  lists: List[]
  actions: Actions
  onClose: () => void
}) {
  // Mientras se escribe vale el borrador; si no, el texto del servidor (así un cambio de otro dispositivo se refleja).
  const [draft, setDraft] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [status, setStatus] = useState('')
  // Rango del texto que reemplaza lo que se elija en el selector (el `[[` recién escrito, o el cursor).
  const [picker, setPicker] = useState<[number, number] | null>(null)
  // Items elegidos en el selector que el servidor todavía no devolvió como menciones (el texto no se guardó).
  const [picked, setPicked] = useState<Mention[]>([])
  const textarea = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  // Mientras el foco sale del campo a propósito (selector, explorador de archivos) no se guarda a medias.
  const leaving = useRef(false)
  const navigate = useNavigate()
  const backlinks = useBacklinks(orgId, item.id)
  const text = draft ?? item.text
  const children = items.filter((i) => i.parentId === item.id)
  const parent = item.parentId
    ? items.find((i) => i.id === item.parentId)
    : null

  const openItem = (m: Mention) =>
    void navigate({
      to: '/l/$listId',
      params: { listId: m.listId },
      search: { item: m.id },
    })

  /** Inserta `snippet` en `[start, end)` del texto que se ve y deja el cursor después. */
  const insert = (start: number, end: number, snippet: string) => {
    const el = textarea.current
    const base = el?.value ?? text
    const next = insertAt(base, start, end, snippet)
    setDraft(next.text)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(next.caret, next.caret)
    })
  }

  /** Sube los archivos de a uno y deja sus enlaces en el texto, en el lugar donde estaba el cursor. */
  const attach = async (files: File[], at: number) => {
    const parts: string[] = []
    for (const file of files) {
      setStatus(t('dock.uploading', { name: file.name }))
      try {
        parts.push(attachmentMarkdown(await uploadFile(orgId, file)))
      } catch (e) {
        useToast.getState().show({ kind: 'error', text: errorText(e) })
      }
    }
    if (parts.length === 0) {
      setStatus('')
      return
    }
    const base = textarea.current?.value ?? text
    const pos = Math.min(at, base.length)
    insert(pos, pos, asBlock(base, pos, parts.join('\n')))
    setStatus(t('dock.uploaded', { name: files.map((f) => f.name).join(', ') }))
  }

  const openPicker = (start: number, end: number) => {
    leaving.current = true
    setPicker([start, end])
  }

  const closePicker = () => {
    setPicker(null)
    leaving.current = false
    requestAnimationFrame(() => textarea.current?.focus())
  }

  const save = async () => {
    if (leaving.current) return
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
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="dock-text" className="text-meta font-medium">
            {t('dock.text')}
          </label>
          <div className="flex gap-0.5">
            <IconButton
              label={t('dock.mention')}
              icon={<AtSign size={16} />}
              // Con el mouse, el foco no sale del campo (así el cursor y la selección siguen donde estaban).
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const el = textarea.current
                openPicker(
                  el?.selectionStart ?? text.length,
                  el?.selectionEnd ?? text.length,
                )
              }}
            />
            <IconButton
              label={t('dock.attach')}
              icon={<Paperclip size={16} />}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => fileInput.current?.click()}
            />
          </div>
        </div>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])]
            e.target.value = ''
            if (files.length > 0)
              void attach(
                files,
                textarea.current?.selectionStart ?? text.length,
              )
          }}
        />
        <TextArea
          ref={textarea}
          id="dock-text"
          value={text}
          rows={4}
          maxLength={4000}
          aria-describedby="dock-text-help"
          onChange={(e) => {
            const value = e.target.value
            setDraft(value)
            const caret = e.target.selectionStart
            // Escribir `[[` abre el selector; lo que se elija reemplaza esos dos corchetes.
            if (
              (e.nativeEvent as InputEvent).data === '[' &&
              value.slice(caret - 2, caret) === '[['
            )
              openPicker(caret - 2, caret)
          }}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              void save()
            }
          }}
          onPaste={(e) => {
            const files = [...e.clipboardData.files]
            // Copiar una celda de una planilla trae texto y una imagen de vista previa: el texto manda.
            if (files.length === 0 || e.clipboardData.getData('text/plain'))
              return
            e.preventDefault()
            void attach(files, e.currentTarget.selectionStart)
          }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) e.preventDefault()
          }}
          onDrop={(e) => {
            const files = [...e.dataTransfer.files]
            if (files.length === 0) return
            e.preventDefault()
            void attach(files, e.currentTarget.selectionStart)
          }}
        />
        <p id="dock-text-help" className="text-meta text-muted">
          {t('dock.textHelp')}
        </p>
        <p role="status" className="text-meta text-success empty:hidden">
          {saved ? t('dock.saved') : status}
        </p>
      </div>

      <section aria-labelledby="dock-preview" className="flex flex-col gap-1.5">
        <h3 id="dock-preview" className="text-body font-semibold">
          {t('dock.preview')}
        </h3>
        <div className="rounded-card bg-surface-2 p-3 text-body">
          <Markdown
            text={text}
            orgId={orgId}
            mentions={[...item.mentions, ...picked]}
            mode="full"
            onOpenItem={openItem}
          />
        </div>
      </section>

      <MentionPicker
        open={picker !== null}
        orgId={orgId}
        exclude={item.id}
        onClose={closePicker}
        onPick={(id, hit) => {
          const [start, end] = picker ?? [text.length, text.length]
          setPicked((p) => [
            ...p,
            {
              id,
              listId: hit.listId,
              listName: hit.listName,
              title: titleOf(hit.text),
              done: hit.done,
            },
          ])
          insert(start, end, `[[${id}]]`)
          closePicker()
        }}
      />

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
                    <Markdown
                      text={c.text}
                      orgId={orgId}
                      mentions={c.mentions}
                      mode="row"
                    />
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

      <section aria-labelledby="dock-backlinks" className="flex flex-col gap-2">
        <h3 id="dock-backlinks" className="text-body font-semibold">
          {t('dock.backlinks')}
        </h3>
        {(backlinks.data ?? []).length === 0 ? (
          <EmptyState>{t('dock.noBacklinks')}</EmptyState>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {(backlinks.data ?? []).map((b) => {
              const Icon = b.done ? SquareCheck : Square
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => openItem(b)}
                    aria-label={t('dock.openMention', {
                      title: b.title,
                      list: b.listName,
                    })}
                    className="flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-body hover:bg-text/8"
                  >
                    <Icon
                      aria-hidden
                      size={14}
                      className="shrink-0 text-muted"
                    />
                    <span
                      className={`min-w-0 flex-1 truncate ${b.done ? 'line-through' : ''}`}
                    >
                      {b.title}
                    </span>
                    <span className="shrink-0 text-meta text-muted">
                      {t('mention.inList', { name: b.listName })}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

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
