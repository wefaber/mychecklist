import { describe, expect, test } from 'bun:test'
import { signIdentity } from '@wefaber/codemode-mcp'
import { sha256Hex } from '../auth/crypto'
import { gatewayScopes } from './routes'
import { world } from './testing'

const SECRET = 'test-gateway-secret-0123456789abcdef'

type Call = {
  secret: string
  token: string
  scopes?: string[]
  code: string
  ingress?: 'public' | 'tailnet'
  timestamp?: number
  label?: string | null
  tamper?: boolean
}

/** Una llamada como la que reenvía el gateway: sin `Authorization`, con la identidad firmada del agente. */
async function viaGateway(w: Awaited<ReturnType<typeof world>>, opts: Call) {
  const headers = await signIdentity(opts.secret, {
    tokenHash: sha256Hex(opts.token),
    scopes: opts.scopes ?? ['checklist:write'],
    label: opts.label === undefined ? 'hermes' : opts.label,
    runId: 'run_gw_1',
    timestamp: opts.timestamp ?? Date.now(),
  })
  if (opts.tamper) headers['x-wcm-scopes'] = 'checklist:write,wegraph:admin'
  const res = await w.post(
    '/codemode/execute',
    null,
    { code: opts.code },
    opts.ingress ?? 'public',
    headers,
  )
  return { status: res.status, body: (await res.json()) as any }
}

const CREATE = `const l = await codemode.checklist.lists.create({ name: 'Desde el gateway' })
const i = await codemode.checklist.items.create({ listId: l.id, text: 'uno' })
return { list: l.name, item: i.text }`

describe('detrás del gateway (ADR 0013)', () => {
  test('una llamada con identidad firmada y un mck_ importado crea y lee en la org del token', async () => {
    const w = await world({ gatewaySecret: SECRET })
    const { secret } = w.token(w.a.userId, w.orgA, 'write')
    const out = await viaGateway(w, {
      secret: SECRET,
      token: secret,
      code: CREATE,
    })
    expect(out.status).toBe(200)
    expect(out.body.result).toEqual({ list: 'Desde el gateway', item: 'uno' })
    const read = await viaGateway(w, {
      secret: SECRET,
      token: secret,
      code: `return (await codemode.checklist.lists.list()).map((l) => l.name)`,
    })
    expect(read.body.result).toEqual(['Desde el gateway'])
    // La org y el usuario salen del token del producto: la otra persona no ve nada de esto.
    const other = w.token(w.b.userId, w.orgB, 'write')
    const theirs = await viaGateway(w, {
      secret: SECRET,
      token: other.secret,
      code: `return await codemode.checklist.lists.list()`,
    })
    expect(theirs.body.result).toEqual([])
  })

  test('los scopes del gateway recortan, no amplían: un token de lectura no escribe', async () => {
    const w = await world({ gatewaySecret: SECRET })
    const read = w.token(w.a.userId, w.orgA, 'read')
    // El gateway dice write, pero el token de MyChecklist es de lectura.
    const out = await viaGateway(w, {
      secret: SECRET,
      token: read.secret,
      scopes: ['checklist:write'],
      code: `return await codemode.checklist.lists.create({ name: 'x' })`,
    })
    expect(out.body.ok).toBe(false)

    // Y al revés: token de escritura, pero el gateway solo dio lectura.
    const write = w.token(w.a.userId, w.orgA, 'write')
    const limited = await viaGateway(w, {
      secret: SECRET,
      token: write.secret,
      scopes: ['checklist:read'],
      code: `return await codemode.checklist.lists.create({ name: 'x' })`,
    })
    expect(limited.body.ok).toBe(false)
    const listed = await viaGateway(w, {
      secret: SECRET,
      token: write.secret,
      scopes: ['checklist:read'],
      code: `return await codemode.checklist.lists.list()`,
    })
    expect(listed.body.result).toEqual([])
  })

  test('otra clave, firma tocada o vencida: 401; sin clave configurada: 401', async () => {
    const w = await world({ gatewaySecret: SECRET })
    const { secret } = w.token(w.a.userId, w.orgA, 'write')
    const call = (over: Partial<Call>) =>
      viaGateway(w, {
        secret: SECRET,
        token: secret,
        code: 'return 1',
        ...over,
      })
    expect(
      (await call({ secret: 'otra-clave-otra-clave-otra-clave-00' })).status,
    ).toBe(401)
    expect((await call({ tamper: true })).status).toBe(401)
    expect((await call({ timestamp: Date.now() - 120_000 })).status).toBe(401)
    expect((await call({})).status).toBe(200)

    const closed = await world()
    const t = closed.token(closed.a.userId, closed.orgA, 'write')
    expect(
      (
        await viaGateway(closed, {
          secret: SECRET,
          token: t.secret,
          code: 'return 1',
        })
      ).status,
    ).toBe(401)
  })

  test('un hash desconocido, revocado o de otra puerta no entra', async () => {
    const w = await world({ gatewaySecret: SECRET })
    const call = (token: string, ingress?: 'public' | 'tailnet') =>
      viaGateway(w, { secret: SECRET, token, code: 'return 1', ingress })
    expect((await call('mck_nunca-importado')).status).toBe(401)

    const { secret, token } = w.token(w.a.userId, w.orgA, 'write')
    expect((await call(secret)).status).toBe(200)
    w.db
      .query('UPDATE api_tokens SET revoked_at = ? WHERE id = ?')
      .run(Date.now(), token.id)
    expect((await call(secret)).status).toBe(401)

    // Un token de la tailnet no sirve en el listener público (ADR 0001), tampoco detrás del gateway.
    const tail = w.token(w.a.userId, w.orgA, 'write', 'tailnet')
    expect((await call(tail.secret, 'public')).status).toBe(401)
    expect((await call(tail.secret, 'tailnet')).status).toBe(200)
  })

  test('un scope de otro producto solo no alcanza', async () => {
    const w = await world({ gatewaySecret: SECRET })
    const { secret } = w.token(w.a.userId, w.orgA, 'write')
    const out = await viaGateway(w, {
      secret: SECRET,
      token: secret,
      scopes: ['wegraph:read'],
      code: 'return 1',
    })
    expect(out.status).toBe(403)
    expect(out.body.error.code).toBe('FORBIDDEN')
  })

  test('el token mck_ sigue entrando directo con la clave del gateway configurada', async () => {
    const w = await world({ gatewaySecret: SECRET })
    const { secret } = w.token(w.a.userId, w.orgA, 'write')
    const out = await w.exec(
      secret,
      'return await codemode.checklist.lists.list()',
    )
    expect(out.status).toBe(200)
  })

  test('un x-wcm-via falso, sin firma, no entra aunque traiga un mck_ válido', async () => {
    const w = await world({ gatewaySecret: SECRET })
    const { secret } = w.token(w.a.userId, w.orgA, 'write')
    const res = await w.post(
      '/codemode/execute',
      secret,
      { code: 'return 1' },
      'public',
      { 'x-wcm-via': 'gateway' },
    )
    expect(res.status).toBe(401)
  })

  test('la auditoría deja la corrida ligada al token del producto y al agente del gateway', async () => {
    const w = await world({ gatewaySecret: SECRET })
    const { secret, token } = w.token(w.a.userId, w.orgA, 'write')
    await viaGateway(w, {
      secret: SECRET,
      token: secret,
      code: 'return 1',
      label: 'hermes',
    })
    const row = w.db
      .query<{ token_id: string; agent_label: string }, []>(
        'SELECT token_id, agent_label FROM codemode_runs ORDER BY created_at DESC LIMIT 1',
      )
      .get()!
    expect(row).toEqual({ token_id: token.id, agent_label: 'hermes' })
  })
})

describe('gatewayScopes', () => {
  test('intersección entre el modo del token y lo que el gateway otorga', () => {
    expect(gatewayScopes('write', ['checklist:write'])).toEqual([
      'checklist:write',
    ])
    expect(gatewayScopes('write', ['checklist:read'])).toEqual([
      'checklist:read',
    ])
    expect(gatewayScopes('read', ['checklist:write'])).toEqual([
      'checklist:read',
    ])
    expect(gatewayScopes('read', ['checklist:read', 'wegraph:write'])).toEqual([
      'checklist:read',
    ])
    expect(gatewayScopes('write', ['wegraph:read'])).toEqual([])
    expect(gatewayScopes('write', [])).toEqual([])
  })
})
