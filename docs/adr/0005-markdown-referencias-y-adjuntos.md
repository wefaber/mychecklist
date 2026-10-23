# 0005 — Markdown, referencias `[[id]]` y adjuntos

Estado: aceptado (M3, 2026-10-23).

## Contexto

El texto del item es la fuente de verdad (DESIGN.md › principio 2). M3 le suma Markdown, menciones entre items con
backlinks y archivos adjuntos sin convertir el item en un formulario. Tres riesgos mandan las decisiones: que lo que se
guarda y lo que se ve difieran, que un item ejecute algo en el navegador de quien lo abre, y que un archivo subido se
sirva como página.

## Decisión

- **Una referencia es `[[<id>]]`** con el ULID del item, no su título. Los items no tienen nombre único y un título
  cambia; el id no. El cliente la dibuja como chip con el título vivo del item. El selector (botón del detalle o
  escribir `[[`) inserta el id; nadie lo tipea a mano. Un link `[texto](item:<id>)` escrito a mano vale igual.
- **El servidor y el cliente leen las referencias con el mismo código** (`shared/refs.ts`): se parsea el Markdown con
  `remark` y se recorren los nodos de texto. Código en línea, bloques de código y el interior de un link no cuentan en
  ninguno de los dos lados. No hay escape con backslash (Markdown lo resuelve antes de que lo veamos): para escribir un
  `[[id]]` literal va dentro de código.
- **Los backlinks son un índice, no datos.** `item_refs (from_id, to_id)` se reescribe entero cada vez que cambia el
  texto, en la misma transacción. Solo guarda ids de items de la misma org que existen al momento de escribir (los
  borrados lógicos incluidos, por si vuelven) y nunca el propio item. Tope de 50 referencias distintas por item. Al
  leer, se ocultan los items borrados y los de listas borradas.
- **Markdown solo se dibuja, nunca se interpreta como HTML.** `react-markdown` sin `rehype-raw`: el HTML crudo se
  muestra como texto. Esquemas de URL: lista segura de la librería más `attachment:` e `item:`. Las imágenes son solo
  adjuntos: una imagen de otro sitio le avisaría a ese sitio cada vez que alguien abre el item, así que se muestra
  como texto con su descripción. En una fila (dentro de un botón) todo es inerte; los links y chips activos viven en el
  detalle.
- **Un item de una línea sin marcas no pasa por el parser.** `hasMarkdown` lo decide con una expresión regular: las
  listas largas (hasta 5000 items) no pagan un parser por fila.
- **Adjuntos por contenido.** El archivo vive en `files/<aa>/<sha256>` junto a la base; `attachments` (con `org_id`)
  guarda quién lo subió y con qué nombre. En una org el mismo contenido es un solo adjunto. El texto del item lo cita
  como `attachment:<id>` (sin host: sirve igual en web y desktop); el cliente arma la URL `/files/<org>/<id>`.
- **Se sirve a la defensiva.** Solo PNG, JPEG, GIF y WebP se muestran en línea, y se reconocen por los primeros bytes,
  no por lo que diga el cliente. Todo lo demás (SVG incluido, que puede llevar scripts) sale como
  `application/octet-stream` con `Content-Disposition: attachment`. Siempre `nosniff` y
  `Content-Security-Policy: default-src 'none'; sandbox`. La subida exige sesión, membresía de la org y `Origin` propio.
- **Límites:** 10 MB por archivo (el servidor y Nginx cortan al mismo tamaño) y 500 MB por org.

## Consecuencias

- Una referencia a un item que ya no existe se dibuja como "Item no disponible"; el texto no se toca.
- Si el título de un item cambia, los chips de otras listas se enteran en el próximo refresco: ante cualquier cambio de
  la org el cliente vuelve a pedir lo que tiene en pantalla.
- Los adjuntos no se borran nunca: no hay UI para sacarlos ni purga. Junto con la purga de datos borrados (pendiente
  desde M2) es trabajo de retención que falta; hasta entonces el tope por org acota el crecimiento.
- Un adjunto se puede leer con solo conocer su id y ser miembro de la org, aunque ningún item lo cite. Es la misma
  frontera que el resto de los datos de la org (`scoped.ts`).
- El Markdown de un item de más de 4000 caracteres no existe: el tope del texto no cambia.
