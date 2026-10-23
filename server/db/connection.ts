import { Database } from 'bun:sqlite'

/** Opens the database with the house pragmas (WAL, foreign keys, busy timeout; one writer process). */
export function openDb(path: string): Database {
  const db = new Database(path, { create: true, strict: true })
  db.run('PRAGMA journal_mode = WAL')
  db.run('PRAGMA foreign_keys = ON')
  db.run('PRAGMA busy_timeout = 5000')
  db.run('PRAGMA synchronous = NORMAL')
  return db
}
