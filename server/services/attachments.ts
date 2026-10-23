import { MAX_ATTACHMENT_BYTES } from '../../shared/limits'
import { ulid } from '../db/ids'
import { openScope, type AttachmentRow } from '../db/scoped'
import { DomainError } from '../errors'
import type { FileStore } from '../files'
import type { Database } from 'bun:sqlite'
import type { Caller } from './types'

export { MAX_ATTACHMENT_BYTES }
export const MAX_ORG_ATTACHMENT_BYTES = 500 * 1024 * 1024
const MAX_NAME = 120

export type AttachmentDeps = { db: Database; files: FileStore }

export type AttachmentView = {
  id: string
  orgId: string
  name: string
  mime: string
  size: number
  /** Se muestra en línea: solo los formatos de imagen que se reconocen por su contenido. */
  image: boolean
}

const IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
])
export const GENERIC_MIME = 'application/octet-stream'

const startsWith = (bytes: Uint8Array, magic: number[], at = 0) =>
  magic.every((b, i) => bytes[at + i] === b)

/**
 * Formato de imagen por los primeros bytes. Se ignora lo que diga el cliente: un archivo que se hace pasar por imagen
 * se sirve como descarga, nunca en línea. SVG queda afuera a propósito (puede llevar scripts).
 */
export function sniffImage(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return 'image/png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (
    startsWith(bytes, [0x47, 0x49, 0x46, 0x38]) &&
    [0x37, 0x39].includes(bytes[4]!) &&
    bytes[5] === 0x61
  )
    return 'image/gif'
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  )
    return 'image/webp'
  return null
}

/** Nombre para mostrar: sin carpetas, sin caracteres de control y acotado. */
export function cleanFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? ''
  const name = [...base]
    .filter((c) => {
      const code = c.charCodeAt(0)
      return code > 0x1f && code !== 0x7f
    })
    .join('')
    .trim()
  return (name || 'archivo').slice(0, MAX_NAME)
}

const view = (orgId: string, a: AttachmentRow): AttachmentView => ({
  id: a.id,
  orgId,
  name: a.name,
  mime: a.mime,
  size: a.size,
  image: IMAGE_MIMES.has(a.mime),
})

export async function uploadAttachment(
  { db, files }: AttachmentDeps,
  caller: Caller,
  input: { orgId: string; name: string; bytes: Uint8Array },
  now = Date.now(),
): Promise<AttachmentView> {
  const scope = openScope(db, { orgId: input.orgId, ...caller })
  const { bytes } = input
  if (bytes.byteLength === 0)
    throw new DomainError('INVALID_INPUT', 'El archivo está vacío')
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES)
    throw new DomainError(
      'LIMIT_REACHED',
      `Un archivo admite hasta ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`,
    )
  const sha256 = new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
  const existing = scope.attachments.bySha(sha256)
  if (existing) return view(input.orgId, existing)
  if (
    scope.attachments.totalBytes() + bytes.byteLength >
    MAX_ORG_ATTACHMENT_BYTES
  )
    throw new DomainError(
      'LIMIT_REACHED',
      'Se llenó el espacio de adjuntos de esta organización',
    )

  // El contenido primero: si el registro falla queda un archivo huérfano (inocuo, es por contenido), nunca al revés.
  await files.put(sha256, bytes)
  const id = ulid(now)
  const row = {
    id,
    sha256,
    name: cleanFileName(input.name),
    mime: sniffImage(bytes) ?? GENERIC_MIME,
    size: bytes.byteLength,
  }
  return db.transaction(() => {
    // Otra subida del mismo contenido pudo ganar mientras se escribía el archivo.
    const raced = scope.attachments.bySha(sha256)
    if (raced) return view(input.orgId, raced)
    scope.attachments.insert(row, now)
    scope.activity.append(
      {
        type: 'attachment.uploaded',
        entityType: 'attachment',
        entityId: id,
        via: caller.via ?? 'web',
      },
      now,
    )
    return view(input.orgId, scope.attachments.get(id)!)
  })()
}

/** Metadatos y ruta en disco de un adjunto de la org; `NOT_FOUND` si no es de esa org. */
export function openAttachment(
  { db, files }: AttachmentDeps,
  caller: Caller,
  orgId: string,
  id: string,
): { attachment: AttachmentView; sha256: string; path: string } {
  const scope = openScope(db, { orgId, ...caller })
  const row = scope.attachments.get(id)
  if (!row) throw new DomainError('NOT_FOUND', 'El adjunto no existe')
  return {
    attachment: view(orgId, row),
    sha256: row.sha256,
    path: files.path(row.sha256),
  }
}
