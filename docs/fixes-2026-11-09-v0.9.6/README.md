# Fixes 2026-11-09 · v0.9.6

Correcciones y mejoras de uso en mobile, y pedidos nuevos que salieron de usar la lista "Ad Astra".

## Mobile

- [x] La vista se movía en el eje X (#23). Causa: el header (nombre, buscador, importar y exportar, atajos, org, tema y
      cuenta con nombre y botón "Salir") medía más que el viewport; en `main` a 375 px el documento medía 381 px. Con el
      cambio el documento mide lo mismo que el viewport a 375 y 320 px, en la lista (con URL larga, código y tabla), `/ajustes/tokens`, `/equipo` y `/design`. El detalle del item no se midió.
      Medido en el navegador con `scrollWidth` contra `innerWidth`.
- [ ] Botones de cierre de los modales muy chicos para el dedo (#27). `Dialog` del kit usa `IconButton` de 32 px.

## Header

- [x] El header se comprime en nombre, buscador y un solo menú (#24). El menú agrupa cuenta, importar y exportar, tokens
      de API, atajos, organización, tema y salir. En mobile el buscador queda como ícono.
- [~] Teclado: al abrir el menú el foco va a la primera entrada (verificado). `Esc`, flechas, `Inicio` y `Fin` son del
  `Menu` del kit y no se probaron acá.
- [~] Con invitaciones pendientes el botón del menú lleva un punto y su nombre dice cuántas. Probado solo por lectura del
  código: la tailnet no se levantó en local.
- [ ] axe en `/design` con los 4 temas y el menú abierto.
- [ ] Verificar el menú a 1280 px y con el viewer de la tailnet (orgs de equipo).

## Pedidos nuevos

- [ ] Completar un item con una resolución (#25).
- [ ] Id corto visible y copiar link para referenciar items (#26).
- [ ] Pasar MyChecklist al gateway centralizado y su Code Mode (#22).
