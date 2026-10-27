import { describe, expect, test } from 'bun:test'
import { DEFAULT_LIMITS } from '@wefaber/codemode'
import { createLimiter, DEFAULT_LIMITER } from '@wefaber/codemode-mcp'
import { world } from './testing'

/**
 * Lo genérico del sandbox (escape, límites, limiter, auditoría) lo prueba la suite de `@wefaber/codemode`. Acá queda
 * lo que es de este producto: la tenencia, los modos del token y que el cableado de la app respeta los límites.
 */

const fast = { ...DEFAULT_LIMITS, timeoutMs: 400 }

async function agent(limits = fast) {
  const w = await world({ limits })
  const { secret } = w.token(w.a.userId, w.orgA)
  const run = (code: string) => w.exec(secret, code)
  return { w, secret, run }
}

describe('Code Mode de mychecklist: tenencia y modos', () => {
  test('el objeto codemode.checklist trae solo las operaciones del registry, sin token ni base', async () => {
    const { run, secret } = await agent()
    const r = await run(
      `const seen = [];
       const walk = (o, path) => {
         for (const k of Object.getOwnPropertyNames(o)) {
           const v = o[k];
           if (typeof v === 'function') seen.push([path + k, String(v)]);
           else if (v && typeof v === 'object') walk(v, path + k + '.');
           else seen.push([path + k, typeof v]);
         }
       };
       walk(codemode.checklist, '');
       return { keys: Object.keys(codemode.checklist), alias: checklist === codemode.checklist, seen }`,
    )
    expect(r.body.ok).toBe(true)
    expect(r.body.result.keys.sort()).toEqual([
      'activity',
      'items',
      'lists',
      'org',
    ])
    // El nombre corto sigue siendo el mismo objeto (alias de compatibilidad, ADR 0010).
    expect(r.body.result.alias).toBe(true)
    const dump = JSON.stringify(r.body.result)
    expect(dump).not.toContain(secret)
    expect(dump).not.toMatch(/token|secret|sqlite|userId/i)
    for (const [, text] of r.body.result.seen as string[][])
      expect(text).toContain('native code')
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
    expect(withOrg.body.error.message).toContain('VALIDATION')
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

describe('Code Mode de mychecklist: cableado de los límites', () => {
  test('un bucle infinito se corta por tiempo', async () => {
    const { run } = await agent()
    const r = await run('while (true) {}')
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(false)
    expect(['TIMEOUT', 'CODE_ERROR']).toContain(r.body.error.code)
    expect(r.body.ms).toBeLessThan(2_500)
  })

  test('código demasiado largo, cuerpo enorme o sin código se rechazan', async () => {
    const { w, secret } = await agent()
    const long = await w.post('/codemode/execute', secret, {
      code: `return 1 // ${'x'.repeat(33 * 1024)}`,
    })
    expect(long.status).toBe(400)
    expect(((await long.json()) as any).error.code).toBe('VALIDATION')
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
    expect(blocked.body.error.message).toContain('busy')
    await slow
    expect((await w.exec(two, 'return 3')).body.result).toBe(3)
  })
})

describe('Code Mode de mychecklist: auditoría', () => {
  test('cada corrida deja una fila en codemode_runs, también la rechazada', async () => {
    const { w, secret } = await agent()
    await w.exec(
      secret,
      `const l = await checklist.lists.create({ name: 'A' }); return (await checklist.lists.list()).length`,
    )
    await w.exec(secret, '')
    const rows = w.db
      .query(
        'SELECT kind, ops, calls, error_code, spec_version, via FROM codemode_runs ORDER BY created_at, run_id',
      )
      .all() as {
      kind: string
      ops: string
      calls: number
      error_code: string | null
      spec_version: string
      via: string
    }[]
    expect(rows).toHaveLength(2)
    const byErr = (e: string | null) => rows.find((r) => r.error_code === e)!
    expect(JSON.parse(byErr(null).ops)).toEqual([
      'checklist.lists.create',
      'checklist.lists.list',
    ])
    expect(byErr(null)).toMatchObject({
      kind: 'execute',
      calls: 2,
      spec_version: '1.0.0',
      via: 'direct',
    })
    expect(byErr('VALIDATION').calls).toBe(0)
  })
})
