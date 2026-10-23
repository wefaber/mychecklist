import { describe, expect, test } from 'bun:test'
import { findViolations, walk } from './check-scoped'

const owned = /\b(items|lists)\b/

describe('check-scoped', () => {
  test('SQL fuera de server/db es la regla 1', () => {
    const v = findViolations(
      [
        {
          path: 'server/services/items.ts',
          source: 'db.query("SELECT * FROM items")',
        },
      ],
      owned,
    )
    expect(v.map((x) => x.rule)).toEqual([1])
  })

  test('tablas con dueño fuera de scoped.ts es la regla 2', () => {
    const v = findViolations(
      [
        {
          path: 'server/db/other.ts',
          source: 'db.query("SELECT * FROM items WHERE org_id = ?")',
        },
      ],
      owned,
    )
    expect(v.map((x) => x.rule)).toEqual([2])
  })

  test('en scoped.ts toda sentencia lleva org_id (regla 3)', () => {
    const v = findViolations(
      [
        {
          path: 'server/db/scoped.ts',
          source:
            'db.query("SELECT * FROM items WHERE id = ?"); db.query("SELECT * FROM items WHERE org_id = ?")',
        },
      ],
      owned,
    )
    expect(v.map((x) => x.rule)).toEqual([3])
  })

  test('el código limpio no tiene violaciones', () => {
    const v = findViolations(
      [
        {
          path: 'server/db/scoped.ts',
          source: 'db.query("SELECT * FROM items WHERE org_id = ?")',
        },
        { path: 'server/app.ts', source: 'const a = "hola"' },
      ],
      owned,
    )
    expect(v).toEqual([])
  })
})

describe('walk', () => {
  test('una carpeta que no existe no rompe el chequeo', () => {
    expect(walk('/no/existe/mychecklist')).toEqual([])
  })
})
