#!/usr/bin/env bash
# L13 fault injection. Restores work/ from starter/ for the files a variant
# touches, applies the variant, then builds and runs the lab image.
#   LOOPED_VARIANT=variant-a | variant-b | variant-c   (default variant-a)
# The validator reads work/.variant to label the evidence; it never prints the cause.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_compose_project looped-l13
WORK="$HERE/work"
[ -d "$WORK/beacon" ] || die "run setup.sh first"
V="${LOOPED_VARIANT:-${1:-variant-a}}"
case "$V" in variant-a|variant-b|variant-c) ;; *) die "unknown variant $V (variant-a | variant-b | variant-c)" ;; esac

cp "$HERE/starter/Dockerfile" "$WORK/Dockerfile"
cp "$HERE/starter/.dockerignore" "$WORK/.dockerignore"
cp "$HERE/starter/conf/beacon.yaml" "$WORK/conf/beacon.yaml"
printf '%s\n' "$V" > "$WORK/.variant"

case "$V" in
  variant-a)
    sed -i.bak 's/^  listen: 0\.0\.0\.0$/  listen: 127.0.0.1    # answer local callers only/' "$WORK/conf/beacon.yaml"
    rm -f "$WORK/conf/beacon.yaml.bak"
    bash "$HERE/rebuild.sh"
    ;;
  variant-b)
    cat >> "$WORK/.dockerignore" <<'IGN'
# generated or per-developer configuration
**/*.yaml
**/*.yml
IGN
    bash "$HERE/rebuild.sh"
    ;;
  variant-c)
    case "$(docker info --format '{{.Architecture}}')" in
      aarch64|arm64) OTHER=linux/amd64 ;;
      *) OTHER=linux/arm64 ;;
    esac
    info "building the handed-over image"
    docker build --quiet --platform "$OTHER" --label "$SRE_LABEL=L13" -t looped-l13-beacon:1.4.0 \
      -f "$HERE/assets/foreign/Dockerfile" "$WORK" >/dev/null
    bash "$HERE/rebuild.sh" --run-only
    ;;
esac
info "fault injected ($V). Start with: docker ps -a --filter label=$SRE_LABEL=L13"
