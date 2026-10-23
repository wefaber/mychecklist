import { describe, expect, test } from 'bun:test'
import { titleOf } from './title'

const ID = '01JC8Q2V3N4M5P6R7S8T9VWXYZ'

describe('titleOf', () => {
  test('la primera línea con contenido', () => {
    expect(titleOf('Comprar pan\nintegral')).toBe('Comprar pan')
    expect(titleOf('\n\n  Llamar al contador  \nluego')).toBe(
      'Llamar al contador',
    )
  })

  test('saca las marcas del principio de línea', () => {
    expect(titleOf('# Diseñar el Dock\ncon notas')).toBe('Diseñar el Dock')
    expect(titleOf('### Tres')).toBe('Tres')
    expect(titleOf('- [ ] pendiente')).toBe('pendiente')
    expect(titleOf('* [x] hecho')).toBe('hecho')
    expect(titleOf('1. primero')).toBe('primero')
    expect(titleOf('> una cita')).toBe('una cita')
  })

  test('saca énfasis, código, links e imágenes pero deja el texto', () => {
    expect(titleOf('Revisar **con cuidado** lo `viejo`')).toBe(
      'Revisar con cuidado lo viejo',
    )
    expect(titleOf('con _énfasis_ y *otro* y ~~nada~~')).toBe(
      'con énfasis y otro y nada',
    )
    expect(titleOf('ver [la guía](https://example.com/x) hoy')).toBe(
      'ver la guía hoy',
    )
    expect(titleOf('![captura](attachment:' + ID + ') del error')).toBe(
      'captura del error',
    )
  })

  test('no toca guiones bajos ni asteriscos que no son énfasis', () => {
    expect(titleOf('usar snake_case_nombre en todo')).toBe(
      'usar snake_case_nombre en todo',
    )
    expect(titleOf('2 * 3 * 4')).toBe('2 * 3 * 4')
  })

  test('las referencias no aportan al título', () => {
    expect(titleOf(`Revisar [[${ID}]] hoy`)).toBe('Revisar hoy')
    expect(titleOf(`[[${ID}]]`)).toBe('')
    // Si la primera línea es solo una referencia, el título es la siguiente.
    expect(titleOf(`[[${ID}]]\nlo que sigue`)).toBe('lo que sigue')
  })

  test('acota el largo con una elipsis', () => {
    const t = titleOf('a'.repeat(300))
    expect(t).toHaveLength(120)
    expect(t.endsWith('…')).toBe(true)
  })

  test('texto vacío', () => {
    expect(titleOf('')).toBe('')
    expect(titleOf('   \n  ')).toBe('')
  })
})
