import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from './connection'
import { ulid } from './ids'
import { loadMigrations, migrate, migrationsApplied } from './migrate'

describe('migraciones', () => {
  test('se aplican una vez y quedan registradas', () => {
    const db = openDb(':memory:')
    const first = migrate(db)
    expect(first.length).toBe(loadMigrations().length)
    expect(migrate(db)).toEqual([])
    expect(migrationsApplied(db)).toBe(true)
  })

  test('una migración ya aplicada que cambió es un error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig-'))
    writeFileSync(join(dir, '0001_a.sql'), 'CREATE TABLE a (x INTEGER);')
    const db = openDb(':memory:')
    migrate(db, dir)
    writeFileSync(join(dir, '0001_a.sql'), 'CREATE TABLE a (y INTEGER);')
    expect(() => migrate(db, dir)).toThrow(/changed after it was applied/)
  })

  test('los números van sin saltos', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig-'))
    writeFileSync(join(dir, '0002_b.sql'), 'SELECT 1;')
    expect(() => loadMigrations(dir)).toThrow(/without gaps/)
  })

  test('la conexión activa las claves foráneas', () => {
    const db = openDb(':memory:')
    expect(db.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
  })
})

describe('ulid', () => {
  test('26 caracteres y ordenados en el tiempo', () => {
    const a = ulid(1_000)
    const b = ulid(2_000)
    expect(a).toHaveLength(26)
    expect(a < b).toBe(true)
  })

  test('en el mismo milisegundo sigue creciendo', () => {
    const a = ulid(5_000)
    const b = ulid(5_000)
    expect(a < b).toBe(true)
  })
})
