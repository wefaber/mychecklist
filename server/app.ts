import type { Database } from 'bun:sqlite'
import { Elysia } from 'elysia'
import { GraphQLError } from 'graphql'
import { createYoga, maskError, type Plugin } from 'graphql-yoga'
import { authRoutes } from './auth/routes'
import { parseCookies, sessionCookieName } from './auth/cookies'
import type { GithubClient } from './auth/github'
import { loadConfig, type Config } from './config'
import { migrationsApplied } from './db/migrate'
import { findSessionUser } from './db/sessions'
import { DomainError } from './errors'
import type { Ingress } from './ingress'
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

type AppOptions = {
  /** Puerta de este listener (ADR 0001); sin dato cuenta como pública. */
  ingress?: Ingress
  config?: Config
  github?: GithubClient | null
  dev?: boolean
  logging?: boolean
  now?: () => number
}

/** Los fallos esperados del dominio salen con su `extensions.code`; todo lo demás se enmascara. */
function mask(error: unknown, message: string, isDev?: boolean) {
  const inner = error instanceof GraphQLError ? error.originalError : error
  if (inner instanceof DomainError)
    return new GraphQLError(inner.message, {
      extensions: { code: inner.code },
    })
  return maskError(error, message, isDev)
}

/**
 * HTTP shell de un listener. The API is GraphQL; `/health` and `/ready` stay plain HTTP because deploy checks and the
 * process manager must not depend on the API layer. `/graphql` serves GET and POST; `/auth/*` is the login flow.
 * Un proceso levanta una app por puerta (público y tailnet), cada una con su `ingress` fijo.
 */
export function createApp(db: Database, opts: AppOptions = {}) {
  const ingress = opts.ingress ?? 'public'
  const config = opts.config ?? loadConfig()
  const now = opts.now ?? Date.now
  const secure = config.origins[ingress].startsWith('https:')
  const yoga = createYoga<Record<string, never>, Context>({
    schema: buildSchema(),
    context: ({ request }) => {
      const token = parseCookies(request.headers.get('cookie'))[
        sessionCookieName(secure)
      ]
      return {
        db,
        ingress,
        viewer: token ? findSessionUser(db, token, ingress, now()) : null,
        loginAvailable: Boolean(opts.github && config.tokenKey),
      }
    },
    graphqlEndpoint: '/graphql',
    landingPage: false,
    graphiql: opts.dev ?? false,
    maskedErrors: { maskError: mask },
    logging: opts.logging ?? true,
    plugins: [limits],
  })

  return new Elysia()
    .use(authRoutes({ db, ingress, config, github: opts.github ?? null, now }))
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
