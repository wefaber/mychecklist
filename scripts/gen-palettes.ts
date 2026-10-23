/**
 * Genera `web/styles/palettes.css`: los cuatro temas de `@wefaber/tokens` (cada uno define `:root`) acotados por
 * `data-palette`, así se cambian en caliente. `bun scripts/gen-palettes.ts` reescribe el archivo y
 * `scripts/gen-palettes.test.ts` falla si quedó desactualizado respecto de la versión instalada de los tokens.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const PALETTES = ['forest', 'azul', 'teal', 'vault'] as const

/** Acota un tema: `:root` pasa a `[data-palette]` y las variantes `.light`/`.dark` a `[data-theme]` dentro de él. */
export function scopePalette(css: string, name: string): string {
  const base =
    name === 'forest'
      ? `:root:not([data-palette]),\n:root[data-palette="forest"]`
      : `:root[data-palette="${name}"]`
  return css
    .replace(/\/\*[\s\S]*?\*\/\s*/g, (m) => (m.includes('\n\n') ? m : ''))
    .replace(
      /:root\.(light|dark),\s*:root\[data-theme="\1"\]/g,
      `:root[data-palette="${name}"][data-theme="$1"]`,
    )
    .replace(/^:root \{/gm, `${base} {`)
}

export function generate(root: string): string {
  const parts = PALETTES.map((name) => {
    const css = readFileSync(
      join(root, 'node_modules/@wefaber/tokens/themes', `${name}.css`),
      'utf8',
    ).replace(/\r\n/g, '\n')
    return `/* ${name} */\n${scopePalette(css, name).trim()}\n`
  })
  return `/* Generado por scripts/gen-palettes.ts desde @wefaber/tokens: no se edita a mano. */\n\n${parts.join('\n')}`
}

export const OUT = 'web/styles/palettes.css'

if (import.meta.main) {
  const root = join(import.meta.dir, '..')
  writeFileSync(join(root, OUT), generate(root))
  console.log(`escrito ${OUT}`)
}
