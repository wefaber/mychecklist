import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DomainError } from './errors'

/** Almacén de contenido direccionado por sha256: `<dir>/<aa>/<sha256>`. No sabe de orgs ni de usuarios. */
export type FileStore = {
  /** Ruta del archivo; nunca sale de `dir` porque el sha256 se valida. */
  path(sha256: string): string
  /** Guarda el contenido si no estaba. Atómico: escribe a un temporal y renombra. */
  put(sha256: string, bytes: Uint8Array): Promise<void>
}

const SHA256 = /^[0-9a-f]{64}$/

export function fileStore(dir: string): FileStore {
  const path = (sha256: string) => {
    if (!SHA256.test(sha256)) throw new Error('sha256 inválido')
    return join(dir, sha256.slice(0, 2), sha256)
  }
  return {
    path,
    async put(sha256, bytes) {
      const target = path(sha256)
      if (await Bun.file(target).exists()) return
      await mkdir(join(dir, sha256.slice(0, 2)), { recursive: true })
      const tmp = `${target}.${crypto.randomUUID()}.tmp`
      await writeFile(tmp, bytes)
      await rename(tmp, target)
    },
  }
}

/** Lee el cuerpo de una request sin pasar de `max` bytes: corta apenas se excede, sin acumular el resto. */
export async function readCapped(
  request: Request,
  max: number,
  message = `Un archivo admite hasta ${max / 1024 / 1024} MB`,
): Promise<Uint8Array> {
  const tooBig = () => new DomainError('LIMIT_REACHED', message)
  if (Number(request.headers.get('content-length') ?? 0) > max) throw tooBig()
  const reader = request.body?.getReader()
  if (!reader) return new Uint8Array(0)
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel()
      throw tooBig()
    }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.byteLength
  }
  return out
}
