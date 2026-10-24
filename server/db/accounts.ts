import type { Database } from 'bun:sqlite'
import type { Ingress } from '../ingress'
import { ulid } from './ids'

export type User = {
  id: string
  githubId: number
  login: string
  name: string | null
  avatarUrl: string | null
}

export type OrgKind = 'personal' | 'team'
export type Role = 'owner' | 'admin' | 'member'
export type OrgSummary = { id: string; kind: OrgKind; name: string; role: Role }

export type SealedTokens = {
  accessEnc: string
  refreshEnc: string | null
  accessExpiresAt: number | null
  refreshExpiresAt: number | null
}

type UserRow = {
  id: string
  github_id: number
  login: string
  name: string | null
  avatar_url: string | null
}

export const toUser = (r: UserRow): User => ({
  id: r.id,
  githubId: r.github_id,
  login: r.login,
  name: r.name,
  avatarUrl: r.avatar_url,
})

export const USER_COLUMNS = 'u.id, u.github_id, u.login, u.name, u.avatar_url'

/** Crea el usuario o refresca su perfil; `created` avisa si es la primera vez que entra. */
export function upsertUser(
  db: Database,
  profile: {
    id: number
    login: string
    name: string | null
    avatarUrl: string | null
  },
  now: number,
): { user: User; created: boolean } {
  const existing = db
    .query<UserRow, [number]>(
      'SELECT id, github_id, login, name, avatar_url FROM users WHERE github_id = ?',
    )
    .get(profile.id)
  if (existing) {
    db.query(
      'UPDATE users SET login = ?, name = ?, avatar_url = ?, updated_at = ? WHERE id = ?',
    ).run(profile.login, profile.name, profile.avatarUrl, now, existing.id)
    return {
      user: toUser({
        ...existing,
        login: profile.login,
        name: profile.name,
        avatar_url: profile.avatarUrl,
      }),
      created: false,
    }
  }
  const id = ulid(now)
  db.query(
    'INSERT INTO users (id, github_id, login, name, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    id,
    profile.id,
    profile.login,
    profile.name,
    profile.avatarUrl,
    now,
    now,
  )
  return {
    user: {
      id,
      githubId: profile.id,
      login: profile.login,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
    },
    created: true,
  }
}

/** Espacio propio del usuario: una org `personal` donde es `owner`. */
export function createPersonalOrg(
  db: Database,
  user: User,
  now: number,
): OrgSummary {
  const id = ulid(now)
  db.query(
    "INSERT INTO orgs (id, kind, name, personal_for, created_at) VALUES (?, 'personal', ?, ?, ?)",
  ).run(id, user.login, user.id, now)
  db.query(
    "INSERT INTO org_members (org_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)",
  ).run(id, user.id, now)
  return { id, kind: 'personal', name: user.login, role: 'owner' }
}

/**
 * Orgs del usuario visibles desde esta puerta: por el listener público solo se ven las personales (las de equipo
 * no existen para él, ADR 0001).
 */
export function listOrgsFor(
  db: Database,
  userId: string,
  ingress: Ingress,
): OrgSummary[] {
  return db
    .query<OrgSummary, [string, string]>(
      `SELECT o.id, o.kind, o.name, m.role
       FROM org_members m JOIN orgs o ON o.id = m.org_id
       WHERE m.user_id = ? AND (? = 'tailnet' OR o.kind = 'personal')
       ORDER BY o.kind, o.name`,
    )
    .all(userId, ingress)
}

export function saveGithubTokens(
  db: Database,
  userId: string,
  tokens: SealedTokens,
  now: number,
) {
  db.query(
    `INSERT INTO github_tokens (user_id, access_enc, refresh_enc, access_expires_at, refresh_expires_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET access_enc = excluded.access_enc, refresh_enc = excluded.refresh_enc,
       access_expires_at = excluded.access_expires_at, refresh_expires_at = excluded.refresh_expires_at,
       updated_at = excluded.updated_at`,
  ).run(
    userId,
    tokens.accessEnc,
    tokens.refreshEnc,
    tokens.accessExpiresAt,
    tokens.refreshExpiresAt,
    now,
  )
}

/** Tokens de GitHub del usuario tal como están guardados (cifrados), o `null` si nunca entró. */
export function loadGithubTokens(
  db: Database,
  userId: string,
): SealedTokens | null {
  const row = db
    .query<
      {
        access_enc: string
        refresh_enc: string | null
        access_expires_at: number | null
        refresh_expires_at: number | null
      },
      [string]
    >(
      'SELECT access_enc, refresh_enc, access_expires_at, refresh_expires_at FROM github_tokens WHERE user_id = ?',
    )
    .get(userId)
  return row
    ? {
        accessEnc: row.access_enc,
        refreshEnc: row.refresh_enc,
        accessExpiresAt: row.access_expires_at,
        refreshExpiresAt: row.refresh_expires_at,
      }
    : null
}
