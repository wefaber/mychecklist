import { describe, expect, test } from 'bun:test'
import {
  extractRefs,
  MAX_REFS,
  refIdOf,
  refUrl,
  remapIds,
  splitRefs,
} from './refs'

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

describe('remapIds', () => {
  const NEW_A = '01JD000000000000000000000A'
  const NEW_B = '01JD000000000000000000000B'
  const FILE = '01JC9ZZZZZZZZZZZZZZZZZZZZZ'
  const NEW_FILE = '01JD000000000000000000000F'
  const maps = {
    items: new Map([
      [A, NEW_A],
      [B, NEW_B],
    ]),
    attachments: new Map([[FILE, NEW_FILE]]),
  }

  test('reescribe menciones, links item: y adjuntos sin tocar el resto', () => {
    const text = `ver [[${A}]] y [dos](item:${B}) con ![foto](attachment:${FILE}) y [doc](attachment:${FILE} "t")`
    const out = remapIds(text, maps)
    expect(out.unmatched).toBe(0)
    expect(out.text).toBe(
      `ver [[${NEW_A}]] y [dos](item:${NEW_B}) con ![foto](attachment:${NEW_FILE}) y [doc](attachment:${NEW_FILE} "t")`,
    )
  })

  test('no toca código ni el interior de links, igual que extractRefs', () => {
    const text = `\`[[${A}]]\`\n\n\`\`\`\n[[${A}]]\n\`\`\`\n\n[texto [[${A}]]](https://x.y)`
    expect(remapIds(text, maps)).toEqual({ text, unmatched: 0 })
  })

  test('el texto del link que repite el destino no confunde', () => {
    const text = `[item:${A}](item:${A})`
    expect(remapIds(text, maps).text).toBe(`[item:${A}](item:${NEW_A})`)
  })

  test('ids fuera del mapa quedan como están', () => {
    const other = '01JC8Q2V3N4M5P6R7S8T9VWXY1'
    const text = `[[${other}]] y ![x](attachment:${other})`
    expect(remapIds(text, maps)).toEqual({ text, unmatched: 0 })
  })

  test('entidades y escapes antes de la mención no corren la posición', () => {
    const text = `a &amp; b \\* c [[${A}]] y &copy; [[${B}]]`
    const out = remapIds(text, maps)
    expect(out.unmatched).toBe(0)
    expect(out.text).toBe(`a &amp; b \\* c [[${NEW_A}]] y &copy; [[${NEW_B}]]`)
  })

  test('lo que el parser lee de la salida coincide con el mapa', () => {
    const text = `- [[${A}]]\n- otro con [[${B}]] y [[${A}]]\n\n> [[${B}]]`
    expect(extractRefs(remapIds(text, maps).text)).toEqual([NEW_A, NEW_B])
  })
})
