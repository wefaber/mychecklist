# Fixes 2026-11-09 · v0.9.7

## Mobile

- [x] Blancos táctiles de 44 px en los modales, el detalle del item y el aviso (#27). `IconButton` del kit mide 32 px y
      `Dialog` no deja pasar otro tamaño; una regla de CSS bajo `@media (pointer: coarse)` (`web/styles/index.css`) lo
      lleva a 44 px en `dialog[data-kit='Dialog']` y en `.touch-roomy` (detalle y aviso). Medido en el navegador con
      emulación táctil a 375 px: cierre del diálogo de atajos y de importar y exportar, y en el detalle cerrar, mencionar
      y adjuntar, todos de 44 px. El aviso (`Toaster`) lleva la misma clase pero no se midió.
- [ ] La barra superior con 44 px: entra con el menú de `HeaderMenu` (PR #28), que todavía no está en `main`.
- [ ] Resolverlo en el kit y borrar la regla local (`wefaber/kit#25`).
- [ ] Probar en un celular real; la medición fue con emulación.
- [ ] Filas y barra de listas (`ItemRow`, `ListsBar`) siguen con botones de 32 px: no son modales y agrandarlos cambia el
      alto de cada fila. Decidir aparte.
