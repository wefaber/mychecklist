# Fixes 2026-11-09 · v0.12.0

## Identificador corto y link de un item (#26)

Decisión en [ADR 0012](../adr/0012-identificador-corto-de-items.md): `<ORG>-<LISTA>-<NUM>`, o `<LISTA>-<NUM>` si la org
no tiene código. El ULID sigue siendo lo que se guarda.

- [x] Migración 0011, aditiva: `orgs.code`, `lists.code`, `lists.item_seq`, `items.number`; numera lo existente por
      creación dentro de cada lista y deja triggers (insert y cambio de lista) para lo que cree un slot anterior.
- [x] Códigos: `shared/short-id.ts` (formato, `codeFromName`, `parseShortId`). La lista lo toma del nombre al crearla
      (`Ad Astra` → `AA`); la org de equipo, al crearse; lo anterior, al arrancar (`backfillListCodes`,
      `backfillOrgCodes`). Verificado contra la base de desarrollo con datos previos: `Prueba mobile` quedó `PM-1..4`.
- [x] `setListCode` (servicio, GraphQL `setListCode`, Code Mode `lists.setCode`): 2 a 8 mayúsculas o dígitos, único en
      la org (las listas borradas reservan el suyo).
- [x] `[[AA-12]]` en el texto o en la resolución se guarda como `[[ULID]]` (`resolveShortRefs`); no toca código ni
      links; lo que no resuelve queda igual. El prefijo de otra org no resuelve.
- [x] Lectura: `Item.number`, `Item.shortId`, `List.code`, `Mention.shortId`, `SearchHit.shortId` (GraphQL y Code Mode,
      `bun run gen` regenerado). `items.get` / `org.item(id:)` aceptan ULID o identificador corto; la búsqueda por
      identificador exacto lo pone primero.
- [x] Mover un item a otra lista le da el número siguiente de la lista nueva; dentro de la misma lista no cambia.
- [x] Export e import: `lists[].code` opcional (el `schema` sigue en 1); al importar se conserva si está libre, si no se
      genera otro. Un archivo sin el campo se importa.
- [x] UI, detalle: `AA-12` con "Copiar id" y "Copiar link". UI, menú de la fila: las mismas dos acciones. UI, menú de la
      lista: "Cambiar el código".
- [x] `?item=` acepta el identificador corto y se normaliza al ULID; el detalle sigue abierto cuando cambia el código.
- [x] Pegar en un texto o resolución un link propio a un item deja `[[ULID]]` (chip y backlink).
- [x] Tests: `shared/short-id.test.ts`, `server/shortid.test.ts`, `web/lib/links.test.ts` y el ejercicio de
      `lists.setCode` en `server/mcp/protocol.test.ts`.
- [x] Navegador (1280 px, JS): detalle con `PM-2`, copiado de id y link (portapapeles simulado: `PM-2` y la URL con
      el ULID), pegar un link propio, guardar `[[PM-4]]` y ver la mención, cambiar el código con el detalle abierto.
- [ ] Probar el menú de la fila y "Cambiar el código" con toque real en mobile y los 4 temas; axe en el detalle.
- [ ] Un link pegado de otro servidor o con el identificador corto en `?item=` se deja como URL (no se convierte).
- [ ] Mostrar el identificador en la fila, en la paleta y en los chips de mención.
- [ ] Editar el código de la org de equipo desde la UI.
- [ ] Confirmar con Faku que `TYPE` es el código de la lista.
