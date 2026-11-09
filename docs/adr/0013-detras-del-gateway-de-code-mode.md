# 0013 — MyChecklist detrás del gateway de Code Mode

Estado: propuesto (2026-11-09). Pendiente de review de Faku. Extiende el ADR 0010 (que sigue vigente) y no cambia los
ADR 0001 ni 0007: la puerta del token, la org y la membresía se siguen revisando acá.

## Contexto

`apps/gateway` de `wefaber/codemode` es un único punto de entrada para los agentes (`/mcp`, `/codemode/search|execute`,
`/catalog`). Tiene un catálogo de productos, tokens propios con scopes, presupuestos y auditoría, y reenvía cada llamada al
producto como `POST <url>/codemode/execute` con `return await codemode.<id>(...)`. Hoy un agente le habla directo a
`https://checklist.wefaber.net/mcp` con un token `mck_`; el pedido es que ese mismo agente use el gateway y que el
producto siga aplicando su propia tenencia.

## Decisión

- **Contrato**: el producto no cambia de API. Sigue exponiendo `POST /codemode/execute` y `POST /codemode/search` con las
  operaciones `codemode.checklist.*` y los scopes `checklist:read` y `checklist:write` (ADR 0010). El gateway publica el
  spec (`bun run gen` → `server/mcp/generated/spec.json`) en su catálogo con `catalog publish`.
- **Autenticación**: el gateway firma la identidad del agente con HMAC-SHA256 sobre los headers `x-wcm-*`
  (`signIdentity`/`verifyIdentity` de `@wefaber/codemode-mcp`, tolerancia de 60 s) usando `WCM_GATEWAY_SECRET`, una clave
  compartida de 32+ caracteres. Sin la clave configurada el producto rechaza toda llamada con `x-wcm-via: gateway`; una
  llamada con ese header y sin firma válida da 401 aunque traiga un `mck_` válido.
- **Quién es el agente**: la identidad firmada lleva el hash del token (`x-wcm-token-hash`), no el token. Los `mck_`
  vigentes se registran en el gateway con `token import` (guarda el sha256, que es lo que ya guarda este producto). El
  producto busca `api_tokens.token_sha256` por ese hash y aplica las mismas reglas de siempre: puerta (un token de la
  tailnet no sirve en el listener público), vencimiento, revocación y membresía de la org. El usuario y la org salen del
  token del producto, nunca de lo que diga el gateway.
- **Scopes**: los efectivos son la intersección entre los que da el gateway y el modo del token (`gatewayScopes`). El
  gateway recorta, nunca amplía: un token `read` con scope `checklist:write` en el gateway sigue sin escribir, y un token
  `write` con `checklist:read` en el gateway solo lee. Si la intersección es vacía (por ejemplo, solo scopes de otro
  producto) responde 403 `FORBIDDEN`. Un `execute` con solo lectura ni siquiera ve las operaciones de escritura.
- **Entrada directa**: `/mcp` y `/codemode/*` con `Authorization: Bearer mck_…` siguen funcionando igual. No se corta
  nada hasta que el gateway esté en producción y los agentes migrados. El alias `checklist.*` también sigue (ADR 0010).
- **Límites**: el limiter por token del producto (una ejecución a la vez, 60 por minuto, 4 Workers) sigue aplicando sobre
  la llamada reenviada; el gateway suma sus presupuestos por agente. Los dos se acumulan, el más estricto gana.
- **Auditoría**: `codemode_runs` sigue con una fila por corrida, ligada al token del producto, y guarda la etiqueta del
  agente que firmó el gateway (`x-wcm-label`) en `agent_label`. El `runId` del gateway llega en `x-wcm-run-id` pero el
  toolkit todavía no lo pasa al hook de auditoría; queda pendiente.
- **Operación**: `WCM_GATEWAY_SECRET` va en `~/deploy/env/mychecklist.env` (`deploy/README.md`). Alta en el gateway:
  `catalog publish` con la URL del producto y `token import` por cada `mck_` vigente.

## Consecuencias

- Ningún dato del agente cambia de dueño: el aislamiento por org sigue siendo del producto, así que un error de configuración
  del gateway no puede dar acceso a otra org. Lo peor que puede hacer un gateway comprometido es actuar como un token que
  el producto ya conoce (por hash) y con a lo sumo los scopes de ese token.
- La clave compartida es un secreto de ambos lados: rotarla exige cambiarla en los dos y reiniciar. Hay una ventana de 60 s
  contra repetición de una firma capturada; el limiter y el hash de token acotan el daño.
- Un `mck_` revocado en el producto deja de servir por el gateway en la próxima llamada, sin tocar el gateway. El inverso
  (revocar en el gateway) no frena la entrada directa; para cortar a un agente hay que revocar el token del producto.
- Dependencias: `@wefaber/codemode` y `-mcp` 0.4.x, `-sandbox-quickjs` 0.3.x. La 0.4.0 del sandbox falla `tsc` con
  `erasableSyntaxOnly` (parámetro de constructor con modificador en `worker.ts`); se queda en 0.3.

## Pendiente

- Dónde vive el gateway en producción (`apps/gateway` en `wefaber/codemode`, `mcp.wefaber.net`) y el corte cuando termine
  la migración de D1 y wegraph.
- Pasar el `runId` del gateway al hook de auditoría cuando el toolkit lo exponga.
- Retirar la entrada directa con `mck_` y el alias `checklist.*` después del corte.
