import type { Link, Parent, Root, RootContent } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

/**
 * Referencias entre items: `[[<id>]]` dentro del Markdown de un item (ADR 0005). El mismo recorrido del árbol de
 * Markdown sirve al servidor (para guardar los backlinks) y al cliente (para dibujar los chips), así lo que se guarda
 * y lo que se ve nunca difieren: una referencia dentro de código o de un link no cuenta en ninguno de los dos lados.
 */

/** Un id de item es un ULID: 26 caracteres Crockford base32 (`server/db/ids.ts`). */
const ULID = '[0-9A-HJKMNP-TV-Z]{26}'
const REF = new RegExp(`\\[\\[(${ULID})\\]\\]`, 'g')

/** Esquema de la URL que reemplaza a la referencia en el árbol; el cliente lo dibuja como chip. */
export const REF_PROTOCOL = 'item:'

/** Tope de referencias distintas por item: acota el trabajo del servidor y el ruido del Dock. */
export const MAX_REFS = 50

export const refUrl = (id: string) => `${REF_PROTOCOL}${id}`

/** Id de item que lleva una URL `item:<id>`, o `null` si no es una. */
export function refIdOf(url: string): string | null {
  if (!url.startsWith(REF_PROTOCOL)) return null
  const id = url.slice(REF_PROTOCOL.length)
  return new RegExp(`^${ULID}$`).test(id) ? id : null
}

/** Parte un texto plano en tramos de texto y referencias, en orden. */
export function splitRefs(value: string): (string | { ref: string })[] {
  const out: (string | { ref: string })[] = []
  let last = 0
  for (const m of value.matchAll(REF)) {
    if (m.index > last) out.push(value.slice(last, m.index))
    out.push({ ref: m[1]! })
    last = m.index + m[0].length
  }
  if (last < value.length) out.push(value.slice(last))
  return out
}

/**
 * Reemplaza cada referencia de un nodo de texto por un link `item:<id>`. No entra en links (no se anidan), y el código
 * (en línea o en bloque) no tiene hijos de texto, así que queda como está.
 */
function rewrite(node: Parent, onRef: (id: string) => void): void {
  if (node.type === 'link') {
    // Un `[texto](item:<id>)` escrito a mano se dibuja como chip igual que `[[id]]`, así que también cuenta.
    const id = refIdOf((node as Link).url)
    if (id) onRef(id)
    return
  }
  if (node.type === 'linkReference') return
  const next: RootContent[] = []
  for (const child of node.children) {
    if (child.type !== 'text') {
      if ('children' in child) rewrite(child, onRef)
      next.push(child)
      continue
    }
    const parts = splitRefs(child.value)
    if (parts.length === 1 && typeof parts[0] === 'string') {
      next.push(child)
      continue
    }
    for (const part of parts) {
      if (typeof part === 'string') next.push({ type: 'text', value: part })
      else {
        onRef(part.ref)
        next.push({
          type: 'link',
          url: refUrl(part.ref),
          children: [{ type: 'text', value: `[[${part.ref}]]` }],
        })
      }
    }
  }
  node.children = next
}

/** Plugin de remark: deja cada `[[id]]` como un link `item:<id>` (lo usa `react-markdown` en el cliente). */
export function remarkRefs() {
  return (tree: Root) => rewrite(tree, () => {})
}

const parser = unified().use(remarkParse).use(remarkGfm)

/**
 * Ids de items referenciados por un texto, sin repetir y en orden de aparición. No verifica que existan: eso lo hace el
 * servicio contra la org. Corta en `MAX_REFS`.
 */
export function extractRefs(text: string): string[] {
  const found = new Set<string>()
  rewrite(parser.parse(text), (id) => found.add(id))
  return [...found].slice(0, MAX_REFS)
}
