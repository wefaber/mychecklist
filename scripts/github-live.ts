/**
 * Prueba contra GitHub de verdad (ADR 0006): corre el mismo lote que usa el servidor y muestra lo que devuelve.
 * No toca ninguna base ni necesita la GitHub App; cualquier token con lectura sirve para repos públicos.
 *
 *   GITHUB_TOKEN=$(gh auth token) bun scripts/github-live.ts <url> [<url> ...]
 *
 * Sin URLs consulta dos issues y un PR públicos conocidos. El token solo viaja a api.github.com y no se imprime.
 */
import { githubKey, normalizeRef, parseGithubUrl } from '../shared/github'
import { createGithubApi } from '../server/github/api'

const token = process.env.GITHUB_TOKEN
if (!token) {
  console.error(
    'Falta GITHUB_TOKEN (por ejemplo: GITHUB_TOKEN=$(gh auth token))',
  )
  process.exit(1)
}

const urls = process.argv.slice(2)
if (urls.length === 0)
  urls.push(
    'https://github.com/oven-sh/bun/issues/1',
    'https://github.com/facebook/react/pull/1',
    'https://github.com/nadie-existe-xyz/nada/issues/1',
  )

const refs = urls.flatMap((url) => {
  const ref = parseGithubUrl(url)
  if (!ref)
    console.log(`ignorada (no es un issue ni un PR de github.com): ${url}`)
  return ref ? [normalizeRef(ref)] : []
})

const { repos, rate } = await createGithubApi(null).query(token, refs)
for (const repo of repos) {
  const visibility = !repo.found
    ? 'no se ve'
    : repo.isPrivate
      ? 'privado'
      : 'público'
  console.log(`${repo.owner}/${repo.repo} (${visibility})`)
  for (const [number, link] of repo.links)
    console.log(
      `  ${githubKey({ owner: repo.owner, repo: repo.repo, number })}  ` +
        (link ? `${link.kind} ${link.state}  ${link.title}` : 'no encontrado'),
    )
}
if (rate)
  console.log(
    `límite restante: ${rate.remaining} (se reinicia ${new Date(rate.resetAt).toISOString()})`,
  )
