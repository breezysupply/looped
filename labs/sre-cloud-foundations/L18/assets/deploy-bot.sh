#!/usr/bin/env bash
# What the deploy bot does on every release, run AS its ServiceAccount (impersonation: the API
# server authorises each request as system:serviceaccount:beacon:beacon-deployer). Stops at the
# first refused step, like the real bot. Output goes to stdout; setup.sh saves one run to
# work/deploy-bot.log.
#   bash labs/sre-cloud-foundations/L18/assets/deploy-bot.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_kind_context "$SRE_CTX_POLICY" "$SRE_KIND_POLICY"
AS=(--as "$L18_SA")
step() { printf '[deploy-bot] %s\n' "$1"; }
step "1/4 read deployment";      k_policy "${AS[@]}" get deployment beacon-api -o name
step "2/4 record release";       k_policy "${AS[@]}" annotate --overwrite deployment/beacon-api "looped.lab/release-check=$(date -u +%Y%m%dT%H%M%SZ)"
step "3/4 wait for rollout";     k_policy "${AS[@]}" rollout status deployment/beacon-api --timeout=60s
step "4/4 read new pods' logs";  k_policy "${AS[@]}" logs deployment/beacon-api --tail=1
step "release run complete"
