# 0011 — Orgs de equipo vinculadas a una org de GitHub

Estado: propuesto (2026-11-09). Pendiente de review de Faku. Complementa el ADR 0009 (no lo reemplaza).

## Contexto

El ADR 0009 resolvió equipos con invitación manual por login. Con un equipo entero (Astra) eso es una invitación por
persona, y quien deja la organización de GitHub sigue adentro hasta que alguien lo saque. La identidad ya es de GitHub
(ADR 0003): la membresía de la org de GitHub es la fuente natural de verdad de quién pertenece al equipo.

## Decisión

- **Vínculo.** Una org de equipo se vincula con una org de GitHub: `orgs.github_org_id` (id numérico, estable ante
  renombres) y `github_org_login` (para mostrar). Una org de GitHub se vincula a una sola org de checklist (índice único).
  Solo un `owner`, solo por la tailnet. Para vincular, quien lo hace tiene que ser **admin activo** de la org de GitHub
  (`GET /user/memberships/orgs/{org}` con su token): sin eso cualquiera podría reclamar la org de otro.
- **Sync en cada login por la tailnet.** Por cada org vinculada se consulta la membresía de la persona con su propio token:
  - miembro activo y todavía no está: entra con rol `member` (o `admin` si es admin de la org de GitHub), `source = 'github'`;
  - ya entró por GitHub y cambió su rol allá: el rol acá lo sigue;
  - ya entró por GitHub y dejó de ser miembro: sale de la org y se revocan sus tokens de API en ella (igual que
    `removeMember`);
  - quedan en la actividad de la org (`member.joined`, `member.role_changed`, `member.removed`) y se avisa por SSE.
- **`org_members.source`** (`manual` | `github`). El sync solo toca filas `github`. Quien fue invitado a mano o creó la
  org no se sube, baja ni saca por GitHub. Un cambio de rol hecho por una persona (`setMemberRole`) pasa la fila a
  `manual`: el owner puede fijar a alguien sin que el sync lo pise.
- **Nadie se saca por no poder preguntar.** Si GitHub responde algo que no sea 200 o 404 (límite, 5xx, permisos), esa org
  se deja como está y el login sigue. `null` solo significa 404 o membresía no activa.
- **El vínculo es por id.** Si el login de la org de GitHub se reasigna a otra org, el id no coincide y la persona no
  cuenta como miembro.
- **Desvincular** (`owner`): quienes entraron por GitHub pasan a `manual` y conservan el acceso. Sacar a alguien después
  es `removeMember`, como siempre.
- **Sincronizar a pedido.** `syncGithubOrgs` aplica lo mismo para quien lo pide (botón "Sincronizar mi acceso"), útil
  para entrar o salir sin cerrar sesión.
- Todo es tailnet: por el listener público no hay vínculo, mutaciones ni sync (ADR 0001).
- Mismo tope de 50 miembros por org: si está llena, el sync no suma a nadie.

## Qué hay que hacer en GitHub (no está en el código)

1. La **GitHub App** (ADR 0003) necesita el permiso de organización **Members: read**. Al cambiar permisos, cada
   instalación tiene que aceptarlo.
2. La App tiene que estar **instalada en la org de GitHub** (adastra-org): los tokens de usuario de una App solo ven lo
   que la App ve. Sin eso GitHub responde 404 y no se vincula (el error lo dice).
3. En la org de GitHub, si la política de acceso restringe aplicaciones de terceros, aprobar la App.

## Alternativas descartadas

- **Job periódico que sincroniza a todos con el token de instalación.** Quita acceso sin esperar un login, pero necesita
  el permiso de lectura de miembros a nivel de instalación y un job con su propio calendario. Queda como mejora: hoy
  quien sale de GitHub conserva el acceso hasta su próximo login o sincronización (la sesión dura 30 días).
- **Sincronizar equipos (teams) de GitHub a roles.** Más fino, pero hace falta decidir un mapeo y pide más permisos.
  Hoy: admin de la org de GitHub = admin, miembro = miembro.
- **Reemplazar las invitaciones.** No: siguen sirviendo para gente fuera de la org de GitHub.

## Consecuencias

- Astra entra sin invitar a mano, pero cada persona necesita estar en la tailnet (ADR 0001): es la barrera de red.
- La baja efectiva en GitHub tarda hasta el siguiente login o sincronización de esa persona. Mitigación: el owner puede
  sacar a alguien a mano de inmediato.
- Un login hace una llamada a GitHub por org vinculada del servidor. Son pocas; si crecen, se pasa a una consulta por
  lote o a un job.
- No se pudo verificar contra GitHub real en esta etapa: los tests usan un cliente de mentira. Falta una prueba con la
  App instalada en una org real (primer paso del deploy).
