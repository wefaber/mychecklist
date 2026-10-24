import { describe, expect, test } from 'bun:test'
import { tokenState, type ApiToken } from './api'

const base: ApiToken = {
  id: 'a',
  name: 'agente',
  mode: 'write',
  hint: 'abcd',
  createdAt: '2026-10-01T00:00:00.000Z',
  lastUsedAt: null,
  expiresAt: null,
  revokedAt: null,
}

describe('tokenState', () => {
  const now = Date.parse('2026-10-23T00:00:00.000Z')

  test('sin vencimiento ni revocación está activo', () => {
    expect(tokenState(base, now)).toBe('active')
  })

  test('vence en la fecha dada', () => {
    expect(
      tokenState({ ...base, expiresAt: '2026-10-22T00:00:00.000Z' }, now),
    ).toBe('expired')
    expect(
      tokenState({ ...base, expiresAt: '2026-11-22T00:00:00.000Z' }, now),
    ).toBe('active')
  })

  test('revocado gana sobre vencido', () => {
    expect(
      tokenState(
        {
          ...base,
          revokedAt: '2026-10-02T00:00:00.000Z',
          expiresAt: '2026-10-03T00:00:00.000Z',
        },
        now,
      ),
    ).toBe('revoked')
  })
})
