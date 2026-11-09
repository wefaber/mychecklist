import type { Database } from 'bun:sqlite'
import { DomainError } from '../errors'
import type { Ingress } from '../ingress'
import { codeFromName } from '../../shared/short-id'
import { ulid } from './ids'
import type { OrgKind, Role } from './accounts'

export type Via = 'web' | 'mcp' | 'import' | 'job'

export type ActivityEntry = {
  id: string
  actorId: string | null
  type: string
  entityType: string | null
  entityId: string | null
  via: Via
  at: number
}

export type NewActivity = {
  type: string
  entityType?: string
  entityId?: string
  via: Via
}

export type ListRow = {
  id: string
  name: string
  /** Código corto de la lista para el identificador del item (ADR 0012); `null` hasta que el arranque se lo asigna. */
  code: string | null
  position: string
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  /** Items de la lista sin completar y total (solo los vivos). */
  open: number
  total: number
}

export type ItemRow = {
  id: string
  /** Número dentro de la lista (ADR 0012); `null` solo en una fila que el trigger todavía no numeró. */
  number: number | null
  listId: string
  parentId: string | null
  position: string
  text: string
  doneAt: number | null
  /** Con qué se cerró el item (Markdown); `null` si no se escribió una. */
  resolution: string | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export type SearchHit = {
  id: string
  number: number | null
  listId: string
  listName: string
  listCode: string | null
  text: string
  doneAt: number | null
}

/** Un item mencionado (o que menciona) por otro, con lo mínimo para dibujar un chip. */
export type RefHit = SearchHit

export type AttachmentRow = {
  id: string
  sha256: string
  name: string
  mime: string
  size: number
  createdAt: number
}

/** Hueco de orden entre dos vecinos: las claves de `position` que lo delimitan (`null` = extremo). */
export type Gap = { before: string | null; after: string | null }

/** Todo el acceso a datos de una org pasa por acá, ya con el `org_id` fijado y la puerta verificada. */
export type Scope = {
  org: { id: string; kind: OrgKind; name: string; code: string | null }
  role: Role
  activity: {
    append(entry: NewActivity, now?: number): ActivityEntry
    list(limit: number): ActivityEntry[]
  }
  lists: {
    /** Listas vivas en orden. */
    all(): ListRow[]
    /** `withDeleted` permite alcanzar una lista borrada para restaurarla. */
    get(id: string, withDeleted?: boolean): ListRow | null
    /** `createdAt`, `updatedAt` y `deletedAt` solo los usa el import, que conserva las fechas del archivo. */
    insert(
      row: {
        id: string
        name: string
        /** Si falta o ya está tomado, se asigna uno a partir del nombre. */
        code?: string | null
        position: string
        createdAt?: number
        updatedAt?: number
        deletedAt?: number | null
      },
      now: number,
    ): void
    rename(id: string, name: string, now: number): void
    /** La lista viva con ese código, o `null`. */
    byCode(code: string): ListRow | null
    /** Cambia el código; el servicio ya verificó que está libre. */
    setCode(id: string, code: string, now: number): void
    setPosition(id: string, position: string, now: number): void
    setDeleted(id: string, at: number | null, now: number): void
    /** Hueco justo después de `afterId` (o al principio si es `null`), sin contar a `exclude`. */
    gap(afterId: string | null, exclude?: string): Gap
    count(): number
    /** Todas las listas, borradas incluidas, en orden (export). */
    dump(): ListRow[]
  }
  items: {
    /** Items vivos de una lista, planos y en orden (el cliente arma el árbol con `parentId`). */
    inList(listId: string): ItemRow[]
    get(id: string, withDeleted?: boolean): ItemRow | null
    /** El item vivo con ese número en la lista, o `null`. */
    byNumber(listId: string, number: number): ItemRow | null
    insert(
      row: {
        id: string
        listId: string
        parentId: string | null
        position: string
        text: string
        doneAt?: number | null
        resolution?: string | null
        createdAt?: number
        updatedAt?: number
        deletedAt?: number | null
      },
      now: number,
    ): void
    setText(id: string, text: string, now: number): void
    setDone(id: string, doneAt: number | null, now: number): void
    /** Guarda (o borra con `null`) la resolución sin tocar `doneAt`. */
    setResolution(id: string, resolution: string | null, now: number): void
    /** Cambia de lista, de padre y de posición; los subitems siguen a su padre a la lista nueva. */
    place(
      id: string,
      to: { listId: string; parentId: string | null; position: string },
      now: number,
    ): void
    /** Borra (o restaura) el item y sus subitems vivos en el mismo instante. */
    setDeleted(id: string, at: number | null, now: number): void
    childCount(id: string): number
    gap(
      listId: string,
      parentId: string | null,
      afterId: string | null,
      exclude?: string,
    ): Gap
    countInList(listId: string): number
    /** Todos los items, borrados incluidos, planos y en orden de `position` (export). */
    dump(): ItemRow[]
    search(query: string, limit: number): SearchHit[]
  }
  /** Índice de referencias `[[id]]` entre items de la org (M3). Solo cuenta items vivos en listas vivas. */
  refs: {
    /** Reemplaza todas las referencias que salen de `fromId` por `toIds` (ya verificados por el servicio). */
    replace(fromId: string, toIds: string[]): void
    /** Items que menciona `fromId`. */
    from(fromId: string): RefHit[]
    /** Lo mismo para todos los items vivos de una lista, agrupado por el item que menciona. */
    fromList(listId: string): Map<string, RefHit[]>
    /** Items que mencionan a `toId` (backlinks), los modificados hace menos primero. */
    to(toId: string, limit: number): RefHit[]
  }
  attachments: {
    get(id: string): AttachmentRow | null
    /** El adjunto de esta org con ese contenido, si ya se subió. */
    bySha(sha256: string): AttachmentRow | null
    insert(
      row: {
        id: string
        sha256: string
        name: string
        mime: string
        size: number
        createdAt?: number
      },
      now: number,
    ): void
    /** Todos los adjuntos de la org, del más viejo al más nuevo (export). */
    all(): AttachmentRow[]
    /** Bytes que ocupan los adjuntos de la org (cuota). */
    totalBytes(): number
  }
}

type ActivityRow = {
  id: string
  actor_id: string | null
  type: string
  entity_type: string | null
  entity_id: string | null
  via: Via
  at: number
}

const toEntry = (r: ActivityRow): ActivityEntry => ({
  id: r.id,
  actorId: r.actor_id,
  type: r.type,
  entityType: r.entity_type,
  entityId: r.entity_id,
  via: r.via,
  at: r.at,
})

type ListSqlRow = {
  id: string
  name: string
  code: string | null
  position: string
  created_at: number
  updated_at: number
  deleted_at: number | null
  open: number
  total: number
}

const toList = (r: ListSqlRow): ListRow => ({
  id: r.id,
  name: r.name,
  code: r.code,
  position: r.position,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
  open: r.open,
  total: r.total,
})

type ItemSqlRow = {
  id: string
  number: number | null
  list_id: string
  parent_id: string | null
  position: string
  text: string
  done_at: number | null
  resolution: string | null
  created_at: number
  updated_at: number
  deleted_at: number | null
}

const toItem = (r: ItemSqlRow): ItemRow => ({
  id: r.id,
  number: r.number,
  listId: r.list_id,
  parentId: r.parent_id,
  position: r.position,
  text: r.text,
  doneAt: r.done_at,
  resolution: r.resolution,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
})

const LIST_SELECT = `SELECT l.id, l.name, l.code, l.position, l.created_at, l.updated_at, l.deleted_at,
  (SELECT COUNT(*) FROM items i WHERE i.org_id = l.org_id AND i.list_id = l.id AND i.deleted_at IS NULL AND i.done_at IS NULL) AS open,
  (SELECT COUNT(*) FROM items i WHERE i.org_id = l.org_id AND i.list_id = l.id AND i.deleted_at IS NULL) AS total
  FROM lists l`

const ITEM_COLUMNS =
  'id, number, list_id, parent_id, position, text, done_at, resolution, created_at, updated_at, deleted_at'

type HitSqlRow = {
  id: string
  number: number | null
  list_id: string
  list_name: string
  list_code: string | null
  text: string
  done_at: number | null
}

const toHit = (r: HitSqlRow): RefHit => ({
  id: r.id,
  number: r.number,
  listId: r.list_id,
  listName: r.list_name,
  listCode: r.list_code,
  text: r.text,
  doneAt: r.done_at,
})

type AttachmentSqlRow = {
  id: string
  sha256: string
  name: string
  mime: string
  size: number
  created_at: number
}

const toAttachment = (r: AttachmentSqlRow): AttachmentRow => ({
  id: r.id,
  sha256: r.sha256,
  name: r.name,
  mime: r.mime,
  size: r.size,
  createdAt: r.created_at,
})

const ATTACHMENT_COLUMNS = 'id, sha256, name, mime, size, created_at'

/** `%` y `_` del texto buscado no son comodines. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

/**
 * Abre el scope de una org para un usuario por una puerta. Lanza `FORBIDDEN` si la org no existe, si el usuario no es
 * miembro o si es una org `team` pedida por el listener público (ADR 0001). Todos los casos dan el mismo código: no
 * se revela qué ids existen.
 */
export function openScope(
  db: Database,
  opts: { orgId: string; userId: string; ingress: Ingress },
): Scope {
  const org = db
    .query<
      { id: string; kind: OrgKind; name: string; code: string | null },
      [string]
    >('SELECT id, kind, name, code FROM orgs WHERE id = ?')
    .get(opts.orgId)
  const member = org
    ? db
        .query<{ role: Role }, [string, string]>(
          'SELECT role FROM org_members WHERE org_id = ? AND user_id = ?',
        )
        .get(org.id, opts.userId)
    : null
  if (!org || !member || (org.kind === 'team' && opts.ingress !== 'tailnet'))
    throw new DomainError('FORBIDDEN', 'Sin acceso a esta organización')

  const orgId = org.id
  const userId = opts.userId

  // Las vecinas se buscan con `position >` estricto: dos claves iguales (dos procesos a la vez) no rompen `between`.
  const nextList = (
    afterPosition: string | null,
    exclude: string,
  ): string | null =>
    db
      .query<{ position: string }, [string, string, string]>(
        `SELECT position FROM lists WHERE org_id = ? AND deleted_at IS NULL AND id != ? AND position > ?
         ORDER BY position, id LIMIT 1`,
      )
      .get(orgId, exclude, afterPosition ?? '')?.position ?? null

  const nextItem = (
    listId: string,
    parentId: string | null,
    afterPosition: string | null,
    exclude: string,
  ): string | null =>
    db
      .query<
        { position: string },
        [string, string, string | null, string, string]
      >(
        `SELECT position FROM items WHERE org_id = ? AND list_id = ? AND parent_id IS ? AND deleted_at IS NULL
         AND id != ? AND position > ? ORDER BY position, id LIMIT 1`,
      )
      .get(orgId, listId, parentId, exclude, afterPosition ?? '')?.position ??
    null

  return {
    org,
    role: member.role,
    activity: {
      append(entry, now = Date.now()) {
        const row: ActivityRow = {
          id: ulid(now),
          actor_id: userId,
          type: entry.type,
          entity_type: entry.entityType ?? null,
          entity_id: entry.entityId ?? null,
          via: entry.via,
          at: now,
        }
        db.query(
          'INSERT INTO activity (id, org_id, actor_id, type, entity_type, entity_id, via, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(
          row.id,
          orgId,
          row.actor_id,
          row.type,
          row.entity_type,
          row.entity_id,
          row.via,
          row.at,
        )
        return toEntry(row)
      },
      list(limit) {
        return db
          .query<ActivityRow, [string, number]>(
            'SELECT id, actor_id, type, entity_type, entity_id, via, at FROM activity WHERE org_id = ? ORDER BY id DESC LIMIT ?',
          )
          .all(orgId, limit)
          .map(toEntry)
      },
    },
    lists: {
      all() {
        return db
          .query<ListSqlRow, [string]>(
            `${LIST_SELECT} WHERE l.org_id = ? AND l.deleted_at IS NULL ORDER BY l.position, l.id`,
          )
          .all(orgId)
          .map(toList)
      },
      get(id, withDeleted = false) {
        const row = db
          .query<ListSqlRow, [string, string]>(
            `${LIST_SELECT} WHERE l.org_id = ? AND l.id = ?`,
          )
          .get(orgId, id)
        return row && (withDeleted || row.deleted_at === null)
          ? toList(row)
          : null
      },
      insert(row, now) {
        const taken = new Set(
          db
            .query<{ code: string }, [string]>(
              'SELECT code FROM lists WHERE org_id = ? AND code IS NOT NULL',
            )
            .all(orgId)
            .map((r) => r.code),
        )
        const code =
          row.code && !taken.has(row.code)
            ? row.code
            : codeFromName(row.name, taken)
        db.query(
          'INSERT INTO lists (id, org_id, name, code, position, created_by, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(
          row.id,
          orgId,
          row.name,
          code,
          row.position,
          userId,
          row.createdAt ?? now,
          row.updatedAt ?? now,
          row.deletedAt ?? null,
        )
      },
      rename(id, name, now) {
        db.query(
          'UPDATE lists SET name = ?, updated_at = ? WHERE org_id = ? AND id = ?',
        ).run(name, now, orgId, id)
      },
      byCode(code) {
        const row = db
          .query<ListSqlRow, [string, string]>(
            `${LIST_SELECT} WHERE l.org_id = ? AND l.code = ? AND l.deleted_at IS NULL`,
          )
          .get(orgId, code)
        return row ? toList(row) : null
      },
      setCode(id, code, now) {
        db.query(
          'UPDATE lists SET code = ?, updated_at = ? WHERE org_id = ? AND id = ?',
        ).run(code, now, orgId, id)
      },
      setPosition(id, position, now) {
        db.query(
          'UPDATE lists SET position = ?, updated_at = ? WHERE org_id = ? AND id = ?',
        ).run(position, now, orgId, id)
      },
      setDeleted(id, at, now) {
        db.query(
          'UPDATE lists SET deleted_at = ?, updated_at = ? WHERE org_id = ? AND id = ?',
        ).run(at, now, orgId, id)
      },
      gap(afterId, exclude = '') {
        if (afterId === null)
          return { before: null, after: nextList(null, exclude) }
        const prev = db
          .query<{ position: string }, [string, string]>(
            'SELECT position FROM lists WHERE org_id = ? AND id = ? AND deleted_at IS NULL',
          )
          .get(orgId, afterId)
        if (!prev) throw new DomainError('NOT_FOUND', 'La lista no existe')
        return {
          before: prev.position,
          after: nextList(prev.position, exclude),
        }
      },
      count() {
        return db
          .query<{ n: number }, [string]>(
            'SELECT COUNT(*) AS n FROM lists WHERE org_id = ? AND deleted_at IS NULL',
          )
          .get(orgId)!.n
      },
      dump() {
        return db
          .query<ListSqlRow, [string]>(
            `${LIST_SELECT} WHERE l.org_id = ? ORDER BY l.position, l.id`,
          )
          .all(orgId)
          .map(toList)
      },
    },
    items: {
      inList(listId) {
        return db
          .query<ItemSqlRow, [string, string]>(
            `SELECT ${ITEM_COLUMNS} FROM items WHERE org_id = ? AND list_id = ? AND deleted_at IS NULL
             ORDER BY position, id`,
          )
          .all(orgId, listId)
          .map(toItem)
      },
      get(id, withDeleted = false) {
        const row = db
          .query<ItemSqlRow, [string, string]>(
            `SELECT ${ITEM_COLUMNS} FROM items WHERE org_id = ? AND id = ?`,
          )
          .get(orgId, id)
        return row && (withDeleted || row.deleted_at === null)
          ? toItem(row)
          : null
      },
      byNumber(listId, number) {
        const row = db
          .query<ItemSqlRow, [string, string, number]>(
            `SELECT ${ITEM_COLUMNS} FROM items WHERE org_id = ? AND list_id = ? AND number = ? AND deleted_at IS NULL`,
          )
          .get(orgId, listId, number)
        return row ? toItem(row) : null
      },
      insert(row, now) {
        db.query(
          'INSERT INTO items (id, org_id, list_id, parent_id, position, text, done_at, resolution, created_by, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(
          row.id,
          orgId,
          row.listId,
          row.parentId,
          row.position,
          row.text,
          row.doneAt ?? null,
          row.resolution ?? null,
          userId,
          row.createdAt ?? now,
          row.updatedAt ?? now,
          row.deletedAt ?? null,
        )
      },
      setText(id, text, now) {
        db.query(
          'UPDATE items SET text = ?, updated_at = ? WHERE org_id = ? AND id = ?',
        ).run(text, now, orgId, id)
      },
      setDone(id, doneAt, now) {
        db.query(
          'UPDATE items SET done_at = ?, updated_at = ? WHERE org_id = ? AND id = ?',
        ).run(doneAt, now, orgId, id)
      },
      setResolution(id, resolution, now) {
        db.query(
          'UPDATE items SET resolution = ?, updated_at = ? WHERE org_id = ? AND id = ?',
        ).run(resolution, now, orgId, id)
      },
      place(id, to, now) {
        db.query(
          'UPDATE items SET list_id = ?, parent_id = ?, position = ?, updated_at = ? WHERE org_id = ? AND id = ?',
        ).run(to.listId, to.parentId, to.position, now, orgId, id)
        db.query(
          'UPDATE items SET list_id = ?, updated_at = ? WHERE org_id = ? AND parent_id = ?',
        ).run(to.listId, now, orgId, id)
      },
      setDeleted(id, at, now) {
        if (at !== null) {
          db.query(
            'UPDATE items SET deleted_at = ?, updated_at = ? WHERE org_id = ? AND deleted_at IS NULL AND (id = ? OR parent_id = ?)',
          ).run(at, now, orgId, id, id)
          return
        }
        // Restaurar: el item y los subitems que cayeron con él (mismo instante), no los borrados antes por su cuenta.
        const row = db
          .query<{ deleted_at: number | null }, [string, string]>(
            'SELECT deleted_at FROM items WHERE org_id = ? AND id = ?',
          )
          .get(orgId, id)
        if (row?.deleted_at == null) return
        db.query(
          'UPDATE items SET deleted_at = NULL, updated_at = ? WHERE org_id = ? AND deleted_at = ? AND (id = ? OR parent_id = ?)',
        ).run(now, orgId, row.deleted_at, id, id)
      },
      childCount(id) {
        return db
          .query<{ n: number }, [string, string]>(
            'SELECT COUNT(*) AS n FROM items WHERE org_id = ? AND parent_id = ? AND deleted_at IS NULL',
          )
          .get(orgId, id)!.n
      },
      gap(listId, parentId, afterId, exclude = '') {
        if (afterId === null)
          return {
            before: null,
            after: nextItem(listId, parentId, null, exclude),
          }
        const prev = db
          .query<{ position: string }, [string, string, string, string | null]>(
            'SELECT position FROM items WHERE org_id = ? AND id = ? AND list_id = ? AND parent_id IS ? AND deleted_at IS NULL',
          )
          .get(orgId, afterId, listId, parentId)
        if (!prev)
          throw new DomainError('NOT_FOUND', 'El item de referencia no existe')
        return {
          before: prev.position,
          after: nextItem(listId, parentId, prev.position, exclude),
        }
      },
      countInList(listId) {
        return db
          .query<{ n: number }, [string, string]>(
            'SELECT COUNT(*) AS n FROM items WHERE org_id = ? AND list_id = ? AND deleted_at IS NULL',
          )
          .get(orgId, listId)!.n
      },
      dump() {
        return db
          .query<ItemSqlRow, [string]>(
            `SELECT ${ITEM_COLUMNS} FROM items WHERE org_id = ? ORDER BY position, id`,
          )
          .all(orgId)
          .map(toItem)
      },
      search(query, limit) {
        return db
          .query<HitSqlRow, [string, string, string, number]>(
            `SELECT i.id, i.number, i.list_id, l.name AS list_name, l.code AS list_code, i.text, i.done_at
             FROM items i JOIN lists l ON l.id = i.list_id AND l.org_id = i.org_id
             WHERE i.org_id = ? AND i.deleted_at IS NULL AND l.deleted_at IS NULL
               AND (i.text LIKE ? ESCAPE '\\' OR i.resolution LIKE ? ESCAPE '\\')
             ORDER BY i.updated_at DESC LIMIT ?`,
          )
          .all(orgId, `%${escapeLike(query)}%`, `%${escapeLike(query)}%`, limit)
          .map(toHit)
      },
    },
    refs: {
      replace(fromId, toIds) {
        db.query('DELETE FROM item_refs WHERE org_id = ? AND from_id = ?').run(
          orgId,
          fromId,
        )
        for (const toId of toIds)
          db.query(
            'INSERT OR IGNORE INTO item_refs (org_id, from_id, to_id) VALUES (?, ?, ?)',
          ).run(orgId, fromId, toId)
      },
      from(fromId) {
        return db
          .query<HitSqlRow, [string, string]>(
            `SELECT i.id, i.number, i.list_id, l.name AS list_name, l.code AS list_code, i.text, i.done_at
             FROM item_refs r
             JOIN items i ON i.id = r.to_id AND i.org_id = r.org_id
             JOIN lists l ON l.id = i.list_id AND l.org_id = i.org_id
             WHERE r.org_id = ? AND r.from_id = ? AND i.deleted_at IS NULL AND l.deleted_at IS NULL
             ORDER BY i.id`,
          )
          .all(orgId, fromId)
          .map(toHit)
      },
      fromList(listId) {
        const out = new Map<string, RefHit[]>()
        const rows = db
          .query<HitSqlRow & { from_id: string }, [string, string]>(
            `SELECT r.from_id, t.id, t.number, t.list_id, l.name AS list_name, l.code AS list_code, t.text, t.done_at
             FROM items s
             JOIN item_refs r ON r.from_id = s.id AND r.org_id = s.org_id
             JOIN items t ON t.id = r.to_id AND t.org_id = r.org_id
             JOIN lists l ON l.id = t.list_id AND l.org_id = t.org_id
             WHERE s.org_id = ? AND s.list_id = ? AND s.deleted_at IS NULL AND t.deleted_at IS NULL AND l.deleted_at IS NULL
             ORDER BY r.from_id, t.id`,
          )
          .all(orgId, listId)
        for (const row of rows) {
          const hits = out.get(row.from_id)
          if (hits) hits.push(toHit(row))
          else out.set(row.from_id, [toHit(row)])
        }
        return out
      },
      to(toId, limit) {
        return db
          .query<HitSqlRow, [string, string, number]>(
            `SELECT i.id, i.number, i.list_id, l.name AS list_name, l.code AS list_code, i.text, i.done_at
             FROM item_refs r
             JOIN items i ON i.id = r.from_id AND i.org_id = r.org_id
             JOIN lists l ON l.id = i.list_id AND l.org_id = i.org_id
             WHERE r.org_id = ? AND r.to_id = ? AND i.deleted_at IS NULL AND l.deleted_at IS NULL
             ORDER BY i.updated_at DESC, i.id LIMIT ?`,
          )
          .all(orgId, toId, limit)
          .map(toHit)
      },
    },
    attachments: {
      get(id) {
        const row = db
          .query<AttachmentSqlRow, [string, string]>(
            `SELECT ${ATTACHMENT_COLUMNS} FROM attachments WHERE org_id = ? AND id = ?`,
          )
          .get(orgId, id)
        return row ? toAttachment(row) : null
      },
      bySha(sha256) {
        const row = db
          .query<AttachmentSqlRow, [string, string]>(
            `SELECT ${ATTACHMENT_COLUMNS} FROM attachments WHERE org_id = ? AND sha256 = ?`,
          )
          .get(orgId, sha256)
        return row ? toAttachment(row) : null
      },
      insert(row, now) {
        db.query(
          'INSERT INTO attachments (id, org_id, sha256, name, mime, size, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(
          row.id,
          orgId,
          row.sha256,
          row.name,
          row.mime,
          row.size,
          userId,
          row.createdAt ?? now,
        )
      },
      all() {
        return db
          .query<AttachmentSqlRow, [string]>(
            `SELECT ${ATTACHMENT_COLUMNS} FROM attachments WHERE org_id = ? ORDER BY id`,
          )
          .all(orgId)
          .map(toAttachment)
      },
      totalBytes() {
        return db
          .query<{ n: number }, [string]>(
            'SELECT COALESCE(SUM(size), 0) AS n FROM attachments WHERE org_id = ?',
          )
          .get(orgId)!.n
      },
    },
  }
}

/**
 * Asigna el código a las listas que no lo tienen (las anteriores a la migración 0011, o creadas por el slot viejo
 * durante un cambio de slot). Corre al arrancar, después de migrar; no toca las que ya lo tienen. Devuelve cuántas.
 */
export function backfillListCodes(db: Database): number {
  const rows = db
    .query<{ id: string; org_id: string; name: string }, []>(
      'SELECT id, org_id, name FROM lists WHERE code IS NULL ORDER BY org_id, created_at, id',
    )
    .all()
  const takenByOrg = new Map<string, Set<string>>()
  for (const r of rows) {
    let taken = takenByOrg.get(r.org_id)
    if (!taken) {
      taken = new Set(
        db
          .query<{ code: string }, [string]>(
            'SELECT code FROM lists WHERE org_id = ? AND code IS NOT NULL',
          )
          .all(r.org_id)
          .map((c) => c.code),
      )
      takenByOrg.set(r.org_id, taken)
    }
    const code = codeFromName(r.name, taken)
    taken.add(code)
    db.query('UPDATE lists SET code = ? WHERE org_id = ? AND id = ?').run(
      code,
      r.org_id,
      r.id,
    )
  }
  return rows.length
}
