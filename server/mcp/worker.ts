import {
  runSandboxed,
  type HostApi,
  type Limits,
  type RunResult,
} from './sandbox'

/**
 * Entrada del Worker de Code Mode (ADR 0002). Corre QuickJS con el código del agente y no tiene acceso a nada del
 * servidor: la única salida es `postMessage`. Cada operación de `checklist.*` viaja al host como un mensaje `call` y
 * el host (que tiene el scope del token) responde con `reply`. El host puede `terminate()` este Worker cuando quiera:
 * es el tope duro de tiempo que QuickJS no alcanza a garantizar por sí solo.
 */

export type WorkerInit = {
  type: 'init'
  code: string
  /** Nombre del global de la API (`checklist`). */
  name: string
  /** Operaciones que existen en el objeto, p. ej. `items.create`. */
  ops: string[]
  data?: Record<string, unknown>
  limits: Limits
}

export type WorkerReply =
  | { type: 'reply'; id: number; ok: true; value: unknown }
  | { type: 'reply'; id: number; ok: false; code: string; message: string }

export type WorkerOut =
  | { type: 'call'; id: number; op: string; args: unknown[] }
  | { type: 'done'; result: RunResult }

declare const self: {
  onmessage: ((event: MessageEvent) => void) | null
  postMessage(message: WorkerOut): void
}

const waiting = new Map<
  number,
  { resolve(value: unknown): void; reject(error: Error): void }
>()
let nextId = 0

function remote(op: string) {
  return (...args: unknown[]) =>
    new Promise<unknown>((resolve, reject) => {
      const id = nextId++
      waiting.set(id, { resolve, reject })
      self.postMessage({ type: 'call', id, op, args })
    })
}

/** `['items.create']` pasa a `{ items: { create } }`. */
function hostApi(ops: string[]): HostApi {
  const api: HostApi = {}
  for (const op of ops) {
    const [group, name] = op.split('.') as [string, string]
    const bucket = (api[group] ??= {}) as HostApi
    bucket[name] = remote(op)
  }
  return api
}

self.onmessage = (event) => {
  const msg = event.data as WorkerInit | WorkerReply
  if (msg.type === 'reply') {
    const entry = waiting.get(msg.id)
    if (!entry) return
    waiting.delete(msg.id)
    if (msg.ok) entry.resolve(msg.value)
    else entry.reject(new Error(`${msg.code}: ${msg.message}`))
    return
  }
  void runSandboxed(msg.code, hostApi(msg.ops), msg.limits, {
    name: msg.name,
    data: msg.data,
  }).then((result) => self.postMessage({ type: 'done', result }))
}
