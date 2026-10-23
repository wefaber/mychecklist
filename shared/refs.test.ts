import { describe, expect, test } from 'bun:test'
import { extractRefs, MAX_REFS, refIdOf, refUrl, splitRefs } from './refs'

const A = '01JC8Q2V3N4M5P6R7S8T9VWXYZ'
const B = '01JC8Q2V3N4M5P6R7S8T9VWXY0'

describe('splitRefs', () => {
  test('parte texto y referencias en orden', () => {
    expect(splitRefs(`ver [[${A}]] y [[${B}]] ya`)).toEqual([
      'ver ',
      { ref: A },
      ' y ',
      { ref: B },
      ' ya',
    ])
  })

  test('sin referencias devuelve el texto entero', () => {
    expect(splitRefs('nada que ver')).toEqual(['nada que ver'])
  })

  test('un id mal formado no es referencia', () => {
    for (const bad of [
      '[[corto]]',
      `[[${A.slice(1)}]]`, // 25 caracteres
      `[[${A}0]]`, // 27 caracteres
      `[[${A.toLowerCase()}]]`, // Crockford va en mayúsculas
      `[[${A.replace('V', 'U')}]]`, // la U no existe en Crockford
      `[[ ${A} ]]`,
      `[${A}]`,
    ])
      expect(splitRefs(bad)).toEqual([bad])
  })
})

describe('extractRefs', () => {
  test('ids distintos, en orden de aparición', () => {
    expect(extractRefs(`[[${B}]] luego [[${A}]] y otra vez [[${B}]]`)).toEqual([
      B,
      A,
    ])
  })

  test('cuenta dentro de énfasis, listas, citas y tablas', () => {
    const text = [
      `**fuerte [[${A}]]**`,
      '',
      `- uno [[${B}]]`,
      '',
      `> cita [[${A}]]`,
      '',
      '| a | b |',
      '| - | - |',
      `| x | [[${B}]] |`,
    ].join('\n')
    expect(extractRefs(text).sort()).toEqual([A, B].sort())
  })

  test('no cuenta código en línea ni bloques de código', () => {
    expect(extractRefs(`mirá \`[[${A}]]\``)).toEqual([])
    expect(extractRefs(['```', `[[${A}]]`, '```'].join('\n'))).toEqual([])
    expect(extractRefs(['    ' + `[[${A}]]`].join('\n'))).toEqual([])
    expect(extractRefs(`~~~ts\n[[${A}]]\n~~~`)).toEqual([])
  })

  test('un link item:<id> escrito a mano cuenta, igual que se dibuja', () => {
    expect(extractRefs(`mirá [esto](item:${A}) y [[${B}]]`)).toEqual([A, B])
    expect(extractRefs(`[esto](item:corto)`)).toEqual([])
  })

  test('no cuenta dentro de un link ni de una imagen', () => {
    expect(extractRefs(`[ver [[${A}]]](https://example.com)`)).toEqual([])
    expect(extractRefs(`![[[${A}]]](attachment:x)`)).toEqual([])
  })

  test('el backslash no desactiva la referencia: para escribirla literal va en código', () => {
    // Markdown resuelve el escape antes de que veamos el texto, así que `\[[id]]` llega como `[[id]]`.
    expect(extractRefs(`\\[[${A}]]`)).toEqual([A])
    expect(extractRefs(`\`[[${A}]]\``)).toEqual([])
  })

  test('HTML crudo no cuenta', () => {
    expect(extractRefs(`<span>[[${A}]]</span>`)).toEqual([A])
    expect(extractRefs(`<!-- [[${A}]] -->`)).toEqual([])
  })

  test('texto vacío o sin referencias', () => {
    expect(extractRefs('')).toEqual([])
    expect(extractRefs('# solo un título')).toEqual([])
  })

  test('acota la cantidad de referencias distintas', () => {
    const ids = Array.from(
      { length: MAX_REFS + 10 },
      (_, i) => `01JC8Q2V3N4M5P6R7S8T9V${String(i).padStart(4, '0')}`,
    )
    const got = extractRefs(ids.map((id) => `[[${id}]]`).join(' '))
    expect(got).toHaveLength(MAX_REFS)
    expect(got[0]).toBe(ids[0]!)
  })

  test('es lineal con mucho texto', () => {
    const text = `[[${A}]] `.repeat(2000)
    const t0 = performance.now()
    expect(extractRefs(text)).toEqual([A])
    expect(performance.now() - t0).toBeLessThan(500)
  })
})

describe('refUrl / refIdOf', () => {
  test('ida y vuelta', () => {
    expect(refIdOf(refUrl(A))).toBe(A)
  })

  test('rechaza lo que no es una referencia válida', () => {
    expect(refIdOf('https://example.com')).toBeNull()
    expect(refIdOf('item:corto')).toBeNull()
    expect(refIdOf(`item:${A}/extra`)).toBeNull()
    expect(refIdOf(`javascript:${A}`)).toBeNull()
  })
})
