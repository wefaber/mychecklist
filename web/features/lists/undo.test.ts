import { beforeEach, describe, expect, test } from 'bun:test'
import { useUndoStack } from './undo'

const entry = (label: string) => ({ label, undo: async () => {} })

describe('pila de deshacer', () => {
  beforeEach(() => useUndoStack.getState().clear())

  test('saca de a una, la última primero', () => {
    const s = useUndoStack.getState()
    s.push(entry('a'))
    s.push(entry('b'))
    expect(s.pop()?.label).toBe('b')
    expect(s.pop()?.label).toBe('a')
    expect(s.pop()).toBeNull()
  })

  test('guarda las últimas 50', () => {
    const s = useUndoStack.getState()
    for (let i = 0; i < 60; i++) s.push(entry(String(i)))
    expect(useUndoStack.getState().stack).toHaveLength(50)
    expect(useUndoStack.getState().stack[0]!.label).toBe('10')
  })
})
