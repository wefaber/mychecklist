# Fixes 2026-10-23 · v0.5.0 (M6)

Hallazgos y pendientes de la etapa de importar y exportar (ADR 0008). `[ ]` pendiente · `[~]` parcial · `[x]` hecho y
verificado.

## Formato y servicio

- [x] Round-trip sin pérdida: se exporta una org con tres listas (una borrada), subitems, orden intercalado, estado,
      menciones `[[id]]`, links `item:` y dos adjuntos; se importa en una org vacía, se vuelve a exportar y los dos
      archivos son iguales salvo los ids (`server/transfer.test.ts › round-trip`).
- [x] Los ids se regeneran: ninguno del archivo se reutiliza en la org nueva, y cada `[[id]]`, `item:<id>` y
      `attachment:<id>` del texto apunta al item o adjunto correspondiente de la copia (se lee por la API:
      `mentions` y backlinks).
- [x] Lo que está en código (en línea o en bloque) y el interior de links no se reescribe, igual que en `extractRefs`
      (`shared/refs.test.ts › remapIds`, `server/transfer.test.ts`).
- [x] Entidades y escapes antes de una mención no corren la posición de la edición (`remapIds`).
- [x] Borrado lógico: lo borrado viaja con su instante, y después de importar `restoreItem` devuelve el item con su
      subitem.
- [x] El archivo lleva `schema: 1`; un `schema` mayor se rechaza con un mensaje claro, `format` ajeno y JSON roto
      también, y los campos desconocidos se ignoran.
- [x] Validación completa antes de escribir: ids mal formados o repetidos, claves de orden, fechas, textos y nombres
      fuera de tope, padre de otra lista, subitem de subitem, `sha256` inválido. El error dice dónde. No entra nada.
- [x] Adjuntos: el contenido se verifica contra `size` y `sha256`; el `mime` del archivo no se confía (un texto que
      dice ser PNG sale como descarga); el mismo contenido se guarda una vez por org.
- [x] Importar siempre agrega: dos imports seguidos dejan las listas al final con claves de orden nuevas; los topes
      (200 listas, 5000 items por lista) valen igual y un archivo que no cabe no deja nada a medias.
- [x] Acceso: sin sesión 401, otra persona 403, `Origin` ajeno 403, org `team` por la puerta pública 403.
- [x] `activity` registra `org.exported` y `org.imported` (`via: import`) sin copiar el contenido; el archivo no lleva
      usuarios ni autoría.
- [x] Export con más de 32 MB de adjuntos da 413 y pide ir sin adjuntos; `?attachments=0` exporta los registros sin
      contenido y el import los descarta y lo informa.
- [x] El import no escribe SQL: usa `server/services/transfer.ts` y `scoped.ts` (`bun scripts/check-scoped.ts` en
      verde).

## Cliente

- [x] Verificado en el navegador: el ícono del encabezado y el comando de la paleta abren "Importar y exportar";
      el export baja con el nombre `mychecklist-<org>-<fecha>.json`; elegir el archivo y presionar Importar suma la
      lista copiada con la mención apuntando a su propio item, sin errores de consola.
- [ ] axe-core sobre el diálogo nuevo en los cuatro temas (no se corrió).
- [ ] Descarga en el desktop (Tauri): `a[download]` con un blob no se probó en el webview.

## Despliegue

- [~] Nginx: `location /export/` y `location /import/` (48 MB) en los dos vhosts. Sin ellas las rutas caen en el
  `index.html`. No se probó con `nginx -t` ni en el VPS; verificar después del primer deploy: `GET /export/<org>`
  con sesión devuelve JSON, no HTML.
- [ ] Verificar después de mergear: workflow verde, `/ready` 200 y un export real desde `checklist.wefaber.net`.

## Pendientes

- [ ] Purga con retención (desde M2): cuando exista, el export la respeta.
- [ ] Export de orgs con más de 32 MB de adjuntos: formato con adjuntos aparte (`schema: 2`) si hace falta.
- [ ] Importar desde Todoist y desde issues de GitHub (largo plazo en el roadmap; sin issue creado todavía).
- [ ] Rol que puede exportar o importar en orgs `team` (M7).
