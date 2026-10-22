#!/usr/bin/env bash
# Real Terraform checks on every reference and alternative in this package:
# fmt -check, init -backend=false, validate. Starters (guided/scaffolded/
# *-start) contain TODOs on purpose and are only fmt-checked.
#
# Needs the terraform CLI, and network access to registry.terraform.io the
# first time (to download hashicorp/aws). Needs NO AWS credentials and never
# runs plan or apply: validate checks configuration against the provider
# schema; it does not prove AWS will accept it or that traffic flows.
set -u
here=$(cd "$(dirname "$0")" && pwd)
command -v terraform >/dev/null 2>&1 || { echo "terraform is not installed: https://developer.hashicorp.com/terraform/install" >&2; exit 2; }
export TF_PLUGIN_CACHE_DIR="${TF_PLUGIN_CACHE_DIR:-$here/.plugin-cache}"
mkdir -p "$TF_PLUGIN_CACHE_DIR"
fail=0
for dir in "$here"/*/*/; do
  ls "$dir"*.tf >/dev/null 2>&1 || continue
  rel=${dir#"$here"/}
  case "$rel" in
    */guided/|*/scaffolded/|*-start/)
      if terraform -chdir="$dir" fmt -check >/dev/null 2>&1; then printf 'FMT   %s (starter: fmt only)\n' "$rel"; else printf 'FAIL  %s fmt\n' "$rel"; fail=1; fi
      continue ;;
  esac
  out=$( { terraform -chdir="$dir" fmt -check &&
           terraform -chdir="$dir" init -backend=false -input=false -no-color >/dev/null &&
           terraform -chdir="$dir" validate -no-color; } 2>&1 )
  if [ $? -eq 0 ]; then printf 'PASS  %s\n' "$rel"; else printf 'FAIL  %s\n%s\n' "$rel" "$out"; fail=1; fi
done
printf '\n%s; hashicorp/aws %s\n' "$(terraform version | head -1)" "$(ls "$TF_PLUGIN_CACHE_DIR"/registry.terraform.io/hashicorp/aws 2>/dev/null | tail -1)"
exit $fail
