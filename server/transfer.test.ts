import { describe, expect, test } from 'bun:test'
import { fileStore } from './files'
import { uploadAttachment } from './services/attachments'
import {
  createItem,
  deleteItem,
  getItem,
  listBacklinks,
  listItems,
  restoreItem,
  setItemDone,
} from './services/items'
import { createList, deleteList, listLists } from './services/lists'
import type { ExportFile } from './services/transfer-format'
import { MAX_EXPORT_ATTACHMENT_BYTES } from '../shared/limits'
import { config, alice, bob, loginAs, setupServer } from './testing'

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44,
  0x52,
])
const NOTES = new TextEncoder().encode('notas de la reunión')

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
  const deps = { db: ctx.db, bus: ctx.bus }
  const files = fileStore(config.filesDir)
  const callerA = { userId: a.userId, ingress: 'public' as const }
  const callerB = { userId: b.userId, ingress: 'public' as const }

  const exportOf = (
    org: string,
    opts: { cookie?: string | null; query?: string } = {},
  ) => {
    const cookie = opts.cookie === undefined ? a.cookie : opts.cookie
    return ctx.apps.public.handle(
      new Request(`https://checklist.test/export/${org}${opts.query ?? ''}`, {
        headers: cookie ? { cookie } : {},
      }),
    )
  }
  const importTo = (
    org: string,
    body: string,
    opts: { cookie?: string | null; origin?: string } = {},
  ) => {
    const cookie = opts.cookie === undefined ? b.cookie : opts.cookie
    return ctx.apps.public.handle(
      new Request(`https://checklist.test/import/${org}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(cookie ? { cookie } : {}),
          ...(opts.origin ? { origin: opts.origin } : {}),
        },
        body,
      }),
    )
  }
  const exported = async (org: string, cookie?: string) =>
    (await (await exportOf(org, { cookie })).json()) as ExportFile
  return {
    ...ctx,
    a,
    b,
    orgA,
    orgB,
    deps,
    files,
    callerA,
    callerB,
    exportOf,
    importTo,
    exported,
  }
}

type World = Awaited<ReturnType<typeof world>>

/** Una org con de todo: subitems, orden intercalado, estado, borrados, Markdown, menciones y adjuntos. */
async function seed(w: World) {
  const { deps, callerA: c, orgA: orgId } = w
  const img = await uploadAttachment(
    { db: w.db, files: w.files },
    c,
    { orgId, name: 'captura.png', bytes: PNG },
    1_000,
  )
  const doc = await uploadAttachment(
    { db: w.db, files: w.files },
    c,
    { orgId, name: 'notas.txt', bytes: NOTES },
    1_001,
  )
  const compras = createList(
    deps,
    c,
    { orgId, name: 'Compras', afterId: null },
    2_000,
  )
  const trabajo = createList(
    deps,
    c,
    { orgId, name: 'Trabajo', afterId: compras.id },
    2_001,
  )
  const vieja = createList(
    deps,
    c,
    { orgId, name: 'Vieja', afterId: trabajo.id },
    2_002,
  )
  const item = (
    listId: string,
    text: string,
    extra: { parentId?: string; afterId?: string } = {},
    at = 3_000,
  ) =>
    createItem(
      deps,
      c,
      {
        orgId,
        listId,
        parentId: extra.parentId ?? null,
        afterId: extra.afterId ?? null,
        text,
      },
      at,
    )
  const leche = item(compras.id, '**Leche** entera', {}, 3_000)
  const descremada = item(
    compras.id,
    'descremada',
    { parentId: leche.id },
    3_001,
  )
  const pan = item(compras.id, 'Pan', { afterId: leche.id }, 3_002)
  // Se inserta entre dos vecinos: el orden fraccional tiene que sobrevivir.
  const queso = item(compras.id, 'Queso', { afterId: leche.id }, 3_003)
  const informe = item(
    trabajo.id,
    `Informe: ver [[${pan.id}]] y [el queso](item:${queso.id})\n\n![captura](attachment:${img.id}) [notas](attachment:${doc.id})`,
    {},
    3_004,
  )
  const vuelta = item(
    compras.id,
    `Comprar de nuevo, como en [[${informe.id}]]`,
    { parentId: pan.id },
    3_005,
  )
  const tachado = item(
    trabajo.id,
    'Hecho y borrado',
    { afterId: informe.id },
    3_006,
  )
  const hijo = item(
    trabajo.id,
    'sub de tachado',
    { parentId: tachado.id },
    3_007,
  )
  item(vieja.id, 'dentro de lista borrada', {}, 3_008)
  setItemDone(deps, c, { orgId, id: pan.id, done: true }, 4_000)
  setItemDone(deps, c, { orgId, id: tachado.id, done: true }, 4_001)
  deleteItem(deps, c, { orgId, id: tachado.id }, 5_000)
  deleteList(deps, c, { orgId, id: vieja.id }, 5_001)
  return {
    img,
    doc,
    compras,
    trabajo,
    vieja,
    leche,
    descremada,
    pan,
    queso,
    informe,
    vuelta,
    tachado,
    hijo,
  }
}

/** Mismo contenido salvo los ids: cada id se cambia por su lugar en el archivo. */
function canonical(file: ExportFile): unknown {
  const ids = new Map<string, string>()
  file.lists.forEach((l, li) => {
    ids.set(l.id, `L${li}`)
    l.items.forEach((i, ii) => ids.set(i.id, `L${li}I${ii}`))
  })
  file.attachments.forEach((a, ai) => ids.set(a.id, `A${ai}`))
  let json = JSON.stringify({ ...file, exportedAt: '', app: {}, org: {} })
  for (const [id, token] of ids) json = json.replaceAll(id, token)
  return JSON.parse(json)
}

describe('round-trip', () => {
  test('exportar, importar en una org vacía y volver a exportar da lo mismo', async () => {
    const w = await world()
    await seed(w)
    const original = await w.exported(w.orgA)
    expect(original.schema).toBe(1)
    expect(original.format).toBe('mychecklist')

    const res = await w.importTo(w.orgB, JSON.stringify(original))
    expect(res.status).toBe(201)
    const { result } = (await res.json()) as { result: any }
    expect(result).toEqual({
      lists: 3,
      items: 9,
      attachments: 2,
      skippedAttachments: 0,
      unmatchedRefs: 0,
    })

    const copy = await w.exported(w.orgB, w.b.cookie)
    expect(canonical(copy)).toEqual(canonical(original))

    // Ningún id se reutiliza entre las dos orgs.
    const ids = (f: ExportFile) => [
      ...f.lists.flatMap((l) => [l.id, ...l.items.map((i) => i.id)]),
      ...f.attachments.map((x) => x.id),
    ]
    const old = new Set(ids(original))
    expect(ids(copy).some((id) => old.has(id))).toBe(false)
  })

  test('el orden, el estado y las menciones se leen igual por la API', async () => {
    const w = await world()
    const s = await seed(w)
    const res = await w.importTo(
      w.orgB,
      JSON.stringify(await w.exported(w.orgA)),
    )
    expect(res.status).toBe(201)

    const listsA = listLists(w.deps, w.callerA, w.orgA)
    const listsB = listLists(w.deps, w.callerB, w.orgB)
    expect(listsB.map((l) => [l.name, l.open, l.total])).toEqual(
      listsA.map((l) => [l.name, l.open, l.total]),
    )
    const itemsOf = (org: string, caller: typeof w.callerA, list: string) =>
      listItems(w.deps, caller, org, list)
    const compras = itemsOf(w.orgA, w.callerA, s.compras.id)
    const comprasB = itemsOf(w.orgB, w.callerB, listsB[0]!.id)
    const shape = (rows: typeof compras, all: typeof compras) =>
      rows.map((r) => [
        r.text.replace(/[0-9A-Z]{26}/g, 'ID'),
        r.doneAt,
        r.parentId ? all.findIndex((x) => x.id === r.parentId) : -1,
        r.mentions.map((m) => m.title),
      ])
    expect(shape(comprasB, comprasB)).toEqual(shape(compras, compras))

    // Los backlinks salen del índice reconstruido: "Pan" lo menciona el informe de Trabajo.
    const panB = comprasB.find((i) => i.text === 'Pan')!
    expect(
      listBacklinks(w.deps, w.callerB, w.orgB, panB.id).map((m) => m.title),
    ).toEqual(
      listBacklinks(w.deps, w.callerA, w.orgA, s.pan.id).map((m) => m.title),
    )
    const informeB = itemsOf(w.orgB, w.callerB, listsB[1]!.id)[0]!
    expect(informeB.text).toContain(`[[${panB.id}]]`)
    expect(informeB.text).not.toContain(s.pan.id)
  })

  test('lo que está en código se conserva literal, aunque lleve un id', async () => {
    const w = await world()
    const s = await seed(w)
    const literal = `Ejemplo: \`[[${s.pan.id}]]\` y \`attachment:${s.img.id}\``
    createItem(w.deps, w.callerA, {
      orgId: w.orgA,
      listId: s.trabajo.id,
      parentId: null,
      afterId: null,
      text: literal,
    })
    await w.importTo(w.orgB, JSON.stringify(await w.exported(w.orgA)))
    const copy = await w.exported(w.orgB, w.b.cookie)
    expect(copy.lists[1]!.items.map((i) => i.text)).toContain(literal)
  })

  test('el borrado lógico viaja: lo borrado se puede restaurar después de importar', async () => {
    const w = await world()
    await seed(w)
    await w.importTo(w.orgB, JSON.stringify(await w.exported(w.orgA)))
    const copy = await w.exported(w.orgB, w.b.cookie)
    const trabajo = copy.lists[1]!
    const tachado = trabajo.items.find((i) => i.text === 'Hecho y borrado')!
    const hijo = trabajo.items.find((i) => i.text === 'sub de tachado')!
    expect(tachado.deletedAt).toBe(hijo.deletedAt)
    expect(getItem(w.deps, w.callerB, w.orgB, tachado.id)).toBeNull()

    const back = restoreItem(w.deps, w.callerB, {
      orgId: w.orgB,
      id: tachado.id,
    })
    expect(back.doneAt).not.toBeNull()
    expect(getItem(w.deps, w.callerB, w.orgB, hijo.id)?.text).toBe(
      'sub de tachado',
    )
  })

  test('los adjuntos llegan con su contenido y el mime se vuelve a reconocer', async () => {
    const w = await world()
    await seed(w)
    const file = await w.exported(w.orgA)
    // Un archivo que miente: dice ser imagen pero sus bytes son texto.
    const lying = structuredClone(file)
    const doc = lying.attachments.find((a) => a.name === 'notas.txt')!
    doc.mime = 'image/png'
    await w.importTo(w.orgB, JSON.stringify(lying))
    const copy = await w.exported(w.orgB, w.b.cookie)
    const byName = (f: ExportFile, n: string) =>
      f.attachments.find((a) => a.name === n)!
    expect(byName(copy, 'captura.png')).toMatchObject({
      mime: 'image/png',
      data: byName(file, 'captura.png').data,
    })
    expect(byName(copy, 'notas.txt').mime).toBe('application/octet-stream')

    const att = copy.attachments.find((a) => a.name === 'captura.png')!
    const got = await w.apps.public.handle(
      new Request(`https://checklist.test/files/${w.orgB}/${att.id}`, {
        headers: { cookie: w.b.cookie },
      }),
    )
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(PNG)
  })

  test('importar dos veces agrega: las listas nuevas van al final y no se pisa nada', async () => {
    const w = await world()
    await seed(w)
    const file = JSON.stringify(await w.exported(w.orgA))
    expect((await w.importTo(w.orgB, file)).status).toBe(201)
    expect((await w.importTo(w.orgB, file)).status).toBe(201)
    const lists = listLists(w.deps, w.callerB, w.orgB)
    expect(lists.map((l) => l.name)).toEqual([
      'Compras',
      'Trabajo',
      'Compras',
      'Trabajo',
    ])
    // Los adjuntos son por contenido: el segundo import reutiliza los de la org.
    expect(
      w.db
        .query('SELECT COUNT(*) AS n FROM attachments WHERE org_id = ?')
        .get(w.orgB),
    ).toEqual({ n: 2 })
    const copy = await w.exported(w.orgB, w.b.cookie)
    const informes = copy.lists
      .flatMap((l) => l.items)
      .filter((i) => i.text.startsWith('Informe'))
    expect(informes).toHaveLength(2)
    // Cada copia menciona al "Pan" de su propio juego de listas.
    const panes = copy.lists
      .flatMap((l) => l.items)
      .filter((i) => i.text === 'Pan')
      .map((i) => i.id)
    expect(panes).toHaveLength(2)
    informes.forEach((inf, n) => expect(inf.text).toContain(`[[${panes[n]}]]`))
  })

  test('sin adjuntos: el export lleva los registros y el import los descarta', async () => {
    const w = await world()
    await seed(w)
    const res = await w.exportOf(w.orgA, { query: '?attachments=0' })
    expect(res.status).toBe(200)
    const file = (await res.json()) as ExportFile
    expect(file.attachments).toHaveLength(2)
    expect(file.attachments.every((a) => a.data === null)).toBe(true)
    const imp = await w.importTo(w.orgB, JSON.stringify(file))
    expect(((await imp.json()) as any).result).toMatchObject({
      attachments: 0,
      skippedAttachments: 2,
    })
  })

  test('exportar dice el nombre del archivo y no se guarda en caché', async () => {
    const w = await world()
    const res = await w.exportOf(w.orgA)
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="mychecklist-[\w-]+-\d{4}-\d{2}-\d{2}\.json"/,
    )
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  test('la actividad registra el export y el import, no sus contenidos', async () => {
    const w = await world()
    await seed(w)
    await w.exportOf(w.orgA)
    await w.importTo(w.orgB, JSON.stringify(await w.exported(w.orgA)))
    const types = (org: string) =>
      w.db
        .query<{ type: string; via: string }, [string]>(
          "SELECT type, via FROM activity WHERE org_id = ? AND type IN ('org.exported', 'org.imported') ORDER BY id",
        )
        .all(org)
    expect(types(w.orgA).map((r) => r.type)).toEqual([
      'org.exported',
      'org.exported',
    ])
    expect(types(w.orgB)).toEqual([{ type: 'org.imported', via: 'import' }])
  })
})

describe('acceso', () => {
  test('sin sesión no se exporta ni se importa', async () => {
    const w = await world()
    expect((await w.exportOf(w.orgA, { cookie: null })).status).toBe(401)
    expect((await w.importTo(w.orgA, '{}', { cookie: null })).status).toBe(401)
  })

  test('otra persona no ve ni toca la org', async () => {
    const w = await world()
    await seed(w)
    expect((await w.exportOf(w.orgA, { cookie: w.b.cookie })).status).toBe(403)
    const file = JSON.stringify(await w.exported(w.orgA))
    expect((await w.importTo(w.orgA, file)).status).toBe(403)
    expect(listLists(w.deps, w.callerA, w.orgA)).toHaveLength(2)
  })

  test('un import con Origin de otro sitio no entra', async () => {
    const w = await world()
    const res = await w.importTo(w.orgB, '{}', { origin: 'https://evil.test' })
    expect(res.status).toBe(403)
  })

  test('una org team no se importa por la puerta pública', async () => {
    const w = await world()
    w.db.run(
      "INSERT INTO orgs (id, kind, name, created_at) VALUES ('TEAM', 'team', 'Equipo', 1)",
    )
    w.db.run(
      `INSERT INTO org_members (org_id, user_id, role, created_at) VALUES ('TEAM', '${w.b.userId}', 'owner', 1)`,
    )
    expect((await w.importTo('TEAM', '{}')).status).toBe(403)
    expect((await w.exportOf('TEAM', { cookie: w.b.cookie })).status).toBe(403)
  })
})

describe('validación', () => {
  const post = async (w: World, body: unknown) => {
    const res = await w.importTo(
      w.orgB,
      typeof body === 'string' ? body : JSON.stringify(body),
    )
    return { status: res.status, body: (await res.json()) as any }
  }
  const empty = async (w: World) => {
    expect(listLists(w.deps, w.callerB, w.orgB)).toHaveLength(0)
    expect(
      w.db
        .query('SELECT COUNT(*) AS n FROM items WHERE org_id = ?')
        .get(w.orgB),
    ).toEqual({ n: 0 })
  }

  test('no es JSON, no es nuestro formato o es de un esquema más nuevo', async () => {
    const w = await world()
    expect((await post(w, 'no es json')).status).toBe(400)
    expect(
      (await post(w, { format: 'otro', schema: 1 })).body.error.message,
    ).toContain('format')
    const file = await w.exported(w.orgA)
    const newer = await post(w, { ...file, schema: 2 })
    expect(newer.status).toBe(400)
    expect(newer.body.error.message).toContain('esquema 2')
    expect((await post(w, { ...file, schema: 0 })).status).toBe(400)
    await empty(w)
  })

  test('el esquema 1 ignora campos desconocidos', async () => {
    const w = await world()
    await seed(w)
    const file: any = await w.exported(w.orgA)
    file.futuro = { x: 1 }
    file.lists[0].color = 'rojo'
    file.lists[0].items[0].etiquetas = ['a']
    expect((await post(w, file)).status).toBe(201)
  })

  test('estructura rota: nada entra y el error dice dónde', async () => {
    const w = await world()
    await seed(w)
    const good = await w.exported(w.orgA)
    const broken = (fn: (f: any) => void) => {
      const f = structuredClone(good) as any
      fn(f)
      return f
    }
    const cases: [string, (f: any) => void, string][] = [
      ['id mal formado', (f) => (f.lists[0].id = 'abc'), 'lists[0].id'],
      [
        'id repetido',
        (f) => (f.lists[1].items[0].id = f.lists[0].id),
        'repite un id',
      ],
      [
        'clave de orden',
        (f) => (f.lists[0].position = 'a0'),
        'lists[0].position',
      ],
      ['fecha', (f) => (f.lists[0].createdAt = -1), 'createdAt'],
      [
        'texto vacío',
        (f) => (f.lists[0].items[0].text = '  '),
        'items[0].text',
      ],
      [
        'nombre largo',
        (f) => (f.lists[0].name = 'x'.repeat(81)),
        'lists[0].name',
      ],
      [
        'padre de otra lista',
        (f) => (f.lists[1].items[0].parentId = f.lists[0].items[0].id),
        'parentId',
      ],
      [
        'subitem de un subitem',
        (f) => {
          const [padre, hijo] = f.lists[0].items
          f.lists[0].items.push({
            ...hijo,
            id: '01JC8Q2V3N4M5P6R7S8T9VWXYZ',
            parentId: hijo.id,
          })
          void padre
        },
        'parentId',
      ],
      ['lista no es lista', (f) => (f.lists = {}), 'lists'],
      ['sha256', (f) => (f.attachments[0].sha256 = 'zz'), 'sha256'],
    ]
    for (const [name, fn, where] of cases) {
      const res = await post(w, broken(fn))
      expect([name, res.status]).toEqual([name, 400])
      expect([name, res.body.error.message]).toEqual([
        name,
        expect.stringContaining(where),
      ])
    }
    await empty(w)
  })

  test('un adjunto cuyo contenido no coincide con su sha256 se rechaza entero', async () => {
    const w = await world()
    await seed(w)
    const file: any = await w.exported(w.orgA)
    file.attachments[0].data = Buffer.from('otra cosa').toString('base64')
    const res = await post(w, file)
    expect(res.status).toBe(400)
    expect(res.body.error.message).toContain('sha256')
    await empty(w)
    expect(
      w.db
        .query('SELECT COUNT(*) AS n FROM attachments WHERE org_id = ?')
        .get(w.orgB),
    ).toEqual({ n: 0 })
  })

  test('los topes por org valen igual que a mano y no entra nada a medias', async () => {
    const w = await world()
    const list = (n: number) => ({
      id: `01JD${String(n).padStart(21, '0')}A`.slice(0, 26),
      name: `L${n}`,
      position: 'a',
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
      items: [],
    })
    const lists = Array.from({ length: 201 }, (_, n) => list(n))
    const res = await post(w, {
      format: 'mychecklist',
      schema: 1,
      lists,
      attachments: [],
    })
    expect(res.status).toBe(413)
    expect(res.body.error.code).toBe('LIMIT_REACHED')
    await empty(w)
  })

  test('el export pide ir sin adjuntos pasado el tope', async () => {
    const w = await world()
    await seed(w)
    w.db.run(
      `UPDATE attachments SET size = ${MAX_EXPORT_ATTACHMENT_BYTES} WHERE org_id = '${w.orgA}'`,
    )
    const res = await w.exportOf(w.orgA)
    expect(res.status).toBe(413)
    expect(((await res.json()) as any).error.message).toContain('sin adjuntos')
    expect((await w.exportOf(w.orgA, { query: '?attachments=0' })).status).toBe(
      200,
    )
  })
})
