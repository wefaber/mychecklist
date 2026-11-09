import type { Parent, Root } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

/**
 * Casillas de Markdown (`- [ ]` y `- [x]`) del texto de un item. Para completar un item todas tienen que estar marcadas.
 * Se cuentan sobre el árbol de Markdown, como las referencias (`refs.ts`): una casilla dentro de un bloque de código no
 * cuenta ni en el servidor ni en el cliente, y las listas anidadas sí.
 */

const parser = unified().use(remarkParse).use(remarkGfm)

export type Boxes = {
  /** Casillas del texto, marcadas o no. */
  total: number
  /** Las que siguen sin marcar. */
  open: number
}

function walk(node: Parent, out: Boxes): void {
  for (const child of node.children) {
    if (child.type === 'listItem') {
      if (child.checked === true) out.total++
      else if (child.checked === false) {
        out.total++
        out.open++
      }
    }
    if ('children' in child) walk(child as Parent, out)
  }
}

export function countBoxes(text: string): Boxes {
  const out: Boxes = { total: 0, open: 0 }
  // Sin un `[` no hay casilla: evita parsear el texto de la mayoría de los items.
  if (!text.includes('[')) return out
  walk(parser.parse(text) as Root, out)
  return out
}

/** Por qué no se puede completar, o `null` si se puede. El mismo texto lo da el servidor y lo usa la UI. */
export function closeBlocker(text: string): string | null {
  const { open } = countBoxes(text)
  if (open === 0) return null
  return open === 1
    ? 'Falta 1 casilla por marcar para completar el item'
    : `Faltan ${open} casillas por marcar para completar el item`
}
