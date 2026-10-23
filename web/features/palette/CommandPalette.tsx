import { useNavigate } from '@tanstack/react-router'
import { Dialog, Kbd } from '@wefaber/ui'
import { TextField } from '../../components/TextField'
import { useEffect, useRef, useState } from 'react'
import { useUi } from '../../app/ui'
import { t } from '../../i18n'
import type { MessageKey } from '../../i18n/es'
import { PALETTES, useTheme } from '../../lib/theme'
import { useRegistry } from '../../lib/shortcuts'
import { useLists, useSearch } from '../lists/api'

type Entry = {
  id: string
  group: MessageKey
  label: string
  detail?: string
  keys?: string
  run: () => void
}

/** Texto sin tildes y en minúsculas, para que "item" encuentre "Ítem". */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

export function CommandPalette({ orgId }: { orgId: string | null }) {
  const { paletteOpen, setPalette } = useUi()
  return (
    <Dialog
      open={paletteOpen}
      onClose={() => setPalette(false)}
      title={t('palette.title')}
      closeLabel={t('toast.dismiss')}
      className="self-start sm:mt-[12vh]"
    >
      <PaletteBody orgId={orgId} close={() => setPalette(false)} />
    </Dialog>
  )
}

function PaletteBody({
  orgId,
  close,
}: {
  orgId: string | null
  close: () => void
}) {
  const navigate = useNavigate()
  const lists = useLists(orgId).data ?? []
  const shortcuts = useRegistry((s) => s.shortcuts)
  const theme = useTheme()
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const hits = useSearch(orgId, debounced).data ?? []

  useEffect(() => {
    // El diálogo enfoca su botón de cerrar; la paleta quiere el campo.
    const id = requestAnimationFrame(() => input.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [])
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 150)
    return () => clearTimeout(id)
  }, [query])

  const done = (fn: () => void) => () => {
    close()
    fn()
  }

  const commands: Entry[] = shortcuts
    .filter(
      (s) =>
        s.enabled !== false &&
        !s.local &&
        s.keys !== 'Escape' &&
        s.id !== 'palette',
    )
    .map((s) => ({
      id: `cmd-${s.id}`,
      group: 'palette.commands',
      label: t(s.label),
      keys: s.keys,
      run: done(s.run),
    }))
  commands.push(
    {
      id: 'cmd-design',
      group: 'palette.commands',
      label: t('cmd.design'),
      run: done(() => void navigate({ to: '/design' })),
    },
    ...PALETTES.map((p) => ({
      id: `cmd-theme-${p}`,
      group: 'palette.commands' as const,
      label: t('cmd.theme', { name: t(`theme.${p}` as MessageKey) }),
      run: done(() => theme.setPalette(p)),
    })),
  )

  const goLists: Entry[] = lists.map((l) => ({
    id: `list-${l.id}`,
    group: 'palette.goLists',
    label: t('cmd.goList', { name: l.name }),
    run: done(
      () =>
        void navigate({
          to: '/l/$listId',
          params: { listId: l.id },
          search: { item: undefined },
        }),
    ),
  }))

  const q = fold(query.trim())
  const keep = (e: Entry) => !q || fold(e.label).includes(q)
  const found: Entry[] = hits.map((h) => ({
    id: `item-${h.id}`,
    group: 'palette.items',
    label: h.text,
    detail: t('palette.inList', { name: h.listName }),
    run: done(
      () =>
        void navigate({
          to: '/l/$listId',
          params: { listId: h.listId },
          search: { item: h.id },
        }),
    ),
  }))
  const entries = [...commands.filter(keep), ...goLists.filter(keep), ...found]
  const at = Math.min(active, Math.max(entries.length - 1, 0))
  const groups = [...new Set(entries.map((e) => e.group))]

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const n = entries.length
      if (n) setActive((at + (e.key === 'ArrowDown' ? 1 : -1) + n) % n)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      entries[at]?.run()
    }
  }

  return (
    <div className="flex flex-col gap-3" onKeyDown={onKeyDown}>
      <TextField
        ref={input}
        role="combobox"
        aria-expanded
        aria-controls="palette-list"
        aria-activedescendant={
          entries[at] ? `opt-${entries[at].id}` : undefined
        }
        aria-label={t('palette.label')}
        placeholder={t('palette.placeholder')}
        value={query}
        autoComplete="off"
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
        }}
      />
      <div
        id="palette-list"
        role="listbox"
        aria-label={t('palette.title')}
        className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto"
      >
        {entries.length === 0 ? (
          <p className="px-1 text-body text-muted">{t('palette.empty')}</p>
        ) : (
          groups.map((g) => (
            <div
              key={g}
              role="group"
              aria-label={t(g)}
              className="flex flex-col gap-0.5"
            >
              <div
                aria-hidden
                className="px-2 text-caption font-medium text-muted uppercase"
              >
                {t(g)}
              </div>
              {entries
                .filter((e) => e.group === g)
                .map((e) => (
                  <div
                    key={e.id}
                    id={`opt-${e.id}`}
                    role="option"
                    aria-selected={entries[at]?.id === e.id}
                    onClick={e.run}
                    onMouseMove={() => setActive(entries.indexOf(e))}
                    className={`flex cursor-pointer items-center justify-between gap-3 rounded-control px-2 py-2 text-body ${entries[at]?.id === e.id ? 'bg-text/12' : ''}`}
                  >
                    <span className="min-w-0 flex-1 truncate">{e.label}</span>
                    {e.detail ? (
                      <span className="shrink-0 text-meta text-muted">
                        {e.detail}
                      </span>
                    ) : null}
                    {e.keys ? <Kbd keys={e.keys} /> : null}
                  </div>
                ))}
            </div>
          ))
        )}
      </div>
      <p className="text-meta text-muted">{t('palette.hint')}</p>
    </div>
  )
}
