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
| Listas e items, SSE                                                                             | M2         |
| Markdown, backlinks, adjuntos                                                                   | M3         |
| Links a GitHub                                                                                  | M4         |
| Code Mode completo (`/codemode/*`, `/mcp`)                                                      | M5         |
| Import/Export, orgs de equipo, desktop completo, Ether                                          | M6–M9      |

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
  tablas con `org_id` (hoy `activity`). Verifica org, membresía e ingress y devuelve `FORBIDDEN` en todos los casos.
  Los servicios (`server/services/*`) arman el `Caller` y GraphQL solo llama a servicios.
- **Errores:** `DomainError(code)` en el dominio; GraphQL lo expone como `extensions.code` (`UNAUTHENTICATED`,
  `FORBIDDEN`, ...).

## Red y puertos

| Qué     | Blue | Green |
| ------- | ---- | ----- |
| Público | 4161 | 4162  |
| Tailnet | 4163 | 4164  |

Dominio público: `checklist.wefaber.net`. Siempre escucha en loopback; Nginx es lo único que ve la red. Antes del
primer deploy hay que confirmar que los puertos estén libres (`ss -ltnp`).

## Datos

SQLite en `/home/hermes/data/mychecklist/` (WAL, `foreign_keys=ON`, `busy_timeout`). Archivos adjuntos en
`files/<aa>/<sha256>` de la misma carpeta. Backups cada hora con `VACUUM INTO`, fuera del host.
