import type { Database } from 'bun:sqlite'
import type { ApiTokenRow } from '../db/tokens'
import type { Bus } from '../events'
import { callOp, opsFor } from '../services/registry'
import { runInWorker } from './exec'
import type { Limiter } from './limiter'
import type { Limits, RunResult } from './sandbox'
import { buildSpec } from './spec'

/** Código del agente: hasta 32 KB (ADR 0007). */
export const MAX_CODE_CHARS = 32 * 1024
/** Cuerpo de la request: hasta 64 KB. */
export const MAX_BODY_BYTES = 64 * 1024

export type CodeKind = 'search' | 'execute'

export type CodeModeEnv = {
  db: Database
  bus: Bus
  limiter: Limiter
  /** Solo los tests bajan los límites. */
  limits?: Limits
}

type Rejected = {
  ok: false
  error: { code: 'RATE_LIMITED' | 'INVALID_INPUT'; message: string }
  logs: string[]
  calls: number
  ms: number
}

export type CodeOutcome = RunResult | Rejected

const rejected = (
  code: Rejected['error']['code'],
  message: string,
): Rejected => ({
  ok: false,
  error: { code, message },
  logs: [],
  calls: 0,
  ms: 0,
})

/**
 * `search` corre el código sobre `spec` (la API como datos, sin acceso a nada); `execute` lo corre con `checklist.*`
 * atado al usuario, la org y la puerta del token (ADR 0007). En los dos el código vive en un Worker con QuickJS.
 */
export async function runCode(
  env: CodeModeEnv,
  token: ApiTokenRow,
  kind: CodeKind,
  code: string,
): Promise<CodeOutcome> {
  if (code.length === 0)
    return rejected('INVALID_INPUT', 'Falta el código a ejecutar')
  if (code.length > MAX_CODE_CHARS)
    return rejected(
      'INVALID_INPUT',
      `El código admite hasta ${MAX_CODE_CHARS / 1024} KB`,
    )
  const acquired = env.limiter.acquire(token.id)
  if (!acquired.ok) return rejected('RATE_LIMITED', acquired.message)
  try {
    if (kind === 'search')
      return await runInWorker(
        {
          code,
          name: 'host',
          ops: [],
          data: { spec: buildSpec(token.mode) },
          limits: env.limits,
        },
        () => {
          throw new Error('search no tiene operaciones')
        },
      )
    const ctx = {
      deps: { db: env.db, bus: env.bus },
      caller: {
        userId: token.userId,
        ingress: token.ingress,
        via: 'mcp' as const,
      },
      orgId: token.orgId,
    }
    return await runInWorker(
      {
        code,
        name: 'checklist',
        ops: opsFor(token.mode).map((op) => op.name),
        limits: env.limits,
      },
      (op, args) => callOp(token.mode, ctx, op, args[0]),
    )
  } finally {
    acquired.slot.release()
  }
}

/** Cuerpo de respuesta de `/codemode/*` y texto de `tools/call`: lo mismo para los dos transportes. */
export function outcomeBody(outcome: CodeOutcome) {
  if (!outcome.ok)
    return {
      ok: false as const,
      error: outcome.error,
      logs: outcome.logs,
      calls: outcome.calls,
      ms: outcome.ms,
    }
  let result: unknown = outcome.result
  // Un resultado truncado ya no es JSON válido: se entrega como texto.
  if (!outcome.truncated) {
    try {
      result = JSON.parse(outcome.result)
    } catch {
      result = outcome.result
    }
  }
  return {
    ok: true as const,
    result,
    truncated: outcome.truncated,
    logs: outcome.logs,
    calls: outcome.calls,
    ms: outcome.ms,
  }
}
