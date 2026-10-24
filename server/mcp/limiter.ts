/**
 * Cuánto sandbox se puede disparar (ADR 0007): una ejecución a la vez por token, 60 por minuto por token y un tope de
 * Workers por proceso. Todo en memoria (se pierde al reiniciar, como los intentos de login); no hay cola: si no hay
 * lugar, se rechaza.
 */

export type LimiterOptions = {
  maxWorkers: number
  perMinute: number
}

export const DEFAULT_LIMITER: LimiterOptions = { maxWorkers: 4, perMinute: 60 }

const WINDOW_MS = 60_000

export type Slot = { release(): void }
export type Acquire = { ok: true; slot: Slot } | { ok: false; message: string }

export type Limiter = { acquire(tokenId: string): Acquire }

export function createLimiter(
  opts: LimiterOptions = DEFAULT_LIMITER,
  now: () => number = Date.now,
): Limiter {
  const running = new Set<string>()
  const stamps = new Map<string, number[]>()
  let workers = 0
  return {
    acquire(tokenId) {
      if (running.has(tokenId))
        return {
          ok: false,
          message: 'Ya hay una ejecución en curso con este token',
        }
      const t = now()
      const recent = (stamps.get(tokenId) ?? []).filter(
        (s) => t - s < WINDOW_MS,
      )
      if (recent.length >= opts.perMinute) {
        stamps.set(tokenId, recent)
        return {
          ok: false,
          message: `Hasta ${opts.perMinute} ejecuciones por minuto por token`,
        }
      }
      if (workers >= opts.maxWorkers)
        return {
          ok: false,
          message: 'El servidor está ocupado con otras ejecuciones; reintentá',
        }
      recent.push(t)
      stamps.set(tokenId, recent)
      // Un token que no vuelve no debe quedar en el mapa para siempre.
      if (stamps.size > 1000)
        for (const [id, list] of stamps)
          if (list.every((s) => t - s >= WINDOW_MS)) stamps.delete(id)
      running.add(tokenId)
      workers += 1
      let released = false
      return {
        ok: true,
        slot: {
          release() {
            if (released) return
            released = true
            running.delete(tokenId)
            workers -= 1
          },
        },
      }
    },
  }
}
