import { MAX_IMPORT_BYTES } from '@shared/limits'
import { t } from '../../i18n'
import { GraphQLRequestError } from '../../lib/graphql'
import { apiUrl } from '../../lib/server'

export type ImportResult = {
  lists: number
  items: number
  attachments: number
  skippedAttachments: number
  unmatchedRefs: number
}

type Failure = { error?: { code?: string; message?: string } }

async function failure(res: Response): Promise<GraphQLRequestError> {
  let body: Failure = {}
  try {
    body = await res.json()
  } catch {
    // Una respuesta sin JSON (un corte de Nginx, por ejemplo) se informa con el estado.
  }
  return new GraphQLRequestError(
    body.error?.message ??
      (res.status === 413 ? t('transfer.tooBig') : `transfer ${res.status}`),
    body.error?.code ?? (res.status === 413 ? 'LIMIT_REACHED' : undefined),
  )
}

/** Nombre que propone el servidor en `Content-Disposition`; si falta, uno con la fecha. */
export function fileNameOf(header: string | null): string {
  const star = header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  if (star) {
    try {
      return decodeURIComponent(star)
    } catch {
      // Se prueba con el nombre simple.
    }
  }
  const plain = header?.match(/filename="([^"]+)"/i)?.[1]
  return plain ?? `mychecklist-${new Date().toISOString().slice(0, 10)}.json`
}

/** Baja el export de la org (`GET /export/:org`) como archivo. Lanza `GraphQLRequestError` si el servidor lo rechaza. */
export async function downloadExport(
  orgId: string,
  opts: { attachments: boolean },
): Promise<void> {
  const res = await fetch(
    apiUrl(
      `/export/${encodeURIComponent(orgId)}${opts.attachments ? '' : '?attachments=0'}`,
    ),
    { credentials: 'include' },
  )
  if (!res.ok) throw await failure(res)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileNameOf(res.headers.get('content-disposition'))
  a.click()
  // El navegador ya tomó el blob al hacer clic; se suelta en el próximo turno.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Sube un export a la org (`POST /import/:org`). */
export async function uploadImport(
  orgId: string,
  file: File,
): Promise<ImportResult> {
  // Se avisa antes de subir: un archivo grande tarda y el servidor lo cortaría igual.
  if (file.size > MAX_IMPORT_BYTES)
    throw new GraphQLRequestError(t('transfer.tooBig'), 'LIMIT_REACHED')
  const res = await fetch(apiUrl(`/import/${encodeURIComponent(orgId)}`), {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: file,
  })
  if (!res.ok) throw await failure(res)
  return ((await res.json()) as { result: ImportResult }).result
}
