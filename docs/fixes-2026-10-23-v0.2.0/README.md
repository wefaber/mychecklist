# Fixes 2026-10-23 · v0.2.0 (M1)

Hallazgos y pendientes de la etapa de login, sesiones, org personal, dos listeners y `scoped.ts`.

## Servidor

- [x] Una org `team` pedida por el listener público da `FORBIDDEN` (`server/isolation.test.ts`).
- [x] Una sesión de la tailnet no vale en el listener público, y al revés (mismo archivo).
- [x] Un header `X-Ingress` no cambia el ingress (mismo archivo).
- [x] Tokens de GitHub cifrados con AES-256-GCM y sesión guardada solo como sha256 (`server/auth/login.test.ts`).
- [x] `check-scoped` cubre `activity`, la primera tabla con `org_id`.
- [~] Los flujos de OAuth se probaron con un GitHub de mentira (nunca contra terceros): falta probar el login real
  contra la GitHub App cuando exista.
- [ ] Rate limit del login: hoy en memoria y por `X-Forwarded-For`; si el slot reinicia, se pierde. Alcanza para un
      solo proceso.

## Cliente

- [x] Tile de cuenta: entrar con GitHub, salir, avisos de login cancelado o fallido, login desactivado.
- [~] Verificado en el navegador solo el estado sin sesión; el estado con sesión se cubre con tests del servidor.
- [ ] Desktop (Tauri): el login por redirección no aplica; llega con el device flow de M8.

## Pendiente de Faku

- [ ] Confirmar GitHub App en lugar de OAuth App (ADR 0003 sigue en "propuesto").
- [ ] Crear la GitHub App con los dos callbacks y cargar las variables de `deploy/README.md` (paso 3).
- [ ] Definir la IP de Tailscale y el nombre del vhost de la tailnet (`deploy/nginx/mychecklist-tailnet.conf` es una
      plantilla).
- [ ] Confirmar que los puertos 4151-4154 estén libres en el VPS antes del primer deploy.
- [ ] DNS de `checklist.wefaber.net` y vhost de Nginx (heredado de M0).
