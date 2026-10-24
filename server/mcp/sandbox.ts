import {
  getQuickJS,
  type QuickJSContext,
  type QuickJSHandle,
} from 'quickjs-emscripten'

/**
 * Code Mode sandbox (ADR 0002). The agent's code runs in QuickJS compiled to wasm: no network, no filesystem, no
 * `Bun`, no `require`. The only way out is `host`, an object of async functions the caller provides; each call
 * goes through the same domain services as GraphQL.
 *
 * M0 spike findings (docs/adr/0002-code-mode.md): QuickJS polls the interrupt handler every N bytecode ops and does
 * not meter big string builtins well (`"x".repeat(1e6)` in a loop ran 12 s past a 2 s deadline). So the production
 * run (M5) executes this module inside a Bun Worker that the host can `terminate()`: that is the hard deadline and
 * it also keeps the server's event loop free while the agent's code runs.
 */

export type Limits = {
  /** Wall-clock deadline for the whole run, including awaited host calls. */
  timeoutMs: number
  memoryBytes: number
  stackBytes: number
  /** Max host calls per run. */
  maxCalls: number
  /** Max characters of the JSON result. */
  maxResultChars: number
  maxConsoleLines: number
}

export const DEFAULT_LIMITS: Limits = {
  timeoutMs: 5_000,
  memoryBytes: 64 * 1024 * 1024,
  stackBytes: 512 * 1024,
  maxCalls: 50,
  maxResultChars: 64 * 1024,
  maxConsoleLines: 200,
}

export type HostFn = (...args: unknown[]) => Promise<unknown>
/** Nested namespaces of host functions: `{ items: { create } }` becomes `host.items.create(...)` in the sandbox. */
export type HostApi = { [name: string]: HostFn | HostApi }

export type RunOptions = {
  /** Nombre del global que lleva la API del host (`host` por defecto; Code Mode usa `checklist`). */
  name?: string
  /** Valores JSON expuestos como globales de solo datos (`search` recibe `spec`). */
  data?: Record<string, unknown>
}

export type RunResult =
  | {
      ok: true
      /** JSON text of what the code returned (`undefined` becomes `null`). */
      result: string
      truncated: boolean
      logs: string[]
      calls: number
      ms: number
    }
  | {
      ok: false
      error: { code: SandboxErrorCode; message: string }
      logs: string[]
      calls: number
      ms: number
    }

export type SandboxErrorCode =
  | 'TIMEOUT'
  | 'TOO_MANY_CALLS'
  | 'CODE_ERROR'
  | 'HOST_ERROR'

class LimitError extends Error {
  code: SandboxErrorCode
  constructor(code: SandboxErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

/** Evalúa texto JSON dentro de la VM sin pasarlo por el parser de JS (un `__proto__` no es sintaxis de objeto). */
function parseJson(vm: QuickJSContext, json: string) {
  return vm.evalCode(`JSON.parse(${JSON.stringify(json)})`)
}

/** JSON text of a handle, or `null` text when the value has none (`undefined`, functions). */
function dumpJson(vm: QuickJSContext, handle: QuickJSHandle): string {
  const stringify = vm.getProp(vm.global, 'JSON')
  try {
    const fn = vm.getProp(stringify, 'stringify')
    try {
      const out = vm.callFunction(fn, stringify, handle)
      if (out.error) {
        const err = vm.dump(out.error)
        out.error.dispose()
        throw new Error(String(err?.message ?? err))
      }
      const type = vm.typeof(out.value)
      const text = type === 'string' ? vm.getString(out.value) : 'null'
      out.value.dispose()
      return text
    } finally {
      fn.dispose()
    }
  } finally {
    stringify.dispose()
  }
}

/**
 * Runs `code` as the body of an async function. The host API is exposed as a global (`host` unless `options.name`
 * says otherwise) next to `console.log` and the JSON globals of `options.data`.
 * The code returns its result with `return`.
 */
export async function runSandboxed(
  code: string,
  host: HostApi,
  limits: Limits = DEFAULT_LIMITS,
  options: RunOptions = {},
): Promise<RunResult> {
  const started = performance.now()
  const QuickJS = await getQuickJS()
  const runtime = QuickJS.newRuntime()
  runtime.setMemoryLimit(limits.memoryBytes)
  runtime.setMaxStackSize(limits.stackBytes)
  const deadline = started + limits.timeoutMs
  runtime.setInterruptHandler(() => performance.now() > deadline)
  const vm = runtime.newContext()

  const logs: string[] = []
  let calls = 0
  let failure: LimitError | undefined
  const pending = new Set<Promise<unknown>>()
  // Every handle the run creates; QuickJS aborts on dispose if any is still alive.
  const owned: { alive: boolean; dispose(): void }[] = []
  let closed = false
  const ms = () => Math.round(performance.now() - started)

  try {
    // console.log -> logs (bounded)
    const consoleObj = vm.newObject()
    const log = vm.newFunction('log', (...args) => {
      if (logs.length < limits.maxConsoleLines) {
        logs.push(
          args
            .map((a) => {
              const v = vm.dump(a)
              return typeof v === 'string' ? v : JSON.stringify(v)
            })
            .join(' '),
        )
      }
    })
    vm.setProp(consoleObj, 'log', log)
    vm.setProp(vm.global, 'console', consoleObj)
    log.dispose()
    consoleObj.dispose()

    const install = (target: QuickJSHandle, api: HostApi) => {
      for (const [name, entry] of Object.entries(api)) {
        if (typeof entry === 'function') {
          const fn = vm.newFunction(name, (...argHandles) => {
            calls += 1
            if (calls > limits.maxCalls) {
              failure ??= new LimitError(
                'TOO_MANY_CALLS',
                `More than ${limits.maxCalls} host calls`,
              )
              throw new Error(failure.message)
            }
            const args = argHandles.map((h) => vm.dump(h))
            const deferred = vm.newPromise()
            owned.push(deferred)
            // Un `Error` de verdad (con `message`), no un texto suelto: es lo que el código del agente espera atrapar.
            const rejectWith = (message: string) => {
              const error = vm.newError(message)
              deferred.reject(error)
              error.dispose()
            }
            const work = entry(...args)
              .then((value) => {
                if (closed) return
                const json = JSON.stringify(value ?? null)
                const handle = parseJson(vm, json)
                if (handle.error) {
                  handle.error.dispose()
                  rejectWith('Host returned a bad value')
                } else {
                  deferred.resolve(handle.value)
                  handle.value.dispose()
                }
              })
              .catch((err: unknown) => {
                if (closed) return
                const message = err instanceof Error ? err.message : String(err)
                rejectWith(message)
              })
              .finally(() => {
                pending.delete(work)
                if (!closed) runtime.executePendingJobs()
              })
            pending.add(work)
            return deferred.handle
          })
          vm.setProp(target, name, fn)
          fn.dispose()
        } else {
          const child = vm.newObject()
          install(child, entry)
          vm.setProp(target, name, child)
          child.dispose()
        }
      }
    }
    const hostObj = vm.newObject()
    install(hostObj, host)
    vm.setProp(vm.global, options.name ?? 'host', hostObj)
    hostObj.dispose()

    for (const [name, value] of Object.entries(options.data ?? {})) {
      const parsed = parseJson(vm, JSON.stringify(value ?? null))
      if (parsed.error) {
        parsed.error.dispose()
        return fail('CODE_ERROR', `No se pudo cargar ${name}`)
      }
      vm.setProp(vm.global, name, parsed.value)
      parsed.value.dispose()
    }

    const wrapped = `(async () => {\n${code}\n})()`
    const evaluated = vm.evalCode(wrapped, 'agent.js')
    if (evaluated.error) {
      const err = vm.dump(evaluated.error)
      evaluated.error.dispose()
      return fail('CODE_ERROR', String(err?.message ?? err))
    }
    const promise = evaluated.value
    owned.push(promise)

    // getPromiseState hands back a live handle once settled, so the polling check must release it.
    const isPending = () => {
      const probe = vm.getPromiseState(promise)
      if (probe.type === 'fulfilled') probe.value.dispose()
      else if (probe.type === 'rejected') probe.error.dispose()
      return probe.type === 'pending'
    }

    // Pump jobs and host calls until the promise settles or the deadline passes.
    while (isPending()) {
      if (failure) break
      if (performance.now() > deadline) {
        failure = new LimitError(
          'TIMEOUT',
          `Run exceeded ${limits.timeoutMs} ms`,
        )
        break
      }
      const jobs = runtime.executePendingJobs()
      if (jobs.error) {
        const err = vm.dump(jobs.error)
        jobs.error.dispose()
        return fail('CODE_ERROR', String(err?.message ?? err))
      }
      if (pending.size > 0) {
        await Promise.race([
          Promise.race(pending),
          new Promise((r) =>
            setTimeout(r, Math.max(1, deadline - performance.now())),
          ),
        ])
      } else if (jobs.value === 0) {
        break
      }
    }

    if (failure) return fail(failure.code, failure.message)

    const state = vm.getPromiseState(promise)
    if (state.type === 'pending') {
      return fail(
        performance.now() > deadline ? 'TIMEOUT' : 'CODE_ERROR',
        performance.now() > deadline
          ? `Run exceeded ${limits.timeoutMs} ms`
          : 'The code never finished',
      )
    }
    if (state.type === 'rejected') {
      const err = vm.dump(state.error)
      state.error.dispose()
      return fail('CODE_ERROR', String(err?.message ?? err))
    }
    const text = dumpJson(vm, state.value)
    state.value.dispose()
    const truncated = text.length > limits.maxResultChars
    return {
      ok: true,
      result: truncated ? text.slice(0, limits.maxResultChars) : text,
      truncated,
      logs,
      calls,
      ms: ms(),
    }
  } finally {
    closed = true
    for (const handle of owned) if (handle.alive) handle.dispose()
    vm.dispose()
    runtime.dispose()
  }

  function fail(code: SandboxErrorCode, message: string): RunResult {
    return { ok: false, error: { code, message }, logs, calls, ms: ms() }
  }
}
