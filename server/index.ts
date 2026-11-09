import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createApp } from './app'
import { githubClient } from './auth/github'
import { loadConfig } from './config'
import { openDb } from './db/connection'
import { migrate } from './db/migrate'
import { createBus } from './events'
import { createGithubApi } from './github/api'
import { createLimiter } from '@wefaber/codemode-mcp'
import { INGRESSES } from './ingress'
import { userTokens } from './github/tokens'
import { createGithubLinks } from './services/github'
import { githubOrgs } from './services/github-orgs'

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
// También los tokens de usuario: el refresh token es de un solo uso, así que renueva una sola instancia.
const tokens = userTokens({
  db,
  login: github,
  tokenKey: config.tokenKey,
  now: Date.now,
})
const githubLinks = createGithubLinks({
  db,
  api: createGithubApi(config.githubApp),
  login: github,
  tokenKey: config.tokenKey,
  tokens,
})
const orgsLink = githubOrgs({ db, bus, login: github, tokens })
if (!config.githubApp)
  console.warn(
    'links a GitHub: faltan GITHUB_APP_ID o GITHUB_APP_PRIVATE_KEY, los repos públicos se resuelven con el token de quien mira',
  )

const limiter = createLimiter()

// Un listener por puerta, ambos en loopback: Nginx es lo único que ve la red (ARCHITECTURE.md › Network, ADR 0001).
for (const ingress of INGRESSES) {
  createApp(db, {
    ingress,
    config,
    github,
    bus,
    githubLinks,
    githubOrgs: orgsLink,
    limiter,
    dev,
  }).listen({
    hostname: '127.0.0.1',
    port: config.ports[ingress],
  })
  console.log(
    `mychecklist ${ingress} listening on 127.0.0.1:${config.ports[ingress]} (db ${path})`,
  )
}
