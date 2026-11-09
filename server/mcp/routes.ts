import type { Database } from 'bun:sqlite'
import { createQuickJsSandbox } from '@wefaber/codemode-sandbox-quickjs'
import {
  createWcmHandler,
  verifyIdentity,
  type Principal,
} from '@wefaber/codemode-mcp'
import type { Limits } from '@wefaber/codemode'
import { Elysia } from 'elysia'
import type { Config } from '../config'
import {
  findApiToken,
  findApiTokenByHash,
  touchApiToken,
  type TokenMode,
} from '../db/tokens'
import { insertCodemodeRun } from '../db/runs'
import type { Bus } from '../events'
import type { Ingress } from '../ingress'
import { registry, scopesFor, type OpContext } from '../services/registry'
import type { Limiter } from '@wefaber/codemode-mcp'

type Options = {
  db: Database
  bus: Bus
  ingress: Ingress
  config: Config
  now: () => number
  limiter: Limiter
  /** Solo los tests bajan los límites. */
  limits?: Partial<Limits>
}

const INSTRUCTIONS =
  'MyChecklist por Code Mode: dos herramientas. `search` corre JavaScript sobre `spec` (la API descripta como datos) ' +
  'y devuelve solo lo que el código retorna: usala para encontrar operaciones. `execute` corre JavaScript con ' +
  '`codemode.checklist.<grupo>.<operación>(entrada)` (async, p. ej. `await codemode.checklist.items.create({ listId, text })`); ' +
  'encadená todas las llamadas necesarias en una sola ejecución y devolvé con `return` solo lo que haga falta. Sin red ni ' +
  'archivos; hasta 50 llamadas y 5 segundos por ejecución.'

/**
 * Los scopes que vale una llamada del gateway: lo que el gateway le dio al token (que puede cubrir otros productos)
 * recortado por el modo del token de MyChecklist. El gateway nunca amplía lo que el token ya podía acá.
 */
export function gatewayScopes(mode: TokenMode, granted: string[]): string[] {
  const read =
    granted.includes('checklist:read') || granted.includes('checklist:write')
  const write = mode === 'write' && granted.includes('checklist:write')
  return write ? scopesFor('write') : read ? scopesFor('read') : []
}

const refused = (status: number, code: string, message: string) =>
  Response.json({ ok: false, error: { code, message } }, { status })

/**
 * `/codemode/search`, `/codemode/execute` y `/mcp` (ADR 0002, 0007 y 0010): el transporte, el sandbox y el límite
 * vienen de `@wefaber/codemode*`; acá solo se resuelve quién llama. Autentican con `Authorization: Bearer mck_...`: el
 * token da el usuario, la org y la puerta, y nunca una cookie. Un `Origin` de navegador que no sea uno de los dos
 * propios no entra; un agente no manda `Origin`.
 */
export function codemodeRoutes(opts: Options) {
  const handler = createWcmHandler<OpContext>({
    registry,
    sandbox: createQuickJsSandbox(),
    limiter: opts.limiter,
    limits: opts.limits,
    // `checklist.*` sigue funcionando una minor más: los agentes ya escritos usan el nombre corto (ADR 0010).
    aliases: { checklist: 'codemode.checklist' },
    instructions: INSTRUCTIONS,
    now: opts.now,
    audit: (row) => insertCodemodeRun(opts.db, row),
    onError: (err, where) => console.error(`codemode ${where}:`, err),
    auth: async (request): Promise<Principal<OpContext> | Response | null> => {
      const origin = request.headers.get('origin')
      if (
        origin !== null &&
        origin !== opts.config.origins.public &&
        origin !== opts.config.origins.tailnet
      )
        return Response.json(
          {
            ok: false,
            error: { code: 'FORBIDDEN', message: 'Origen no permitido' },
          },
          { status: 403 },
        )
      // Detrás del gateway (ADR 0013): identidad firmada con la clave compartida; el token del agente nunca llega.
      if (request.headers.get('x-wcm-via') === 'gateway') {
        if (!opts.config.gatewaySecret) return null
        const id = await verifyIdentity(
          opts.config.gatewaySecret,
          request.headers,
        )
        if (!id) return null
        const token = findApiTokenByHash(
          opts.db,
          id.tokenHash,
          opts.ingress,
          opts.now(),
        )
        if (!token) return null
        const scopes = gatewayScopes(token.mode, id.scopes)
        if (scopes.length === 0)
          return refused(
            403,
            'FORBIDDEN',
            'El token no tiene acceso a checklist',
          )
        touchApiToken(opts.db, token, opts.now())
        return {
          tokenId: token.id,
          scopes,
          label: id.label ?? token.name,
          ctx: {
            deps: { db: opts.db, bus: opts.bus },
            caller: {
              userId: token.userId,
              ingress: token.ingress,
              via: 'mcp' as const,
            },
            orgId: token.orgId,
          },
        }
      }
      const header = request.headers.get('authorization') ?? ''
      const secret = /^Bearer\s+(\S+)$/i.exec(header)?.[1]
      const token = secret
        ? findApiToken(opts.db, secret, opts.ingress, opts.now())
        : null
      if (!token) return null
      touchApiToken(opts.db, token, opts.now())
      return {
        tokenId: token.id,
        scopes: scopesFor(token.mode),
        label: token.name,
        ctx: {
          deps: { db: opts.db, bus: opts.bus },
          caller: {
            userId: token.userId,
            ingress: token.ingress,
            via: 'mcp' as const,
          },
          orgId: token.orgId,
        },
      }
    },
  })

  const run = ({ request }: { request: Request }) => handler(request)
  return new Elysia()
    .post('/codemode/search', run, { parse: 'none' })
    .post('/codemode/execute', run, { parse: 'none' })
    .all('/mcp', run, { parse: 'none' })
}
