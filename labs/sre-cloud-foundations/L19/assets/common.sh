# shellcheck shell=bash
# L19 shared helpers (sourced after lib/looped.sh). Scope: the kind cluster looped-foundations,
# namespace beacon, the Helm release "beacon" created from this lab's chart, images looped-l19-*.
L19_RELEASE="beacon"
L19_IMAGE="looped-l19-beacon"
L19_VERSIONS="1.4.0 1.5.0"
WORK="$HERE/work"

h_basic() {  # helm, always with the lab context and namespace, after the scope guard
  if [ -z "${L19_GUARDED:-}" ]; then require_kind_context "$SRE_CTX_BASIC" "$SRE_KIND_BASIC"; L19_GUARDED=1; fi
  helm --kube-context "$SRE_CTX_BASIC" -n "$SRE_NS" "$@"
}

# Is the release "beacon" in namespace beacon this lab's? (its values carry commonLabels looped.lab/id=L19)
l19_release_state() {  # prints: absent | ours | foreign
  if ! h_basic status "$L19_RELEASE" >/dev/null 2>&1; then echo absent; return 0; fi
  if h_basic get values "$L19_RELEASE" --all -o json 2>/dev/null | python3 -c 'import json,sys; v=json.load(sys.stdin); sys.exit(0 if (v.get("commonLabels") or {}).get("looped.lab/id")=="L19" else 1)'; then
    echo ours
  else
    echo foreign
  fi
}

l19_python() {  # a Python that can import yaml (system, or the lab venv)
  if python3 -c 'import yaml' >/dev/null 2>&1; then echo python3
  elif [ -x "$HERE/.venv/bin/python" ]; then echo "$HERE/.venv/bin/python"
  else return 1; fi
}
