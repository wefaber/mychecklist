import { Link, useNavigate } from '@tanstack/react-router'
import { IconButton, Menu, MenuItem, MenuSeparator } from '@wefaber/ui'
import { TextField } from '../../components/TextField'
import {
  ArrowLeft,
  ArrowRight,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useUi } from '../../app/ui'
import { t } from '../../i18n'
import { useActions } from './actions'
import type { List } from './api'

const chip =
  'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-control px-2.5 font-mono text-meta whitespace-nowrap transition-[background-color,transform] duration-(--dur-fast) ease-standard active:scale-[0.98]'

/** Una línea con todas las listas: se elige una a la vez (DESIGN.md › principio 1). Alta y renombre son en línea. */
export function ListsBar({
  orgId,
  lists,
  activeId,
}: {
  orgId: string
  lists: List[]
  activeId: string | null
}) {
  const navigate = useNavigate()
  const actions = useActions(orgId)
  const { newListOpen, setNewList } = useUi()
  const [renaming, setRenaming] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const active = lists.find((l) => l.id === activeId) ?? null
  const at = active ? lists.findIndex((l) => l.id === active.id) : -1

  const create = async (name: string) => {
    const made = await actions.createList(name, lists.at(-1)?.id ?? null)
    setNewList(false)
    if (made)
      void navigate({
        to: '/l/$listId',
        params: { listId: made.id },
        search: { item: undefined },
      })
  }

  const remove = async (list: List) => {
    const next =
      lists[lists.findIndex((l) => l.id === list.id) + 1] ?? lists.at(-2)
    if (await actions.deleteList(list)) {
      if (next && next.id !== list.id)
        void navigate({
          to: '/l/$listId',
          params: { listId: next.id },
          search: { item: undefined },
        })
      else void navigate({ to: '/' })
    }
  }

  return (
    <nav
      aria-label={t('nav.lists')}
      className="sticky top-14 z-20 flex items-center gap-1.5 overflow-x-auto bg-bg py-2"
    >
      {lists.map((l) =>
        renaming === l.id ? (
          <NameForm
            key={l.id}
            label={t('list.nameLabel')}
            initial={l.name}
            onSubmit={async (name) => {
              setRenaming(null)
              await actions.renameList(l, name)
            }}
            onCancel={() => setRenaming(null)}
          />
        ) : (
          <Link
            key={l.id}
            to="/l/$listId"
            params={{ listId: l.id }}
            search={{ item: undefined }}
            aria-current={l.id === activeId ? 'page' : undefined}
            className={`${chip} ${l.id === activeId ? 'bg-accent text-on-accent' : 'bg-text/8 text-text hover:bg-text/12'}`}
          >
            {l.name}
            <span className="tabular-nums opacity-80">{l.open}</span>
          </Link>
        ),
      )}

      {active ? (
        <Menu
          open={menu}
          onOpenChange={setMenu}
          label={t('nav.listActions', { name: active.name })}
          align="start"
          trigger={(props) => (
            <IconButton
              label={t('nav.listActions', { name: active.name })}
              icon={<MoreHorizontal size={16} />}
              {...props}
            />
          )}
        >
          <MenuItem
            icon={<Pencil size={16} />}
            onSelect={() => setRenaming(active.id)}
          >
            {t('list.rename')}
          </MenuItem>
          {at > 0 ? (
            <MenuItem
              icon={<ArrowLeft size={16} />}
              onSelect={() =>
                actions.moveList(
                  lists,
                  active,
                  at > 1 ? lists[at - 2]!.id : null,
                )
              }
            >
              {t('list.moveLeft')}
            </MenuItem>
          ) : null}
          {at >= 0 && at < lists.length - 1 ? (
            <MenuItem
              icon={<ArrowRight size={16} />}
              onSelect={() =>
                actions.moveList(lists, active, lists[at + 1]!.id)
              }
            >
              {t('list.moveRight')}
            </MenuItem>
          ) : null}
          <MenuSeparator />
          <MenuItem
            destructive
            icon={<Trash2 size={16} />}
            onSelect={() => remove(active)}
          >
            {t('list.delete')}
          </MenuItem>
        </Menu>
      ) : null}

      {newListOpen ? (
        <NameForm
          label={t('list.nameLabel')}
          placeholder={t('list.namePlaceholder')}
          onSubmit={create}
          onCancel={() => setNewList(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setNewList(true)}
          className={`${chip} text-muted hover:bg-text/8 hover:text-text`}
        >
          <Plus aria-hidden size={14} />
          {t('nav.newList')}
        </button>
      )}
    </nav>
  )
}

/** Campo de nombre en línea: Enter guarda, Esc o salir sin escribir cancela. */
function NameForm({
  label,
  initial = '',
  placeholder,
  onSubmit,
  onCancel,
}: {
  label: string
  initial?: string
  placeholder?: string
  onSubmit: (name: string) => Promise<unknown> | unknown
  onCancel: () => void
}) {
  const [name, setName] = useState(initial)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const value = name.trim()
        if (value) void onSubmit(value)
        else onCancel()
      }}
      className="shrink-0"
    >
      <TextField
        ref={input}
        aria-label={label}
        placeholder={placeholder}
        value={name}
        density="compact"
        maxLength={80}
        className="w-44"
        autoComplete="off"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onCancel()
          }
        }}
        onBlur={() => (name.trim() ? undefined : onCancel())}
      />
    </form>
  )
}
