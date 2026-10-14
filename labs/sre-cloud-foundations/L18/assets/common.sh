# shellcheck shell=bash
# L18 shared helpers (sourced after lib/looped.sh). Scope: kind cluster looped-policy (context
# kind-looped-policy), namespace beacon, objects labelled looped.lab/id=L18, image looped-l18-beacon:1.4.0.
L18_IMAGE="looped-l18-beacon:1.4.0"
L18_SA="system:serviceaccount:$SRE_NS:beacon-deployer"
WORK="$HERE/work"
WM="$WORK/manifests"

l18_edit() {  # l18_edit <file> <old> <new>   exact-string edit of a work/ manifest
  python3 - "$WM/$1" "$2" "$3" <<'PY'
import sys
path, old, new = sys.argv[1:4]
src = open(path, encoding="utf-8").read()
if src.count(old) != 1:
    sys.exit("anchor not found exactly once in %s: %r (already edited? reset.sh restores it)" % (path, old))
open(path, "w", encoding="utf-8").write(src.replace(old, new, 1))
PY
}

# run a probe from inside a pod of <app>: l18_probe <app> <mode tcp|pg> <host> <port>
l18_probe() {
  if [ -z "${L18_GUARDED:-}" ]; then require_kind_context "$SRE_CTX_POLICY" "$SRE_KIND_POLICY"; L18_GUARDED=1; fi
  k_policy exec "deploy/$1" -- python3 -c "$(cat "$HERE/assets/probe.py")" "$2" "$3" "$4" 2>/dev/null \
    || printf '{"target":"%s:%s","error":"exec failed"}\n' "$3" "$4"
}
