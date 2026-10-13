#!/usr/bin/env bash
# L12 teardown: `terraform destroy` in staging then dev (this lab's local
# states only); if a protected volume blocks destroy, drop it from state and
# remove it by its exact looped-l12-* name. Then remove any remaining
# looped-l12-* container/network/volume (e.g. hand-made ones from inject.sh)
# and the workspace. Nothing without the looped-l12- prefix is touched; the
# shared base image is kept (keep_locally = true).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/assets/common.sh"
l12_guard
PREV="$HERE/.work-previous"

for env in staging dev; do
  d="$WORK/envs/$env"
  [ -f "$d/terraform.tfstate" ] || continue
  info "terraform destroy ($env)"
  if ! l12_tf "$d" destroy -input=false -auto-approve -no-color >/dev/null 2>&1; then
    warn "$env destroy refused (prevent_destroy on the data volume?); removing protected volumes from state and destroying the rest"
    for addr in $(l12_tf "$d" state list 2>/dev/null | grep -E '(^|\.)docker_volume\.' || true); do
      l12_tf "$d" state rm "$addr" >/dev/null
    done
    l12_tf "$d" destroy -input=false -auto-approve -no-color >/dev/null 2>&1 || warn "$env destroy still failed; falling back to name-scoped removal"
  fi
done

for c in $(l12_list container); do l12_rm container "$c"; done
for n in $(l12_list network); do l12_rm network "$n"; done
for v in $(l12_list volume); do l12_rm volume "$v"; done

[ -d "$WORK" ] && rm -rf "${WORK:?}"
[ "${LOOPED_KEEP_PREVIOUS:-0}" = 1 ] || rm -rf "${PREV:?}"
left="$(l12_list container; l12_list volume; l12_list network)"
[ -z "$left" ] || die "still present: $left"
info "L12 removed: no looped-l12-* objects remain; evidence/ kept"
