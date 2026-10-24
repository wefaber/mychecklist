import { describe, expect, test } from 'bun:test'
import { canRemove } from './api'

describe('canRemove', () => {
  test('el owner saca a cualquiera', () => {
    expect(canRemove('owner', 'owner')).toBe(true)
    expect(canRemove('owner', 'admin')).toBe(true)
    expect(canRemove('owner', 'member')).toBe(true)
  })

  test('el admin solo saca members', () => {
    expect(canRemove('admin', 'member')).toBe(true)
    expect(canRemove('admin', 'admin')).toBe(false)
    expect(canRemove('admin', 'owner')).toBe(false)
  })

  test('el member no saca a nadie', () => {
    expect(canRemove('member', 'member')).toBe(false)
  })
})
