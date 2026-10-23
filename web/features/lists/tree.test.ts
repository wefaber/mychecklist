import { describe, expect, test } from 'bun:test'
import type { Item } from './api'
import {
  buildTree,
  dropTarget,
  flatten,
  indentTarget,
  outdentTarget,
  previousSibling,
  stepTarget,
} from './tree'

const item = (id: string, parentId: string | null = null): Item => ({
  id,
  listId: 'l',
  parentId,
  position: id,
  text: id,
  done: false,
  doneAt: null,
  createdAt: '',
  updatedAt: '',
  mentions: [],
})

// a (a1, a2), b, c
const items = [
  item('a'),
  item('a1', 'a'),
  item('a2', 'a'),
  item('b'),
  item('c'),
]
const by = (id: string) => items.find((i) => i.id === id)!

describe('árbol', () => {
  test('arma el árbol y lo aplana en orden visual', () => {
    const tree = buildTree(items)
    expect(tree.map((n) => n.item.id)).toEqual(['a', 'b', 'c'])
    expect(tree[0]!.children.map((i) => i.id)).toEqual(['a1', 'a2'])
    expect(flatten(tree).map((i) => i.id)).toEqual(['a', 'a1', 'a2', 'b', 'c'])
  })

  test('hermano anterior dentro del mismo contenedor', () => {
    expect(previousSibling(items, by('b'))?.id).toBe('a')
    expect(previousSibling(items, by('a2'))?.id).toBe('a1')
    expect(previousSibling(items, by('a'))).toBeNull()
    expect(previousSibling(items, by('a1'))).toBeNull()
  })
})

describe('mover con teclado', () => {
  test('Alt+↑ y Alt+↓ entre hermanos', () => {
    expect(stepTarget(items, by('c'), 'up')).toEqual({
      parentId: null,
      afterId: 'a',
    })
    expect(stepTarget(items, by('b'), 'up')).toEqual({
      parentId: null,
      afterId: null,
    })
    expect(stepTarget(items, by('a'), 'up')).toBeNull()
    expect(stepTarget(items, by('a'), 'down')).toEqual({
      parentId: null,
      afterId: 'b',
    })
    expect(stepTarget(items, by('c'), 'down')).toBeNull()
    expect(stepTarget(items, by('a1'), 'down')).toEqual({
      parentId: 'a',
      afterId: 'a2',
    })
  })

  test('Tab: último subitem del anterior; no si tiene subitems ni si ya es subitem', () => {
    expect(indentTarget(items, by('b'))).toEqual({
      parentId: 'a',
      afterId: 'a2',
    })
    expect(indentTarget(items, by('a'))).toBeNull()
    expect(indentTarget(items, by('a1'))).toBeNull()
    const onlyB = [item('a'), item('b')]
    expect(indentTarget(onlyB, onlyB[1]!)).toEqual({
      parentId: 'a',
      afterId: null,
    })
  })

  test('Shift+Tab: sale justo después de su padre', () => {
    expect(outdentTarget(by('a1'))).toEqual({ parentId: null, afterId: 'a' })
    expect(outdentTarget(by('b'))).toBeNull()
  })
})

describe('arrastrar', () => {
  test('antes y después de un item de primer nivel', () => {
    expect(dropTarget(items, by('c'), by('b'), 'before')).toEqual({
      parentId: null,
      afterId: 'a',
    })
    expect(dropTarget(items, by('c'), by('a'), 'before')).toEqual({
      parentId: null,
      afterId: null,
    })
    expect(dropTarget(items, by('c'), by('b'), 'after')).toEqual({
      parentId: null,
      afterId: 'b',
    })
  })

  test('sobre un subitem entra a esa rama', () => {
    expect(dropTarget(items, by('c'), by('a2'), 'before')).toEqual({
      parentId: 'a',
      afterId: 'a1',
    })
    expect(dropTarget(items, by('c'), by('a1'), 'before')).toEqual({
      parentId: 'a',
      afterId: null,
    })
  })

  test('un item con subitems no entra a una rama: queda junto al padre', () => {
    expect(dropTarget(items, by('a'), by('a1'), 'after')).toBeNull() // su propio hijo
    const more = [...items, item('d'), item('d1', 'd')]
    expect(
      dropTarget(
        more,
        more.find((i) => i.id === 'a')!,
        more.find((i) => i.id === 'd1')!,
        'before',
      ),
    ).toEqual({
      parentId: null,
      afterId: 'd',
    })
  })

  test('sobre sí mismo no hace nada', () => {
    expect(dropTarget(items, by('b'), by('b'), 'after')).toBeNull()
  })
})
