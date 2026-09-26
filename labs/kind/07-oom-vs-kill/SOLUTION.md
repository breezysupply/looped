# Lab 07 — solution

## Mechanism

Exit code 137 only says the process died from SIGKILL. Who sent it is in
`lastState.terminated.reason` and the events.

**thumbnailer — OOMKilled.** A container's memory limit is enforced by the
kernel through the container's memory cgroup. When the batch pushes usage past
48Mi and the kernel cannot reclaim enough, the OOM killer SIGKILLs a process in
that cgroup. Here the memory is held by PID 1 itself, so the container dies;
the runtime records the OOM and the kubelet reports reason `OOMKilled`, exit
137. Restarting does not help: the next batch does the same. The raised batch
size is the cause; the limit is now too small for it.

**transcoder — killed by the kubelet.** Its liveness probe starts at 10 s and
fails 3 times while the app is still booting (~45 s). The kubelet then stops
the container: SIGTERM, which this entrypoint ignores, then SIGKILL after
`terminationGracePeriodSeconds` (10 s). Exit 137, reason `Error`. Memory was
never involved: doubling its limit changes nothing.

## Valid fixes

**thumbnailer:** raise the memory limit (and request) to fit the measured
batch peak with headroom, or reduce the batch size back.

```sh
kubectl --context kind-looped-onsite -n looped-lab set resources deployment/thumbnailer -c worker \
  --requests=cpu=10m,memory=160Mi --limits=memory=192Mi
```

**transcoder:** give the boot a probe budget; keep liveness.

```sh
kubectl --context kind-looped-onsite -n looped-lab patch deployment transcoder --type=strategic \
  -p '{"spec":{"template":{"spec":{"containers":[{"name":"transcoder","startupProbe":{"httpGet":{"path":"/healthz","port":"http"},"periodSeconds":5,"failureThreshold":24}}]}}}}'
```

(or raise `initialDelaySeconds` well above 45 s). Separately, the SIGTERM
handling is worth a ticket against the image: an entrypoint that forwards
signals (or `exec`s the server) shuts down cleanly in rollouts instead of being
SIGKILLed after the grace period.

The teammate's proposal: right direction for thumbnailer (the limit is the
constraint, though "double" is a guess; size it from the batch), wrong for
transcoder.

## Why this matters in an interview

Never say "137 means OOM". Say "137 means SIGKILL; `OOMKilled` in
`lastState.reason` means the kernel's OOM killer; `Error` with liveness events
and `Killing` means the kubelet, after the grace period." Then fix each at its
cause.
