#!/usr/bin/env bash
# L11 fault injection, applied to the workspace AFTER the baseline apply.
#   LOOPED_VARIANT=variant-a | variant-b | variant-c   (default variant-a)
# The validator reads work/.variant to label evidence; nothing prints the cause.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_workstation terraform
WORK="$HERE/work"
require_terraform_dir "$WORK"
[ -f "$WORK/terraform.tfstate" ] || die "no baseline state; run setup.sh first"
V="${LOOPED_VARIANT:-${1:-variant-a}}"
case "$V" in variant-a|variant-b|variant-c) ;; *) die "unknown variant $V (variant-a | variant-b | variant-c)" ;; esac

case "$V" in
  variant-a)
    cat > "$WORK/terraform.tfvars" <<'TFV'
# Beacon dev configuration (this workspace = this environment).
# 2026-10-12: switch to the standard HTTP port and the new env naming (ops chat)
environment = "Dev"
listen_port = 80
app_version = "1.4.0"
store_kind  = "sqlite"
store_path  = "/var/lib/beacon/beacon.db"
TFV
    ;;
  variant-b)
    cat > "$WORK/terraform.tfvars" <<'TFV'
# Beacon dev configuration (this workspace = this environment).
# 2026-10-12: staging rollout needs a config too
environment = "staging"
listen_port = 8080
app_version = "1.4.0"
store_kind  = "sqlite"
store_path  = "/var/lib/beacon/beacon.db"
TFV
    ;;
  variant-c)
    # an out-of-band cleanup removed the generated config file
    rm -f "$WORK/out/dev/beacon.yaml"
    ;;
esac
printf '%s\n' "$V" > "$WORK/.variant"
info "variant $V applied to the workspace. Start with: terraform -chdir=$WORK plan"
