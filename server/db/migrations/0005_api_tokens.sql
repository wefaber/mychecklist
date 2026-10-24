-- M5: tokens de API de Code Mode (ADR 0007). Aditiva (expand): el slot anterior ignora la tabla.
-- No es una tabla "con dueño" de scoped.ts: el token se busca por su hash antes de que exista un scope, igual que
-- `sessions`. Lo que el token puede hacer pasa siempre por `openScope`, que verifica membresía y puerta.
-- `token_sha256` es el sha256 del token en claro; el token se muestra una sola vez y nunca se guarda.
CREATE TABLE api_tokens (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  org_id       TEXT NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
  ingress      TEXT NOT NULL CHECK (ingress IN ('public', 'tailnet')),
  mode         TEXT NOT NULL CHECK (mode IN ('read', 'write')),
  name         TEXT NOT NULL,
  token_sha256 TEXT NOT NULL UNIQUE,
  hint         TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  expires_at   INTEGER,
  revoked_at   INTEGER
) STRICT;
CREATE INDEX api_tokens_user_org ON api_tokens (user_id, org_id);
