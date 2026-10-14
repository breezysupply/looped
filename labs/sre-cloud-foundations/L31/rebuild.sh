#!/usr/bin/env bash
# L31 rebuild orchestrator: the complete core Beacon deployment from checked-in artifacts.
#
#   bash rebuild.sh check            fresh-checkout dry check (no cluster, no Docker, no network)
#   bash rebuild.sh image            build the L13 image from its sources, record its ID, kind load
#   bash rebuild.sh deploy           namespace, secrets, PostgreSQL, Redis, worker, L18 RBAC and
#                                    NetworkPolicies, L19 chart (helm upgrade --install)
#   bash rebuild.sh seed             deterministic synthetic records (assets/seed.sql)
#   bash rebuild.sh verify           live checks (health, image identity, least privilege, data, metrics)
#   bash rebuild.sh backup           pg_dump -Fc into work/backups/
#   bash rebuild.sh restore-drill    restore the latest backup into a scratch database, compare with
#                                    L24's verify_restore.py, drop the scratch database
#   bash rebuild.sh rollback-drill   helm upgrade with a degrading config change, then helm rollback
#   bash rebuild.sh slo              promtool check + test of the SLO rules in the release bundle
#   bash rebuild.sh all              every step above in order; appended to work/proof/runs.jsonl
#   bash rebuild.sh down             helm uninstall + delete ONLY the L31-labelled namespace
#   bash rebuild.sh proof            down (if present), then all: the teardown/rebuild proof
#
# Configuration comes only from release/rebuild.env (or L31_RELEASE=DIR); unknown keys and unknown
# L31_* environment variables are refused. Every cluster command names --context kind-<CLUSTER>
# and -n <NAMESPACE> after require_kind_context has checked the cluster is a local looped-* kind.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
REPO="$(cd "$SRE_ROOT/../.." && pwd)"
REL="${L31_RELEASE:-$HERE/release}"
WORK="$HERE/work"
CMD="${1:-}"
CAP="$HERE/assets/capstone.py"
command -v python3 >/dev/null 2>&1 || die "python3 not found"

case "$CMD" in
  check)
    require_workstation python3
    info "fresh-checkout dry check of $REL (no cluster, no Docker)"
    python3 "$CAP" check --release "$REL"
    exit $?
    ;;
  image|deploy|seed|verify|backup|restore-drill|rollback-drill|slo|all|down|proof) ;;
  *) die "usage: rebuild.sh check|image|deploy|seed|verify|backup|restore-drill|rollback-drill|slo|all|down|proof" ;;
esac

# validated configuration (capstone.py refuses unknown keys/variables and bad values)
CFG="$(python3 "$CAP" env --release "$REL")" || die "release/rebuild.env rejected (see above)"
while IFS='=' read -r k v; do printf -v "$k" '%s' "$v"; done <<<"$CFG"
CTX="kind-$CLUSTER"
IMAGE="$IMAGE_REPO:$IMAGE_TAG"
FULLNAME="$(python3 -c 'import sys; sys.path.insert(0, sys.argv[1]); import capstone; print(capstone.fullname(sys.argv[2]))' "$HERE/assets" "$RELEASE")"
mkdir -p "$WORK/proof" "$WORK/rendered" "$WORK/backups"
K()  { kubectl --context "$CTX" "$@"; }
KN() { kubectl --context "$CTX" -n "$NAMESPACE" "$@"; }
H()  { helm --kube-context "$CTX" -n "$NAMESPACE" "$@"; }
now() { date -u +%FT%TZ; }
record() {  # record <action> <ok:true|false> <started>
  python3 - "$WORK/proof/runs.jsonl" "$1" "$2" "$3" "$NAMESPACE" "$CLUSTER" "$IMAGE" <<'PY'
import json, sys, time
path, action, ok, started, ns, cluster, image = sys.argv[1:8]
with open(path, "a", encoding="utf-8") as fh:
    fh.write(json.dumps({"action": action, "ok": ok == "true", "started": started,
                         "finished": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                         "namespace": ns, "cluster": cluster, "image": image}) + "\n")
PY
}

guard_cluster() { require_kind_context "$CTX" "$CLUSTER"; }
ns_owned() {  # 0 if the namespace exists and was created by this lab, 1 if absent; dies if foreign
  local owner
  K get namespace "$NAMESPACE" >/dev/null 2>&1 || return 1
  owner="$(K get namespace "$NAMESPACE" -o jsonpath='{.metadata.labels.looped\.lab/id}')"
  [ "$owner" = "L31" ] || die "namespace $NAMESPACE exists but is not labelled looped.lab/id=L31; refusing to touch it"
  return 0
}
render() {  # render <src> <dst>: fill placeholders from rebuild.env
  sed -e "s#__NAMESPACE__#$NAMESPACE#g" -e "s#__IMAGE__#$IMAGE#g" -e "s#__IMAGE_REPO__#$IMAGE_REPO#g" \
      -e "s#__IMAGE_TAG__#$IMAGE_TAG#g" -e "s#__POSTGRES_IMAGE__#$POSTGRES_IMAGE#g" -e "s#__REDIS_IMAGE__#$REDIS_IMAGE#g" "$1" > "$2"
}

step_image() {
  require_compose_project looped-l31   # Docker reachable; nothing named outside looped-l31*
  [ "$IMAGE_SOURCE" = "build" ] || die "IMAGE_SOURCE=$IMAGE_SOURCE: this rebuild only builds from the L13 sources"
  local B="$WORK/build"
  rm -rf "${B:?}"
  mkdir -p "$B/wheels"
  cp -R "$SRE_ROOT/L13/starter/." "$B/"
  cp -R "$SRE_BEACON/beacon" "$B/beacon"
  info "fetching the hash-pinned wheels named in L13/starter/requirements.lock"
  for plat in manylinux2014_aarch64 manylinux2014_x86_64; do
    python3 -m pip download --quiet --disable-pip-version-check --no-deps --only-binary=:all: \
      --python-version 3.12 --implementation cp --platform "$plat" -d "$B/wheels" -r "$B/requirements.lock" \
      || die "pip download failed for $plat (network or proxy?)"
  done
  info "docker build -t $IMAGE (L13 recipe, label looped.lab/id=L31)"
  docker build --provenance=false --label "$SRE_LABEL=L31" -t "$IMAGE" "$B"
  local id; id="$(docker image inspect --format '{{.Id}}' "$IMAGE")"
  python3 - "$WORK/release.json" "$IMAGE" "$id" "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$IMAGE")" <<'PY'
import json, sys, time
path, ref, iid, plat = sys.argv[1:5]
json.dump({"image": ref, "image_id": iid, "platform": plat, "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}, open(path, "w"), indent=2)
PY
  info "image $IMAGE id $id recorded in work/release.json"
  guard_cluster
  kind load docker-image "$IMAGE" --name "$CLUSTER"
}

step_deploy() {
  guard_cluster
  local R="$WORK/rendered" f
  for f in "$HERE"/assets/manifests/*.yaml "$HERE/assets/values-capstone.yaml"; do render "$f" "$R/$(basename "$f")"; done
  for f in 20-rbac 30-netpol; do  # L18's objects, re-namespaced and re-labelled for this rebuild
    sed -e "s/namespace: beacon\b/namespace: $NAMESPACE/g" -e "s#looped.lab/id: L18#looped.lab/id: L31#g" "$SRE_ROOT/L18/manifests/$f.yaml" > "$R/l18-$f.yaml"
  done
  ns_owned || K apply -f "$R/00-namespace.yaml"
  [ "$DB_SECRET_SOURCE" = "generate" ] || die "DB_SECRET_SOURCE=$DB_SECRET_SOURCE: a rebuild must not depend on a Secret it did not create"
  mkdir -p "$WORK/.secrets"; chmod 700 "$WORK/.secrets"
  if [ ! -s "$WORK/.secrets/db-password" ]; then
    (umask 077; printf 'lab-l31-%s-not-a-real-secret' "$(python3 -c 'import secrets; print(secrets.token_hex(8))')" > "$WORK/.secrets/db-password")
  fi
  KN create secret generic beacon-db-auth --from-file=POSTGRES_PASSWORD="$WORK/.secrets/db-password" --dry-run=client -o yaml | KN apply -f - >/dev/null
  python3 -c 'import sys; print("postgresql://beacon:%s@beacon-db:5432/beacon" % open(sys.argv[1]).read().strip(), end="")' "$WORK/.secrets/db-password" > "$WORK/.secrets/store-url"
  KN create secret generic beacon-store --from-file=url="$WORK/.secrets/store-url" --dry-run=client -o yaml | KN apply -f - >/dev/null
  KN label secret beacon-db-auth beacon-store "$SRE_LABEL=L31" --overwrite >/dev/null
  for f in 10-serviceaccounts 20-postgres 30-queue 40-worker l18-20-rbac l18-30-netpol 50-netpol-capstone; do KN apply -f "$R/$f.yaml"; done
  local envfile=()
  [ "$ENVIRONMENT" = "dev" ] || envfile=(-f "$REPO/$CHART/values-$ENVIRONMENT.yaml")
  H upgrade --install "$RELEASE" "$REPO/$CHART" ${envfile[@]+"${envfile[@]}"} -f "$R/values-capstone.yaml" \
    --post-renderer "$HERE/assets/postrender.py" --wait --timeout 240s
  KN rollout status statefulset/beacon-db --timeout=180s
  KN rollout status deployment/beacon-queue --timeout=120s
  KN rollout status deployment/beacon-worker --timeout=120s
  KN rollout status "deployment/$FULLNAME" --timeout=180s
}

step_seed() {
  guard_cluster
  ns_owned || die "namespace $NAMESPACE not deployed; run rebuild.sh deploy"
  KN wait --for=condition=Ready pod/beacon-db-0 --timeout=180s
  KN exec -i beacon-db-0 -- psql -U beacon -d beacon -At -v ON_ERROR_STOP=1 -v n="$SEED_RECORDS" -f - < "$HERE/assets/seed.sql" | tee "$WORK/proof/seed.txt"
}

step_verify() { python3 "$CAP" verify --release "$REL" --out "$WORK/proof/verify.json"; }

step_backup() {
  guard_cluster
  ns_owned || die "namespace $NAMESPACE not deployed"
  local f; f="$WORK/backups/beacon-$(date -u +%Y%m%dT%H%M%SZ).dump"
  KN exec beacon-db-0 -- pg_dump -U beacon -d beacon -Fc > "$f"
  [ -s "$f" ] || die "empty backup $f"
  info "backup $f ($(wc -c < "$f") bytes)"
}

step_restore_drill() {
  guard_cluster
  ns_owned || die "namespace $NAMESPACE not deployed"
  local f t0 port pf
  f="$(ls -1t "$WORK"/backups/*.dump 2>/dev/null | head -1)"
  [ -n "$f" ] || die "no backup in work/backups; run rebuild.sh backup"
  t0=$(date +%s)
  KN exec beacon-db-0 -- dropdb --if-exists -U beacon beacon_restore
  KN exec beacon-db-0 -- createdb -U beacon beacon_restore
  KN exec -i beacon-db-0 -- pg_restore -U beacon -d beacon_restore --no-owner < "$f"
  port=15431
  KN port-forward --address 127.0.0.1 pod/beacon-db-0 "$port:5432" >/dev/null 2>&1 &
  pf=$!
  for _ in $(seq 1 40); do python3 -c "import socket; socket.create_connection(('127.0.0.1', $port), 0.3).close()" 2>/dev/null && break; sleep 0.25; done
  local pw rc=0; pw="$(cat "$WORK/.secrets/db-password")"
  python3 "$SRE_ROOT/L24/assets/verify_restore.py" --source "postgresql://beacon:$pw@127.0.0.1:$port/beacon" \
    --target "postgresql://beacon:$pw@127.0.0.1:$port/beacon_restore" --report "$WORK/proof/restore.json" || rc=$?
  kill "$pf" 2>/dev/null || true
  KN exec beacon-db-0 -- dropdb -U beacon beacon_restore   # scoped cleanup: the scratch database only
  [ "$rc" -eq 0 ] || die "restored copy does not match the source (work/proof/restore.json)"
  info "restore drill: $(( $(date +%s) - t0 )) s from backup file to verified copy"
}

step_rollback_drill() {
  guard_cluster
  local envfile=() before
  [ "$ENVIRONMENT" = "dev" ] || envfile=(-f "$REPO/$CHART/values-$ENVIRONMENT.yaml")
  before="$(H history "$RELEASE" -o json | python3 -c 'import json,sys; print(json.load(sys.stdin)[-1]["revision"])')"
  info "release 2 of the drill: same image, config.inject.delayMs=250 (a degrading change)"
  H upgrade "$RELEASE" "$REPO/$CHART" ${envfile[@]+"${envfile[@]}"} -f "$WORK/rendered/values-capstone.yaml" \
    --set config.inject.delayMs=250 --post-renderer "$HERE/assets/postrender.py" --wait --timeout 240s
  info "helm rollback $RELEASE $before"
  H rollback "$RELEASE" "$before" --wait --timeout 240s
  H history "$RELEASE" -o json > "$WORK/proof/rollback-history.json"
  KN rollout status "deployment/$FULLNAME" --timeout=180s
}

step_slo() {
  require_compose_project looped-l31
  local d="$REPO/$SLO_DIR"
  docker run --rm --network none -v "$d:/w:ro" --entrypoint promtool "$PROMTOOL_IMAGE" check rules /w/rules/beacon-slo.rules.yml
  docker run --rm --network none -v "$d:/w:ro" --entrypoint promtool "$PROMTOOL_IMAGE" test rules /w/tests/beacon-slo.test.yml
}

step_down() {
  guard_cluster
  if ! ns_owned; then info "namespace $NAMESPACE absent; nothing to remove"; return 0; fi
  confirm "Delete helm release $RELEASE and namespace $NAMESPACE (label looped.lab/id=L31) in $CTX?"
  H uninstall "$RELEASE" --wait >/dev/null 2>&1 || true
  K delete namespace "$NAMESPACE" --wait=true --timeout=180s   # ownership (label L31) checked by ns_owned above
}

run_all() {
  python3 "$CAP" check --release "$REL" || die "dry check failed; fix release/ first"
  step_image; step_deploy; step_seed; step_backup; step_restore_drill; step_rollback_drill; step_slo; step_verify
}

# down/all/proof append their outcome to work/proof/runs.jsonl, success or failure
started="$(now)"
ACTION=""
on_exit() { local rc=$?; [ -n "$ACTION" ] && record "$ACTION" false "$started"; exit "$rc"; }
trap on_exit EXIT
case "$CMD" in
  image) step_image ;;
  deploy) step_deploy ;;
  seed) step_seed ;;
  verify) step_verify ;;
  backup) step_backup ;;
  restore-drill) step_restore_drill ;;
  rollback-drill) step_rollback_drill ;;
  slo) step_slo ;;
  down) ACTION=down; step_down; ACTION=""; record down true "$started" ;;
  all) ACTION=all; run_all; ACTION=""; record all true "$started" ;;
  proof)
    ACTION=down; step_down; ACTION=""; record down true "$started"
    started="$(now)"; ACTION=all; run_all; ACTION=""; record all true "$started" ;;
esac
