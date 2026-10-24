/**
 * Orden fraccional: cada item guarda una clave de texto y se ordena por ella (`ORDER BY position`, colación binaria).
 * Mover un item reescribe solo su clave: insertar entre dos vecinos no toca al resto, así que dos personas moviendo
 * items distintos no se pisan. Las claves son fracciones en base 62 (`0.d1d2…`) sin ceros finales.
 */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const BASE = DIGITS.length

/** Punto medio entre `a` (vacío = el principio) y `b` (`null` = el final), con `a < b`. */
function mid(a: string, b: string | null): string {
  if (b !== null) {
    // Prefijo común: se conserva y se resuelve el resto (`a` se completa con ceros).
    let n = 0
    while ((a[n] ?? '0') === b[n]) n++
    if (n > 0) return b.slice(0, n) + mid(a.slice(n), b.slice(n))
  }
  const da = a ? DIGITS.indexOf(a[0]!) : 0
  const db = b !== null ? DIGITS.indexOf(b[0]!) : BASE
  if (db - da > 1) return DIGITS[Math.round((da + db) / 2)]!
  // Dígitos contiguos: si `b` sigue, su primer dígito solo ya queda entre ambos.
  if (b !== null && b.length > 1) return b.slice(0, 1)
  return DIGITS[da]! + mid(a.slice(1), null)
}

/** Una clave de orden bien formada: base 62, no vacía y sin ceros finales. */
export function isOrderKey(key: string): boolean {
  return (
    key.length > 0 &&
    !key.endsWith('0') &&
    [...key].every((c) => DIGITS.includes(c))
  )
}

/**
 * Clave que ordena estrictamente entre `before` y `after`. `null` en un extremo significa "sin vecino": el principio
 * o el final de la lista. Lanza si las claves no son válidas o no están en orden.
 */
export function between(before: string | null, after: string | null): string {
  if (
    (before !== null && !isOrderKey(before)) ||
    (after !== null && !isOrderKey(after))
  )
    throw new Error('Clave de orden inválida')
  if (before !== null && after !== null && before >= after)
    throw new Error('Las claves de orden no están en orden')
  return mid(before ?? '', after)
}

/** Claves para insertar `count` items consecutivos entre `before` y `after` (import, pegado de varias líneas). */
export function betweenMany(
  before: string | null,
  after: string | null,
  count: number,
): string[] {
  const keys: string[] = []
  let prev = before
  for (let i = 0; i < count; i++) {
    const key = between(prev, after)
    keys.push(key)
    prev = key
  }
  return keys
}
