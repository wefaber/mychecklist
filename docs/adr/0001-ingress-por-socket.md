# 0001 — Ingress por socket

Estado: aceptado (M0, 2026-10-23). Se implementa en M1.

## Contexto

El uso personal es público y las organizaciones solo se acceden por la tailnet. El servidor tiene que saber por qué
puerta entró cada request. Un header (`X-Ingress`) que Nginx pone o pisa funciona, pero cualquier proceso local lo
puede falsificar y un vhost nuevo que se olvide de pisarlo abre las organizaciones.

## Decisión

Un proceso con **dos listeners**: uno para el vhost público y otro para el de la tailnet. El `ingress` sale del
socket por el que llegó la request y viaja en el contexto de GraphQL y de Code Mode. Si falta, cuenta como público.

- Sessions, device codes y `api_tokens` guardan su `ingress`; un token emitido en la tailnet se rechaza en el
  listener público.
- `server/db/scoped.ts` lanza `FORBIDDEN` si piden una org `team` con ingress público.
- Puertos: público 4151/4152, tailnet 4153/4154 (blue/green).

## Consecuencias

- No hay header en el que confiar; falsificar el ingress exige acceso al puerto de la tailnet.
- Deploy y systemd manejan dos puertos por slot.
- Los miembros de una org necesitan estar en la tailnet.
