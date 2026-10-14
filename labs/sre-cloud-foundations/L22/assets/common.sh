# shellcheck shell=bash
# L22 helpers, sourced by setup/inject/reset/teardown after HERE is set.
# Fixture-only lab: files under work/ and short-lived promtool containers
# (named looped-l22-promtool-*, removed on exit, no network).
. "$HERE/../lib/looped.sh"

# Pinned Prometheus image (promtool ships in it). If Docker Hub rate-limits you,
# the same release is published as quay.io/prometheus/prometheus:v3.5.0:
#   export LOOPED_PROM_IMAGE=quay.io/prometheus/prometheus:v3.5.0
L22_PROM_IMAGE="${LOOPED_PROM_IMAGE:-prom/prometheus:v3.5.0}"
WORK="$HERE/work"

l22_guard() {
  require_workstation docker python3
  docker info >/dev/null 2>&1 || die "Docker is not reachable (promtool runs in the pinned Prometheus image)"
}
l22_variant() { cat "$WORK/.variant" 2>/dev/null || echo "${LOOPED_VARIANT:-variant-a}"; }

# promtool against work/ (mounted read-only at /w): l22_promtool test rules /w/tests/beacon-slo.test.yml
l22_promtool() {
  docker run --rm --network none --name "looped-l22-promtool-$$" -v "$WORK:/w:ro" --entrypoint promtool "$L22_PROM_IMAGE" "$@"
}
