import { describe, expect, test } from 'bun:test'
import { resolveShortRefs } from './refs'
import {
  checkCode,
  codeFromName,
  formatShortId,
  parseShortId,
} from './short-id'

describe('parseShortId / formatShortId', () => {
  test('lista y número, con o sin org', () => {
    expect(parseShortId('AA-12')).toEqual({ org: null, list: 'AA', number: 12 })
    expect(parseShortId('WF-AA-12')).toEqual({
      org: 'WF',
      list: 'AA',
      number: 12,
    })
  })

  test('no distingue mayúsculas ni espacios en los bordes', () => {
    expect(parseShortId(' wf-eco3-7 ')).toEqual({
      org: 'WF',
      list: 'ECO3',
      number: 7,
    })
  })

  test('lo que no tiene la forma no es un identificador', () => {
    for (const bad of [
      '',
      'AA',
      'AA-',
      'AA-0',
      'AA-012',
      'A-12',
      '1A-12',
      'AA-BB-CC-1',
      'AA-1x',
      '01JC8Q2V3N4M5P6R7S8T9VWXYZ',
    ])
      expect(parseShortId(bad)).toBeNull()
  })

  test('format es el inverso de parse', () => {
    expect(formatShortId(null, 'AA', 12)).toBe('AA-12')
    expect(formatShortId('WF', 'AA', 12)).toBe('WF-AA-12')
    expect(parseShortId(formatShortId('WF', 'AA', 12))).toEqual({
      org: 'WF',
      list: 'AA',
      number: 12,
    })
  })
})

describe('codeFromName', () => {
  test('iniciales con varias palabras, comienzo con una', () => {
    expect(codeFromName('Ad Astra')).toBe('AA')
    expect(codeFromName('Economía')).toBe('ECO')
    expect(codeFromName('Diseño y operación')).toBe('DYO')
    expect(codeFromName('WeFaber')).toBe('WF')
  })

  test('nunca devuelve algo inválido', () => {
    for (const name of ['', '   ', '7', '123 456', '🚀', 'a', 'Ñandú'])
      expect(checkCode(codeFromName(name))).toBeNull()
  })

  test('si está tomado agrega un número', () => {
    expect(codeFromName('Ad Astra', new Set(['AA']))).toBe('AA2')
    expect(codeFromName('Ad Astra', new Set(['AA', 'AA2']))).toBe('AA3')
  })
})

describe('resolveShortRefs', () => {
  const ULID = '01JC8Q2V3N4M5P6R7S8T9VWXYZ'
  const known = (s: string) => (s.toUpperCase() === 'AA-12' ? ULID : null)

  test('cambia [[AA-12]] por el ULID', () => {
    expect(resolveShortRefs('ver [[AA-12]] y [[aa-12]]', known)).toBe(
      `ver [[${ULID}]] y [[${ULID}]]`,
    )
  })

  test('lo que no resuelve queda como estaba', () => {
    expect(resolveShortRefs('ver [[AA-99]]', known)).toBe('ver [[AA-99]]')
  })

  test('no toca código, links ni texto sin corchetes dobles', () => {
    const text =
      'a `[[AA-12]]`\n\n```\n[[AA-12]]\n```\n[x [[AA-12]]](https://e.com)\nAA-12 y [AA-12]'
    expect(resolveShortRefs(text, known)).toBe(text)
  })

  test('el resto del texto no cambia ni un byte', () => {
    const text = '# Título\n\n- [[AA-12]]   \n- **fuerte** [[AA-12]]\n'
    expect(resolveShortRefs(text, known)).toBe(text.replaceAll('AA-12', ULID))
  })
})
