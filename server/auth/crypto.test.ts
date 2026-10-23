import { describe, expect, test } from 'bun:test'
import { open, randomToken, seal, sha256Hex } from './crypto'

const key = Uint8Array.from({ length: 32 }, (_, i) => i)
const other = Uint8Array.from({ length: 32 }, (_, i) => 255 - i)

describe('seal / open', () => {
  test('ida y vuelta', async () => {
    const sealed = await seal(key, 'ghu_secreto')
    expect(sealed).not.toContain('ghu_secreto')
    expect(await open(key, sealed)).toBe('ghu_secreto')
  })

  test('cada cifrado usa un IV distinto', async () => {
    expect(await seal(key, 'x')).not.toBe(await seal(key, 'x'))
  })

  test('una clave equivocada falla', async () => {
    const sealed = await seal(key, 'x')
    expect(open(other, sealed)).rejects.toThrow()
  })

  test('un valor alterado falla', async () => {
    const raw = Buffer.from(await seal(key, 'x'), 'base64')
    raw[raw.length - 1]! ^= 1
    expect(open(key, raw.toString('base64'))).rejects.toThrow()
  })
})

describe('tokens', () => {
  test('el token es opaco y distinto cada vez', () => {
    const a = randomToken()
    expect(a.length).toBeGreaterThanOrEqual(43)
    expect(a).not.toBe(randomToken())
  })

  test('sha256Hex es el digest conocido', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})
