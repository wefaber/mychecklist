import { describe, expect, test } from 'bun:test'
import { createTeamOrg, expireToken, removeMember } from './db/testing'
import { world } from './mcp/testing'
import { revokeToken } from './services/tokens'
import { alice, bob, loginAs } from './testing'

describe('Code Mode: autenticación y alcance del token', () => {
  test('sin token, con un token inventado o mal formado: 401', async () => {
    const w = await world()
    for (const secret of [null, 'mck_inventado', 'sin-prefijo', 'Bearer x']) {
      const res = await w.post('/codemode/execute', secret, {
        code: 'return 1',
      })
      expect(res.status).toBe(401)
      expect(res.headers.get('www-authenticate')).toBe('Bearer')
    }
    const malformed = await w.post(
      '/codemode/execute',
      null,
      { code: 'return 1' },
      'public',
      { authorization: 'Basic abc' },
    )
    expect(malformed.status).toBe(401)
  })

  test('la cookie de sesión no sirve en /codemode ni el Bearer en /graphql', async () => {
    const w = await world()
    const viaCookie = await w.post(
      '/codemode/execute',
      null,
      { code: 'return 1' },
      'public',
      { cookie: w.a.cookie },
    )
    expect(viaCookie.status).toBe(401)
    const { secret } = w.token(w.a.userId, w.orgA)
    const res = await w.apps.public.handle(
      new Request('https://checklist.test/graphql', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify({ query: '{ me { id } }' }),
      }),
    )
    expect(((await res.json()) as any).data.me).toBeNull()
  })

  test('un token solo vale en la puerta donde se emitió', async () => {
    const w = await world()
    const pub = w.token(w.a.userId, w.orgA, 'write', 'public').secret
    const tail = w.token(w.a.userId, w.orgA, 'write', 'tailnet').secret
    expect((await w.exec(pub, 'return 1', 'execute', 'public')).status).toBe(
      200,
    )
    expect((await w.exec(pub, 'return 1', 'execute', 'tailnet')).status).toBe(
      401,
    )
    expect((await w.exec(tail, 'return 1', 'execute', 'tailnet')).status).toBe(
      200,
    )
    expect((await w.exec(tail, 'return 1', 'execute', 'public')).status).toBe(
      401,
    )
  })

  test('un token revocado o vencido deja de servir', async () => {
    const w = await world()
    const revoked = w.token(w.a.userId, w.orgA)
    const expired = w.token(w.a.userId, w.orgA)
    expect((await w.exec(revoked.secret, 'return 1')).status).toBe(200)
    revokeToken(
      w.db,
      { userId: w.a.userId, ingress: 'public' },
      { orgId: w.orgA, id: revoked.token.id },
    )
    expect((await w.exec(revoked.secret, 'return 1')).status).toBe(401)
    expireToken(w.db, expired.token.id, Date.now() - 1)
    expect((await w.exec(expired.secret, 'return 1')).status).toBe(401)
  })

  test('el secreto no queda en la base: solo su sha256 y los últimos 4 caracteres', async () => {
    const w = await world()
    const { secret, token } = w.token(w.a.userId, w.orgA)
    expect(secret).toMatch(/^mck_[A-Za-z0-9_-]{43}$/)
    expect(token.hint).toBe(secret.slice(-4))
    const rows = w.db.query('SELECT * FROM api_tokens').all()
    expect(JSON.stringify(rows)).not.toContain(secret)
    const row = rows[0] as { token_sha256: string }
    expect(row.token_sha256).toBe(
      new Bun.CryptoHasher('sha256').update(secret).digest('hex'),
    )
  })

  test('usar el token anota last_used_at', async () => {
    const w = await world()
    const { secret, token } = w.token(w.a.userId, w.orgA)
    expect(token.lastUsedAt).toBeNull()
    await w.exec(secret, 'return 1')
    const used = w.db
      .query<{ last_used_at: number | null }, [string]>(
        'SELECT last_used_at FROM api_tokens WHERE id = ?',
      )
      .get(token.id)!.last_used_at
    expect(used).toBeGreaterThan(0)
  })

  test('un Origin de otro sitio no entra; el propio sí', async () => {
    const w = await world()
    const { secret } = w.token(w.a.userId, w.orgA)
    const foreign = await w.post(
      '/codemode/execute',
      secret,
      { code: 'return 1' },
      'public',
      { origin: 'https://evil.example' },
    )
    expect(foreign.status).toBe(403)
    const mcp = await w.post('/mcp', secret, {}, 'public', {
      origin: 'https://evil.example',
    })
    expect(mcp.status).toBe(403)
    const own = await w.post(
      '/codemode/execute',
      secret,
      { code: 'return 1' },
      'public',
      { origin: 'https://checklist.test' },
    )
    expect(own.status).toBe(200)
  })

  test('si el usuario sale de la org, el token deja de alcanzarla sin tocarlo', async () => {
    const w = await world()
    const tail = await loginAs(w.db, alice, 'tailnet')
    const team = createTeamOrg(w.db, 'equipo', [
      { userId: tail.userId, role: 'owner' },
    ])
    const { secret } = w.token(tail.userId, team, 'write', 'tailnet')
    const before = await w.exec(
      secret,
      `return (await checklist.org.get()).name`,
      'execute',
      'tailnet',
    )
    expect(before.body.result).toBe('equipo')
    removeMember(w.db, team, tail.userId)
    const after = await w.exec(
      secret,
      `return await checklist.lists.list()`,
      'execute',
      'tailnet',
    )
    expect(after.body.ok).toBe(false)
    expect(after.body.error.message).toContain('FORBIDDEN')
  })

  test('search devuelve la API como datos y el modo read no ve las operaciones de escritura', async () => {
    const w = await world()
    const write = w.token(w.a.userId, w.orgA, 'write').secret
    const read = w.token(w.a.userId, w.orgA, 'read').secret
    const code = `return spec.ops.filter((o) => o.name.startsWith('items.')).map((o) => [o.name, o.mode])`
    const all = (await w.exec(write, code, 'search')).body.result as string[][]
    expect(all.map((o) => o[0])).toContain('items.create')
    const onlyRead = (await w.exec(read, code, 'search')).body
      .result as string[][]
    expect(onlyRead.length).toBeGreaterThan(0)
    expect(onlyRead.every((o) => o[1] === 'read')).toBe(true)
    // El esquema de entrada viaja con la operación, y los tipos con nombre aparte.
    const shape = await w.exec(
      write,
      `const op = spec.ops.find((o) => o.name === 'items.create'); return [Object.keys(op.input.properties), op.output, Object.keys(spec.types)]`,
      'search',
    )
    expect(shape.body.result[0].sort()).toEqual([
      'afterId',
      'listId',
      'parentId',
      'text',
    ])
    expect(shape.body.result[1]).toEqual({ $ref: 'Item' })
    expect(shape.body.result[2]).toContain('Item')
  })
})

describe('tokens por GraphQL', () => {
  const CREATE = `mutation($o: ID!, $n: String!, $m: TokenMode!, $e: TokenExpiry) {
    createApiToken(orgId: $o, name: $n, mode: $m, expiry: $e) { secret token { id name mode hint expiresAt revokedAt } }
  }`
  const REVOKE = `mutation($o: ID!, $i: ID!) { revokeApiToken(orgId: $o, id: $i) }`

  test('crear devuelve el secreto una vez; listar no lo trae; el token sirve y se revoca', async () => {
    const w = await world()
    const created = await w.gql(CREATE, w.a.cookie, {
      o: w.orgA,
      n: 'mi agente',
      m: 'write',
    })
    expect(created.errors).toBeUndefined()
    const { secret, token } = created.data!.createApiToken
    expect(secret).toMatch(/^mck_/)
    expect(token).toMatchObject({
      name: 'mi agente',
      mode: 'write',
      revokedAt: null,
    })
    expect(Date.parse(token.expiresAt) - Date.now()).toBeGreaterThan(
      89 * 86_400_000,
    )

    const listed = await w.gql(
      `query($o: ID!) { org(id: $o) { apiTokens { id name hint lastUsedAt } } }`,
      w.a.cookie,
      { o: w.orgA },
    )
    expect(JSON.stringify(listed.data)).not.toContain(secret)
    expect(listed.data!.org.apiTokens).toEqual([
      {
        id: token.id,
        name: 'mi agente',
        hint: secret.slice(-4),
        lastUsedAt: null,
      },
    ])
    const asksSecret = await w.gql(
      `query($o: ID!) { org(id: $o) { apiTokens { secret } } }`,
      w.a.cookie,
      { o: w.orgA },
    )
    expect(asksSecret.errors).toBeDefined()

    expect((await w.exec(secret, 'return 1')).status).toBe(200)
    const revoke = await w.gql(REVOKE, w.a.cookie, {
      o: w.orgA,
      i: token.id,
    })
    expect(revoke.data!.revokeApiToken).toBe(true)
    expect((await w.exec(secret, 'return 1')).status).toBe(401)
    const again = await w.gql(REVOKE, w.a.cookie, { o: w.orgA, i: token.id })
    expect(again.errors![0]!.extensions!.code).toBe('NOT_FOUND')
  })

  test('sin sesión no se crea nada; ni en la org de otro; ni se revoca el token ajeno', async () => {
    const w = await world()
    const anon = await w.gql(CREATE, '', { o: w.orgA, n: 'x', m: 'read' })
    expect(anon.errors![0]!.extensions!.code).toBe('UNAUTHENTICATED')
    const foreign = await w.gql(CREATE, w.a.cookie, {
      o: w.orgB,
      n: 'x',
      m: 'read',
    })
    expect(foreign.errors![0]!.extensions!.code).toBe('FORBIDDEN')
    const other = w.token(w.b.userId, w.orgB)
    const steal = await w.gql(REVOKE, w.a.cookie, {
      o: w.orgA,
      i: other.token.id,
    })
    expect(steal.errors![0]!.extensions!.code).toBe('NOT_FOUND')
    expect((await w.exec(other.secret, 'return 1')).status).toBe(200)
  })

  test('solo owner y admin crean tokens; el token queda atado a la puerta de la sesión', async () => {
    const w = await world()
    const tailA = await loginAs(w.db, alice, 'tailnet')
    const tailB = await loginAs(w.db, bob, 'tailnet')
    const team = createTeamOrg(w.db, 'equipo', [
      { userId: tailA.userId, role: 'owner' },
      { userId: tailB.userId, role: 'member' },
    ])
    const member = await w.gql(
      CREATE,
      tailB.cookie,
      { o: team, n: 'x', m: 'read' },
      'tailnet',
    )
    expect(member.errors![0]!.extensions!.code).toBe('FORBIDDEN')
    const owner = await w.gql(
      CREATE,
      tailA.cookie,
      { o: team, n: 'x', m: 'write' },
      'tailnet',
    )
    expect(owner.errors).toBeUndefined()
    const secret = owner.data!.createApiToken.secret as string
    expect(
      (await w.exec(secret, 'return 1', 'execute', 'tailnet')).status,
    ).toBe(200)
    expect((await w.exec(secret, 'return 1', 'execute', 'public')).status).toBe(
      401,
    )
    // La org de equipo no se abre desde la puerta pública, ni siquiera para crear un token.
    const pub = await w.gql(CREATE, tailA.cookie, {
      o: team,
      n: 'x',
      m: 'write',
    })
    expect(pub.errors).toBeDefined()
  })

  test('tope de 20 tokens vigentes, vencimiento y nombre válidos', async () => {
    const w = await world()
    for (let i = 0; i < 20; i++) {
      const r = await w.gql(CREATE, w.a.cookie, {
        o: w.orgA,
        n: `t${i}`,
        m: 'read',
      })
      expect(r.errors).toBeUndefined()
    }
    const over = await w.gql(CREATE, w.a.cookie, {
      o: w.orgA,
      n: 'uno más',
      m: 'read',
    })
    expect(over.errors![0]!.extensions!.code).toBe('LIMIT_REACHED')
    const tokens = (
      await w.gql(
        `query($o: ID!) { org(id: $o) { apiTokens { id } } }`,
        w.a.cookie,
        { o: w.orgA },
      )
    ).data!.org.apiTokens as { id: string }[]
    await w.gql(REVOKE, w.a.cookie, { o: w.orgA, i: tokens[0]!.id })
    const freed = await w.gql(CREATE, w.a.cookie, {
      o: w.orgA,
      n: 'cabe',
      m: 'read',
      e: 'NEVER',
    })
    expect(freed.errors).toBeUndefined()
    expect(freed.data!.createApiToken.token.expiresAt).toBeNull()
    const blank = await w.gql(CREATE, w.a.cookie, {
      o: w.orgA,
      n: '   ',
      m: 'read',
    })
    expect(blank.errors![0]!.extensions!.code).toBe('INVALID_INPUT')
  })
})
