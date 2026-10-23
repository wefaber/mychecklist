import type { Database } from 'bun:sqlite'
import { Elysia } from 'elysia'
import { GraphQLError } from 'graphql'
import { createYoga, type Plugin } from 'graphql-yoga'
import { migrationsApplied } from './db/migrate'
import { maxDepth } from './graphql/limits'
import { buildSchema, type Context } from './graphql/schema'

const MAX_DEPTH = 8
const MAX_QUERY_CHARS = 4000

const limits: Plugin = {
  onValidate({ addValidationRule }) {
    addValidationRule(maxDepth(MAX_DEPTH))
  },
  onParams({ params, setResult }) {
    if ((params.query?.length ?? 0) > MAX_QUERY_CHARS) {
      setResult({
        errors: [
          new GraphQLError(`Query longer than ${MAX_QUERY_CHARS} characters`, {
            extensions: { code: 'QUERY_TOO_LONG' },
          }),
        ],
      })
    }
  },
}

/**
 * HTTP shell. The API is GraphQL; `/health` and `/ready` stay plain HTTP because deploy checks and the process
 * manager must not depend on the API layer. `/graphql` serves GET and POST.
 */
export function createApp(
  db: Database,
  opts: { dev?: boolean; logging?: boolean } = {},
) {
  const yoga = createYoga<Record<string, never>, Context>({
    schema: buildSchema(),
    context: () => ({}),
    graphqlEndpoint: '/graphql',
    landingPage: false,
    graphiql: opts.dev ?? false,
    maskedErrors: true,
    logging: opts.logging ?? true,
    plugins: [limits],
  })

  return new Elysia()
    .get('/health', () => ({ status: 'ok' }))
    .get('/ready', ({ set }) => {
      let ready = false
      try {
        db.query('SELECT 1').get()
        ready = migrationsApplied(db)
      } catch {
        ready = false
      }
      if (!ready) set.status = 503
      return { status: ready ? 'ready' : 'not-ready' }
    })
    .all('/graphql', ({ request }) => yoga.fetch(request), { parse: 'none' })
}
