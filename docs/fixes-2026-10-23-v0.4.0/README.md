# Fixes 2026-10-23 · v0.4.0 (M3)

Hallazgos y pendientes de la etapa de Markdown, menciones con backlinks y adjuntos (ADR 0005).

## Servidor

- [x] Parser de referencias: ids distintos en orden, dentro de énfasis, listas, citas y tablas; no cuenta código en
      línea ni bloques, ni el interior de un link o una imagen; ids mal formados no son referencia; tope de 50
      (`shared/refs.test.ts`).
- [x] Un `[texto](item:<id>)` escrito a mano cuenta igual que `[[id]]`, para que lo que se ve y lo que se indexa coincida.
- [x] Backlinks: crear, editar y vaciar el texto reescribe el índice; el propio item, ids inexistentes y los de otra org
      no se guardan; un item borrado deja de mencionar y de ser mencionado y vuelve al restaurarlo
      (`server/refs.test.ts`).
- [x] `Item.mentions` viaja con la lista en una sola consulta (sin una consulta por item); `Item.backlinks` solo se
      resuelve si se pide.
- [x] Títulos de mención sin marcas de Markdown ni ids (`shared/title.test.ts`).
- [x] Adjuntos: subir y bajar una imagen, `ETag` y 304, mismo contenido en una org = un adjunto, tope de 10 MB y de
      500 MB por org, vacío, sin sesión, `Origin` ajeno, otra persona, org `team` por el listener público
      (`server/attachments.test.ts`).
- [x] Lo que se hace pasar por imagen (texto, SVG con script, HTML) sale como descarga con `nosniff` y CSP `sandbox`.
- [x] El nombre del archivo pierde carpetas y caracteres de control, se acota y sale bien en `Content-Disposition`.
- [ ] Los adjuntos no se borran nunca (no hay UI ni purga). Va junto con la purga de datos borrados de M2.
- [ ] Un adjunto que ningún item cita sigue ocupando cuota. La cuota cuenta bytes únicos por org, no por uso.
- [~] El tope de 10 MB responde 413 con JSON desde el servidor. Con el proxy de desarrollo de Vite el corte antes de
  leer el cuerpo se ve como 502 (el cliente avisa antes de subir, así que no se llega); detrás de Nginx el corte es de
  Nginx con `client_max_body_size 10m`.

## Cliente

- [x] Verificado en el navegador: pegar una imagen en el detalle la sube, deja `![captura.png](attachment:…)` en el
      cursor, se ve en la Vista y sigue ahí después de guardar y recargar.
- [x] Escribir `[[` abre el selector; elegir un item deja `[[id]]` en lugar de los corchetes y lo dibuja como chip.
      "Mencionado en" muestra el backlink y lo abre.
- [x] Adjuntar un archivo con el clip lo deja como link con ícono; se descarga como `attachment`.
- [x] HTML crudo, `javascript:` e imágenes externas no ejecutan ni cargan nada (se verificó con `alert` en el
      navegador: 0 diálogos).
- [x] Pegar texto sigue pegando texto; solo se intercepta cuando el portapapeles trae archivos y ningún texto.
- [x] axe-core (WCAG 2.2 AA): 0 violaciones en `/design` con los cuatro temas (la muestra de Markdown incluye chips,
      link, tabla, casillas y cita) y en la lista real con el detalle abierto.
- [x] Un link en `--accent` sobre `--surface-2` daba 4,02:1 en Azul claro: ahora el link usa el color del texto con
      subrayado grueso en `--accent`.
- [ ] Prueba con lector de pantalla real de los chips y de la vista previa.
- [ ] Pegar o soltar archivos en el campo de "Nuevo item" (hoy solo en el detalle).
- [ ] Arrastrar una imagen desde el escritorio probada con un puntero real (el navegador del entorno no entrega
      eventos de arrastre de archivos; la lógica comparte camino con pegar).
- [ ] Autocompletar `[[` filtrando mientras se escribe en el campo (hoy abre un diálogo aparte).
- [~] Los chips de otras listas se actualizan con el próximo refresco: ante un cambio de la org el cliente vuelve a pedir
  las listas que tiene abiertas. Con muchas listas abiertas en el desktop eso es más tráfico del necesario.
- [~] Cada fila con Markdown pasa por el parser; hay una vía rápida para el texto plano y un comparador que evita
  repetirlo si no cambió el texto ni las menciones. Con 5000 items con Markdown no se midió.

- [ ] Peso del cliente: el chunk principal queda en 678 kB (218 kB con gzip) con el parser de Markdown adentro. Cargar
      `web/lib/markdown.tsx` con `import()` cuando aparezca la primera fila con marcas lo saca del camino crítico.

## Para el kit (`@wefaber/ui`)

- [ ] `Textarea` no tipa `ref` (igual que `Field`): `web/components/TextField.tsx` lo envuelve con un cast.
- [ ] `--accent` sobre `--surface-2` no llega a 4,5:1 en Azul claro para texto chico; sirve para íconos y bordes.

## Pendiente de Faku

- [ ] Nginx: los dos vhosts ganaron `location /files/` (`client_max_body_size 10m`). Recargar Nginx con la config nueva
      antes de desplegar M3; sin eso subir adjuntos da 404 desde Nginx.
- [ ] La carpeta de adjuntos queda en `<carpeta de la base>/files` (o `MYCHECKLIST_FILES`). Confirmar que el backup
      horario la incluye (hoy `VACUUM INTO` copia solo la base).
- [ ] Todo lo de v0.2.0 y v0.3.0 sigue pendiente (GitHub App, tailnet, DNS).
