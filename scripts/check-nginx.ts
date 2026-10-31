/**
 * Valida los vhosts de deploy/nginx antes de que lleguen al VPS (deploy/README.md, paso 5):
 *  1. Llaves balanceadas.
 *  2. Ningún `server` repite una misma `location` (nginx -t falla con "duplicate location" y el vhost no se instala).
 * Lee texto, no ejecuta nginx: es una puerta barata para CI; el `nginx -t` real corre en el VPS.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

export type Problem = { file: string; text: string }

const stripComments = (source: string) =>
  source
    .split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, ''))
    .join('\n')

export function findProblems(path: string, source: string): Problem[] {
  const text = stripComments(source)
  const out: Problem[] = []
  let depth = 0
  for (const ch of text) {
    if (ch === '{') depth++
    else if (ch === '}') depth--
    if (depth < 0) break
  }
  if (depth !== 0) {
    out.push({ file: path, text: 'llaves sin balancear' })
    return out
  }

  // Un `server { ... }` a la vez; las locations son las que abren con `location ... {` dentro de él.
  const re = /\bserver\s*\{/g
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let d = 1
    let i = m.index + m[0].length
    const start = i
    for (; i < text.length && d > 0; i++) {
      if (text[i] === '{') d++
      else if (text[i] === '}') d--
    }
    const body = text.slice(start, i - 1)
    const seen = new Map<string, number>()
    for (const l of body.matchAll(/\blocation\s+((?:[=~^]\*?\s+)?\S+)\s*\{/g)) {
      const key = l[1]!.replace(/\s+/g, ' ')
      seen.set(key, (seen.get(key) ?? 0) + 1)
    }
    for (const [key, n] of seen)
      if (n > 1)
        out.push({ file: path, text: `location ${key} repetida ${n} veces` })
  }
  return out
}

if (import.meta.main) {
  const root = join(import.meta.dir, '..')
  const dir = join(root, 'deploy', 'nginx')
  const files = readdirSync(dir).filter((n) => n.endsWith('.conf'))
  const problems = files.flatMap((n) => {
    const full = join(dir, n)
    return findProblems(
      relative(root, full).split(sep).join('/'),
      readFileSync(full, 'utf8'),
    )
  })
  for (const p of problems) console.error(`${p.file}  ${p.text}`)
  if (problems.length) process.exit(1)
  console.log(`check-nginx: ${files.length} vhosts, 0 problemas`)
}
