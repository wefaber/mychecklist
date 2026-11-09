import { describe, expect, test } from 'bun:test'
import {
  createItem,
  getItem,
  listBacklinks,
  searchItems,
  setItemDone,
  updateItemText,
} from './services/items'
import { createList } from './services/lists'
import { MAX_TEXT } from './services/validate'
import { alice, loginAs, setupServer } from './testing'

async function world() {
  const ctx = setupServer()
  const a = await loginAs(ctx.db, alice, 'public')
  const orgId = ctx.db
    .query<{ id: string }, [string]>(
      'SELECT id FROM orgs WHERE personal_for = ?',
    )
    .get(a.userId)!.id
  const deps = { db: ctx.db, bus: ctx.bus }
  const caller = { userId: a.userId, ingress: 'public' as const }
  const list = createList(deps, caller, {
    orgId,
    name: 'Ad Astra',
    afterId: null,
  })
  const item = (text: string) =>
    createItem(deps, caller, {
      orgId,
      listId: list.id,
      parentId: null,
      afterId: null,
      text,
    })
  const done = (id: string, isDone: boolean, resolution?: string | null) =>
    setItemDone(deps, caller, { orgId, id, done: isDone, resolution })
  const get = (id: string) => getItem(deps, caller, orgId, id)!
  return { ...ctx, deps, caller, orgId, list, item, done, get }
}

describe('resolución al completar', () => {
  test('un item nuevo no tiene resolución', async () => {
    const w = await world()
    expect(w.item('Definir la lista corta').resolution).toBeNull()
  })

  test('completar con resolución la guarda junto con el cierre', async () => {
    const w = await world()
    const i = w.item('Definir la lista corta de sistemas')
    const r = w.done(i.id, true, 'Los puntos son X, Y, Z')
    expect(r.doneAt).not.toBeNull()
    expect(r.resolution).toBe('Los puntos son X, Y, Z')
    expect(w.get(i.id).resolution).toBe('Los puntos son X, Y, Z')
  })

  test('completar sin resolución sigue siendo un toque y no inventa una', async () => {
    const w = await world()
    const i = w.item('a')
    expect(w.done(i.id, true).resolution).toBeNull()
  })

  test('reabrir conserva la resolución y no admite una nueva', async () => {
    const w = await world()
    const i = w.item('a')
    w.done(i.id, true, 'cerrado por X')
    const reopened = w.done(i.id, false)
    expect(reopened.doneAt).toBeNull()
    expect(reopened.resolution).toBe('cerrado por X')
    expect(() => w.done(i.id, false, 'otra')).toThrow(
      'La resolución se escribe al completar el item',
    )
    expect(w.get(i.id).resolution).toBe('cerrado por X')
  })

  test('volver a completar sin resolución deja la que había', async () => {
    const w = await world()
    const i = w.item('a')
    w.done(i.id, true, 'primera')
    w.done(i.id, false)
    expect(w.done(i.id, true).resolution).toBe('primera')
  })

  test('un item ya completo puede cambiar su resolución, y en blanco la borra', async () => {
    const w = await world()
    const i = w.item('a')
    w.done(i.id, true, 'primera')
    expect(w.done(i.id, true, 'segunda').resolution).toBe('segunda')
    expect(w.done(i.id, true, '   ').resolution).toBeNull()
    expect(w.done(i.id, true, 'tercera').resolution).toBe('tercera')
    expect(w.done(i.id, true, null).resolution).toBeNull()
  })

  test('el tope de largo es el del texto', async () => {
    const w = await world()
    const i = w.item('a')
    expect(() => w.done(i.id, true, 'x'.repeat(MAX_TEXT + 1))).toThrow()
    expect(w.done(i.id, true, 'x'.repeat(MAX_TEXT)).resolution).toHaveLength(
      MAX_TEXT,
    )
  })

  test('editar el texto no toca la resolución', async () => {
    const w = await world()
    const i = w.item('a')
    w.done(i.id, true, 'cerrado')
    const edited = updateItemText(w.deps, w.caller, {
      orgId: w.orgId,
      id: i.id,
      text: 'a, renombrado',
    })
    expect(edited.resolution).toBe('cerrado')
    expect(edited.text).toBe('a, renombrado')
  })

  test('la actividad distingue completar de editar la resolución', async () => {
    const w = await world()
    const i = w.item('a')
    w.done(i.id, true, 'primera')
    w.done(i.id, true, 'segunda')
    w.done(i.id, false)
    const types = w.db
      .query<{ type: string }, [string]>(
        'SELECT type FROM activity WHERE entity_id = ? ORDER BY id',
      )
      .all(i.id)
      .map((r) => r.type)
    expect(types).toEqual([
      'item.created',
      'item.completed',
      'item.edited',
      'item.reopened',
    ])
  })
})

describe('resolución, búsqueda y referencias', () => {
  test('la búsqueda también mira la resolución', async () => {
    const w = await world()
    const i = w.item('Definir la lista corta')
    w.item('Otra cosa')
    w.done(i.id, true, 'Los sistemas son zeta y omega')
    const hits = searchItems(w.deps, w.caller, w.orgId, 'omega', 10)
    expect(hits.map((h) => h.id)).toEqual([i.id])
  })

  test('una mención dentro de la resolución crea el backlink y desaparece al borrarla', async () => {
    const w = await world()
    const target = w.item('Fórmula de vehículos')
    const i = w.item('Definir sistemas')
    const r = w.done(i.id, true, `Ver [[${target.id}]]`)
    expect(r.mentions.map((m) => m.id)).toEqual([target.id])
    expect(
      listBacklinks(w.deps, w.caller, w.orgId, target.id).map((m) => m.id),
    ).toEqual([i.id])

    w.done(i.id, true, null)
    expect(listBacklinks(w.deps, w.caller, w.orgId, target.id)).toEqual([])
  })

  test('editar el texto conserva las menciones de la resolución', async () => {
    const w = await world()
    const target = w.item('Fórmula de vehículos')
    const i = w.item('Definir sistemas')
    w.done(i.id, true, `Ver [[${target.id}]]`)
    updateItemText(w.deps, w.caller, {
      orgId: w.orgId,
      id: i.id,
      text: 'Definir sistemas v2',
    })
    expect(
      listBacklinks(w.deps, w.caller, w.orgId, target.id).map((m) => m.id),
    ).toEqual([i.id])
  })
})

describe('resolución por GraphQL', () => {
  test('setItemDone acepta resolution, omitida deja la que hay y reabrir con una da INVALID_INPUT', async () => {
    const w = await world()
    const a = await loginAs(w.db, alice, 'public')
    const i = w.item('Definir')
    const call = (vars: Record<string, unknown>, sel = 'done resolution') =>
      w.gql.public(
        `mutation($o: ID!, $id: ID!, $d: Boolean!, $r: String) { setItemDone(orgId: $o, id: $id, done: $d, resolution: $r) { ${sel} } }`,
        a.cookie,
        { o: w.orgId, id: i.id, ...vars },
      )
    const closed = await call({ d: true, r: 'Los puntos son X, Y, Z' })
    expect(closed.errors).toBeUndefined()
    expect(closed.data!.setItemDone).toEqual({
      done: true,
      resolution: 'Los puntos son X, Y, Z',
    })
    const reopened = await call({ d: false })
    expect(reopened.data!.setItemDone).toEqual({
      done: false,
      resolution: 'Los puntos son X, Y, Z',
    })
    const bad = await call({ d: false, r: 'otra' })
    expect(bad.errors?.[0]?.extensions?.code).toBe('INVALID_INPUT')
  })
})
