import { Link, Outlet, useNavigate, useParams } from '@tanstack/react-router'
import { IconButton, Kbd, SectionTransition } from '@wefaber/ui'
import { useQuery } from '@tanstack/react-query'
import {
  CircleAlert,
  CircleCheck,
  Keyboard,
  LoaderCircle,
  Search,
} from 'lucide-react'
import { useEffect } from 'react'
import { AccountTile } from '../features/auth/AccountTile'
import { useViewer } from '../features/auth/useViewer'
import { undoLast } from '../features/lists/actions'
import { useLists, useOrgEvents } from '../features/lists/api'
import { ListsBar } from '../features/lists/ListsBar'
import { ThemeMenu } from '../features/theme/ThemeMenu'
import { t } from '../i18n'
import type { MessageKey } from '../i18n/es'
import { apiUrl } from '../lib/server'
import {
  useShortcutListener,
  useShortcuts,
  type Shortcut,
} from '../lib/shortcuts'
import { useUi } from './ui'

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

const LABEL: Record<Status, MessageKey> = {
  cargando: 'server.connecting',
  listo: 'server.ready',
  caído: 'server.down',
}

export function ServerStatus() {
  const status = useServerStatus()
  const Icon =
    status === 'cargando'
      ? LoaderCircle
      : status === 'listo'
        ? CircleCheck
        : CircleAlert
  return (
    <p
      role="status"
      className={`flex items-center gap-2 text-meta ${status === 'caído' ? 'text-danger' : 'text-muted'}`}
    >
      <Icon aria-hidden size={14} />
      {t(LABEL[status])}
    </p>
  )
}

/** Atajos que valen en toda la app. Los de la lista abierta los registra `ListPage`. */
function useGlobalShortcuts(lists: { id: string }[], activeId: string | null) {
  const navigate = useNavigate()
  const { setPalette, setShortcuts, setNewList } = useUi()
  const go = (listId: string) =>
    void navigate({
      to: '/l/$listId',
      params: { listId },
      search: { item: undefined },
    })
  const at = lists.findIndex((l) => l.id === activeId)
  const shortcuts: Shortcut[] = [
    {
      id: 'palette',
      keys: 'Mod+K',
      label: 'key.palette',
      group: 'group.general',
      allowTyping: true,
      run: () => setPalette(true),
    },
    {
      id: 'shortcuts',
      keys: '?',
      label: 'key.shortcuts',
      group: 'group.general',
      run: () => setShortcuts(true),
    },
    {
      id: 'undo',
      keys: 'Mod+Z',
      label: 'key.undo',
      group: 'group.general',
      run: () => void undoLast(),
    },
    {
      id: 'list.new',
      keys: 'Shift+N',
      label: 'key.newList',
      group: 'group.lists',
      run: () => setNewList(true),
    },
    {
      id: 'list.next',
      keys: 'G N',
      label: 'key.nextList',
      group: 'group.lists',
      enabled: lists.length > 0,
      run: () => go(lists[(at + 1) % lists.length]!.id),
    },
    {
      id: 'list.prev',
      keys: 'G P',
      label: 'key.prevList',
      group: 'group.lists',
      enabled: lists.length > 0,
      run: () => go(lists[(at <= 0 ? lists.length : at) - 1]!.id),
    },
  ]
  useShortcuts('global', shortcuts)
}

/** La pantalla con sesión: barra superior, listas y la ruta activa. Sin sesión, solo el login. */
export function AppLayout() {
  const { loading, viewer, orgId } = useViewer()
  const lists = useLists(orgId)
  const params = useParams({ strict: false }) as { listId?: string }
  const { setPalette, setShortcuts } = useUi()
  useShortcutListener()
  useOrgEvents(orgId)
  useGlobalShortcuts(lists.data ?? [], params.listId ?? null)

  return (
    <>
      <a
        href="#main"
        className="sr-only z-50 rounded-control bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {t('app.skip')}
      </a>
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-border bg-bg px-4">
        <Link to="/" className="font-display text-h3">
          {t('app.name')}
        </Link>
        <div className="flex items-center gap-1">
          {viewer ? (
            <button
              type="button"
              onClick={() => setPalette(true)}
              className="hidden h-8 items-center gap-2 rounded-control bg-text/8 px-3 text-body text-text transition-colors duration-(--dur-fast) hover:bg-text/12 sm:inline-flex"
            >
              <Search aria-hidden size={14} />
              {t('palette.open')}
              <Kbd keys="Mod+K" />
            </button>
          ) : null}
          <IconButton
            label={t('shortcuts.open')}
            icon={<Keyboard size={18} />}
            onClick={() => setShortcuts(true)}
          />
          <ThemeMenu />
          {viewer ? <AccountTile /> : null}
        </div>
      </header>
      <div className="transition-[padding] duration-(--dur-layout) ease-standard lg:pr-(--dock-inset)">
        <main
          id="main"
          className="mx-auto flex max-w-3xl flex-col gap-2 px-4 pb-24"
        >
          {loading ? (
            <AccountTile />
          ) : !viewer ? (
            <div className="pt-4">
              <AccountTile />
            </div>
          ) : (
            <>
              <ListsBar
                orgId={orgId!}
                lists={lists.data ?? []}
                activeId={params.listId ?? null}
              />
              <SectionTransition id={params.listId ?? 'inicio'} lift={false}>
                <Outlet />
              </SectionTransition>
            </>
          )}
          <div className="pt-4">
            <ServerStatus />
          </div>
        </main>
      </div>
    </>
  )
}

/** `/`: abre la última lista que se usó, o la primera; sin listas muestra cómo crear la primera. */
export function Home() {
  const navigate = useNavigate()
  const { orgId } = useViewer()
  const lists = useLists(orgId)
  const first = lists.data?.[0]
  useEffect(() => {
    if (!lists.data?.length) return
    let last: string | null = null
    try {
      last = localStorage.getItem('mychecklist.lastList')
    } catch {
      // Sin almacenamiento se abre la primera.
    }
    const target = lists.data.find((l) => l.id === last) ?? first!
    void navigate({
      to: '/l/$listId',
      params: { listId: target.id },
      search: { item: undefined },
      replace: true,
    })
  }, [lists.data, first, navigate])

  if (lists.isPending && orgId)
    return (
      <p role="status" className="text-meta text-muted">
        {t('nav.loading')}
      </p>
    )
  if (lists.isError)
    return (
      <p role="alert" className="text-body text-danger">
        {t('nav.failed')}
      </p>
    )
  return lists.data?.length ? null : (
    <p className="rounded-card border-[1.5px] border-dashed border-border p-4 text-body-lg text-muted">
      {t('lists.none')}
    </p>
  )
}
