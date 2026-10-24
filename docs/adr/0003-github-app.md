# 0003 — Login y tokens con una GitHub App

Estado: propuesto (M0, 2026-10-23). Faku confirma antes de M1.

## Contexto

Faku pidió "OAuth del usuario": el login de GitHub entrega el token, y los links a issues, PRs y branches se resuelven
con los permisos de quien mira, sin webhooks. Una OAuth App clásica obliga al scope `repo`, que da escritura sobre
todos los repos privados, y admite un solo callback (acá hacen falta el público y el de la tailnet).

## Decisión

Una **GitHub App usada solo para tokens de usuario**: sigue siendo OAuth del usuario, pero con permisos finos de solo
lectura (issues, pull requests, contents, checks), tokens que expiran con refresh y varios callbacks.

- El token se guarda cifrado (AES-256-GCM) con una clave del archivo de entorno; sin clave, falla cerrado.
- Sin webhooks. El refresco de los links a issues y PRs (perezoso, sin job) y su caché, que separa repos públicos y
  privados, quedaron en el ADR 0006.
- Si se prefiere una OAuth App, el cambio queda acotado a `server/auth/github.ts`.

## Consecuencias

- Hay que crear la App en GitHub (Faku) y poner sus credenciales en `~/deploy/env/mychecklist.env`.
- Los permisos mínimos reducen el daño si se filtra un token.
