#!/usr/bin/env bash
# Runs the real Terraform checks on every reference, alternative and broken
# configuration in this package: fmt -check, init -backend=false, validate.
#
# This needs the terraform CLI and network access to registry.terraform.io
# the first time (to download the AWS provider). It does NOT need AWS
# credentials and does NOT run plan or apply: validate checks the
# configuration against the provider schema, nothing more.
#
# Usage: ./validate-all.sh            (from this directory)
set -u
here=$(cd "$(dirname "$0")" && pwd)
command -v terraform >/dev/null 2>&1 || { echo "terraform is not installed (brew install terraform, or see developer.hashicorp.com/terraform/install)" >&2; exit 2; }
export TF_PLUGIN_CACHE_DIR="${TF_PLUGIN_CACHE_DIR:-$here/.plugin-cache}"
mkdir -p "$TF_PLUGIN_CACHE_DIR"
fail=0
for dir in "$here"/[TM]*/*/ "$here"/T*/variant-*/*/; do
  [ -d "$dir" ] || continue
  ls "$dir"*.tf >/dev/null 2>&1 || continue
  rel=${dir#"$here"/}
  # starters are empty on purpose
  case "$rel" in */starter/) continue ;; esac
  if ! grep -q 'resource' "$dir"*.tf; then continue; fi
  out=$( { terraform -chdir="$dir" fmt -check &&
           terraform -chdir="$dir" init -backend=false -input=false -no-color >/dev/null &&
           terraform -chdir="$dir" validate -no-color; } 2>&1 )
  if [ $? -eq 0 ]; then
    printf 'PASS  %s\n' "$rel"
  else
    printf 'FAIL  %s\n%s\n' "$rel" "$out"
    fail=1
  fi
done
version=$(terraform version | head -1)
provider=$(ls "$TF_PLUGIN_CACHE_DIR"/registry.terraform.io/hashicorp/aws 2>/dev/null | tail -1)
printf '\n%s; hashicorp/aws %s\n' "$version" "${provider:-unknown}"
exit $fail
