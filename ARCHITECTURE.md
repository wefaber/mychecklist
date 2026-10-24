# Architecture

Extiende la arquitectura de la casa (`~/.claude/standards/ARCHITECTURE.md`). Acá solo lo específico y las
desviaciones. Tipo de sistema: **herramienta** con una puerta pública para uso personal.

## Forma

Un proceso Bun por slot: API GraphQL + Code Mode + estáticos + jobs. Web y desktop (Tauri) son el mismo cliente React
contra `/graphql`; el desktop guarda una caché de lectura para verse sin conexión (escribir sin conexión es trabajo
futuro).

```
web/ (cliente) ──► Nginx ──► Bun :4161/4162 (público)   uso personal
desktop (Tauri) ─┘      └──► Bun :4163/4164 (tailnet)  organizaciones
                                 └─ services/ ─► db/ (SQLite WAL)
GraphQL ┐
Code Mode├─► services/*  (única vía de mutación → activity + SSE)
import   │
jobs     ┘
```

## Desviaciones y decisiones propias

- **Ingress por socket, no por header** (ADR 0001). Un proceso, dos listeners; el `ingress` sale del socket por el que
  entró la request. Las organizaciones `team` solo se leen desde el listener de la tailnet.
- **Code Mode en vez de un MCP con una tool por operación** (ADR 0002). La interfaz de agentes son dos funciones,
  `search` y `execute`, sobre una API tipada; corren en QuickJS dentro de un Worker. Es la excepción a "todo API nuevo
  es GraphQL": llama a los mismos `services/`.
- **Login con una GitHub App usada solo para tokens de usuario** (ADR 0003). Sin contraseñas ni webhooks.

## Estado por etapa

| Parte                                                                                           | Etapa      |
| ----------------------------------------------------------------------------------------------- | ---------- |
| `/health`, `/ready`, `/graphql` (solo `version`), migraciones, `check-scoped`, spike de QuickJS | M0 (hecho) |
| Auth, sesiones, org personal, dos listeners, `scoped.ts`                                        | M1 (hecho) |
| Listas e items, orden fraccional, deshacer, SSE, temas                                          | M2 (hecho) |
| Markdown, backlinks, adjuntos                                                                   | M3 (hecho) |
| Links a GitHub                                                                                  | M4 (hecho) |
| Code Mode completo (`/codemode/*`, `/mcp`)                                                      | M5 (hecho) |
| Importar y exportar                                                                             | M6 (hecho) |
| Orgs de equipo: invitaciones y roles                                                            | M7 (hecho) |
| Desktop completo, Ether                                                                         | M8–M9      |

## Identidad y acceso (M1)

- **Login:** `GET /auth/github/login` → GitHub → `GET /auth/github/callback`. El estado de OAuth viaja en una cookie
  del navegador que inició el login; `return` solo admite rutas del mismo sitio. Intentos limitados por dirección, en
  memoria (no se guarda ninguna IP).
- **Sesión:** cookie `__Host-mc_session` (`HttpOnly`, `Secure`, `SameSite=Lax`); en la base queda solo el sha256. Vale
  30 días y solo en la puerta donde se emitió: una sesión de la tailnet no sirve en el listener público.
- **Tokens de GitHub:** AES-256-GCM con `MYCHECKLIST_TOKEN_KEY`; sin clave, el login falla cerrado.
- **Orgs:** cada usuario tiene una org `personal` (owner). `team` llega con M7. El listener público no lista ni abre
  orgs `team`.
- **Acceso a datos:** `openScope(db, { orgId, userId, ingress })` en `server/db/scoped.ts` es la única puerta a las
  tablas con `org_id` (`activity`, `lists`, `items`). Verifica org, membresía e ingress y devuelve `FORBIDDEN` en todos los casos.
  Los servicios (`server/services/*`) arman el `Caller` y GraphQL solo llama a servicios.
- **Errores:** `DomainError(code)` en el dominio; GraphQL lo expone como `extensions.code` (`UNAUTHENTICATED`,
  `FORBIDDEN`, ...).

## Listas e items (M2)

- **Datos:** `lists` e `items` (con `org_id`, solo vía `scoped.ts`). Un nivel de subitems; orden fraccional y borrado
  lógico (ADR 0004). Los items y las listas se leen y mutan por `server/services/{lists,items}.ts`; GraphQL solo arma
  el `Caller` y los llama.
- **Avisos en vivo (SSE):** `GET /events?org=` exige sesión de esa puerta y membresía. Cada mutación publica un
  evento en un bus en memoria (`server/events.ts`, compartido por los dos listeners) sin datos del contenido: el
  cliente invalida y vuelve a pedir por GraphQL. Hay un ping cada 25 s; Nginx lo sirve sin buffer. Con más de un
  proceso por slot el bus no cruza procesos (hoy hay uno).
- **Origen:** un `POST /graphql` con un `Origin` que no sea una de las dos URLs configuradas da 403. Las mutaciones
  usan la cookie de sesión y `SameSite=Lax` no alcanza contra un subdominio ajeno.
- **Límites:** 200 listas por org, 5000 items por lista, 80 caracteres por nombre y 4000 por item.

## Markdown, referencias y adjuntos (M3)

- **Referencias:** `[[<id>]]` en el texto; `shared/refs.ts` las extrae (servidor) y las dibuja (cliente) con el mismo
  recorrido del Markdown (ADR 0005). `item_refs` es solo un índice que `services/items.ts` reescribe en la misma
  transacción que el texto. GraphQL: `Item.mentions` (viene con la lista, en una consulta), `Item.backlinks` (solo si
  se pide) y `Org.item(id)`.
- **Adjuntos:** `POST /files/:org` (cuerpo crudo, nombre en `X-File-Name`, hasta 10 MB) y `GET /files/:org/:id`. Pasan por
  `services/attachments.ts` y `scoped.ts` como todo lo demás; el contenido va a `files/<aa>/<sha256>` (`server/files.ts`,
  carpeta `MYCHECKLIST_FILES`, por defecto al lado de la base) con escritura atómica. Se sirve con `nosniff`, CSP
  `sandbox` y solo PNG, JPEG, GIF y WebP en línea; lo demás se descarga.
- **Cliente:** `web/lib/markdown.tsx` (`row` dentro de un botón, inerte; `full` en el detalle). El detalle suma
  pegar, soltar y adjuntar archivos, el selector `[[` y la lista de backlinks.
- **Límites:** 10 MB por archivo, 500 MB por org, 50 referencias distintas por item, 100 backlinks por item.
- **Nginx:** `location /files/` con `client_max_body_size 10m` en los dos vhosts.

## Links a GitHub (M4)

- **Reconocer:** `shared/github.ts` lee URLs `https://github.com/<owner>/<repo>/(issues|pull)/<n>` (mismo código en el
  cliente y en el servidor, ADR 0006). Es chip solo el link cuyo texto es la propia URL.
- **Consultar:** `githubLinks(refs)` por GraphQL (hasta 50 links, requiere sesión) → `services/github.ts`. Los repos
  públicos se resuelven con el token de instalación de la App y quedan en un caché global; los privados, con el token de
  quien mira y en su caché (`github_public_links`, `github_private_links`, `github_repos`; sin `org_id`, solo las toca
  `server/db/github.ts`). A la tabla global solo entra lo que GitHub respondió con `isPrivate: false`.
- **Refrescar:** perezoso, sin job. Vence a los 5 minutos si está abierto, a la hora si está cerrado o mergeado, a los 10
  si no existe. El cliente repite el pedido al abrir el detalle, al volver a la pestaña y cada 5 minutos con el chip a la
  vista; los chips que aparecen juntos salen en un solo pedido (`web/lib/github.ts`).
- **Límites:** lotes de 25 links por consulta de GitHub; con menos de 200 pedidos restantes el servidor deja de consultar
  con ese token hasta que se reinicia el límite y responde con el caché. Los tokens de usuario se renuevan con el refresh
  token (una renovación a la vez por usuario); el de instalación vive en memoria.
- **Config:** `GITHUB_APP_ID` y `GITHUB_APP_PRIVATE_KEY` (opcionales, `deploy/README.md`). Sin ellas todo se resuelve con
  el token de quien mira.
- **Verificación con GitHub real:** `GITHUB_TOKEN=$(gh auth token) bun scripts/github-live.ts <url>...`.
## Code Mode (M5)

- **Tokens** (ADR 0007): `api_tokens`, `mck_` + 32 bytes en base64url, solo el sha256 en la base y el secreto visible una
  vez. Un token es un usuario, una org y una puerta; modo `read` o `write`; vence a los 90 días por defecto. Se crean,
  listan y revocan por GraphQL con sesión (`createApiToken`, `Org.apiTokens`, `revokeApiToken`), solo `owner` o `admin`,
  hasta 20 vigentes por usuario y org. La pantalla está en `/ajustes/tokens`. La tabla no es "con dueño": se busca por
  hash antes de que exista un scope (`server/db/tokens.ts`); todo lo que el token hace pasa por `openScope`, que revisa
  membresía y puerta en cada llamada.
- **Registry** (`server/services/registry.ts`): cada operación se declara una vez con `defineOp` (esquemas TypeBox, modo
  `read`/`write`) y llama a `services/*` con el `Caller` del token (`via: 'mcp'`). Ninguna operación recibe `orgId`.
  `scripts/gen-codemode.ts` genera `server/mcp/generated/checklist.d.ts` y `spec.json`; un test falla si quedan viejos.
  Agregar una operación al registry la expone sola en `search`, `execute` y el d.ts.
- **Sandbox**: cada ejecución levanta un Bun Worker (`server/mcp/worker.ts`) con QuickJS (`sandbox.ts`) y el host
  (`exec.ts`) atiende las llamadas por `postMessage`, las valida contra el esquema y las cuenta. Límites: 5 s (el Worker
  se corta con `terminate()` a los 6), 64 MB, 50 llamadas, 64 KB de resultado, 200 líneas de log, 32 KB de código, 64 KB
  de cuerpo y 500 items por lectura. Un `execute` con token de lectura ni siquiera tiene las operaciones de escritura.
- **Frecuencia** (`limiter.ts`): una ejecución a la vez por token, 60 por minuto y 4 Workers por proceso, en memoria; si
  no hay lugar, 429 `RATE_LIMITED` (no hay cola).
- **Rutas**: `POST /codemode/search`, `POST /codemode/execute` y `POST /mcp` (Streamable HTTP sin estado ni SSE,
  `initialize`/`ping`/`tools/list`/`tools/call`). Bearer `Authorization`; un `Origin` ajeno da 403; la cookie de sesión no
  sirve acá ni el Bearer en `/graphql`. Nginx proxea `/codemode/` y `/mcp` en los dos vhosts (cuerpo de hasta 64 KB).
- **Ergonomía**: en `lists.create`, `items.create` y los `move`, `afterId` omitido es "al final" y `null` "al principio".
  Los errores del host llegan al código como `Error` con `message` `CODIGO: texto`.

## Importar y exportar (M6)

- **Formato:** un JSON con `format: "mychecklist"` y `schema` entero (ADR 0008): listas con sus items en orden de árbol,
  borrados lógicos incluidos, y adjuntos en base64. Sin `activity`, sin `item_refs` (se recalcula) y sin autoría.
- **Servicio:** `server/services/transfer.ts` (`exportOrg`, `importOrg`) y `transfer-format.ts` (tipos y validación).
  Importar siempre agrega, valida todo antes de escribir y mete listas, items, referencias y registros de adjuntos en una
  sola transacción. Los ids se regeneran y `shared/refs.ts › remapIds` reescribe `[[id]]`, `item:<id>` y `attachment:<id>`
  en los textos por posición, con el mismo recorrido de Markdown que las referencias.
- **HTTP:** `GET /export/:org` (descarga; `?attachments=0` va sin contenido) y `POST /import/:org` (JSON crudo). Sesión de la
  puerta, membresía y, en el POST, `Origin` propio.
- **Límites:** 32 MB de adjuntos por export, 48 MB de cuerpo por import, 1000 listas y 100 000 items por archivo.
- **Nginx:** `location /export/` y `location /import/` (`client_max_body_size 48m`) en los dos vhosts.

## Code Mode (M5)

- **Tokens** (ADR 0007): `api_tokens`, `mck_` + 32 bytes en base64url, solo el sha256 en la base y el secreto visible una
  vez. Un token es un usuario, una org y una puerta; modo `read` o `write`; vence a los 90 días por defecto. Se crean,
  listan y revocan por GraphQL con sesión (`createApiToken`, `Org.apiTokens`, `revokeApiToken`), solo `owner` o `admin`,
  hasta 20 vigentes por usuario y org. La pantalla está en `/ajustes/tokens`. La tabla no es "con dueño": se busca por
  hash antes de que exista un scope (`server/db/tokens.ts`); todo lo que el token hace pasa por `openScope`, que revisa
  membresía y puerta en cada llamada.
- **Registry** (`server/services/registry.ts`): cada operación se declara una vez con `defineOp` (esquemas TypeBox, modo
  `read`/`write`) y llama a `services/*` con el `Caller` del token (`via: 'mcp'`). Ninguna operación recibe `orgId`.
  `scripts/gen-codemode.ts` genera `server/mcp/generated/checklist.d.ts` y `spec.json`; un test falla si quedan viejos.
  Agregar una operación al registry la expone sola en `search`, `execute` y el d.ts.
- **Sandbox**: cada ejecución levanta un Bun Worker (`server/mcp/worker.ts`) con QuickJS (`sandbox.ts`) y el host
  (`exec.ts`) atiende las llamadas por `postMessage`, las valida contra el esquema y las cuenta. Límites: 5 s (el Worker
  se corta con `terminate()` a los 6), 64 MB, 50 llamadas, 64 KB de resultado, 200 líneas de log, 32 KB de código, 64 KB
  de cuerpo y 500 items por lectura. Un `execute` con token de lectura ni siquiera tiene las operaciones de escritura.
- **Frecuencia** (`limiter.ts`): una ejecución a la vez por token, 60 por minuto y 4 Workers por proceso, en memoria; si
  no hay lugar, 429 `RATE_LIMITED` (no hay cola).
- **Rutas**: `POST /codemode/search`, `POST /codemode/execute` y `POST /mcp` (Streamable HTTP sin estado ni SSE,
  `initialize`/`ping`/`tools/list`/`tools/call`). Bearer `Authorization`; un `Origin` ajeno da 403; la cookie de sesión no
  sirve acá ni el Bearer en `/graphql`. Nginx proxea `/codemode/` y `/mcp` en los dos vhosts (cuerpo de hasta 64 KB).
- **Ergonomía**: en `lists.create`, `items.create` y los `move`, `afterId` omitido es "al final" y `null` "al principio".
  Los errores del host llegan al código como `Error` con `message` `CODIGO: texto`.

## Organizaciones de equipo (M7)

- **Modelo** (ADR 0009): `orgs.kind = 'team'` con `org_members.role` (`owner`, `admin`, `member`) e `org_invitations`
  (`login` de GitHub en minúsculas, rol `admin` o `member`, vence a los 14 días, una vigente por `(org, login)`). Ninguna
  de las dos tablas es "con dueño" de `scoped.ts`: la persona invitada todavía no es miembro. Todo el SQL está en
  `server/db/members.ts` y cada servicio de `server/services/members.ts` abre `openScope` (membresía y puerta) antes.
- **Roles:** `member` lee y escribe y exporta; `admin` además invita y quita `member`, revoca invitaciones de `member`,
  crea tokens de API e importa; `owner` además invita `admin`, cambia roles y quita a cualquiera. Siempre queda al menos
  un `owner` (`CONFLICT`). Nadie se quita a sí mismo: `leaveOrg`. Salir o ser quitado revoca los tokens de API de esa
  persona en esa org.
- **Puerta:** crear una org, invitar, aceptar y ver invitaciones son solo de la tailnet. Por el listener público
  `User.invitations` da vacío y las mutaciones dan `FORBIDDEN`. `Query.ingress` le dice al cliente por cuál mira.
- **API:** `createTeamOrg`, `inviteMember`, `revokeInvitation`, `acceptInvitation`, `declineInvitation`, `setMemberRole`,
  `removeMember`, `leaveOrg`; `Org.members`, `Org.invitations` (solo `owner` y `admin`) y `User.invitations`. No hay
  operaciones de miembros en Code Mode: administrar gente es de sesión, no de agentes.
- **Avisos:** los cambios publican `scope: 'members'` en el bus. El stream SSE verifica la membresía en cada aviso y en
  cada ping y se cierra para quien ya no pertenece.
- **Cliente:** la org en pantalla se recuerda en `localStorage` (`mychecklist.org`) y cae a la personal si ya no
  pertenece a ella (`web/features/orgs/active.ts`). `OrgMenu` en la barra superior (solo si hay algo que elegir o crear)
  y la pantalla `/equipo` para crear, invitar, aceptar y administrar.
- **Límites:** 50 miembros y 50 invitaciones vigentes por org; 10 orgs de equipo como creador.

## Red y puertos

| Qué     | Blue | Green |
| ------- | ---- | ----- |
| Público | 4161 | 4162  |
| Tailnet | 4163 | 4164  |

Dominio público: `checklist.wefaber.net`. Siempre escucha en loopback; Nginx es lo único que ve la red. Antes del
primer deploy hay que confirmar que los puertos estén libres (`ss -ltnp`).

## Datos

SQLite en `/home/hermes/data/mychecklist/` (WAL, `foreign_keys=ON`, `busy_timeout`). Archivos adjuntos en
`files/<aa>/<sha256>` de la misma carpeta (se cargan por `/files`, ver M3). Backups cada hora con `VACUUM INTO`, fuera del host.
