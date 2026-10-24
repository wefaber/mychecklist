/**
 * Links a issues y PRs de GitHub (ADR 0006). El mismo código reconoce la URL en el cliente (para dibujar el chip) y
 * en el servidor (para validar lo que se pide), así nunca hay un link que el cliente pida y el servidor no entienda.
 */

/** Un issue o PR; GitHub no distingue mayúsculas en dueño ni repo, así que la clave va en minúsculas. */
export type GithubRef = { owner: string; repo: string; number: number }

/** Tope de links por pedido: acota el trabajo del servidor y el gasto del límite de la API. */
export const MAX_GITHUB_REFS = 50

const OWNER = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/
const REPO = /^[A-Za-z0-9._-]{1,100}$/
const NUMBER = /^[1-9][0-9]{0,8}$/

/** Subrutas de un PR que siguen siendo "el PR" (no un commit ni un comentario suelto). */
const PULL_TABS = new Set(['files', 'commits', 'checks'])

export function isValidRef(ref: GithubRef): boolean {
  return (
    OWNER.test(ref.owner) &&
    REPO.test(ref.repo) &&
    ref.repo !== '.' &&
    ref.repo !== '..' &&
    Number.isInteger(ref.number) &&
    ref.number >= 1 &&
    ref.number <= 999_999_999
  )
}

/** Clave estable para caché y comparaciones: `owner/repo#n` en minúsculas. */
export const githubKey = (ref: GithubRef) =>
  `${ref.owner}/${ref.repo}#${ref.number}`.toLowerCase()

/** El mismo link con otro texto de dueño o repo, siempre en minúsculas, listo para guardar. */
export const normalizeRef = (ref: GithubRef): GithubRef => ({
  owner: ref.owner.toLowerCase(),
  repo: ref.repo.toLowerCase(),
  number: ref.number,
})

/**
 * Issue o PR que nombra una URL de `github.com`, o `null` si no es una. Solo `https:`, sin usuario ni puerto, sin
 * otros hosts (GitHub Enterprise queda fuera). `/issues/n` y `/pull/n` valen igual: GitHub redirige uno al otro.
 */
export function parseGithubUrl(raw: string): GithubRef | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (
    url.protocol !== 'https:' ||
    (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') ||
    url.username ||
    url.password ||
    url.port
  )
    return null
  const parts = url.pathname.split('/').filter(Boolean)
  const [owner, repo, kind, number, ...rest] = parts
  if (!owner || !repo || !number) return null
  if (kind !== 'issues' && kind !== 'pull') return null
  if (rest.length > 0) {
    const tabOk =
      kind === 'pull' && rest.length === 1 && PULL_TABS.has(rest[0]!)
    if (!tabOk) return null
  }
  if (!NUMBER.test(number)) return null
  const ref = { owner, repo, number: Number(number) }
  return isValidRef(ref) ? ref : null
}

/**
 * ¿Este link se dibuja como chip? Solo si el texto es la propia URL (pegada suelta, autolink de `remark-gfm` o
 * `[url](url)`); un `[texto](url)` conserva el texto que escribió la persona y es un link normal.
 */
export function githubRefOfLink(href: string, text: string): GithubRef | null {
  return text.trim() === href ? parseGithubUrl(href) : null
}
