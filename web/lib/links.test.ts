import { describe, expect, test } from 'bun:test'

// `links.ts` lee `window` y `serverUrl()`: se simula el navegador antes de importarlo.
const g = globalThis as unknown as { window: unknown }
g.window = { location: { origin: 'https://checklist.test' } }
const { itemIdFromLink, itemLink } = await import('./links')

const ID = '01JC8Q2V3N4M5P6R7S8T9VWXYZ'

describe('links a items', () => {
  test('itemLink arma la ruta que abre el detalle', () => {
    expect(itemLink('LST', ID)).toBe(`https://checklist.test/l/LST?item=${ID}`)
  })

  test('un link propio se reconoce y devuelve el id', () => {
    expect(itemIdFromLink(`https://checklist.test/l/LST?item=${ID}`)).toBe(ID)
    expect(itemIdFromLink(`  https://checklist.test/l/LST/?item=${ID} `)).toBe(
      ID,
    )
  })

  test('lo que no es un link propio a un item no se toca', () => {
    for (const text of [
      '',
      'hola',
      `https://otro.test/l/LST?item=${ID}`,
      'https://checklist.test/l/LST',
      'https://checklist.test/l/LST?item=AA-12',
      `https://checklist.test/ajustes/tokens?item=${ID}`,
      `ver https://checklist.test/l/LST?item=${ID}`,
    ])
      expect(itemIdFromLink(text)).toBeNull()
  })
})
