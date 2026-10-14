#!/usr/bin/env bash
# L31 variation: write release/rebuild.env for the variant — a new namespace, cluster and
# configuration values — from the colleague's draft, which carries one hidden prerequisite
# (something that only works because an earlier lab left it behind). Your previous file is
# kept as release/rebuild.env.bak.
#   LOOPED_VARIANT=variant-a | variant-b | variant-c   (default variant-a)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_workstation python3
V="${LOOPED_VARIANT:-${1:-variant-a}}"
case "$V" in variant-a|variant-b|variant-c) ;; *) die "unknown variant $V (variant-a | variant-b | variant-c)" ;; esac
REL="$HERE/release"
mkdir -p "$REL" "$HERE/work"
[ -f "$REL/rebuild.env" ] && cp "$REL/rebuild.env" "$REL/rebuild.env.bak"
cp "$HERE/assets/variants/$V.env" "$REL/rebuild.env"
printf '%s\n' "$V" > "$HERE/work/.variant"
info "release/rebuild.env written from the colleague's draft ($V). Next: bash $HERE/rebuild.sh check"
