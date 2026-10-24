/**
 * Genera la API de agentes publicada (ADR 0002): `server/mcp/generated/checklist.d.ts` y `spec.json`, ambos desde
 * `server/services/registry.ts`. `bun scripts/gen-codemode.ts` reescribe los archivos y
 * `scripts/gen-codemode.test.ts` falla si quedaron desactualizados, así que `bun run check` lo exige.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { buildSpec, renderDts } from '../server/mcp/spec'

export const OUT_DTS = 'server/mcp/generated/checklist.d.ts'
export const OUT_SPEC = 'server/mcp/generated/spec.json'

export function generate(): { dts: string; spec: string } {
  return {
    dts: renderDts(),
    spec: `${JSON.stringify(buildSpec('write'), null, 2)}\n`,
  }
}

if (import.meta.main) {
  const root = join(import.meta.dir, '..')
  const { dts, spec } = generate()
  for (const [path, text] of [
    [OUT_DTS, dts],
    [OUT_SPEC, spec],
  ] as const) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
    console.log(`escrito ${path}`)
  }
}
