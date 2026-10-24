import { describe, expect, test } from 'bun:test'
import { createLimiter } from './limiter'
import { DEFAULT_LIMITER } from './limiter'
import { DEFAULT_LIMITS } from './sandbox'
import { world } from './testing'

const fast = { ...DEFAULT_LIMITS, timeoutMs: 400 }

async function agent(limits = fast) {
  const w = await world({ limits })
  const { secret } = w.token(w.a.userId, w.orgA)
  const run = (code: string) => w.exec(secret, code)
  return { w, secret, run }
}

describe('sandbox de Code Mode: escape', () => {
  test('no existen red, filesystem, Bun, Node ni el entorno del Worker', async () => {
    const { run } = await agent()
    const names = [
      'fetch',
      'Bun',
      'process',
      'require',
      'module',
      'exports',
      'XMLHttpRequest',
      'WebSocket',
      'setTimeout',
      'setInterval',
      'Worker',
      'self',
      'window',
      'document',
      'postMessage',
      'onmessage',
      'WebAssembly',
      'host',
      'spec',
    ]
    const r = await run(
      `return Object.fromEntries(${JSON.stringify(names)}.map((n) => [n, typeof globalThis[n]]))`,
    )
    expect(r.body.ok).toBe(true)
    for (const name of names) expect(r.body.result[name]).toBe('undefined')
  })

  test('los constructores de Function no llevan a un global más amplio', async () => {
    const { run } = await agent()
    const r = await run(
      `const probes = {
         fn: (function () {}).constructor('return typeof process + typeof Bun + typeof require')(),
         global: globalThis.constructor.constructor('return typeof process')(),
         host: checklist.items.create.constructor('return typeof Bun')(),
         async: Object.getPrototypeOf(async function () {}).constructor('return typeof process')().toString(),
         eval: eval('typeof process + typeof fetch'),
         thisFn: new Function('return typeof this.process')(),
       };
       return probes`,
    )
    expect(r.body.ok).toBe(true)
    expect(r.body.result).toEqual({
      fn: 'undefinedundefinedundefined',
      global: 'undefined',
      host: 'undefined',
      async: expect.any(String),
      eval: 'undefinedundefined',
      thisFn: 'undefined',
    })
    // La función async devuelve una promesa: lo que importa es que nunca resolvió a un global real.
    expect(r.body.result.async).not.toContain('function')
  })

  test('import dinámico de módulos del servidor no resuelve', async () => {
    const { run } = await agent()
    for (const spec of [
      'node:fs',
      'fs',
      'bun',
      'bun:sqlite',
      'file:///etc/passwd',
      'https://example.com/x.js',
    ]) {
      const r = await run(
        `try { const m = await import(${JSON.stringify(spec)}); return 'cargó:' + Object.keys(m).join(',') } catch (e) { return 'bloqueado' }`,
      )
      // O bloquea en el import (resultado) o el motor rechaza la sintaxis (CODE_ERROR): nunca carga un módulo.
      if (r.body.ok) expect(r.body.result).toBe('bloqueado')
      else expect(r.body.error.code).toBe('CODE_ERROR')
    }
  })

  test('el objeto checklist es solo funciones nativas, sin token ni base', async () => {
    const { run, secret } = await agent()
    const r = await run(
      `const seen = [];
       const walk = (o, path) => {
         for (const k of Object.getOwnPropertyNames(o)) {
           const v = o[k];
           if (typeof v === 'function') seen.push([path + k, String(v), Object.getOwnPropertyNames(v).sort().join(',')]);
           else if (v && typeof v === 'object') walk(v, path + k + '.');
           else seen.push([path + k, typeof v]);
         }
       };
       walk(checklist, '');
       return { keys: Object.keys(checklist), seen, globals: Object.getOwnPropertyNames(globalThis) }`,
    )
    expect(r.body.ok).toBe(true)
    expect(r.body.result.keys.sort()).toEqual([
      'activity',
      'items',
      'lists',
      'org',
    ])
    const dump = JSON.stringify(r.body.result)
    expect(dump).not.toContain(secret)
    expect(dump).not.toMatch(/token|secret|sqlite|userId/i)
    for (const [, text] of r.body.result.seen as string[][])
      expect(text).toContain('native code')
  })

  test('cada ejecución arranca de cero: nada se filtra de una a otra', async () => {
    const { run } = await agent()
    const first = await run(
      `Object.prototype.polluted = 'x'; Array.prototype.at = () => 'roto'; globalThis.leak = 42; return 1`,
    )
    expect(first.body.ok).toBe(true)
    const second = await run(
      `return [typeof leak, ({}).polluted ?? null, [1, 2].at(-1)]`,
    )
    expect(second.body.result).toEqual(['undefined', null, 2])
  })

  test('el código del agente no puede pasar un orgId ni salir de la org del token', async () => {
    const { w, run } = await agent()
    const bobList = (
      await w.exec(
        w.token(w.b.userId, w.orgB).secret,
        `return await checklist.lists.create({ name: 'de bob' })`,
      )
    ).body.result as { id: string }
    // `orgId` no es parte de ninguna operación: el esquema lo rechaza.
    const withOrg = await run(
      `return await checklist.lists.list({ orgId: ${JSON.stringify(w.orgB)} })`,
    )
    expect(withOrg.body.ok).toBe(false)
    expect(withOrg.body.error.message).toContain('INVALID_INPUT')
    // Los ids de otra org no existen para este token.
    const peek = await run(
      `const out = {};
       try { await checklist.lists.get({ id: ${JSON.stringify(bobList.id)} }) } catch (e) { out.get = String(e.message) }
       out.items = await checklist.items.get({ id: ${JSON.stringify(bobList.id)} });
       out.lists = (await checklist.lists.list()).map((l) => l.name);
       return out`,
    )
    expect(peek.body.result.get).toContain('NOT_FOUND')
    expect(peek.body.result.items).toBeNull()
    expect(peek.body.result.lists).toEqual([])
  })

  test('un token de lectura no tiene las operaciones de escritura', async () => {
    const w = await world({ limits: fast })
    const { secret } = w.token(w.a.userId, w.orgA, 'read')
    const r = await w.exec(
      secret,
      `return [typeof checklist.items.create, typeof checklist.lists.delete, typeof checklist.lists.list, Object.keys(checklist.items).sort()]`,
    )
    expect(r.body.result).toEqual([
      'undefined',
      'undefined',
      'function',
      ['backlinks', 'get', 'list', 'search'],
    ])
    const write = await w.exec(
      secret,
      `return await checklist.lists.create({ name: 'no' })`,
    )
    expect(write.body.ok).toBe(false)
    expect(write.body.error.code).toBe('CODE_ERROR')
    expect(write.body.error.message).toContain('not a function')
    const listed = await w.exec(secret, `return await checklist.lists.list()`)
    expect(listed.body.result).toEqual([])
  })
})

describe('sandbox de Code Mode: límites', () => {
  test('un bucle infinito se corta por tiempo', async () => {
    const { run } = await agent()
    const r = await run('while (true) {}')
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(false)
    expect(['TIMEOUT', 'CODE_ERROR']).toContain(r.body.error.code)
    expect(r.body.ms).toBeLessThan(2_500)
  })

  test('un builtin que QuickJS no mide se corta con terminate() y el servidor sigue vivo', async () => {
    const { run } = await agent()
    // Spike M0: este bucle corrió 12 s con un deadline de 2 s. El Worker se corta a deadline + gracia.
    let ticks = 0
    const timer = setInterval(() => (ticks += 1), 50)
    const started = performance.now()
    const r = await run(`for (;;) { 'x'.repeat(1e6).split('').length }`)
    clearInterval(timer)
    expect(r.body.ok).toBe(false)
    expect(['TIMEOUT', 'CODE_ERROR']).toContain(r.body.error.code)
    expect(performance.now() - started).toBeLessThan(3_500)
    // El event loop principal no se bloqueó mientras el Worker estaba ocupado.
    expect(ticks).toBeGreaterThan(8)
  })

  test('una explosión de memoria se corta', async () => {
    const { run } = await agent({
      ...fast,
      memoryBytes: 8 * 1024 * 1024,
      timeoutMs: 2_000,
    })
    const r = await run(
      'const a = []; while (true) a.push({ k: a.length, s: "x".repeat(100) })',
    )
    expect(r.body.ok).toBe(false)
  })

  test('más de 50 llamadas al host corta la ejecución', async () => {
    const { run } = await agent({ ...DEFAULT_LIMITS, timeoutMs: 3_000 })
    const r = await run(
      `for (let i = 0; i < 60; i++) await checklist.lists.list(); return 'llegó'`,
    )
    expect(r.body.ok).toBe(false)
    expect(r.body.error.code).toBe('TOO_MANY_CALLS')
    expect(r.body.calls).toBeGreaterThan(50)
  })

  test('el contador de llamadas no se esquiva atrapando la excepción', async () => {
    const { run } = await agent({ ...fast, maxCalls: 3, timeoutMs: 1_000 })
    const r = await run(
      `let n = 0; for (let i = 0; i < 200; i++) { try { await checklist.lists.list(); n++ } catch (e) {} } return n`,
    )
    expect(r.body.ok).toBe(false)
    expect(r.body.error.code).toBe('TOO_MANY_CALLS')
  })

  test('un resultado enorme se trunca y avisa', async () => {
    const { run } = await agent()
    const r = await run(`return 'x'.repeat(200000)`)
    expect(r.body.ok).toBe(true)
    expect(r.body.truncated).toBe(true)
    expect(String(r.body.result)).toHaveLength(64 * 1024)
  })

  test('la consola se acota a 200 líneas', async () => {
    const { run } = await agent()
    const r = await run(
      `for (let i = 0; i < 1000; i++) console.log('línea', i); return 1`,
    )
    expect(r.body.ok).toBe(true)
    expect(r.body.logs).toHaveLength(200)
  })

  test('código demasiado largo, cuerpo enorme o sin código se rechazan', async () => {
    const { w, secret } = await agent()
    const long = await w.post('/codemode/execute', secret, {
      code: `return 1 // ${'x'.repeat(33 * 1024)}`,
    })
    expect(long.status).toBe(400)
    expect(((await long.json()) as any).error.code).toBe('INVALID_INPUT')
    const huge = await w.post('/codemode/execute', secret, {
      code: 'x'.repeat(70 * 1024),
    })
    expect(huge.status).toBe(413)
    const empty = await w.post('/codemode/execute', secret, {})
    expect(empty.status).toBe(400)
    const text = await w.post('/codemode/execute', secret, 'no es json')
    expect(text.status).toBe(400)
  })

  test('una segunda ejecución con el mismo token mientras corre la primera da 429', async () => {
    const { w, secret } = await agent({ ...DEFAULT_LIMITS, timeoutMs: 3_000 })
    const slow = w.exec(
      secret,
      `const t = Date.now(); while (Date.now() - t < 500) {} return 'lenta'`,
    )
    await Bun.sleep(150)
    const second = await w.exec(secret, 'return 1')
    expect(second.status).toBe(429)
    expect(second.body.error.code).toBe('RATE_LIMITED')
    expect((await slow).body.result).toBe('lenta')
    // Liberado el lugar, el mismo token vuelve a poder ejecutar.
    expect((await w.exec(secret, 'return 2')).body.result).toBe(2)
  })

  test('el tope de Workers por proceso rechaza en vez de encolar', async () => {
    const w = await world({
      limits: { ...DEFAULT_LIMITS, timeoutMs: 3_000 },
      limiter: createLimiter({ ...DEFAULT_LIMITER, maxWorkers: 1 }),
    })
    const one = w.token(w.a.userId, w.orgA).secret
    const two = w.token(w.b.userId, w.orgB).secret
    const slow = w.exec(
      one,
      `const t = Date.now(); while (Date.now() - t < 500) {} return 1`,
    )
    await Bun.sleep(150)
    const blocked = await w.exec(two, 'return 2')
    expect(blocked.status).toBe(429)
    expect(blocked.body.error.message).toContain('ocupado')
    await slow
    expect((await w.exec(two, 'return 3')).body.result).toBe(3)
  })

  test('search también pasa por los límites del sandbox', async () => {
    const { w, secret } = await agent()
    const r = await w.exec(secret, 'while (true) {}', 'search')
    expect(r.body.ok).toBe(false)
  })
})

describe('limiter', () => {
  test('60 por minuto por token, con ventana deslizante', () => {
    let now = 1_000_000
    const limiter = createLimiter({ maxWorkers: 100, perMinute: 3 }, () => now)
    const go = (id: string) => {
      const r = limiter.acquire(id)
      if (r.ok) r.slot.release()
      return r.ok
    }
    expect([go('t'), go('t'), go('t'), go('t')]).toEqual([
      true,
      true,
      true,
      false,
    ])
    expect(go('otro')).toBe(true)
    now += 59_000
    expect(go('t')).toBe(false)
    now += 2_000
    expect(go('t')).toBe(true)
  })

  test('un rechazo por ocupado no cuenta para el minuto y soltar libera el lugar', () => {
    const limiter = createLimiter({ maxWorkers: 4, perMinute: 2 }, () => 0)
    const first = limiter.acquire('t')
    expect(first.ok).toBe(true)
    expect(limiter.acquire('t').ok).toBe(false)
    expect(limiter.acquire('t').ok).toBe(false)
    if (first.ok) {
      first.slot.release()
      first.slot.release() // soltar dos veces no libera dos lugares
    }
    expect(limiter.acquire('t').ok).toBe(true)
  })
})
