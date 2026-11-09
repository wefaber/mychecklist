import { describe, expect, test } from 'bun:test'
import { closeBlocker, countBoxes } from './checkboxes'

describe('countBoxes', () => {
  test('un texto sin casillas no tiene ninguna', () => {
    expect(countBoxes('Definir la lista corta')).toEqual({ total: 0, open: 0 })
    expect(countBoxes('')).toEqual({ total: 0, open: 0 })
    expect(countBoxes('ver [[doc]] o [link](https://x.y)')).toEqual({
      total: 0,
      open: 0,
    })
  })

  test('cuenta marcadas y sin marcar, también anidadas', () => {
    const text = '- [x] uno\n- [ ] dos\n  - [ ] dos a\n  - [X] dos b\n- viñeta'
    expect(countBoxes(text)).toEqual({ total: 4, open: 2 })
  })

  test('la lista numerada y el asterisco también son casillas', () => {
    expect(countBoxes('1. [ ] a\n2. [x] b\n\n* [ ] c')).toEqual({
      total: 3,
      open: 2,
    })
  })

  test('una casilla dentro de código no cuenta', () => {
    expect(countBoxes('```\n- [ ] no\n```\n\n`- [ ] tampoco`')).toEqual({
      total: 0,
      open: 0,
    })
    expect(countBoxes('    - [ ] sangría de código')).toEqual({
      total: 0,
      open: 0,
    })
  })

  test('corchetes sueltos no son casillas', () => {
    expect(countBoxes('[ ] sin viñeta')).toEqual({ total: 0, open: 0 })
    expect(countBoxes('- [] vacía\n- [ x] rara')).toEqual({ total: 0, open: 0 })
  })
})

describe('closeBlocker', () => {
  test('null si no hay casillas o están todas marcadas', () => {
    expect(closeBlocker('a')).toBeNull()
    expect(closeBlocker('- [x] a\n- [X] b')).toBeNull()
  })

  test('dice cuántas faltan, en singular y plural', () => {
    expect(closeBlocker('- [x] a\n- [ ] b')).toBe(
      'Falta 1 casilla por marcar para completar el item',
    )
    expect(closeBlocker('- [ ] a\n- [ ] b\n- [x] c')).toBe(
      'Faltan 2 casillas por marcar para completar el item',
    )
  })
})
