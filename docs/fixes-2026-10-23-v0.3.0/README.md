# Fixes 2026-10-23 · v0.3.0 (M2)

Hallazgos y pendientes de la etapa de listas, items, Dock, `Mod+K`, deshacer, SSE y temas.

## Servidor

- [x] Orden fraccional: insertar entre dos, al principio y al final mantiene el orden (`shared/order.test.ts`,
      `server/lists.test.ts`).
- [x] Subitems de un solo nivel, sin ciclos, y un item con subitems no puede volverse subitem (`server/lists.test.ts`).
- [x] Borrar y restaurar items y listas, con subitems incluidos; un subitem no vuelve con el padre borrado.
- [x] Otro usuario no lee ni toca listas ni items ajenos; no se mueve un item a una lista de otra org.
- [x] Una org `team` solo se opera por la tailnet (lista y items).
- [x] Una request con `Origin` de otro sitio a `/graphql` da 403 (las mutaciones usan la cookie de sesión).
- [x] SSE `/events?org=`: 401 sin sesión, 403 sin membresía, y un cambio llega solo a quien mira esa org.
- [ ] Purga de datos borrados con retención (hoy el borrado lógico no se limpia nunca).
- [~] El bus de SSE es en memoria: con un solo proceso por slot alcanza. Si un día hay más de un proceso, el SSE de uno
  no ve los cambios del otro (ver ARCHITECTURE.md).
- [ ] `Origin` aceptado: solo las dos URLs configuradas. El desktop (Tauri) manda otro origen y se resuelve en M8.

## Cliente

- [x] Listas: crear (botón y `Mayús+N`), renombrar, mover, borrar y deshacer; una lista a la vez, con ruta propia
      (`/l/<id>`).
- [x] Items: agregar con Enter, completar, editar en el Dock, subitems, mover con `Alt+flechas`, pasar de nivel con
      `Alt+←/→` y mover entre listas desde el menú o el Dock. Verificado en el navegador.
- [~] Arrastrar con el mouse está implementado (HTML5 drag and drop) y la lógica de destino tiene tests
  (`tree.test.ts`), pero no se probó con un puntero real: el navegador del entorno no entrega eventos de arrastre.
- [x] Deshacer: botón del aviso y `Ctrl+Z` para mover, borrar, completar, editar y renombrar (verificado: mover y
      borrar lista o item).
- [x] `Mod+K`: comandos, listas y búsqueda de items en el servidor (con `%` y `_` como texto).
- [x] `?`: ayuda de atajos leída del mismo registro que la paleta y el listener.
- [x] SSE: un item creado desde otro cliente aparece sin recargar y actualiza el contador de la lista.
- [x] Cuatro temas (Forest, Azul, Teal, Vault) con modo claro y oscuro donde existe; se pintan antes del primer render y
      se guardan.
- [x] axe-core (WCAG 2.2 AA) en la lista real con el Dock abierto, en los siete temas/modos: 0 violaciones.
      También en la paleta y en el diálogo de atajos (Forest, Azul claro y Vault).
- [x] `/design`: muestras y revisión con axe en un tema o en los cuatro; transiciones apagadas durante la revisión.
- [ ] Prueba con lector de pantalla real (hoy solo axe y la lectura del árbol de accesibilidad).
- [ ] Probar el arrastre y los atajos con un teclado físico en el desktop (Tauri) cuando llegue M8.
- [ ] Mobile: el Dock cubre la lista en pantallas angostas (diseño de la casa); falta revisar la barra de listas con
      el dedo.

## Para el kit (`@wefaber/ui` y `@wefaber/tokens`)

- [ ] `Button variant="danger"`: `text-danger` sobre el relleno tonal `bg-text/8` da 4,37:1 en Forest claro y 4,32:1 en
      Azul claro (mínimo 4,5:1). En esta app no se usa el botón `danger` (lo destructivo va en el menú sobre
      `--surface`), y se sacó de las muestras de `/design` para que la revisión pase; reportar en `wefaber/kit`.
- [ ] `Field` no tipa `ref` aunque React 19 lo reenvía: `web/components/TextField.tsx` lo envuelve con un cast. Sacar
      el envoltorio cuando el kit lo tipe.

## Pendiente de Faku

- [ ] Todo lo de v0.2.0 sigue pendiente (GitHub App, tailnet, puertos, DNS): sin eso no hay login real en producción.
- [ ] Nginx: los dos vhosts ganaron `location = /events` (sin buffer, lectura de 1 h). Recargar Nginx con la config
      nueva antes del primer deploy de M2.
