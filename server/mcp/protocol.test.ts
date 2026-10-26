import { describe, expect, test } from 'bun:test'
import { Value } from '@sinclair/typebox/value'
import { registry } from '../services/registry'
import { world } from './testing'

const rpc = (id: number, method: string, params?: object) => ({
  jsonrpc: '2.0',
  id,
  method,
  params,
})

describe('/mcp (Streamable HTTP sin estado)', () => {
  test('initialize, tools/list y tools/call', async () => {
    const w = await world()
    const { secret } = w.token(w.a.userId, w.orgA)
    const init = (await (
      await w.post(
        '/mcp',
        secret,
        rpc(1, 'initialize', { protocolVersion: '2025-03-26' }),
      )
    ).json()) as any
    expect(init.result.protocolVersion).toBe('2025-03-26')
    expect(init.result.capabilities).toEqual({ tools: {} })
    expect(init.result.instructions).toContain('search')
    const old = (await (
      await w.post(
        '/mcp',
        secret,
        rpc(2, 'initialize', { protocolVersion: '1999-01-01' }),
      )
    ).json()) as any
    expect(old.result.protocolVersion).toBe('2025-06-18')

    const list = (await (
      await w.post('/mcp', secret, rpc(3, 'tools/list'))
    ).json()) as any
    expect(list.result.tools.map((t: any) => t.name)).toEqual([
      'search',
      'execute',
    ])
    expect(list.result.tools[1].inputSchema.required).toEqual(['code'])

    const call = (await (
      await w.post(
        '/mcp',
        secret,
        rpc(4, 'tools/call', {
          name: 'execute',
          arguments: {
            code: `const l = await checklist.lists.create({ name: 'Por MCP' }); return l.name`,
          },
        }),
      )
    ).json()) as any
    expect(call.result.isError).toBe(false)
    expect(JSON.parse(call.result.content[0].text)).toMatchObject({
      ok: true,
      result: 'Por MCP',
      calls: 1,
    })

    const found = (await (
      await w.post(
        '/mcp',
        secret,
        rpc(5, 'tools/call', {
          name: 'search',
          arguments: {
            code: `return spec.ops.filter((o) => o.id === 'checklist.lists.create').length`,
          },
        }),
      )
    ).json()) as any
    expect(JSON.parse(found.result.content[0].text).result).toBe(1)
  })

  test('un fallo del código vuelve como isError, no como error de protocolo', async () => {
    const w = await world()
    const { secret } = w.token(w.a.userId, w.orgA)
    const res = (await (
      await w.post(
        '/mcp',
        secret,
        rpc(1, 'tools/call', {
          name: 'execute',
          arguments: { code: 'throw new Error("boom")' },
        }),
      )
    ).json()) as any
    expect(res.error).toBeUndefined()
    expect(res.result.isError).toBe(true)
    expect(JSON.parse(res.result.content[0].text).error.message).toContain(
      'boom',
    )
  })

  test('notificaciones 202, GET y DELETE 405, métodos y herramientas desconocidos, JSON roto', async () => {
    const w = await world()
    const { secret } = w.token(w.a.userId, w.orgA)
    const note = await w.post('/mcp', secret, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    })
    expect(note.status).toBe(202)
    for (const method of ['GET', 'DELETE']) {
      const res = await w.apps.public.handle(
        new Request('https://checklist.test/mcp', {
          method,
          headers: { authorization: `Bearer ${secret}` },
        }),
      )
      expect(res.status).toBe(405)
    }
    const json = async (body: unknown) =>
      (await (await w.post('/mcp', secret, body)).json()) as any
    expect((await json(rpc(1, 'resources/list'))).error.code).toBe(-32601)
    expect(
      (await json(rpc(2, 'tools/call', { name: 'rm', arguments: {} }))).error
        .code,
    ).toBe(-32602)
    expect(
      (await json(rpc(3, 'tools/call', { name: 'execute', arguments: {} })))
        .error.code,
    ).toBe(-32602)
    expect((await json('{no es json')).error.code).toBe(-32700)
    expect((await json([rpc(1, 'ping')])).error.code).toBe(-32600)
    expect(await json(rpc(9, 'ping'))).toEqual({
      jsonrpc: '2.0',
      id: 9,
      result: {},
    })
  })

  test('sin token da 401', async () => {
    const w = await world()
    expect((await w.post('/mcp', null, rpc(1, 'ping'))).status).toBe(401)
  })
})

describe('registry: operaciones', () => {
  test('una entrada inválida da VALIDATION con la operación', async () => {
    const w = await world()
    const { secret } = w.token(w.a.userId, w.orgA)
    const r = await w.exec(
      secret,
      `const out = [];
       for (const input of [{ listId: 'x' }, { listId: 'x', text: 5 }, { listId: 'x', text: 'a', extra: 1 }, null]) {
         try { await checklist.items.create(input) } catch (e) { out.push(e.message) }
       }
       return out`,
    )
    expect(r.body.result).toHaveLength(4)
    for (const m of r.body.result as string[])
      expect(m).toMatch(/^VALIDATION: checklist\.items\.create/)
  })

  test('las reglas del dominio valen igual: límites, subitems, borrado lógico', async () => {
    const w = await world()
    const { secret } = w.token(w.a.userId, w.orgA)
    const r = await w.exec(
      secret,
      `const l = await checklist.lists.create({ name: 'L' });
       const p = await checklist.items.create({ listId: l.id, text: 'padre' });
       const c = await checklist.items.create({ listId: l.id, text: 'hijo', parentId: p.id });
       const out = {};
       try { await checklist.items.create({ listId: l.id, text: 'nieto', parentId: c.id }) } catch (e) { out.nieto = e.message }
       try { await checklist.items.create({ listId: l.id, text: 'x'.repeat(4001) }) } catch (e) { out.largo = e.message }
       await checklist.items.delete({ id: p.id });
       out.tras = (await checklist.items.list({ listId: l.id })).length;
       await checklist.items.restore({ id: p.id });
       out.vuelta = (await checklist.items.list({ listId: l.id })).map((i) => i.text);
       return out`,
    )
    expect(r.body.result.nieto).toMatch(/^INVALID_INPUT/)
    expect(r.body.result.largo).toMatch(/^VALIDATION/)
    expect(r.body.result.tras).toBe(0)
    expect(r.body.result.vuelta).toEqual(['padre', 'hijo'])
  })

  test('items.list pagina de a 500 como máximo', async () => {
    const w = await world()
    const { secret } = w.token(w.a.userId, w.orgA)
    const r = await w.exec(
      secret,
      `const l = await checklist.lists.create({ name: 'L' });
       for (let i = 0; i < 6; i++) await checklist.items.create({ listId: l.id, text: 'i' + i });
       const page = await checklist.items.list({ listId: l.id, limit: 4 });
       const rest = await checklist.items.list({ listId: l.id, limit: 4, offset: 4 });
       let tooMany = null;
       try { await checklist.items.list({ listId: l.id, limit: 501 }) } catch (e) { tooMany = e.message }
       return [page.map((i) => i.text), rest.map((i) => i.text), tooMany]`,
    )
    expect(r.body.result[0]).toEqual(['i0', 'i1', 'i2', 'i3'])
    expect(r.body.result[1]).toEqual(['i4', 'i5'])
    expect(r.body.result[2]).toMatch(/^VALIDATION/)
  })

  test('toda operación del registry se ejercita y su salida cumple su esquema', async () => {
    const w = await world()
    const ctx = {
      deps: { db: w.db, bus: w.bus },
      caller: {
        userId: w.a.userId,
        ingress: 'public' as const,
        via: 'mcp' as const,
      },
      orgId: w.orgA,
    }
    const used = new Set<string>()
    const call = async (name: string, input: object = {}) => {
      const id = `checklist.${name}`
      const op = registry.get(id)!
      const out = await registry.call(['checklist:write'], ctx, id, input)
      used.add(id)
      expect(Value.Check(op.output, out)).toBe(true)
      return out as any
    }
    await call('org.get')
    const l1 = await call('lists.create', { name: 'Uno' })
    const l2 = await call('lists.create', { name: 'Dos', afterId: null })
    await call('lists.get', { id: l1.id })
    await call('lists.rename', { id: l1.id, name: 'Uno bis' })
    await call('lists.move', { id: l2.id })
    const a = await call('items.create', { listId: l1.id, text: 'a' })
    const b = await call('items.create', {
      listId: l1.id,
      text: `ver [[${a.id}]]`,
    })
    await call('items.get', { id: b.id })
    expect(await call('items.get', { id: 'no-existe' })).toBeNull()
    await call('items.list', { listId: l1.id })
    await call('items.search', { query: 'ver' })
    await call('items.updateText', { id: a.id, text: 'a2' })
    expect(await call('items.backlinks', { id: a.id })).toHaveLength(1)
    await call('items.setDone', { id: a.id, done: true })
    await call('items.move', { id: a.id, listId: l2.id })
    await call('items.delete', { id: a.id })
    await call('items.restore', { id: a.id })
    await call('lists.delete', { id: l2.id })
    await call('lists.restore', { id: l2.id })
    await call('lists.list')
    await call('activity.list', { first: 5 })
    expect([...used].sort()).toEqual(registry.ops.map((o) => o.id).sort())
  })

  test('una escritura no se invoca con un token de lectura aunque se la nombre', async () => {
    const w = await world()
    const ctx = {
      deps: { db: w.db, bus: w.bus },
      caller: {
        userId: w.a.userId,
        ingress: 'public' as const,
        via: 'mcp' as const,
      },
      orgId: w.orgA,
    }
    await expect(
      registry.call(['checklist:read'], ctx, 'checklist.lists.create', {
        name: 'x',
      }),
    ).rejects.toThrow(/is not available/)
    await expect(
      registry.call(
        ['checklist:write'],
        ctx,
        'checklist.sistema.borrarTodo',
        {},
      ),
    ).rejects.toThrow(/is not available/)
    expect(
      registry
        .visible(['checklist:read'])
        .every((o) => o.scope === 'checklist:read'),
    ).toBe(true)
  })
})
