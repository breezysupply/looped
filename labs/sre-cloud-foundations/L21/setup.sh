#!/usr/bin/env bash
# L21 setup: copy the lab's Beacon (starter/app), its config and a starter
# dashboard into work/, start api, worker and the registry fixture as compose
# project looped-l21 on the observability profile's network, load the
# dashboard into Grafana, then inject the variant (inject.sh).
# Needs: profiles/observability/setup.sh first. Idempotent: work/ is kept.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
l21_guard
l21_require_profile
V="$(l21_variant)"
[ -n "${LOOPED_VARIANT:-}" ] && V="$LOOPED_VARIANT"
case "$V" in variant-a|variant-b) ;; *) die "unknown variant $V (variant-a | variant-b)" ;; esac
EV="$(evidence_dir "$HERE")"
fresh=0
if [ ! -d "$WORK/app" ]; then
  fresh=1
  mkdir -p "$WORK/queue" "$WORK/fixture"
  cp -R "$HERE/starter/app" "$WORK/app"
  cp -R "$HERE/starter/config" "$WORK/config"
  cp "$HERE/starter/dashboard.json" "$WORK/dashboard.json"
  cp "$HERE/assets/diagnosis-template.json" "$WORK/diagnosis.json"
  printf '{"delay_ms": 0}\n' > "$WORK/fixture/registry.json"
  printf '%s\n' "$V" > "$WORK/.variant"
else
  info "work/ exists; keeping your edits (reset.sh starts over)"
fi
chmod -R a+rX "$WORK"
chmod a+rwx "$WORK/queue"
info "starting looped-l21 (api 127.0.0.1:18521, registry :18522, worker metrics :18523)"
l21_dc up -d >/dev/null
l21_wait_api
python3 "$HERE/assets/grafana_push.py" "$WORK/dashboard.json" || warn "Grafana not reachable; load work/dashboard.json by hand later"
[ -f "$EV/L21-notes.md" ] || cp "$HERE/assets/notes-template.md" "$EV/L21-notes.md"
{
  echo "# L21 tool inventory — $(date -u +%FT%TZ)"
  record_versions
  docker ps --filter label=looped.lab/profile=observability --format '{{.Names}} {{.Image}}'
} > "$EV/L21-tools.txt"
[ "$fresh" = 1 ] && bash "$HERE/inject.sh"
say ""
say "L21 ready ($(l21_variant)). Read work/TICKET.md. Grafana http://127.0.0.1:13000 · Prometheus :19090 · Jaeger :16686"
