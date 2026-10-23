-- Infra shared by every milestone. Accounts and org-owned tables arrive with M1 (expand/contract: blue and green
-- share this database during a switch).

-- One row per background job; the worker that holds the lease runs the job (ARCHITECTURE.md › jobs/).
CREATE TABLE leases (
  name       TEXT PRIMARY KEY,
  holder     TEXT NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;
