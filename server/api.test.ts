import { describe, expect, test } from 'bun:test'
import { createApp } from './app'
import { openDb } from './db/connection'
import { migrate } from './db/migrate'

function setup(opts: { migrated?: boolean } = {}) {
  const db = openDb(':memory:')
  if (opts.migrated !== false) migrate(db)
  const app = createApp(db, { logging: false })
  const gql = async (query: string) => {
    const res = await app.handle(
      new Request('http://localhost/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query }),
      }),
    )
    return {
      status: res.status,
      body: (await res.json()) as {
        data?: Record<string, unknown>
        errors?: { message: string; extensions?: { code?: string } }[]
      },
    }
  }
  return { db, app, gql }
}

describe('http shell', () => {
  test('/health siempre responde ok', async () => {
    const { app } = setup()
    const res = await app.handle(new Request('http://localhost/health'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  test('/ready da 503 hasta aplicar las migraciones y después 200', async () => {
    const pending = setup({ migrated: false })
    const before = await pending.app.handle(
      new Request('http://localhost/ready'),
    )
    expect(before.status).toBe(503)
    migrate(pending.db)
    const after = await pending.app.handle(
      new Request('http://localhost/ready'),
    )
    expect(after.status).toBe(200)
    expect(await after.json()).toEqual({ status: 'ready' })
  })

  test('no hay endpoints REST de datos', async () => {
    const { app } = setup()
    for (const path of ['/api/lists', '/lists', '/items']) {
      const res = await app.handle(new Request(`http://localhost${path}`))
      expect(res.status).toBe(404)
    }
  })
})

describe('/graphql', () => {
  test('responde la versión', async () => {
    const { gql } = setup()
    const { status, body } = await gql('{ version }')
    expect(status).toBe(200)
    expect(body.data).toEqual({ version: 'dev' })
  })

  test('rechaza consultas de más de 4000 caracteres', async () => {
    const { gql } = setup()
    const { body } = await gql(`{ version ${' '.repeat(4000)} }`)
    expect(body.errors?.[0]?.extensions?.code).toBe('QUERY_TOO_LONG')
  })

  test('rechaza consultas más profundas que 8 niveles', async () => {
    const { gql } = setup()
    const deep = '{ a '.repeat(9) + '}'.repeat(9)
    const { body } = await gql(deep)
    expect(body.errors?.length).toBeGreaterThan(0)
  })

  test('no deja mutar por GET', async () => {
    const { app } = setup()
    const res = await app.handle(
      new Request(
        `http://localhost/graphql?query=${encodeURIComponent('mutation { x }')}`,
      ),
    )
    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})
