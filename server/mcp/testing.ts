import { createApp } from '../app'
import { personalOrgId } from '../db/testing'
import { DEFAULT_LIMITS, type Limits } from '@wefaber/codemode'
import {
  DEFAULT_LIMITER,
  createLimiter,
  type Limiter,
} from '@wefaber/codemode-mcp'
import { createBus } from '../events'
import type { Ingress } from '../ingress'
import { createApiToken } from '../services/tokens'
import type { TokenMode } from '../db/tokens'
import { alice, bob, config, loginAs, setupServer } from '../testing'

/** Una base con dos usuarios y una app por puerta, con límites de sandbox bajos para que los tests sean rápidos. */
export async function world(
  opts: { limits?: Partial<Limits>; limiter?: Limiter } = {},
) {
  const ctx = setupServer()
  const a = await loginAs(ctx.db, alice, 'public')
  const b = await loginAs(ctx.db, bob, 'public')
  const orgA = personalOrgId(ctx.db, a.userId)
  const orgB = personalOrgId(ctx.db, b.userId)
  const limits = opts.limits ?? { ...DEFAULT_LIMITS, timeoutMs: 1_500 }
  const limiter =
    opts.limiter ?? createLimiter({ ...DEFAULT_LIMITER, perMinute: 1000 })
  const bus = createBus()
  const apps: Record<Ingress, ReturnType<typeof createApp>> = {
    public: createApp(ctx.db, {
      ingress: 'public',
      config,
      bus,
      limiter,
      codemodeLimits: limits,
      logging: false,
    }),
    tailnet: createApp(ctx.db, {
      ingress: 'tailnet',
      config,
      bus,
      limiter,
      codemodeLimits: limits,
      logging: false,
    }),
  }
  const token = (
    userId: string,
    orgId: string,
    mode: TokenMode = 'write',
    ingress: Ingress = 'public',
  ) =>
    createApiToken(
      ctx.db,
      { userId, ingress, via: 'web' },
      { orgId, name: 'agente', mode, expiresInDays: 90 },
    )
  const post = (
    path: string,
    secret: string | null,
    body: unknown,
    ingress: Ingress = 'public',
    headers: Record<string, string> = {},
  ) =>
    apps[ingress].handle(
      new Request(`https://checklist.test${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(secret ? { authorization: `Bearer ${secret}` } : {}),
          ...headers,
        },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    )
  const exec = async (
    secret: string,
    code: string,
    kind: 'execute' | 'search' = 'execute',
    ingress: Ingress = 'public',
  ) => {
    const res = await post(`/codemode/${kind}`, secret, { code }, ingress)
    return { status: res.status, body: (await res.json()) as any }
  }
  const gql = (
    query: string,
    cookie: string,
    vars?: Record<string, unknown>,
    ingress: Ingress = 'public',
  ) => ctx.gql[ingress](query, cookie, vars)
  return { ...ctx, a, b, orgA, orgB, apps, token, post, exec, gql }
}
