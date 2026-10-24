# MyChecklist

Listas y tareas con Markdown, links a issues, PRs y branches de GitHub, backlinks entre items, organizaciones con
login y una API de Code Mode para agentes. Corre en la web (`checklist.wefaber.net`) y como app de escritorio
(Tauri) contra el mismo servidor.

Es una herramienta de la casa WeFaber: sigue `~/.claude/standards/ARCHITECTURE.md` y `DESIGN.md`. El plan por
etapas está en [docs/roadmap.md](docs/roadmap.md).

## Estructura

| Carpeta      | Qué hay                                                                                                                            |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `web/`       | Cliente React 19 (raíz de Vite): `app/`, `features/`, `components/`, `lib/`, `styles/`, `i18n/`                                    |
| `server/`    | Un proceso Bun: Elysia + GraphQL (Yoga + Pothos), `services/` (única vía de mutación), `domain/` (puro), `db/`, `mcp/` (Code Mode) |
| `shared/`    | Código compartido entre `web/` y `server/` (orden fraccional)                                                                      |
| `src-tauri/` | Shell de escritorio (Tauri 2); carga `dist/web`                                                                                    |
| `scripts/`   | `check-scoped.ts` y herramientas del repo                                                                                          |
| `deploy/`    | Script blue/green, unidad systemd y vhost de Nginx                                                                                 |
| `docs/`      | Visión, roadmap y ADRs                                                                                                             |

## Requisitos (Windows)

Bun, Rust (MSVC) con las Build Tools de Visual Studio y WebView2. Solo la app de escritorio necesita Rust.

## Uso

```bash
bun install
bun run dev:server        # API en 127.0.0.1:4161
bun run dev:web           # cliente en http://localhost:5191 (proxy a la API)
bun run tauri dev         # app de escritorio (levanta dev:web solo)
```

El login con GitHub es opcional en local: sin credenciales el resto anda y la UI avisa que el login no está
disponible. Para probarlo, creá una GitHub App con el callback `http://localhost:5191/auth/github/callback` y poné
en `.env.local` (Bun lo lee solo, está fuera del repo):

```
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
MYCHECKLIST_TOKEN_KEY=...   # openssl rand -base64 32
```

Herramientas sueltas: `bun scripts/gen-palettes.ts` regenera los temas de `web/styles/palettes.css`;
`bun scripts/dev-session.ts` imprime la cookie de una sesión de prueba para entrar en local sin GitHub (solo toca la
base de desarrollo).

## Scripts

| Script                | Qué hace                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------- |
| `bun run check`       | `tsc --noEmit`, `oxlint`, `check-scoped` y `bun test`. Tiene que pasar antes de cada commit |
| `bun run build`       | Compila el cliente en `dist/web`                                                            |
| `bun run start`       | Arranca el servidor (producción)                                                            |
| `bun run fmt`         | Formatea con `oxfmt`                                                                        |
| `bun run dev:desktop` | Servidor local + `tauri dev`; la ventana entra sola con una sesión de prueba (`/auth/dev`)  |

## Deploy

Push a `main` dispara `.github/workflows/deploy.yml` en el runner de `wefaber`, que corre `check`, `build` y
`deploy/mychecklist.sh` (blue/green). Para la instalación única en el VPS: [deploy/README.md](deploy/README.md).
