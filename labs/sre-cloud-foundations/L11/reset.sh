#!/usr/bin/env bash
# L11 reset: destroy what THIS workspace created (two files and a random id),
# keep a copy of your edited configuration in .work-previous/, recreate the
# workspace from starter/ and re-inject the same variant (or LOOPED_VARIANT).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_workstation terraform python3
WORK="$HERE/work"
PREV="$HERE/.work-previous"
V="$(cat "$WORK/.variant" 2>/dev/null || echo variant-a)"
if [ -d "$WORK" ]; then
  require_terraform_dir "$WORK"
  # destroy with the baseline inputs so an injected invalid tfvars cannot block it
  terraform -chdir="$WORK" destroy -input=false -auto-approve -no-color -var-file="$HERE/starter/terraform.tfvars" >/dev/null || warn "destroy reported an error; continuing with file removal inside work/ only"
  rm -rf "${PREV:?}"
  mkdir -p "$PREV"
  cp -R "$WORK"/*.tf "$WORK"/terraform.tfvars "$WORK"/tests "$PREV"/ 2>/dev/null || true
  rm -rf "${WORK:?}"
fi
LOOPED_VARIANT="${LOOPED_VARIANT:-$V}" bash "$HERE/setup.sh"
info "L11 reset to ${LOOPED_VARIANT:-$V}; your previous .tf files are in .work-previous/"
