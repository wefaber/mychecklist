import {
  MAX_ATTACHMENT_BYTES,
  MAX_EXPORT_ATTACHMENT_BYTES,
} from '../../shared/limits'
import { between } from '../../shared/order'
import { remapIds } from '../../shared/refs'
import { ulid } from '../db/ids'
import { openScope, type ItemRow, type Scope } from '../db/scoped'
import { DomainError } from '../errors'
import type { Bus } from '../events'
import type { FileStore } from '../files'
import type { Database } from 'bun:sqlite'
import {
  cleanFileName,
  GENERIC_MIME,
  MAX_ORG_ATTACHMENT_BYTES,
  sniffImage,
} from './attachments'
import { syncRefs } from './items'
import {
  FORMAT,
  parseExport,
  SCHEMA,
  type ExportAttachment,
  type ExportFile,
  type ExportItem,
} from './transfer-format'
import type { Caller } from './types'
import { MAX_ITEMS_PER_LIST, MAX_LISTS } from './validate'

export type TransferDeps = { db: Database; files: FileStore; bus: Bus }

const via = (c: Caller) => c.via ?? 'web'

/** Items de una lista en orden de árbol: cada item de primer nivel seguido de sus subitems. */
function treeOrder(rows: ItemRow[]): ItemRow[] {
  const children = new Map<string, ItemRow[]>()
  for (const r of rows)
    if (r.parentId !== null) {
      const sibs = children.get(r.parentId)
      if (sibs) sibs.push(r)
      else children.set(r.parentId, [r])
    }
  return rows
    .filter((r) => r.parentId === null)
    .flatMap((r) => [r, ...(children.get(r.id) ?? [])])
}

const exportItem = (i: ItemRow): ExportItem => ({
  id: i.id,
  parentId: i.parentId,
  position: i.position,
  text: i.text,
  doneAt: i.doneAt,
  createdAt: i.createdAt,
  updatedAt: i.updatedAt,
  deletedAt: i.deletedAt,
})

/**
 * Todo lo de una org en un solo objeto (ADR 0008): listas y items con sus borrados lógicos, y los adjuntos con su
 * contenido en base64. Con `attachments: false` los adjuntos van sin contenido. Pasado el tope, pide exportar sin ellos.
 */
export async function exportOrg(
  { db, files }: Pick<TransferDeps, 'db' | 'files'>,
  caller: Caller,
  input: { orgId: string; attachments?: boolean; version?: string },
  now = Date.now(),
): Promise<ExportFile> {
  const scope = openScope(db, { orgId: input.orgId, ...caller })
  const withData = input.attachments !== false
  const atts = scope.attachments.all()
  const bytes = atts.reduce((n, a) => n + a.size, 0)
  if (withData && bytes > MAX_EXPORT_ATTACHMENT_BYTES)
    throw new DomainError(
      'LIMIT_REACHED',
      `Los adjuntos pesan ${Math.ceil(bytes / 1024 / 1024)} MB y un export admite hasta ${MAX_EXPORT_ATTACHMENT_BYTES / 1024 / 1024} MB: exportá sin adjuntos`,
    )

  const itemsByList = new Map<string, ItemRow[]>()
  for (const i of scope.items.dump()) {
    const rows = itemsByList.get(i.listId)
    if (rows) rows.push(i)
    else itemsByList.set(i.listId, [i])
  }
  const attachments: ExportAttachment[] = []
  for (const a of atts)
    attachments.push({
      id: a.id,
      name: a.name,
      mime: a.mime,
      size: a.size,
      sha256: a.sha256,
      data: withData
        ? Buffer.from(await Bun.file(files.path(a.sha256)).bytes()).toString(
            'base64',
          )
        : null,
    })

  const file: ExportFile = {
    format: FORMAT,
    schema: SCHEMA,
    exportedAt: new Date(now).toISOString(),
    app: { version: input.version ?? 'dev' },
    org: { name: scope.org.name, kind: scope.org.kind },
    lists: scope.lists.dump().map((l) => ({
      id: l.id,
      name: l.name,
      position: l.position,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
      deletedAt: l.deletedAt,
      items: treeOrder(itemsByList.get(l.id) ?? []).map(exportItem),
    })),
    attachments,
  }
  scope.activity.append(
    {
      type: 'org.exported',
      entityType: 'org',
      entityId: scope.org.id,
      via: via(caller),
    },
    now,
  )
  return file
}

export type ImportResult = {
  lists: number
  items: number
  attachments: number
  /** Adjuntos del archivo sin contenido: se descartaron y sus referencias quedan como "no disponible". */
  skippedAttachments: number
  /** Referencias que el parser vio pero no se pudieron reescribir; quedan como estaban. */
  unmatchedRefs: number
}

function assertLimits(scope: Scope, file: ExportFile, newBytes: number) {
  const liveLists = file.lists.filter((l) => l.deletedAt === null).length
  if (scope.lists.count() + liveLists > MAX_LISTS)
    throw new DomainError(
      'LIMIT_REACHED',
      `Una organización admite hasta ${MAX_LISTS} listas`,
    )
  for (const l of file.lists) {
    const live = l.items.filter((i) => i.deletedAt === null).length
    if (live > MAX_ITEMS_PER_LIST)
      throw new DomainError(
        'LIMIT_REACHED',
        `Una lista admite hasta ${MAX_ITEMS_PER_LIST} items`,
      )
  }
  if (scope.attachments.totalBytes() + newBytes > MAX_ORG_ATTACHMENT_BYTES)
    throw new DomainError(
      'LIMIT_REACHED',
      'Se llenó el espacio de adjuntos de esta organización',
    )
}

/**
 * Importa un export (ya leído como JSON) a la org: agrega, nunca pisa. Todo se valida antes de escribir y las listas,
 * items, referencias y registros de adjuntos entran en una sola transacción; el contenido de los adjuntos se guarda
 * antes (es por contenido, un archivo de más es inocuo si la transacción falla). Los ids se regeneran y los textos se
 * reescriben para que sigan señalando lo mismo.
 */
export async function importOrg(
  { db, files, bus }: TransferDeps,
  caller: Caller,
  input: { orgId: string; payload: unknown },
  now = Date.now(),
): Promise<ImportResult> {
  const scope = openScope(db, { orgId: input.orgId, ...caller })
  const file = parseExport(input.payload)

  // Contenido de los adjuntos: se verifica contra lo que declara el archivo antes de tocar nada.
  const decoded = new Map<string, Uint8Array>()
  let skippedAttachments = 0
  for (const a of file.attachments) {
    if (a.data === null) {
      skippedAttachments++
      continue
    }
    const bytes = Buffer.from(a.data, 'base64')
    const sha256 = new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
    if (
      bytes.byteLength !== a.size ||
      bytes.byteLength > MAX_ATTACHMENT_BYTES ||
      sha256 !== a.sha256
    )
      throw new DomainError(
        'INVALID_INPUT',
        `Archivo inválido: el contenido del adjunto "${a.name}" no coincide con su tamaño o su sha256`,
      )
    decoded.set(a.id, bytes)
  }
  const newBytes = [
    ...new Map(
      file.attachments
        .filter((a) => decoded.has(a.id) && !scope.attachments.bySha(a.sha256))
        .map((a) => [a.sha256, a.size]),
    ).values(),
  ].reduce((n, s) => n + s, 0)
  assertLimits(scope, file, newBytes)

  for (const a of file.attachments) {
    const bytes = decoded.get(a.id)
    if (bytes) await files.put(a.sha256, bytes)
  }

  // Ids nuevos en el orden del archivo: el desempate por `id` de `ORDER BY position, id` queda igual que en el origen.
  const itemMap = new Map<string, string>()
  const listMap = new Map<string, string>()
  const attMap = new Map<string, string>()
  const attBySha = new Map<string, string>()
  for (const l of file.lists) {
    listMap.set(l.id, ulid(now))
    for (const i of l.items) itemMap.set(i.id, ulid(now))
  }

  const result = db.transaction((): ImportResult => {
    let unmatchedRefs = 0
    let attachments = 0
    for (const a of file.attachments) {
      const bytes = decoded.get(a.id)
      if (!bytes) continue
      const existing =
        scope.attachments.bySha(a.sha256)?.id ?? attBySha.get(a.sha256)
      if (existing) {
        attMap.set(a.id, existing)
        continue
      }
      const id = ulid(now)
      scope.attachments.insert(
        {
          id,
          sha256: a.sha256,
          name: cleanFileName(a.name),
          mime: sniffImage(bytes) ?? GENERIC_MIME,
          size: bytes.byteLength,
        },
        now,
      )
      attMap.set(a.id, id)
      attBySha.set(a.sha256, id)
      attachments++
    }

    // Con la org sin listas vivas se conservan las claves de orden; si no, las nuevas van al final.
    const live = scope.lists.all()
    let prev = live.length ? live[live.length - 1]!.position : null
    const keepOrder = live.length === 0
    const maps = { items: itemMap, attachments: attMap }
    const texts: { id: string; text: string }[] = []
    let itemCount = 0
    for (const l of file.lists) {
      let position = l.position
      if (!keepOrder) {
        position = between(prev, null)
        prev = position
      }
      const listId = listMap.get(l.id)!
      scope.lists.insert(
        {
          id: listId,
          name: l.name,
          position,
          createdAt: l.createdAt,
          updatedAt: l.updatedAt,
          deletedAt: l.deletedAt,
        },
        now,
      )
      // Primero los de primer nivel y después sus subitems: el padre tiene que existir antes.
      for (const level of [null, 'child'] as const)
        for (const i of l.items) {
          if ((i.parentId === null) !== (level === null)) continue
          const mapped = remapIds(i.text, maps)
          unmatchedRefs += mapped.unmatched
          const id = itemMap.get(i.id)!
          scope.items.insert(
            {
              id,
              listId,
              parentId: i.parentId === null ? null : itemMap.get(i.parentId)!,
              position: i.position,
              text: mapped.text,
              doneAt: i.doneAt,
              createdAt: i.createdAt,
              updatedAt: i.updatedAt,
              deletedAt: i.deletedAt,
            },
            now,
          )
          texts.push({ id, text: mapped.text })
          itemCount++
        }
    }
    // Las referencias van al final: un item puede mencionar a otro que se inserta después.
    for (const t of texts) syncRefs(scope, t.id, t.text)
    scope.activity.append(
      {
        type: 'org.imported',
        entityType: 'org',
        entityId: scope.org.id,
        via: 'import',
      },
      now,
    )
    return {
      lists: file.lists.length,
      items: itemCount,
      attachments,
      skippedAttachments,
      unmatchedRefs,
    }
  })()

  bus.publish({ orgId: input.orgId, scope: 'lists', actorId: caller.userId })
  for (const id of listMap.values())
    bus.publish({
      orgId: input.orgId,
      scope: 'list',
      listId: id,
      actorId: caller.userId,
    })
  return result
}
