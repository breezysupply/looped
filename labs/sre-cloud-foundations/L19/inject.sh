#!/usr/bin/env bash
# L19 fault injection: writes the change request for checkpoint c2 (work/TICKET.md and
# work/change/values-1.5.0.yaml). Nothing is applied to the cluster; the fault surfaces when the
# change is rendered or rolled out. Variants (LOOPED_VARIANT):
#   variant-a  the change values carry a value of the wrong type
#   variant-b  the change values name an image version that was never built
#   variant-c  the change values name an image location the cluster cannot pull from
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_workstation helm
V="${LOOPED_VARIANT:-${1:-variant-a}}"
case "$V" in variant-a|variant-b|variant-c) ;; *) die "unknown variant $V (variant-a | variant-b | variant-c)" ;; esac
mkdir -p "$WORK/change"
CHG="$WORK/change/values-1.5.0.yaml"
case "$V" in
  variant-a)
    cat > "$CHG" <<'Y'
# CHG-3104 (approved): Beacon 1.5.0 to staging, with more memory headroom for the new build.
image:
  repository: looped-l19-beacon
  tag: "1.5.0"
  pullPolicy: IfNotPresent
resources:
  requests:
    cpu: 50m
    memory: 64Mi
  limits:
    memory: 192
Y
    ;;
  variant-b)
    cat > "$CHG" <<'Y'
# CHG-3104 (approved): Beacon 1.5 line to staging (build from the release notes: 1.5.1).
image:
  repository: looped-l19-beacon
  tag: "1.5.1"
  pullPolicy: IfNotPresent
Y
    ;;
  variant-c)
    cat > "$CHG" <<'Y'
# CHG-3104 (approved): Beacon 1.5.0 to staging, pulled from the team registry.
image:
  repository: registry.lab/beacon
  tag: "1.5.0"
  pullPolicy: IfNotPresent
Y
    ;;
esac
cat > "$WORK/TICKET.md" <<'T'
# CHG-3104 — Beacon 1.5.0 to staging (approved)

Upgrade the `beacon` release in namespace `beacon` (cluster looped-foundations) to Beacon 1.5.0
using the approved change values in `work/change/values-1.5.0.yaml`, on top of
`work/chart/values-staging.yaml`. Staging must keep serving throughout. If the change does not
go cleanly, restore service first, then correct the change and apply it again.

Before closing: prove rollback works (roll back to the last 1.4.0 revision and show it serving,
then return to 1.5.0), and attach `helm history`, the smoke test result and your notes.
T
printf '%s\n' "$V" > "$WORK/.variant"
info "variant $V: ticket written to $WORK/TICKET.md"
