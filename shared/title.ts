const MAX_TITLE = 120

/** Referencias `[[id]]` (ver `refs.ts`): en un título no dicen nada, el id no es legible. */
const REF = /\[\[[0-9A-HJKMNP-TV-Z]{26}\]\]/g

/**
 * Título corto de un item para chips, backlinks y selector: su primera línea con contenido, sin las marcas de
 * Markdown (`#`, viñetas, casillas, citas, énfasis, código, links e imágenes) y acotada. Puede quedar vacío (un item que
 * es solo una referencia): quien lo muestra pone su propio texto.
 */
export function titleOf(text: string): string {
  const line =
    text
      .split(/\r?\n/)
      .map((l) =>
        l
          .replace(
            /^\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s*)+/,
            '',
          )
          .trim(),
      )
      .find((l) => clean(l)) ?? ''
  const title = clean(line)
  return title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE - 1)}…` : title
}

function clean(line: string): string {
  return line
    .replace(REF, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`+([^`]*)`+/g, '$1')
    .replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])([*_])(\S(?:.*?\S)?)\2(?=$|[\s).,;:!?])/g, '$1$3')
    .replace(/\s+/g, ' ')
    .trim()
}
