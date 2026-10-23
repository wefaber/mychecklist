import type { Item } from './api'

/** Donde queda un item al moverlo: el padre (o `null`, primer nivel) y el hermano que lo precede (`null` = primero). */
export type Placement = { parentId: string | null; afterId: string | null }

export type Node = { item: Item; children: Item[] }

/** `items` viene plano y ordenado del servidor; los subitems cuelgan de su padre de primer nivel. */
export function buildTree(items: Item[]): Node[] {
  const kids = new Map<string, Item[]>()
  for (const i of items)
    if (i.parentId) kids.set(i.parentId, [...(kids.get(i.parentId) ?? []), i])
  return items
    .filter((i) => i.parentId === null)
    .map((item) => ({ item, children: kids.get(item.id) ?? [] }))
}

/** Orden visual: cada item seguido de sus subitems. */
export function flatten(nodes: Node[]): Item[] {
  return nodes.flatMap((n) => [n.item, ...n.children])
}

const siblings = (items: Item[], parentId: string | null) =>
  items.filter((i) => i.parentId === parentId)

/** Hermano que precede a `item` en su contenedor, si lo hay. */
export function previousSibling(items: Item[], item: Item): Item | null {
  const s = siblings(items, item.parentId)
  const at = s.findIndex((i) => i.id === item.id)
  return at > 0 ? s[at - 1]! : null
}

/** Alt+↑ / Alt+↓: un lugar arriba o abajo entre sus hermanos. `null` si ya está en el borde. */
export function stepTarget(
  items: Item[],
  item: Item,
  dir: 'up' | 'down',
): Placement | null {
  const s = siblings(items, item.parentId)
  const at = s.findIndex((i) => i.id === item.id)
  if (at < 0) return null
  if (dir === 'up')
    return at === 0
      ? null
      : { parentId: item.parentId, afterId: at >= 2 ? s[at - 2]!.id : null }
  return at === s.length - 1
    ? null
    : { parentId: item.parentId, afterId: s[at + 1]!.id }
}

/** Tab: pasa a ser el último subitem del item de primer nivel que lo precede. Solo si él no tiene subitems. */
export function indentTarget(items: Item[], item: Item): Placement | null {
  if (item.parentId !== null) return null
  if (items.some((i) => i.parentId === item.id)) return null
  const prev = previousSibling(items, item)
  if (!prev) return null
  const last = siblings(items, prev.id).at(-1)
  return { parentId: prev.id, afterId: last?.id ?? null }
}

/** Shift+Tab: sale a primer nivel, justo después de su padre. */
export function outdentTarget(item: Item): Placement | null {
  return item.parentId === null
    ? null
    : { parentId: null, afterId: item.parentId }
}

/**
 * Arrastrar `dragged` sobre `onto`, a su mitad de arriba (`before`) o de abajo (`after`). El destino es el contenedor
 * de `onto`; un item con subitems no puede entrar como subitem, así que queda en primer nivel junto al padre.
 */
export function dropTarget(
  items: Item[],
  dragged: Item,
  onto: Item,
  where: 'before' | 'after',
): Placement | null {
  if (dragged.id === onto.id || onto.parentId === dragged.id) return null
  const hasChildren = items.some((i) => i.parentId === dragged.id)
  const anchor =
    hasChildren && onto.parentId !== null
      ? items.find((i) => i.id === onto.parentId)!
      : onto
  const parentId = anchor.parentId
  const s = siblings(items, parentId).filter((i) => i.id !== dragged.id)
  const at = s.findIndex((i) => i.id === anchor.id)
  // Soltar sobre un item de primer nivel que tiene subitems "después" queda tras toda su rama, no entre medio.
  const place = anchor === onto ? where : 'after'
  const afterId = place === 'after' ? anchor.id : at > 0 ? s[at - 1]!.id : null
  return { parentId, afterId }
}
