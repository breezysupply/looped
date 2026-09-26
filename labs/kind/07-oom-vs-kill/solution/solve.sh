#!/usr/bin/env bash
# Reference fix for lab 07 (used by the harness). Try the lab before reading this.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/lib/common.sh"
preflight >/dev/null
# thumbnailer: OOMKilled. A batch peaks around 100 MiB; give it a limit with headroom.
k set resources deployment/thumbnailer -c worker --requests=cpu=10m,memory=160Mi --limits=memory=192Mi
# transcoder: killed by its liveness probe during a 45s boot (137 because PID 1
# ignores SIGTERM and is SIGKILLed after the grace period). Give the boot a
# startupProbe budget; leave memory alone.
k patch deployment transcoder --type=strategic \
  -p '{"spec":{"template":{"spec":{"containers":[{"name":"transcoder","startupProbe":{"httpGet":{"path":"/healthz","port":"http"},"periodSeconds":5,"failureThreshold":24}}]}}}}'
wait_rollout thumbnailer 180
wait_rollout transcoder 300
