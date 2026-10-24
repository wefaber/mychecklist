import { describe, expect, test } from 'bun:test'
import { createApp } from '../app'
import { openDb } from '../db/connection'
import { migrate } from '../db/migrate'
import type { Config } from '../config'
import type { Ingress } from '../ingress'
import { config } from '../testing'

const local: Config = {
  ...config,
  devLogin: true,
  origins: {
    public: 'http://localhost:5191',
    tailnet: 'http://localhost:5191',
  },
}

function appWith(cfg: Config, ingress: Ingress = 'public') {
  const db = openDb(':memory:')
  migrate(db)
  return createApp(db, { ingress, config: cfg, logging: false })
}

const get = (app: ReturnType<typeof appWith>, path = '/auth/dev') =>
  app.handle(new Request(`http://localhost:5191${path}`))

describe('sesión de desarrollo', () => {
  test('con la bandera, en local y por la puerta pública, entra y vuelve a la ruta pedida', async () => {
    const res = await get(appWith(local), '/auth/dev?return=/l/abc')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/l/abc')
    expect(res.headers.get('set-cookie')).toContain('mc_session=')
  })

  test('no sale a otro sitio con un return externo', async () => {
    const res = await get(appWith(local), '/auth/dev?return=//evil.test')
    expect(res.headers.get('location')).toBe('/')
  })

  test('sin la bandera no existe', async () => {
    const res = await get(appWith({ ...local, devLogin: false }))
    expect(res.status).toBe(404)
  })

  test('con un origen que no es localhost no existe, aunque la bandera esté', async () => {
    const res = await get(appWith({ ...local, origins: config.origins }))
    expect(res.status).toBe(404)
  })

  test('la puerta de la tailnet no la expone', async () => {
    const res = await get(appWith(local, 'tailnet'))
    expect(res.status).toBe(404)
  })

  test('loadConfig la apaga en producción', async () => {
    const { loadConfig } = await import('../config')
    expect(
      loadConfig({ MYCHECKLIST_DEV_LOGIN: '1', NODE_ENV: 'production' })
        .devLogin,
    ).toBe(false)
    expect(loadConfig({ MYCHECKLIST_DEV_LOGIN: '1' }).devLogin).toBe(true)
    expect(loadConfig({}).devLogin).toBe(false)
  })
})
