#!/usr/bin/env bash
# L17 fault injection. Each fault is separate and resettable; run them in checkpoint order
# (README) or pick one. Edits the matching file in work/manifests and applies it, then appends
# the ticket to work/TICKETS.md (what was reported, not why).
#   variant-a  c1  a change to the API Deployment's resources
#   variant-b  c2  a "right-sizing" change to beacon-report
#   variant-c  c3  the database rebuilt from another cluster's manifest (data volume replaced)
#   variant-d  independent variant: a capacity-planning change to the database
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_kind_context "$SRE_CTX_BASIC" "$SRE_KIND_BASIC"
[ -d "$WM" ] || die "work/manifests missing; run setup.sh first"
V="${LOOPED_VARIANT:-${1:-variant-a}}"
T="$WORK/TICKETS.md"
case "$V" in
  variant-a)
    l17_edit 10-api.yaml 'requests: {cpu: 100m, memory: 64Mi}' 'requests: {cpu: "64", memory: 64Mi}'
    l17_apply 10-api.yaml
    cat >> "$T" <<'X'

## BEACON-OPS-1301 (c1) — beacon-api rollout not finishing
A routine resource change to beacon-api (work/manifests/10-api.yaml) was applied this morning.
`kubectl rollout status deploy/beacon-api` has been waiting ever since. Users report no errors
yet. Find out why, restore a finished rollout without over-provisioning, and record the evidence
that told you.
X
    ;;
  variant-b)
    l17_edit 20-report.yaml $'requests: {cpu: 50m, memory: 128Mi}\n            limits: {memory: 160Mi}' $'requests: {cpu: 50m, memory: 48Mi}\n            limits: {memory: 64Mi}'
    l17_apply 20-report.yaml
    cat >> "$T" <<'X'

## BEACON-OPS-1302 (c2) — beacon-report keeps restarting
Since the cost clean-up change (work/manifests/20-report.yaml, "right-size from the dashboard
average"), beacon-report restarts every minute or so and no reports are produced. The report's
96 MiB cache is a product requirement. Restore it without giving it unbounded memory.
X
    ;;
  variant-c)
    l17_edit 30-db.yaml 'storageClassName: standard' 'storageClassName: fast-ssd'
    k_basic delete statefulset beacon-db --wait=true >/dev/null
    k_basic delete pvc data-beacon-db-0 --ignore-not-found --wait=true >/dev/null
    l17_apply 30-db.yaml
    cat >> "$T" <<'X'

## BEACON-OPS-1303 (c3) — database did not come back after a rebuild
A teammate rebuilt beacon-db from the manifest used on the team's other cluster
(work/manifests/30-db.yaml). The old volume is gone. The database has not come back. The
last good copy of the data is the known dataset (assets/dataset.sql): bring the database back on
this cluster's storage, restore the dataset and PROVE it is complete.
X
    ;;
  variant-d)
    l17_edit 30-db.yaml $'requests: {cpu: 100m, memory: 128Mi}\n            limits: {memory: 512Mi}' $'requests: {cpu: 100m, memory: 64Gi}\n            limits: {memory: 64Gi}'
    l17_apply 30-db.yaml
    cat >> "$T" <<'X'

## BEACON-OPS-1304 (independent) — database down after a capacity-planning change
The capacity-planning change to beacon-db (work/manifests/30-db.yaml) was applied an hour ago.
Since then the API cannot reach the database. Restore it with its data intact and bounded
resources; prove the data with the checksum.
X
    ;;
  *) die "unknown variant $V (variant-a | variant-b | variant-c | variant-d)" ;;
esac
l17_mark "$V"
info "variant $V injected; read $T"
