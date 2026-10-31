import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { findProblems } from './check-nginx'

const vhost = (locations: string) => `
server {
  listen 80;
  # location /ignorada { return 200; }
  ${locations}
}`

describe('check-nginx', () => {
  test('un vhost sin repetidas pasa', () => {
    const src = vhost(
      'location /a/ { return 200; }\n location = /mcp { return 200; }',
    )
    expect(findProblems('x.conf', src)).toEqual([])
  })

  test('una location repetida en el mismo server falla', () => {
    const src = vhost(
      'location /codemode/ { return 200; }\n location /codemode/ { return 200; }',
    )
    const p = findProblems('x.conf', src)
    expect(p).toHaveLength(1)
    expect(p[0]!.text).toContain('/codemode/')
  })

  test('el mismo path con distinto modificador no es duplicado', () => {
    const src = vhost(
      'location /a { return 200; }\n location = /a { return 200; }',
    )
    expect(findProblems('x.conf', src)).toEqual([])
  })

  test('el mismo path en servers distintos no es duplicado', () => {
    const src = `${vhost('location /a { return 200; }')}\n${vhost('location /a { return 200; }')}`
    expect(findProblems('x.conf', src)).toEqual([])
  })

  test('llaves sin balancear falla', () => {
    expect(
      findProblems('x.conf', 'server { location /a { return 200; }'),
    ).toHaveLength(1)
  })

  test('los vhosts del repo pasan', () => {
    const dir = join(import.meta.dir, '..', 'deploy', 'nginx')
    for (const n of readdirSync(dir).filter((f) => f.endsWith('.conf')))
      expect(findProblems(n, readFileSync(join(dir, n), 'utf8'))).toEqual([])
  })
})
