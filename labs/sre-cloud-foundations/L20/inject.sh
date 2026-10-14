#!/usr/bin/env bash
# L20 fault injection, one step per checkpoint (README says when). The variant
# (LOOPED_VARIANT, remembered in work/.variant) changes the specifics of every step.
#   inject.sh gate              c1  a teammate's 1.5.0 commits land in work/app
#   inject.sh drift             c2  a manual change to beacon-staging in the cluster
#   inject.sh retag             c2  a build that never went through the pipeline appears under a tag
#   inject.sh rollback-request  c3  an urgent request to roll prod back
# Each step appends its ticket to work/TICKETS.md (what was reported, not why) and is recorded
# in work/.injected for the validator.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
STEP="${1:-gate}"
V="${LOOPED_VARIANT:-$(cat "$WORK/.variant" 2>/dev/null || echo variant-a)}"
case "$V" in variant-a|variant-b|variant-c) ;; *) die "unknown variant $V (variant-a | variant-b | variant-c)" ;; esac
T="$WORK/TICKETS.md"
APP="$WORK/app"
teammate() { git -C "$APP" -c user.name="Avery Teammate" -c user.email="avery@corp.lab" "$@"; }

case "$STEP" in
  gate)
    require_workstation git python3
    [ -d "$APP/.git" ] || die "work/app missing; run setup.sh"
    python3 - "$APP" <<'PY'
import json, sys
app = sys.argv[1]
rel = {"version": "1.5.0", "schema": {"min": 3, "max": 3},
       "migrations": ["0001_init.sql", "0002_status_index.sql", "0003_contract_status_text.sql"]}
json.dump(rel, open(app + "/release.json", "w"), indent=2)
open(app + "/release.json", "a").write("\n")
open(app + "/migrations/0003_contract_status_text.sql", "w").write(
    "-- Beacon schema 3 (CONTRACT): status_text is gone; 1.5.0 reads status only.\n"
    "-- Builds that still read status_text (schema <= 2) cannot run against schema 3.\n"
    "ALTER TABLE records DROP COLUMN status_text;\n")
PY
    teammate add -A
    teammate commit -q -m "Beacon 1.5.0: drop status_text (migration 0003, schema 3)"
    case "$V" in
      variant-a)
        l20_replace "$APP/beacon/store.py" 'WHERE idem_key = ?", (idem_key,)' 'WHERE idem_key = ? AND request_id = ?", (idem_key, record.get("request_id"))'
        msg="store: scope the idempotency lookup to the request" ;;
      variant-b)
        l20_replace "$APP/beacon/api.py" '            return "/status/{sensor}"' '            return path'
        msg="metrics: per-sensor route label so the dashboard can break down by sensor" ;;
      variant-c)
        l20_replace "$APP/beacon/config.py" '    if not isinstance(port, int) or isinstance(port, bool) or not (0 <= port <= 65535):' '    if not str(port).isdigit() or not (0 <= int(port) <= 65535):'
        msg="config: accept quoted ports from deployment values" ;;
    esac
    teammate add -A
    teammate commit -q -m "$msg"
    bad="$(git -C "$APP" rev-parse --short=12 HEAD)"
    printf '%s\n' "$V" > "$WORK/.variant"
    cat >> "$T" <<X

## CHG-4101 (c1) — Beacon 1.5.0 to staging
Beacon 1.5.0 is merged on \`main\` of work/app (two commits by Avery: \`git -C work/app log --oneline\`).
Run the pipeline (\`ci-local.sh run\`) and get 1.5.0 to staging. Nothing may reach staging unless
every gate passes, and the tests stay as they are.
X
    l20_mark gate "$bad"
    info "gate: teammate commits added to work/app (HEAD $bad)"
    ;;
  drift)
    require_kind_context "$SRE_CTX_BASIC" "$SRE_KIND_BASIC"
    case "$V" in
      variant-a) k_basic scale deployment/beacon-staging --replicas=0 >/dev/null ;;
      variant-b) k_basic set env deployment/beacon-staging BEACON_INJECT_DELAY_MS=750 >/dev/null ;;
      variant-c) k_basic set image deployment/beacon-staging api=looped-l20-beacon:hotfix-unreviewed >/dev/null ;;
    esac
    cat >> "$T" <<'X'

## INC-77 (c2) — staging changed overnight
On-call "quickly fixed" beacon-staging by hand during the night; nobody wrote down what they did.
Find the difference between the cluster and git, let the reconciler deal with it, and explain what
happens to a manual change under GitOps — and how a change that must survive should be made.
X
    l20_mark drift
    info "drift: beacon-staging changed by hand"
    ;;
  retag)
    require_compose_project "$L20_PROJECT"
    l20_registry_up
    stg="$WORK/gitops/promotions/staging.json"
    [ -f "$stg" ] || die "nothing promoted to staging yet"
    commit="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["commit"])' "$stg")"
    version="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$stg")"
    docker build --quiet --provenance=false --sbom=false -t "$L20_LOCAL:unreviewed" \
      --build-arg "BEACON_VERSION=$version" --build-arg BEACON_COMMIT=unreviewed-hotfix --build-arg SCHEMA_MIN=3 --build-arg SCHEMA_MAX=3 "$APP" >/dev/null
    case "$V" in
      variant-a)
        docker tag "$L20_LOCAL:unreviewed" "$L20_REGISTRY/looped-l20/beacon:$version"
        docker push -q "$L20_REGISTRY/looped-l20/beacon:$version" >/dev/null ;;
      variant-b)
        docker tag "$L20_LOCAL:unreviewed" "$L20_REGISTRY/looped-l20/beacon:sha-$commit"
        docker push -q "$L20_REGISTRY/looped-l20/beacon:sha-$commit" >/dev/null
        docker tag "$L20_LOCAL:unreviewed" "$L20_LOCAL:sha-$commit" ;;
      variant-c)
        docker tag "$L20_LOCAL:unreviewed" "$L20_LOCAL:sha-$commit" ;;
    esac
    cat >> "$T" <<X

## CHG-4102 (c2) — Beacon $version to prod
Staging has been fine for a day. The release manager asks you to promote $version to prod:
\`ci-local.sh promote prod --tag $version --approve "<your name>"\`. Prod must run exactly what
staging verified.
X
    l20_mark retag "$commit"
    info "retag: an unreviewed build now sits under a release tag"
    ;;
  rollback-request)
    require_workstation git
    cat >> "$T" <<'X'

## INC-81 (c3) — roll prod back to 1.4.0 now?
Customer reports since 1.5.0 reached prod mention "missing status text". On-call asks you to roll
prod back to 1.4.0 immediately: `ci-local.sh rollback prod --to 1.4.0 --approve "<your name>"`.
Decide what is safe, do it, and record the decision and your reasoning in your notes (Schema).
X
    l20_mark rollback-request
    info "rollback-request: ticket INC-81 written"
    ;;
  *) die "unknown step $STEP (gate | drift | retag | rollback-request)" ;;
esac
