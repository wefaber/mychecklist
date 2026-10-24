/**
 * Desarrollo del desktop con todo junto: servidor local con recarga y `tauri dev` (que levanta Vite). Un solo Ctrl+C
 * baja los dos procesos. Corre con `bun run dev:desktop`.
 *
 * La ventana entra sola con una sesión de prueba (`GET /auth/dev`, ver `server/auth/dev.ts`): el servidor la habilita con
 * `MYCHECKLIST_DEV_LOGIN=1` y la UI la pide con `VITE_DEV_LOGIN=1`. Nada de esto existe en una compilación de producción.
 */
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

if (process.env.NODE_ENV === 'production') {
  console.error('dev:desktop no corre en producción')
  process.exit(1)
}

function run(cmd: string[]) {
  return Bun.spawn(cmd, {
    cwd: root,
    env: { ...process.env, MYCHECKLIST_DEV_LOGIN: '1', VITE_DEV_LOGIN: '1' },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
}

/** En Windows `kill` no baja a los hijos (Vite, el binario de Rust): `taskkill /T` sí. */
function stop(proc: ReturnType<typeof run>) {
  if (proc.exitCode !== null) return
  if (process.platform === 'win32')
    Bun.spawnSync(['taskkill', '/pid', String(proc.pid), '/T', '/F'])
  else proc.kill()
}

const server = run(['bun', '--watch', 'server/index.ts'])
const tauri = run(['bun', 'run', 'tauri', 'dev'])
const procs = [server, tauri]

let closing = false
function shutdown(code: number) {
  if (closing) return
  closing = true
  for (const p of procs) stop(p)
  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

// Si cualquiera de los dos termina, el otro no sirve solo: se baja todo.
const first = await Promise.race(procs.map((p) => p.exited))
shutdown(first)
