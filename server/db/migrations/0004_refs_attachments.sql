-- M3: referencias entre items (`[[id]]`) y adjuntos. Aditiva (expand): el slot anterior ignora estas tablas.
-- Ambas tienen dueño (`org_id`): solo las toca server/db/scoped.ts.

-- Un renglón por par (item que menciona, item mencionado). Se reescribe entero cada vez que cambia el texto del item
-- (el Markdown es la fuente de verdad; esto es solo el índice para los backlinks). Borrar cualquiera de los dos items
-- de verdad limpia el renglón.
CREATE TABLE item_refs (
  org_id  TEXT NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
  from_id TEXT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  to_id   TEXT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  PRIMARY KEY (from_id, to_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX item_refs_to ON item_refs (org_id, to_id);

-- El contenido vive en disco, direccionado por su sha256 (`files/<aa>/<sha256>`); acá solo queda el registro de quién
-- lo subió y con qué nombre. Dentro de una org un mismo contenido se guarda una sola vez.
CREATE TABLE attachments (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
  sha256     TEXT NOT NULL,
  name       TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  created_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (org_id, sha256)
) STRICT;
