import { MAX_ATTACHMENT_BYTES } from '@shared/limits'
import { t } from '../../i18n'
import { GraphQLRequestError } from '../../lib/graphql'
import { apiUrl } from '../../lib/server'

export type Attachment = {
  id: string
  name: string
  mime: string
  size: number
  image: boolean
}

/** Sube un archivo a la org (`POST /files/:org`). Lanza `GraphQLRequestError` con el `code` del servidor si falla. */
export async function uploadFile(
  orgId: string,
  file: File,
): Promise<Attachment> {
  // Se avisa antes de subir: un archivo grande tarda y Nginx lo cortaría igual.
  if (file.size > MAX_ATTACHMENT_BYTES)
    throw new GraphQLRequestError(t('error.fileTooBig'), 'LIMIT_REACHED')
  const res = await fetch(apiUrl(`/files/${encodeURIComponent(orgId)}`), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'content-type': file.type || 'application/octet-stream',
      'x-file-name': encodeURIComponent(file.name),
    },
    body: file,
  })
  let body: {
    attachment?: Attachment
    error?: { code?: string; message?: string }
  } = {}
  try {
    body = await res.json()
  } catch {
    // Una respuesta sin JSON (un corte de Nginx, por ejemplo) se informa abajo con el estado.
  }
  if (!res.ok || !body.attachment)
    throw new GraphQLRequestError(
      body.error?.message ??
        (res.status === 413 ? t('error.fileTooBig') : `upload ${res.status}`),
      // Nginx corta los cuerpos grandes con 413 antes de llegar al servidor.
      body.error?.code ?? (res.status === 413 ? 'LIMIT_REACHED' : undefined),
    )
  return body.attachment
}

/** Markdown que enlaza un adjunto: imagen con `!`, el resto como link. Los corchetes del nombre se escapan. */
export function attachmentMarkdown(a: Attachment): string {
  const name = a.name.replace(/[[\]\\]/g, '\\$&')
  return `${a.image ? '!' : ''}[${name}](attachment:${a.id})`
}

/** Inserta `snippet` en lugar de la selección `[start, end)`; devuelve el texto nuevo y dónde queda el cursor. */
export function insertAt(
  text: string,
  start: number,
  end: number,
  snippet: string,
): { text: string; caret: number } {
  return {
    text: text.slice(0, start) + snippet + text.slice(end),
    caret: start + snippet.length,
  }
}

/** Pone el fragmento en su propio renglón si el cursor está en medio de una línea. */
export function asBlock(text: string, at: number, snippet: string): string {
  const before = at > 0 && text[at - 1] !== '\n' ? '\n' : ''
  const after = at < text.length && text[at] !== '\n' ? '\n' : ''
  return before + snippet + after
}
