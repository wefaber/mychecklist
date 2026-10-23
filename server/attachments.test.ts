import { describe, expect, test } from 'bun:test'
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ORG_ATTACHMENT_BYTES,
  sniffImage,
} from './services/attachments'
import { alice, bob, loginAs, setupServer } from './testing'

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44,
  0x52,
])
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46])
const GIF = new TextEncoder().encode('GIF89a\x01\x00\x01\x00')
const WEBP = new TextEncoder().encode('RIFF\x24\x00\x00\x00WEBPVP8 ')

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
  const upload = (
    org: string,
    body: Uint8Array | string,
    opts: {
      cookie?: string | null
      name?: string
      type?: string
      origin?: string
      ingress?: 'public' | 'tailnet'
    } = {},
  ) => {
    const cookie = opts.cookie === undefined ? a.cookie : opts.cookie
    return ctx.apps[opts.ingress ?? 'public'].handle(
      new Request(`https://checklist.test/files/${org}`, {
        method: 'POST',
        headers: {
          'content-type': opts.type ?? 'application/octet-stream',
          ...(opts.name
            ? { 'x-file-name': encodeURIComponent(opts.name) }
            : {}),
          ...(cookie ? { cookie } : {}),
          ...(opts.origin ? { origin: opts.origin } : {}),
        },
        body: body as BodyInit,
      }),
    )
  }
  const download = (
    org: string,
    id: string,
    opts: { cookie?: string | null; headers?: Record<string, string> } = {},
  ) => {
    const cookie = opts.cookie === undefined ? a.cookie : opts.cookie
    return ctx.apps.public.handle(
      new Request(`https://checklist.test/files/${org}/${id}`, {
        headers: { ...(cookie ? { cookie } : {}), ...opts.headers },
      }),
    )
  }
  const uploaded = async (res: Response) =>
    ((await res.json()) as { attachment: any }).attachment
  return { ...ctx, a, b, orgA, orgB, upload, download, uploaded }
}

describe('sniffImage', () => {
  test('reconoce PNG, JPEG, GIF y WebP por los primeros bytes', () => {
    expect(sniffImage(PNG)).toBe('image/png')
    expect(sniffImage(JPEG)).toBe('image/jpeg')
    expect(sniffImage(GIF)).toBe('image/gif')
    expect(sniffImage(WEBP)).toBe('image/webp')
  })

  test('nada más es imagen: ni SVG, ni texto, ni vacío', () => {
    for (const bytes of [
      new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      new TextEncoder().encode('hola'),
      new Uint8Array(0),
      Uint8Array.from([0x52, 0x49, 0x46, 0x46]), // RIFF corto
    ])
      expect(sniffImage(bytes)).toBeNull()
  })
})

describe('adjuntos', () => {
  test('subir una imagen y bajarla en línea con headers seguros', async () => {
    const w = await world()
    const res = await w.upload(w.orgA, PNG, {
      name: 'captura de pantalla.png',
      type: 'image/png',
    })
    expect(res.status).toBe(201)
    const att = await w.uploaded(res)
    expect(att).toMatchObject({
      orgId: w.orgA,
      name: 'captura de pantalla.png',
      mime: 'image/png',
      size: PNG.byteLength,
      image: true,
    })

    const got = await w.download(w.orgA, att.id)
    expect(got.status).toBe(200)
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(PNG)
    expect(got.headers.get('content-type')).toBe('image/png')
    expect(got.headers.get('content-disposition')).toStartWith('inline;')
    expect(got.headers.get('x-content-type-options')).toBe('nosniff')
    expect(got.headers.get('content-security-policy')).toContain('sandbox')
    expect(got.headers.get('cache-control')).toContain('private')

    const again = await w.download(w.orgA, att.id, {
      headers: { 'if-none-match': got.headers.get('etag')! },
    })
    expect(again.status).toBe(304)
  })

  test('lo que se hace pasar por imagen se descarga, no se muestra', async () => {
    const w = await world()
    for (const [name, body] of [
      ['falsa.png', 'esto es texto'],
      [
        'dibujo.svg',
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      ],
      ['pagina.html', '<script>alert(1)</script>'],
    ] as const) {
      const res = await w.upload(w.orgA, body, { name, type: 'image/png' })
      expect(res.status).toBe(201)
      const att = await w.uploaded(res)
      expect(att).toMatchObject({
        mime: 'application/octet-stream',
        image: false,
      })
      const got = await w.download(w.orgA, att.id)
      expect(got.headers.get('content-type')).toBe('application/octet-stream')
      expect(got.headers.get('content-disposition')).toStartWith('attachment;')
      expect(got.headers.get('x-content-type-options')).toBe('nosniff')
    }
  })

  test('el nombre pierde carpetas y caracteres de control, y se acota', async () => {
    const w = await world()
    const named = async (name: string) =>
      (await w.uploaded(await w.upload(w.orgA, `x${name.length}`, { name })))
        .name
    expect(await named('C:\\Users\\faku\\informe.pdf')).toBe('informe.pdf')
    expect(await named('../../etc/passwd')).toBe('passwd')
    expect(await named('a\u0000b\nc.txt')).toBe('abc.txt')
    expect(await named('')).toBe('archivo')
    expect((await named('n'.repeat(500))).length).toBe(120)
  })

  test('el nombre con acentos y comillas sale bien en Content-Disposition', async () => {
    const w = await world()
    const att = await w.uploaded(
      await w.upload(w.orgA, 'hola', { name: 'año "nuevo".txt' }),
    )
    const got = await w.download(w.orgA, att.id)
    const disposition = got.headers.get('content-disposition')!
    expect(disposition).toContain(`filename*=UTF-8''a%C3%B1o%20%22nuevo%22.txt`)
    expect(disposition).not.toMatch(/filename="[^"]*"[^;]*"/)
  })

  test('el mismo contenido en la misma org es un solo adjunto', async () => {
    const w = await world()
    const one = await w.uploaded(await w.upload(w.orgA, PNG, { name: 'a.png' }))
    const two = await w.uploaded(await w.upload(w.orgA, PNG, { name: 'b.png' }))
    expect(two.id).toBe(one.id)
    expect(w.db.query('SELECT COUNT(*) AS n FROM attachments').get()).toEqual({
      n: 1,
    })
    expect(
      w.db
        .query(
          "SELECT COUNT(*) AS n FROM activity WHERE type = 'attachment.uploaded'",
        )
        .get(),
    ).toEqual({ n: 1 })
  })

  test('el contenido se guarda por sha256 en disco', async () => {
    const w = await world()
    const att = await w.uploaded(await w.upload(w.orgA, JPEG))
    const sha = new Bun.CryptoHasher('sha256').update(JPEG).digest('hex')
    const row = w.db
      .query<{ sha256: string }, [string]>(
        'SELECT sha256 FROM attachments WHERE id = ?',
      )
      .get(att.id)!
    expect(row.sha256).toBe(sha)
    const { config } = await import('./testing')
    expect(
      await Bun.file(`${config.filesDir}/${sha.slice(0, 2)}/${sha}`).exists(),
    ).toBe(true)
  })

  test('vacío, demasiado grande y sin sesión', async () => {
    const w = await world()
    expect((await w.upload(w.orgA, new Uint8Array(0))).status).toBe(400)
    const big = new Uint8Array(MAX_ATTACHMENT_BYTES + 1)
    expect((await w.upload(w.orgA, big)).status).toBe(413)
    expect((await w.upload(w.orgA, PNG, { cookie: null })).status).toBe(401)
    expect((await w.download(w.orgA, 'nada', { cookie: null })).status).toBe(
      401,
    )
  })

  test('el tope de la org se respeta', async () => {
    const w = await world()
    w.db
      .query(
        "INSERT INTO attachments (id, org_id, sha256, name, mime, size, created_at) VALUES ('lleno', ?, 'x', 'lleno', 'application/octet-stream', ?, 1)",
      )
      .run(w.orgA, MAX_ORG_ATTACHMENT_BYTES - 1)
    expect((await w.upload(w.orgA, 'dos')).status).toBe(413)
    expect((await w.upload(w.orgA, 'u')).status).toBe(201)
  })

  test('un origen ajeno no puede subir', async () => {
    const w = await world()
    const res = await w.upload(w.orgA, PNG, { origin: 'https://evil.example' })
    expect(res.status).toBe(403)
    const ok = await w.upload(w.orgA, PNG, { origin: 'https://checklist.test' })
    expect(ok.status).toBe(201)
  })

  test('otra persona no sube ni lee en una org que no es suya', async () => {
    const w = await world()
    const att = await w.uploaded(await w.upload(w.orgA, PNG))

    // Bob no sube a la org de Alice ni la lee, con su cookie.
    expect((await w.upload(w.orgA, 'x', { cookie: w.b.cookie })).status).toBe(
      403,
    )
    expect(
      (await w.download(w.orgA, att.id, { cookie: w.b.cookie })).status,
    ).toBe(403)
    // Y el id de un adjunto de Alice no existe en la org de Bob.
    expect(
      (await w.download(w.orgB, att.id, { cookie: w.b.cookie })).status,
    ).toBe(404)
    // Alice tampoco lo lee pidiéndolo por la org de Bob.
    expect((await w.download(w.orgB, att.id)).status).toBe(403)
  })

  test('una org team no se opera por el listener público', async () => {
    const w = await world()
    const team = 'team-org'
    w.db
      .query(
        "INSERT INTO orgs (id, kind, name, created_at) VALUES (?, 'team', 'equipo', 1)",
      )
      .run(team)
    w.db
      .query(
        "INSERT INTO org_members (org_id, user_id, role, created_at) VALUES (?, ?, 'owner', 1)",
      )
      .run(team, w.a.userId)
    expect((await w.upload(team, PNG)).status).toBe(403)
  })
})
