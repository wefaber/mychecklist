import { serverUrl } from './server'

/** Un id de item: ULID de 26 caracteres Crockford base32 (`shared/refs.ts`). */
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/

/** Origen que se comparte: el del servidor al que habla la app (en el escritorio no es el de la ventana). */
const origin = () => serverUrl() || window.location.origin

/** Link al item: `/l/<lista>?item=<id>`, la ruta que ya abre el detalle (ADR 0012). */
export const itemLink = (listId: string, itemId: string) =>
  `${origin()}/l/${listId}?item=${itemId}`

/**
 * El id del item si `text` es, entero, un link a un item de este servidor; `null` si no. Sirve para que pegar un link
 * en un texto deje `[[id]]` (un chip y un backlink) en lugar de una URL.
 */
export function itemIdFromLink(text: string): string | null {
  const value = text.trim()
  if (!value || /\s/.test(value)) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.origin !== new URL(origin(), window.location.origin).origin)
    return null
  if (!/^\/l\/[^/]+\/?$/.test(url.pathname)) return null
  const id = url.searchParams.get('item')
  return id && ULID.test(id) ? id : null
}

/** Copia al portapapeles; `false` si el navegador no lo permite (el llamador avisa). */
export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}
