import type { Database } from 'bun:sqlite'
import type { GithubRef } from '../../shared/github'

/** Todo el SQL del caché de links a GitHub (ADR 0006). Las claves llegan ya normalizadas (minúsculas). */

export type GithubKind = 'issue' | 'pull'
export type GithubState = 'open' | 'closed' | 'not_planned' | 'draft' | 'merged'

/** Lo último que se supo de un issue o PR; `not_found` no lleva datos. */
export type LinkEntry = {
  status: 'ok' | 'not_found'
  kind: GithubKind | null
  title: string | null
  state: GithubState | null
  fetchedAt: number
}

type LinkRow = {
  status: 'ok' | 'not_found'
  kind: GithubKind | null
  title: string | null
  state: GithubState | null
  fetched_at: number
}

const toEntry = (r: LinkRow): LinkEntry => ({
  status: r.status,
  kind: r.kind,
  title: r.title,
  state: r.state,
  fetchedAt: r.fetched_at,
})

const COLUMNS = 'status, kind, title, state, fetched_at'

export const repoKey = (ref: { owner: string; repo: string }) =>
  `${ref.owner}/${ref.repo}`

export function publicLink(db: Database, ref: GithubRef): LinkEntry | null {
  const row = db
    .query<LinkRow, [string, string, number]>(
      `SELECT ${COLUMNS} FROM github_public_links WHERE owner = ? AND repo = ? AND number = ?`,
    )
    .get(ref.owner, ref.repo, ref.number)
  return row ? toEntry(row) : null
}

export function privateLink(
  db: Database,
  userId: string,
  ref: GithubRef,
): LinkEntry | null {
  const row = db
    .query<LinkRow, [string, string, string, number]>(
      `SELECT ${COLUMNS} FROM github_private_links WHERE user_id = ? AND owner = ? AND repo = ? AND number = ?`,
    )
    .get(userId, ref.owner, ref.repo, ref.number)
  return row ? toEntry(row) : null
}

export function putPublicLink(
  db: Database,
  ref: GithubRef,
  entry: LinkEntry,
): void {
  db.query(
    `INSERT INTO github_public_links (owner, repo, number, ${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (owner, repo, number) DO UPDATE SET status = excluded.status, kind = excluded.kind,
       title = excluded.title, state = excluded.state, fetched_at = excluded.fetched_at`,
  ).run(
    ref.owner,
    ref.repo,
    ref.number,
    entry.status,
    entry.kind,
    entry.title,
    entry.state,
    entry.fetchedAt,
  )
}

export function putPrivateLink(
  db: Database,
  userId: string,
  ref: GithubRef,
  entry: LinkEntry,
): void {
  db.query(
    `INSERT INTO github_private_links (user_id, owner, repo, number, ${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, owner, repo, number) DO UPDATE SET status = excluded.status, kind = excluded.kind,
       title = excluded.title, state = excluded.state, fetched_at = excluded.fetched_at`,
  ).run(
    userId,
    ref.owner,
    ref.repo,
    ref.number,
    entry.status,
    entry.kind,
    entry.title,
    entry.state,
    entry.fetchedAt,
  )
}

/** Visibilidad conocida del repo, o `null` si nunca se consultó. */
export function repoVisibility(
  db: Database,
  ref: { owner: string; repo: string },
): { private: boolean; checkedAt: number } | null {
  const row = db
    .query<{ private: number; checked_at: number }, [string, string]>(
      'SELECT private, checked_at FROM github_repos WHERE owner = ? AND repo = ?',
    )
    .get(ref.owner, ref.repo)
  return row ? { private: row.private === 1, checkedAt: row.checked_at } : null
}

/**
 * Recuerda la visibilidad de un repo. Si pasa a privado, lo que hubiera en el caché global se borra: la tabla pública
 * nunca guarda nada de un repo privado.
 */
export function putRepoVisibility(
  db: Database,
  ref: { owner: string; repo: string },
  isPrivate: boolean,
  now: number,
): void {
  db.transaction(() => {
    db.query(
      `INSERT INTO github_repos (owner, repo, private, checked_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (owner, repo) DO UPDATE SET private = excluded.private, checked_at = excluded.checked_at`,
    ).run(ref.owner, ref.repo, isPrivate ? 1 : 0, now)
    if (isPrivate)
      db.query(
        'DELETE FROM github_public_links WHERE owner = ? AND repo = ?',
      ).run(ref.owner, ref.repo)
  })()
}
