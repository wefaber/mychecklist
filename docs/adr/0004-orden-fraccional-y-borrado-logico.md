# 0004 — Orden fraccional y borrado lógico

Estado: aceptado (M2, 2026-10-23).

## Contexto

Las listas se reordenan seguido (teclado, arrastre, agentes por Code Mode) y desde varios dispositivos. Un entero
`position` obliga a reescribir media lista por cada movimiento y hace que dos movimientos concurrentes se pisen. Además
el diseño pide deshacer en vez de confirmar (DESIGN.md › principio 4).

## Decisión

- **Orden fraccional.** `lists.position` e `items.position` son claves de texto en base 62 (`shared/order.ts`). Mover o
  insertar calcula una clave entre los dos vecinos y reescribe una sola fila. Se ordena con `ORDER BY position, id`
  (colación binaria). Las claves iguales por una carrera entre procesos no rompen nada: los vecinos se buscan con
  `position >` estricto y el desempate es el `id`.
- **Borrado lógico.** Borrar pone `deleted_at`; restaurar lo limpia. Un item borrado arrastra a sus subitems vivos con el
  mismo instante, y al restaurarlo vuelven solo los que cayeron con él. Un subitem no se restaura si su padre sigue
  borrado.
- **Deshacer es una mutación inversa.** El servidor expone `restoreItem` y `restoreList` y el resto de las acciones son
  reversibles con las mismas mutaciones (volver a mover, reabrir, volver el texto). La pila vive en el cliente.
- **Un nivel de subitems.** Alcanza para listas de tareas y evita árboles profundos en teclado y arrastre. Un item con
  subitems no puede volverse subitem.

## Consecuencias

- Las claves crecen un carácter cada tanto si se inserta siempre en el mismo hueco; hasta cientos de inserciones por
  hueco el largo se mantiene chico (test en `shared/order.test.ts`). Un rebalanceo no hace falta todavía.
- Los datos borrados siguen en la base. Falta una purga con retención (pendiente, ver fixes v0.3.0).
- La pila de deshacer se pierde al recargar: deshacer cubre la sesión, no el historial (para eso está `activity`).
