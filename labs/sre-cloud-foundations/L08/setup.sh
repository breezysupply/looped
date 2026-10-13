#!/usr/bin/env bash
# L08 setup: your workspace (default labs/sre-cloud-foundations/L08/work, or
# L08_WORK=DIR) from the starter, a lab-only API token, and the local inventory
# fixture on 127.0.0.1:8098 in the chosen variant. Never overwrites your code.
# No root needed.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_linux_vm
command -v python3 >/dev/null 2>&1 || die "python3 not found"
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' || die "python3 3.9+ required"
WORK="${L08_WORK:-$HERE/work}"
mkdir -p "$WORK/.run" "$WORK/.secrets" "$WORK/out"
chmod 700 "$WORK/.secrets"
for f in invclient.py test_invclient.py; do
  if [ -e "$WORK/$f" ]; then say "keeping your $WORK/$f"; else cp "$HERE/starter/$f" "$WORK/$f"; fi
done
if [ ! -s "$WORK/.secrets/l08-token" ]; then
  umask 077
  printf 'lab-l08-%s-not-a-real-secret\n' "$(python3 -c 'import secrets; print(secrets.token_hex(8))')" > "$WORK/.secrets/l08-token"
fi
EV="$(evidence_dir "$HERE")"
[ -f "$EV/L08-notes.md" ] || cp "$HERE/assets/notes-template.md" "$EV/L08-notes.md"
L08_WORK="$WORK" LOOPED_VARIANT="${LOOPED_VARIANT:-variant-a}" bash "$HERE/inject.sh"
say ""
say "L08 ready. Workspace: $WORK   fixture: http://127.0.0.1:8098   token file: $WORK/.secrets/l08-token"
say "  cd $WORK && python3 -m unittest discover -s . -p 'test_*.py'"
say "  python3 invclient.py --token-file .secrets/l08-token list --out out/inventory.json; echo \$?"
