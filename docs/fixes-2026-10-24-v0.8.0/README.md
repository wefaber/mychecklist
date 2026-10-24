# Fixes 2026-10-24 · v0.8.0 (M7)

Hallazgos y pendientes de la etapa de organizaciones de equipo (ADR 0009). Esta rama está apilada sobre `feat/m4-links-github`
(PR #12): comparte la migración 0006 y la versión 0.7.0; la 0007 y la 0.8.0 son de esta etapa.

## Servidor

- [x] Migración 0007 `org_invitations` (aditiva): una invitación vigente por `(org, login)`, rol `admin` o `member`.
- [x] Crear una org de equipo (`createTeamOrg`): solo por la tailnet, quien crea queda `owner`, tope de 10 por creador
      (`server/members.test.ts`).
- [x] Invitar por login de GitHub: se normaliza (`@Bob` → `bob`), se valida la forma, `CONFLICT` si ya es miembro o ya
      tiene invitación, la org personal no admite miembros, el listener público no invita.
- [x] Roles al invitar y revocar: `member` no invita ni ve invitaciones; `admin` invita y revoca solo `member`; `owner`
      todo. Revocar con el id de una invitación de otra org no la toca.
- [x] Aceptar y rechazar: solo con el login de la sesión y por la tailnet; otra persona recibe el mismo `NOT_FOUND`
      que si no existiera; una vencida no se acepta y se puede volver a mandar; el tope de 50 miembros se aplica al aceptar.
- [x] Cambiar roles (solo `owner`) y la regla de al menos un `owner`: no se puede bajar, quitar ni salir al último.
- [x] Quitar y salir: un `admin` saca a `member`, no a otro `admin` ni a un `owner`; nadie se saca a sí mismo; quien sale
      o es quitado pierde el acceso a la org y se revocan sus tokens de API en ella.
- [x] Importar exige `owner` o `admin`; exportar sigue abierto a cualquier miembro (`server/members.test.ts`).
- [x] Actividad de la org: `member.invited`, `member.invite_revoked`, `member.joined`, `member.role_changed`,
      `member.removed`, `member.left` en el orden esperado.
- [x] Avisos: los cambios publican `scope: 'members'` y el stream SSE se cierra para quien ya no es miembro (test con el
      stream real de `/events`).
- [x] GraphQL de punta a punta: invitar, ver, aceptar y listar miembros; `Query.ingress`; `Org.invitations` da
      `FORBIDDEN` a un `member`; `CONFLICT` llega como `extensions.code`.
- [x] Acceso solo por la tailnet: por el listener público no se crea, no se invita, no se acepta, `User.invitations` da
      vacío y las orgs de equipo siguen sin listarse (`server/isolation.test.ts` + `server/members.test.ts`).
- [~] El stream SSE verifica la membresía en cada aviso y cada ping (25 s): un miembro quitado puede seguir conectado
  hasta el siguiente de los dos, pero no recibe nada de contenido (los avisos no llevan datos).
- [ ] Un login de GitHub renombrado y tomado por otra persona recibiría la invitación pendiente. Mitigado con el
      vencimiento a 14 días y la lista de pendientes para revocar; no se resuelve el login contra la API de GitHub.
- [ ] Borrar o renombrar una org de equipo, y pasar la propiedad en un paso, quedan para después de M7.
- [ ] Un rol de solo lectura (`viewer`) pide rehacer el `CHECK` de `org_members` (contract).

## Cliente

- [x] La org activa se recuerda en `localStorage` y cae a la personal si ya no pertenece a ella
      (`web/features/orgs/active.test.ts`); `useViewer` expone `org`, `orgId`, `setOrg` e `ingress`.
- [x] `OrgMenu` en la barra superior: solo se dibuja donde hay algo que elegir o crear; marca las invitaciones
      pendientes con un punto y en el nombre accesible.
- [x] `/equipo`: invitaciones para vos (aceptar y rechazar), crear equipo, miembros con rol editable para el `owner`,
      sacar, salir, invitar y pendientes con revocar. Todos los textos en `web/i18n/es.ts`.
- [x] Importar se oculta a los `member` en el diálogo de exportar e importar.
- [x] `bun run check` en verde: `tsc`, `oxlint`, `check-scoped` y los tests (365).
- [ ] Verificado en el navegador con dos sesiones por la tailnet (invitar, aceptar, cambiar rol, sacar, salir). No se
      pudo manejar un navegador desde esta sesión: el cliente está cubierto por tipos y tests de lógica, no por una
      pasada visual.
- [ ] axe-core en `/equipo` con los cuatro temas.
- [ ] Los errores de dominio (`CONFLICT`, `LIMIT_REACHED`, `INVALID_INPUT`, `FORBIDDEN`) se muestran con el mensaje que
      manda el servidor, en español; los demás con un texto genérico. Si se quiere un texto propio por código, va a
      `web/i18n`.

## Deploy

- [ ] Sin cambios de Nginx ni de systemd: todo viaja por `/graphql` y `/events`. Falta verificar en el servidor después
      del merge (workflow verde, `/ready` 200 y un `inviteMember` real por la tailnet).
