#!/usr/bin/env bash
# Build the beacon-report image from work/patch/report/ and run its tests.
#   bash labs/sre-cloud-foundations/L25/assets/build-report.sh <tag>     e.g. patched
# 1. pip download the exact wheels the lock names, hash-checked, for your
#    engine's architecture (this is the one step that needs PyPI);
# 2. docker build looped-l25-report:<tag> with the lock's sha256 as a label;
# 3. run the unit tests inside the new image with networking disabled.
# Touches only work/patch/report/wheels/ and the image looped-l25-report:<tag>.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_compose_project "$L25_PROJECT"
l25_guard
TAG="${1:-patched}"
case "$TAG" in baseline|patched|[a-z0-9]*) ;; *) die "tag must be a simple lower-case word" ;; esac
APP="$WORK/patch/report"
[ -f "$APP/requirements.txt" ] || die "no $APP/requirements.txt; run setup.sh first"

arch="$(docker info --format '{{.Architecture}}' 2>/dev/null || uname -m)"
case "$arch" in aarch64|arm64) plat=manylinux2014_aarch64 ;; x86_64|amd64) plat=manylinux2014_x86_64 ;; *) die "unsupported engine architecture $arch" ;; esac
WH="$APP/wheels"
rm -rf "${WH:?}"
mkdir -p "$WH"
info "fetching hash-pinned wheels for $plat (CPython 3.12)"
python3 -m pip download --quiet --disable-pip-version-check --no-deps --only-binary=:all: \
  --python-version 3.12 --implementation cp --platform "$plat" \
  -d "$WH" -r "$APP/requirements.txt" \
  || die "pip download failed: a pin or a --hash does not match PyPI, or no network (see README: Troubleshooting)"
sha="$(python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$APP/requirements.txt")"
info "building looped-l25-report:$TAG (lock sha256 ${sha:0:12})"
docker build --quiet --label looped.lab/id=L25 --build-arg "REQUIREMENTS_SHA256=$sha" -t "looped-l25-report:$TAG" "$APP" >/dev/null
info "installed packages in looped-l25-report:$TAG"
docker run --rm --network none --entrypoint python3 "looped-l25-report:$TAG" -c \
  'import importlib.metadata as m; print("  " + ", ".join(sorted(d.metadata["Name"].lower() + "==" + d.version for d in m.distributions() if d.metadata["Name"].lower() != "pip")))'
info "unit tests inside the image (no network)"
docker run --rm --network none --entrypoint python3 "looped-l25-report:$TAG" -m unittest discover -s tests -t . 2>&1 | tail -3
