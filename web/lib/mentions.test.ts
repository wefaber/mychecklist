import { describe, expect, test } from 'bun:test'
import { hasMarkdown } from './mentions'

describe('hasMarkdown', () => {
  test('texto plano de una línea no pasa por el parser', () => {
    for (const text of [
      'Comprar pan',
      'Llamar al contador antes del viernes',
      'Pedir 3 cosas, y listo.',
      'a - b',
    ])
      expect(hasMarkdown(text)).toBe(false)
  })

  test('cualquier marca o salto de línea sí', () => {
    for (const text of [
      '**fuerte**',
      'con _énfasis_',
      '`código`',
      '[[01JC8Q2V3N4M5P6R7S8T9VWXYZ]]',
      '[link](https://example.com)',
      'ver https://example.com',
      'ver www.example.com',
      'uno\ndos',
      '# título',
      '- viñeta',
      '1. primero',
      '> cita',
      'a | b',
      '<b>html</b>',
      '~~tachado~~',
      'escapado \\*',
    ])
      expect(hasMarkdown(text)).toBe(true)
  })
})
