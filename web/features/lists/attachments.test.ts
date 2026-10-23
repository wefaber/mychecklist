import { describe, expect, test } from 'bun:test'
import { asBlock, attachmentMarkdown, insertAt } from './attachments'

describe('attachmentMarkdown', () => {
  const base = { id: '01JC8Q2V3N4M5P6R7S8T9VWXYZ', mime: 'x', size: 1 }

  test('imagen con signo de exclamación, archivo sin él', () => {
    expect(attachmentMarkdown({ ...base, name: 'foto.png', image: true })).toBe(
      `![foto.png](attachment:${base.id})`,
    )
    expect(
      attachmentMarkdown({ ...base, name: 'informe.pdf', image: false }),
    ).toBe(`[informe.pdf](attachment:${base.id})`)
  })

  test('escapa los corchetes y el backslash del nombre', () => {
    expect(
      attachmentMarkdown({ ...base, name: 'a[1]\\b.png', image: true }),
    ).toBe(`![a\\[1\\]\\\\b.png](attachment:${base.id})`)
  })
})

describe('insertAt', () => {
  test('inserta en el cursor y deja el cursor después', () => {
    expect(insertAt('hola mundo', 4, 4, '!')).toEqual({
      text: 'hola! mundo',
      caret: 5,
    })
  })

  test('reemplaza la selección', () => {
    expect(insertAt('hola mundo', 5, 10, 'Faku')).toEqual({
      text: 'hola Faku',
      caret: 9,
    })
  })

  test('al principio y al final', () => {
    expect(insertAt('x', 0, 0, 'a')).toEqual({ text: 'ax', caret: 1 })
    expect(insertAt('x', 1, 1, 'a')).toEqual({ text: 'xa', caret: 2 })
  })
})

describe('asBlock', () => {
  test('en medio de una línea queda en su propio renglón', () => {
    expect(asBlock('antes despues', 6, 'X')).toBe('\nX\n')
  })

  test('al principio, al final o entre renglones no agrega saltos de más', () => {
    expect(asBlock('', 0, 'X')).toBe('X')
    expect(asBlock('hola\n', 5, 'X')).toBe('X')
    expect(asBlock('hola', 4, 'X')).toBe('\nX')
    expect(asBlock('a\n\nb', 2, 'X')).toBe('X')
  })
})
