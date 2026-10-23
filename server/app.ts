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
import { createBus, type Bus } from './events'
import type { Ingress } from './ingress'
import { maxDepth } from './graphql/limits'
import { buildSchema, type Context } from './graphql/schema'
import { getOrg } from './services/orgs'

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
  /** Bus de cambios compartido por los dos listeners del proceso (SSE). */
  bus?: Bus
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
  const bus = opts.bus ?? createBus()
  const secure = config.origins[ingress].startsWith('https:')
  const viewerOf = (request: Request) => {
    const token = parseCookies(request.headers.get('cookie'))[
      sessionCookieName(secure)
    ]
    return token ? findSessionUser(db, token, ingress, now()) : null
  }
  /** Una request con `Origin` de otro sitio no entra: las mutaciones usan la cookie de sesión. Sin `Origin` (curl, servidor) pasa. */
  const originOk = (request: Request) => {
    const origin = request.headers.get('origin')
    return (
      origin === null ||
      origin === config.origins.public ||
      origin === config.origins.tailnet
    )
  }
  const yoga = createYoga<Record<string, never>, Context>({
    schema: buildSchema(),
    context: ({ request }) => ({
      db,
      bus,
      ingress,
      viewer: viewerOf(request),
      loginAvailable: Boolean(opts.github && config.tokenKey),
    }),
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
    .get('/events', ({ request, query }) => {
      const viewer = viewerOf(request)
      if (!viewer) return eventsError('UNAUTHENTICATED', 401)
      const orgId = query.org
      try {
        if (!orgId) throw new DomainError('FORBIDDEN', 'Falta la organización')
        getOrg(db, { userId: viewer.id, ingress }, orgId)
      } catch {
        return eventsError('FORBIDDEN', 403)
      }
      return eventStream(bus, orgId, request.signal)
    })
    .all(
      '/graphql',
      ({ request }) =>
        originOk(request)
          ? yoga.fetch(request)
          : Response.json(
              {
                errors: [
                  {
                    message: 'Origen no permitido',
                    extensions: { code: 'FORBIDDEN' },
                  },
                ],
              },
              { status: 403 },
            ),
      { parse: 'none' },
    )
}

const eventsError = (code: string, status: number) =>
  Response.json({ error: { code } }, { status })

const HEARTBEAT_MS = 25_000

/**
 * Server-Sent Events de una org: un `change` por cada cambio (sin datos del contenido, el cliente vuelve a pedir por
 * GraphQL) y un comentario cada 25 s para que Nginx y los proxies no corten la conexión. `EventSource` reconecta solo.
 */
function eventStream(bus: Bus, orgId: string, signal: AbortSignal): Response {
  const encoder = new TextEncoder()
  let cleanup = () => {}
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          cleanup()
        }
      }
      const unsubscribe = bus.subscribe(orgId, (e) =>
        send(
          `event: change\ndata: ${JSON.stringify({ scope: e.scope, listId: e.listId ?? null })}\n\n`,
        ),
      )
      const timer = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS)
      cleanup = () => {
        clearInterval(timer)
        unsubscribe()
        signal.removeEventListener('abort', cleanup)
      }
      signal.addEventListener('abort', cleanup)
      send('retry: 3000\n\n: ok\n\n')
    },
    cancel() {
      cleanup()
    },
  })
  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      // Nginx no debe acumular la respuesta.
      'x-accel-buffering': 'no',
    },
  })
}
