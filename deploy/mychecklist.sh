#!/usr/bin/env bash
# Blue/green deploy of MyChecklist (ARCHITECTURE.md › Deploy). Runs on the VPS from the faku-org self-hosted runner.
#   deploy/mychecklist.sh <sha>        build is already in the workspace; install into the idle slot, check it, switch nginx
#   deploy/mychecklist.sh --rollback   switch back to the previous slot (no rebuild)
# The previous slot keeps running, so a rollback is a flip, not a rebuild.
set -euo pipefail

BASE=/home/hermes/mychecklist                 # blue/ and green/ live here
STATE=/home/hermes/deploy/state/mychecklist   # `active` holds the live slot name
SNIPPET=/etc/nginx/snippets/mychecklist-active.conf
BUN=/opt/bun/bun
SYSTEMCTL="sudo -n /usr/bin/systemctl"
NGINX="sudo -n /usr/sbin/nginx"
DOMAIN="${MYCHECKLIST_DOMAIN:-checklist.wefaber.net}"
declare -A PORT=([blue]=4151 [green]=4152)

log() { printf '[mychecklist %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
other() { [[ "$1" == blue ]] && echo green || echo blue; }

wait_for() { # url, tries
  local url=$1 tries=${2:-30}
  for ((i = 1; i <= tries; i++)); do
    if [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$url" || true)" == 200 ]]; then return 0; fi
    sleep 1
  done
  return 1
}

point_nginx_at() { # slot
  local slot=$1
  printf 'set $mychecklist_port %s;\nset $mychecklist_root %s/%s/dist/web;\n' "${PORT[$slot]}" "$BASE" "$slot" |
    sudo -n /usr/bin/tee "$SNIPPET" >/dev/null
  $NGINX -t
  $SYSTEMCTL reload nginx
}

UNIT=/etc/systemd/system/mychecklist@.service
ENV_FILE=/home/hermes/deploy/env/mychecklist.env
DATA=/home/hermes/data/mychecklist

# Read-only check of the one-time VPS setup (deploy/README.md). Lists everything that is missing, then stops
# before the idle slot, the unit or nginx are touched.
preflight() { # slot
  local slot=$1 miss=() p
  for p in "$BASE" "$DATA" "$STATE"; do [[ -d $p && -w $p ]] || miss+=("2. directory missing or not writable: $p"); done
  [[ -r $ENV_FILE ]] || miss+=("3. env file missing or unreadable: $ENV_FILE")
  [[ -f $UNIT ]] || miss+=("4. systemd unit not installed: $UNIT (then: sudo systemctl daemon-reload)")
  [[ -f $SNIPPET ]] || miss+=("5. nginx snippet missing: $SNIPPET (initial: set \$mychecklist_port 4151; set \$mychecklist_root $BASE/blue/dist/web;)")
  grep -rqs mychecklist-active.conf /etc/nginx/sites-enabled/ || miss+=("5. no enabled nginx vhost includes mychecklist-active.conf (deploy/nginx/mychecklist-next.conf)")
  local cmds=(
    "/usr/bin/systemctl start mychecklist@$slot" "/usr/bin/systemctl stop mychecklist@$slot"
    "/usr/bin/systemctl status mychecklist@$slot" "/usr/bin/systemctl reload nginx"
    "/usr/sbin/nginx -t" "/usr/bin/tee $SNIPPET")
  for p in "${cmds[@]}"; do
    # shellcheck disable=SC2086 # $p is a command line, split on purpose
    sudo -n -l $p >/dev/null 2>&1 || miss+=("6. sudoers does not allow, passwordless: sudo $p")
  done
  if ! /usr/bin/systemctl is-active --quiet "mychecklist@$slot" 2>/dev/null && ss -ltnH "sport = :${PORT[$slot]}" 2>/dev/null | grep -q .; then
    miss+=("1. port ${PORT[$slot]} is taken by another process: ss -ltnp 'sport = :${PORT[$slot]}'")
  fi
  ((${#miss[@]} == 0)) && return 0
  log "preflight failed, the VPS setup is incomplete (step numbers are from deploy/README.md):"
  printf '  - %s\n' "${miss[@]}" >&2
  log "nothing was changed"
  return 1
}

ACTIVE=$(cat "$STATE/active" 2>/dev/null || echo green)   # first run: pretend green is live, so blue goes up first
IDLE=$(other "$ACTIVE")

if [[ "${1:-}" == --rollback ]]; then
  log "rollback: $ACTIVE -> $IDLE"
  wait_for "http://127.0.0.1:${PORT[$IDLE]}/ready" 5 || { log "slot $IDLE is not answering, rollback aborted"; exit 1; }
  point_nginx_at "$IDLE"
  echo "$IDLE" >"$STATE/active"
  wait_for "https://$DOMAIN/ready" 10 && log "rollback ok, $IDLE is live"
  exit 0
fi

SHA=${1:?usage: mychecklist.sh <sha> | --rollback}
[[ -d dist/web && -f server/index.ts ]] || { log "run from the repo root after 'bun run build'"; exit 1; }

preflight "$IDLE" || exit 1

log "deploying $SHA into $IDLE (live is $ACTIVE)"
$SYSTEMCTL stop "mychecklist@$IDLE" 2>/dev/null || true
rm -rf "${BASE:?}/$IDLE"
mkdir -p "$BASE/$IDLE"
cp -r dist server shared package.json bun.lock tsconfig.json "$BASE/$IDLE/"
( cd "$BASE/$IDLE" && $BUN install --frozen-lockfile --production )
echo "$SHA" >"$BASE/$IDLE/REVISION"

$SYSTEMCTL start "mychecklist@$IDLE"
if ! wait_for "http://127.0.0.1:${PORT[$IDLE]}/ready" 30; then
  log "slot $IDLE never became ready; $ACTIVE stays live"
  $SYSTEMCTL status "mychecklist@$IDLE" --no-pager -n 30 || true
  $SYSTEMCTL stop "mychecklist@$IDLE" || true
  exit 1
fi

point_nginx_at "$IDLE"
echo "$IDLE" >"$STATE/active"

# The real thing: the public domain, not the slot.
if ! wait_for "https://$DOMAIN/ready" 15 || ! wait_for "https://$DOMAIN/" 5; then
  log "$DOMAIN failed after the switch, rolling back to $ACTIVE"
  point_nginx_at "$ACTIVE"
  echo "$ACTIVE" >"$STATE/active"
  exit 1
fi
log "ok: $SHA is live on $DOMAIN (slot $IDLE, previous $ACTIVE kept for rollback)"
