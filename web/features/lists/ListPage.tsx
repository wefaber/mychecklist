import { Chip, EmptyState, Tile } from '@wefaber/ui'
import { useNavigate } from '@tanstack/react-router'
import { LoaderCircle } from 'lucide-react'
import { useRef, useState, type KeyboardEvent } from 'react'
import { t } from '../../i18n'
import { useShortcuts, type Shortcut } from '../../lib/shortcuts'
import { useActions } from './actions'
import { useItems, useLists, type Item } from './api'
import { Composer } from './Composer'
import { ItemDock } from './ItemDock'
import { ItemRow, type RowActions } from './ItemRow'
import {
  buildTree,
  dropTarget,
  flatten,
  indentTarget,
  outdentTarget,
  stepTarget,
  type Node,
  type Placement,
} from './tree'

type Filter = 'all' | 'open' | 'done'

const matches = (i: Item, f: Filter) =>
  f === 'all' || (f === 'done' ? i.done : !i.done)

/** Con filtro, un item sin completar con subitems completos (o al revés) igual se muestra si algún hijo coincide. */
function visible(nodes: Node[], f: Filter): Node[] {
  if (f === 'all') return nodes
  return nodes
    .map((n) => ({ ...n, children: n.children.filter((c) => matches(c, f)) }))
    .filter((n) => matches(n.item, f) || n.children.length > 0)
}

/** Foco al texto de un item, después de que React termine de reubicar la fila. */
function focusItem(id: string) {
  requestAnimationFrame(() =>
    document
      .querySelector<HTMLElement>(`[data-item-focus="${CSS.escape(id)}"]`)
      ?.focus(),
  )
}

export function ListPage({
  orgId,
  listId,
  itemId,
}: {
  orgId: string
  listId: string
  itemId: string | undefined
}) {
  const navigate = useNavigate()
  const lists = useLists(orgId)
  const items = useItems(orgId, listId)
  const actions = useActions(orgId)
  const [filter, setFilter] = useState<Filter>('all')
  const [dragId, setDragId] = useState<string | null>(null)
  const [over, setOver] = useState<{
    id: string
    where: 'before' | 'after'
  } | null>(null)
  const [live, setLive] = useState('')
  const composer = useRef<HTMLInputElement>(null)

  const list = lists.data?.find((l) => l.id === listId)
  const all = items.data ?? []
  const selected = itemId ? (all.find((i) => i.id === itemId) ?? null) : null
  const nodes = visible(buildTree(all), filter)
  const shown = flatten(nodes)
  const topLevel = all.filter((i) => i.parentId === null)

  const setSelected = (id: string | undefined) =>
    void navigate({
      to: '/l/$listId',
      params: { listId },
      search: { item: id },
      replace: true,
    })

  const place = async (item: Item, to: Placement & { listId?: string }) => {
    const ok = await actions.moveItem(all, item, to)
    if (ok) focusItem(item.id)
    return ok
  }

  const step = async (item: Item, dir: 'up' | 'down') => {
    const to = stepTarget(all, item, dir)
    if (!to) return
    if (await place(item, to)) {
      // El orden nuevo se calcula sobre lo que ya se sabe; el servidor lo confirma en el refresco.
      const siblings = all.filter((i) => i.parentId === item.parentId)
      const at =
        siblings.findIndex((i) => i.id === item.id) + (dir === 'up' ? -1 : 1)
      setLive(
        t('live.moved', { text: item.text, n: at + 1, total: siblings.length }),
      )
    }
  }

  const row: RowActions = {
    toggle: (i) => actions.setDone(i, !i.done),
    open: (i) => setSelected(i.id),
    remove: async (i) => {
      const neighbor =
        shown[shown.findIndex((x) => x.id === i.id) + 1] ?? shown.at(-2)
      if (selected?.id === i.id) setSelected(undefined)
      if ((await actions.deleteItem(i)) && neighbor && neighbor.id !== i.id)
        focusItem(neighbor.id)
    },
    addSub: (i) => setSelected(i.id),
    moveTo: (i, to) =>
      actions.moveItem(all, i, { listId: to, parentId: null, afterId: null }),
    step,
    indent: async (i) => {
      const to = indentTarget(all, i)
      if (to && (await place(i, to))) setLive(t('live.level', { text: i.text }))
    },
    outdent: async (i) => {
      const to = outdentTarget(i)
      if (to && (await place(i, to)))
        setLive(t('live.topLevel', { text: i.text }))
    },
    keyDown(e: KeyboardEvent<HTMLElement>, i) {
      const at = shown.findIndex((x) => x.id === i.id)
      const go = (n: number) => {
        const target = shown[n]
        if (target) focusItem(target.id)
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          void step(i, e.key === 'ArrowUp' ? 'up' : 'down')
        } else if (e.key === 'ArrowRight') {
          e.preventDefault()
          void row.indent(i)
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault()
          void row.outdent(i)
        }
        return
      }
      if (e.ctrlKey || e.metaKey || e.shiftKey) return
      if (e.key === 'ArrowDown') (e.preventDefault(), go(at + 1))
      else if (e.key === 'ArrowUp') (e.preventDefault(), go(at - 1))
      else if (e.key === ' ') (e.preventDefault(), row.toggle(i))
      else if (e.key === 'Delete' || e.key === 'Backspace')
        (e.preventDefault(), void row.remove(i))
    },
    dragStart: (i) => setDragId(i.id),
    dragOver: (i, where) => {
      if (over?.id !== i.id || over.where !== where)
        setOver({ id: i.id, where })
    },
    drop: async (onto) => {
      const dragged = all.find((i) => i.id === dragId)
      const where = over?.id === onto.id ? over.where : 'after'
      setDragId(null)
      setOver(null)
      if (!dragged) return
      const to = dropTarget(all, dragged, onto, where)
      if (to) await place(dragged, to)
    },
    dragEnd: () => {
      setDragId(null)
      setOver(null)
    },
  }

  const shortcuts: Shortcut[] = [
    {
      id: 'item.new',
      keys: 'N',
      label: 'key.newItem',
      group: 'group.items',
      run: () => composer.current?.focus(),
    },
    {
      id: 'item.next',
      keys: 'ArrowDown',
      label: 'key.next',
      group: 'group.items',
      local: true,
      run: () => {},
    },
    {
      id: 'item.prev',
      keys: 'ArrowUp',
      label: 'key.prev',
      group: 'group.items',
      local: true,
      run: () => {},
    },
    {
      id: 'item.toggle',
      keys: 'Space',
      label: 'key.toggle',
      group: 'group.items',
      local: true,
      run: () => {},
    },
    {
      id: 'item.open',
      keys: 'Enter',
      label: 'key.openDock',
      group: 'group.items',
      local: true,
      run: () => {},
    },
    {
      id: 'item.delete',
      keys: 'Delete',
      label: 'key.delete',
      group: 'group.items',
      local: true,
      run: () => {},
    },
    {
      id: 'item.up',
      keys: 'Alt+ArrowUp',
      label: 'key.moveUp',
      group: 'group.items',
      local: true,
      run: () => {},
    },
    {
      id: 'item.down',
      keys: 'Alt+ArrowDown',
      label: 'key.moveDown',
      group: 'group.items',
      local: true,
      run: () => {},
    },
    {
      id: 'item.indent',
      keys: 'Alt+ArrowRight',
      label: 'key.indent',
      group: 'group.items',
      local: true,
      run: () => {},
    },
    {
      id: 'item.outdent',
      keys: 'Alt+ArrowLeft',
      label: 'key.outdent',
      group: 'group.items',
      local: true,
      run: () => {},
    },
    {
      id: 'dock.close',
      keys: 'Escape',
      label: 'key.closeLayer',
      group: 'group.general',
      enabled: selected !== null,
      allowTyping: true,
      run: () => setSelected(undefined),
    },
  ]
  useShortcuts('list', shortcuts)

  if (lists.isPending || items.isPending)
    return (
      <p role="status" className="flex items-center gap-2 text-meta text-muted">
        <LoaderCircle
          aria-hidden
          size={14}
          className="animate-spin motion-reduce:animate-none"
        />
        {t('list.loading')}
      </p>
    )
  if (lists.isError || (items.isError && list))
    return (
      <p role="alert" className="text-body text-danger">
        {t('list.failed')}
      </p>
    )
  if (!list) return <EmptyState>{t('list.missing')}</EmptyState>

  const lastTop = topLevel.at(-1)

  return (
    <>
      <Tile
        title={list.name}
        actions={
          <span className="text-meta text-muted tabular-nums">
            {t('list.progress', { open: list.open, total: list.total })}
          </span>
        }
      >
        <div className="sticky top-14 z-10 -mx-1 mb-3 flex flex-wrap items-center justify-between gap-2 bg-surface px-1 py-2">
          <div
            role="group"
            aria-label={t('filter.label')}
            className="flex gap-1.5"
          >
            {(['all', 'open', 'done'] as const).map((f) => (
              <Chip
                key={f}
                selected={filter === f}
                onClick={() => setFilter(f)}
              >
                {t(`filter.${f}`)}
              </Chip>
            ))}
          </div>
          <span role="status" className="text-meta text-muted tabular-nums">
            {t('filter.count', { n: shown.length })}
          </span>
        </div>

        {all.length === 0 ? (
          <EmptyState>{t('list.empty')}</EmptyState>
        ) : shown.length === 0 ? (
          <EmptyState>{t('filter.none')}</EmptyState>
        ) : (
          <>
            <p className="sr-only" id="drag-hint">
              {t('item.dragHint')}
            </p>
            <ul aria-describedby="drag-hint" className="flex flex-col gap-0.5">
              {nodes.flatMap((n) =>
                [n.item, ...n.children].map((i) => (
                  <ItemRow
                    key={i.id}
                    item={i}
                    sub={i.parentId !== null}
                    subCount={
                      i.parentId === null
                        ? all.filter((c) => c.parentId === i.id).length
                        : 0
                    }
                    selected={selected?.id === i.id}
                    lists={lists.data ?? []}
                    dragging={dragId === i.id}
                    drop={
                      over?.id === i.id && dragId !== i.id ? over.where : null
                    }
                    actions={row}
                  />
                )),
              )}
            </ul>
          </>
        )}

        <div className="mt-3">
          <Composer
            inputRef={composer}
            label={t('item.addLabel')}
            placeholder={t('item.addPlaceholder')}
            onSubmit={async (text) => {
              const created = await actions.createItem(listId, text, {
                parentId: null,
                afterId: lastTop?.id ?? null,
              })
              if (created) composer.current?.focus()
            }}
          />
        </div>
        <p role="status" className="sr-only">
          {live}
        </p>
      </Tile>

      <ItemDock
        item={selected}
        items={all}
        lists={lists.data ?? []}
        actions={actions}
        onClose={() => setSelected(undefined)}
      />
    </>
  )
}
