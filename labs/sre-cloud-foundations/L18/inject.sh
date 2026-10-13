#!/usr/bin/env bash
# L18 fault injection: edits work/manifests/20-rbac.yaml and work/manifests/30-netpol.yaml for
# the chosen variant and writes work/TICKETS.md. setup.sh applies the RBAC file; the policy file
# is applied by you in checkpoint c2, which is when its fault appears. Variants (LOOPED_VARIANT):
#   variant-a | variant-b | variant-c   — each changes one RBAC rule and one policy rule
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_workstation python3
[ -d "$WM" ] || die "work/manifests missing; run setup.sh"
V="${LOOPED_VARIANT:-${1:-variant-a}}"
DNS_POLICY=$'---\napiVersion: networking.k8s.io/v1\nkind: NetworkPolicy\nmetadata: {name: allow-dns-egress, namespace: beacon, labels: {looped.lab/id: L18}}\nspec:\n  podSelector: {}\n  policyTypes: ["Egress"]\n  egress:\n    - to:\n        - namespaceSelector:\n            matchLabels: {kubernetes.io/metadata.name: kube-system}\n          podSelector:\n            matchLabels: {k8s-app: kube-dns}\n      ports:\n        - {protocol: UDP, port: 53}\n        - {protocol: TCP, port: 53}\n'
case "$V" in
  variant-a)
    l18_edit 20-rbac.yaml 'verbs: ["get", "list", "watch", "patch"]' 'verbs: ["get", "list", "watch"]'
    l18_edit 30-netpol.yaml "$DNS_POLICY" ''
    ;;
  variant-b)
    l18_edit 20-rbac.yaml 'verbs: ["get", "list", "watch", "patch"]' 'verbs: ["get", "list", "patch"]'
    l18_edit 30-netpol.yaml 'matchLabels: {kubernetes.io/metadata.name: kube-system}' 'matchLabels: {name: kube-system}'
    ;;
  variant-c)
    l18_edit 20-rbac.yaml $'resources: ["pods"]\n    verbs: ["get", "list", "watch"]' $'resources: ["pods"]\n    verbs: ["get", "watch"]'
    l18_edit 30-netpol.yaml $'        - podSelector:\n            matchLabels: {app: beacon-api}' $'        - podSelector:\n            matchLabels: {app: api}'
    ;;
  *) die "unknown variant $V (variant-a | variant-b | variant-c)" ;;
esac
cat > "$WORK/TICKETS.md" <<'T'
# L18 tickets

## BEACON-OPS-1401 (c1) — deploy bot fails during the release run
The deploy bot (ServiceAccount `beacon-deployer` in namespace `beacon`) stopped part-way through
today's release run; its log is `work/deploy-bot.log` and you can re-run it with
`assets/deploy-bot.sh`. Give it exactly what its four steps need, in this namespace only, and
prove both what it can do and what it still cannot (delete workloads, read Secrets, exec into
pods, change RBAC, touch other namespaces or the cluster).

## SEC-212 (c2) — default-deny segmentation for namespace beacon
Security review requires default-deny for `beacon`. A teammate prepared
`work/manifests/30-netpol.yaml`. Apply it and prove, from inside the real pods
(`assets/netcheck.sh`): the API resolves and reaches PostgreSQL; nothing else reaches the
database; the API reaches nothing else. A policy that applied cleanly proves nothing.
T
printf '%s\n' "$V" > "$WORK/.variant"
info "variant $V prepared in work/manifests; tickets in $WORK/TICKETS.md"
