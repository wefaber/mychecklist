import { describe, expect, test } from 'bun:test'
import { pickOrg } from './active'

const personal = { id: 'p', kind: 'personal' as const, name: 'alice' }
const team = { id: 't', kind: 'team' as const, name: 'equipo' }

describe('pickOrg', () => {
  test('usa la org activa si sigue en la lista', () => {
    expect(pickOrg([personal, team], 't')).toBe(team)
  })

  test('cae a la personal si la activa ya no está o no hay ninguna', () => {
    expect(pickOrg([personal], 't')).toBe(personal)
    expect(pickOrg([personal, team], null)).toBe(personal)
  })

  test('sin orgs devuelve null', () => {
    expect(pickOrg([], 't')).toBeNull()
  })
})
