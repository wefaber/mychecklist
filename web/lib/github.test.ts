import { describe, expect, test } from 'bun:test'
import type { GithubRef } from '@shared/github'
import { createBatcher, type GithubLink } from './github'

const ref = (repo: string, number: number): GithubRef => ({
  owner: 'wefaber',
  repo,
  number,
})

const linkOf = (r: GithubRef): GithubLink => ({
  ...r,
  status: 'ok',
  kind: 'issue',
  title: `${r.repo} ${r.number}`,
  state: 'open',
  stale: false,
  fetchedAt: null,
})

describe('createBatcher', () => {
  test('los chips que aparecen a la vez salen en un solo pedido', async () => {
    const batches: string[][] = []
    const b = createBatcher(async (refs) => {
      batches.push(refs.map((r) => `${r.repo}#${r.number}`))
      return refs.map(linkOf)
    }, 5)
    const out = await Promise.all([
      b.load(ref('a', 1)),
      b.load(ref('a', 2)),
      b.load(ref('b', 3)),
    ])
    expect(batches).toEqual([['a#1', 'a#2', 'b#3']])
    expect(out.map((l) => l?.title)).toEqual(['a 1', 'a 2', 'b 3'])
  })

  test('el mismo link pedido dos veces se consulta una vez y los dos reciben la respuesta', async () => {
    const batches: number[] = []
    const b = createBatcher(async (refs) => {
      batches.push(refs.length)
      return refs.map(linkOf)
    }, 5)
    const [x, y] = await Promise.all([
      b.load(ref('a', 1)),
      // GitHub no distingue mayúsculas: la clave es la misma.
      b.load({ owner: 'WeFaber', repo: 'A', number: 1 }),
    ])
    expect(batches).toEqual([1])
    expect(x?.title).toBe('a 1')
    expect(y?.title).toBe('a 1')
  })

  test('más de 50 links se parten en pedidos de 50', async () => {
    const sizes: number[] = []
    const b = createBatcher(async (refs) => {
      sizes.push(refs.length)
      return refs.map(linkOf)
    }, 5)
    const all = await Promise.all(
      Array.from({ length: 120 }, (_, i) => b.load(ref('a', i + 1))),
    )
    expect(sizes).toEqual([50, 50, 20])
    expect(all.every((l) => l !== null)).toBe(true)
  })

  test('lo que el servidor no devuelve se resuelve como null', async () => {
    const b = createBatcher(async (refs) => [linkOf(refs[0]!)], 5)
    const [found, missing] = await Promise.all([
      b.load(ref('a', 1)),
      b.load(ref('a', 2)),
    ])
    expect(found?.number).toBe(1)
    expect(missing).toBeNull()
  })

  test('si el pedido falla, todos los que esperaban fallan y el siguiente funciona', async () => {
    let fail = true
    const b = createBatcher(async (refs) => {
      if (fail) throw new Error('sin red')
      return refs.map(linkOf)
    }, 5)
    const results = await Promise.allSettled([
      b.load(ref('a', 1)),
      b.load(ref('a', 2)),
    ])
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected'])
    fail = false
    expect((await b.load(ref('a', 1)))?.title).toBe('a 1')
  })
})
