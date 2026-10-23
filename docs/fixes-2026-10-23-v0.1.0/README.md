# Fixes 2026-10-23 · v0.1.0 (M0)

Hallazgos de la construcción del esqueleto.

## Servidor

- [x] `/ready` devuelve 503 hasta aplicar las migraciones (test en `server/api.test.ts`).
- [~] El sandbox de QuickJS no corta strings enormes a tiempo: se resuelve con un Worker en M5 (ADR 0002).
- [ ] Confirmar que los puertos 4151–4154 estén libres en el VPS antes del primer deploy.

## Cliente

- [x] `queryFn` de `/ready` devolvía `undefined` y TanStack Query lo rechazaba; ahora devuelve `true`.

## Pendiente de Faku

- [ ] Crear `faku-org/mychecklist` en GitHub (no existe todavía).
- [ ] Confirmar GitHub App en lugar de OAuth App (ADR 0003).
- [ ] DNS de `checklist.wefaber.net` y vhost de Nginx.
