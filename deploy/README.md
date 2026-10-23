# Deploy

Push a `main` → `.github/workflows/deploy.yml` en el runner self-hosted de `wefaber` → `bun install --frozen-lockfile`,
`bun run check`, `bun run build`, `deploy/mychecklist.sh <sha>`.

`mychecklist.sh` es blue/green. El slot ocioso (`/home/hermes/mychecklist/{blue,green}`, puertos 4151/4152) recibe el
release, arranca como `mychecklist@<slot>` y tiene que responder `/ready`; después Nginx apunta a él por
`/etc/nginx/snippets/mychecklist-active.conf` y el **dominio público** tiene que responder `/ready` y `/`. Si el dominio
falla, el script vuelve solo al slot anterior. El slot anterior sigue corriendo: `deploy/mychecklist.sh --rollback`
vuelve sin recompilar.

Cada slot levanta dos listeners en loopback (ADR 0001): público 4151/4152 y tailnet 4153/4154. El script exige que
`/ready` responda en los dos antes de cambiar de slot.

## Instalación única en el VPS (todavía no hecha)

`mychecklist.sh` corre un preflight de solo lectura antes de tocar nada: lista lo que falte de la lista de abajo (los
números coinciden) y sale con 1, así un primer deploy en un VPS sin preparar falla con la lista y no con un error de
systemd.

1. Puertos libres: `ss -ltn | grep -E ':415[1-4]'` (4151-4154: dos por slot).
2. `mkdir -p /home/hermes/mychecklist /home/hermes/data/mychecklist /home/hermes/deploy/state/mychecklist`
3. `~/deploy/env/mychecklist.env` (los secretos viven acá, nunca en el repo). Variables:

   | Variable                                   | Qué es                                                                                         |
   | ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
   | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Credenciales de la GitHub App (ADR 0003). Sin ellas el login queda desactivado, el resto anda. |
   | `MYCHECKLIST_TOKEN_KEY`                    | Clave AES-256 de los tokens: `openssl rand -base64 32`. Sin clave el login falla cerrado.      |
   | `MYCHECKLIST_PUBLIC_URL`                   | `https://checklist.wefaber.net`. Arma el callback y activa cookies `Secure`.                   |
   | `MYCHECKLIST_TAILNET_URL`                  | Origen https del vhost de la tailnet (paso 5).                                                 |

   En la GitHub App, los dos callbacks: `<MYCHECKLIST_PUBLIC_URL>/auth/github/callback` y
   `<MYCHECKLIST_TAILNET_URL>/auth/github/callback`.

4. `sudo cp deploy/mychecklist@.service /etc/systemd/system/ && sudo systemctl daemon-reload`
5. Nginx: `deploy/nginx/mychecklist.conf` en `sites-available` + symlink, DNS de `checklist.wefaber.net`, TLS como los
   otros vhosts y un `snippets/mychecklist-active.conf` inicial (`set $mychecklist_port 4151;`,
   `set $mychecklist_tailnet_port 4153;` y `set $mychecklist_root /home/hermes/mychecklist/blue/dist/web;`).
   El vhost de la tailnet es `deploy/nginx/mychecklist-tailnet.conf`: es una plantilla, hay que completar la IP de
   Tailscale y el nombre antes de instalarla.
6. sudoers del usuario del runner, sin contraseña y limitado a: `systemctl start|stop|status|reload` sobre
   `mychecklist@*` y `nginx`, `nginx -t` y `tee /etc/nginx/snippets/mychecklist-active.conf`.
7. Backup horario: `sqlite3 /home/hermes/data/mychecklist/mychecklist.db "VACUUM INTO '/home/hermes/data/mychecklist/backups/$(date +%F-%H).db'"`
   (timer de systemd) y un simulacro de restauración antes de abrirlo.

## Pendientes conocidos

- Las migraciones corren al arrancar el slot mientras el anterior sigue sirviendo el mismo SQLite: tienen que ser
  compatibles hacia atrás (aditivas) por un release.
- Los scripts se escribieron sin acceso al VPS. Solo están verificados con `bash -n`.
