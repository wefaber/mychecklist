-- Auditoría de Code Mode (SPEC de WCM R10 y §9): una fila por corrida de `search` o `execute`, también las rechazadas.
-- Aditiva (expand): el slot anterior ignora la tabla. No lleva `org_id` ni es una tabla "con dueño" de scoped.ts: se
-- consulta por token y la escribe solo server/db/runs.ts. `token_id` no es una FK a propósito: la fila sobrevive al
-- token. `ops` es un arreglo JSON con los ids de las operaciones que llamó el código, en orden.
CREATE TABLE codemode_runs (
  run_id       TEXT PRIMARY KEY,
  token_id     TEXT NOT NULL,
  agent_label  TEXT,
  kind         TEXT NOT NULL CHECK (kind IN ('search', 'execute')),
  ops          TEXT NOT NULL,
  calls        INTEGER NOT NULL,
  ms           INTEGER NOT NULL,
  result_bytes INTEGER NOT NULL,
  truncated    INTEGER NOT NULL CHECK (truncated IN (0, 1)),
  error_code   TEXT,
  spec_version TEXT NOT NULL,
  via          TEXT NOT NULL,
  created_at   INTEGER NOT NULL
) STRICT;
CREATE INDEX codemode_runs_token ON codemode_runs (token_id, created_at);
