# 0010 — Code Mode con `@wefaber/codemode`

Estado: propuesto (2026-10-26). Pendiente de review de Faku. Reemplaza las partes de implementación de los ADR 0002 y
0007 (sandbox, protocolo, limiter y generador viven ahora en el paquete); lo que deciden sobre tokens, tenencia y
límites sigue vigente.

## Contexto

Este producto fue el primero con Code Mode y su implementación (`server/mcp/`, ~1 100 líneas) se extrajo a un toolkit
compartido, `wefaber/codemode`, para que los demás productos (wegraf, kit, ohmydocs, ohmydiagrams) no la reescriban. El
estándar es `docs/SPEC.md` de ese repo (WCM v0.2).

## Decisión

- El sandbox QuickJS en Worker, el protocolo MCP, el limiter, los transportes y el generador salen de
  `@wefaber/codemode`, `-sandbox-quickjs` y `-mcp`. Aquí queda `server/mcp/routes.ts`: resuelve el token y monta
  `createWcmHandler`.
- `defineOp` pasa a usar `id` (`checklist.items.create`) y `scope` (`checklist:read` | `checklist:write`) en vez de
  `name` y `mode`. El `mode` del token se traduce a scopes en `scopesFor`. Cuatro verbos quedan fuera del conjunto base
  del estándar (`rename`, `updateText`, `setDone`, `backlinks`) y lo declaran con `verbException`.
- El objeto del sandbox es `codemode.checklist.*`. El nombre corto `checklist.*` sigue funcionando como alias durante
  una versión menor y se retira después; los agentes nuevos usan el largo.
- `search` recibe `spec` con `ops[].id` y `ops[].scope` (antes `name` y `mode`) y `version` semver (`"1.0.0"`).
- Los errores de validación del esquema pasan de `INVALID_INPUT` a `VALIDATION` (código del estándar). Los errores del
  dominio (`NOT_FOUND`, `INVALID_INPUT` de los servicios, etc.) no cambian.
- Un error interno de una operación llega al código como `HOST_ERROR: Internal error` y se loguea en el servidor; antes
  llegaba el mensaje original.
- Auditoría: tabla `codemode_runs` (migración 0008, aditiva) con una fila por corrida.
- `generated/checklist.d.ts` pasa a `generated/client.d.ts`; `bun run gen` reemplaza a `scripts/gen-codemode.ts`.

## Consecuencias

- Un agente que filtraba `spec.ops` por `name` o `mode` debe pasar a `id` y `scope`. Es el único cambio visible que no
  tiene alias.
- La suite de escape y de límites vive en el toolkit; acá quedan los tests de tenencia, modos y cableado.
- Hasta que los paquetes estén en npm este PR no instala: ver la nota del PR.
