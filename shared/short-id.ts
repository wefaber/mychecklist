/**
 * Identificador corto de un item (ADR 0012): `<ORG>-<LISTA>-<NUM>`, o `<LISTA>-<NUM>` cuando la org no tiene código
 * (las personales). `LISTA` es el código de la lista, `NUM` el número del item dentro de ella. Es lo que se ve y se
 * dicta; lo que se guarda en el texto sigue siendo el ULID (ADR 0005).
 */

/** Código de una lista o de una org: mayúsculas y dígitos, empieza con letra, de 2 a 8 caracteres. */
export const CODE_PATTERN = /^[A-Z][A-Z0-9]{1,7}$/
export const MAX_CODE = 8

export type ShortId = {
  /** Código de la org si se escribió, `null` si no. */
  org: string | null
  list: string
  number: number
}

const SHORT =
  /^(?:([A-Z][A-Z0-9]{1,7})-)?([A-Z][A-Z0-9]{1,7})-([1-9][0-9]{0,8})$/

/** Lee un identificador corto (sin distinguir mayúsculas); `null` si no tiene esa forma. */
export function parseShortId(value: string): ShortId | null {
  const m = SHORT.exec(value.trim().toUpperCase())
  if (!m) return null
  return { org: m[1] ?? null, list: m[2]!, number: Number(m[3]) }
}

export function formatShortId(
  orgCode: string | null,
  listCode: string,
  number: number,
): string {
  return `${orgCode ? `${orgCode}-` : ''}${listCode}-${number}`
}

/** `AA-12` o `WF-AA-12` tal como puede estar escrito entre corchetes dentro de un texto. */
export const SHORT_REF_SOURCE = String.raw`[A-Za-z][A-Za-z0-9]{1,7}(?:-[A-Za-z][A-Za-z0-9]{1,7})?-[1-9][0-9]{0,8}`

/**
 * Código sugerido para el nombre de una lista (o de una org): iniciales si hay varias palabras (`Ad Astra` → `AA`,
 * `WeFaber` → `WF`) o el comienzo de la palabra (`Economía` → `ECO`). Si ya está tomado agrega un número.
 */
export function codeFromName(
  name: string,
  taken: ReadonlySet<string> = new Set(),
): string {
  const words = name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    // `WeFaber` y `AdAstra` son dos palabras.
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toUpperCase())
  let base =
    words.length >= 2
      ? words
          .slice(0, 4)
          .map((w) => w[0])
          .join('')
      : (words[0] ?? '')
  base = base.replace(/^[0-9]+/, '').slice(0, words.length >= 2 ? 4 : 3)
  if (!base) base = 'L'
  if (base.length < 2) base += 'X'
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const suffix = String(n)
    const candidate = base.slice(0, MAX_CODE - suffix.length) + suffix
    if (!taken.has(candidate)) return candidate
  }
}

/** `null` si el texto es un código válido (ya en mayúsculas), o el motivo si no. */
export function checkCode(code: string): string | null {
  return CODE_PATTERN.test(code)
    ? null
    : 'El código lleva de 2 a 8 letras mayúsculas o dígitos y empieza con una letra'
}
