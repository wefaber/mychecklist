# Fixes 2026-10-23 · v0.6.0 (M5)

Hallazgos y pendientes de la etapa de Code Mode: `api_tokens`, registry, sandbox en Worker, `/codemode/*` y `/mcp`
(ADR 0002 y 0007). Se tilda solo lo verificado con tests o en el navegador.

## Tokens de API

- [x] Formato `mck_` + 32 bytes en base64url (47 caracteres); en la base solo el sha256 y los últimos 4 caracteres
      (`server/codemode.auth.test.ts`).
- [x] Sin token, token inventado o mal formado, `Basic` en vez de `Bearer`: 401 con `WWW-Authenticate`.
- [x] Un token vale solo en la puerta donde se emitió (público vs. tailnet, los dos sentidos).
- [x] Revocado o vencido deja de servir; `last_used_at` se anota.
- [x] La cookie de sesión no sirve en `/codemode` ni el Bearer en `/graphql`; un `Origin` ajeno da 403.
- [x] Si el usuario sale de la org, el token deja de alcanzarla sin tocarlo (`FORBIDDEN` en cada llamada).
- [x] Crear: solo `owner` y `admin`, con sesión, atado a la puerta de la sesión; un `member` y una org ajena dan
      `FORBIDDEN`; tope de 20 vigentes; vencimiento y nombre validados; revocar el token de otro da `NOT_FOUND`.
- [x] Listar nunca devuelve el secreto (el campo ni existe en `ApiToken`).
- [ ] Los tokens revocados y vencidos no se purgan nunca de la tabla.
- [ ] No hay forma de renombrar un token ni de ver desde qué agente se usó (no se guarda IP ni user agent, a propósito).
- [ ] Tokens de org de equipo: la pantalla usa la org personal; las de equipo llegan con M7 (el servicio y GraphQL ya
      las aceptan y están probadas por la tailnet).

## Registry y API de agentes

- [x] Cada operación se declara una vez (`server/services/registry.ts`); `checklist.d.ts` y `spec.json` salen de ahí y un
      test falla si quedan viejos (`scripts/gen-codemode.test.ts`).
- [x] Ninguna operación recibe `orgId`: pasarlo da `INVALID_INPUT` y los ids de otra org no existen para el token.
- [x] Entrada validada con TypeBox (campo ausente, tipo mal, propiedad de más, `null`); la salida de las 20 operaciones
      cumple su esquema (`server/mcp/protocol.test.ts`, que además falla si queda una operación sin ejercitar).
- [x] Las reglas del dominio valen igual: un nivel de subitems, 4000 caracteres, borrado lógico y restauración.
- [x] `afterId` omitido va al final; `null` al principio.
- [x] `items.list` pagina de a 500 como máximo.
- [x] Un token `read` no tiene las operaciones de escritura en `checklist` (no existen) y el host las rechaza igual si
      las nombran.
- [x] `execute` crea 10 items en 3 listas y la actividad queda con `via = mcp` (`server/codemode.test.ts`). Verificado
      también contra un proceso real (`bun server/index.ts`): 13 llamadas en 53 ms y 13 entradas `via = mcp`.

## Sandbox

- [x] Escape: no existen `fetch`, `Bun`, `process`, `require`, `module`, `Worker`, `self`, `WebAssembly`, timers ni
      `host`; los constructores de `Function`, `eval` y el import dinámico de `node:fs`, `bun:sqlite`, `file://` y
      `https://` no llevan a nada; `checklist` son solo funciones nativas sin token ni base
      (`server/mcp/escape.test.ts`).
- [x] Cada ejecución arranca de cero: un `Object.prototype` envenenado o un global no se ven en la siguiente.
- [x] Límites: bucle infinito, builtin que QuickJS no mide (`repeat` en bucle, corta con `terminate()` y el event loop
      no se bloquea), memoria, más de 50 llamadas (también atrapando la excepción), resultado de 64 KB, 200 líneas de
      log, código de 32 KB, cuerpo de 64 KB.
- [x] Un timeout real en el servidor responde `TIMEOUT` a los ~6 s y `/ready` sigue en 200.
- [x] Concurrencia: una ejecución a la vez por token y tope de Workers por proceso dan 429 `RATE_LIMITED`; la ventana
      de 60 por minuto es deslizante (tests del limitador).
- [x] Un error del host llega al código como `Error` con `message` (antes era un texto suelto).
- [ ] No se midió el costo de memoria del Worker (`smol`) bajo 4 ejecuciones simultáneas ni la latencia de arranque con
      el servidor cargado; el límite de 64 MB es el de QuickJS, no el del proceso.
- [ ] El conteo por minuto y la concurrencia son en memoria: con más de un proceso por slot cada uno cuenta aparte.

## `/mcp`

- [x] `initialize` (versión pedida o la última soportada), `ping`, `tools/list` con `search` y `execute`, `tools/call`;
      un fallo del código vuelve como `isError` y no como error de protocolo; notificaciones 202; `GET` y `DELETE` 405;
      JSON roto, método y herramienta desconocidos y batch con su código JSON-RPC.
- [ ] Probado con un cliente MCP real (Claude Code o Desktop apuntando a `/mcp` con un token). Los tests y `curl`
      hablan el protocolo a mano; falta confirmar la conexión de un cliente.

## Pantalla de tokens (`/ajustes/tokens`)

- [x] Verificado en el navegador: crear un token muestra el secreto una vez con Copiar, aparece en la lista con
      "termina en", permiso, estado y vencimiento; revocar lo marca revocado y avisa.
- [x] axe-core (WCAG 2.2 AA): 0 violaciones en los cuatro temas. El estado usaba `text-success` y fallaba en Azul claro;
      ahora lleva ícono y el color del texto. El botón Revocar es el secundario: el `danger` del kit daba 4,4:1 en Teal.
- [x] 375 px sin desborde: en el encabezado el enlace queda como ícono con `aria-label`.
- [ ] Prueba con lector de pantalla real.

## Deploy

- [ ] Aplicar a mano en el VPS los dos vhosts (`deploy/nginx/*.conf`): sin los `location /codemode/` y `= /mcp` Nginx
      contesta con el `index.html` del cliente. El deploy no copia los vhosts.
- [ ] Tras el merge: workflow en verde, `/ready` 200 en `checklist.wefaber.net` y un `execute` real con un token
      (`wefaber-house:deploy-verifier`).
- [ ] La migración `0005_api_tokens.sql` es aditiva; si M4 (links a GitHub) entra primero con su propia `0005`, se
      renumera la que quede segunda antes de mergear.
