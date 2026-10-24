-- M7: invitaciones a orgs de equipo (ADR 0009). Aditiva (expand): el slot anterior ignora la tabla.
-- Lleva `org_id` pero no es una tabla "con dueño" de scoped.ts, igual que `api_tokens`: la persona invitada todavía
-- no es miembro, así que se la busca por `login` sin un scope. Solo la toca server/db/members.ts y cada servicio abre
-- `openScope` antes de operar sobre la org.
-- `login` va en minúsculas. Al aceptar, rechazar o revocar la fila se borra: el historial queda en `activity`.
CREATE TABLE org_invitations (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
  login      TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  invited_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  UNIQUE (org_id, login)
) STRICT;
CREATE INDEX org_invitations_login ON org_invitations (login);
