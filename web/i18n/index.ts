import { es, type MessageKey } from './es'

/** Busca un texto por clave y reemplaza `{nombre}` por los valores dados. */
export function t(
  key: MessageKey,
  values: Record<string, string | number> = {},
): string {
  return es[key].replace(/\{(\w+)\}/g, (_, name: string) =>
    String(values[name] ?? `{${name}}`),
  )
}
