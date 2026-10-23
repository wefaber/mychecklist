# MyChecklist

App de listas y tareas (web + desktop). Herramienta de la casa WeFaber, repo `faku-org/mychecklist`.

## Leer antes de trabajar

| Si tocás…              | Leé primero                                                        |
| ---------------------- | ------------------------------------------------------------------ |
| Server, datos, deploy  | `ARCHITECTURE.md` (extiende `~/.claude/standards/ARCHITECTURE.md`) |
| Cualquier UI           | `DESIGN.md` (extiende `~/.claude/standards/DESIGN.md`)             |
| Una decisión ya tomada | `docs/adr/` (no se editan los aceptados; se reemplazan con otro)   |
| Qué sigue              | `docs/roadmap.md`                                                  |

## Reglas del repo

- Bun, nunca npm/npx. TypeScript `strict`. `bun run check` en verde antes de cada commit; no se usa `--no-verify`.
- Una sola vía de mutación: GraphQL, Code Mode, import y jobs llaman a `server/services/*`.
- SQL solo bajo `server/db/`; las tablas con dueño (`org_id`) solo las toca `server/db/scoped.ts`
  (`scripts/check-scoped.ts` lo exige).
- Migraciones expand/contract: blue y green comparten la base durante un cambio de slot. Una migración aplicada no
  se edita.
- Textos de la UI en español rioplatense vía `web/i18n`, sin emojis ni signos de exclamación. Identificadores en
  inglés, comentarios en español.
- Íconos: `lucide-react`. Colores solo por roles de `@wefaber/tokens`.
- Secretos fuera del repo: `.env.local` en local, `~/deploy/env/mychecklist.env` en el servidor.

## Entrega

Rama → commit → PR → review de Faku → merge. Un push a `main` despliega por GitOps. Commits:
`<type>(<scope>): <msg> [v<version>]`. La versión vive en `package.json` (y se replica en `src-tauri` desde M8).
