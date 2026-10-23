import { afterEach, describe, expect, test } from 'bun:test'

// The module reads `window`, which Bun does not define; each test sets the shape it needs.
const g = globalThis as unknown as { window?: Record<string, unknown> }
afterEach(() => {
  delete g.window
})

async function load() {
  return await import(`./server.ts?${Math.random()}`)
}

describe('apiUrl', () => {
  test('en la web usa el mismo origen', async () => {
    g.window = {}
    const { apiUrl } = await load()
    expect(apiUrl('/graphql')).toBe('/graphql')
  })

  test('en el desktop usa el servidor por defecto', async () => {
    g.window = { __TAURI_INTERNALS__: {} }
    const { apiUrl, DEFAULT_SERVER } = await load()
    expect(apiUrl('/graphql')).toBe(`${DEFAULT_SERVER}/graphql`)
  })
})
