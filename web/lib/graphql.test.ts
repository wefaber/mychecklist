import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { gql, GraphQLRequestError } from './graphql'

// `apiUrl` lee `window`, que Bun no define (ver server.test.ts).
const g = globalThis as unknown as { window?: Record<string, unknown> }
const realFetch = globalThis.fetch
beforeEach(() => {
  g.window = {}
})
afterEach(() => {
  delete g.window
  globalThis.fetch = realFetch
})

function respond(body: unknown) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body))) as unknown as typeof fetch
}

describe('gql', () => {
  test('devuelve data', async () => {
    respond({ data: { version: 'dev' } })
    expect(await gql<{ version: string }>('{ version }')).toEqual({
      version: 'dev',
    })
  })

  test('lanza con el code del primer error', async () => {
    respond({ errors: [{ message: 'no', extensions: { code: 'FORBIDDEN' } }] })
    const error: unknown = await gql('{ org(id: "x") { id } }').catch((e) => e)
    expect(error).toBeInstanceOf(GraphQLRequestError)
    expect((error as GraphQLRequestError).code).toBe('FORBIDDEN')
  })

  test('manda la cookie de sesión', async () => {
    let credentials: RequestCredentials | undefined
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      credentials = init?.credentials
      return new Response(JSON.stringify({ data: {} }))
    }) as unknown as typeof fetch
    await gql('{ version }')
    expect(credentials).toBe('include')
  })
})
