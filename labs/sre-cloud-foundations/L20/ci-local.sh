#!/usr/bin/env bash
# L20 local executable pipeline — the same stages as pipeline/workflows/beacon-ci.yml:
#   test → build → scan (labelled stub unless LOOPED_SCAN=trivy) → publish (digest captured)
#   → promote staging; prod promotion by record with --approve; rollback with a schema gate.
#   bash labs/sre-cloud-foundations/L20/ci-local.sh run
#   bash labs/sre-cloud-foundations/L20/ci-local.sh promote prod --from staging --approve "<name>"
#   bash labs/sre-cloud-foundations/L20/ci-local.sh rollback prod --to 1.4.0 --approve "<name>"
#   bash labs/sre-cloud-foundations/L20/ci-local.sh verify-tag 1.5.0 | status
# Needs Docker, git and the lab registry (setup.sh starts it). Touches only work/ and
# looped-l20-* images; never the cluster (the reconciler does that).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_workstation python3 git docker curl
require_compose_project "$L20_PROJECT"
[ -d "$WORK/app/.git" ] || die "work/app is not prepared; run setup.sh (or assets/prepare.sh) first"
l20_registry_up
exec python3 "$HERE/pipeline/ci_local.py" "$@"
