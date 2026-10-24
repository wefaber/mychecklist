# 0009 — Organizaciones de equipo: invitaciones y roles

Estado: propuesto (M7, 2026-10-24). Pendiente de review de Faku. Numeración fija: 0009 M7.

## Contexto

Hasta M6 toda org es `personal`: una por usuario, con un solo miembro (`owner`). El esquema ya tiene `orgs.kind = 'team'`,
`org_members.role` (`owner`, `admin`, `member`) y `openScope` ya rechaza una org `team` por el listener público
(ADR 0001). Faltan tres cosas: crear una org de equipo, sumar gente y decidir quién puede qué. El único proveedor de
identidad es GitHub (ADR 0003), así que a una persona se la reconoce por su login; no hay email.

## Decisión

- **Crear.** `createTeamOrg(name)` solo por la tailnet. Quien la crea queda como `owner`. Hasta 10 orgs de equipo por
  persona como creadora, para acotar abuso aun dentro de la tailnet.
- **Invitar por login de GitHub.** Una invitación es `(org, login en minúsculas, rol, quién invitó, vencimiento)`, con
  una sola vigente por `(org, login)`. No hay link ni token que circule: la persona invitada entra por la tailnet, ve
  sus invitaciones pendientes en la app y las acepta o rechaza. Vence a los 14 días; hasta 50 vigentes por org y 50
  miembros por org. Aceptar exige coincidir con el login actual de la sesión y la puerta de la tailnet; si no, el
  error es el mismo `NOT_FOUND` que si no existiera (no revela invitaciones ajenas).
- **Roles.** `member` lee y escribe listas, items y adjuntos y exporta; `admin` además invita y quita `member`, revoca
  invitaciones de `member`, crea tokens de API (ADR 0007) e importa; `owner` además invita `admin`, cambia roles y
  quita a cualquiera. Nadie se quita a sí mismo con `removeMember`: para eso está `leaveOrg`. Una org siempre conserva
  al menos un `owner`: el último no puede irse, bajarse de rol ni ser quitado (`CONFLICT`). Pasar la propiedad es
  promover a otro `owner` primero. No hay rol de solo lectura (el `CHECK` de `org_members.role` ya existe y no se
  toca).
- **Qué pasa al salir o ser quitado.** Se borra la fila de `org_members` y se revocan los tokens de API de esa persona en
  esa org. Las sesiones no se tocan (son de la persona, no de la org). El stream SSE de esa org vuelve a verificar la
  membresía en cada aviso y en cada ping, y se cierra si ya no corresponde.
- **Tabla de invitaciones.** `org_invitations` lleva `org_id` pero no es una tabla "con dueño" de `scoped.ts`, igual que
  `api_tokens`: la persona invitada todavía no es miembro, así que no existe un scope que abrir cuando se la busca por
  login. Todo el SQL vive en `server/db/members.ts` y cada servicio verifica con `openScope` (membresía y puerta) antes
  de tocar la org. Aceptar y rechazar solo operan sobre invitaciones cuyo login es el de la sesión.
- **Puerta.** Todo lo de equipo es tailnet: crear, invitar, aceptar y listar invitaciones. Por el listener público
  `User.invitations` devuelve vacío y los mutations fallan con `FORBIDDEN`. La actividad queda en `activity` de la org
  (`member.invited`, `member.invite_revoked`, `member.joined`, `member.role_changed`, `member.removed`, `member.left`).
- **Importar.** Pasa a exigir `owner` o `admin` (en la org personal quien importa es su dueño, nada cambia). Exportar
  sigue abierto a cualquier miembro: ya puede leer todo lo que el archivo contiene.

## Alternativas descartadas

- **Link de invitación con token.** Sirve para gente sin cuenta, pero hay que repartir un secreto y, al ser solo
  tailnet, la persona igual necesita estar en la red. Por login no hay nada que filtrar.
- **Resolver el login contra la API de GitHub al invitar.** Evita invitar a un login mal escrito, pero hace depender una
  mutación de un tercero y de un token. Una invitación a un login que no existe vence sola.
- **Un rol `viewer`.** Pide rehacer el `CHECK` de `org_members` (contract) y revisar cada servicio de escritura. Queda
  como mejora si hace falta.
- **Meter `org_invitations` en `scoped.ts`.** Obliga a abrir un scope para alguien que todavía no es miembro.

## Consecuencias

- Un login de GitHub se puede renombrar y el viejo ser tomado por otra persona: una invitación pendiente iría a quien
  lo tome. Mitigaciones: vence a los 14 días, quien administra ve y revoca las pendientes, y el login que cuenta es el de
  la última sesión.
- Borrar una org de equipo, renombrarla y transferir la propiedad en un paso quedan fuera de M7.
- La tailnet es la barrera de red: el acceso a la org sigue exigiendo sesión de la tailnet más membresía.
