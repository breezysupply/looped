# L04 — Host resource triage: CPU, memory, blocks and inodes

Module M02 · ~100 min practical (two sessions) · profile `linux-arm64` · runs **inside the course VM**

## Ticket

> Beacon on the lab host has started failing writes: `POST /status` and `POST /jobs` return
> errors for some or all callers, or everything is "just slow". The host is shared — another
> team's reporter process runs there too, and Beacon's database and pending jobs on the data
> volume are **live data**. Restore Beacon's write path, keep the data, keep the neighbours, and
> tell us what the bottleneck was and which measurement proved it.

## Objectives

- `obj-m02-04` identify the resource bottleneck (CPU saturation, memory pressure, full blocks,
  exhausted inodes) with load, `ps`/`top`, `free`/PSI, `df -h` and `df -i`, and restore service safely
- `obj-m02-02` decide from process, resource and log evidence whether the host or the
  application is at fault

## What is fixture-controlled (and capped)

`setup.sh` creates a **24 MiB ext4 image with 1024 inodes** at `/opt/beacon-l04/labfs.img`,
loop-mounts it at `/opt/beacon-l04/mnt`, and points Beacon's SQLite database and directory queue
at it. Beacon listens on `127.0.0.1:8084` and logs to `/opt/beacon-l04/beacon.log`. An idle
"reporter" process belongs to someone else. `inject.sh` then applies one of three faults
(`LOOPED_VARIANT=variant-a|variant-b|variant-c`). Every disk fault writes only inside the image;
the CPU fixture forks at most four busy workers and exits by itself after 600 s (a 900 s
`timeout` wraps it too). Nothing in this lab can fill the VM's own disk or run forever.

## Steps and checkpoints

**Checkpoint c1 — measure before you touch anything (week 4, session 1).**

1. `sudo bash labs/sre-cloud-foundations/L04/setup.sh` (variant-a unless `LOOPED_VARIANT` is set).
2. Reproduce: `curl -s -w ' %{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{"sensor_id":"s-1","status":"ok"}' 127.0.0.1:8084/status`
   (and the same against `/jobs`). Read the last lines of `/opt/beacon-l04/beacon.log`.
3. Collect the baseline into `evidence/L04-triage.md` (template copied there by setup):
   `uptime`, `ps -eo pid,ppid,user,%cpu,%mem,cmd --sort=-%cpu | head`, `free -m`,
   `cat /proc/pressure/{cpu,memory,io}` (if your kernel has PSI), `vmstat 1 5`,
   `df -h /opt/beacon-l04/mnt`, `df -i /opt/beacon-l04/mnt`. Paste real output, with the command.
4. Write two hypotheses and the one measurement that separates them.

**Checkpoint c2 — restore narrowly, then prove it (week 4, session 2).**

5. Fix the smallest thing. For a disk fault: find *what* is using the space or the inodes
   (`du -xsh /opt/beacon-l04/mnt/*`, `find /opt/beacon-l04/mnt -xdev -type f | cut -d/ -f5,6 | sort | uniq -c | sort -rn`)
   and remove only data that is safe to remove. For CPU: identify the process tree
   (`ps -o pid,ppid,cmd`, `pstree -p`) and stop that one job by PID.
6. Prove it: both POSTs succeed, `df` shows headroom, the reporter is still running with the
   same PID, the seeded records and pending jobs are still there.
7. `sudo python3 labs/sre-cloud-foundations/L04/validate.py --explanation-file labs/sre-cloud-foundations/L04/evidence/L04-triage.md`

## What you should observe

- Beacon itself is healthy: `/healthz` keeps answering. The **write** path fails, with an
  application error that only names the symptom (`store unavailable`, `internal error`); the
  log line underneath carries the kernel's word for it.
- "No space left on device" is returned for two different exhausted resources. Only one of
  `df -h` / `df -i` is at 100% — that difference is the discriminating evidence.
- High load average with idle disks and a short, CPU-sorted process list that is dominated by
  one process family.
- Memory pressure is part of the baseline you record, not a variant here: note `free -m`'s
  `available` column and PSI so you can say it was *not* the cause.

## Pause / resume

All state is under `/opt/beacon-l04` (image, mount, PID files, seeded manifest). `reset.sh`
stops the lab processes, unmounts and recreates the image and re-injects the same variant.
A VM reboot drops the mount and processes: run `reset.sh`.

## Lab versus production

On a real host the volume is bigger, the "safe to delete" data is less obvious, and the CPU
consumer may be your own service. The method is the same: measure blocks **and** inodes,
sort processes by the resource, identify ownership, free or stop the narrowest thing, and keep
the evidence. Production adds log rotation limits, alerting on `df -i`, and cgroup CPU limits
that would have contained the batch job.

## Limits

This lab does not prove capacity planning, memory-pressure tuning, OOM-killer behaviour or
I/O-latency diagnosis; it does not run under systemd (L03 covers units). It proves you can
separate three host bottlenecks with the right metric and restore one service without
collateral damage, on a small capped filesystem inside a disposable VM.

## References

- T15 systemd/Linux documentation (`df(1)`, `ps(1)`, `proc(5)`, PSI)
