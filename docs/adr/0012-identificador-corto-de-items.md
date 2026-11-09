# 0012 — Identificador corto de items

Estado: propuesto (2026-11-09). Pendiente de review de Faku. Complementa el ADR 0005 (no lo reemplaza).

## Contexto

Un item se identifica por un ULID de 26 caracteres (ADR 0005): nadie lo cita a mano, ni desde un commit, un issue o una
conversación con un agente. Hace falta algo corto, legible y dictable, que apunte siempre al mismo item.

## Decisión

- **Formato:** `<ORG>-<LISTA>-<NUM>`, o `<LISTA>-<NUM>` si la org no tiene código (las personales). Ejemplos: `AA-12`
  en un espacio personal, `WF-AA-12` en la org de equipo con código `WF`.
  - `ORG`: `orgs.code`, solo orgs de equipo. Lo asigna el servidor al crearla (iniciales del nombre, único en toda la
    instalación) y el arranque se lo da a las que ya existían. No se edita desde la UI todavía.
  - `LISTA`: `lists.code`, único dentro de la org (las borradas lo siguen reservando, así restaurar no pisa a otra).
    Sale del nombre al crear (`Ad Astra` → `AA`, `Economía` → `ECO`, con número si está tomado) y se cambia con
    `setListCode`. Cambiarlo cambia el identificador de todos sus items.
  - `NUM`: `items.number`, un contador por lista (`lists.item_seq`) que nunca se reutiliza: borrar un item deja el
    hueco. Los subitems cuentan igual que los items.
  - Códigos: 2 a 8 caracteres, mayúsculas y dígitos, empieza con letra. Al leer no se distingue mayúsculas.
- **Lo guardado sigue siendo el ULID.** `[[AA-12]]` escrito por una persona o un agente se reescribe a `[[<ULID>]]` al
  guardar el texto o la resolución (`resolveShortRefs`, solo en lo que el parser considera referencia: no en código ni
  dentro de links). Backlinks, chips, export e import no cambian y no dependen de que el código se mantenga. Lo que no
  resuelve (no existe, otra org, item borrado) queda como lo escribió la persona.
- **Una referencia no cruza orgs:** un prefijo de org distinto del de la org abierta no resuelve.
- **Mover un item a otra lista** le da el número siguiente de la lista nueva; su identificador cambia, sus referencias
  guardadas no se rompen. Mover dentro de la misma lista no cambia nada.
- **Numeración en el servidor, sin carreras con el slot anterior:** la migración 0011 numera lo existente (por
  creación dentro de cada lista) y deja dos triggers, `AFTER INSERT` y `AFTER UPDATE OF list_id`, que asignan el número
  a lo que inserte o mueva un slot que no conoce la columna. El índice `(list_id, number)` no es único a propósito: al
  mover, la fila llega a la lista nueva con su número viejo hasta que corre el trigger. Las listas creadas por el slot
  anterior reciben el código en el siguiente arranque (`backfillListCodes`).
- **Lectura:** `Item.number`, `Item.shortId`, `List.code`, `Mention.shortId` y `SearchHit.shortId` en GraphQL y en Code
  Mode. `items.get` y `org.item(id:)` aceptan el ULID o el identificador corto; la búsqueda por un identificador exacto
  pone ese item primero. Las mutaciones siguen pidiendo el ULID.
- **Link:** la ruta `/l/<lista>?item=<id>` ya existía; ahora `item` también acepta el identificador corto y la app lo
  normaliza al ULID (el link abierto sigue valiendo si después cambia el código). Pegar un link propio a un item dentro
  de un texto deja `[[ULID]]` (chip y backlink) en lugar de la URL.
- **UI:** el detalle muestra el identificador con "Copiar id" y "Copiar link"; el menú de la fila (también en mobile)
  tiene las dos acciones; el menú de la lista tiene "Cambiar el código".
- **Export e import:** `lists[].code` opcional (el `schema` sigue en 1). Al importar se conserva si está libre y si no
  se genera otro. Los números no viajan: el import numera por orden de inserción; las referencias son por ULID y se
  remapean como hasta ahora.

## Alternativas descartadas

- **Derivar el identificador de los últimos caracteres del ULID:** corto pero opaco, y colisiona.
- **Guardar `[[AA-12]]` tal cual:** habría que resolver en cada lectura, y cambiar un código o mover un item rompería
  las referencias guardadas.
- **Número por org en lugar de por lista:** `AA-143` en una lista de 12 items no dice nada de la lista.

## Pendiente de confirmar

- `TYPE` se interpretó como el código de la **lista** (la categoría: Economía, Gameplay). Si se quería otra cosa (un
  tipo de item, por ejemplo), cambia `LISTA` por ese campo y el resto de la decisión se mantiene.
- Editar el código de la org (hoy solo se asigna al crearla).
- Autoenlazar `AA-12` suelto, sin corchetes, en un texto.
