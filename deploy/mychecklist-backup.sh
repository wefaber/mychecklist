#!/usr/bin/env bash
# Backup horario del SQLite de MyChecklist: VACUUM INTO (copia consistente con WAL activo),
# verifica integridad y rota los archivos de más de 7 días.
set -euo pipefail
DB=/home/hermes/data/mychecklist/mychecklist.db
DEST=/home/hermes/data/mychecklist/backups
mkdir -p "$DEST"
OUT="$DEST/$(date +%F-%H).db"
[ -f "$OUT" ] && exit 0
python3 - "$DB" "$OUT" <<'PY'
import sqlite3, sys
src, out = sys.argv[1], sys.argv[2]
c = sqlite3.connect(src)
c.execute("VACUUM INTO ?", (out,))
c.close()
v = sqlite3.connect(out)
assert v.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
v.close()
print("backup ok:", out)
PY
find "$DEST" -name '*.db' -mtime +7 -delete
