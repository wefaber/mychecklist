/**
 * Sesión de desarrollo: crea (o reutiliza) un usuario de prueba en la base local y imprime la cookie para pegar en la
 * consola del navegador, así la UI se prueba sin GitHub. Solo toca `MYCHECKLIST_DB` (por defecto `./data/`) y se
 * niega a correr con `NODE_ENV=production`. La cookie vale en la puerta pública de desarrollo (http://localhost).
 */
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { sessionCookieName } from '../server/auth/cookies'
import { openDb } from '../server/db/connection'
import { migrate } from '../server/db/migrate'
import { signIn } from '../server/services/accounts'

if (process.env.NODE_ENV === 'production') {
  console.error('dev-session no corre en producción')
  process.exit(1)
}

const path = process.env.MYCHECKLIST_DB ?? './data/mychecklist.db'
mkdirSync(dirname(path), { recursive: true })
const db = openDb(path)
migrate(db)

// Clave descartable: los tokens de la sesión de prueba son falsos y nunca salen de esta base.
const { token } = await signIn(db, {
  profile: { id: 999_001, login: 'dev', name: 'Dev Local', avatarUrl: null },
  tokens: {
    accessToken: 'dev',
    refreshToken: null,
    expiresAt: null,
    refreshExpiresAt: null,
  },
  ingress: 'public',
  tokenKey: Uint8Array.from({ length: 32 }, (_, i) => i + 1),
})

console.log('Pegá esto en la consola del navegador en http://localhost:5191:\n')
console.log(`document.cookie = "${sessionCookieName(false)}=${token}; path=/"`)
