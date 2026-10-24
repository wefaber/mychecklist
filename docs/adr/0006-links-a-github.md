# 0006 — Links a GitHub con refresco

Estado: aceptado (M4, 2026-10-23). Precisa el refresco que el ADR 0003 dejaba abierto (job cada 5 minutos con lease):
ese punto queda reemplazado por este.

## Contexto

Un item puede llevar la URL de un issue o de un PR de GitHub. M4 la dibuja como chip con el título y el estado vivos
(abierto, cerrado, mergeado). Hay que decidir con qué token se consulta, dónde se guarda lo consultado, cuánto se gasta
del límite de la API y qué ve quien no tiene acceso al repo.

Datos de partida: el login ya guarda el token de usuario de la GitHub App cifrado (`github_tokens`, ADR 0003); ese
token vence a las 8 horas y se renueva con un refresh token de un solo uso; el límite de la API es de 5000 pedidos por
hora y por usuario (y por instalación); la API GraphQL de GitHub permite pedir varios issues y PRs en un solo pedido
con alias, y `isPrivate` del repo viaja en el mismo pedido.

## Decisión

Dos caminos según la visibilidad del repo:

- **Repos públicos: caché global compartido y token de instalación de la App** (solo lectura, sin PAT). Un título
  público no es confidencial: se consulta una vez para todas las personas y se resuelve aunque quien mira no tenga el
  token de usuario vigente.
- **Repos privados: caché por usuario y el token de quien mira.** Un título traído con el token de A no lo ve B.
  Si quien mira no tiene token, lo tiene vencido sin renovación o no tiene acceso, el chip queda como link.

Invariante: **a la tabla global solo entra lo que GitHub respondió con `isPrivate: false`**, venga del token que venga.
Un repo privado al que la App tiene acceso nunca llega al caché global: se marca como privado y pasa al camino por
usuario.

Detalle:

- **Tablas** (sin `org_id`: no son datos de una org, así que no pasan por `scoped.ts`; solo las toca
  `server/db/github.ts`): `github_public_links` `(owner, repo, number)`, `github_private_links`
  `(user_id, owner, repo, number)` y `github_repos` `(owner, repo)` con la visibilidad conocida. Claves en minúsculas
  (GitHub no distingue mayúsculas). Se guardan tipo, título, estado, `fetched_at` y, si la consulta falló, el motivo. El
  caché se pierde sin daño: es derivable.
- **Un pedido, un lote.** El cliente reconoce las URLs con `shared/github.ts` (mismo código en cliente y servidor, como
  `shared/refs.ts`) y pide `githubLinks(refs)` por GraphQL. El servidor responde lo que tiene en caché y consulta lo
  vencido a GitHub en lotes de hasta 25 links por consulta GraphQL con alias. Tope de 50 links por pedido.
- **Orden de consulta de lo vencido:** (1) token de instalación, salvo repos ya conocidos como privados; lo público
  vuelve a la tabla global, lo privado o no visible pasa a (2); (2) token de quien mira, con resultado en su caché.
- **Refresco perezoso, sin job.** Un link se vuelve a consultar solo si alguien lo mira y su caché venció: 5 minutos si
  está abierto, 1 hora si está cerrado o mergeado, 10 minutos si falló o no se encontró. Mientras tanto se muestra lo
  guardado (marcado vencido). El cliente repite el pedido al abrir el detalle, al volver a la pestaña y cada 5 minutos
  con el chip a la vista. No se gasta nada en links que nadie mira, y no hace falta un token "offline" para un job. La
  visibilidad de un repo se recuerda 1 hora.
- **Límite de la API.** Se lee `rateLimit.remaining` de cada respuesta; por debajo de 200 el servidor deja de consultar
  con ese token (el de la instalación o el del usuario) hasta `resetAt` y responde con el caché. Los fallos de GitHub
  (5xx, red) no se reintentan dentro del pedido.
- **Token de instalación.** El servidor firma un JWT de la App (RS256, 9 minutos) con `GITHUB_APP_ID` y
  `GITHUB_APP_PRIVATE_KEY` y lo cambia por un token de instalación (dura 1 hora, se guarda solo en memoria). Usa la
  primera instalación de la App (`GET /app/installations`): un token de instalación lee los repos públicos de cualquier
  dueño. Sin esas variables el camino público no existe y todo se resuelve por el token de quien mira (lo público que
  se encuentre así también va al caché global).
- **Renovar el token de usuario.** Si vence, se renueva con el refresh token y se guardan los dos nuevos; una renovación
  a la vez por usuario (el refresh token es de un solo uso). Si falla, ese usuario no consulta privados hasta el próximo
  login, y los chips siguen como links.
- **Qué se reconoce.** URLs `https://github.com/<owner>/<repo>/(issues|pull)/<n>` (con `www.`, con subrutas como
  `/files` y con `#fragmento` o `?query`). Sin `http:`, sin otros hosts (GitHub Enterprise queda fuera), sin ramas ni
  commits. Es chip solo el link cuyo texto es la propia URL (la que se pega suelta, la que `remark-gfm` convierte en
  link, o `[url](url)`); un `[texto](url)` conserva el texto que escribió la persona y es un link normal.
- **Qué muestra el chip.** Ícono de tipo y estado (issue abierto, cerrado, cerrado como no planeado; PR abierto,
  borrador, mergeado, cerrado) y `repo#n` con el título truncado; el estado también va en texto para lectores de
  pantalla, nunca solo color. Es un link real a GitHub (`target=_blank`, `rel=noopener noreferrer`); en una fila,
  como todo lo demás, es inerte.

## Consecuencias

- Quien no tiene acceso a un repo privado ve la URL como link, no el título: un título privado nunca llega a quien no
  pudo pedirlo, y nunca se escribe en la tabla global.
- Los repos privados cuestan una consulta por persona que los mira; con el límite por token y los TTL no pesa.
- `GITHUB_APP_ID` y `GITHUB_APP_PRIVATE_KEY` son secretos nuevos en `~/deploy/env/mychecklist.env`. La clave privada da
  lectura sobre todo lo que la App tenga instalado: si se filtra, se rota desde la configuración de la App.
- Sin job: un link que nadie abre no se actualiza; al abrirlo se ve lo guardado un instante y enseguida lo vivo.
- Verificación: los tests usan GitHub de mentira (fixtures de las respuestas de GraphQL). El camino real se prueba con
  `scripts/github-live.ts`, que corre el mismo lote contra repos públicos con un token propio (`GITHUB_TOKEN`).
- Fuera de M4: ramas, commits, estado de checks y avisos al cambiar el estado (necesitarían webhooks).
