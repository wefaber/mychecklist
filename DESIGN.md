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
`--on-accent`, `--danger`, `--warning`, `--success`). El tema por defecto es Forest; Azul, Teal y Vault se suman en M2
y se cambian con `data-theme`. Los estados de GitHub usan color + ícono: abierto (`--success`), cerrado (`--danger`),
mergeado (`--review`).

## Shell

Contenido centrado, ancho máximo 3xl en M0; la vista de lista crece en X (hasta ~1800 px) cuando haya tablas o
tableros. Detalle del item en `Dock` a la derecha. Filtros siempre sobre el contenido que filtran.

## Pendiente de definir

Componentes propios, vistas y mapa de teclado se completan con M2.

## Checklist de pantalla (agregados)

- [ ] El texto del item sobrevive a un round-trip por el export Markdown.
- [ ] El estado de GitHub nunca depende solo del color.
