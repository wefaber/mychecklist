import { useQuery } from '@tanstack/react-query'
import { githubKey, normalizeRef, type GithubRef } from '@shared/github'
import { gql } from './graphql'

/** Un issue o PR de GitHub como lo devuelve `githubLinks` (ADR 0006). */
export type GithubLink = {
  owner: string
  repo: string
  number: number
  /** `unavailable`: sin dato (sin token, límite agotado o GitHub caído); el chip queda como link. */
  status: 'ok' | 'not_found' | 'unavailable'
  kind: 'issue' | 'pull' | null
  title: string | null
  state: 'open' | 'closed' | 'not_planned' | 'draft' | 'merged' | null
  /** Lo que se ve es de antes de su TTL y el servidor no pudo refrescarlo. */
  stale: boolean
  fetchedAt: string | null
}

const QUERY = `query($refs: [GithubLinkInput!]!) {
  githubLinks(refs: $refs) { owner repo number status kind title state stale fetchedAt }
}`

/** El servidor acepta hasta 50 links por pedido (`MAX_GITHUB_REFS`). */
const MAX_BATCH = 50
/** Ventana en la que se juntan los chips que aparecen a la vez en un solo pedido. */
const WINDOW_MS = 20

type Pending = {
  ref: GithubRef
  waiters: {
    resolve: (l: GithubLink | null) => void
    reject: (e: unknown) => void
  }[]
}

/**
 * Junta los pedidos de muchos chips en pocos lotes: una lista con 40 links hace un pedido, no 40. Los repetidos
 * comparten la respuesta. `fetchBatch` devuelve los links por clave; lo que falte se resuelve como `null`.
 */
export function createBatcher(
  fetchBatch: (refs: GithubRef[]) => Promise<GithubLink[]>,
  windowMs = WINDOW_MS,
  max = MAX_BATCH,
) {
  let queue = new Map<string, Pending>()
  let timer: ReturnType<typeof setTimeout> | null = null

  async function flush() {
    timer = null
    const batch = [...queue.entries()].slice(0, max)
    for (const [key] of batch) queue.delete(key)
    if (queue.size > 0) timer = setTimeout(flush, 0)
    try {
      const links = await fetchBatch(batch.map(([, p]) => p.ref))
      const byKey = new Map(links.map((l) => [githubKey(l), l]))
      for (const [key, p] of batch)
        for (const w of p.waiters) w.resolve(byKey.get(key) ?? null)
    } catch (error) {
      for (const [, p] of batch) for (const w of p.waiters) w.reject(error)
    }
  }

  return {
    load(ref: GithubRef): Promise<GithubLink | null> {
      const key = githubKey(ref)
      return new Promise((resolve, reject) => {
        const entry = queue.get(key) ?? { ref, waiters: [] }
        entry.waiters.push({ resolve, reject })
        queue.set(key, entry)
        timer ??= setTimeout(flush, windowMs)
      })
    },
    /** Para tests: descarta lo pendiente. */
    reset() {
      if (timer) clearTimeout(timer)
      timer = null
      queue = new Map()
    },
  }
}

const loader = createBatcher(
  async (refs) =>
    (await gql<{ githubLinks: GithubLink[] }>(QUERY, { refs })).githubLinks,
)

/** El servidor decide cuándo vence cada link (5 min abierto, 1 h cerrado); el cliente pregunta con ese mismo pulso. */
const REFRESH_MS = 5 * 60_000

/**
 * Estado vivo de un link. `watch`: el chip está a la vista en el detalle, así que se repite el pedido cada 5 minutos y
 * al volver a la pestaña; en una fila solo se pide al aparecer (y cuando vence, al volver a la pestaña).
 */
export function useGithubLink(ref: GithubRef, watch: boolean) {
  const normal = normalizeRef(ref)
  return useQuery({
    queryKey: ['github-link', githubKey(normal)],
    queryFn: () => loader.load(normal),
    staleTime: REFRESH_MS,
    refetchInterval: watch ? REFRESH_MS : false,
    refetchOnWindowFocus: true,
    retry: 1,
  })
}
