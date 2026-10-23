import { DomainError } from '../errors'

export const MAX_LISTS = 200
export const MAX_ITEMS_PER_LIST = 5000
export const MAX_NAME = 80
export const MAX_TEXT = 4000

/** Texto no vacío (sin espacios en los bordes) y de largo acotado. Los nombres no admiten saltos de línea. */
export function cleanText(
  value: string,
  opts: { max: number; label: string; multiline?: boolean },
): string {
  const text = value.trim()
  if (!text)
    throw new DomainError('INVALID_INPUT', `${opts.label} no puede estar vacío`)
  if (text.length > opts.max)
    throw new DomainError(
      'INVALID_INPUT',
      `${opts.label} admite hasta ${opts.max} caracteres`,
    )
  if (!opts.multiline && /[\r\n]/.test(text))
    throw new DomainError(
      'INVALID_INPUT',
      `${opts.label} no admite saltos de línea`,
    )
  return text
}
