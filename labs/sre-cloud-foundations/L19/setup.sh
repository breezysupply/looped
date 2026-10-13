#!/usr/bin/env bash
# L19 setup: build the two Beacon builds this lab ships (looped-l19-beacon:1.4.0 and :1.5.0),
# load them into the kind cluster looped-foundations, copy the chart to work/chart (yours to
# edit; chart/ stays the reference), make sure PyYAML is importable for the render assertions,
# record tool versions, then inject.sh writes the change ticket for the chosen variant.
# Idempotent; does not install the release (that is your first task).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_kind_context "$SRE_CTX_BASIC" "$SRE_KIND_BASIC"
require_workstation helm docker python3 kind tar
docker info >/dev/null 2>&1 || die "Docker is not reachable"

kc_basic apply -f - >/dev/null <<NS
apiVersion: v1
kind: Namespace
metadata:
  name: $SRE_NS
NS
others="$(k_basic get deploy,statefulset -o jsonpath='{range .items[*]}{.kind}/{.metadata.name}={.metadata.labels.looped\.lab/id}{"\n"}{end}' 2>/dev/null | grep -v '=L19$' || true)"
[ -z "$others" ] || warn "namespace $SRE_NS also holds objects from other labs: $(echo "$others" | tr '\n' ' ')— they do not affect L19, but their teardown.sh frees memory."
case "$(l19_release_state)" in
  foreign) die "a Helm release named $L19_RELEASE exists in $SRE_NS and is not this lab's; uninstall it with the lab that created it" ;;
  ours) info "release $L19_RELEASE (L19) already installed; keeping it (reset.sh starts over)" ;;
  *) : ;;
esac

if ! l19_python >/dev/null; then
  info "PyYAML not importable; creating $HERE/.venv with PyYAML 6.0.2 for the render assertions"
  python3 -m venv "$HERE/.venv"
  "$HERE/.venv/bin/python" -m pip install --quiet --disable-pip-version-check PyYAML==6.0.2 || die "pip install PyYAML failed (network?)"
fi

BUILD="$WORK/build"
mkdir -p "$WORK"
rm -rf "${BUILD:?}"
mkdir -p "$BUILD"
tar -C "$SRE_BEACON" --exclude=__pycache__ -cf - beacon beacon.yaml | tar -C "$BUILD" -xf -
for v in $L19_VERSIONS; do
  info "building $L19_IMAGE:$v"
  docker build --quiet --provenance=false --build-arg "BEACON_VERSION=$v" -t "$L19_IMAGE:$v" -f "$HERE/assets/Dockerfile" "$BUILD" >/dev/null
done
info "loading both builds into kind cluster $SRE_KIND_BASIC"
for v in $L19_VERSIONS; do kind load docker-image "$L19_IMAGE:$v" --name "$SRE_KIND_BASIC" >/dev/null; done

if [ -d "$WORK/chart" ]; then
  info "work/chart exists; keeping your edits"
else
  cp -R "$HERE/chart" "$WORK/chart"
fi
EV="$(evidence_dir "$HERE")"
{
  echo "# L19 tool inventory — $(date -u +%FT%TZ)"
  record_versions
  for v in $L19_VERSIONS; do echo "image $L19_IMAGE:$v id $(docker image inspect -f '{{.Id}}' "$L19_IMAGE:$v")"; done
} > "$EV/L19-tools.txt"
cat "$EV/L19-tools.txt"
[ -f "$EV/L19-notes.md" ] || cp "$HERE/assets/notes-template.md" "$EV/L19-notes.md"
if [ -f "$WORK/TICKET.md" ]; then
  info "ticket already written ($(cat "$WORK/.variant" 2>/dev/null)); reset.sh changes it"
else
  LOOPED_VARIANT="${LOOPED_VARIANT:-variant-a}" bash "$HERE/inject.sh"
fi
say ""
say "L19 ready. Start with checkpoint c1 in README.md:"
say "  helm lint $WORK/chart -f $WORK/chart/values-staging.yaml"
say "  $(l19_python) $HERE/assets/render_assert.py $WORK/chart"
