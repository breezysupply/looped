#!/usr/bin/env bash
# L20 reset: keep a bundle of your work/app and work/gitops history in .work-previous/, run
# teardown.sh (cluster objects, registry, images, work/), then setup.sh again for the same
# variant (or LOOPED_VARIANT). evidence/ is kept.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_kind_context "$SRE_CTX_BASIC" "$SRE_KIND_BASIC"
V="$(cat "$WORK/.variant" 2>/dev/null || echo variant-a)"
PREV_KEEP="$(mktemp -d)"
for repo in app gitops; do
  if [ -d "$WORK/$repo/.git" ]; then git -C "$WORK/$repo" bundle create "$PREV_KEEP/$repo.bundle" --all >/dev/null 2>&1 || true; fi
done
bash "$HERE/teardown.sh"
mkdir -p "$HERE/.work-previous"
cp "$PREV_KEEP"/*.bundle "$HERE/.work-previous/" 2>/dev/null || true
rm -rf "${PREV_KEEP:?}"
LOOPED_VARIANT="${LOOPED_VARIANT:-$V}" bash "$HERE/setup.sh"
info "L20 reset to ${LOOPED_VARIANT:-$V}; your previous history is in .work-previous/*.bundle (git clone it to read)"
