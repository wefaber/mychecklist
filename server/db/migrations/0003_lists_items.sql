-- M2: listas e items. Aditiva (expand): el slot anterior ignora estas tablas durante un cambio de slot.
-- Ambas tienen dueño (`org_id`): solo las toca server/db/scoped.ts.

-- `position` es una clave de orden fraccional (shared/order.ts): mover un item reescribe solo su fila.
-- Borrar es lógico (`deleted_at`) para poder deshacer; una purga con retención llega más adelante.
CREATE TABLE lists (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  position   TEXT NOT NULL,
  created_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
) STRICT;
CREATE INDEX lists_org ON lists (org_id, position);

-- Un nivel de subitems: `parent_id` apunta a un item de primer nivel de la misma lista (lo valida el servicio).
CREATE TABLE items (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
  list_id    TEXT NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
  parent_id  TEXT REFERENCES items (id) ON DELETE CASCADE,
  position   TEXT NOT NULL,
  text       TEXT NOT NULL,
  done_at    INTEGER,
  created_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
) STRICT;
CREATE INDEX items_list ON items (org_id, list_id, position);
CREATE INDEX items_parent ON items (parent_id);
