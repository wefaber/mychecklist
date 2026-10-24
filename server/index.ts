import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createApp } from './app'
import { githubClient } from './auth/github'
import { loadConfig } from './config'
import { openDb } from './db/connection'
import { migrate } from './db/migrate'
import { createBus } from './events'
import { createLimiter } from './mcp/limiter'
import { INGRESSES } from './ingress'

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
const limiter = createLimiter()

// Un listener por puerta, ambos en loopback: Nginx es lo único que ve la red (ARCHITECTURE.md › Network, ADR 0001).
for (const ingress of INGRESSES) {
  createApp(db, { ingress, config, github, bus, limiter, dev }).listen({
    hostname: '127.0.0.1',
    port: config.ports[ingress],
  })
  console.log(
    `mychecklist ${ingress} listening on 127.0.0.1:${config.ports[ingress]} (db ${path})`,
  )
}
