#!/usr/bin/env bash
# End-to-end runner used to check the labs actually behave as documented.
# You do not need it to do the labs. For each lab:
#
#   inject.sh -> wait for and assert the expected symptom (<lab>/harness.sh)
#   -> verify.sh must FAIL -> solution/solve.sh -> poll verify.sh until PASS
#   -> reset.sh <NN> -> assert no labelled objects remain
#
#   labs/kind/harness/run-lab.sh 03          one lab
#   labs/kind/harness/run-lab.sh all         all ten, in order
#   labs/kind/harness/run-lab.sh 02 05 09    several
#
# It needs the lab cluster. Normally that is created by setup.sh first.
#
# LOOPED_HARNESS=1 (read ONLY by this file) is for the CI-like sandbox the labs
# were tested in, not for your Mac: if the cluster is absent it is created from
# a temporary copy of kind-config.yaml with two sandbox-only workarounds:
#   - kubeadmConfigPatches: KubeletConfiguration failCgroupV1: false
#     (that sandbox is a cgroup v1 host; macOS Docker VMs use cgroup v2)
#   - --image $LOOPED_HARNESS_NODE_IMAGE, a locally built node image whose
#     runc wrapper clamps negative oom_score_adj to 0 (that sandbox lacks
#     CAP_SYS_RESOURCE; Docker Desktop / colima VMs do not have this problem)
# and, because that sandbox's node containers cannot reach any registry (only
# the host's Docker daemon can, through a host-local proxy):
#   - kind create runs with the proxy variables unset, so the nodes do not
#     inherit a proxy address that is unreachable from inside them
#   - the two pinned lab images are copied into the nodes with
#     harness/preload-image.sh (skip with LOOPED_HARNESS_PRELOAD=0)
# The user-facing kind-config.yaml and scripts never read LOOPED_HARNESS.
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"

[ $# -ge 1 ] || die "usage: $0 <NN|all> [NN...]"
LOG_DIR="${LOOPED_HARNESS_LOG_DIR:-$(mktemp -d)}"
mkdir -p "$LOG_DIR"

ensure_cluster() {
  if kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
    "$KIND_DIR/setup.sh" || die "setup.sh failed"
    return
  fi
  if [ "${LOOPED_HARNESS:-0}" = 1 ]; then
    local tmp img
    img="${LOOPED_HARNESS_NODE_IMAGE:-looped-harness/kind-node:v1.37.0-oomclamp}"
    tmp=$(mktemp -d)
    cp "$KIND_DIR/kind-config.yaml" "$tmp/kind-config.yaml"
    cat >> "$tmp/kind-config.yaml" <<'YAML'
# --- harness-only (cgroup v1 sandbox host); not part of the user-facing config ---
kubeadmConfigPatches:
- |
  kind: KubeletConfiguration
  failCgroupV1: false
YAML
    info "HARNESS MODE: creating $CLUSTER with $tmp/kind-config.yaml and --image $img"
    env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy -u NO_PROXY -u no_proxy \
      kind create cluster --name "$CLUSTER" --config "$tmp/kind-config.yaml" --image "$img" --wait 240s \
      || die "kind create cluster failed (harness mode)"
    rm -rf "$tmp"
  fi
  if [ "${LOOPED_HARNESS:-0}" = 1 ] && [ "${LOOPED_HARNESS_PRELOAD:-1}" = 1 ]; then
    "$KIND_DIR/harness/preload-image.sh" "$BUSYBOX_IMAGE" "$CURL_IMAGE" || die "preload failed"
  fi
  "$KIND_DIR/setup.sh" || die "setup.sh failed"
}

now() { date +%s; }
SUMMARY=()

run_one() {
  local dir id name log t0 t1 t2 t3 out rc tries
  dir=$(lab_dir_for "$1") || { SUMMARY+=("$1 ERROR no such lab"); return 1; }
  id=$(lab_id_of "$dir"); name=$(basename "$dir"); log="$LOG_DIR/$name.log"
  info "LAB $name (log: $log)"
  (
    set -uo pipefail
    SYMPTOM_TIMEOUT=180; VERIFY_TIMEOUT=240
    symptom_check() { return 1; }
    symptom_evidence() { :; }
    # shellcheck disable=SC1090,SC1091
    . "$dir/harness.sh"

    say "--- [$(date -u +%H:%M:%S)] inject"
    t0=$(now)
    "$dir/inject.sh" || { say "HARNESS: inject.sh failed"; exit 11; }
    t1=$(now)
    say "--- [$(date -u +%H:%M:%S)] inject took $((t1 - t0))s; waiting up to ${SYMPTOM_TIMEOUT}s for the symptom"
    if wait_until "$SYMPTOM_TIMEOUT" "lab $id symptom" symptom_check; then
      t2=$(now); say "HARNESS: symptom observed $((t2 - t1))s after inject finished"
    else
      t2=$(now); say "HARNESS: symptom NOT observed within ${SYMPTOM_TIMEOUT}s"
      symptom_evidence; exit 12
    fi
    say "--- evidence"
    symptom_evidence
    say "--- verify.sh on the broken state (must FAIL)"
    out=$("$dir/verify.sh" 2>&1); rc=$?
    printf '%s\n(exit %s)\n' "$out" "$rc"
    [ "$rc" -ne 0 ] || { say "HARNESS: verify.sh PASSED on the broken state"; exit 13; }
    say "--- [$(date -u +%H:%M:%S)] solution/solve.sh"
    "$dir/solution/solve.sh" || { say "HARNESS: solve.sh failed"; exit 14; }
    t2=$(now); tries=0
    say "--- polling verify.sh (up to ${VERIFY_TIMEOUT}s)"
    while :; do
      tries=$((tries + 1))
      out=$("$dir/verify.sh" 2>&1); rc=$?
      [ "$rc" -eq 0 ] && break
      if [ $(( $(now) - t2 )) -ge "$VERIFY_TIMEOUT" ]; then
        printf '%s\n' "$out"; say "HARNESS: verify.sh still failing after ${VERIFY_TIMEOUT}s"; exit 15
      fi
      [ "$tries" -le 2 ] && printf '  (attempt %s) %s\n' "$tries" "$(printf '%s' "$out" | tr '\n' ' ')"
      sleep 5
    done
    t3=$(now)
    printf '%s\n(exit 0; %s attempt(s), %ss after solve.sh finished)\n' "$out" "$tries" "$((t3 - t2))"
    say "--- reset"
    "$KIND_DIR/reset.sh" "$id" || { say "HARNESS: reset.sh failed"; exit 16; }
    wait_until 120 "lab $id objects gone" lab_gone "$id" || { say "HARNESS: labelled objects remain"; exit 17; }
    say "HARNESS RESULT lab $id: symptom ok, verify FAIL before fix, PASS after fix, reset clean (total $(( $(now) - t0 ))s)"
  ) 2>&1 | tee "$log"
  rc=${PIPESTATUS[0]}
  if [ "$rc" -eq 0 ]; then SUMMARY+=("$name PASS"); else SUMMARY+=("$name FAILED (harness exit $rc)"); fi
  return 0
}

lab_gone() { [ "$(lab_leftovers "$1")" = 0 ]; }

ensure_cluster
preflight

LABS=()
if [ "$1" = all ]; then
  for d in "$KIND_DIR"/[0-9][0-9]-*/; do LABS+=("$(lab_id_of "${d%/}")"); done
else
  LABS=("$@")
fi
for l in "${LABS[@]}"; do run_one "$l"; done

say ""
say "==== harness summary ($(date -u +%Y-%m-%dT%H:%M:%SZ), logs in $LOG_DIR)"
for s in "${SUMMARY[@]}"; do say "  $s"; done
printf '%s\n' "${SUMMARY[@]}" | grep -qv ' PASS$' && exit 1
exit 0
