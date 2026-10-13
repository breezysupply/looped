# shellcheck shell=bash
# L17 shared helpers (sourced after lib/looped.sh). Scope: kind cluster looped-foundations,
# namespace beacon, objects labelled looped.lab/id=L17, image looped-l17-beacon:1.4.0.
L17_IMAGE="looped-l17-beacon:1.4.0"
WORK="$HERE/work"
WM="$WORK/manifests"

l17_guard() {  # scope guard, once per script run
  if [ -z "${L17_GUARDED:-}" ]; then require_kind_context "$SRE_CTX_BASIC" "$SRE_KIND_BASIC"; L17_GUARDED=1; fi
}

l17_apply() {  # apply one or more files from work/manifests
  local f
  l17_guard
  for f in "$@"; do k_basic apply -f "$WM/$f" >/dev/null; done
}

# exact-string edit of a work/ manifest; fails loudly if the anchor is not there
l17_edit() {  # l17_edit <file> <old> <new>
  python3 - "$WM/$1" "$2" "$3" <<'PY'
import sys
path, old, new = sys.argv[1:4]
src = open(path, encoding="utf-8").read()
if old not in src:
    sys.exit("anchor not found in %s: %r (was the file already edited? reset.sh restores it)" % (path, old))
open(path, "w", encoding="utf-8").write(src.replace(old, new, 1))
PY
}

l17_db_exec() {  # psql inside beacon-db-0 (stdin passes through)
  l17_guard
  k_basic exec -i beacon-db-0 -c postgres -- psql -U postgres -d beacon -v ON_ERROR_STOP=1 "$@"
}

l17_mark() {  # remember which faults were exercised (validator reads work/.injected)
  mkdir -p "$WORK"
  printf '%s %s\n' "$1" "$(date -u +%FT%TZ)" >> "$WORK/.injected"
}
