#!/usr/bin/env bash
# profiles/kind-policy enforcement self-test. In a throwaway namespace looped-cni-selftest:
#   1. client → server:8080 connects                       (baseline: the network works)
#   2. a deny-all-ingress policy on the server → times out  (the CNI enforces a deny)
#   3. add an allow from pods labelled role=client → connects again, while an unlabelled
#      pod still times out                                  (selectors are evaluated)
# Exit 1 if any step disagrees. The namespace is deleted afterwards (and on failure).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../../lib/looped.sh"
. "$HERE/versions.env"
require_kind_context "$SRE_CTX_POLICY" "$SRE_KIND_POLICY"
NS=looped-cni-selftest
cleanup() { kc_policy delete namespace "$NS" --ignore-not-found --wait=false >/dev/null 2>&1 || true; }
trap cleanup EXIT

kc_policy apply -f - >/dev/null <<YAML
apiVersion: v1
kind: Namespace
metadata: {name: $NS, labels: {looped.lab/profile: kind-policy}}
---
apiVersion: v1
kind: Pod
metadata: {name: server, namespace: $NS, labels: {app: selftest-server}}
spec:
  securityContext: {runAsNonRoot: true, runAsUser: 65534}
  containers:
    - name: http
      image: $SELFTEST_IMAGE
      command: ["python3", "-m", "http.server", "8080", "--bind", "0.0.0.0", "--directory", "/tmp"]
      ports: [{containerPort: 8080}]
      resources: {requests: {cpu: 10m, memory: 32Mi}, limits: {memory: 64Mi}}
---
apiVersion: v1
kind: Pod
metadata: {name: client, namespace: $NS, labels: {role: client}}
spec:
  securityContext: {runAsNonRoot: true, runAsUser: 65534}
  containers:
    - name: c
      image: $SELFTEST_IMAGE
      command: ["sleep", "600"]
      resources: {requests: {cpu: 10m, memory: 16Mi}, limits: {memory: 64Mi}}
---
apiVersion: v1
kind: Pod
metadata: {name: stranger, namespace: $NS}
spec:
  securityContext: {runAsNonRoot: true, runAsUser: 65534}
  containers:
    - name: c
      image: $SELFTEST_IMAGE
      command: ["sleep", "600"]
      resources: {requests: {cpu: 10m, memory: 16Mi}, limits: {memory: 64Mi}}
YAML
kc_policy -n "$NS" wait --for=condition=Ready pod/server pod/client pod/stranger --timeout=180s >/dev/null
IP="$(kc_policy -n "$NS" get pod server -o jsonpath='{.status.podIP}')"
probe() {  # probe <pod> → prints open / closed:<reason>
  kc_policy -n "$NS" exec "$1" -- python3 -c 'import socket,sys
try:
    socket.create_connection((sys.argv[1], 8080), timeout=3).close(); print("open")
except Exception as e:
    print("closed:" + type(e).__name__)' "$IP" 2>/dev/null || echo "closed:exec-failed"
}
fail=0
r1="$(probe client)"; say "1 baseline client→server:        $r1 (want open)";    [ "$r1" = open ] || fail=1
kc_policy apply -f - >/dev/null <<YAML
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: {name: deny-ingress, namespace: $NS}
spec:
  podSelector: {matchLabels: {app: selftest-server}}
  policyTypes: [Ingress]
YAML
sleep 3
r2="$(probe client)"; say "2 deny-all ingress client→server:  $r2 (want closed)"; case "$r2" in closed:*) ;; *) fail=1 ;; esac
kc_policy apply -f - >/dev/null <<YAML
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: {name: allow-client, namespace: $NS}
spec:
  podSelector: {matchLabels: {app: selftest-server}}
  policyTypes: [Ingress]
  ingress:
    - from: [{podSelector: {matchLabels: {role: client}}}]
      ports: [{protocol: TCP, port: 8080}]
YAML
sleep 3
r3="$(probe client)";   say "3 allow role=client client→server: $r3 (want open)";   [ "$r3" = open ] || fail=1
r4="$(probe stranger)"; say "3 unlabelled stranger→server:     $r4 (want closed)"; case "$r4" in closed:*) ;; *) fail=1 ;; esac
if [ "$fail" = 1 ]; then
  die "NetworkPolicy is NOT enforced as expected in $SRE_KIND_POLICY. Check: kubectl --context $SRE_CTX_POLICY -n kube-system get pods -l k8s-app=calico-node; see README.md troubleshooting."
fi
say "PASS enforcement self-test: deny and selective allow observed (Calico $CALICO_VERSION)"
