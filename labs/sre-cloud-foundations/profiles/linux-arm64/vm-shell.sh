#!/usr/bin/env bash
# Shell into the course VM at the repository root.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../../lib/looped.sh"
exec limactl shell --workdir "$(cd "$HERE/../../../.." && pwd)" "$SRE_VM" "$@"
