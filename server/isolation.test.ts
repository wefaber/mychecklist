import type { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { ulid } from './db/ids'
import { openScope } from './db/scoped'
import { alice, bob, loginAs, setupServer } from './testing'

/** Hasta M7 no hay API para crear una org de equipo: los tests la arman a mano. */
function createTeamOrg(
  db: Database,
  name: string,
  members: { userId: string; role: 'owner' | 'admin' | 'member' }[],
): string {
  const id = ulid()
  db.query(
    "INSERT INTO orgs (id, kind, name, created_at) VALUES (?, 'team', ?, ?)",
  ).run(id, name, Date.now())
  for (const m of members)
    db.query(
      'INSERT INTO org_members (org_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
    ).run(id, m.userId, m.role, Date.now())
  return id
}

async function world() {
  const ctx = setupServer()
  const a = await loginAs(ctx.db, alice, 'tailnet')
  const b = await loginAs(ctx.db, bob, 'tailnet')
  const personal = (userId: string) =>
    ctx.db
      .query<{ id: string }, [string]>(
        'SELECT id FROM orgs WHERE personal_for = ?',
      )
      .get(userId)!.id
  const team = createTeamOrg(ctx.db, 'equipo', [
    { userId: a.userId, role: 'owner' },
  ])
  return {
    ...ctx,
    a,
    b,
    alicePersonal: personal(a.userId),
    bobPersonal: personal(b.userId),
    team,
  }
}

const code = (r: { errors?: { extensions?: { code?: string } }[] }) =>
  r.errors?.[0]?.extensions?.code

describe('ingress: público vs. tailnet (ADR 0001)', () => {
  test('una org team pedida por el listener público da FORBIDDEN', async () => {
    const w = await world()
    const pub = await loginAs(w.db, alice, 'public')
    const res = await w.gql.public(
      `{ org(id: "${w.team}") { name } }`,
      pub.cookie,
    )
    expect(code(res)).toBe('FORBIDDEN')
    expect(res.data?.org).toBeNull()
  })

  test('la misma org team, por la tailnet y siendo miembro, se lee', async () => {
    const w = await world()
    const res = await w.gql.tailnet(
      `{ org(id: "${w.team}") { name kind role } }`,
      w.a.cookie,
    )
    expect(res.errors).toBeUndefined()
    expect(res.data?.org).toEqual({
      name: 'equipo',
      kind: 'team',
      role: 'owner',
    })
  })

  test('por el listener público ni siquiera se listan las orgs team', async () => {
    const w = await world()
    const pub = await loginAs(w.db, alice, 'public')
    const pubOrgs = await w.gql.public('{ me { orgs { kind } } }', pub.cookie)
    expect(pubOrgs.data?.me.orgs).toEqual([{ kind: 'personal' }])
    const tailOrgs = await w.gql.tailnet('{ me { orgs { kind } } }', w.a.cookie)
    expect(tailOrgs.data?.me.orgs).toEqual([
      { kind: 'personal' },
      { kind: 'team' },
    ])
  })

  test('una sesión emitida en la tailnet no vale en el listener público', async () => {
    const w = await world()
    const res = await w.gql.public('{ me { login } }', w.a.cookie)
    expect(res.data?.me).toBeNull()
  })

  test('una sesión emitida en el listener público no vale en la tailnet', async () => {
    const w = await world()
    const pub = await loginAs(w.db, alice, 'public')
    const res = await w.gql.tailnet('{ me { login } }', pub.cookie)
    expect(res.data?.me).toBeNull()
  })

  test('un header X-Ingress no cambia nada: el ingress sale del socket', async () => {
    const w = await world()
    const res = await w.apps.public.handle(
      new Request('https://checklist.test/graphql', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-ingress': 'tailnet',
          cookie: w.a.cookie,
        },
        body: JSON.stringify({ query: `{ org(id: "${w.team}") { name } }` }),
      }),
    )
    expect(((await res.json()) as any).data?.org).toBeNull()
  })

  test('openScope también falla cerrado sin pasar por GraphQL', async () => {
    const w = await world()
    expect(() =>
      openScope(w.db, { orgId: w.team, userId: w.a.userId, ingress: 'public' }),
    ).toThrow('Sin acceso')
    expect(
      openScope(w.db, { orgId: w.team, userId: w.a.userId, ingress: 'tailnet' })
        .org.kind,
    ).toBe('team')
  })
})

describe('aislamiento entre orgs y usuarios', () => {
  test('un usuario no lee la org personal de otro', async () => {
    const w = await world()
    const res = await w.gql.tailnet(
      `{ org(id: "${w.alicePersonal}") { name } }`,
      w.b.cookie,
    )
    expect(code(res)).toBe('FORBIDDEN')
  })

  test('un usuario que no es miembro de una org team no la lee ni por la tailnet', async () => {
    const w = await world()
    const res = await w.gql.tailnet(
      `{ org(id: "${w.team}") { name } }`,
      w.b.cookie,
    )
    expect(code(res)).toBe('FORBIDDEN')
  })

  test('una org que no existe da el mismo FORBIDDEN: no revela ids', async () => {
    const w = await world()
    const res = await w.gql.tailnet(
      `{ org(id: "${ulid()}") { name } }`,
      w.a.cookie,
    )
    expect(code(res)).toBe('FORBIDDEN')
  })

  test('la actividad de una org nunca incluye la de otra', async () => {
    const w = await world()
    const mine = openScope(w.db, {
      orgId: w.alicePersonal,
      userId: w.a.userId,
      ingress: 'tailnet',
    })
    const team = openScope(w.db, {
      orgId: w.team,
      userId: w.a.userId,
      ingress: 'tailnet',
    })
    team.activity.append({ type: 'solo.equipo', via: 'web' })
    mine.activity.append({ type: 'solo.personal', via: 'web' })

    expect(team.activity.list(100).map((e) => e.type)).toEqual(['solo.equipo'])
    expect(mine.activity.list(100).map((e) => e.type)).toEqual([
      'solo.personal',
      'org.created',
    ])
    const bobs = openScope(w.db, {
      orgId: w.bobPersonal,
      userId: w.b.userId,
      ingress: 'tailnet',
    })
    expect(bobs.activity.list(100).map((e) => e.type)).toEqual(['org.created'])
  })

  test('sin sesión, pedir una org da UNAUTHENTICATED', async () => {
    const w = await world()
    const res = await w.gql.tailnet(
      `{ org(id: "${w.alicePersonal}") { name } }`,
    )
    expect(code(res)).toBe('UNAUTHENTICATED')
  })

  test('el tamaño de página de actividad se acota a 1..100', async () => {
    const w = await world()
    const scope = openScope(w.db, {
      orgId: w.alicePersonal,
      userId: w.a.userId,
      ingress: 'tailnet',
    })
    for (let i = 0; i < 120; i++)
      scope.activity.append({ type: `t${i}`, via: 'web' })
    const big = await w.gql.tailnet(
      `{ org(id: "${w.alicePersonal}") { activity(first: 5000) { id } } }`,
      w.a.cookie,
    )
    expect(big.data?.org.activity).toHaveLength(100)
    const neg = await w.gql.tailnet(
      `{ org(id: "${w.alicePersonal}") { activity(first: -3) { id } } }`,
      w.a.cookie,
    )
    expect(neg.data?.org.activity).toHaveLength(1)
  })

  test('las sesiones vencidas no valen', async () => {
    const w = await world()
    w.db.run('UPDATE sessions SET expires_at = 1')
    const res = await w.gql.tailnet('{ me { login } }', w.a.cookie)
    expect(res.data?.me).toBeNull()
  })
})
