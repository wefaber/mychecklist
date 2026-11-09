# Fixes 2026-11-09 · v0.14.0

## Para completar, las casillas tienen que estar marcadas

Pedido de Faku: un item que tiene casillas (`- [ ]` en su texto) solo se puede completar si están todas marcadas.

- [x] Regla en el servicio (`setItemDone`), así vale igual por GraphQL, Code Mode y la UI. Solo al pasar de abierto a
      completo; el error es `INVALID_INPUT` con "Falta 1 casilla…" o "Faltan N casillas por marcar para completar el
      item". Con resolución tampoco se salta.
- [x] Conteo en `shared/checkboxes.ts` sobre el árbol de Markdown: cuenta `- [ ]`, `* [ ]` y `1. [ ]`, también anidadas;
      una casilla dentro de código (en línea o en bloque) no cuenta, ni `[ ]` sin viñeta.
- [x] Reabrir, y cambiar la resolución de un item ya completo, no lo exigen (si el texto ganó una casilla abierta después
      de completarlo, sigue completo hasta que se reabra).
- [x] UI: la fila y el dock avisan con el mismo texto antes de pedir al servidor (sin pintar y revertir); el dock muestra
      el aviso debajo de "Completado" mientras falten casillas.
- [x] Code Mode: el summary de `items.setDone` lo dice; `bun run gen` regenerado.
- [x] Tests: `shared/checkboxes.test.ts` y `server/resolution.test.ts` (bloqueo con y sin resolución, todas marcadas, sin
      casillas, editar el texto y completar, reabrir, código).
- [x] Navegador, contra el servidor de desarrollo con esta rama: `setItemDone` sobre un item con 2 casillas abiertas da
      `INVALID_INPUT`; clic en la casilla de la fila deja el item abierto y muestra el aviso; el dock muestra "Faltan 2
      casillas por marcar para completar el item"; marcadas las tres (editando el texto) se completa.
- [ ] "Ciertas características": hoy la única condición son las casillas del texto. Falta definir si otras condiciones
      cuentan (por ejemplo, subitems completos, resolución obligatoria) y si es por lista o por item.
- [ ] Las casillas del texto se marcan editando el Markdown (la vista las muestra de solo lectura). Evaluar que se puedan
      marcar con un clic en la vista del dock.
- [ ] Import/export y `restoreItem` no aplican la regla: un export con items completos y casillas abiertas se importa como
      está.
