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

## Markdown, menciones y adjuntos (M3)

- **Una fila dibuja el Markdown en línea y sin nada activo:** negrita, énfasis, código, links como texto subrayado,
  imágenes como ícono con su descripción y menciones como chip. Un item sin marcas se ve como texto plano, igual que
  antes. Dentro del botón de la fila no hay links ni botones: abrir el detalle es la única acción.
- **El detalle escribe y muestra:** el campo de texto va arriba (con `@` para mencionar y el clip para adjuntar) y la
  **Vista** renderizada debajo, con links activos, imágenes, tablas, casillas y chips que abren el item mencionado.
- **Chip de mención:** título del item con ícono de casilla y tachado si está completado (nunca solo color). Un item que
  ya no existe se ve "Item no disponible", en cursiva y con ícono, sin dato clicable.
- **Chip de GitHub:** una URL de issue o PR pegada suelta se dibuja como chip con ícono de tipo y estado (issue abierto,
  cerrado, cerrado como no planeado; PR abierto, borrador, mergeado, cerrado), `repo#n` y el título truncado. El estado
  también va en texto para lectores de pantalla, nunca solo en el ícono ni en el color. Sin dato (cargando, sin acceso,
  sin conexión) queda `repo#n` en `--muted` con el motivo en texto. En una fila es inerte; en el detalle es un link a
  GitHub en otra pestaña. Un `[texto](url)` con texto propio sigue siendo un link normal.
- **Links:** el color del texto con subrayado grueso en `--accent`. El texto en `--accent` sobre `--surface-2` no llega a
  4,5:1 en Azul claro.
- **Títulos dentro de un item:** siempre `h4`, un nivel debajo de las secciones del detalle, para no romper el esquema
  de la página.
- **Imágenes solo adjuntas:** una imagen de otro sitio se muestra como texto con su descripción.
- **"Mencionado en"** lista los items que enlazan al abierto, con su lista; cada uno lo abre.
- **Selector `[[`** (`MentionPicker`): diálogo con búsqueda en el servidor, igual que la paleta; flechas, Enter y Esc.

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
- [ ] El texto del item sobrevive a un round-trip por el export Markdown (M6).
- [x] El Markdown, los chips y el selector pasan axe en los cuatro temas (`/design`) y en el detalle abierto.
- [ ] El estado de GitHub nunca depende solo del color.
