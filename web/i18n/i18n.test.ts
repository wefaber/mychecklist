import { describe, expect, test } from 'bun:test'
import { es } from './es'
import { t } from './index'

describe('i18n', () => {
  test('reemplaza variables', () => {
    expect(t('auth.avatarOf', { login: 'alice' })).toBe('Foto de alice')
  })

  test('deja visible una variable que falta', () => {
    expect(t('auth.avatarOf')).toBe('Foto de {login}')
  })

  test('ningún texto lleva emojis ni signos de exclamación', () => {
    for (const text of Object.values(es)) {
      expect(text).not.toMatch(/[!¡]/)
      expect(text).not.toMatch(/\p{Extended_Pictographic}/u)
    }
  })
})
