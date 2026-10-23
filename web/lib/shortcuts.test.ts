import { describe, expect, test } from 'bun:test'
import { matchesStep, type KeyLike } from './shortcuts'

const ev = (key: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
})

describe('matchesStep', () => {
  test('Mod vale con Ctrl o con Cmd', () => {
    expect(matchesStep(ev('k', { ctrlKey: true }), 'Mod+K')).toBe(true)
    expect(matchesStep(ev('k', { metaKey: true }), 'Mod+K')).toBe(true)
    expect(matchesStep(ev('k'), 'Mod+K')).toBe(false)
    expect(matchesStep(ev('k', { ctrlKey: true, altKey: true }), 'Mod+K')).toBe(
      false,
    )
  })

  test('una letra sola no se dispara con modificadores', () => {
    expect(matchesStep(ev('n'), 'N')).toBe(true)
    expect(matchesStep(ev('n', { ctrlKey: true }), 'N')).toBe(false)
    expect(matchesStep(ev('n', { altKey: true }), 'N')).toBe(false)
  })

  test('teclas con nombre y Alt', () => {
    expect(matchesStep(ev('ArrowUp', { altKey: true }), 'Alt+ArrowUp')).toBe(
      true,
    )
    expect(matchesStep(ev('ArrowUp'), 'Alt+ArrowUp')).toBe(false)
    expect(matchesStep(ev('Enter', { ctrlKey: true }), 'Mod+Enter')).toBe(true)
  })

  test('Shift es parte del paso en las letras y no molesta en los símbolos', () => {
    expect(matchesStep(ev('Tab', { shiftKey: true }), 'Shift+Tab')).toBe(true)
    expect(matchesStep(ev('Tab'), 'Shift+Tab')).toBe(false)
    expect(
      matchesStep(ev('Z', { ctrlKey: true, shiftKey: true }), 'Mod+Shift+Z'),
    ).toBe(true)
    expect(matchesStep(ev('z', { ctrlKey: true }), 'Mod+Shift+Z')).toBe(false)
    expect(matchesStep(ev('?', { shiftKey: true }), '?')).toBe(true)
    expect(matchesStep(ev('?'), '?')).toBe(true)
  })
})
