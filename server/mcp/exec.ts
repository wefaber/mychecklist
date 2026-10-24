import { DEFAULT_LIMITS, type Limits, type RunResult } from './sandbox'
import type { WorkerInit, WorkerOut } from './worker'

/** Después del deadline de QuickJS, el host espera esto y corta el Worker (ADR 0007). */
export const GRACE_MS = 1_000

export type ExecJob = {
  code: string
  name: string
  ops: string[]
  data?: Record<string, unknown>
  limits?: Limits
}

type Body =
  | { ok: true; value: unknown }
  | { ok: false; code: string; message: string }

/** Responde una operación del sandbox; lanza un `DomainError` (o cualquier `Error` con `code`) si falla. */
export type CallHandler = (op: string, args: unknown[]) => unknown

const WORKER_URL = new URL('./worker.ts', import.meta.url).href

const codeOf = (err: unknown): string =>
  typeof (err as { code?: unknown })?.code === 'string'
    ? (err as { code: string }).code
    : 'INTERNAL'

/**
 * Corre `job.code` en un Worker con QuickJS y atiende sus llamadas al host con `handle`. Termina el Worker al
 * volver y, si no vuelve a tiempo, lo corta: el servidor nunca queda esperando código del agente. Las llamadas se
 * vuelven a contar acá: el límite del sandbox no se confía solo a lo que corre del otro lado.
 */
export function runInWorker(
  job: ExecJob,
  handle: CallHandler,
): Promise<RunResult> {
  const limits = job.limits ?? DEFAULT_LIMITS
  const started = performance.now()
  const ms = () => Math.round(performance.now() - started)
  const allowed = new Set(job.ops)
  let calls = 0

  return new Promise<RunResult>((resolve) => {
    const worker = new Worker(WORKER_URL, { smol: true })
    let settled = false
    const finish = (result: RunResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      worker.terminate()
      resolve(result)
    }
    const fail = (
      code: 'TIMEOUT' | 'CODE_ERROR' | 'TOO_MANY_CALLS',
      message: string,
    ) =>
      finish({ ok: false, error: { code, message }, logs: [], calls, ms: ms() })

    const timer = setTimeout(
      () => fail('TIMEOUT', `Run exceeded ${limits.timeoutMs} ms`),
      limits.timeoutMs + GRACE_MS,
    )

    worker.onerror = (event) => {
      event.preventDefault?.()
      fail('CODE_ERROR', 'El sandbox terminó con un error')
    }
    worker.onmessage = async (event: MessageEvent<WorkerOut>) => {
      const msg = event.data
      if (msg.type === 'done') return finish(msg.result)
      calls += 1
      const reply = (r: Body) => {
        if (!settled) worker.postMessage({ type: 'reply', id: msg.id, ...r })
      }
      if (calls > limits.maxCalls)
        return fail('TOO_MANY_CALLS', `More than ${limits.maxCalls} host calls`)
      if (!allowed.has(msg.op))
        return reply({
          ok: false,
          code: 'FORBIDDEN',
          message: `La operación ${msg.op} no está disponible`,
        })
      try {
        reply({ ok: true, value: await handle(msg.op, msg.args) })
      } catch (err) {
        reply({
          ok: false,
          code: codeOf(err),
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }

    const init: WorkerInit = {
      type: 'init',
      code: job.code,
      name: job.name,
      ops: job.ops,
      data: job.data,
      limits,
    }
    worker.postMessage(init)
  })
}
