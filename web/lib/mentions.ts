import { apiUrl } from './server'

/** Un item enlazado con `[[id]]`, como lo devuelve el servidor (`Item.mentions`, `Item.backlinks`). */
export type Mention = {
  id: string
  listId: string
  listName: string
  title: string
  done: boolean
}

export const ATTACHMENT = /^attachment:([0-9A-HJKMNP-TV-Z]{26})$/

/** URL para pedir un adjunto de la org; la cookie de sesión lo autoriza. */
export const attachmentUrl = (orgId: string, id: string) =>
  apiUrl(`/files/${encodeURIComponent(orgId)}/${id}`)

/**
 * ¿Vale la pena pasar el texto por el parser? Un item de una línea sin marcas se dibuja como texto plano, igual que
 * antes de M3: las listas largas no pagan el costo de un parser por fila.
 */
export function hasMarkdown(text: string): boolean {
  return /[*_`~[\]\\<>|]|\n|https?:\/\/|www\.|^\s{0,3}(?:#{1,6}\s|[-+]\s|\d+[.)]\s)/.test(
    text,
  )
}
