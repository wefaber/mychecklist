import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createApp } from './app'
import { githubClient } from './auth/github'
import { loadConfig } from './config'
import { openDb } from './db/connection'
import { migrate } from './db/migrate'
import { createBus } from './events'
import { createGithubApi } from './github/api'
import { INGRESSES } from './ingress'
import { createGithubLinks } from './services/github'

const path = process.env.MYCHECKLIST_DB ?? './data/mychecklist.db'
const dev = process.env.NODE_ENV !== 'production'
const config = loadConfig()
const github = config.github ? githubClient(config.github) : null

mkdirSync(dirname(path), { recursive: true })
const db = openDb(path)
const applied = migrate(db)
if (applied.length) console.log(`migrations applied: ${applied.join(', ')}`)
if (!github || !config.tokenKey)
  console.warn(
    'login con GitHub desactivado: faltan GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET o MYCHECKLIST_TOKEN_KEY',
  )

const bus = createBus()
// Uno solo para las dos puertas: los límites de la API de GitHub y el token de instalación se comparten.
const githubLinks = createGithubLinks({
  db,
  api: createGithubApi(config.githubApp),
  login: github,
  tokenKey: config.tokenKey,
})
if (!config.githubApp)
  console.warn(
    'links a GitHub: faltan GITHUB_APP_ID o GITHUB_APP_PRIVATE_KEY, los repos públicos se resuelven con el token de quien mira',
  )

// Un listener por puerta, ambos en loopback: Nginx es lo único que ve la red (ARCHITECTURE.md › Network, ADR 0001).
for (const ingress of INGRESSES) {
  createApp(db, { ingress, config, github, bus, githubLinks, dev }).listen({
    hostname: '127.0.0.1',
    port: config.ports[ingress],
  })
  console.log(
    `mychecklist ${ingress} listening on 127.0.0.1:${config.ports[ingress]} (db ${path})`,
  )
}
