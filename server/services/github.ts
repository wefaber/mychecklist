import type { Database } from 'bun:sqlite'
import {
  githubKey,
  isValidRef,
  MAX_GITHUB_REFS,
  normalizeRef,
  type GithubRef,
} from '../../shared/github'
import type { GithubClient } from '../auth/github'
import {
  privateLink,
  publicLink,
  putPrivateLink,
  putPublicLink,
  putRepoVisibility,
  repoKey,
  repoVisibility,
  type GithubKind,
  type GithubState,
  type LinkEntry,
} from '../db/github'
import { DomainError } from '../errors'
import {
  BATCH_SIZE,
  GithubApiError,
  type GithubApi,
  type QueryResult,
} from '../github/api'
import { userTokens } from '../github/tokens'
import type { Caller } from './types'

/**
 * Links a issues y PRs de GitHub (ADR 0006). Dos caminos según la visibilidad del repo: lo público se consulta con el
 * token de instalación de la App y se comparte entre todos; lo privado, con el token de quien mira y queda en su caché.
 * A la tabla global solo entra lo que GitHub respondió con `isPrivate: false`.
 */

/** Cuánto vale lo guardado antes de volver a consultar. */
export const TTL = {
  /** Abierto o borrador: puede cambiar en cualquier momento. */
  live: 5 * 60_000,
  /** Cerrado o mergeado: casi nunca cambia. */
  done: 60 * 60_000,
  /** No existe o no se ve: se vuelve a mirar pronto, por si se creó o se dio acceso. */
  missing: 10 * 60_000,
  /** Visibilidad de un repo. */
  repo: 60 * 60_000,
} as const

/** Por debajo de esto el servidor deja de consultar con ese token hasta que el límite se reinicia. */
export const LOW_WATER = 200
const AFTER_UNAUTHORIZED_MS = 5 * 60_000
const AFTER_FAILURE_MS = 30_000
const AFTER_RATE_LIMIT_MS = 60_000

export type LinkStatus = 'ok' | 'not_found' | 'unavailable'

/** Un link resuelto. `unavailable` = no hay dato (sin token, sin acceso a la API o límite agotado). */
export type GithubLinkView = {
  owner: string
  repo: string
  number: number
  status: LinkStatus
  kind: GithubKind | null
  title: string | null
  state: GithubState | null
  /** Lo que se muestra es de antes de su TTL y no se pudo refrescar. */
  stale: boolean
  fetchedAt: number | null
}

export type GithubLinks = {
  resolve(caller: Caller, refs: GithubRef[]): Promise<GithubLinkView[]>
}

type Deps = {
  db: Database
  api: GithubApi
  login: GithubClient | null
  tokenKey: Uint8Array | null
  now?: () => number
}

const fresh = (entry: LinkEntry, now: number) => {
  const age = now - entry.fetchedAt
  if (entry.status === 'not_found') return age < TTL.missing
  const done =
    entry.state === 'closed' ||
    entry.state === 'merged' ||
    entry.state === 'not_planned'
  return age < (done ? TTL.done : TTL.live)
}

export function createGithubLinks(deps: Deps): GithubLinks {
  const { db, api } = deps
  const now = deps.now ?? Date.now
  const tokens = userTokens({
    db,
    login: deps.login,
    tokenKey: deps.tokenKey,
    now,
  })
  /** Hasta cuándo no se consulta con cada token (`app`, `user:<id>`): límite bajo, token rechazado o GitHub caído. */
  const blocked = new Map<string, number>()
  const isBlocked = (scope: string) => (blocked.get(scope) ?? 0) > now()

  /** Consulta un lote; cualquier falla bloquea el token un rato y se relanza para que lo decida quien llama. */
  async function run(
    scope: string,
    token: string,
    refs: GithubRef[],
  ): Promise<QueryResult> {
    try {
      const result = await api.query(token, refs)
      if (result.rate && result.rate.remaining < LOW_WATER)
        blocked.set(scope, result.rate.resetAt)
      return result
    } catch (error) {
      const failure =
        error instanceof GithubApiError
          ? error
          : new GithubApiError('unavailable', String(error))
      const wait =
        failure.kind === 'unauthorized'
          ? AFTER_UNAUTHORIZED_MS
          : failure.kind === 'rate_limited'
            ? failure.retryAt
              ? Math.max(failure.retryAt - now(), AFTER_RATE_LIMIT_MS)
              : AFTER_RATE_LIMIT_MS
            : AFTER_FAILURE_MS
      blocked.set(scope, now() + wait)
      console.error(
        `github ${scope.split(':')[0]} query failed:`,
        failure.message,
      )
      throw failure
    }
  }

  const chunks = (refs: GithubRef[]) => {
    const out: GithubRef[][] = []
    for (let i = 0; i < refs.length; i += BATCH_SIZE)
      out.push(refs.slice(i, i + BATCH_SIZE))
    return out
  }

  return {
    async resolve(caller, input) {
      if (input.length > MAX_GITHUB_REFS)
        throw new DomainError(
          'INVALID_INPUT',
          `Se piden hasta ${MAX_GITHUB_REFS} links a la vez`,
        )
      const byKey = new Map<string, GithubRef>()
      for (const raw of input) {
        if (!isValidRef(raw))
          throw new DomainError('INVALID_INPUT', 'Link de GitHub inválido')
        const ref = normalizeRef(raw)
        byKey.set(githubKey(ref), ref)
      }
      const refs = [...byKey.values()]
      const userId = caller.userId
      const t = now()

      // Lo que se sabe hoy de cada link: el más nuevo entre el caché global y el del usuario.
      const current = new Map<string, LinkEntry>()
      for (const ref of refs) {
        const pub = publicLink(db, ref)
        const priv = privateLink(db, userId, ref)
        const best =
          pub && priv
            ? priv.fetchedAt > pub.fetchedAt
              ? priv
              : pub
            : (pub ?? priv)
        if (best) current.set(githubKey(ref), best)
      }
      const stale = refs.filter((r) => {
        const e = current.get(githubKey(r))
        return !e || !fresh(e, t)
      })

      const knownPrivate = new Set<string>()
      for (const ref of stale) {
        const v = repoVisibility(db, ref)
        if (v?.private && t - v.checkedAt < TTL.repo)
          knownPrivate.add(repoKey(ref))
      }

      const store = (
        ref: GithubRef,
        link: { kind: GithubKind; title: string; state: GithubState } | null,
        scope: 'public' | 'private',
      ) => {
        const entry: LinkEntry = link
          ? { status: 'ok', ...link, fetchedAt: t }
          : {
              status: 'not_found',
              kind: null,
              title: null,
              state: null,
              fetchedAt: t,
            }
        if (scope === 'public') putPublicLink(db, ref, entry)
        else putPrivateLink(db, userId, ref, entry)
        current.set(githubKey(ref), entry)
      }

      /** Guarda un lote. Devuelve los links que siguen sin respuesta definitiva. */
      const apply = (
        result: QueryResult,
        batch: GithubRef[],
        by: 'app' | 'user',
      ): GithubRef[] => {
        const unresolved: GithubRef[] = []
        db.transaction(() => {
          for (const repo of result.repos) {
            const inRepo = batch.filter(
              (r) => r.owner === repo.owner && r.repo === repo.repo,
            )
            if (!repo.found) {
              // No existe o este token no lo ve. El token de la App no puede concluir nada; el de la persona sí
              // sabe que, para ella, no está.
              for (const ref of inRepo) {
                if (by === 'user') store(ref, null, 'private')
                else unresolved.push(ref)
              }
              continue
            }
            putRepoVisibility(db, repo, repo.isPrivate, t)
            if (repo.isPrivate && by === 'app') {
              unresolved.push(...inRepo)
              continue
            }
            for (const ref of inRepo)
              store(
                ref,
                repo.links.get(ref.number) ?? null,
                repo.isPrivate ? 'private' : 'public',
              )
          }
        })()
        return unresolved
      }

      let pending = stale

      // 1) Token de instalación: lo público, para todos. Lo que no resuelve pasa al token de quien mira.
      const appCandidates = pending.filter((r) => !knownPrivate.has(repoKey(r)))
      if (appCandidates.length && !isBlocked('app')) {
        const token = await api.installationToken()
        if (token) {
          const resolved = new Set<string>()
          for (const batch of chunks(appCandidates)) {
            if (isBlocked('app')) break
            try {
              const result = await run('app', token, batch)
              const open = new Set(apply(result, batch, 'app').map(githubKey))
              for (const ref of batch)
                if (!open.has(githubKey(ref))) resolved.add(githubKey(ref))
            } catch {
              break
            }
          }
          pending = pending.filter((r) => !resolved.has(githubKey(r)))
        }
      }

      // 2) Token de quien mira: repos privados y lo que la App no ve.
      if (pending.length && !isBlocked(`user:${userId}`)) {
        let token = await tokens.get(userId)
        if (token) {
          for (const batch of chunks(pending)) {
            if (isBlocked(`user:${userId}`)) break
            try {
              let result: QueryResult
              try {
                result = await run(`user:${userId}`, token, batch)
              } catch (error) {
                if (
                  !(error instanceof GithubApiError) ||
                  error.kind !== 'unauthorized'
                )
                  throw error
                // GitHub rechazó el token: se intenta renovar una vez.
                const renewed = await tokens.get(userId, true)
                if (!renewed) throw error
                token = renewed
                blocked.delete(`user:${userId}`)
                result = await run(`user:${userId}`, token, batch)
              }
              apply(result, batch, 'user')
            } catch {
              break
            }
          }
        }
      }

      return refs.map((ref): GithubLinkView => {
        const e = current.get(githubKey(ref))
        if (!e)
          return {
            ...ref,
            status: 'unavailable',
            kind: null,
            title: null,
            state: null,
            stale: false,
            fetchedAt: null,
          }
        return {
          ...ref,
          status: e.status,
          kind: e.kind,
          title: e.title,
          state: e.state,
          stale: !fresh(e, t),
          fetchedAt: e.fetchedAt,
        }
      })
    },
  }
}
