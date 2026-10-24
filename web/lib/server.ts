/** True when the UI runs inside the Tauri desktop shell. */
export const inTauri = (): boolean => '__TAURI_INTERNALS__' in window

export const DEFAULT_SERVER = 'https://checklist.wefaber.net'
const KEY = 'mychecklist.server'

/**
 * Server the desktop talks to; the web build always uses its own origin. In `tauri dev` the default is also the own
 * origin (Vite proxies to the local server), so the session cookie is same-site instead of pointing at production.
 */
export function serverUrl(): string {
  if (!inTauri()) return ''
  const fallback = import.meta.env.DEV ? '' : DEFAULT_SERVER
  try {
    return localStorage.getItem(KEY) || fallback
  } catch {
    return fallback
  }
}

/** Absolute URL for an API path: `''` + path on the web, `serverUrl` + path in the desktop app. */
export function apiUrl(path: string): string {
  return `${serverUrl()}${path}`
}
