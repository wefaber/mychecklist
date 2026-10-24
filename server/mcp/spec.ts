import type { TSchema } from '@sinclair/typebox'
import { NAMED, opsFor, type Mode } from '../services/registry'

/**
 * La API de agentes como datos (ADR 0002). `spec` es lo que recibe `search`; `renderDts` es el `checklist.d.ts` que
 * publica `scripts/gen-codemode.ts`. Los dos salen del registry: agregar una operación la expone en todos lados.
 */

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }
type Schema = { [k: string]: Json }

export type SpecOp = {
  name: string
  mode: Mode
  summary: string
  input: Schema
  output: Schema
}

export type Spec = {
  version: 1
  /** Se invoca como `await checklist.<grupo>.<operación>(entrada)`. */
  ops: SpecOp[]
  /** Esquemas con nombre, referenciados como `{ "$ref": "Item" }`. */
  types: Record<string, Schema>
}

const namedIds = new Set(NAMED.map((s) => String(s.$id)))

/** Copia el esquema a JSON plano y reemplaza cada esquema con nombre por una referencia. */
function plain(schema: TSchema, root = false): Schema {
  const walk = (node: unknown, top: boolean): Json => {
    if (Array.isArray(node)) return node.map((n) => walk(n, false))
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>
      if (!top && typeof obj.$id === 'string' && namedIds.has(obj.$id))
        return { $ref: obj.$id }
      const out: Record<string, Json> = {}
      for (const key of Object.keys(obj)) {
        if (key === '$id' && !top) continue
        out[key] = walk(obj[key], false)
      }
      return out
    }
    return node as Json
  }
  return walk(schema, root) as Schema
}

export function buildSpec(mode: Mode = 'write'): Spec {
  const types: Record<string, Schema> = {}
  for (const named of NAMED) {
    const { $id: _id, ...rest } = plain(named, true)
    types[String(named.$id)] = rest
  }
  return {
    version: 1,
    ops: opsFor(mode).map((op) => ({
      name: op.name,
      mode: op.mode,
      summary: op.summary,
      input: plain(op.input),
      output: plain(op.output),
    })),
    types,
  }
}

// ---- checklist.d.ts --------------------------------------------------------------------------------------------

function ts(node: Schema, indent: string): string {
  if (typeof node.$ref === 'string') return node.$ref
  if (Array.isArray(node.anyOf))
    return (node.anyOf as Schema[]).map((n) => ts(n, indent)).join(' | ')
  if ('const' in node) return JSON.stringify(node.const)
  switch (node.type) {
    case 'string':
      return 'string'
    case 'number':
    case 'integer':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'null':
      return 'null'
    case 'array': {
      const inner = ts(node.items as Schema, indent)
      return /[|{]/.test(inner) ? `(${inner})[]` : `${inner}[]`
    }
    case 'object':
      return object(node, indent)
    default:
      return 'unknown'
  }
}

function object(node: Schema, indent: string): string {
  const props = (node.properties ?? {}) as Record<string, Schema>
  const keys = Object.keys(props)
  if (keys.length === 0) return '{}'
  const required = new Set((node.required ?? []) as string[])
  const inner = `${indent}  `
  const lines = keys.map((key) => {
    const doc =
      typeof props[key]!.description === 'string'
        ? `${inner}/** ${props[key]!.description} */\n`
        : ''
    return `${doc}${inner}${key}${required.has(key) ? '' : '?'}: ${ts(props[key]!, inner)}`
  })
  return `{\n${lines.join('\n')}\n${indent}}`
}

/** `checklist.d.ts`: los tipos con nombre y el objeto `checklist` con una función por operación. */
export function renderDts(): string {
  const spec = buildSpec('write')
  const out: string[] = [
    '// Generado por scripts/gen-codemode.ts desde server/services/registry.ts. No se edita a mano.',
    '',
  ]
  for (const [name, schema] of Object.entries(spec.types)) {
    if (typeof schema.description === 'string')
      out.push(`/** ${schema.description} */`)
    out.push(`interface ${name} ${object(schema, '')}`, '')
  }
  const groups = new Map<string, SpecOp[]>()
  for (const op of spec.ops) {
    const group = op.name.split('.')[0]!
    groups.set(group, [...(groups.get(group) ?? []), op])
  }
  out.push('declare const checklist: {')
  for (const [group, ops] of groups) {
    out.push(`  ${group}: {`)
    for (const op of ops) {
      const fn = op.name.split('.')[1]!
      const input = ts(op.input, '    ')
      const arg = input === '{}' ? '' : `input: ${input}`
      out.push(
        `    /** ${op.summary} [${op.mode}] */`,
        `    ${fn}(${arg}): Promise<${ts(op.output, '    ')}>`,
      )
    }
    out.push('  }')
  }
  out.push('}', '')
  return out.join('\n')
}
