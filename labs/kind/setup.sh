#!/usr/bin/env bash
# Create (or reuse) the dedicated local kind cluster for the Looped labs.
# Idempotent: safe to run again at any time.
#
#   labs/kind/setup.sh            create cluster if absent, namespace, warm images
#   labs/kind/setup.sh --no-warm  skip pre-pulling the two lab images
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

WARM=1
case "${1:-}" in
  "") ;;
  --no-warm) WARM=0 ;;
  *) die "usage: $0 [--no-warm]" ;;
esac

info "Preflight (tools and Docker)"
preflight --setup

if kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
  info "Cluster '$CLUSTER' already exists; reusing it"
  if ! kc config get-contexts "$CTX" >/dev/null 2>&1; then
    info "Context '$CTX' missing from your kubeconfig; re-exporting it from kind"
    kind export kubeconfig --name "$CLUSTER"
  fi
else
  info "Creating kind cluster '$CLUSTER' (first run downloads the node image, roughly 400 MB compressed)"
  # kind adds the context kind-looped-onsite to your kubeconfig and makes it
  # current. The labs never rely on the current context; they always pass
  # --context kind-looped-onsite.
  kind create cluster --name "$CLUSTER" --config "$KIND_DIR/kind-config.yaml" --wait 180s
fi

info "Full preflight against the new context"
preflight

info "Waiting for nodes to be Ready"
kc wait --for=condition=Ready node --all --timeout=180s

info "Namespace $NS (Pod Security: enforce=baseline, warn/audit=restricted)"
kc apply -f - <<YAML
apiVersion: v1
kind: Namespace
metadata:
  name: $NS
  labels:
    looped.lab/namespace: "true"
    pod-security.kubernetes.io/enforce: baseline
    pod-security.kubernetes.io/warn: restricted
    pod-security.kubernetes.io/audit: restricted
YAML

warm_pod() {  # warm_pod <name> <image> <command-json>
  local name="$1" image="$2" cmd="$3"
  k delete pod "$name" --ignore-not-found --wait=true >/dev/null
  k apply -f - >/dev/null <<YAML
apiVersion: v1
kind: Pod
metadata:
  name: $name
  labels: { $LABEL_KEY: setup }
spec:
  restartPolicy: Never
  nodeSelector: { pool: general }
  securityContext: { runAsNonRoot: true, runAsUser: 65534, seccompProfile: { type: RuntimeDefault } }
  containers:
  - name: warm
    image: $image
    command: $cmd
    securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] } }
YAML
  if wait_until 300 "$name to finish" pod_phase_is "$name" Succeeded; then
    say "   $name: image present on the worker"
  else
    warn "$name did not finish; check: kubectl --context $CTX -n $NS describe pod $name (image pull limits or a proxy? see README troubleshooting)"
  fi
  k delete pod "$name" --ignore-not-found --wait=false >/dev/null
}

if [ "$WARM" = 1 ]; then
  # Pull the two lab images onto the worker once, so later labs start fast
  # and keep working offline. Short-lived pods, deleted afterwards.
  info "Pre-pulling lab images on the worker (busybox, curl)"
  warm_pod warm-busybox "$BUSYBOX_IMAGE" '["true"]'
  warm_pod warm-curl "$CURL_IMAGE" '["curl", "--version"]'
fi

cat <<TXT

Ready. Cluster '$CLUSTER', context '$CTX', namespace '$NS'.

Next steps (from the repo root):
  labs/kind/01-reconcile/inject.sh      # start a lab (see labs/kind/README.md for the list)
  alias kl='kubectl --context $CTX -n $NS'   # optional shortcut (always the lab context)
  labs/kind/reset.sh all                # clean up lab objects
  labs/kind/teardown.sh                 # delete the whole cluster when you are done
TXT
