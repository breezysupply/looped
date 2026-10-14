#!/usr/bin/env bash
# L31 teardown: delete the rebuilt namespace (rebuild.sh down: L31-labelled namespace only),
# the L31 image (label looped.lab/id=L31) and work/. Your release/ bundle and evidence/ stay.
# The kind clusters themselves belong to their profiles' teardown scripts.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_workstation python3
if python3 "$HERE/assets/capstone.py" env >/dev/null 2>&1; then
  cl="$(python3 "$HERE/assets/capstone.py" env | sed -n 's/^CLUSTER=//p')"
  if command -v kind >/dev/null 2>&1 && kind get clusters 2>/dev/null | grep -qx "$cl"; then
    bash "$HERE/rebuild.sh" down
  fi
fi
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  imgs="$(docker images -q --filter "label=$SRE_LABEL=L31" | sort -u)"
  [ -z "$imgs" ] || docker rmi -f $imgs >/dev/null
fi
WORK="$HERE/work"
[ -d "$WORK" ] && rm -rf "${WORK:?}"
info "L31 removed: namespace (if present), L31 image, work/. release/ and evidence/ kept."
