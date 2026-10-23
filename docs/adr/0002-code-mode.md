# 0002 — Code Mode para agentes

Estado: aceptado (M0, 2026-10-23). Se implementa en M5; el spike de M0 validó el sandbox.

## Contexto

Un MCP clásico expone una herramienta por operación: cada definición ocupa contexto y cada llamada devuelve datos
intermedios que el modelo tiene que releer. Cloudflare publicó Code Mode (dos herramientas, `search` y `execute`) y
Anthropic adopta el mismo enfoque de ejecución de código: el agente escribe código contra una API tipada y solo lo
que el código devuelve vuelve al contexto. Seguimos el protocolo, no la infraestructura de Cloudflare.

## Decisión

La interfaz de agentes son dos funciones y nada más:

- `search(code)`: corre JS sobre `spec` (la API descripta como datos) y devuelve solo las operaciones y tipos que
  hacen falta.
- `execute(code)`: corre JS con `checklist.*` autenticado; varias llamadas por ejecución; devuelve lo que el código
  retorne.

Transportes: `POST /codemode/search`, `POST /codemode/execute` y `/mcp` (Streamable HTTP, solo esas dos tools).
Autenticación con Bearer `api_tokens` (guardados como sha256). Cada operación está declarada una vez en
`services/registry.ts` (`defineOp`, esquemas TypeBox); `scripts/gen-codemode.ts` genera `checklist.d.ts` y
`spec.json`, y `check` falla si están desactualizados. Toda llamada pasa por `server/services/*` con el scope y el
ingress del token (ADR 0001) y deja una entrada en `activity` con `via=mcp`.

Es la excepción a "todo API nuevo es GraphQL": no es una API de datos paralela, es una forma de invocar los mismos
servicios.

### Sandbox

`quickjs-emscripten` (QuickJS en wasm): sin red, sin filesystem, sin `Bun` ni `require`; la única salida es el objeto
`host` que el servidor inyecta. `isolated-vm` no corre en Bun (necesita V8). Los Worker solos no aíslan: heredan
`fetch`.

Límites por defecto: 5 s, 64 MB, 50 llamadas al host, 64 KB de resultado, 200 líneas de console.

### Hallazgos del spike (`server/mcp/sandbox.ts`)

- Ejecución trivial: ~1 ms con el wasm cargado.
- Aislamiento verificado: `fetch`, `Bun`, `require`, `process`, `XMLHttpRequest`, `WebSocket` y `setTimeout` no
  existen.
- Bucles infinitos, explosión de memoria con objetos y exceso de llamadas se cortan por límite.
- **Hueco:** QuickJS consulta el interrupt handler cada N operaciones y no mide bien los builtins de strings grandes:
  `"x".repeat(1e6)` en un bucle corrió 12 s con un deadline de 2 s. Además, QuickJS es síncrono y bloquearía el event
  loop del servidor.
- **Mitigación (M5):** la ejecución corre dentro de un **Bun Worker** que el host puede `terminate()`. Verificado: el
  event loop principal sigue vivo mientras el Worker está ocupado y `terminate()` lo corta. Las llamadas al host cruzan
  con `postMessage` (RPC) y el host aplica el scope.

## Consecuencias

- Ahorro de tokens: una ejecución encadena N llamadas y devuelve un resultado acotado.
- El sandbox es superficie de seguridad: tests de escape obligatorios en M5.
- El registry es la única fuente de la API de agentes; agregar una operación la expone sola.
