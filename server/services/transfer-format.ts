import { MAX_ATTACHMENT_BYTES } from '../../shared/limits'
import { isOrderKey } from '../../shared/order'
import { DomainError } from '../errors'
import { cleanText, MAX_NAME, MAX_TEXT } from './validate'

/**
 * Formato del archivo de export (ADR 0008). `schema` es un entero: un lector rechaza uno mayor al que conoce y, cuando
 * exista un 2, conservará un migrador del 1. Los campos desconocidos se ignoran.
 */
export const FORMAT = 'mychecklist'
export const SCHEMA = 1

export const MAX_FILE_LISTS = 1000
export const MAX_FILE_ITEMS = 100_000
export const MAX_FILE_ATTACHMENTS = 5000

export type ExportItem = {
  id: string
  parentId: string | null
  position: string
  text: string
  doneAt: number | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export type ExportList = {
  id: string
  name: string
  position: string
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  /** En orden de árbol: cada item de primer nivel seguido de sus subitems. */
  items: ExportItem[]
}

export type ExportAttachment = {
  id: string
  name: string
  mime: string
  size: number
  sha256: string
  /** Base64 del contenido; `null` si el export se pidió sin adjuntos. */
  data: string | null
}

export type ExportFile = {
  format: typeof FORMAT
  schema: number
  exportedAt: string
  app: { version: string }
  org: { name: string; kind: 'personal' | 'team' }
  lists: ExportList[]
  attachments: ExportAttachment[]
}

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/
const SHA256 = /^[0-9a-f]{64}$/
const MAX_TIME = 8.64e15

const bad = (path: string, why: string): never => {
  throw new DomainError('INVALID_INPUT', `Archivo inválido: ${path} ${why}`)
}

type Obj = Record<string, unknown>

const obj = (v: unknown, path: string): Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Obj)
    : bad(path, 'tiene que ser un objeto')

const arr = (v: unknown, path: string, max: number): unknown[] => {
  if (!Array.isArray(v)) return bad(path, 'tiene que ser una lista')
  if (v.length > max) return bad(path, `admite hasta ${max} elementos`)
  return v
}

const ulid = (v: unknown, path: string): string =>
  typeof v === 'string' && ULID.test(v) ? v : bad(path, 'no es un id válido')

const key = (v: unknown, path: string): string =>
  typeof v === 'string' && isOrderKey(v)
    ? v
    : bad(path, 'no es una clave de orden válida')

const time = (v: unknown, path: string): number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= MAX_TIME
    ? v
    : bad(path, 'no es una fecha válida')

const timeOrNull = (v: unknown, path: string): number | null =>
  v === null || v === undefined ? null : time(v, path)

/** Texto con las mismas reglas que al crearlo a mano; si el recorte lo cambiaría, no es un export nuestro. */
function text(
  v: unknown,
  path: string,
  opts: { max: number; label: string; multiline?: boolean },
): string {
  if (typeof v !== 'string') return bad(path, 'tiene que ser texto')
  try {
    return cleanText(v, opts)
  } catch (e) {
    if (e instanceof DomainError) return bad(path, e.message)
    throw e
  }
}

/**
 * Valida un export entero antes de escribir nada: estructura, tipos, topes, ids únicos y que los subitems cuelguen de
 * un item de primer nivel de su misma lista. Devuelve el archivo tipado; lanza `INVALID_INPUT` con el lugar del error.
 */
export function parseExport(raw: unknown): ExportFile {
  const root = obj(raw, 'el archivo')
  if (root.format !== FORMAT)
    bad('format', `tiene que ser "${FORMAT}": no es un export de MyChecklist`)
  const schema = root.schema
  if (typeof schema !== 'number' || !Number.isInteger(schema) || schema < 1)
    bad('schema', 'tiene que ser un entero desde 1')
  if ((schema as number) > SCHEMA)
    throw new DomainError(
      'INVALID_INPUT',
      `El archivo es de una versión más nueva (esquema ${schema}); esta instalación entiende hasta el ${SCHEMA}`,
    )

  const seen = new Set<string>()
  const unique = (id: string, path: string) => {
    if (seen.has(id)) bad(path, 'repite un id')
    seen.add(id)
    return id
  }

  const org = obj(root.org ?? {}, 'org')
  const app = obj(root.app ?? {}, 'app')
  let totalItems = 0
  const lists = arr(root.lists, 'lists', MAX_FILE_LISTS).map((l, li) => {
    const p = `lists[${li}]`
    const o = obj(l, p)
    const listId = unique(ulid(o.id, `${p}.id`), `${p}.id`)
    const rawItems = arr(o.items ?? [], `${p}.items`, MAX_FILE_ITEMS)
    totalItems += rawItems.length
    if (totalItems > MAX_FILE_ITEMS)
      bad('items', `el archivo admite hasta ${MAX_FILE_ITEMS} items`)
    const topLevel = new Set<string>()
    const items = rawItems.map((it, ii): ExportItem => {
      const ip = `${p}.items[${ii}]`
      const io = obj(it, ip)
      const id = unique(ulid(io.id, `${ip}.id`), `${ip}.id`)
      const parentId =
        io.parentId === null || io.parentId === undefined
          ? null
          : ulid(io.parentId, `${ip}.parentId`)
      if (parentId === null) topLevel.add(id)
      return {
        id,
        parentId,
        position: key(io.position, `${ip}.position`),
        text: text(io.text, `${ip}.text`, {
          max: MAX_TEXT,
          label: 'El texto',
          multiline: true,
        }),
        doneAt: timeOrNull(io.doneAt, `${ip}.doneAt`),
        createdAt: time(io.createdAt, `${ip}.createdAt`),
        updatedAt: time(io.updatedAt, `${ip}.updatedAt`),
        deletedAt: timeOrNull(io.deletedAt, `${ip}.deletedAt`),
      }
    })
    items.forEach((it, ii) => {
      if (it.parentId !== null && !topLevel.has(it.parentId))
        bad(
          `${p}.items[${ii}].parentId`,
          'tiene que ser un item de primer nivel de la misma lista',
        )
    })
    return {
      id: listId,
      name: text(o.name, `${p}.name`, { max: MAX_NAME, label: 'El nombre' }),
      position: key(o.position, `${p}.position`),
      createdAt: time(o.createdAt, `${p}.createdAt`),
      updatedAt: time(o.updatedAt, `${p}.updatedAt`),
      deletedAt: timeOrNull(o.deletedAt, `${p}.deletedAt`),
      items,
    }
  })

  const attachments = arr(
    root.attachments ?? [],
    'attachments',
    MAX_FILE_ATTACHMENTS,
  ).map((a, ai): ExportAttachment => {
    const p = `attachments[${ai}]`
    const o = obj(a, p)
    const size = o.size
    if (
      typeof size !== 'number' ||
      !Number.isInteger(size) ||
      size < 1 ||
      size > MAX_ATTACHMENT_BYTES
    )
      bad(`${p}.size`, 'no es un tamaño válido')
    if (typeof o.sha256 !== 'string' || !SHA256.test(o.sha256))
      bad(`${p}.sha256`, 'no es un sha256')
    if (o.data !== null && o.data !== undefined && typeof o.data !== 'string')
      bad(`${p}.data`, 'tiene que ser base64 o null')
    return {
      id: unique(ulid(o.id, `${p}.id`), `${p}.id`),
      name: typeof o.name === 'string' ? o.name : 'archivo',
      mime: typeof o.mime === 'string' ? o.mime : '',
      size: size as number,
      sha256: o.sha256 as string,
      data: (o.data as string | null | undefined) ?? null,
    }
  })

  return {
    format: FORMAT,
    schema: schema as number,
    exportedAt: typeof root.exportedAt === 'string' ? root.exportedAt : '',
    app: { version: typeof app.version === 'string' ? app.version : '' },
    org: {
      name: typeof org.name === 'string' ? org.name : '',
      kind: org.kind === 'team' ? 'team' : 'personal',
    },
    lists,
    attachments,
  }
}
