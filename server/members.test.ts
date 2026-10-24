import { describe, expect, test } from 'bun:test'
import type { GithubProfile } from './auth/github'
import { openScope } from './db/scoped'
import { fileStore } from './files'
import { createList } from './services/lists'
import {
  acceptInvitation,
  createTeamOrg,
  declineInvitation,
  inviteMember,
  leaveOrg,
  listInvitations,
  listMembers,
  MAX_MEMBERS,
  MAX_OWNED_TEAM_ORGS,
  myInvitations,
  removeMember,
  revokeInvitation,
  setMemberRole,
} from './services/members'
import { importOrg } from './services/transfer'
import { alice, bob, config, loginAs, setupServer } from './testing'

const carol: GithubProfile = {
  id: 3,
  login: 'Carol',
  name: 'Carol',
  avatarUrl: null,
}
const dave: GithubProfile = {
  id: 4,
  login: 'dave',
  name: null,
  avatarUrl: null,
}

const code = (r: { errors?: { extensions?: { code?: string } }[] }) =>
  r.errors?.[0]?.extensions?.code

/** Alice crea el equipo; bob, carol y dave tienen cuenta y entran por la tailnet. */
async function world() {
  const ctx = setupServer()
  const a = await loginAs(ctx.db, alice, 'tailnet')
  const b = await loginAs(ctx.db, bob, 'tailnet')
  const c = await loginAs(ctx.db, carol, 'tailnet')
  const d = await loginAs(ctx.db, dave, 'tailnet')
  const deps = { db: ctx.db, bus: ctx.bus }
  const tail = (userId: string) => ({
    userId,
    ingress: 'tailnet' as const,
  })
  const pub = (userId: string) => ({ userId, ingress: 'public' as const })
  const team = createTeamOrg(ctx.db, tail(a.userId), { name: 'equipo' })
  /** Suma a alguien al equipo con el rol dado, pasando por una invitación real. */
  const join = (
    u: { userId: string },
    login: string,
    role: 'admin' | 'member',
  ) => {
    const inv = inviteMember(deps, tail(a.userId), {
      orgId: team.id,
      login,
      role,
    })
    acceptInvitation(deps, tail(u.userId), { id: inv.id })
  }
  return { ...ctx, deps, a, b, c, d, team, tail, pub, join }
}

describe('crear una org de equipo', () => {
  test('por la tailnet queda como owner y solo se ve por la tailnet', async () => {
    const w = await world()
    expect(w.team).toMatchObject({
      kind: 'team',
      name: 'equipo',
      role: 'owner',
    })
    const res = await w.gql.tailnet(
      'mutation { createTeamOrg(name: "otro") { id kind role name } }',
      w.b.cookie,
    )
    expect(res.errors).toBeUndefined()
    expect(res.data?.createTeamOrg).toMatchObject({
      kind: 'team',
      role: 'owner',
      name: 'otro',
    })
    const pubCookie = (await loginAs(w.db, alice, 'public')).cookie
    const orgs = await w.gql.public('{ me { orgs { kind } } }', pubCookie)
    expect(orgs.data?.me.orgs).toEqual([{ kind: 'personal' }])
  })

  test('por el listener público da FORBIDDEN y no crea nada', async () => {
    const w = await world()
    const pubCookie = (await loginAs(w.db, bob, 'public')).cookie
    const res = await w.gql.public(
      'mutation { createTeamOrg(name: "x") { id } }',
      pubCookie,
    )
    expect(code(res)).toBe('FORBIDDEN')
    expect(
      w.db
        .query<{ n: number }, []>(
          "SELECT COUNT(*) AS n FROM orgs WHERE kind = 'team'",
        )
        .get()!.n,
    ).toBe(1)
  })

  test('valida el nombre y topa las orgs por creador', async () => {
    const w = await world()
    expect(() =>
      createTeamOrg(w.db, w.tail(w.b.userId), { name: '   ' }),
    ).toThrow('vacío')
    for (let i = 1; i < MAX_OWNED_TEAM_ORGS; i++)
      createTeamOrg(w.db, w.tail(w.a.userId), { name: `e${i}` })
    expect(() =>
      createTeamOrg(w.db, w.tail(w.a.userId), { name: 'de más' }),
    ).toThrow('hasta')
  })

  test('deja una entrada en la actividad de la org', async () => {
    const w = await world()
    const scope = openScope(w.db, {
      orgId: w.team.id,
      userId: w.a.userId,
      ingress: 'tailnet',
    })
    expect(scope.activity.list(10).map((e) => e.type)).toEqual(['org.created'])
  })
})

describe('invitar', () => {
  test('el owner invita y la persona la ve y la acepta con el rol invitado', async () => {
    const w = await world()
    const inv = inviteMember(w.deps, w.tail(w.a.userId), {
      orgId: w.team.id,
      login: '@Bob',
      role: 'member',
    })
    expect(inv).toMatchObject({
      login: 'bob',
      role: 'member',
      orgName: 'equipo',
      invitedBy: 'alice',
    })
    expect(myInvitations(w.db, w.tail(w.b.userId)).map((i) => i.id)).toEqual([
      inv.id,
    ])
    const org = acceptInvitation(w.deps, w.tail(w.b.userId), { id: inv.id })
    expect(org).toMatchObject({ id: w.team.id, role: 'member' })
    expect(myInvitations(w.db, w.tail(w.b.userId))).toEqual([])
    expect(
      listMembers(w.db, w.tail(w.b.userId), w.team.id).map((m) => [
        m.login,
        m.role,
      ]),
    ).toEqual([
      ['alice', 'owner'],
      ['bob', 'member'],
    ])
  })

  test('el login de GitHub se compara sin mayúsculas', async () => {
    const w = await world()
    const inv = inviteMember(w.deps, w.tail(w.a.userId), {
      orgId: w.team.id,
      login: 'CAROL',
      role: 'member',
    })
    expect(inv.login).toBe('carol')
    // Carol se registró con "Carol": igual encuentra su invitación.
    expect(myInvitations(w.db, w.tail(w.c.userId))).toHaveLength(1)
  })

  test('un login con forma inválida se rechaza', async () => {
    const w = await world()
    for (const login of ['', 'a b', '-bob', 'bob-', 'a--b', 'x'.repeat(40)])
      expect(() =>
        inviteMember(w.deps, w.tail(w.a.userId), {
          orgId: w.team.id,
          login,
          role: 'member',
        }),
      ).toThrow('login de GitHub')
  })

  test('invitar a alguien que ya es miembro o ya tiene invitación da CONFLICT', async () => {
    const w = await world()
    w.join(w.b, 'bob', 'member')
    const again = () =>
      inviteMember(w.deps, w.tail(w.a.userId), {
        orgId: w.team.id,
        login: 'bob',
        role: 'member',
      })
    expect(again).toThrow('ya es miembro')
    inviteMember(w.deps, w.tail(w.a.userId), {
      orgId: w.team.id,
      login: 'carol',
      role: 'member',
    })
    expect(() =>
      inviteMember(w.deps, w.tail(w.a.userId), {
        orgId: w.team.id,
        login: 'carol',
        role: 'member',
      }),
    ).toThrow('Ya hay una invitación')
  })

  test('la org personal no admite miembros', async () => {
    const w = await world()
    const personal = w.db
      .query<{ id: string }, [string]>(
        'SELECT id FROM orgs WHERE personal_for = ?',
      )
      .get(w.a.userId)!.id
    expect(() =>
      inviteMember(w.deps, w.tail(w.a.userId), {
        orgId: personal,
        login: 'bob',
        role: 'member',
      }),
    ).toThrow('personal')
  })

  test('por el listener público no se invita', async () => {
    const w = await world()
    expect(() =>
      inviteMember(w.deps, w.pub(w.a.userId), {
        orgId: w.team.id,
        login: 'bob',
        role: 'member',
      }),
    ).toThrow('tailnet')
  })

  test('una invitación vencida no se puede aceptar y se puede volver a mandar', async () => {
    const w = await world()
    const t0 = Date.now()
    const inv = inviteMember(
      w.deps,
      w.tail(w.a.userId),
      { orgId: w.team.id, login: 'bob', role: 'member' },
      t0,
    )
    const later = t0 + 15 * 24 * 60 * 60 * 1000
    expect(myInvitations(w.db, w.tail(w.b.userId), later)).toEqual([])
    expect(() =>
      acceptInvitation(w.deps, w.tail(w.b.userId), { id: inv.id }, later),
    ).toThrow('no existe o venció')
    const fresh = inviteMember(
      w.deps,
      w.tail(w.a.userId),
      { orgId: w.team.id, login: 'bob', role: 'member' },
      later,
    )
    expect(fresh.id).not.toBe(inv.id)
  })

  test('hay un tope de miembros por org', async () => {
    const w = await world()
    // Se llena de miembros a mano para no crear 50 cuentas.
    for (let i = 0; i < MAX_MEMBERS - 1; i++) {
      const id = `u${String(i).padStart(3, '0')}`
      w.db.run(
        'INSERT INTO users (id, github_id, login, created_at, updated_at) VALUES (?, ?, ?, 0, 0)',
        [id, 1000 + i, `m${i}`],
      )
      w.db.run(
        "INSERT INTO org_members (org_id, user_id, role, created_at) VALUES (?, ?, 'member', 0)",
        [w.team.id, id],
      )
    }
    const inv = inviteMember(w.deps, w.tail(w.a.userId), {
      orgId: w.team.id,
      login: 'bob',
      role: 'member',
    })
    expect(() =>
      acceptInvitation(w.deps, w.tail(w.b.userId), { id: inv.id }),
    ).toThrow('hasta')
  })
})

describe('roles al invitar y revocar', () => {
  test('un member no invita ni ve las invitaciones', async () => {
    const w = await world()
    w.join(w.b, 'bob', 'member')
    expect(() =>
      inviteMember(w.deps, w.tail(w.b.userId), {
        orgId: w.team.id,
        login: 'carol',
        role: 'member',
      }),
    ).toThrow('administra')
    expect(() => listInvitations(w.db, w.tail(w.b.userId), w.team.id)).toThrow(
      'administra',
    )
  })

  test('un admin invita members pero no admins', async () => {
    const w = await world()
    w.join(w.b, 'bob', 'admin')
    const inv = inviteMember(w.deps, w.tail(w.b.userId), {
      orgId: w.team.id,
      login: 'carol',
      role: 'member',
    })
    expect(inv.invitedBy).toBe('bob')
    expect(() =>
      inviteMember(w.deps, w.tail(w.b.userId), {
        orgId: w.team.id,
        login: 'dave',
        role: 'admin',
      }),
    ).toThrow('owner')
  })

  test('un admin revoca las de member y no las de admin', async () => {
    const w = await world()
    w.join(w.b, 'bob', 'admin')
    const toMember = inviteMember(w.deps, w.tail(w.a.userId), {
      orgId: w.team.id,
      login: 'carol',
      role: 'member',
    })
    const toAdmin = inviteMember(w.deps, w.tail(w.a.userId), {
      orgId: w.team.id,
      login: 'dave',
      role: 'admin',
    })
    expect(() =>
      revokeInvitation(w.deps, w.tail(w.b.userId), {
        orgId: w.team.id,
        id: toAdmin.id,
      }),
    ).toThrow('owner')
    revokeInvitation(w.deps, w.tail(w.b.userId), {
      orgId: w.team.id,
      id: toMember.id,
    })
    expect(
      listInvitations(w.db, w.tail(w.a.userId), w.team.id).map((i) => i.login),
    ).toEqual(['dave'])
    expect(myInvitations(w.db, w.tail(w.c.userId))).toEqual([])
  })

  test('revocar con el id de otra org no la toca', async () => {
    const w = await world()
    const other = createTeamOrg(w.db, w.tail(w.b.userId), { name: 'otro' })
    const inv = inviteMember(w.deps, w.tail(w.a.userId), {
      orgId: w.team.id,
      login: 'carol',
      role: 'member',
    })
    expect(() =>
      revokeInvitation(w.deps, w.tail(w.b.userId), {
        orgId: other.id,
        id: inv.id,
      }),
    ).toThrow('no existe')
    expect(myInvitations(w.db, w.tail(w.c.userId))).toHaveLength(1)
  })
})

describe('aceptar y rechazar', () => {
  test('otra persona no puede aceptar ni rechazar una invitación ajena', async () => {
    const w = await world()
    const inv = inviteMember(w.deps, w.tail(w.a.userId), {
      orgId: w.team.id,
      login: 'bob',
      role: 'member',
    })
    expect(() =>
      acceptInvitation(w.deps, w.tail(w.c.userId), { id: inv.id }),
    ).toThrow('no existe o venció')
    expect(() =>
      declineInvitation(w.deps, w.tail(w.c.userId), { id: inv.id }),
    ).toThrow('no existe o venció')
    expect(
      listMembers(w.db, w.tail(w.a.userId), w.team.id).map((m) => m.login),
    ).toEqual(['alice'])
  })

  test('por el listener público no se acepta y no se listan', async () => {
    const w = await world()
    const inv = inviteMember(w.deps, w.tail(w.a.userId), {
      orgId: w.team.id,
      login: 'bob',
      role: 'member',
    })
    expect(myInvitations(w.db, w.pub(w.b.userId))).toEqual([])
    expect(() =>
      acceptInvitation(w.deps, w.pub(w.b.userId), { id: inv.id }),
    ).toThrow('tailnet')
    const pubCookie = (await loginAs(w.db, bob, 'public')).cookie
    const res = await w.gql.public(
      `mutation { acceptInvitation(id: "${inv.id}") { id } }`,
      pubCookie,
    )
    expect(code(res)).toBe('FORBIDDEN')
    const mine = await w.gql.public('{ me { invitations { id } } }', pubCookie)
    expect(mine.data?.me.invitations).toEqual([])
  })

  test('rechazar borra la invitación y no suma a nadie', async () => {
    const w = await world()
    const inv = inviteMember(w.deps, w.tail(w.a.userId), {
      orgId: w.team.id,
      login: 'bob',
      role: 'member',
    })
    declineInvitation(w.deps, w.tail(w.b.userId), { id: inv.id })
    expect(myInvitations(w.db, w.tail(w.b.userId))).toEqual([])
    expect(() => listMembers(w.db, w.tail(w.b.userId), w.team.id)).toThrow(
      'Sin acceso',
    )
  })

  test('aceptar no se repite', async () => {
    const w = await world()
    const inv = inviteMember(w.deps, w.tail(w.a.userId), {
      orgId: w.team.id,
      login: 'bob',
      role: 'member',
    })
    acceptInvitation(w.deps, w.tail(w.b.userId), { id: inv.id })
    expect(() =>
      acceptInvitation(w.deps, w.tail(w.b.userId), { id: inv.id }),
    ).toThrow('no existe o venció')
  })
})

describe('cambiar roles', () => {
  test('solo un owner cambia roles y el cambio se nota en lo que puede hacer', async () => {
    const w = await world()
    w.join(w.b, 'bob', 'member')
    w.join(w.c, 'carol', 'admin')
    expect(() =>
      setMemberRole(w.deps, w.tail(w.c.userId), {
        orgId: w.team.id,
        userId: w.b.userId,
        role: 'admin',
      }),
    ).toThrow('owner')
    expect(() =>
      setMemberRole(w.deps, w.tail(w.b.userId), {
        orgId: w.team.id,
        userId: w.b.userId,
        role: 'owner',
      }),
    ).toThrow('owner')
    const promoted = setMemberRole(w.deps, w.tail(w.a.userId), {
      orgId: w.team.id,
      userId: w.b.userId,
      role: 'admin',
    })
    expect(promoted.role).toBe('admin')
    inviteMember(w.deps, w.tail(w.b.userId), {
      orgId: w.team.id,
      login: 'dave',
      role: 'member',
    })
  })

  test('la org no se queda sin owner', async () => {
    const w = await world()
    w.join(w.b, 'bob', 'member')
    expect(() =>
      setMemberRole(w.deps, w.tail(w.a.userId), {
        orgId: w.team.id,
        userId: w.a.userId,
        role: 'member',
      }),
    ).toThrow('al menos un owner')
    setMemberRole(w.deps, w.tail(w.a.userId), {
      orgId: w.team.id,
      userId: w.b.userId,
      role: 'owner',
    })
    // Con dos owners, uno sí puede bajarse.
    setMemberRole(w.deps, w.tail(w.a.userId), {
      orgId: w.team.id,
      userId: w.a.userId,
      role: 'member',
    })
    expect(
      listMembers(w.db, w.tail(w.a.userId), w.team.id).map((m) => [
        m.login,
        m.role,
      ]),
    ).toEqual([
      ['bob', 'owner'],
      ['alice', 'member'],
    ])
  })

  test('cambiar el rol de quien no es miembro da NOT_FOUND', async () => {
    const w = await world()
    expect(() =>
      setMemberRole(w.deps, w.tail(w.a.userId), {
        orgId: w.team.id,
        userId: w.d.userId,
        role: 'admin',
      }),
    ).toThrow('No es miembro')
  })
})

describe('sacar y salir', () => {
  test('un admin saca a un member pero no a otro admin ni a un owner', async () => {
    const w = await world()
    w.join(w.b, 'bob', 'admin')
    w.join(w.c, 'carol', 'member')
    w.join(w.d, 'dave', 'admin')
    expect(() =>
      removeMember(w.deps, w.tail(w.b.userId), {
        orgId: w.team.id,
        userId: w.d.userId,
      }),
    ).toThrow('owner')
    expect(() =>
      removeMember(w.deps, w.tail(w.b.userId), {
        orgId: w.team.id,
        userId: w.a.userId,
      }),
    ).toThrow('owner')
    removeMember(w.deps, w.tail(w.b.userId), {
      orgId: w.team.id,
      userId: w.c.userId,
    })
    removeMember(w.deps, w.tail(w.a.userId), {
      orgId: w.team.id,
      userId: w.d.userId,
    })
    expect(
      listMembers(w.db, w.tail(w.a.userId), w.team.id).map((m) => m.login),
    ).toEqual(['alice', 'bob'])
  })

  test('un member no saca a nadie y nadie se saca a sí mismo', async () => {
    const w = await world()
    w.join(w.b, 'bob', 'member')
    w.join(w.c, 'carol', 'member')
    expect(() =>
      removeMember(w.deps, w.tail(w.b.userId), {
        orgId: w.team.id,
        userId: w.c.userId,
      }),
    ).toThrow('administra')
    expect(() =>
      removeMember(w.deps, w.tail(w.a.userId), {
        orgId: w.team.id,
        userId: w.a.userId,
      }),
    ).toThrow('Salir')
  })

  test('quien es sacado pierde el acceso a todo y sus tokens de API se revocan', async () => {
    const w = await world()
    w.join(w.b, 'bob', 'member')
    const created = await w.gql.tailnet(
      `mutation { createApiToken(orgId: "${w.team.id}", name: "agente", mode: write) { token { id } } }`,
      w.b.cookie,
    )
    expect(code(created)).toBe('FORBIDDEN') // un member no crea tokens
    setMemberRole(w.deps, w.tail(w.a.userId), {
      orgId: w.team.id,
      userId: w.b.userId,
      role: 'admin',
    })
    const ok = await w.gql.tailnet(
      `mutation { createApiToken(orgId: "${w.team.id}", name: "agente", mode: write) { secret token { id } } }`,
      w.b.cookie,
    )
    expect(ok.errors).toBeUndefined()
    const tokenId = ok.data!.createApiToken.token.id as string

    removeMember(w.deps, w.tail(w.a.userId), {
      orgId: w.team.id,
      userId: w.b.userId,
    })
    const after = await w.gql.tailnet(
      `{ org(id: "${w.team.id}") { name lists { id } } }`,
      w.b.cookie,
    )
    expect(code(after)).toBe('FORBIDDEN')
    expect(
      w.db
        .query<{ revoked_at: number | null }, [string]>(
          'SELECT revoked_at FROM api_tokens WHERE id = ?',
        )
        .get(tokenId)!.revoked_at,
    ).not.toBeNull()
  })

  test('salir: un member se va, el último owner no puede hasta promover a otro', async () => {
    const w = await world()
    w.join(w.b, 'bob', 'member')
    leaveOrg(w.deps, w.tail(w.b.userId), { orgId: w.team.id })
    expect(() => listMembers(w.db, w.tail(w.b.userId), w.team.id)).toThrow(
      'Sin acceso',
    )
    w.join(w.c, 'carol', 'member')
    expect(() =>
      leaveOrg(w.deps, w.tail(w.a.userId), { orgId: w.team.id }),
    ).toThrow('único owner')
    setMemberRole(w.deps, w.tail(w.a.userId), {
      orgId: w.team.id,
      userId: w.c.userId,
      role: 'owner',
    })
    leaveOrg(w.deps, w.tail(w.a.userId), { orgId: w.team.id })
    expect(
      listMembers(w.db, w.tail(w.c.userId), w.team.id).map((m) => m.login),
    ).toEqual(['Carol'])
  })

  test('una org personal no se abandona', async () => {
    const w = await world()
    const personal = w.db
      .query<{ id: string }, [string]>(
        'SELECT id FROM orgs WHERE personal_for = ?',
      )
      .get(w.a.userId)!.id
    expect(() =>
      leaveOrg(w.deps, w.tail(w.a.userId), { orgId: personal }),
    ).toThrow('personal')
  })
})

describe('actividad y avisos', () => {
  test('cada cambio de miembros deja su entrada en la actividad de la org', async () => {
    const w = await world()
    w.join(w.b, 'bob', 'member')
    setMemberRole(w.deps, w.tail(w.a.userId), {
      orgId: w.team.id,
      userId: w.b.userId,
      role: 'admin',
    })
    const inv = inviteMember(w.deps, w.tail(w.a.userId), {
      orgId: w.team.id,
      login: 'carol',
      role: 'member',
    })
    revokeInvitation(w.deps, w.tail(w.a.userId), {
      orgId: w.team.id,
      id: inv.id,
    })
    removeMember(w.deps, w.tail(w.a.userId), {
      orgId: w.team.id,
      userId: w.b.userId,
    })
    const scope = openScope(w.db, {
      orgId: w.team.id,
      userId: w.a.userId,
      ingress: 'tailnet',
    })
    expect(scope.activity.list(20).map((e) => e.type)).toEqual([
      'member.removed',
      'member.invite_revoked',
      'member.invited',
      'member.role_changed',
      'member.joined',
      'member.invited',
      'org.created',
    ])
  })

  test('avisa por el bus con el alcance members', async () => {
    const w = await world()
    const seen: string[] = []
    w.bus.subscribe(w.team.id, (e) => seen.push(e.scope))
    w.join(w.b, 'bob', 'member')
    expect(seen).toEqual(['members', 'members'])
  })

  test('el stream de eventos se cierra para quien deja de ser miembro', async () => {
    const w = await world()
    w.join(w.b, 'bob', 'member')
    const res = await w.apps.tailnet.handle(
      new Request(`https://checklist.tailnet.test/events?org=${w.team.id}`, {
        headers: { cookie: w.b.cookie },
      }),
    )
    expect(res.status).toBe(200)
    const reader = res.body!.getReader()
    await reader.read() // saludo inicial
    removeMember(w.deps, w.tail(w.a.userId), {
      orgId: w.team.id,
      userId: w.b.userId,
    })
    const next = await Promise.race([
      reader.read(),
      new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 2000)),
    ])
    expect(next).not.toBe('timeout')
    expect((next as ReadableStreamReadResult<Uint8Array>).done).toBe(true)
  })
})

describe('GraphQL', () => {
  test('el flujo completo por la API: invitar, ver, aceptar y listar miembros', async () => {
    const w = await world()
    const invited = await w.gql.tailnet(
      `mutation { inviteMember(orgId: "${w.team.id}", login: "bob", role: member) { id login role orgName } }`,
      w.a.cookie,
    )
    expect(invited.errors).toBeUndefined()
    const id = invited.data!.inviteMember.id as string
    const seen = await w.gql.tailnet(
      '{ me { invitations { id orgName role invitedBy } } }',
      w.b.cookie,
    )
    expect(seen.data?.me.invitations).toEqual([
      { id, orgName: 'equipo', role: 'member', invitedBy: 'alice' },
    ])
    const accepted = await w.gql.tailnet(
      `mutation { acceptInvitation(id: "${id}") { id role kind } }`,
      w.b.cookie,
    )
    expect(accepted.data?.acceptInvitation).toMatchObject({
      id: w.team.id,
      role: 'member',
      kind: 'team',
    })
    const members = await w.gql.tailnet(
      `{ org(id: "${w.team.id}") { members { login role } } }`,
      w.b.cookie,
    )
    expect(members.data?.org.members).toEqual([
      { login: 'alice', role: 'owner' },
      { login: 'bob', role: 'member' },
    ])
  })

  test('la puerta se expone y un member recibe FORBIDDEN al pedir invitaciones', async () => {
    const w = await world()
    w.join(w.b, 'bob', 'member')
    const door = await w.gql.tailnet('{ ingress }', w.b.cookie)
    expect(door.data?.ingress).toBe('tailnet')
    const pubCookie = (await loginAs(w.db, bob, 'public')).cookie
    expect((await w.gql.public('{ ingress }', pubCookie)).data?.ingress).toBe(
      'public',
    )
    const res = await w.gql.tailnet(
      `{ org(id: "${w.team.id}") { invitations { id } } }`,
      w.b.cookie,
    )
    expect(code(res)).toBe('FORBIDDEN')
  })

  test('el conflicto se reporta con su código', async () => {
    const w = await world()
    const res = await w.gql.tailnet(
      `mutation { inviteMember(orgId: "${w.team.id}", login: "alice") { id } }`,
      w.a.cookie,
    )
    expect(code(res)).toBe('CONFLICT')
  })
})

describe('importar según el rol', () => {
  test('un member exporta pero no importa; un admin importa', async () => {
    const w = await world()
    w.join(w.b, 'bob', 'member')
    w.join(w.c, 'carol', 'admin')
    createList(w.deps, w.tail(w.a.userId), {
      orgId: w.team.id,
      name: 'lista',
      afterId: null,
    })
    const files = fileStore(config.filesDir)
    const exported = await w.apps.tailnet.handle(
      new Request(`https://checklist.tailnet.test/export/${w.team.id}`, {
        headers: { cookie: w.b.cookie },
      }),
    )
    expect(exported.status).toBe(200)
    const payload = await exported.json()
    await expect(
      importOrg({ ...w.deps, files }, w.tail(w.b.userId), {
        orgId: w.team.id,
        payload,
      }),
    ).rejects.toThrow('administra')
    const result = await importOrg({ ...w.deps, files }, w.tail(w.c.userId), {
      orgId: w.team.id,
      payload,
    })
    expect(result.lists).toBe(1)
  })
})
