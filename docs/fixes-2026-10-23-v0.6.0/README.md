# Fixes 2026-10-23 · v0.6.0 (M4)

Hallazgos y pendientes de la etapa de links a issues y PRs de GitHub con refresco (ADR 0006).

## Servidor

- [x] Parser de URLs (`shared/github.ts`): issues y PRs, `www.`, barra final, `#fragmento`, `?query`, pestañas de un PR
      (`files`, `commits`, `checks`); no reconoce otros hosts (`github.com.evil.test`, `gist.`), `http:`, usuario ni
      puerto, números con ceros o fuera de rango, ni ramas, commits o discusiones (`shared/github.test.ts`).
- [x] Fixtures de la consulta por lote (`server/github/fixtures/*.json`, `server/github/api.test.ts`): issue abierto,
      cerrado y cerrado como no planeado; PR abierto, borrador, mergeado y cerrado; repo que no se ve; número que no
      existe; límite de la API; 401, 403/429, 5xx y red caída. Nada del usuario se interpola en el texto de la consulta.
- [x] Token de instalación: JWT RS256 con clave PKCS#1 verificado contra la clave pública, canje, caché en memoria,
      renovación antes del vencimiento, un solo canje con pedidos a la vez y espera de un minuto si falla.
- [x] Caché por visibilidad (`server/github.test.ts`): lo público se comparte entre personas con un solo pedido a GitHub;
      lo privado queda en el caché de quien lo pidió y otra persona no lo ve; la App que ve un repo privado no lo
      publica; un repo que pasa a privado se borra del caché global; sin la App configurada se resuelve con el token de
      quien mira.
- [x] Refresco perezoso con vencimiento por estado (5 min, 1 h, 10 min), lo guardado se muestra marcado vencido si
      GitHub falla, y el límite de la API frena el token por debajo de 200 pedidos hasta el reinicio.
- [x] Token de usuario: renovación con refresh token cuando GitHub lo rechaza y cuando figura vencido; el par nuevo queda
      cifrado en la base.
- [x] GraphQL `githubLinks`: sin sesión no consulta nada; rechaza más de 50 links, dueños o repos con forma inválida y
      números fuera de rango.
- [x] Verificado contra GitHub de verdad (`scripts/github-live.ts` con un token propio): issue cerrado, PR mergeado, PR
      cerrado, repo inexistente y PRs de `wefaber/mychecklist`; la consulta por lote y el mapeo de estados funcionan
      con la API real.
- [ ] El token de instalación no se probó contra GitHub (faltan `GITHUB_APP_ID` y `GITHUB_APP_PRIVATE_KEY` en el
      servidor): solo contra un GitHub de mentira y con una clave generada en el test.
- [ ] Un repo privado con la App instalada y el token de una persona real no se probó de punta a punta; el camino se
      cubre con tests.
- [~] Los límites de la API y los bloqueos por token viven en memoria: un reinicio del slot los olvida. Alcanza para un
  solo proceso por slot; GitHub vuelve a contestar 403 y se frena de nuevo.
- [ ] El caché no se purga: `github_public_links` y `github_private_links` crecen con cada link distinto que se mira.
      Va junto con la purga de datos borrados (M2).

## Cliente

- [x] Chip en el detalle y en una fila (`web/lib/GithubChip.tsx`): ícono por tipo y estado, `repo#n`, título truncado y
      el estado en texto para lectores de pantalla; en una fila es inerte, en el detalle es un link a otra pestaña con
      `rel="noopener noreferrer"` (`web/lib/GithubChip.test.tsx`).
- [x] Solo es chip la URL pegada suelta; `[texto](url)`, otros destinos de GitHub, otros sitios y `http:` quedan como
      link normal. Un título con HTML se muestra como texto.
- [x] Los chips que aparecen juntos salen en un solo pedido, los repetidos comparten respuesta y más de 50 se parten en
      pedidos de 50 (`web/lib/github.test.ts`).
- [x] Verificado en el navegador contra repos reales (`oven-sh/bun`, `facebook/react`, `wefaber/mychecklist`): el chip de
      un issue cerrado, un PR mergeado y un PR cerrado muestran título y estado en la lista y en la Vista del detalle;
      un repo inexistente queda como `nada#1` con el motivo; al recargar, cuatro links salen en un solo pedido.
- [x] axe-core (WCAG 2.2 AA): 0 violaciones en `/design` con los cuatro temas (siete combinaciones); la muestra de
      Markdown suma dos chips y la fila de muestra uno.
- [x] Al cerrar sesión se descartan de memoria los títulos traídos con el token de esa persona.
- [ ] Prueba con lector de pantalla real de los chips.
- [ ] El chip no muestra que lo que ve está vencido (`stale`): hoy solo lo expone la API.
- [~] Cada chip de una fila monta una consulta de TanStack Query. Con 5000 items con links no se midió; el lote y el
  caché evitan que sean 5000 pedidos, pero sí 5000 observadores.

## Para el kit (`@wefaber/ui`)

- [ ] Los chips (de mención y de GitHub) son del cliente; si otro producto los necesita, van al kit.

## Pendiente de Faku

- [ ] Cargar `GITHUB_APP_ID` y `GITHUB_APP_PRIVATE_KEY` en `~/deploy/env/mychecklist.env` (`deploy/README.md`, paso 3).
      La App necesita los permisos _Issues_ y _Pull requests_ en lectura y estar instalada en una cuenta.
- [ ] `origin/main` tiene marcadores de conflicto (`<<<<<<<`, `=======`, `>>>>>>>`) en `deploy/README.md`, líneas 40 a
      62, que entraron con el merge del PR de deploy. No es de M4.
- [ ] Todo lo de v0.2.0 a v0.4.0 sigue pendiente (login real con la App, tailnet, Nginx para `/files/`).
