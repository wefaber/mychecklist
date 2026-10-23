/**
 * Enforces the data-access rules (ARCHITECTURE.md › Isolation below the API):
 *  1. SQL appears only under server/db/.
 *  2. Org-owned tables are touched only by server/db/scoped.ts.
 *  3. In scoped.ts every statement on those tables mentions org_id.
 * Heuristic on purpose: it reads source text, so a violation is a loud failure, not a subtle runtime bug.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const SQL =
  /\b(SELECT\b[^`'"]*\bFROM\b|INSERT\s+INTO\b|UPDATE\s+\w+\s+SET\b|DELETE\s+FROM\b)/i
// Org-owned tables. Each milestone that adds one lists it here (M1 starts with lists, items, item_links, ...).
export const OWNED_TABLES: string[] = []
const OWNED = OWNED_TABLES.length
  ? new RegExp(`\\b(${OWNED_TABLES.join('|')})\\b`)
  : /(?!)/
const ALLOWED_OWNED = new Set(['server/db/scoped.ts'])

export type Violation = { file: string; rule: 1 | 2 | 3; text: string }

/** String literals (single, double, template) as raw text. Good enough for statements written inline. */
function literals(source: string): string[] {
  return [
    ...source.matchAll(
      /`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g,
    ),
  ].map((m) => m[0])
}

export function findViolations(
  files: { path: string; source: string }[],
  owned: RegExp = OWNED,
): Violation[] {
  const out: Violation[] = []
  for (const { path, source } of files) {
    const inDb = path.startsWith('server/db/')
    const isTest = path.endsWith('.test.ts')
    const isMigrate = path === 'server/db/migrate.ts'
    for (const lit of literals(source)) {
      if (!SQL.test(lit)) continue
      const snippet = lit.replace(/\s+/g, ' ').slice(0, 90)
      if (!inDb && !isTest && path !== 'scripts/check-scoped.ts') {
        out.push({ file: path, rule: 1, text: snippet })
      } else if (
        inDb &&
        !isTest &&
        !isMigrate &&
        owned.test(lit) &&
        !ALLOWED_OWNED.has(path)
      ) {
        out.push({ file: path, rule: 2, text: snippet })
      } else if (
        path === 'server/db/scoped.ts' &&
        owned.test(lit) &&
        !/\borg_id\b/.test(lit)
      ) {
        out.push({ file: path, rule: 3, text: snippet })
      }
    }
  }
  return out
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, acc)
    else if (/\.(ts|tsx)$/.test(name)) acc.push(full)
  }
  return acc
}

if (import.meta.main) {
  const root = join(import.meta.dir, '..')
  const files = ['server', 'shared', 'scripts', 'web']
    .flatMap((d) => walk(join(root, d)))
    .map((full) => ({
      path: relative(root, full).split(sep).join('/'),
      source: readFileSync(full, 'utf8'),
    }))
  const violations = findViolations(files)
  for (const v of violations)
    console.error(`rule ${v.rule}  ${v.file}  ${v.text}`)
  if (violations.length) process.exit(1)
  console.log(`check-scoped: ${files.length} files, 0 violations`)
}
