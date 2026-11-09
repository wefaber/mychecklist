# Fixes 2026-11-09 · v0.13.0

## MyChecklist detrás del gateway de Code Mode (#22)

Decisión en `docs/adr/0013-detras-del-gateway-de-code-mode.md` (propuesto).

- [x] Dependencias: `@wefaber/codemode` y `-mcp` 0.4.x, `-sandbox-quickjs` 0.3.x (la 0.4.0 del sandbox no pasa
      `erasableSyntaxOnly`).
- [x] Config: `WCM_GATEWAY_SECRET` (opcional, 32+ caracteres). Sin ella el producto rechaza toda llamada firmada por el
      gateway.
- [x] Tokens: `findApiTokenByHash` (el mismo lookup por sha256, con puerta, vencimiento y revocación); `findApiToken`
      delega en él.
- [x] Rutas: con `x-wcm-via: gateway` se verifica la identidad firmada, se busca el `mck_` por hash y los scopes son la
      intersección entre el gateway y el modo del token (`gatewayScopes`). Sin intersección, 403.
- [x] Entrada directa con `mck_` sin cambios (`/mcp` y `/codemode/*`).
- [x] Tests: `server/mcp/gateway.test.ts` (firma mala, vencida, sin clave, hash desconocido, revocado, otra puerta, scopes
      recortados, otro producto, `x-wcm-via` falso sin firma, auditoría, org ajena).
- [x] Extremo a extremo local con el gateway real (`wefaber/codemode` main, `apps/gateway`): `catalog publish` (19
      operaciones), `token import` de un token de escritura y uno de lectura, y por el gateway: con el de escritura
      `execute` crea una lista y un item y los lee; con el de lectura lee, `codemode.checklist` no trae `setDone` ni
      `create` (llamar a uno da `not a function`); un token cualquiera sin importar da `UNAUTHENTICATED`.
- [x] Docs: ADR 0013, `ARCHITECTURE.md`, `deploy/README.md` (variable y alta en el gateway).
- [ ] Ops (Faku o Ether en el VPS, no se hace desde el PR): agregar `WCM_GATEWAY_SECRET` a
      `~/deploy/env/mychecklist.env`, desplegar por el pipeline, publicar el catálogo e importar los `mck_` vigentes en el
      gateway, y verificar un `execute` por el gateway contra `https://checklist.wefaber.net`.
- [ ] Pasar el `runId` del gateway al hook de auditoría (hoy el toolkit no lo expone); `codemode_runs` guarda el
      token y la etiqueta del agente.
- [ ] Dónde corre el gateway en producción y el corte de la entrada directa (ADR 0013, Pendiente).
- [ ] Toolkit: abrir issue en `wefaber/codemode` por `@wefaber/codemode-sandbox-quickjs@0.4.0` (`erasableSyntaxOnly`).
- [ ] Revocar el token `mck_` que se pegó en el chat durante la prueba.
