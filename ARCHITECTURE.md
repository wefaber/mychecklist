# Architecture

Extiende la arquitectura de la casa (`~/.claude/standards/ARCHITECTURE.md`). Acá solo lo específico y las
desviaciones. Tipo de sistema: **herramienta** con una puerta pública para uso personal.

## Forma

Un proceso Bun por slot: API GraphQL + Code Mode + estáticos + jobs. Web y desktop (Tauri) son el mismo cliente React
contra `/graphql`; el desktop guarda una caché de lectura para verse sin conexión (escribir sin conexión es trabajo
futuro).

```
web/ (cliente) ──► Nginx ──► Bun :4161/4162 (público)   uso personal
desktop (Tauri) ─┘      └──► Bun :4163/4164 (tailnet)  organizaciones   [M1]
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
| Auth, sesiones, org personal, dos listeners, `scoped.ts`                                        | M1         |
| Listas e items, SSE                                                                             | M2         |
| Markdown, backlinks, adjuntos                                                                   | M3         |
| Links a GitHub                                                                                  | M4         |
| Code Mode completo (`/codemode/*`, `/mcp`)                                                      | M5         |
| Import/Export, orgs de equipo, desktop completo, Ether                                          | M6–M9      |

## Red y puertos

| Qué          | Blue | Green |
| ------------ | ---- | ----- |
| Público      | 4161 | 4162  |
| Tailnet (M1) | 4163 | 4164  |

Dominio público: `checklist.wefaber.net`. Siempre escucha en loopback; Nginx es lo único que ve la red. Antes del
primer deploy hay que confirmar que los puertos estén libres (`ss -ltnp`).

## Datos

SQLite en `/home/hermes/data/mychecklist/` (WAL, `foreign_keys=ON`, `busy_timeout`). Archivos adjuntos en
`files/<aa>/<sha256>` de la misma carpeta. Backups cada hora con `VACUUM INTO`, fuera del host.
