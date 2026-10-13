# L04 worked solution

Read this after your own attempt.

## Common first steps (all variants)

```sh
curl -s -w ' %{http_code}\n' -X POST -H 'Content-Type: application/json' \
     -d '{"sensor_id":"s-1","status":"ok"}' 127.0.0.1:8084/status
tail -3 /opt/beacon-l04/beacon.log
uptime; ps -eo pid,ppid,user,%cpu,%mem,cmd --sort=-%cpu | head
free -m; cat /proc/pressure/memory 2>/dev/null
df -h /opt/beacon-l04/mnt; df -i /opt/beacon-l04/mnt
```

## Variant A — blocks exhausted

`POST /status` → 503 `store unavailable`; `/jobs` → 500. `df -h` shows `Use% 100%`, `df -i`
shows a few percent. `du -xsh /opt/beacon-l04/mnt/*` puts ~19 MiB in `logs/`:
`beacon-debug.log.1 … .N`, rotated debug logs nine days old. The database (`data/`) and the job
queue (`queue/pending`) are small and live. Fix:

```sh
ls -lt /opt/beacon-l04/mnt/logs | head
rm /opt/beacon-l04/mnt/logs/beacon-debug.log.*      # rotated, old, not open by anything
df -h /opt/beacon-l04/mnt                            # headroom back
```

Beacon recovers without a restart — SQLite and the queue open files per write. The lasting fix
is turning debug logging off and bounding rotation; say so in your notes.

## Variant B — inodes exhausted

Same error codes, but `df -h` shows ~20% used and `df -i` shows `IUse% 100%`. Count files per
directory: `find /opt/beacon-l04/mnt -xdev -type f | cut -d/ -f5,6 | sort | uniq -c | sort -rn`
→ ~990 files in `tmp/sessions/`, all twelve days old. Remove only those:

```sh
find /opt/beacon-l04/mnt/tmp/sessions -type f -mtime +1 -delete
df -i /opt/beacon-l04/mnt
```

Unsafe shortcut the validator rejects: deleting "all small files" also deletes the pending job
files in `queue/pending` (live work), and `live-data-intact` fails.

## Variant C — CPU-bound batch job

Writes succeed but everything is slow; load average climbs towards the CPU count; `ps --sort=-%cpu`
shows several `report-builder.py --rebuild-all` processes at ~100% each with a common parent.
Stop the job, not "python":

```sh
ps -o pid,ppid,cmd -C python3 | grep report-builder
kill <parent pid>            # the parent forwards SIGTERM to its workers
pgrep -fa report-builder || echo stopped
```

`pkill python3` would also kill Beacon and the other team's reporter — `bystanders-alive` fails.

## Record and validate

Paste the before/after measurements into `evidence/L04-triage.md`, then run `validate.py` with
`sudo` (it reads `/proc`, the mount table and `losetup`).
