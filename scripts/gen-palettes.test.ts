import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { generate, OUT, PALETTES, scopePalette } from './gen-palettes'

const root = join(import.meta.dir, '..')

describe('gen-palettes', () => {
  test('acota `:root` y las variantes de modo por paleta', () => {
    const css = `:root {\n  --bg: red;\n}\n:root.dark,\n:root[data-theme="dark"] {\n  --bg: black;\n}\n`
    const out = scopePalette(css, 'azul')
    expect(out).toContain(':root[data-palette="azul"] {')
    expect(out).toContain(':root[data-palette="azul"][data-theme="dark"] {')
    expect(out).not.toMatch(/^:root \{/m)
  })

  test('forest sigue siendo el tema sin atributo', () => {
    expect(scopePalette(':root {\n}\n', 'forest')).toContain(
      ':root:not([data-palette])',
    )
  })

  test('el archivo commiteado coincide con los tokens instalados', () => {
    const committed = readFileSync(join(root, OUT), 'utf8').replace(
      /\r\n/g,
      '\n',
    )
    expect(committed).toBe(generate(root))
  })

  test('cada paleta aparece una vez', () => {
    const css = generate(root)
    for (const p of PALETTES)
      expect(
        css.match(new RegExp(`:root\\[data-palette="${p}"\\] \\{`, 'g')),
      ).toHaveLength(1)
  })
})
