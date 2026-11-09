# Fixes 2026-11-09 · v0.10.0

## Resolución al completar un item (#25)

Sale de usar la lista "Ad Astra": un item como "Definir la lista corta de sistemas de la primera alfa" se cierra con una
respuesta ("los puntos son X, Y, Z") y esa respuesta no tenía dónde vivir.

- [x] Migración 0009, aditiva: `items.resolution TEXT` (NULL). Sin cambios de forma en el slot anterior.
- [x] Servicio: `setItemDone` acepta `resolution` (Markdown, hasta 4000 caracteres). Omitida deja la que hay, en blanco la
      borra. Solo vale al completar: reabrir conserva la resolución y no admite una nueva (`INVALID_INPUT`). Un item
      ya completo puede cambiarla.
- [x] Actividad: completar sigue siendo `item.completed`; cambiar la resolución de un item completo es `item.edited`.
- [x] Referencias: las menciones `[[id]]` de la resolución entran en el índice (backlinks) junto con las del texto, y
      editar el texto no las pierde.
- [x] Búsqueda (`items.search`, paleta, selector `[[`): también mira la resolución.
- [x] GraphQL: `Item.resolution` y `setItemDone(resolution:)`.
- [x] Code Mode: `Item.resolution` e `items.setDone({ id, done, resolution })`; `bun run gen` regenerado. Un token de
      lectura no ve `setDone`.
- [x] Export e import: `resolution` en cada item. Es opcional y aditivo, así que el `schema` sigue en 1; un export
      anterior sin el campo se importa con `null`. Al importar se reescriben los ids de `[[id]]` también en la resolución.
- [x] UI, detalle del item: campo "Resolución", botón "Completar con resolución" y la casilla "Completado" (que también
      lleva lo escrito). En un item completo se guarda al salir del campo. La resolución se ve renderizada en la vista.
- [x] UI, fila: una línea "Resolución: …" con la primera línea de la resolución.
- [x] Tests: `server/resolution.test.ts`, `server/codemode.test.ts`, `server/transfer.test.ts` (365 en total).
- [x] Navegador, a 1280 px: completar con resolución, editarla ya completo (blur), reabrir (se conserva), volver a
      completar sin tocar el campo (deja la anterior) y borrarla con texto en blanco.
- [ ] Deshacer "completar con resolución" reabre el item pero deja la resolución escrita (como reabrir a mano). Decidir
      si debe borrarla.
- [ ] Probar en mobile (375 px) y con los 4 temas; axe en el detalle con el campo nuevo.
- [ ] Mostrar la resolución en la paleta y en los chips de mención.

Relacionado: referenciar items por id corto (#26), para citar el item resuelto desde otro.
