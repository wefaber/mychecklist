import { IconButton, Menu, MenuItem, MenuSeparator } from '@wefaber/ui'
import {
  ArrowDown,
  ArrowUp,
  CornerDownRight,
  GripVertical,
  IndentDecrease,
  IndentIncrease,
  ListPlus,
  MoreHorizontal,
  Square,
  SquareCheck,
  Trash2,
} from 'lucide-react'
import { useState, type DragEvent, type KeyboardEvent } from 'react'
import { t } from '../../i18n'
import type { Item, List } from './api'

export type RowActions = {
  toggle(item: Item): void
  open(item: Item): void
  remove(item: Item): void
  addSub(item: Item): void
  moveTo(item: Item, listId: string): void
  step(item: Item, dir: 'up' | 'down'): void
  indent(item: Item): void
  outdent(item: Item): void
  keyDown(e: KeyboardEvent<HTMLElement>, item: Item): void
  dragStart(item: Item): void
  dragOver(item: Item, where: 'before' | 'after'): void
  drop(item: Item): void
  dragEnd(): void
}

/** Una fila: casilla, texto (abre el detalle), subitems indentados y un menú con todo lo que se puede hacer. */
export function ItemRow({
  item,
  sub,
  subCount,
  selected,
  lists,
  dragging,
  drop,
  actions: a,
}: {
  item: Item
  sub: boolean
  subCount: number
  selected: boolean
  lists: List[]
  dragging: boolean
  /** Dónde caería lo que se está arrastrando respecto de esta fila. */
  drop: 'before' | 'after' | null
  actions: RowActions
}) {
  const [menu, setMenu] = useState(false)
  const Check = item.done ? SquareCheck : Square

  const onDragOver = (e: DragEvent<HTMLLIElement>) => {
    e.preventDefault()
    const box = e.currentTarget.getBoundingClientRect()
    a.dragOver(item, e.clientY < box.top + box.height / 2 ? 'before' : 'after')
  }

  return (
    <li
      data-item-id={item.id}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', item.id)
        a.dragStart(item)
      }}
      onDragOver={onDragOver}
      onDrop={(e) => {
        e.preventDefault()
        a.drop(item)
      }}
      onDragEnd={a.dragEnd}
      className={`group relative flex items-start gap-1 rounded-card py-1 pr-1 transition-colors duration-(--dur-fast) ${sub ? 'ml-8' : ''} ${selected ? 'bg-surface-2' : 'hover:bg-text/5'} ${dragging ? 'opacity-40' : ''}`}
    >
      {drop ? (
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-x-0 h-0.5 rounded-full bg-accent ${drop === 'before' ? '-top-px' : '-bottom-px'}`}
        />
      ) : null}
      <span
        aria-hidden
        title={t('item.drag', { text: item.text })}
        className="mt-1.5 grid size-5 shrink-0 cursor-grab place-items-center text-muted opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <GripVertical size={14} />
      </span>
      <button
        type="button"
        role="checkbox"
        aria-checked={item.done}
        aria-label={t('item.toggle', { text: item.text })}
        onClick={() => a.toggle(item)}
        className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-control text-muted transition-colors duration-(--dur-fast) hover:text-text"
      >
        <Check
          aria-hidden
          size={18}
          className={item.done ? 'text-accent' : undefined}
        />
      </button>
      <button
        type="button"
        data-item-focus={item.id}
        aria-current={selected ? 'true' : undefined}
        onClick={() => a.open(item)}
        onKeyDown={(e) => a.keyDown(e, item)}
        className="min-w-0 flex-1 rounded-control px-1 py-1.5 text-left text-body-lg"
      >
        <span
          className={`block whitespace-pre-wrap break-words ${item.done ? 'text-muted line-through' : 'text-text'}`}
        >
          {item.text}
        </span>
        {subCount > 0 ? (
          <span className="mt-0.5 flex items-center gap-1 text-meta text-muted tabular-nums">
            <CornerDownRight aria-hidden size={12} />
            {subCount === 1
              ? t('item.subitem')
              : t('item.subitems', { n: subCount })}
          </span>
        ) : null}
      </button>
      <Menu
        open={menu}
        onOpenChange={setMenu}
        label={t('item.actions', { text: item.text })}
        trigger={(props) => (
          <IconButton
            label={t('item.actions', { text: item.text })}
            icon={<MoreHorizontal size={16} />}
            className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
            {...props}
          />
        )}
      >
        {!sub ? (
          <MenuItem
            icon={<ListPlus size={16} />}
            onSelect={() => a.addSub(item)}
          >
            {t('item.addSub')}
          </MenuItem>
        ) : null}
        <MenuItem
          icon={<ArrowUp size={16} />}
          onSelect={() => a.step(item, 'up')}
        >
          {t('item.moveUp')}
        </MenuItem>
        <MenuItem
          icon={<ArrowDown size={16} />}
          onSelect={() => a.step(item, 'down')}
        >
          {t('item.moveDown')}
        </MenuItem>
        {sub ? (
          <MenuItem
            icon={<IndentDecrease size={16} />}
            onSelect={() => a.outdent(item)}
          >
            {t('item.outdent')}
          </MenuItem>
        ) : (
          <MenuItem
            icon={<IndentIncrease size={16} />}
            onSelect={() => a.indent(item)}
          >
            {t('item.indent')}
          </MenuItem>
        )}
        {lists.filter((l) => l.id !== item.listId).length > 0 ? (
          <MenuSeparator />
        ) : null}
        {lists
          .filter((l) => l.id !== item.listId)
          .slice(0, 8)
          .map((l) => (
            <MenuItem key={l.id} onSelect={() => a.moveTo(item, l.id)}>
              {t('item.moveTo', { name: l.name })}
            </MenuItem>
          ))}
        <MenuSeparator />
        <MenuItem
          destructive
          icon={<Trash2 size={16} />}
          onSelect={() => a.remove(item)}
        >
          {t('item.delete')}
        </MenuItem>
      </Menu>
    </li>
  )
}
