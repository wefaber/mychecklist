/** True when the UI runs inside the Tauri desktop shell. */
export const inTauri = (): boolean => '__TAURI_INTERNALS__' in window

export const DEFAULT_SERVER = 'https://checklist.wefaber.net'
const KEY = 'mychecklist.server'

/** Server the desktop talks to; the web build always uses its own origin. */
export function serverUrl(): string {
  if (!inTauri()) return ''
  try {
    return localStorage.getItem(KEY) || DEFAULT_SERVER
  } catch {
    return DEFAULT_SERVER
  }
}

/** Absolute URL for an API path: `''` + path on the web, `serverUrl` + path in the desktop app. */
export function apiUrl(path: string): string {
  return `${serverUrl()}${path}`
}
