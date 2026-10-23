import { describe, expect, test } from 'bun:test'
import { alice, bob, loginAs, setupServer } from './testing'

const code = (r: { errors?: { extensions?: { code?: string } }[] }) =>
  r.errors?.[0]?.extensions?.code

type Mention = {
  id: string
  listId: string
  listName: string
  title: string
  done: boolean
}

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
  const newList = async (name: string) =>
    (
      await run(
        `mutation($o: ID!, $n: String!) { createList(orgId: $o, name: $n) { id } }`,
        { o: orgA, n: name },
      )
    ).createList as { id: string }
  const newItem = async (listId: string, text: string) =>
    (
      await run(
        `mutation($o: ID!, $l: ID!, $t: String!) { createItem(orgId: $o, listId: $l, text: $t) { id mentions { id title } } }`,
        { o: orgA, l: listId, t: text },
      )
    ).createItem as { id: string; mentions: { id: string; title: string }[] }
  const edit = async (id: string, text: string) =>
    (
      await run(
        `mutation($o: ID!, $id: ID!, $t: String!) { updateItemText(orgId: $o, id: $id, text: $t) { id mentions { id title } } }`,
        { o: orgA, id, t: text },
      )
    ).updateItemText as { id: string; mentions: { id: string }[] }
  const backlinks = async (id: string) =>
    (
      await run(
        `query($o: ID!, $l: ID!) { org(id: $o) { list(id: $l) { items { id backlinks { id listId listName title done } } } } }`,
        { o: orgA, l: listOf.get(id)! },
      )
    ).org.list.items.find((i: { id: string }) => i.id === id)
      .backlinks as Mention[]
  const listOf = new Map<string, string>()
  const item = async (listId: string, text: string) => {
    const created = await newItem(listId, text)
    listOf.set(created.id, listId)
    return created
  }
  return { ...ctx, a, b, orgA, orgB, run, newList, item, edit, backlinks }
}

describe('referencias [[id]]', () => {
  test('un item que enlaza a otro lo menciona y aparece en sus backlinks', async () => {
    const w = await world()
    const lista = await w.newList('Proyecto')
    const otra = await w.newList('Ideas')
    const target = await w.item(otra.id, '# Diseñar el Dock\ncon notas')
    const source = await w.item(lista.id, `Revisar [[${target.id}]] hoy`)

    expect(source.mentions).toEqual([
      { id: target.id, title: 'Diseñar el Dock' },
    ])
    expect(await w.backlinks(target.id)).toEqual([
      {
        id: source.id,
        listId: lista.id,
        listName: 'Proyecto',
        title: 'Revisar hoy',
        done: false,
      },
    ])
  })

  test('org.item trae un item con sus backlinks; uno borrado o ajeno da null', async () => {
    const w = await world()
    const l = await w.newList('Uno')
    const x = await w.item(l.id, 'x')
    const src = await w.item(l.id, `ver [[${x.id}]]`)
    const q = `query($o: ID!, $i: ID!) { org(id: $o) { item(id: $i) { id backlinks { id } mentions { id } } } }`
    expect((await w.run(q, { o: w.orgA, i: x.id })).org.item).toEqual({
      id: x.id,
      backlinks: [{ id: src.id }],
      mentions: [],
    })
    expect((await w.run(q, { o: w.orgA, i: 'nada' })).org.item).toBeNull()
    await w.run(
      `mutation($o: ID!, $id: ID!) { deleteItem(orgId: $o, id: $id) { id } }`,
      { o: w.orgA, id: x.id },
    )
    expect((await w.run(q, { o: w.orgA, i: x.id })).org.item).toBeNull()
  })

  test('el listado de una lista trae las menciones de todos sus items', async () => {
    const w = await world()
    const l = await w.newList('Uno')
    const x = await w.item(l.id, 'x')
    const y = await w.item(l.id, 'y')
    await w.item(l.id, `a [[${x.id}]] [[${y.id}]]`)
    await w.item(l.id, 'sin enlaces')
    const items = (
      await w.run(
        `query($o: ID!, $l: ID!) { org(id: $o) { list(id: $l) { items { text mentions { id } } } } }`,
        { o: w.orgA, l: l.id },
      )
    ).org.list.items as { text: string; mentions: { id: string }[] }[]
    expect(items.map((i) => i.mentions.length).sort()).toEqual([0, 0, 0, 2])
    expect(items.find((i) => i.text.startsWith('a '))!.mentions).toHaveLength(2)
  })

  test('editar el texto reescribe las menciones', async () => {
    const w = await world()
    const l = await w.newList('Uno')
    const x = await w.item(l.id, 'x')
    const y = await w.item(l.id, 'y')
    const src = await w.item(l.id, `ver [[${x.id}]]`)
    expect((await w.backlinks(x.id)).map((b) => b.id)).toEqual([src.id])

    const edited = await w.edit(src.id, `ahora [[${y.id}]]`)
    expect(edited.mentions.map((m) => m.id)).toEqual([y.id])
    expect(await w.backlinks(x.id)).toEqual([])
    expect((await w.backlinks(y.id)).map((b) => b.id)).toEqual([src.id])

    await w.edit(src.id, 'sin nada')
    expect(await w.backlinks(y.id)).toEqual([])
  })

  test('código, ids inexistentes y la autorreferencia no cuentan', async () => {
    const w = await world()
    const l = await w.newList('Uno')
    const x = await w.item(l.id, 'x')
    const ghost = '01JC8Q2V3N4M5P6R7S8T9VWXYZ'
    const src = await w.item(
      l.id,
      `\`[[${x.id}]]\` y [[${ghost}]]\n\n\`\`\`\n[[${x.id}]]\n\`\`\``,
    )
    expect(src.mentions).toEqual([])
    const own = await w.item(l.id, 'yo')
    const edited = await w.edit(own.id, `a mí [[${own.id}]]`)
    expect(edited.mentions).toEqual([])
    expect(await w.backlinks(x.id)).toEqual([])
    expect(w.db.query('SELECT COUNT(*) AS n FROM item_refs').get()).toEqual({
      n: 0,
    })
  })

  test('un item borrado deja de mencionar y de ser mencionado, y vuelve al restaurar', async () => {
    const w = await world()
    const l = await w.newList('Uno')
    const x = await w.item(l.id, 'x')
    const src = await w.item(l.id, `ver [[${x.id}]]`)

    await w.run(
      `mutation($o: ID!, $id: ID!) { deleteItem(orgId: $o, id: $id) { id } }`,
      { o: w.orgA, id: x.id },
    )
    const during = (
      await w.run(
        `query($o: ID!, $l: ID!) { org(id: $o) { list(id: $l) { items { id mentions { id } } } } }`,
        { o: w.orgA, l: l.id },
      )
    ).org.list.items as { id: string; mentions: unknown[] }[]
    expect(during.find((i) => i.id === src.id)!.mentions).toEqual([])

    await w.run(
      `mutation($o: ID!, $id: ID!) { restoreItem(orgId: $o, id: $id) { id } }`,
      { o: w.orgA, id: x.id },
    )
    expect((await w.backlinks(x.id)).map((b) => b.id)).toEqual([src.id])

    await w.run(
      `mutation($o: ID!, $id: ID!) { deleteItem(orgId: $o, id: $id) { id } }`,
      { o: w.orgA, id: src.id },
    )
    await w.run(
      `mutation($o: ID!, $id: ID!) { restoreItem(orgId: $o, id: $id) { id } }`,
      { o: w.orgA, id: x.id },
    )
    expect(await w.backlinks(x.id)).toEqual([])
  })

  test('el título de una mención sale limpio (sin marcas) y acotado', async () => {
    const w = await world()
    const l = await w.newList('Uno')
    const x = await w.item(l.id, `\n\n- [ ] **${'a'.repeat(300)}**`)
    const src = await w.item(l.id, `[[${x.id}]]`)
    const t = src.mentions[0]!.title
    expect(t).toHaveLength(120)
    expect(t.endsWith('…')).toBe(true)
    expect(t).not.toContain('*')
  })

  test('no se enlaza a un item de otra org', async () => {
    const w = await world()
    const mine = await w.newList('Mía')
    const bobList = (
      await w.gql.public(
        'mutation($o: ID!) { createList(orgId: $o, name: "De Bob") { id } }',
        w.b.cookie,
        { o: w.orgB },
      )
    ).data!.createList.id as string
    const bobItem = (
      await w.gql.public(
        'mutation($o: ID!, $l: ID!) { createItem(orgId: $o, listId: $l, text: "secreto") { id } }',
        w.b.cookie,
        { o: w.orgB, l: bobList },
      )
    ).data!.createItem.id as string

    const src = await w.item(mine.id, `mirá [[${bobItem}]]`)
    expect(src.mentions).toEqual([])
    expect(w.db.query('SELECT COUNT(*) AS n FROM item_refs').get()).toEqual({
      n: 0,
    })

    // Y el backlink de un item ajeno no se pide con la org propia.
    const res = await w.gql.public(
      'query($o: ID!, $l: ID!) { org(id: $o) { list(id: $l) { items { id } } } }',
      w.a.cookie,
      { o: w.orgB, l: bobList },
    )
    expect(code(res)).toBe('FORBIDDEN')
  })
})
