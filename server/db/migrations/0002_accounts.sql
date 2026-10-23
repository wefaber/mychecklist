-- M1: identidad, sesiones y el primer dato con dueño (activity). Aditiva: el slot anterior sigue corriendo sobre
-- esta base durante un cambio de slot.

CREATE TABLE users (
  id         TEXT PRIMARY KEY,
  github_id  INTEGER NOT NULL UNIQUE,
  login      TEXT NOT NULL,
  name       TEXT,
  avatar_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

-- `personal` = espacio propio (una por usuario, `personal_for`); `team` solo se accede por la tailnet (ADR 0001).
CREATE TABLE orgs (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('personal', 'team')),
  name         TEXT NOT NULL,
  personal_for TEXT UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  CHECK ((kind = 'personal') = (personal_for IS NOT NULL))
) STRICT;

CREATE TABLE org_members (
  org_id     TEXT NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, user_id)
) STRICT;
CREATE INDEX org_members_user ON org_members (user_id);

-- `id` es el sha256 del token de la cookie; el token en claro nunca se guarda. La sesión recuerda por qué puerta se
-- emitió y solo vale en esa (ADR 0001). Sin IP, user agent ni historial de logins.
CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  ingress    TEXT NOT NULL CHECK (ingress IN ('public', 'tailnet')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX sessions_expires ON sessions (expires_at);

-- Tokens de usuario de la GitHub App (ADR 0003), cifrados con AES-256-GCM (formato en server/auth/crypto.ts).
CREATE TABLE github_tokens (
  user_id            TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  access_enc         TEXT NOT NULL,
  refresh_enc        TEXT,
  access_expires_at  INTEGER,
  refresh_expires_at INTEGER,
  updated_at         INTEGER NOT NULL
) STRICT;

-- Primera tabla con dueño (`org_id`): solo la toca server/db/scoped.ts.
CREATE TABLE activity (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
  actor_id    TEXT REFERENCES users (id) ON DELETE SET NULL,
  type        TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  via         TEXT NOT NULL CHECK (via IN ('web', 'mcp', 'import', 'job')),
  at          INTEGER NOT NULL
) STRICT;
CREATE INDEX activity_org ON activity (org_id, id);
