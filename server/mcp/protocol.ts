import type { CodeKind } from './codemode'

/**
 * MCP por Streamable HTTP, sin estado y sin SSE (ADR 0007): cada `POST` lleva un mensaje JSON-RPC y se responde con
 * JSON. Solo lo imprescindible para un cliente que usa tools: `initialize`, `ping`, `tools/list` y `tools/call`, con
 * dos herramientas, `search` y `execute`.
 */

export const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']

type Id = string | number | null

export type RpcRequest = {
  jsonrpc?: unknown
  id?: unknown
  method?: unknown
  params?: unknown
}

export type RpcResponse =
  | { jsonrpc: '2.0'; id: Id; result: unknown }
  | { jsonrpc: '2.0'; id: Id; error: { code: number; message: string } }

const INSTRUCTIONS =
  'MyChecklist por Code Mode: dos herramientas. `search` corre JavaScript sobre `spec` (la API descripta como datos) ' +
  'y devuelve solo lo que el código retorna: usala para encontrar operaciones. `execute` corre JavaScript con ' +
  '`checklist.<grupo>.<operación>(entrada)` (async, p. ej. `await checklist.items.create({ listId, text })`); encadená ' +
  'todas las llamadas necesarias en una sola ejecución y devolvé con `return` solo lo que haga falta. Sin red ni ' +
  'archivos; hasta 50 llamadas y 5 segundos por ejecución.'

const CODE_INPUT = {
  type: 'object',
  properties: {
    code: {
      type: 'string',
      description:
        'Cuerpo de una función async. Devolvé el resultado con `return`.',
    },
  },
  required: ['code'],
  additionalProperties: false,
}

export const TOOLS = [
  {
    name: 'search',
    description:
      'Corre JavaScript sobre `spec` ({ version, ops: [{ name, mode, summary, input, output }], types }) y devuelve lo que el código retorne. Filtrá `spec.ops` por nombre o resumen para traer solo lo que necesitás.',
    inputSchema: CODE_INPUT,
  },
  {
    name: 'execute',
    description:
      'Corre JavaScript con `checklist.*` (listas e items de tu organización). Varias llamadas por ejecución; devuelve lo que el código retorne. Buscá primero las operaciones con `search`.',
    inputSchema: CODE_INPUT,
  },
]

const ok = (id: Id, result: unknown): RpcResponse => ({
  jsonrpc: '2.0',
  id,
  result,
})
const err = (id: Id, code: number, message: string): RpcResponse => ({
  jsonrpc: '2.0',
  id,
  error: { code, message },
})

/**
 * Atiende un mensaje. `null` es "sin respuesta" (notificaciones). `runTool` ejecuta el código y devuelve el cuerpo
 * que se le muestra al modelo; el protocolo no sabe nada de tokens ni de sandboxes.
 */
export async function handleRpc(
  msg: RpcRequest,
  runTool: (
    kind: CodeKind,
    code: string,
  ) => Promise<{ body: unknown; isError: boolean }>,
): Promise<RpcResponse | null> {
  if (
    msg === null ||
    typeof msg !== 'object' ||
    Array.isArray(msg) ||
    msg.jsonrpc !== '2.0' ||
    typeof msg.method !== 'string'
  )
    return err(null, -32600, 'Mensaje JSON-RPC inválido')
  const hasId = typeof msg.id === 'string' || typeof msg.id === 'number'
  if (!hasId) return null // notificación (`notifications/initialized`, ...)
  const id = msg.id as Id
  const params = (msg.params ?? {}) as Record<string, unknown>

  switch (msg.method) {
    case 'initialize': {
      const asked = String(params.protocolVersion ?? '')
      return ok(id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(asked)
          ? asked
          : SUPPORTED_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'mychecklist', version: '1' },
        instructions: INSTRUCTIONS,
      })
    }
    case 'ping':
      return ok(id, {})
    case 'tools/list':
      return ok(id, { tools: TOOLS })
    case 'tools/call': {
      const name = params.name
      const args = (params.arguments ?? {}) as Record<string, unknown>
      if (name !== 'search' && name !== 'execute')
        return err(id, -32602, `Herramienta desconocida: ${String(name)}`)
      if (typeof args.code !== 'string')
        return err(id, -32602, 'Falta `code` (texto)')
      const { body, isError } = await runTool(name, args.code)
      return ok(id, {
        content: [{ type: 'text', text: JSON.stringify(body) }],
        isError,
      })
    }
    default:
      return err(id, -32601, `Método no soportado: ${msg.method}`)
  }
}
