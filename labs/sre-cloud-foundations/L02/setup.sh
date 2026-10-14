#!/usr/bin/env bash
# L02 setup: build the lab Git repository at /opt/beacon-l02/repo (owned by
# the invoking user so you can work in it without sudo) and inject the
# chosen variant's history. Run as root inside the course VM. Idempotent:
# re-running rebuilds the exercise repository from scratch.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_linux_vm
[ "$(id -u)" = 0 ] || die "run with sudo (creates /opt/beacon-l02)"
command -v git >/dev/null 2>&1 || die "git not found (apt-get install -y git)"
command -v python3 >/dev/null 2>&1 || die "python3 not found"

LAB=/opt/beacon-l02
mkdir -p "$LAB"
EV="$(evidence_dir "$HERE")"
[ -f "$EV/L02-notes.md" ] || cp "$HERE/assets/notes-template.md" "$EV/L02-notes.md"
LOOPED_VARIANT="${LOOPED_VARIANT:-variant-a}" bash "$HERE/inject.sh"
say ""
say "L02 ready. Work in:  cd $LAB/repo && git log --oneline --graph --all"
say "Notes template copied to $EV/L02-notes.md"
