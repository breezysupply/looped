# L04 hints (four rungs; rungs 3–4 end independent credit for this attempt)

1. **Boundary.** Beacon's process is alive and `/healthz` answers, so the application is not
   crashing. Ask which shared resource its write path needs: CPU time, memory, disk blocks or
   inodes on the volume that holds its database and queue.
2. **Evidence source.** The Beacon log line under the failing request carries the kernel's
   error. Then measure every candidate, not just the first one you think of: `uptime`,
   `ps --sort=-%cpu`, `free -m`, `df -h` **and** `df -i` on `/opt/beacon-l04/mnt`.
3. **Discriminating command.** If `df -h` and `df -i` disagree, the one at 100% is the answer;
   then `du -xsh /opt/beacon-l04/mnt/*` (bytes) or `find … -type f | cut -d/ -f5,6 | sort | uniq -c`
   (file counts) shows where. If disks are fine, `ps -eo pid,ppid,%cpu,cmd --sort=-%cpu | head`
   shows who is burning CPU and their parent.
4. **Root cause and fix.** Blocks: old rotated `logs/beacon-debug.log.*`; delete those only.
   Inodes: ~990 stale files in `tmp/sessions/`; `find …/tmp/sessions -type f -mtime +1 -delete`.
   CPU: the `report-builder.py --rebuild-all` job; `kill` its parent PID. Never touch `data/`,
   `queue/`, Beacon or the reporter.
