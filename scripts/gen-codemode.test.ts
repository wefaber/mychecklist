import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { generate, OUT_DTS, OUT_SPEC } from './gen-codemode'

const root = join(import.meta.dir, '..')
const read = (path: string) =>
  readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n')

describe('gen-codemode', () => {
  test('checklist.d.ts commiteado coincide con el registry', () => {
    expect(read(OUT_DTS)).toBe(generate().dts)
  })

  test('spec.json commiteado coincide con el registry', () => {
    expect(read(OUT_SPEC)).toBe(generate().spec)
  })

  test('el d.ts declara cada operación y los tipos con nombre', () => {
    const { dts } = generate()
    expect(dts).toContain('interface Item {')
    expect(dts).toContain('declare const checklist: {')
    expect(dts).toContain('create(input: {')
    expect(dts).toContain('Promise<Item[]>')
  })
})
