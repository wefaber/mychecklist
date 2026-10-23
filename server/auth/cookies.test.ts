import { describe, expect, test } from 'bun:test'
import {
  clearCookie,
  parseCookies,
  serializeCookie,
  sessionCookieName,
} from './cookies'
import { safeReturnTo } from './routes'

describe('cookies', () => {
  test('HttpOnly, Lax y Secure según el origen', () => {
    expect(serializeCookie('a', 'b', { secure: true, maxAge: 5 })).toBe(
      'a=b; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=5',
    )
    expect(serializeCookie('a', 'b', { secure: false })).toBe(
      'a=b; Path=/; HttpOnly; SameSite=Lax',
    )
  })

  test('clearCookie vence al instante', () => {
    expect(clearCookie('a', true)).toContain('Max-Age=0')
  })

  test('parseCookies lee varias y se queda con la primera repetida', () => {
    expect(parseCookies('a=1; b=2; a=3')).toEqual({ a: '1', b: '2' })
    expect(parseCookies(null)).toEqual({})
  })

  test('__Host- solo con Secure', () => {
    expect(sessionCookieName(true)).toBe('__Host-mc_session')
    expect(sessionCookieName(false)).toBe('mc_session')
  })
})

describe('safeReturnTo', () => {
  test('acepta rutas del mismo sitio', () => {
    expect(safeReturnTo('/lists/1?x=2')).toBe('/lists/1?x=2')
  })

  test('rechaza redirecciones abiertas', () => {
    for (const bad of [
      '//evil.test',
      '/\\evil.test',
      'https://evil.test',
      'evil',
      '',
      null,
      undefined,
      '/a b',
    ])
      expect(safeReturnTo(bad)).toBe('/')
  })
})
