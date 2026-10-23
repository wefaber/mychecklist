# Roadmap

Cada etapa es una rama, un PR, review de Faku y merge. Los pendientes de largo plazo van como issues del repo en el
proyecto del org en GitHub Projects.

| #   | Qué                                                                                                       | Se verifica                                                                        |
| --- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| M0  | Esqueleto: `web/`, Elysia con `/health` y `/ready`, migraciones, tooling, docs, deploy y spike de QuickJS | `bun run check` en verde; `/ready` 200 en `checklist.wefaber.net`                  |
| M1  | Login con GitHub, sesiones, org personal, dos listeners, `scoped.ts`                                      | Tests de aislamiento; una org `team` pedida por el listener público da `FORBIDDEN` |
| M2  | Listas e items: orden fraccional, subitems, `Dock`, `Mod+K`, deshacer, SSE y temas                        | Flujos en el navegador; axe en `/design` con los 4 temas                           |
| M3  | Markdown, backlinks, adjuntos                                                                             | Tests del parser de refs; pegar una imagen en el navegador                         |
| M4  | Links a GitHub con refresco                                                                               | Fixtures del parser y del batch; chips contra un repo real                         |
| M5  | Code Mode: `api_tokens`, registry, sandbox en Worker, `/codemode/*` y `/mcp`                              | Tests de escape y de límites; un `execute` crea 10 items en 3 listas               |
| M6  | Importar y exportar                                                                                       | Round-trip JSON sin pérdida                                                        |
| M7  | Organizaciones de equipo: invitaciones, roles                                                             | Tests de roles; acceso solo por tailnet                                            |
| M8  | Desktop: device flow, keyring, caché offline, updater y release                                           | Un tag de borrador instala y actualiza                                             |
| M9  | Ether (orbe con personalidad) y primeras funciones de IA                                                  | Orbe en los 4 temas, reduced motion, axe                                           |

## Largo plazo

- Escribir sin conexión en el desktop.
- Importar desde Todoist y desde issues de GitHub.
