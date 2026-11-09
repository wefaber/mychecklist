import { describe, expect, test } from 'bun:test'
import { insertTeamOrg } from './db/members'
import { backfillListCodes, openScope } from './db/scoped'
import {
  createItem,
  deleteItem,
  getItem,
  listBacklinks,
  listItems,
  moveItem,
  searchItems,
  setItemDone,
  updateItemText,
} from './services/items'
import { createList, deleteList, setListCode } from './services/lists'
import { exportOrg, importOrg } from './services/transfer'
import { fileStore } from './files'
import { alice, config, loginAs, setupServer } from './testing'

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
  const list = (name: string) =>
    createList(deps, caller, { orgId, name, afterId: null })
  const item = (listId: string, text: string, parentId: string | null = null) =>
    createItem(deps, caller, {
      orgId,
      listId,
      parentId,
      afterId: null,
      text,
    })
  const get = (id: string) => getItem(deps, caller, orgId, id)
  return { ...ctx, deps, caller, orgId, list, item, get, userId: a.userId }
}

describe('identificador corto: código de lista y número de item', () => {
  test('la lista toma su código del nombre y no se repite en la org', async () => {
    const w = await world()
    expect(w.list('Ad Astra').code).toBe('AA')
    expect(w.list('Economía').code).toBe('ECO')
    expect(w.list('Ad Astra').code).toBe('AA2')
  })

  test('los items se numeran por lista, subitems incluidos, desde 1', async () => {
    const w = await world()
    const l1 = w.list('Ad Astra')
    const l2 = w.list('Economía')
    const a = w.item(l1.id, 'a')
    const sub = w.item(l1.id, 'sub', a.id)
    const b = w.item(l1.id, 'b')
    const c = w.item(l2.id, 'c')
    expect([a, sub, b, c].map((i) => i.shortId)).toEqual([
      'AA-1',
      'AA-2',
      'AA-3',
      'ECO-1',
    ])
    expect(a.number).toBe(1)
  })

  test('un número no se reutiliza aunque el item se borre', async () => {
    const w = await world()
    const l = w.list('Ad Astra')
    const a = w.item(l.id, 'a')
    deleteItem(w.deps, w.caller, { orgId: w.orgId, id: a.id })
    expect(w.item(l.id, 'b').shortId).toBe('AA-2')
  })

  test('una org con código lleva el prefijo; las personales no', async () => {
    const w = await world()
    const l = w.list('Ad Astra')
    const i = w.item(l.id, 'a')
    expect(i.shortId).toBe('AA-1')
    w.db.query('UPDATE orgs SET code = ? WHERE id = ?').run('WF', w.orgId)
    expect(w.get(i.id)!.shortId).toBe('WF-AA-1')
  })

  test('crear una org de equipo le asigna un código único', async () => {
    const w = await world()
    const t1 = insertTeamOrg(w.db, 'WeFaber', w.userId, 1)
    const t2 = insertTeamOrg(w.db, 'Wefaber Labs', w.userId, 2)
    const code = (id: string) =>
      w.db
        .query<{ code: string }, [string]>('SELECT code FROM orgs WHERE id = ?')
        .get(id)!.code
    expect(code(t1.id)).toBe('WF')
    expect(code(t2.id)).toBe('WL')
    const t3 = insertTeamOrg(w.db, 'We Faber', w.userId, 3)
    expect(code(t3.id)).toBe('WF2')
  })

  test('mover a otra lista da el número siguiente de la lista nueva', async () => {
    const w = await world()
    const l1 = w.list('Ad Astra')
    const l2 = w.list('Economía')
    const a = w.item(l1.id, 'a')
    w.item(l2.id, 'x')
    w.item(l2.id, 'y')
    const moved = moveItem(w.deps, w.caller, {
      orgId: w.orgId,
      id: a.id,
      listId: l2.id,
      afterId: null,
    })
    expect(moved.shortId).toBe('ECO-3')
    // El 1 de la lista de origen queda vacío: no lo toma el siguiente.
    expect(w.item(l1.id, 'b').shortId).toBe('AA-2')
  })

  test('mover dentro de la misma lista no cambia el número', async () => {
    const w = await world()
    const l = w.list('Ad Astra')
    const a = w.item(l.id, 'a')
    const b = w.item(l.id, 'b')
    const moved = moveItem(w.deps, w.caller, {
      orgId: w.orgId,
      id: b.id,
      afterId: null,
    })
    // El número es el de creación, no el de la posición.
    expect(moved.shortId).toBe('AA-2')
    expect(w.get(a.id)!.shortId).toBe('AA-1')
  })
})

describe('identificador corto: referencias y lectura', () => {
  test('[[AA-1]] se guarda como [[ULID]] y cuenta como backlink', async () => {
    const w = await world()
    const l = w.list('Ad Astra')
    const target = w.item(l.id, 'Fórmula')
    const from = w.item(l.id, 'Ver [[AA-1]] y [[aa-1]]')
    expect(from.text).toBe(`Ver [[${target.id}]] y [[${target.id}]]`)
    expect(from.mentions.map((m) => m.id)).toEqual([target.id])
    expect(from.mentions[0]!.shortId).toBe('AA-1')
    expect(
      listBacklinks(w.deps, w.caller, w.orgId, target.id).map((m) => m.id),
    ).toEqual([from.id])
  })

  test('editar el texto y la resolución también resuelven', async () => {
    const w = await world()
    const l = w.list('Ad Astra')
    const target = w.item(l.id, 'Fórmula')
    const i = w.item(l.id, 'a')
    const edited = updateItemText(w.deps, w.caller, {
      orgId: w.orgId,
      id: i.id,
      text: 'ahora [[AA-1]]',
    })
    expect(edited.text).toBe(`ahora [[${target.id}]]`)
    const done = setItemDone(w.deps, w.caller, {
      orgId: w.orgId,
      id: i.id,
      done: true,
      resolution: 'cierra por [[AA-1]]',
    })
    expect(done.resolution).toBe(`cierra por [[${target.id}]]`)
  })

  test('un identificador que no existe queda como texto', async () => {
    const w = await world()
    const l = w.list('Ad Astra')
    w.item(l.id, 'a')
    const i = w.item(l.id, 'Ver [[AA-99]] y [[ZZ-1]]')
    expect(i.text).toBe('Ver [[AA-99]] y [[ZZ-1]]')
    expect(i.mentions).toEqual([])
  })

  test('un prefijo de org que no es el de la org no resuelve', async () => {
    const w = await world()
    const l = w.list('Ad Astra')
    w.item(l.id, 'a')
    expect(w.item(l.id, 'Ver [[WF-AA-1]]').text).toBe('Ver [[WF-AA-1]]')
    w.db.query('UPDATE orgs SET code = ? WHERE id = ?').run('WF', w.orgId)
    const ok = w.item(l.id, 'Ver [[WF-AA-1]] y [[AA-1]]')
    expect(ok.mentions).toHaveLength(1)
    expect(ok.text).not.toContain('AA-1')
  })

  test('items.get acepta el identificador corto y sigue aceptando el id', async () => {
    const w = await world()
    const l = w.list('Ad Astra')
    const a = w.item(l.id, 'a')
    expect(w.get('AA-1')?.id).toBe(a.id)
    expect(w.get('aa-1')?.id).toBe(a.id)
    expect(w.get(a.id)?.id).toBe(a.id)
    expect(w.get('AA-2')).toBeNull()
    expect(w.get('ZZ-1')).toBeNull()
  })

  test('la búsqueda por identificador exacto pone al item primero', async () => {
    const w = await world()
    const l = w.list('Ad Astra')
    w.item(l.id, 'menciona AA-2 en el texto')
    const b = w.item(l.id, 'b')
    const hits = searchItems(w.deps, w.caller, w.orgId, 'AA-2', 10)
    expect(hits[0]).toMatchObject({ id: b.id, shortId: 'AA-2' })
    expect(hits).toHaveLength(2)
  })

  test('un item borrado no resuelve', async () => {
    const w = await world()
    const l = w.list('Ad Astra')
    const a = w.item(l.id, 'a')
    deleteItem(w.deps, w.caller, { orgId: w.orgId, id: a.id })
    expect(w.get('AA-1')).toBeNull()
    expect(w.item(l.id, 'Ver [[AA-1]]').text).toBe('Ver [[AA-1]]')
  })

  test('listItems devuelve el identificador de cada item', async () => {
    const w = await world()
    const l = w.list('Ad Astra')
    w.item(l.id, 'a')
    w.item(l.id, 'b')
    expect(
      listItems(w.deps, w.caller, w.orgId, l.id)
        .map((i) => i.shortId)
        .sort(),
    ).toEqual(['AA-1', 'AA-2'])
  })
})

describe('identificador corto: cambiar el código', () => {
  test('setListCode cambia el identificador de todos los items', async () => {
    const w = await world()
    const l = w.list('Ad Astra')
    const a = w.item(l.id, 'a')
    const out = setListCode(w.deps, w.caller, {
      orgId: w.orgId,
      id: l.id,
      code: ' astra ',
    })
    expect(out.code).toBe('ASTRA')
    expect(w.get(a.id)!.shortId).toBe('ASTRA-1')
    expect(w.get('AA-1')).toBeNull()
  })

  test('rechaza un código inválido o ya usado, también por una lista borrada', async () => {
    const w = await world()
    const l1 = w.list('Ad Astra')
    const l2 = w.list('Economía')
    const set = (id: string, code: string) => () =>
      setListCode(w.deps, w.caller, { orgId: w.orgId, id, code })
    expect(set(l2.id, 'a')).toThrow('2 a 8')
    expect(set(l2.id, '1AB')).toThrow('empieza con una letra')
    expect(set(l2.id, 'AA')).toThrow('ya usa ese código')
    deleteList(w.deps, w.caller, { orgId: w.orgId, id: l1.id })
    expect(set(l2.id, 'AA')).toThrow('ya usa ese código')
    // Y una lista nueva con ese nombre no pisa el código reservado.
    expect(w.list('Ad Astra').code).toBe('AA2')
  })
})

describe('identificador corto: lo que ya existía', () => {
  test('backfillListCodes asigna código a las listas que no lo tienen', async () => {
    const w = await world()
    const l1 = w.list('Ad Astra')
    const l2 = w.list('Economía')
    w.db.query('UPDATE lists SET code = NULL').run()
    expect(backfillListCodes(w.db)).toBe(2)
    const scope = openScope(w.db, { orgId: w.orgId, ...w.caller })
    expect(scope.lists.get(l1.id)!.code).toBe('AA')
    expect(scope.lists.get(l2.id)!.code).toBe('ECO')
    expect(backfillListCodes(w.db)).toBe(0)
  })

  test('el trigger numera lo que inserta una conexión que no conoce la columna', async () => {
    const w = await world()
    const l = w.list('Ad Astra')
    const insert = (id: string) =>
      w.db
        .query(
          `INSERT INTO items (id, org_id, list_id, parent_id, position, text, created_at, updated_at)
           VALUES (?, ?, ?, NULL, 'a', 'x', 1, 1)`,
        )
        .run(id, w.orgId, l.id)
    insert('LEGACY1')
    insert('LEGACY2')
    const numbers = w.db
      .query<{ number: number }, [string]>(
        'SELECT number FROM items WHERE list_id = ? ORDER BY number',
      )
      .all(l.id)
      .map((r) => r.number)
    expect(numbers).toEqual([1, 2])
    expect(w.item(l.id, 'nuevo').shortId).toBe('AA-3')
  })
})

describe('identificador corto: export e import', () => {
  test('el código de la lista viaja en el archivo y la importada recibe otro si el suyo está tomado', async () => {
    const w = await world()
    const l = w.list('Ad Astra')
    w.item(l.id, 'Fórmula')
    w.item(l.id, 'Ver [[AA-1]]')
    const deps = { ...w.deps, files: fileStore(config.filesDir) }
    const file = await exportOrg(deps, w.caller, { orgId: w.orgId })
    expect(file.lists[0]!.code).toBe('AA')

    await importOrg(deps, w.caller, { orgId: w.orgId, payload: file })
    const codes = w.db
      .query<{ code: string }, [string]>(
        'SELECT code FROM lists WHERE org_id = ? ORDER BY code',
      )
      .all(w.orgId)
      .map((r) => r.code)
    expect(codes).toEqual(['AA', 'AA2'])

    // La referencia importada apunta al item importado, no al original.
    const imported = w.db
      .query<{ id: string; text: string }, [string]>(
        `SELECT i.id, i.text FROM items i JOIN lists l ON l.id = i.list_id
         WHERE i.org_id = ? AND l.code = 'AA2' AND i.text LIKE 'Ver%'`,
      )
      .get(w.orgId)!
    const target = w.db
      .query<{ id: string }, [string]>(
        `SELECT i.id FROM items i JOIN lists l ON l.id = i.list_id
         WHERE i.org_id = ? AND l.code = 'AA2' AND i.text = 'Fórmula'`,
      )
      .get(w.orgId)!
    expect(imported.text).toBe(`Ver [[${target.id}]]`)
  })

  test('un archivo sin código (anterior a 0012) se importa y las listas reciben uno', async () => {
    const w = await world()
    const l = w.list('Economía')
    w.item(l.id, 'a')
    const deps = { ...w.deps, files: fileStore(config.filesDir) }
    const file = await exportOrg(deps, w.caller, { orgId: w.orgId })
    const legacy = JSON.parse(JSON.stringify(file))
    for (const list of legacy.lists) delete list.code
    await importOrg(deps, w.caller, { orgId: w.orgId, payload: legacy })
    expect(
      w.db
        .query<{ code: string }, [string]>(
          'SELECT code FROM lists WHERE org_id = ? ORDER BY code',
        )
        .all(w.orgId)
        .map((r) => r.code),
    ).toEqual(['ECO', 'ECO2'])
  })
})
