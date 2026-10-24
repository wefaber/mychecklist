# 0008 — Exportar e importar

Estado: aceptado (M6, 2026-10-23). Faku aprobó el texto tal cual. Numeración fija: 0006 M4, 0007 M5, 0008 M6.

## Contexto

M6 pide un round-trip JSON sin pérdida: exportar una org con listas, subitems, orden, estado, Markdown, menciones
`[[id]]` y adjuntos, importarla en otra org y que quede igual. Tres hechos de M2 y M3 condicionan el diseño:

- Los ids (`lists.id`, `items.id`, `attachments.id`) son claves primarias globales, no por org. Importar con los ids del
  archivo choca con la org de origen si vive en la misma base, y con cualquier segundo import del mismo archivo.
- El texto del item es la fuente de verdad y lleva ids adentro: `[[<id>]]` (ADR 0005) y `attachment:<id>`.
- Lo que no es dato (índice `item_refs`, `activity`) se puede reconstruir o no pertenece al archivo.

## Decisión

- **Un solo archivo JSON, con versión de esquema.** `{ format: "mychecklist", schema: 1, exportedAt, app, org, lists,
  attachments }`. `schema` es un entero: un lector rechaza un `schema` mayor al que conoce con un mensaje claro, y
  cuando exista un 2 conservará un migrador del 1. Los campos desconocidos se ignoran. Se descarga como
  `mychecklist-<org>-<fecha>.json`.
- **Lo que lleva:** listas con nombre, `position`, `createdAt`, `updatedAt`, `deletedAt`; items (en orden de árbol: cada
  primer nivel seguido de sus subitems) con `parentId`, `position`, `text`, `doneAt`, `createdAt`, `updatedAt`,
  `deletedAt`; adjuntos con `id`, `name`, `mime`, `size`, `sha256` y `data` en base64. El borrado lógico viaja tal cual
  (ADR 0004): restaurar sigue funcionando después de importar, porque los instantes de borrado se conservan iguales.
- **Lo que no lleva:** `activity` (es el registro de lo que pasó en esa base, no dato de la org), `item_refs` (índice
  derivado: se recalcula al importar con el mismo código que usa el servidor), ids de usuarios y autoría (`createdBy`).
  El archivo no filtra quién es quién; al importar, quien importa queda como autor.
- **Los ids se regeneran al importar.** El archivo conserva los ids originales solo como claves locales para que las
  referencias internas cierren. Al importar, cada lista, item y adjunto recibe un id nuevo y las referencias en los
  textos se reescriben con el mismo recorrido de Markdown que `shared/refs.ts` (código en línea, bloques de código y el
  interior de links no se tocan): `[[id]]`, `[texto](item:id)`, y `attachment:id` en links, imágenes y definiciones. Un
  id del texto que no está en el archivo (referencia a algo que ya no existía) queda como estaba y se dibuja como "no
  disponible", igual que hoy. Los ids nuevos se generan en el orden del archivo, así el desempate por `id` de
  `ORDER BY position, id` da el mismo orden que el original.
- **El orden se conserva tal cual** (las claves de `position` viajan sin cambios) cuando la org no tiene listas.
  Si ya tiene, las listas importadas se agregan al final con claves nuevas; los items conservan las suyas porque su orden
  es relativo a su lista.
- **Importar siempre agrega, nunca pisa ni borra.** No hay modo "reemplazar". Entra en una org nueva o en una con datos;
  se aplican los mismos topes que a la creación manual (200 listas vivas, 5000 items vivos por lista, 500 MB de
  adjuntos por org) y, si algo no cabe, no entra nada. Es todo o nada: se valida el archivo entero antes de escribir, y
  las listas, items, referencias y registros de adjuntos entran en una sola transacción.
- **Una sola vía de mutación.** `server/services/transfer.ts` expone `exportOrg` e `importOrg`. Leen y escriben por
  `scoped.ts` (que gana `lists.dump`, `items.dump`, `attachments.all`, y campos opcionales de fecha, estado y borrado en
  los `insert`), y registran una entrada en `activity` (`org.exported`, `org.imported` con `via: 'import'` para la
  segunda). El import no escribe SQL. El contenido de los adjuntos se verifica contra su `sha256` y `size`, se
  guarda con `FileStore` y el tipo se vuelve a reconocer por los bytes (`sniffImage`): el `mime` del archivo no se
  confía, igual que en una subida.
- **Transporte: HTTP plano**, por el mismo motivo que los adjuntos (cuerpos grandes, descarga de archivo):
  `GET /export/:org` y `POST /import/:org` (cuerpo JSON crudo). Sesión de la puerta, membresía de la org y, en el POST,
  `Origin` propio. Code Mode (M5) puede llamar a los mismos servicios sin pasar por HTTP.
- **Adjuntos dentro del archivo, con tope.** Base64 inline mantiene un archivo autocontenido y sin formatos nuevos ni
  dependencias. A cambio, el archivo pesa un tercio más que los adjuntos y se arma en memoria, así que hay un tope de
  32 MB de adjuntos por exportación (el import acepta hasta 48 MB de cuerpo; Nginx igual en `/import/`). Pasado el
  tope, `GET /export/:org?attachments=0` exporta el resto sin el contenido de los adjuntos (quedan los registros con
  `data: null`; al importar, esos adjuntos se descartan y sus referencias se dibujan como no disponibles).
- **Tope de tamaño del archivo:** como máximo 1000 listas y 100 000 items por archivo, además de los topes por lista.

## Alternativas descartadas

- **Conservar los ids.** Es lo más simple para el archivo, pero no deja importar en la misma base mientras exista el
  original (clave primaria global) ni importar dos veces. Sacar la unicidad global exige un contract de las migraciones.
- **Zip o tar con los adjuntos aparte.** Resuelve el tamaño y evita base64, pero agrega un formato, una dependencia y un
  segundo camino de verificación. Queda como ampliación del esquema (`schema: 2`) si hacen falta exports de varios cientos
  de MB; hoy el backup completo de la base ya cubre ese caso (ARCHITECTURE.md › Datos).
- **Exportar solo lo vivo.** Más chico, pero rompe "sin pérdida": después de importar, deshacer y la papelera no
  funcionarían.

## Consecuencias

- El export incluye los items borrados lógicamente; quien comparte el archivo comparte también lo que borró. Se avisa en
  la pantalla de exportación. Cuando exista la purga con retención (pendiente desde ADR 0004) el archivo la respeta.
- Un export de una org con más de 32 MB de adjuntos solo se puede hacer completo con el backup del servidor, o sin
  contenido de adjuntos con `?attachments=0`.
- Las orgs de equipo (M7) exportan e importan por los mismos servicios; el rol que lo permite se define allí (hoy cualquier
  miembro de la org personal es su dueño).
- Importar desde Todoist o desde issues de GitHub (largo plazo) arma este mismo formato en el cliente y reutiliza el
  servicio.
