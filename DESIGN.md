# Design

Extiende el diseño de la casa (`~/.claude/standards/DESIGN.md`). Solo desviaciones y específicos del producto.
Tema: **Forest** (`@wefaber/tokens/themes/forest.css`), oscuro por defecto. Referencias: WePanel, teleprompter.

## Principios propios

1. **Una lista a la vez.** La pantalla responde "qué sigue" en esa lista; el resto está a un atajo de distancia.
2. **El Markdown manda.** El item es texto; lo demás (links de GitHub, backlinks, adjuntos) se deriva y se muestra
   como chips, nunca como formularios.
3. **Teclado primero** (herramienta): `Mod+K` paleta, `?` atajos, un solo registro.
4. **Deshacer, no confirmar.** Completar y borrar se deshacen; la confirmación escrita solo para borrar una
   organización.

## Tokens

Roles de la casa sin cambios (`--bg`, `--surface`, `--surface-2/3`, `--border`, `--text`, `--text-muted`, `--accent`,
`--on-accent`, `--danger`, `--warning`, `--success`). El tema por defecto es Forest; Azul, Teal y Vault
se eligen con `data-palette` (y claro u oscuro con `data-theme`). Los estados de GitHub usan color + ícono: abierto (`--success`), cerrado (`--danger`),
mergeado (`--review`).

## Shell

Contenido centrado, ancho máximo 3xl en M0; la vista de lista crece en X (hasta ~1800 px) cuando haya tablas o
tableros. Detalle del item en `Dock` a la derecha. Filtros siempre sobre el contenido que filtran.

## Vistas y componentes (M2)

- **Barra de listas** (`ListsBar`), pegada arriba: una línea con todas las listas como enlaces; se elige una a la vez.
  Alta y renombre en línea; el menú de la lista activa mueve y borra.
- **Lista** (`ListPage`): filtros sobre el contenido (todos, sin completar, completados) con el conteo de lo que
  queda; filas con casilla, texto que abre el detalle, subitems indentados y un menú de acciones. Estado nunca solo por
  color: la casilla cambia de forma y el texto completado va tachado.
- **Detalle** (`ItemDock`): a la derecha, sobre la lista. A partir de 1024 px la lista se corre a la izquierda
  (`--dock-inset`) para no quedar tapada; en pantallas angostas el panel la cubre.
- **Paleta** (`CommandPalette`): comandos, ir a una lista y búsqueda de items en el servidor. **Ayuda**
  (`ShortcutsDialog`): lee del mismo registro de atajos (`web/lib/shortcuts.ts`).
- **Aviso con Deshacer** abajo, con región `aria-live`. Los errores explican qué pasó y duran más.
- **Temas:** Forest, Azul, Teal y Vault por `data-palette` y `data-theme`. `web/styles/palettes.css` se genera con
  `scripts/gen-palettes.ts` y un test falla si queda viejo. Vault es solo claro.
- **`/design`:** laboratorio con muestras y revisión de accesibilidad con axe-core en cada tema.

### Mapa de teclado

| Dónde  | Tecla                                    | Qué hace                                   |
| ------ | ---------------------------------------- | ------------------------------------------ |
| Global | `Mod+K`, `?`, `Mod+Z`                    | Paleta, ayuda, deshacer                    |
| Listas | `Shift+N`, `G N`, `G P`                  | Nueva lista, siguiente, anterior           |
| Items  | `N`, flechas, `Space`, `Enter`, `Delete` | Agregar, moverse, completar, abrir, borrar |
| Items  | `Alt+↑/↓`, `Alt+←/→`                     | Subir o bajar, cambiar de nivel            |
| Dock   | `Escape`, `Mod+Enter` en el texto        | Cerrar, guardar                            |

Las teclas sueltas no se disparan mientras se escribe en un campo. `Tab` no se reasigna: sigue moviendo el foco.

## Checklist de pantalla (agregados)

- [x] Arrastrar tiene alternativa de teclado (`Alt+flechas`) y anuncia el movimiento en una región `aria-live`.
- [ ] El texto del item sobrevive a un round-trip por el export Markdown.
- [ ] El estado de GitHub nunca depende solo del color.
