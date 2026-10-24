# 0007 — Tokens de API y límites de Code Mode

Estado: aceptado (M5, 2026-10-23). Completa el ADR 0002 (que ya fija las dos
funciones, el sandbox QuickJS en Worker, el registry y los límites del sandbox); no lo reemplaza.

## Contexto

El ADR 0002 dice "Bearer `api_tokens` guardados como sha256" y "scope e ingress del token", pero no define el formato
del token, a qué alcanza (usuario u org), si puede ser de solo lectura, cómo se crea y revoca, ni cuánto se le deja
ejecutar a un mismo token en paralelo. El sandbox ya limita lo que corre adentro; falta limitar cuánto sandbox se
puede disparar.

## Decisión

### Formato y almacenamiento

- Token: `mck_` + 32 bytes aleatorios en base64url (47 caracteres). El prefijo permite que los escáneres de secretos lo
  reconozcan. Se muestra **una sola vez**, al crearlo.
- Tabla `api_tokens`: `id` (ULID), `user_id`, `org_id`, `ingress`, `mode`, `name`, `token_sha256` (único), `hint`
  (últimos 4 caracteres, para reconocerlo en la lista), `created_at`, `last_used_at`, `expires_at`, `revoked_at`. Nunca
  se guarda el token en claro. Se busca por `sha256` (como `sessions`, `server/db/sessions.ts`), sin `org_id` en el
  `WHERE` porque todavía no hay scope: por eso la tabla **no** es de las "con dueño" de `scoped.ts` y vive en
  `server/db/tokens.ts`. Lo que el token puede hacer sí pasa siempre por `openScope`.

### Alcance

- **Un token = un usuario + una org + una puerta.** Opera como ese usuario, solo sobre esa org, y solo vale en el
  listener donde se emitió (igual que la sesión, ADR 0001): un token de la tailnet no sirve en el público. Un agente
  que necesita dos orgs usa dos tokens.
- **La membresía se verifica en cada llamada** (`openScope`): si el usuario sale de la org o el rol cae, el token deja
  de alcanzarla sin tocarlo.
- **Modo `read` o `write`.** `read` ejecuta con un `checklist` que solo tiene las operaciones de lectura (el registry
  marca cada op como `read` o `write`; las de escritura no existen en el objeto, no fallan después). `write` tiene todo.
  Ninguno borra de verdad: el borrado sigue siendo lógico (ADR 0004).
- Vence a los 90 días por defecto (`expires_at`); se puede elegir 30, 90, 365 o sin vencimiento. Se revoca
  (`revoked_at`) desde la pantalla de tokens o por GraphQL.
- Crear, listar y revocar tokens: GraphQL (`createApiToken` devuelve el secreto una vez, `apiTokens(orgId)`,
  `revokeApiToken`), **solo con sesión** (nunca con un token de API: un token no se acuña otros tokens). Quienes pueden:
  `owner` y `admin` de la org; en la org personal, su dueño.
- Cada llamada anota `last_used_at` (a lo sumo una vez por minuto) y deja `activity` con `via = mcp`; el actor es el
  usuario del token y el `type` lleva el mismo nombre que en la web.

### Límites de ejecución

Los del ADR 0002 se mantienen (5 s, 64 MB, 50 llamadas al host, 64 KB de resultado, 200 líneas de log). Se suma:

- **Tope duro de tiempo por Worker**: `terminate()` a los 5 s + 1 s de gracia (el deadline interno de QuickJS es el
  primero; el `terminate` cubre los builtins que no consulta, ver hallazgos del spike).
- **Concurrencia**: 1 ejecución a la vez por token (la segunda recibe `RATE_LIMITED`) y 4 Workers en total por
  proceso; si no hay lugar, `RATE_LIMITED`, no cola.
- **Frecuencia**: 60 ejecuciones por minuto por token, en memoria (se pierde al reiniciar, como los intentos de login).
- **Entrada**: el código mide hasta 32 KB; el cuerpo de la request hasta 64 KB.
- **Datos por llamada**: las operaciones del host heredan los límites del dominio (200 listas, 5000 items, 4000
  caracteres) y devuelven como mucho 500 items por llamada de lectura.
- El Worker no recibe el token ni la base: solo el código y los resultados que el host le devuelve por `postMessage`;
  el host aplica scope, modo y conteo de llamadas.

### Transportes

- `POST /codemode/search` y `POST /codemode/execute`: `{ code }` → `{ ok, result, truncated, logs, calls, ms }` o
  `{ ok: false, error }`. Bearer en `Authorization`.
- `/mcp`: Streamable HTTP **sin estado y sin SSE** (cada `POST` es un JSON-RPC y responde JSON): `initialize`,
  `ping`, `tools/list` y `tools/call` para `search` y `execute`, nada más. Se escribe a mano (unas 100 líneas) en vez de
  sumar el SDK completo; `GET /mcp` responde 405. Mismo Bearer.
- Los tres rechazan un `Origin` de navegador que no sea el propio: un agente no manda `Origin`.
- Dependencia nueva: `@sinclair/typebox` (esquemas del registry; se convierten a `checklist.d.ts` y a `spec.json`).

## Alternativas descartadas

- **Token de usuario sin org**: un solo token alcanza todo lo que el usuario ve, incluida una org de equipo. Si se filtra,
  el daño es el máximo; con un token por org es el mínimo.
- **Scopes finos por operación**: sobra para una herramienta personal; `read`/`write` cubre el caso real (un agente que
  solo mira).
- **JWT**: no se puede revocar sin lista, y la lista es la tabla que ya tenemos.

## Consecuencias

- Una migración aditiva (`api_tokens`); el slot anterior la ignora.
- La pantalla de tokens entra en este PR (Ajustes → Tokens de API), con el secreto visible una sola vez.
- Subir el límite de ejecuciones o el tamaño de resultado es un cambio de constantes, no de diseño.
