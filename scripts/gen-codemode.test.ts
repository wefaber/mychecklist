import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { renderDts, staleGenerated } from '@wefaber/codemode'
import { registry } from '../server/services/registry'

const out = join(import.meta.dir, '..', 'server/mcp/generated')

describe('codemode generado', () => {
  test('spec.json y client.d.ts commiteados coinciden con el registry (bun run gen)', () => {
    expect(staleGenerated(registry, out)).toEqual([])
  })

  test('el d.ts declara cada operación y los tipos con nombre', () => {
    const dts = renderDts(registry)
    expect(dts).toContain('interface Item {')
    expect(dts).toContain('declare const codemode: {')
    expect(dts).toContain('create(input: {')
    expect(dts).toContain('Promise<Item[]>')
  })
})
