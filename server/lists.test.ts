import { describe, expect, test } from 'bun:test'
import { ulid } from './db/ids'
import type { ChangeEvent } from './events'
import { alice, bob, loginAs, setupServer } from './testing'

const code = (r: { errors?: { extensions?: { code?: string } }[] }) =>
  r.errors?.[0]?.extensions?.code

async function world() {
  const ctx = setupServer()
  const a = await loginAs(ctx.db, alice, 'public')
  const b = await loginAs(ctx.db, bob, 'public')
  const personal = (userId: string) =>
    ctx.db
      .query<{ id: string }, [string]>(
        'SELECT id FROM orgs WHERE personal_for = ?',
      )
      .get(userId)!.id
  const orgA = personal(a.userId)
  const orgB = personal(b.userId)
  const run = async (query: string, vars?: Record<string, unknown>) => {
    const res = await ctx.gql.public(query, a.cookie, vars)
    expect(res.errors).toBeUndefined()
    return res.data!
  }
  const newList = async (name: string, afterId: string | null = null) =>
    (
      await run(
        `mutation($o: ID!, $n: String!, $after: ID) { createList(orgId: $o, name: $n, afterId: $after) { id name position } }`,
        { o: orgA, n: name, after: afterId },
      )
    ).createList as { id: string; name: string; position: string }
  const newItem = async (
    listId: string,
    text: string,
    extra: { parentId?: string; afterId?: string } = {},
  ) =>
    (
      await run(
        `mutation($o: ID!, $l: ID!, $t: String!, $p: ID, $a: ID) { createItem(orgId: $o, listId: $l, text: $t, parentId: $p, afterId: $a) { id parentId position text } }`,
        {
          o: orgA,
          l: listId,
          t: text,
          p: extra.parentId ?? null,
          a: extra.afterId ?? null,
        },
      )
    ).createItem as { id: string; parentId: string | null; text: string }
  const texts = async (listId: string) =>
    (
      await run(
        `query($o: ID!, $l: ID!) { org(id: $o) { list(id: $l) { items { id text parentId done } } } }`,
        { o: orgA, l: listId },
      )
    ).org.list.items as {
      id: string
      text: string
      parentId: string | null
      done: boolean
    }[]
  return { ...ctx, a, b, orgA, orgB, run, newList, newItem, texts }
}

describe('listas', () => {
  test('crear, ordenar, renombrar, borrar y restaurar', async () => {
    const w = await world()
    const l1 = await w.newList('Uno')
    const l2 = await w.newList('Dos', l1.id)
    const l0 = await w.newList('Cero') // sin afterId: al principio
    const names = async () =>
      (
        await w.run(
          'query($o: ID!) { org(id: $o) { lists { id name open total } } }',
          { o: w.orgA },
        )
      ).org.lists.map((l: { name: string }) => l.name)
    expect(await names()).toEqual(['Cero', 'Uno', 'Dos'])

    await w.run(
      'mutation($o: ID!, $id: ID!, $a: ID) { moveList(orgId: $o, id: $id, afterId: $a) { id } }',
      { o: w.orgA, id: l0.id, a: l2.id },
    )
    expect(await names()).toEqual(['Uno', 'Dos', 'Cero'])

    await w.run(
      'mutation($o: ID!, $id: ID!) { renameList(orgId: $o, id: $id, name: "  Hoy ") { name } }',
      { o: w.orgA, id: l1.id },
    )
    expect(await names()).toEqual(['Hoy', 'Dos', 'Cero'])

    await w.run(
      'mutation($o: ID!, $id: ID!) { deleteList(orgId: $o, id: $id) { id } }',
      { o: w.orgA, id: l1.id },
    )
    expect(await names()).toEqual(['Dos', 'Cero'])
    await w.run(
      'mutation($o: ID!, $id: ID!) { restoreList(orgId: $o, id: $id) { id } }',
      { o: w.orgA, id: l1.id },
    )
    expect(await names()).toEqual(['Hoy', 'Dos', 'Cero'])
  })

  test('valida el nombre', async () => {
    const w = await world()
    for (const name of ['   ', 'x'.repeat(81), 'a\nb']) {
      const res = await w.gql.public(
        'mutation($o: ID!, $n: String!) { createList(orgId: $o, name: $n) { id } }',
        w.a.cookie,
        { o: w.orgA, n: name },
      )
      expect(code(res)).toBe('INVALID_INPUT')
    }
  })

  test('el contador de abiertos y total sigue a los items', async () => {
    const w = await world()
    const l = await w.newList('Compras')
    const i1 = await w.newItem(l.id, 'pan')
    await w.newItem(l.id, 'leche', { afterId: i1.id })
    await w.run(
      'mutation($o: ID!, $id: ID!) { setItemDone(orgId: $o, id: $id, done: true) { done } }',
      { o: w.orgA, id: i1.id },
    )
    const lists = (
      await w.run('query($o: ID!) { org(id: $o) { lists { open total } } }', {
        o: w.orgA,
      })
    ).org.lists
    expect(lists).toEqual([{ open: 1, total: 2 }])
  })
})

describe('items', () => {
  test('orden fraccional: insertar entre dos no reordena al resto', async () => {
    const w = await world()
    const l = await w.newList('L')
    const a = await w.newItem(l.id, 'a')
    const c = await w.newItem(l.id, 'c', { afterId: a.id })
    await w.newItem(l.id, 'b', { afterId: a.id })
    await w.newItem(l.id, 'z', { afterId: c.id })
    await w.newItem(l.id, '0') // sin afterId: al principio
    expect((await w.texts(l.id)).map((i) => i.text)).toEqual([
      '0',
      'a',
      'b',
      'c',
      'z',
    ])
  })

  test('mover dentro de la lista, a otra lista y a subitem', async () => {
    const w = await world()
    const l1 = await w.newList('L1')
    const l2 = await w.newList('L2', l1.id)
    const a = await w.newItem(l1.id, 'a')
    const b = await w.newItem(l1.id, 'b', { afterId: a.id })
    const c = await w.newItem(l1.id, 'c', { afterId: b.id })
    const move = `mutation($o: ID!, $id: ID!, $a: ID, $l: ID, $p: ID) { moveItem(orgId: $o, id: $id, afterId: $a, listId: $l, parentId: $p) { id listId parentId } }`

    await w.run(move, { o: w.orgA, id: c.id, a: null })
    expect((await w.texts(l1.id)).map((i) => i.text)).toEqual(['c', 'a', 'b'])

    // b pasa a subitem de a
    await w.run(move, { o: w.orgA, id: b.id, a: null, p: a.id })
    const tree = await w.texts(l1.id)
    expect(tree.find((i) => i.text === 'b')!.parentId).toBe(a.id)

    // a (con subitem) viaja a otra lista y se lleva a b
    await w.run(move, { o: w.orgA, id: a.id, a: null, l: l2.id })
    expect((await w.texts(l1.id)).map((i) => i.text)).toEqual(['c'])
    expect((await w.texts(l2.id)).map((i) => i.text).sort()).toEqual(['a', 'b'])

    // sacar b a primer nivel con `parentId: null` explícito
    await w.run(move, { o: w.orgA, id: b.id, a: null, p: null })
    expect(
      (await w.texts(l2.id)).find((i) => i.text === 'b')!.parentId,
    ).toBeNull()
  })

  test('un solo nivel de subitems y sin ciclos', async () => {
    const w = await world()
    const l = await w.newList('L')
    const a = await w.newItem(l.id, 'a')
    const sub = await w.newItem(l.id, 'sub', { parentId: a.id })
    const res = await w.gql.public(
      `mutation($o: ID!, $l: ID!, $p: ID) { createItem(orgId: $o, listId: $l, text: "nieto", parentId: $p) { id } }`,
      w.a.cookie,
      { o: w.orgA, l: l.id, p: sub.id },
    )
    expect(code(res)).toBe('INVALID_INPUT')

    const b = await w.newItem(l.id, 'b')
    const self = await w.gql.public(
      `mutation($o: ID!, $id: ID!) { moveItem(orgId: $o, id: $id, parentId: $id, afterId: null) { id } }`,
      w.a.cookie,
      { o: w.orgA, id: b.id },
    )
    expect(code(self)).toBe('INVALID_INPUT')

    // a tiene un subitem: no puede volverse subitem de b
    const nest = await w.gql.public(
      `mutation($o: ID!, $id: ID!, $p: ID) { moveItem(orgId: $o, id: $id, parentId: $p, afterId: null) { id } }`,
      w.a.cookie,
      { o: w.orgA, id: a.id, p: b.id },
    )
    expect(code(nest)).toBe('INVALID_INPUT')
  })

  test('borrar y restaurar un item lleva a sus subitems; uno borrado antes no vuelve', async () => {
    const w = await world()
    const l = await w.newList('L')
    const a = await w.newItem(l.id, 'a')
    const s1 = await w.newItem(l.id, 's1', { parentId: a.id })
    await w.newItem(l.id, 's2', { parentId: a.id, afterId: s1.id })
    const del = (id: string) =>
      w.run(
        'mutation($o: ID!, $id: ID!) { deleteItem(orgId: $o, id: $id) { id } }',
        { o: w.orgA, id: id },
      )
    const restore = (id: string) =>
      w.run(
        'mutation($o: ID!, $id: ID!) { restoreItem(orgId: $o, id: $id) { id } }',
        { o: w.orgA, id: id },
      )
    await new Promise((r) => setTimeout(r, 2))
    await del(s1.id)
    await new Promise((r) => setTimeout(r, 2))
    await del(a.id)
    expect(await w.texts(l.id)).toEqual([])
    // restaurar un subitem con el padre borrado no se puede
    const orphan = await w.gql.public(
      'mutation($o: ID!, $id: ID!) { restoreItem(orgId: $o, id: $id) { id } }',
      w.a.cookie,
      { o: w.orgA, id: s1.id },
    )
    expect(code(orphan)).toBe('NOT_FOUND')
    await restore(a.id)
    expect((await w.texts(l.id)).map((i) => i.text)).toEqual(['a', 's2'])
    await restore(s1.id)
    expect((await w.texts(l.id)).map((i) => i.text).sort()).toEqual([
      'a',
      's1',
      's2',
    ])
  })

  test('completar, reabrir y editar el texto', async () => {
    const w = await world()
    const l = await w.newList('L')
    const a = await w.newItem(l.id, 'a')
    const done = await w.run(
      'mutation($o: ID!, $id: ID!) { setItemDone(orgId: $o, id: $id, done: true) { done doneAt } }',
      { o: w.orgA, id: a.id },
    )
    expect(done.setItemDone.done).toBe(true)
    expect(done.setItemDone.doneAt).toBeString()
    const reopened = await w.run(
      'mutation($o: ID!, $id: ID!) { setItemDone(orgId: $o, id: $id, done: false) { done doneAt } }',
      { o: w.orgA, id: a.id },
    )
    expect(reopened.setItemDone).toEqual({ done: false, doneAt: null })
    const edited = await w.run(
      'mutation($o: ID!, $id: ID!) { updateItemText(orgId: $o, id: $id, text: " nuevo ") { text } }',
      { o: w.orgA, id: a.id },
    )
    expect(edited.updateItemText.text).toBe('nuevo')
    const empty = await w.gql.public(
      'mutation($o: ID!, $id: ID!) { updateItemText(orgId: $o, id: $id, text: "  ") { text } }',
      w.a.cookie,
      { o: w.orgA, id: a.id },
    )
    expect(code(empty)).toBe('INVALID_INPUT')
  })

  test('la búsqueda trata % y _ como texto y no ve items borrados', async () => {
    const w = await world()
    const l = await w.newList('L')
    await w.newItem(l.id, 'descuento 50% hoy')
    await w.newItem(l.id, 'otra cosa')
    const gone = await w.newItem(l.id, 'descuento viejo')
    await w.run(
      'mutation($o: ID!, $id: ID!) { deleteItem(orgId: $o, id: $id) { id } }',
      { o: w.orgA, id: gone.id },
    )
    const search = async (q: string) =>
      (
        await w.run(
          'query($o: ID!, $q: String!) { org(id: $o) { search(query: $q) { text listName } } }',
          { o: w.orgA, q },
        )
      ).org.search as { text: string }[]
    expect((await search('50%')).map((h) => h.text)).toEqual([
      'descuento 50% hoy',
    ])
    expect(await search('%')).toHaveLength(1)
    expect(await search('_')).toHaveLength(0)
    expect((await search('descuento')).map((h) => h.text)).toEqual([
      'descuento 50% hoy',
    ])
    expect(await search('   ')).toEqual([])
  })
})

describe('aislamiento entre orgs y puertas', () => {
  test('otro usuario no lee ni toca listas ni items ajenos', async () => {
    const w = await world()
    const l = await w.newList('Privada')
    const item = await w.newItem(l.id, 'secreto')
    const asBob = (q: string, vars: Record<string, unknown>) =>
      w.gql.public(q, w.b.cookie, vars)

    expect(
      code(
        await asBob('query($o: ID!) { org(id: $o) { lists { id } } }', {
          o: w.orgA,
        }),
      ),
    ).toBe('FORBIDDEN')

    // Bob usa su propia org con ids de Alice: NOT_FOUND, sin revelar que existen
    for (const [q, vars] of [
      [
        'mutation($o: ID!, $id: ID!) { deleteItem(orgId: $o, id: $id) { id } }',
        { o: w.orgB, id: item.id },
      ],
      [
        'mutation($o: ID!, $id: ID!) { renameList(orgId: $o, id: $id, name: "x") { id } }',
        { o: w.orgB, id: l.id },
      ],
      [
        'mutation($o: ID!, $l: ID!) { createItem(orgId: $o, listId: $l, text: "x") { id } }',
        { o: w.orgB, l: l.id },
      ],
      [
        'query($o: ID!, $id: ID!) { org(id: $o) { list(id: $id) { id } } }',
        { o: w.orgB, id: l.id },
      ],
    ] as const) {
      expect(code(await asBob(q, vars))).toBe('NOT_FOUND')
    }

    // y con la org de Alice: FORBIDDEN
    expect(
      code(
        await asBob(
          'mutation($o: ID!, $id: ID!) { deleteItem(orgId: $o, id: $id) { id } }',
          { o: w.orgA, id: item.id },
        ),
      ),
    ).toBe('FORBIDDEN')
    expect(await w.texts(l.id)).toHaveLength(1)
  })

  test('no se puede mover un item a una lista de otra org', async () => {
    const w = await world()
    const l = await w.newList('Mía')
    const item = await w.newItem(l.id, 'a')
    const bobList = (
      await w.gql.public(
        'mutation($o: ID!) { createList(orgId: $o, name: "De Bob") { id } }',
        w.b.cookie,
        { o: w.orgB },
      )
    ).data!.createList.id as string
    const res = await w.gql.public(
      'mutation($o: ID!, $id: ID!, $l: ID) { moveItem(orgId: $o, id: $id, listId: $l, afterId: null) { id } }',
      w.a.cookie,
      { o: w.orgA, id: item.id, l: bobList },
    )
    expect(code(res)).toBe('NOT_FOUND')
  })

  test('sin sesión, las mutaciones dan UNAUTHENTICATED', async () => {
    const w = await world()
    const res = await w.gql.public(
      'mutation($o: ID!) { createList(orgId: $o, name: "x") { id } }',
      undefined,
      { o: w.orgA },
    )
    expect(code(res)).toBe('UNAUTHENTICATED')
  })

  test('una org team: lista y items solo por la tailnet', async () => {
    const w = await world()
    const team = ulid()
    w.db
      .query(
        "INSERT INTO orgs (id, kind, name, created_at) VALUES (?, 'team', 'equipo', ?)",
      )
      .run(team, Date.now())
    w.db
      .query(
        "INSERT INTO org_members (org_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)",
      )
      .run(team, w.a.userId, Date.now())
    const tail = await loginAs(w.db, alice, 'tailnet')
    const m =
      'mutation($o: ID!) { createList(orgId: $o, name: "Equipo") { id } }'
    expect(code(await w.gql.public(m, w.a.cookie, { o: team }))).toBe(
      'FORBIDDEN',
    )
    const ok = await w.gql.tailnet(m, tail.cookie, { o: team })
    expect(ok.errors).toBeUndefined()
  })

  test('una request con Origin de otro sitio se rechaza', async () => {
    const w = await world()
    const res = await w.apps.public.handle(
      new Request('https://checklist.test/graphql', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: w.a.cookie,
          origin: 'https://evil.test',
        },
        body: JSON.stringify({
          query: `mutation { createList(orgId: "${w.orgA}", name: "x") { id } }`,
        }),
      }),
    )
    expect(res.status).toBe(403)
    expect(
      w.db.query('SELECT COUNT(*) AS n FROM lists').get() as { n: number },
    ).toEqual({ n: 0 })
  })
})

describe('actividad y eventos', () => {
  test('cada mutación deja una entrada y avisa por el bus', async () => {
    const w = await world()
    const seen: ChangeEvent[] = []
    w.bus.subscribe(w.orgA, (e) => seen.push(e))
    const l = await w.newList('L')
    const i = await w.newItem(l.id, 'a')
    await w.run(
      'mutation($o: ID!, $id: ID!) { setItemDone(orgId: $o, id: $id, done: true) { id } }',
      { o: w.orgA, id: i.id },
    )
    const types = (
      await w.run('query($o: ID!) { org(id: $o) { activity { type } } }', {
        o: w.orgA,
      })
    ).org.activity.map((a: { type: string }) => a.type)
    expect(types.reverse()).toEqual([
      'org.created',
      'list.created',
      'item.created',
      'item.completed',
    ])
    expect(seen.some((e) => e.scope === 'lists')).toBe(true)
    expect(seen.some((e) => e.scope === 'list' && e.listId === l.id)).toBe(true)
  })

  test('completar un item ya completo no duplica actividad ni eventos', async () => {
    const w = await world()
    const l = await w.newList('L')
    const i = await w.newItem(l.id, 'a')
    const done = () =>
      w.run(
        'mutation($o: ID!, $id: ID!) { setItemDone(orgId: $o, id: $id, done: true) { id } }',
        { o: w.orgA, id: i.id },
      )
    await done()
    const seen: ChangeEvent[] = []
    w.bus.subscribe(w.orgA, (e) => seen.push(e))
    await done()
    expect(seen).toEqual([])
  })

  test('SSE: solo con sesión y membresía, y recibe los cambios de su org', async () => {
    const w = await world()
    const open = (cookie?: string, org = w.orgA) =>
      w.apps.public.handle(
        new Request(`https://checklist.test/events?org=${org}`, {
          headers: cookie ? { cookie } : {},
        }),
      )
    expect((await open()).status).toBe(401)
    expect((await open(w.b.cookie)).status).toBe(403)
    expect((await open(w.a.cookie, 'no-existe')).status).toBe(403)

    const res = await open(w.a.cookie)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    const first = decoder.decode((await reader.read()).value)
    expect(first).toContain('retry: 3000')

    const l = await w.newList('Nueva')
    let got = ''
    while (!got.includes('event: change')) {
      got += decoder.decode((await reader.read()).value)
    }
    expect(got).toContain('"scope":"lists"')
    // El evento no filtra contenido ni ids de usuarios.
    expect(got).not.toContain(l.id)
    await reader.cancel()
  })
})
