#!/usr/bin/env bash
# L02 fault injection: (re)build the exercise repository with one variant's
# history. The validator reads $LAB/.lab/ to know which commits to expect;
# it never prints the cause.
#   LOOPED_VARIANT=variant-a   the ticket branch carries a structural config fault   (default)
#   LOOPED_VARIANT=variant-b   main and the ticket branch disagree about the server block
# Both variants also carry one behaviour-changing commit on main.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_linux_vm
[ "$(id -u)" = 0 ] || die "run with sudo"
LAB=/opt/beacon-l02
REPO="$LAB/repo"
V="${LOOPED_VARIANT:-${1:-variant-a}}"
case "$V" in variant-a|variant-b) ;; *) die "unknown variant $V (variant-a | variant-b)" ;; esac
OWNER="${SUDO_USER:-root}"
id "$OWNER" >/dev/null 2>&1 || OWNER=root

mkdir -p "$LAB"
rm -rf "${REPO:?}" "${LAB:?}/.lab"
mkdir -p "$REPO" "$LAB/.lab"
cp -r "$HERE/assets/repo-baseline/." "$REPO/"

g() { git -C "$REPO" -c safe.directory="$REPO" "$@"; }
# commit as a named teammate at a fixed time, so every learner sees the same history
commit_as() {  # commit_as "Name" email "date" "message"
  GIT_AUTHOR_NAME="$1" GIT_AUTHOR_EMAIL="$2" GIT_AUTHOR_DATE="$3" \
  GIT_COMMITTER_NAME="$1" GIT_COMMITTER_EMAIL="$2" GIT_COMMITTER_DATE="$3" \
    g commit -q -m "$4"
}
g init -q -b main
g config user.name "Looped Learner"
g config user.email "learner@corp.lab"
g config core.autocrlf false
g add -A
commit_as "Release Bot" release@corp.lab "2026-09-01T09:00:00Z" "baseline: Beacon 1.4.0 lab configuration"
BASE="$(g rev-parse HEAD)"

# ticket-142 branches from the baseline (a teammate's change, not yet merged)
g checkout -q -b ticket-142
sed -i 's/^  environment: lab$/  environment: staging-lab/' "$REPO/config/beacon.yaml"
if [ "$V" = variant-a ]; then
  sed -i 's/^  request_timeout_s: 10$/   request_timeout_s: 15/' "$REPO/config/beacon.yaml"
else
  sed -i 's/^  request_timeout_s: 10$/  request_timeout_s: 15/' "$REPO/config/beacon.yaml"
fi
g add -A
commit_as "Dev Teammate" dev@corp.lab "2026-09-02T14:10:00Z" "ticket-142: staging-lab environment and a 15s request timeout"
TICKET="$(g rev-parse HEAD)"

# main moves on: one intended change, then one that changes behaviour
g checkout -q main
if [ "$V" = variant-a ]; then
  sed -i 's/^  version: "1.4.0"$/  version: "1.4.1"/' "$REPO/config/beacon.yaml"
  sed -i 's/"expect_version": "1.4.0"/"expect_version": "1.4.1"/' "$REPO/deploy/service.json"
  g add -A
  commit_as "Release Bot" release@corp.lab "2026-09-03T08:30:00Z" "release: Beacon 1.4.1"
else
  sed -i 's/^  port: 8080$/  port: 8081/' "$REPO/config/beacon.yaml"
  sed -i 's/"listen_port": 8080/"listen_port": 8081/' "$REPO/deploy/service.json"
  g add -A
  commit_as "Ops Teammate" ops@corp.lab "2026-09-03T08:30:00Z" "ops: move Beacon to 8081 (8080 now belongs to the metrics agent)"
fi
CHANGE_A="$(g rev-parse HEAD)"
printf '\n## Maintenance\n\nHost patching is scheduled for the week of 2026-09-07; see the ops calendar.\n' >> "$REPO/README.md"
sed -i 's/^  ready_fail: false$/  ready_fail: true/' "$REPO/config/beacon.yaml"
g add -A
commit_as "Ops Teammate" ops@corp.lab "2026-09-04T17:45:00Z" "maintenance: prepare for host patching"
BAD="$(g rev-parse HEAD)"

printf '%s\n' "$V" > "$LAB/.lab/variant"
printf '%s\n' "$BASE" > "$LAB/.lab/base.sha"
printf '%s\n' "$CHANGE_A" > "$LAB/.lab/change-a.sha"
printf '%s\n' "$BAD" > "$LAB/.lab/bad.sha"
printf '%s\n' "$TICKET" > "$LAB/.lab/ticket.sha"
chown -R "$OWNER" "$REPO"
info "exercise repository built at $REPO ($V); owner $OWNER"
