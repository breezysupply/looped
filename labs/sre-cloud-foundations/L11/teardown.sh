#!/usr/bin/env bash
# L11 teardown: `terraform destroy` in this lab's workspace only, then remove
# work/ (configuration, state, provider cache). evidence/ stays.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_workstation terraform
WORK="$HERE/work"
PREV="$HERE/.work-previous"
if [ -d "$WORK" ]; then
  require_terraform_dir "$WORK"
  terraform -chdir="$WORK" destroy -input=false -auto-approve -no-color -var-file="$HERE/starter/terraform.tfvars" || warn "destroy failed; removing the workspace files anyway (they are local files only)"
  rm -rf "${WORK:?}"
fi
rm -rf "${PREV:?}"
info "L11 workspace removed (evidence/ kept)"
