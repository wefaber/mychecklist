import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createApp } from './app'
import { openDb } from './db/connection'
import { migrate } from './db/migrate'

const path = process.env.MYCHECKLIST_DB ?? './data/mychecklist.db'
const port = Number(process.env.MYCHECKLIST_PORT ?? 4151)
const dev = process.env.NODE_ENV !== 'production'

mkdirSync(dirname(path), { recursive: true })
const db = openDb(path)
const applied = migrate(db)
if (applied.length) console.log(`migrations applied: ${applied.join(', ')}`)

// Loopback only: Nginx is the only thing that sees the network (ARCHITECTURE.md › Network).
createApp(db, { dev }).listen({ hostname: '127.0.0.1', port })
console.log(`mychecklist listening on 127.0.0.1:${port} (db ${path})`)
