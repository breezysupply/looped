#!/usr/bin/env bash
# L11 setup: copy starter/ to the workspace work/, `terraform init` against
# the committed lockfile (read-only), apply the baseline dev configuration,
# record the baseline deploy id, then inject the chosen variant.
# Local providers only (hashicorp/local, hashicorp/random); state stays in
# work/terraform.tfstate. Idempotent: an existing work/ is reused as is.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_workstation terraform python3
WORK="$HERE/work"
EV="$(evidence_dir "$HERE")"

if [ -d "$WORK" ]; then
  info "work/ exists; reusing it (reset.sh starts over)"
  require_terraform_dir "$WORK"
  exit 0
fi
cp -R "$HERE/starter" "$WORK"
require_terraform_dir "$WORK"
export TF_IN_AUTOMATION=1
info "terraform init (providers pinned by work/.terraform.lock.hcl)"
terraform -chdir="$WORK" init -input=false -lockfile=readonly -no-color >/dev/null
info "baseline apply (dev)"
terraform -chdir="$WORK" apply -input=false -auto-approve -no-color >/dev/null
python3 - "$WORK" <<'PY'
import json, subprocess, sys
work = sys.argv[1]
out = json.loads(subprocess.run(["terraform", "-chdir=" + work, "output", "-json"], capture_output=True, text=True, check=True).stdout)
base = {"deploy_id": out["deploy_id"]["value"], "config_sha256": out["config_sha256"]["value"], "config_path": out["config_path"]["value"]}
with open(work + "/.l11-baseline.json", "w", encoding="utf-8") as fh:
    json.dump(base, fh, indent=2)
print("baseline deploy_id " + base["deploy_id"])
PY
{
  echo "# L11 tool inventory — $(date -u +%FT%TZ)"
  record_versions
} > "$EV/L11-tools.txt"
[ -f "$EV/L11-notes.md" ] || cp "$HERE/assets/notes-template.md" "$EV/L11-notes.md"
bash "$HERE/inject.sh"
say ""
say "L11 ready. Work in $WORK:"
say "  terraform -chdir=$WORK plan"
