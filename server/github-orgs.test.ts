import { describe, expect, test } from 'bun:test'
import type {
  GithubClient,
  GithubOrgMembership,
  GithubProfile,
} from './auth/github'
import { openScope } from './db/scoped'
import { userTokens } from './github/tokens'
import { githubOrgs } from './services/github-orgs'
import {
  createTeamOrg,
  inviteMember,
  acceptInvitation,
  listMembers,
  MAX_MEMBERS,
  setMemberRole,
} from './services/members'
import { createApiToken } from './services/tokens'
import {
  alice,
  bob,
  fakeGithub,
  loginAs,
  setupServer,
  TOKEN_KEY,
} from './testing'

const carol: GithubProfile = {
  id: 3,
  login: 'carol',
  name: 'Carol',
  avatarUrl: null,
}

const ASTRA_ID = 777
const astra = (role: 'admin' | 'member'): GithubOrgMembership => ({
  orgId: ASTRA_ID,
  login: 'adastra-org',
  role,
})

const code = (r: { errors?: { extensions?: { code?: string } }[] }) =>
  r.errors?.[0]?.extensions?.code

type State = {
  profile: GithubProfile
  /** Lo que GitHub dice de la persona que está actuando, por login de org de GitHub. */
  memberships: Record<string, GithubOrgMembership | Error>
}

/** GitHub de mentira que se puede cambiar entre un paso y otro del test. */
function liveGithub(state: State): GithubClient {
  return {
    ...fakeGithub(state.profile),
    fetchProfile: async () => state.profile,
    fetchOrgMembership: async (_token, org) => {
      const found = state.memberships[org]
      if (found instanceof Error) throw found
      return found ?? null
    },
  }
}

async function world() {
  const state: State = { profile: alice, memberships: {} }
  const client = liveGithub(state)
  const ctx = setupServer(client)
  const tail = (userId: string) => ({ userId, ingress: 'tailnet' as const })
  const a = await loginAs(ctx.db, alice, 'tailnet')
  const team = createTeamOrg(ctx.db, tail(a.userId), { name: 'astra' })
  const orgs = githubOrgs({
    db: ctx.db,
    bus: ctx.bus,
    login: client,
    tokens: userTokens({
      db: ctx.db,
      login: client,
      tokenKey: TOKEN_KEY,
      now: Date.now,
    }),
  })
  /** Quien actúa a partir de ahora y qué dice GitHub de sus orgs. */
  const as = (profile: GithubProfile, memberships: State['memberships']) => {
    state.profile = profile
    state.memberships = memberships
  }
  /** Login completo por la puerta dada: es el camino real por el que alguien entra y se sincroniza. */
  async function signInAs(
    ingress: 'tailnet' | 'public' = 'tailnet',
  ): Promise<{ status: number; userId: string }> {
    const origin =
      ingress === 'tailnet'
        ? 'https://checklist.tailnet.test'
        : 'https://checklist.test'
    const app = ctx.apps[ingress]
    const start = await app.handle(new Request(`${origin}/auth/github/login`))
    const stateParam = new URL(start.headers.get('location')!).searchParams.get(
      'state',
    )!
    const cookie = start.headers.getSetCookie()[0]!.split(';')[0]!
    const res = await app.handle(
      new Request(
        `${origin}/auth/github/callback?code=good-code&state=${stateParam}`,
        { headers: { cookie } },
      ),
    )
    const user = ctx.db
      .query<{ id: string }, [number]>(
        'SELECT id FROM users WHERE github_id = ?',
      )
      .get(state.profile.id)
    return { status: res.status, userId: user!.id }
  }
  const members = () =>
    listMembers(ctx.db, tail(a.userId), team.id).map((m) => ({
      login: m.login,
      role: m.role,
      source: m.source,
    }))
  const link = async () => {
    as(alice, { 'adastra-org': astra('admin') })
    return orgs.link(tail(a.userId), { orgId: team.id, login: 'adastra-org' })
  }
  return { ...ctx, state, a, team, orgs, tail, as, signInAs, members, link }
}

describe('vincular una org de equipo con una org de GitHub', () => {
  test('el owner, siendo admin de la org de GitHub, la vincula y la org lo muestra', async () => {
    const w = await world()
    const link = await w.link()
    expect(link).toEqual({ githubOrgId: ASTRA_ID, login: 'adastra-org' })
    const cookie = (await loginAs(w.db, alice, 'tailnet')).cookie
    const res = await w.gql.tailnet(
      '{ me { orgs { kind githubOrg { login } } } }',
      cookie,
    )
    expect(res.data?.me.orgs).toContainEqual({
      kind: 'team',
      githubOrg: { login: 'adastra-org' },
    })
    const scope = openScope(w.db, {
      orgId: w.team.id,
      ...w.tail(w.a.userId),
    })
    expect(scope.activity.list(10).map((e) => e.type)).toContain(
      'org.github_linked',
    )
  })

  test('no se vincula si sos solo miembro de la org de GitHub, si no existe o si GitHub falla', async () => {
    const w = await world()
    const attempt = () =>
      w.orgs.link(w.tail(w.a.userId), {
        orgId: w.team.id,
        login: 'adastra-org',
      })
    w.as(alice, { 'adastra-org': astra('member') })
    await expect(attempt()).rejects.toThrow('admin de adastra-org')
    w.as(alice, {})
    await expect(attempt()).rejects.toThrow('GitHub App instalada')
    w.as(alice, { 'adastra-org': new Error('502') })
    await expect(attempt()).rejects.toThrow('GitHub no respondió')
    expect(w.members()).toHaveLength(1)
  })

  test('valida el login, la puerta y el tipo de org', async () => {
    const w = await world()
    w.as(alice, { 'adastra-org': astra('admin') })
    const caller = w.tail(w.a.userId)
    await expect(
      w.orgs.link(caller, { orgId: w.team.id, login: 'a b' }),
    ).rejects.toThrow('login de GitHub')
    await expect(
      w.orgs.link(
        { ...caller, ingress: 'public' },
        { orgId: w.team.id, login: 'adastra-org' },
      ),
    ).rejects.toThrow('tailnet')
    const personal = ctx_personalOrg(w.db, w.a.userId)
    await expect(
      w.orgs.link(caller, { orgId: personal, login: 'adastra-org' }),
    ).rejects.toThrow('personal')
  })

  test('solo un owner vincula o desvincula; un admin no', async () => {
    const w = await world()
    const b = await loginAs(w.db, bob, 'tailnet')
    const inv = inviteMember({ db: w.db, bus: w.bus }, w.tail(w.a.userId), {
      orgId: w.team.id,
      login: 'bob',
      role: 'admin',
    })
    acceptInvitation({ db: w.db, bus: w.bus }, w.tail(b.userId), {
      id: inv.id,
    })
    w.as(bob, { 'adastra-org': astra('admin') })
    await expect(
      w.orgs.link(w.tail(b.userId), {
        orgId: w.team.id,
        login: 'adastra-org',
      }),
    ).rejects.toThrow('owner')
    await w.link()
    expect(() => w.orgs.unlink(w.tail(b.userId), { orgId: w.team.id })).toThrow(
      'owner',
    )
  })

  test('una org ya vinculada no se vincula de nuevo y una org de GitHub se vincula a una sola org', async () => {
    const w = await world()
    await w.link()
    await expect(w.link()).rejects.toThrow('ya está vinculada')
    const other = createTeamOrg(w.db, w.tail(w.a.userId), { name: 'otra' })
    w.as(alice, { 'adastra-org': astra('admin') })
    await expect(
      w.orgs.link(w.tail(w.a.userId), {
        orgId: other.id,
        login: 'adastra-org',
      }),
    ).rejects.toThrow('ya está vinculada a otra')
  })

  test('por el listener público no hay vínculo ni mutaciones', async () => {
    const w = await world()
    await w.link()
    const pub = (await loginAs(w.db, alice, 'public')).cookie
    const res = await w.gql.public(
      `mutation { linkGithubOrg(orgId: "${w.team.id}", login: "x") { login } }`,
      pub,
    )
    expect(code(res)).toBe('FORBIDDEN')
  })
})

describe('entrar con el login de GitHub', () => {
  test('un miembro de la org de GitHub entra solo como member, con source github', async () => {
    const w = await world()
    await w.link()
    w.as(bob, { 'adastra-org': astra('member') })
    const login = await w.signInAs()
    expect(login.status).toBe(302)
    expect(w.members()).toContainEqual({
      login: 'bob',
      role: 'member',
      source: 'github',
    })
    const types = openScope(w.db, {
      orgId: w.team.id,
      ...w.tail(w.a.userId),
    })
      .activity.list(10)
      .map((e) => e.type)
    expect(types).toContain('member.joined')
  })

  test('un admin de la org de GitHub entra como admin; entrar de nuevo no duplica', async () => {
    const w = await world()
    await w.link()
    w.as(carol, { 'adastra-org': astra('admin') })
    await w.signInAs()
    await w.signInAs()
    expect(w.members().filter((m) => m.login === 'carol')).toEqual([
      { login: 'carol', role: 'admin', source: 'github' },
    ])
  })

  test('el rol sigue a GitHub en el siguiente login', async () => {
    const w = await world()
    await w.link()
    w.as(bob, { 'adastra-org': astra('member') })
    await w.signInAs()
    w.as(bob, { 'adastra-org': astra('admin') })
    await w.signInAs()
    expect(w.members()).toContainEqual({
      login: 'bob',
      role: 'admin',
      source: 'github',
    })
  })

  test('quien deja la org de GitHub sale de la org y pierde sus tokens de API', async () => {
    const w = await world()
    await w.link()
    w.as(bob, { 'adastra-org': astra('admin') })
    const { userId } = await w.signInAs()
    createApiToken(w.db, w.tail(userId), {
      orgId: w.team.id,
      name: 'agente',
      mode: 'write',
      expiresInDays: null,
    })
    w.as(bob, {})
    await w.signInAs()
    expect(w.members().map((m) => m.login)).toEqual(['alice'])
    expect(
      w.db
        .query<{ n: number }, [string]>(
          'SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL',
        )
        .get(userId)!.n,
    ).toBe(0)
  })

  test('si GitHub falla no se saca a nadie y el login sigue', async () => {
    const w = await world()
    await w.link()
    w.as(bob, { 'adastra-org': astra('member') })
    await w.signInAs()
    w.as(bob, { 'adastra-org': new Error('GitHub caído') })
    const login = await w.signInAs()
    expect(login.status).toBe(302)
    expect(w.members().map((m) => m.login)).toContain('bob')
  })

  test('si el login de la org de GitHub pasó a otra org (distinto id) no cuenta como miembro', async () => {
    const w = await world()
    await w.link()
    w.as(bob, { 'adastra-org': { ...astra('member'), orgId: 999 } })
    await w.signInAs()
    expect(w.members().map((m) => m.login)).toEqual(['alice'])
  })

  test('por el listener público no se sincroniza nada', async () => {
    const w = await world()
    await w.link()
    w.as(bob, { 'adastra-org': astra('member') })
    await w.signInAs('public')
    expect(w.members().map((m) => m.login)).toEqual(['alice'])
  })

  test('respeta el tope de miembros', async () => {
    const w = await world()
    await w.link()
    for (let i = 0; i < MAX_MEMBERS - 1; i++) {
      const id = `u${i}`
      w.db
        .query(
          'INSERT INTO users (id, github_id, login, created_at, updated_at) VALUES (?, ?, ?, 1, 1)',
        )
        .run(id, 1000 + i, `user${i}`)
      w.db
        .query(
          "INSERT INTO org_members (org_id, user_id, role, created_at) VALUES (?, ?, 'member', 1)",
        )
        .run(w.team.id, id)
    }
    w.as(bob, { 'adastra-org': astra('member') })
    await w.signInAs()
    expect(w.members().map((m) => m.login)).not.toContain('bob')
  })
})

describe('lo manual no se toca', () => {
  test('un invitado a mano conserva rol y lugar aunque no esté en la org de GitHub', async () => {
    const w = await world()
    const b = await loginAs(w.db, bob, 'tailnet')
    const deps = { db: w.db, bus: w.bus }
    const inv = inviteMember(deps, w.tail(w.a.userId), {
      orgId: w.team.id,
      login: 'bob',
      role: 'admin',
    })
    acceptInvitation(deps, w.tail(b.userId), { id: inv.id })
    await w.link()
    w.as(bob, {})
    await w.signInAs()
    expect(w.members()).toContainEqual({
      login: 'bob',
      role: 'admin',
      source: 'manual',
    })
    w.as(bob, { 'adastra-org': astra('member') })
    await w.signInAs()
    expect(w.members()).toContainEqual({
      login: 'bob',
      role: 'admin',
      source: 'manual',
    })
  })

  test('cambiar a mano el rol de alguien de GitHub lo pasa a manual', async () => {
    const w = await world()
    await w.link()
    w.as(bob, { 'adastra-org': astra('member') })
    const { userId } = await w.signInAs()
    setMemberRole({ db: w.db, bus: w.bus }, w.tail(w.a.userId), {
      orgId: w.team.id,
      userId,
      role: 'owner',
    })
    w.as(bob, {})
    await w.signInAs()
    expect(w.members()).toContainEqual({
      login: 'bob',
      role: 'owner',
      source: 'manual',
    })
  })

  test('desvincular deja a los miembros de GitHub como manuales y el sync ya no los saca', async () => {
    const w = await world()
    await w.link()
    w.as(bob, { 'adastra-org': astra('member') })
    await w.signInAs()
    w.orgs.unlink(w.tail(w.a.userId), { orgId: w.team.id })
    expect(w.members()).toContainEqual({
      login: 'bob',
      role: 'member',
      source: 'manual',
    })
    w.as(bob, {})
    await w.signInAs()
    expect(w.members().map((m) => m.login)).toContain('bob')
    const cookie = (await loginAs(w.db, alice, 'tailnet')).cookie
    const res = await w.gql.tailnet(
      '{ me { orgs { githubOrg { login } } } }',
      cookie,
    )
    expect(
      res.data?.me.orgs.every((o: { githubOrg: unknown }) => !o.githubOrg),
    ).toBe(true)
  })
})

describe('sincronizar a pedido', () => {
  test('la mutación aplica la membresía actual de quien la pide', async () => {
    const w = await world()
    await w.link()
    const b = await loginAs(w.db, bob, 'tailnet')
    w.as(bob, { 'adastra-org': astra('member') })
    const res = await w.gql.tailnet('mutation { syncGithubOrgs }', b.cookie)
    expect(res.errors).toBeUndefined()
    expect(res.data?.syncGithubOrgs).toBe(true)
    expect(w.members().map((m) => m.login)).toContain('bob')
    const again = await w.gql.tailnet('mutation { syncGithubOrgs }', b.cookie)
    expect(again.data?.syncGithubOrgs).toBe(false)
  })
})

/** Id de la org personal, para probar que no se vincula (solo SQL de test). */
function ctx_personalOrg(
  db: ReturnType<typeof setupServer>['db'],
  userId: string,
): string {
  return db
    .query<{ id: string }, [string]>(
      'SELECT id FROM orgs WHERE personal_for = ?',
    )
    .get(userId)!.id
}
