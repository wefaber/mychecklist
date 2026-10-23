import { describe, expect, test } from 'bun:test'
import { between, betweenMany } from './order'

describe('between', () => {
  test('lista vacía: una clave inicial', () => {
    expect(between(null, null)).toBe('V')
  })

  test('siempre queda estrictamente entre los vecinos', () => {
    const cases: [string | null, string | null][] = [
      [null, 'V'],
      ['V', null],
      ['V', 'W'],
      ['V', 'V1'],
      ['Vz', 'W'],
      ['0V', '1'],
      ['z', null],
      ['1', '2'],
    ]
    for (const [a, b] of cases) {
      const k = between(a, b)
      if (a !== null) expect(k > a).toBe(true)
      if (b !== null) expect(k < b).toBe(true)
      expect(k.endsWith('0')).toBe(false)
    }
  })

  test('insertar siempre al principio, al final o en el mismo hueco mantiene el orden', () => {
    const keys = [between(null, null)]
    for (let i = 0; i < 200; i++) keys.unshift(between(null, keys[0]!))
    for (let i = 0; i < 200; i++) keys.push(between(keys.at(-1)!, null))
    expect([...keys].sort()).toEqual(keys)
    expect(new Set(keys).size).toBe(keys.length)

    let lo = 'V'
    const hi = 'W'
    for (let i = 0; i < 300; i++) {
      const k = between(lo, hi)
      expect(k > lo && k < hi).toBe(true)
      lo = k
    }
  })

  test('el largo de las claves crece despacio', () => {
    let lo = 'V'
    for (let i = 0; i < 300; i++) lo = between(lo, 'W')
    expect(lo.length).toBeLessThan(300)
  })

  test('rechaza claves inválidas o desordenadas', () => {
    expect(() => between('b', 'a')).toThrow()
    expect(() => between('a', 'a')).toThrow()
    expect(() => between('a0', null)).toThrow()
    expect(() => between('a-', null)).toThrow()
    expect(() => between('', null)).toThrow()
  })
})

describe('betweenMany', () => {
  test('claves consecutivas y ordenadas dentro del hueco', () => {
    const keys = betweenMany('V', 'W', 25)
    expect(keys).toHaveLength(25)
    expect([...keys].sort()).toEqual(keys)
    expect(keys[0]! > 'V').toBe(true)
    expect(keys.at(-1)! < 'W').toBe(true)
  })
})
