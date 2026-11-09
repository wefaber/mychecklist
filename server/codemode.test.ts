import { describe, expect, test } from 'bun:test'
import { world } from './mcp/testing'

describe('Code Mode: execute', () => {
  test('un execute crea 10 items en 3 listas y deja activity via=mcp', async () => {
    const w = await world()
    const { secret } = w.token(w.a.userId, w.orgA)
    const r = await w.exec(
      secret,
      `const names = ['Compras', 'Casa', 'Trabajo'];
       const lists = [];
       for (const name of names) lists.push(await checklist.lists.create({ name }));
       const made = [];
       for (let i = 0; i < 10; i++) {
         const list = lists[i % 3];
         made.push(await checklist.items.create({ listId: list.id, text: 'tarea ' + i }));
       }
       const after = await checklist.lists.list();
       return { lists: after.map((l) => [l.name, l.total]), ids: made.length }`,
    )
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({
      ok: true,
      result: {
        lists: [
          ['Compras', 4],
          ['Casa', 3],
          ['Trabajo', 3],
        ],
        ids: 10,
      },
      calls: 14,
    })
    // Los mismos datos por la otra vía (GraphQL con la sesión): una sola base, un solo dominio.
    const viaGql = await w.gql(
      `query($o: ID!) { org(id: $o) { lists { name items { text } } activity(first: 50) { type via } } }`,
      w.a.cookie,
      { o: w.orgA },
    )
    expect(viaGql.errors).toBeUndefined()
    const org = viaGql.data!.org
    expect(org.lists.map((l: any) => l.items.length)).toEqual([4, 3, 3])
    expect(org.lists[0].items[0].text).toBe('tarea 0')
    const mcp = org.activity.filter((e: any) => e.via === 'mcp')
    expect(mcp.filter((e: any) => e.type === 'item.created')).toHaveLength(10)
    expect(mcp.filter((e: any) => e.type === 'list.created')).toHaveLength(3)
  })

  test('los items quedan en orden de creación (afterId omitido va al final)', async () => {
    const w = await world()
    const { secret } = w.token(w.a.userId, w.orgA)
    const r = await w.exec(
      secret,
      `const l = await checklist.lists.create({ name: 'L' });
       for (const t of ['uno', 'dos', 'tres']) await checklist.items.create({ listId: l.id, text: t });
       await checklist.items.create({ listId: l.id, text: 'cero', afterId: null });
       return (await checklist.items.list({ listId: l.id })).map((i) => i.text)`,
    )
    expect(r.body.result).toEqual(['cero', 'uno', 'dos', 'tres'])
  })
})

describe('Code Mode: resolución', () => {
  test('setDone guarda la resolución y la lee de vuelta; reabrir la conserva', async () => {
    const w = await world()
    const { secret } = w.token(w.a.userId, w.orgA)
    const r = await w.exec(
      secret,
      `const l = await checklist.lists.create({ name: 'Ad Astra' });
       const i = await checklist.items.create({ listId: l.id, text: 'Definir la lista corta' });
       const cerrado = await checklist.items.setDone({ id: i.id, done: true, resolution: 'Los puntos son X, Y, Z' });
       const reabierto = await checklist.items.setDone({ id: i.id, done: false });
       const leido = await checklist.items.get({ id: i.id });
       return { cerrado: [cerrado.done, cerrado.resolution], reabierto: [reabierto.done, reabierto.resolution], leido: leido.resolution }`,
    )
    expect(r.body).toMatchObject({
      ok: true,
      result: {
        cerrado: [true, 'Los puntos son X, Y, Z'],
        reabierto: [false, 'Los puntos son X, Y, Z'],
        leido: 'Los puntos son X, Y, Z',
      },
    })
  })

  test('el token de solo lectura ve la resolución pero no puede escribirla', async () => {
    const w = await world()
    const { secret } = w.token(w.a.userId, w.orgA, 'read')
    const r = await w.exec(secret, `return typeof checklist.items.setDone`)
    expect(r.body).toMatchObject({ ok: true, result: 'undefined' })
  })
})
