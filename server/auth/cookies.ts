export type CookieOptions = {
  maxAge?: number
  secure: boolean
  sameSite?: 'Lax' | 'Strict'
}

/** Cookies de la casa: siempre `HttpOnly`, `Path=/` y `SameSite=Lax` (cuentas). `Secure` si el origen es https. */
export function serializeCookie(
  name: string,
  value: string,
  opts: CookieOptions,
): string {
  const parts = [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${opts.sameSite ?? 'Lax'}`,
  ]
  if (opts.secure) parts.push('Secure')
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`)
  return parts.join('; ')
}

export function clearCookie(name: string, secure: boolean): string {
  return serializeCookie(name, '', { maxAge: 0, secure })
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  for (const pair of (header ?? '').split(';')) {
    const i = pair.indexOf('=')
    if (i < 0) continue
    const name = pair.slice(0, i).trim()
    if (name && !(name in out)) out[name] = pair.slice(i + 1).trim()
  }
  return out
}

/** `__Host-` exige `Secure`, `Path=/` y sin `Domain`: la cookie no se puede pisar desde un subdominio. */
export function sessionCookieName(secure: boolean): string {
  return secure ? '__Host-mc_session' : 'mc_session'
}

export function stateCookieName(secure: boolean): string {
  return secure ? '__Host-mc_oauth' : 'mc_oauth'
}
