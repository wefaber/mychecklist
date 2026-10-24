import type { Database } from 'bun:sqlite'
import { Elysia } from 'elysia'
import { GraphQLError } from 'graphql'
import { createYoga, maskError, type Plugin } from 'graphql-yoga'
import { authRoutes } from './auth/routes'
import { parseCookies, sessionCookieName } from './auth/cookies'
import type { GithubClient } from './auth/github'
import { loadConfig, type Config } from './config'
import { createGithubApi } from './github/api'
import { migrationsApplied } from './db/migrate'
import { findSessionUser } from './db/sessions'
import { DomainError, type ErrorCode } from './errors'
import { fileStore, readCapped, type FileStore } from './files'
import { createBus, type Bus } from './events'
import type { Ingress } from './ingress'
import { maxDepth } from './graphql/limits'
import { codemodeRoutes } from './mcp/routes'
import { createLimiter, type Limiter } from './mcp/limiter'
import type { Limits } from './mcp/sandbox'
import { buildSchema, type Context } from './graphql/schema'
import {
  GENERIC_MIME,
  MAX_ATTACHMENT_BYTES,
  openAttachment,
  uploadAttachment,
} from './services/attachments'
import { createGithubLinks, type GithubLinks } from './services/github'
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
  /** Almacén de adjuntos; por defecto `config.filesDir`. */
  files?: FileStore
  /** Resolutor de links a GitHub compartido por los dos listeners (guarda los límites de la API en memoria). */
  githubLinks?: GithubLinks
  /** Tope de ejecuciones de Code Mode; los dos listeners comparten el del proceso (ADR 0007). */
  limiter?: Limiter
  /** Solo los tests bajan los límites del sandbox. */
  codemodeLimits?: Limits
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
  const files = opts.files ?? fileStore(config.filesDir)
  const githubLinks =
    opts.githubLinks ??
    createGithubLinks({
      db,
      api: createGithubApi(config.githubApp),
      login: opts.github ?? null,
      tokenKey: config.tokenKey,
      now,
    })
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
      githubLinks,
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
    .use(
      codemodeRoutes({
        db,
        bus,
        ingress,
        config,
        now,
        limiter: opts.limiter ?? createLimiter(undefined, now),
        limits: opts.codemodeLimits,
      }),
    )
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
    .post(
      '/files/:org',
      async ({ request, params }) => {
        if (!originOk(request))
          return fileError('FORBIDDEN', 'Origen no permitido')
        const viewer = viewerOf(request)
        if (!viewer)
          return fileError('UNAUTHENTICATED', 'Hay que iniciar sesión')
        try {
          const bytes = await readCapped(request, MAX_ATTACHMENT_BYTES)
          const name = decodeName(request.headers.get('x-file-name'))
          const attachment = await uploadAttachment(
            { db, files },
            { userId: viewer.id, ingress, via: 'web' },
            { orgId: params.org, name, bytes },
            now(),
          )
          return Response.json({ attachment }, { status: 201 })
        } catch (error) {
          return fileFailure(error)
        }
      },
      { parse: 'none' },
    )
    .get('/files/:org/:id', ({ request, params }) => {
      const viewer = viewerOf(request)
      if (!viewer) return fileError('UNAUTHENTICATED', 'Hay que iniciar sesión')
      try {
        const { attachment, sha256, path } = openAttachment(
          { db, files },
          { userId: viewer.id, ingress },
          params.org,
          params.id,
        )
        // El contenido no cambia nunca para un id: el ETag es su hash.
        const etag = `"${sha256}"`
        const headers: Record<string, string> = {
          etag,
          'cache-control': 'private, max-age=31536000, immutable',
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; sandbox",
        }
        if (request.headers.get('if-none-match') === etag)
          return new Response(null, { status: 304, headers })
        return new Response(Bun.file(path), {
          headers: {
            ...headers,
            // Solo las imágenes reconocidas por su contenido se ven en línea; lo demás se descarga.
            'content-type': attachment.image ? attachment.mime : GENERIC_MIME,
            'content-disposition': `${attachment.image ? 'inline' : 'attachment'}; ${dispositionName(attachment.name)}`,
          },
        })
      } catch (error) {
        return fileFailure(error)
      }
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

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  AUTH_NOT_CONFIGURED: 503,
  INVALID_INPUT: 400,
  LIMIT_REACHED: 413,
  RATE_LIMITED: 429,
}

const fileError = (code: ErrorCode, message: string) =>
  Response.json({ error: { code, message } }, { status: STATUS[code] })

/** Los fallos del dominio salen con su código y estado; cualquier otra cosa es un error del servidor. */
function fileFailure(error: unknown): Response {
  if (error instanceof DomainError) return fileError(error.code, error.message)
  throw error
}

/** El nombre llega codificado en `X-File-Name` (los headers no admiten cualquier carácter). */
function decodeName(raw: string | null): string {
  try {
    return raw ? decodeURIComponent(raw) : ''
  } catch {
    return ''
  }
}

/** `filename*` (RFC 5987) lleva el nombre real; `filename` es una versión ASCII para clientes viejos. */
function dispositionName(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, '_')
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `filename="${ascii}"; filename*=UTF-8''${encoded}`
}

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
