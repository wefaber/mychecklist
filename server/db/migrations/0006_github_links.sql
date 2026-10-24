-- M4: caché de links a issues y PRs de GitHub (ADR 0006). Aditiva (expand): el slot anterior ignora estas tablas.
-- Ninguna lleva `org_id`: no son datos de una org sino un caché derivable de GitHub. Solo las toca
-- server/db/github.ts. Invariante: `github_public_links` guarda únicamente lo que GitHub respondió con
-- `isPrivate: false`; lo de un repo privado vive en `github_private_links`, atado a quien lo pidió con su token.

-- Visibilidad conocida de un repo (1 = privado). Decide por cuál tabla se lee y con qué token se consulta.
CREATE TABLE github_repos (
  owner      TEXT NOT NULL,
  repo       TEXT NOT NULL,
  private    INTEGER NOT NULL CHECK (private IN (0, 1)),
  checked_at INTEGER NOT NULL,
  PRIMARY KEY (owner, repo)
) STRICT, WITHOUT ROWID;

-- Claves en minúsculas. `status = 'not_found'` guarda un issue o PR que no existe (o que no se puede ver) sin datos.
CREATE TABLE github_public_links (
  owner      TEXT NOT NULL,
  repo       TEXT NOT NULL,
  number     INTEGER NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('ok', 'not_found')),
  kind       TEXT CHECK (kind IN ('issue', 'pull')),
  title      TEXT,
  state      TEXT CHECK (state IN ('open', 'closed', 'not_planned', 'draft', 'merged')),
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (owner, repo, number)
) STRICT, WITHOUT ROWID;

CREATE TABLE github_private_links (
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  owner      TEXT NOT NULL,
  repo       TEXT NOT NULL,
  number     INTEGER NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('ok', 'not_found')),
  kind       TEXT CHECK (kind IN ('issue', 'pull')),
  title      TEXT,
  state      TEXT CHECK (state IN ('open', 'closed', 'not_planned', 'draft', 'merged')),
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, owner, repo, number)
) STRICT, WITHOUT ROWID;
