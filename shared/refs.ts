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

/** Esquema de la URL de un adjunto en el texto: `attachment:<id>` (ADR 0005). */
export const ATTACHMENT_PROTOCOL = 'attachment:'

export type IdMaps = {
  /** Id viejo → id nuevo de los items. */
  items: ReadonlyMap<string, string>
  /** Id viejo → id nuevo de los adjuntos. */
  attachments: ReadonlyMap<string, string>
}

type Edit = { start: number; end: number; value: string }

// `[[id]]` tal como puede estar escrito en la fuente: Markdown permite `\[` y `\]`, que el parser resuelve antes de que
// `splitRefs` vea el texto (ADR 0005: no hay escape con backslash).
const SOURCE_REF = new RegExp(
  String.raw`(?:\\?\[){2}(${ULID})(?:\\?\]){2}`,
  'g',
)

/**
 * Cambia los ids que lleva un texto Markdown (`[[id]]`, `item:<id>` y `attachment:<id>`) según `maps`, tocando solo lo
 * que el parser considera referencia: el código y el interior de links quedan como están, igual que en `extractRefs`.
 * Un id que no está en el mapa se deja como estaba. Se edita la fuente por posición, así el resto del texto no cambia
 * ni un byte. `unmatched` cuenta las referencias que el parser vio pero no se pudieron ubicar en la fuente (entidades
 * raras): esas quedan sin tocar.
 */
export function remapIds(
  text: string,
  maps: IdMaps,
): { text: string; unmatched: number } {
  const edits: Edit[] = []
  let unmatched = 0

  /** Reemplaza `<scheme><oldId>` dentro de `[from, to)` de la fuente; `last` busca desde el final (imágenes). */
  const swapUrl = (
    scheme: string,
    oldId: string,
    newId: string,
    from: number,
    to: number,
    last = false,
  ) => {
    const needle = `${scheme}${oldId}`
    const slice = text.slice(from, to)
    const at = last ? slice.lastIndexOf(needle) : slice.indexOf(needle)
    if (at < 0) {
      unmatched++
      return
    }
    const start = from + at + scheme.length
    edits.push({ start, end: start + oldId.length, value: newId })
  }

  const url = (
    node: { url: string; position?: Parent['position'] },
    after: number,
    last: boolean,
  ) => {
    const pos = node.position
    if (!pos || pos.start.offset == null || pos.end.offset == null) return
    const itemId = refIdOf(node.url)
    const attId = node.url.startsWith(ATTACHMENT_PROTOCOL)
      ? node.url.slice(ATTACHMENT_PROTOCOL.length)
      : null
    const newItem = itemId ? maps.items.get(itemId) : undefined
    const newAtt = attId ? maps.attachments.get(attId) : undefined
    const from = Math.max(after, pos.start.offset)
    if (itemId && newItem)
      swapUrl(REF_PROTOCOL, itemId, newItem, from, pos.end.offset, last)
    else if (attId && newAtt)
      swapUrl(ATTACHMENT_PROTOCOL, attId, newAtt, from, pos.end.offset, last)
  }

  const walk = (node: Parent) => {
    for (const child of node.children) {
      switch (child.type) {
        case 'text': {
          const refs = splitRefs(child.value).filter(
            (p): p is { ref: string } => typeof p !== 'string',
          )
          if (!refs.some((r) => maps.items.has(r.ref))) break
          const pos = child.position
          if (!pos || pos.start.offset == null || pos.end.offset == null) {
            unmatched += refs.length
            break
          }
          const base = pos.start.offset
          const found = [
            ...text.slice(base, pos.end.offset).matchAll(SOURCE_REF),
          ]
          if (
            found.length !== refs.length ||
            found.some((m, i) => m[1] !== refs[i]!.ref)
          ) {
            unmatched += refs.length
            break
          }
          found.forEach((m, i) => {
            const next = maps.items.get(refs[i]!.ref)
            if (!next) return
            const start = base + m.index + m[0].indexOf(m[1]!)
            edits.push({ start, end: start + m[1]!.length, value: next })
          })
          break
        }
        case 'link': {
          // El destino viene después del texto del link: se busca desde donde terminan sus hijos.
          const after = child.children.reduce(
            (max, c) => Math.max(max, c.position?.end.offset ?? 0),
            0,
          )
          url(child, after, false)
          break
        }
        case 'image':
          url(child, 0, true)
          break
        case 'definition':
          url(child, 0, false)
          break
        case 'linkReference':
          break
        default:
          if ('children' in child) walk(child as Parent)
      }
    }
  }

  walk(parser.parse(text))
  let out = text
  for (const e of edits.sort((a, b) => b.start - a.start))
    out = out.slice(0, e.start) + e.value + out.slice(e.end)
  return { text: out, unmatched }
}
