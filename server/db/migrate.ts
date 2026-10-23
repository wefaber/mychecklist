import type { Database } from 'bun:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DEFAULT_DIR = join(import.meta.dir, 'migrations')
const FILE = /^(\d{4})_[a-z0-9_]+\.sql$/

type Migration = { id: number; name: string; sql: string; checksum: string }

function checksum(sql: string): string {
  return new Bun.CryptoHasher('sha256').update(sql).digest('hex')
}

export function loadMigrations(dir: string = DEFAULT_DIR): Migration[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  const migrations = files.map((name) => {
    const match = FILE.exec(name)
    if (!match)
      throw new Error(
        `Bad migration file name: ${name} (expected NNNN_snake_case.sql)`,
      )
    const sql = readFileSync(join(dir, name), 'utf8')
    return { id: Number(match[1]), name, sql, checksum: checksum(sql) }
  })
  migrations.forEach((m, i) => {
    if (m.id !== i + 1)
      throw new Error(
        `Migrations must be numbered 0001.. without gaps; got ${m.name} at position ${i + 1}`,
      )
  })
  return migrations
}

function ensureTable(db: Database) {
  db.run(`CREATE TABLE IF NOT EXISTS migrations (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    checksum   TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  ) STRICT`)
}

/**
 * Applies pending migrations in order, each inside its own transaction, and returns the names it applied.
 * An already applied migration whose file changed is an error: fix forward with a new migration (expand/contract,
 * blue and green share the database).
 */
export function migrate(db: Database, dir: string = DEFAULT_DIR): string[] {
  ensureTable(db)
  const applied = new Map(
    db
      .query<{ id: number; checksum: string }, []>(
        'SELECT id, checksum FROM migrations',
      )
      .all()
      .map((r) => [r.id, r.checksum]),
  )
  const done: string[] = []
  for (const m of loadMigrations(dir)) {
    const known = applied.get(m.id)
    if (known !== undefined) {
      if (known !== m.checksum)
        throw new Error(`Migration ${m.name} changed after it was applied`)
      continue
    }
    db.transaction(() => {
      db.run(m.sql)
      db.query(
        'INSERT INTO migrations (id, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
      ).run(m.id, m.name, m.checksum, Date.now())
    })()
    done.push(m.name)
  }
  return done
}

/** For `GET /ready`: true when every migration on disk is recorded. */
export function migrationsApplied(
  db: Database,
  dir: string = DEFAULT_DIR,
): boolean {
  ensureTable(db)
  const count = db
    .query<{ n: number }, []>('SELECT count(*) AS n FROM migrations')
    .get()!.n
  return count === loadMigrations(dir).length
}
