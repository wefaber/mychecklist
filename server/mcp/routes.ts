import type { Database } from 'bun:sqlite'
import { Elysia } from 'elysia'
import type { Config } from '../config'
import { findApiToken, touchApiToken, type ApiTokenRow } from '../db/tokens'
import { DomainError, type ErrorCode } from '../errors'
import type { Bus } from '../events'
import { readCapped } from '../files'
import type { Ingress } from '../ingress'
import {
  MAX_BODY_BYTES,
  outcomeBody,
  runCode,
  type CodeKind,
  type CodeModeEnv,
} from './codemode'
import { handleRpc, type RpcRequest } from './protocol'

type Options = {
  db: Database
  bus: Bus
  ingress: Ingress
  config: Config
  now: () => number
  limiter: CodeModeEnv['limiter']
  limits?: CodeModeEnv['limits']
}

const STATUS: Partial<Record<ErrorCode, number>> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  INVALID_INPUT: 400,
  LIMIT_REACHED: 413,
  RATE_LIMITED: 429,
}

const error = (code: ErrorCode, message: string, headers?: HeadersInit) =>
  Response.json(
    { ok: false, error: { code, message } },
    { status: STATUS[code] ?? 500, headers },
  )

/**
 * `/codemode/search`, `/codemode/execute` y `/mcp` (ADR 0002 y 0007). Autentican con `Authorization: Bearer mck_...`:
 * el token da el usuario, la org y la puerta, y nunca una cookie. Un `Origin` de navegador que no sea uno de los dos
 * propios no entra; un agente no manda `Origin`.
 */
export function codemodeRoutes(opts: Options) {
  const env: CodeModeEnv = {
    db: opts.db,
    bus: opts.bus,
    limiter: opts.limiter,
    limits: opts.limits,
  }

  const authenticate = (request: Request): ApiTokenRow | Response => {
    const origin = request.headers.get('origin')
    if (
      origin !== null &&
      origin !== opts.config.origins.public &&
      origin !== opts.config.origins.tailnet
    )
      return error('FORBIDDEN', 'Origen no permitido')
    const header = request.headers.get('authorization') ?? ''
    const secret = /^Bearer\s+(\S+)$/i.exec(header)?.[1]
    const token = secret
      ? findApiToken(opts.db, secret, opts.ingress, opts.now())
      : null
    if (!token)
      return error('UNAUTHENTICATED', 'Falta un token válido', {
        'www-authenticate': 'Bearer',
      })
    touchApiToken(opts.db, token, opts.now())
    return token
  }

  const readJson = async (request: Request): Promise<unknown> => {
    const bytes = await readCapped(
      request,
      MAX_BODY_BYTES,
      `El cuerpo admite hasta ${MAX_BODY_BYTES / 1024} KB`,
    )
    try {
      return JSON.parse(new TextDecoder().decode(bytes))
    } catch {
      throw new DomainError('INVALID_INPUT', 'El cuerpo no es JSON')
    }
  }

  const failure = (e: unknown) => {
    if (e instanceof DomainError) return error(e.code, e.message)
    throw e
  }

  const run =
    (kind: CodeKind) =>
    async ({ request }: { request: Request }) => {
      const token = authenticate(request)
      if (token instanceof Response) return token
      try {
        const body = await readJson(request)
        const code = (body as { code?: unknown } | null)?.code
        if (typeof code !== 'string')
          throw new DomainError('INVALID_INPUT', 'Falta `code` (texto)')
        const outcome = await runCode(env, token, kind, code)
        const out = outcomeBody(outcome)
        const status =
          !outcome.ok && outcome.error.code === 'RATE_LIMITED'
            ? 429
            : !outcome.ok && outcome.error.code === 'INVALID_INPUT'
              ? 400
              : 200
        return Response.json(out, { status })
      } catch (e) {
        return failure(e)
      }
    }

  return (
    new Elysia()
      .post('/codemode/search', run('search'), { parse: 'none' })
      .post('/codemode/execute', run('execute'), { parse: 'none' })
      .post(
        '/mcp',
        async ({ request }) => {
          const token = authenticate(request)
          if (token instanceof Response) return token
          let message: unknown
          try {
            message = await readJson(request)
          } catch (e) {
            if (e instanceof DomainError && e.code === 'INVALID_INPUT')
              return Response.json({
                jsonrpc: '2.0',
                id: null,
                error: { code: -32700, message: e.message },
              })
            return failure(e)
          }
          const reply = await handleRpc(
            message as RpcRequest,
            async (kind, code) => {
              const outcome = await runCode(env, token, kind, code)
              return { body: outcomeBody(outcome), isError: !outcome.ok }
            },
          )
          return reply
            ? Response.json(reply)
            : new Response(null, { status: 202 })
        },
        { parse: 'none' },
      )
      // Sin SSE ni sesiones: no hay nada que abrir con GET ni que cerrar con DELETE.
      .get(
        '/mcp',
        () => new Response(null, { status: 405, headers: { allow: 'POST' } }),
      )
      .delete(
        '/mcp',
        () => new Response(null, { status: 405, headers: { allow: 'POST' } }),
      )
  )
}
