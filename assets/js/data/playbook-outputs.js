/* Sample output for each playbook step: what the command actually prints, with
   the part that decides your next move marked. Keyed by playbook id, indexed
   by step, so the tree data stays the shape it was. null = a step that is a
   talk track or a checklist rather than a command to run. */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.pbOut = LX.pbOut || {};

LX.pbOut['pb-app-walk'] = [
  { out:'● myapp.service - Order API\n' +
        '     Loaded: loaded (/etc/systemd/system/myapp.service; enabled; preset: disabled)\n' +
        '     Active: activating (auto-restart) (Result: signal) since Fri 2026-08-14 13:22:07 UTC; 2s ago\n' +
        '    Process: 14882 ExecStart=/usr/bin/java $JAVA_OPTS -jar /opt/myapp/app.jar (code=killed, signal=KILL)\n' +
        '   Main PID: 14882 (code=killed, signal=KILL)\n' +
        '        CPU: 4min 11.902s\n\n' +
        'Aug 14 13:22:05 ip-10-0-1-52 systemd[1]: myapp.service: Main process exited, code=killed, status=9/KILL\n' +
        'Aug 14 13:22:05 ip-10-0-1-52 systemd[1]: myapp.service: Failed with result "signal".\n' +
        'Aug 14 13:22:07 ip-10-0-1-52 systemd[1]: myapp.service: Scheduled restart job, restart counter is at 7.',
    mark:['code=killed, signal=KILL', 'code=killed, status=9/KILL', 'restart counter is at 7'],
    note:'`killed, signal=KILL` — not an exit code. The process did not choose to stop, so its own logs will have no error in them. That single word decides the next three commands.' },

  { out:'Aug 14 13:21:58 ip-10-0-1-52 app[14882]: INFO  batch 8821 rows=50000 heap=3.1G/3.5G\n' +
        'Aug 14 13:22:01 ip-10-0-1-52 app[14882]: INFO  batch 8822 rows=50000 heap=3.4G/3.5G\n' +
        'Aug 14 13:22:04 ip-10-0-1-52 app[14882]: INFO  batch 8823 rows=5\n' +
        'Aug 14 13:22:05 ip-10-0-1-52 systemd[1]: myapp.service: Main process exited, code=killed, status=9/KILL\n' +
        'Aug 14 13:22:05 ip-10-0-1-52 systemd[1]: myapp.service: Failed with result "signal".',
    mark:['rows=5', 'code=killed, status=9/KILL'],
    note:'Read the shape of the ending, not just the content. The application line stops mid-value — `rows=5` where every other line reads `rows=50000` — and then systemd, not the app, reports the death. Nothing wrote an error because nothing got the chance.' },

  { out:'[Fri Aug 14 13:22:04 2026] java invoked oom-killer: gfp_mask=0x140dca(GFP_HIGHUSER_MOVABLE|__GFP_COMP|__GFP_ZERO), order=0, oom_score_adj=0\n' +
        '[Fri Aug 14 13:22:04 2026] Out of memory: Killed process 14882 (java) total-vm:5731204kB, anon-rss:3402180kB, file-rss:0kB, shmem-rss:0kB, UID:993 pgtables:7208kB oom_score_adj:0',
    mark:['Out of memory: Killed process 14882 (java)', 'anon-rss:3402180kB'],
    note:'This is the evidence. It names the process, its PID, and its resident memory at the moment it was killed — 3.4G of anonymous memory on a 3.7G host. An empty result here is a finding too: it means something in userspace sent the signal, not the kernel.' },

  { out:'               total        used        free      shared  buff/cache   available\n' +
        'Mem:           3.7Gi       2.8Gi       148Mi        21Mi       767Mi       610Mi\n' +
        'Swap:            0Bi         0Bi         0Bi',
    mark:['610Mi', 'Swap:            0Bi         0Bi         0Bi'],
    note:'Read **available** (610Mi), not free — Linux hands page cache back on demand, so a small "free" number is normal. The swap line is the other half: with no swap there is no slow degradation to warn you, so the box runs fine right up until the OOM killer fires.' },

  { out:'USER         PID %CPU %MEM    VSZ   RSS STAT COMMAND\n' +
        'appsvc     14882  4.0 76.1 5731204 2914304 S  /usr/bin/java -Xms1g -Xmx3584m -jar /opt/myapp/app.jar\n' +
        'root        3301  0.1  0.4  224100  17204 Ss  /usr/sbin/rsyslogd -n\n' +
        'root        1201  0.0  0.3  110984  12880 Ss  /usr/sbin/sshd -D',
    mark:['76.1', '-Xmx3584m'],
    note:'One process holding 76% of memory, and the answer is on the same line: `-Xmx3584m` is a 3.5G heap ceiling on a 3.7G host, leaving nothing for the JVM\'s own overhead or the rest of the system. Read RSS, not VSZ — VSZ counts address space that may never be touched.' }
];

LX.pbOut['pb-svc-start'] = [
  { out:'● nginx.service - The nginx HTTP and reverse proxy server\n' +
        '     Loaded: loaded (/usr/lib/systemd/system/nginx.service; enabled; preset: disabled)\n' +
        '     Active: failed (Result: exit-code) since Fri 2026-08-14 11:42:07 UTC; 3min ago\n' +
        '    Process: 20455 ExecStartPre=/usr/sbin/nginx -t (code=exited, status=1/FAILURE)\n\n' +
        'Aug 14 11:42:07 ip-10-0-2-45 nginx[20455]: nginx: [emerg] unknown directive "worker_connection" in /etc/nginx/nginx.conf:5\n' +
        'Aug 14 11:42:07 ip-10-0-2-45 systemd[1]: nginx.service: Control process exited, code=exited, status=1/FAILURE',
    mark:['Active: failed (Result: exit-code)', 'code=exited, status=1/FAILURE', 'ExecStartPre'],
    note:'`exited, status=1` — the process ran and rejected something, which is a different problem from `killed, signal=9`. The failure is in ExecStartPre, so it is the validator refusing, not the server crashing.' },
  { out:'Aug 14 11:42:07 ip-10-0-2-45 systemd[1]: Starting nginx.service...\n' +
        'Aug 14 11:42:07 ip-10-0-2-45 nginx[20455]: nginx: [emerg] unknown directive "worker_connection" in /etc/nginx/nginx.conf:5\n' +
        'Aug 14 11:42:07 ip-10-0-2-45 nginx[20455]: nginx: configuration file /etc/nginx/nginx.conf test failed\n' +
        'Aug 14 11:42:07 ip-10-0-2-45 systemd[1]: nginx.service: Failed with result "exit-code".\n' +
        'Aug 14 11:42:07 ip-10-0-2-45 systemd[1]: Failed to start nginx.service.',
    mark:['unknown directive "worker_connection"', '/etc/nginx/nginx.conf:5'],
    note:'The file and the line number, handed to you. A service that dies during startup cannot write to its own log file yet, which is why the journal is the only place this exists.' },
  { out:'# /usr/lib/systemd/system/nginx.service\n' +
        '[Unit]\nDescription=The nginx HTTP and reverse proxy server\nAfter=network-online.target\n\n' +
        '[Service]\nType=forking\nPIDFile=/run/nginx.pid\n' +
        'ExecStartPre=/usr/sbin/nginx -t\nExecStart=/usr/sbin/nginx\nExecReload=/usr/sbin/nginx -s reload\n\n' +
        '[Install]\nWantedBy=multi-user.target',
    mark:['Type=forking', 'ExecStartPre=/usr/sbin/nginx -t'],
    note:'`systemctl cat` shows the effective unit including drop-in overrides — what systemd is actually running, not what is in the package. Check `Type=` matches the process: declaring `forking` for something that stays in the foreground makes systemd conclude it failed.' },
  { out:'nginx: [emerg] unknown directive "worker_connection" in /etc/nginx/nginx.conf:5\n' +
        'nginx: configuration file /etc/nginx/nginx.conf test failed\n\n' +
        '# and once fixed:\n' +
        'nginx: the configuration file /etc/nginx/nginx.conf syntax is ok\n' +
        'nginx: configuration file /etc/nginx/nginx.conf test is successful',
    mark:['test failed', 'test is successful'],
    note:'Run it twice: once to confirm the fault, once to prove the fix before you restart anything. `nginx -t && systemctl reload nginx` means an invalid config can never reach a running service.' },
  { out:'nginx.service\n' +
        '● ├─system.slice\n' +
        '● └─sysinit.target\n' +
        '●   ├─systemd-journald.socket\n' +
        '●   ├─systemd-tmpfiles-setup.service\n' +
        '●   └─local-fs.target\n' +
        '●     └─var.mount',
    mark:['● └─sysinit.target', 'var.mount'],
    note:'A red or absent dot marks a dependency that is not up. This is where reboot-ordering problems surface: a unit that needs a mount or the network will fail with a confusing message when that dependency has not arrived yet.' },
  { out:'$ ss -lntp\n' +
        'State  Recv-Q Send-Q Local Address:Port Peer Address:Port Process\n' +
        'LISTEN 0      4096         0.0.0.0:80        0.0.0.0:*     users:(("httpd",pid=1902,fd=4))\n\n' +
        '$ df -h /var\nFilesystem      Size  Used Avail Use% Mounted on\n/dev/nvme1n1     20G   20G     0 100% /var',
    mark:['httpd', '0.0.0.0:80', '100% /var'],
    note:'Three classic external causes in two commands: something else already owns port 80 ("Address already in use"), the filesystem is full so no PID or socket file can be written, or the service account cannot traverse to a path it needs.' }
];

LX.pbOut['pb-crashloop'] = [
  { out:'● myapp.service - Order API\n' +
        '     Active: activating (auto-restart) (Result: exit-code) since Fri 2026-08-14 14:03:11 UTC; 1s ago\n' +
        '    Process: 22841 ExecStart=/usr/local/bin/myapp (code=exited, status=2)\n\n' +
        '$ systemctl show myapp -p NRestarts -p ExecMainStatus\nNRestarts=47\nExecMainStatus=2',
    mark:['activating (auto-restart)', 'NRestarts=47', 'ExecMainStatus=2'],
    note:'`activating (auto-restart)` caught between attempts is the signature of a loop. NRestarts is the number that makes it undeniable — 47 restarts is not a blip, and it tells you Restart=always is masking the real failure.' },
  { out:'Aug 14 14:03:09 ip-10-0-4-9 myapp[22841]: FATAL could not connect to database db.internal:5432: connection refused\n' +
        'Aug 14 14:03:09 ip-10-0-4-9 systemd[1]: myapp.service: Main process exited, code=exited, status=2\n' +
        'Aug 14 14:03:09 ip-10-0-4-9 systemd[1]: myapp.service: Scheduled restart job, restart counter is at 47.\n' +
        'Aug 14 14:03:10 ip-10-0-4-9 myapp[22855]: FATAL could not connect to database db.internal:5432: connection refused',
    mark:['connection refused', 'restart counter is at 47'],
    note:'Read one whole cycle rather than the last line. The same error repeating identically means an external dependency, not a race; an error that changes between attempts usually means state left behind by the previous run.' },
  { out:'# /etc/systemd/system/myapp.service\n[Service]\n' +
        'ExecStart=/usr/local/bin/myapp\nRestart=always\nRestartSec=1\nStartLimitBurst=0',
    mark:['Restart=always', 'RestartSec=1', 'StartLimitBurst=0'],
    note:'`RestartSec=1` with no start limit is why it hammers rather than backing off. Raising RestartSec and setting StartLimitBurst/StartLimitIntervalSec makes the loop stop and stay stopped, which is quieter and easier to diagnose — but it is containment, not the fix.' },
  { out:'TIME                          PID  UID  GID SIG     COREFILE EXE\n' +
        'Fri 2026-08-14 14:03:09 UTC 22841  993  993 SIGSEGV present  /usr/local/bin/myapp\n\n' +
        '# or, when nothing crashed:\nNo coredumps found.',
    mark:['SIGSEGV', 'No coredumps found.'],
    note:'A SIGSEGV leaves a dump here even when the application logged nothing. An empty list is equally informative: it points away from a crash and towards something external — the OOM killer, for instance, produces no dump.' },
  { out:'$ ss -lntp | grep 8080\nLISTEN 0 4096 0.0.0.0:8080 0.0.0.0:* users:(("otherapp",pid=9001,fd=6))\n\n' +
        '$ namei -l /var/lib/myapp/state.db\nf: /var/lib/myapp/state.db\n' +
        'drwxr-xr-x root   root   /\ndrwxr-xr-x root   root   var\ndrwxr-xr-x root   root   lib\n' +
        'drwx------ root   root   myapp\n                             state.db - Permission denied',
    mark:['otherapp', 'drwx------ root   root   myapp', 'Permission denied'],
    note:'Two of the three usual external blockers, visible at a glance: the port is already taken, and the service account cannot traverse a 0700 directory owned by root. `df -h` covers the third.' }
];

LX.pbOut['pb-mem'] = [
  { out:'               total        used        free      shared  buff/cache   available\n' +
        'Mem:            15Gi        11Gi       412Mi       128Mi       3.6Gi       2.1Gi\n' +
        'Swap:          2.0Gi       1.9Gi        98Mi',
    mark:['2.1Gi', '1.9Gi'],
    note:'Two numbers matter. **available** (2.1Gi) is what a new allocation can actually have — not "free". And swap almost fully used means the box has been under pressure long enough to page out, which shows up as everything being slow before anything gets killed.' },
  { out:'procs -----------memory---------- ---swap-- -----io---- -system-- ------cpu-----\n' +
        ' r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st\n' +
        ' 2  1 1994752 421888  10240 3684352  412  688  1204  2210 3021 5540 12  8 71  9  0\n' +
        ' 3  2 1996800 402112  10240 3681280  520  904  1580  2604 3210 5902 14  9 66 11  0',
    mark:['si   so', '412  688', '520  904'],
    note:'The `si`/`so` columns are the whole point of vmstat here: sustained non-zero swap-in and swap-out means active thrashing, not a one-off. A large `swpd` with si/so at zero is just old pages parked on disk and is harmless.' },
  { out:'    PID USER      %MEM     RSS      VSZ COMMAND\n' +
        '  14882 appsvc    76.1 2914304  5731204 /usr/bin/java -Xms1g -Xmx3584m -jar /opt/myapp/app.jar\n' +
        '   9114 postgres   6.2  241880  1104200 postgres: writer process\n' +
        '   3301 root       0.4   17204   224100 /usr/sbin/rsyslogd -n',
    mark:['2914304', '5731204'],
    note:'Read RSS (2.8G actually resident), not VSZ (5.4G of reserved address space) — a JVM always looks enormous by VSZ and it means nothing. One process far above the rest is a leak or an oversized limit; many similar processes adding up is a pool sized for a bigger machine.' },
  { out:'kernel: java invoked oom-killer: gfp_mask=0x140dca, order=0, oom_score_adj=0\n' +
        'kernel: Out of memory: Killed process 14882 (java) total-vm:5731204kB, anon-rss:3402180kB, UID:993\n' +
        'kernel: oom_reaper: reaped process 14882 (java), now anon-rss:0kB',
    mark:['Out of memory: Killed process 14882 (java)', 'anon-rss:3402180kB'],
    note:'The kernel logs its own decisions in a place userspace never writes to, which is why an application log can end mid-line with nothing in it. `dmesg -T` gives human timestamps so you can line this up against the outage.' },
  { out:'MemoryMax=2147483648\nMemoryCurrent=2145386496\n\n' +
        '# and when no limit is set:\nMemoryMax=infinity',
    mark:['MemoryMax=2147483648', 'MemoryCurrent=2145386496'],
    note:'Current sitting flush against Max means a cgroup kill, not a host OOM — systemd logs that one, the kernel OOM killer does not. `MemoryMax=infinity` means the unit is unbounded and can take the whole host down with it.' }
];

LX.pbOut['pb-disk-full'] = [
  { out:'Filesystem     Type      Size  Used Avail Use% Mounted on\n' +
        '/dev/nvme0n1p1 xfs        30G  8.1G   22G  27% /\n' +
        '/dev/nvme1n1   xfs        20G   20G     0 100% /var\n' +
        'tmpfs          tmpfs     1.9G     0  1.9G   0% /dev/shm',
    mark:['100% /var', 'Avail'],
    note:'`-T` adds the filesystem type, which matters because the reclaim options differ. Read Avail, not Use%: a 4T volume at 95% still has 200G, while this one has literally zero bytes left.' },
  { out:'Filesystem      Inodes  IUsed   IFree IUse% Mounted on\n' +
        '/dev/nvme0n1p1 1966080  82471 1883609    5% /\n' +
        '/dev/nvme1n1   1310720  41003 1269717    4% /var\n\n' +
        '# the other failure mode looks like this:\n' +
        '/dev/nvme2n1   1310720 1310720       0  100% /data',
    mark:['4% /var', '100% /data'],
    note:'Always run both. A filesystem with free blocks but no free inodes gives the identical "No space left on device" while `df -h` looks fine — millions of tiny session or cache files. Here inodes are fine, so it really is blocks.' },
  { out:'1.1G\t/var/lib\n' +
        '24M\t/var/cache\n' +
        '18G\t/var/log\n' +
        '20G\t/var',
    mark:['18G\t/var/log'],
    note:'`-x` stays on one filesystem so you do not walk into a mounted volume, `-d1` goes one level at a time. Piping to `sort -h` puts the answer on the last line. Descend into the biggest directory and repeat — do not scan the whole tree at once on a busy box.' },
  { out:'2490368 12G -rw-r--r-- 1 appsvc appsvc 12884901888 Aug 14 02:14 /var/log/app/app.log\n' +
        ' 430080 2.1G -rw-r--r-- 1 appsvc appsvc 2202009600 Aug 13 00:00 /var/log/app/app.log-20260813\n' +
        ' 409600  2G -rw-r--r-- 1 appsvc appsvc 2097152000 Aug 12 00:00 /var/log/app/app.log-20260812',
    mark:['12884901888 Aug 14 02:14 /var/log/app/app.log'],
    note:'`-xdev` keeps it on this filesystem, `-ls` prints the size and owner inline so you do not need a second command. One 12G active log plus rotations that were never cleaned is the classic shape.' },
  { out:'COMMAND   PID   USER   FD   TYPE DEVICE  SIZE/OFF    NODE NAME\n' +
        'java    14882 appsvc    7w   REG  259,1 8589934592 1049234 /var/log/app/app.log.1 (deleted)',
    mark:['(deleted)', '8589934592'],
    note:'The case that makes `df` and `du` disagree: someone ran `rm` on a log a process still holds open, so the name is gone but the blocks are not. `df` stays full, `du` says the space is free. Restarting the holder — or truncating instead — is the fix.' },
  { out:'# truncate keeps the inode, so the writer carries on into an empty file:\n' +
        '$ truncate -s 0 /var/log/app/app.log\n' +
        '$ df -h /var\nFilesystem      Size  Used Avail Use% Mounted on\n/dev/nvme1n1     20G  8.1G   12G  41% /var',
    mark:['41% /var'],
    note:'Verify with `df` immediately — if the number does not move, the space is held by a deleted-but-open file and you are on the previous step. Never `rm` a log a service is writing to; truncate or use logrotate\'s copytruncate.' },
  { out:'$ journalctl --disk-usage\nArchived and active journals take up 3.9G in the file system.\n\n' +
        '$ logrotate -d /etc/logrotate.d/app\nreading config file /etc/logrotate.d/app\n' +
        'rotating pattern: /var/log/app/*.log  after 1 days (0 rotations)\n' +
        'considering log /var/log/app/app.log\n  log does not need rotating (log has been rotated at 2026-8-14 0:0)',
    mark:['3.9G', '(0 rotations)'],
    note:'`-d` is a dry run — it tells you what logrotate would do without doing it. `rotate 0` here means rotations are discarded immediately, which is why nothing ever got cleaned up. Cap the journal with SystemMaxUse= in journald.conf.' }
];

LX.pbOut['pb-cpu'] = [
  { out:'$ uptime\n 15:41:02 up 41 days,  2 users,  load average: 7.94, 7.61, 6.20\n' +
        '$ nproc\n2\n' +
        '$ top -b -n1 | head\ntop - 15:41:20 up 41 days,  2 users,  load average: 7.94, 7.61, 6.20\n' +
        'Tasks: 128 total,   4 running, 124 sleeping\n' +
        '%Cpu(s): 94.2 us,  3.1 sy,  0.0 ni,  2.1 id,  0.4 wa',
    mark:['load average: 7.94', '$ nproc\n2', '94.2 us', '2.1 id'],
    note:'Load 7.94 on 2 cores is roughly 4x oversubscribed, and `94.2 us` says the time is going to user code rather than the kernel or I/O wait. State the pair out loud — a load figure without the core count is not a finding.' },
  { out:'    PID USER     %CPU %MEM STAT COMMAND\n' +
        '  18422 appsvc   382.0 12.1 Rl   /usr/bin/java -jar /opt/app/app.jar\n' +
        '  19003 appsvc     6.1  1.2 S    /usr/bin/python3 /opt/app/worker.py\n' +
        '   3301 root       0.1  0.4 Ss   /usr/sbin/rsyslogd -n',
    mark:['382.0', '12.1 Rl'],
    note:'%CPU above 100 is normal and useful: it is per-core, so 382% means roughly four threads pinned. `Rl` marks it multi-threaded and running, which is what sends you to the thread view rather than blaming the process as a whole.' },
  { out:'   PID    TID %CPU STAT COMMAND\n' +
        ' 18422  18422  0.4 Sl   java\n' +
        ' 18422  18455 99.1 Rl   java\n' +
        ' 18422  18456 98.7 Rl   java\n' +
        ' 18422  18457 97.9 Rl   java\n' +
        ' 18422  18461  1.2 Sl   java',
    mark:['99.1', '98.7', '97.9'],
    note:'Three threads at ~100% and the rest idle is a hot loop or a stuck GC, not general load. Those TIDs are what you hand to a thread dump — `jstack 18422` for a JVM, `perf top -t 18455` otherwise — to name the actual code.' },
  { out:'                 STARTED     ELAPSED COMMAND\n' +
        'Fri Aug 14 09:12:41 2026    06:28:44 /usr/bin/java -jar /opt/app/app.jar',
    mark:['06:28:44'],
    note:'Age against the incident timeline. A process that started six hours ago did not cause a spike that began ten minutes ago — that reframes it as load or input, not a bad deploy. A process younger than the symptom is the prime suspect.' },
  { out:'Aug 14 15:29:03 ip-10-0-2-8 app[18422]: WARN queue depth 41200 (threshold 5000)\n' +
        'Aug 14 15:29:03 ip-10-0-2-8 app[18422]: INFO  retry storm: 8104 retries in 60s\n\n' +
        '$ strace -c -p 18422\n% time     seconds  usecs/call     calls    errors syscall\n' +
        ' 71.20    4.812031          38    126104     42011 futex\n' +
        ' 18.44    1.246118          12    103842           epoll_wait',
    mark:['queue depth 41200', 'futex', '42011'],
    note:'Correlation is what turns "CPU is high" into a cause. A retry storm plus heavy `futex` time with errors is lock contention — threads burning CPU fighting each other rather than doing work. Note `strace -c` pauses the process; use it briefly and say so.' },
  { out:'$ sudo renice -n 19 -p 18422\n18422 (process ID) old priority 0, new priority 19\n' +
        '$ sudo ionice -c3 -p 18422\n$ uptime\n 15:47:11 up 41 days,  2 users,  load average: 3.11, 6.02, 6.10',
    mark:['new priority 19', 'load average: 3.11'],
    note:'Contain first, then diagnose with the box usable again — and re-measure rather than assuming. Say out loud that this is mitigation: the durable fix is the lock contention or the queue, not the nice value.' }
];

LX.pbOut['pb-load'] = [
  { out:'$ uptime\n 15:41:02 up 41 days,  2 users,  load average: 14.72, 11.90, 7.44\n$ nproc\n4',
    mark:['14.72, 11.90, 7.44', '$ nproc\n4'],
    note:'Read the three numbers as a trend: 1-minute well above 15-minute means it is still getting worse, so this is live rather than a passed spike. 14.72 on 4 cores is real saturation — but of what is still open.' },
  { out:'D  20114     1 tar -czf /data/backups/data-2026-08-14.tgz /data/app\n' +
        'D   8123     1 /usr/bin/java -jar /opt/app/app.jar\n' +
        'D   8140     1 /usr/bin/java -jar /opt/app/worker.jar',
    mark:['D  20114', 'D   8123', 'D   8140'],
    note:'This is the fact that explains a high load with an idle CPU: Linux counts uninterruptible-sleep (D state) tasks in the load average, and D means blocked on I/O. Three blocked processes with the CPU idle is a storage problem wearing a CPU problem\'s clothes.' },
  { out:'procs -----------memory---------- ---swap-- -----io---- -system-- ------cpu-----\n' +
        ' r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st\n' +
        ' 0  3      0 411648  10240 10497024    0    0  1204 198420 4021 6540  5  4  3 88  0',
    mark:[' 0  3      0 411648', '198420', ' 88  0'],
    note:'Three columns settle it: `b` is the blocked count, `wa` is 88% iowait, and `bo` shows nearly 200MB/s going out to disk. `si`/`so` at zero rules out swapping, so it is not memory.' },
  { out:'Device      r/s     w/s     rkB/s     wkB/s   await  aqu-sz   %util\n' +
        'nvme0n1     2.1     8.4      18.2      96.0    0.44    0.01     1.8\n' +
        'nvme1n1    14.0  1880.6     210.0  200714.0  240.18   18.62   100.0',
    mark:['240.18', '100.0', 'nvme1n1'],
    note:'One device saturated, the other idle — so it is a volume, not the host. `await` at 240ms is the latency your application actually feels; `%util` alone can mislead on SSDs, which is why you quote both.' },
  { out:'kernel: nvme nvme1: I/O 421 QID 3 timeout, aborting\n' +
        'kernel: EXT4-fs warning (device nvme1n1): ext4_end_bio: I/O error 10 writing to inode 1049234\n\n' +
        '# a healthy box prints nothing relevant here at all',
    mark:['timeout, aborting', 'I/O error'],
    note:'Always check whether the device itself is failing before you blame a workload. On EBS a saturated volume usually means provisioned IOPS exhausted rather than hardware — in that case the fix is volume type or size, not scheduling.' }
];

LX.pbOut['pb-slow'] = [
  { out:'$ uptime\n 14:02:41 up 12 days,  1 user,  load average: 3.90, 3.44, 2.98\n$ nproc\n4\n' +
        '$ systemctl status myapp\n     Active: active (running) since Wed 2026-08-12 09:02:11 UTC; 2 days ago\n   Main PID: 8123 (java)',
    mark:['load average: 3.90', '$ nproc\n4', 'active (running)'],
    note:'Establish two things before touching a tool: the service is genuinely up (so this is degradation, not an outage) and load is around one per core (so there is pressure but not collapse). "Slow" with a healthy load points at a dependency rather than this box.' },
  { out:'top - 14:02:55 up 12 days,  1 user,  load average: 3.90, 3.44, 2.98\n' +
        '%Cpu(s): 22.1 us,  6.4 sy,  0.0 ni, 62.0 id,  9.1 wa\n' +
        '  PID USER    PR NI    VIRT    RES  %CPU  %MEM COMMAND\n' +
        ' 8123 appsvc  20  0 9112044 5041220  61.2  31.2 java',
    mark:['62.0 id', '9.1 wa', '61.2'],
    note:'62% idle with 9% iowait means neither the CPU nor the disk is the wall — which is the useful negative result. Keep going down the list rather than stopping at the first plausible-looking number.' },
  { out:'               total        used        free      shared  buff/cache   available\n' +
        'Mem:            15Gi       5.0Gi       402Mi        21Mi        10Gi       9.7Gi\n' +
        'Swap:          2.0Gi          0B       2.0Gi',
    mark:['9.7Gi', 'Swap:          2.0Gi          0B'],
    note:'9.7Gi available and no swap used: memory is comfortably ruled out. Say that explicitly in an interview — narrating what you eliminated and why is most of the score.' },
  { out:'Aug 14 13:58:12 ip-10-0-5-9 app[8123]: WARN upstream payments.internal took 8422ms (threshold 2000ms)\n' +
        'Aug 14 13:59:40 ip-10-0-5-9 app[8123]: WARN upstream payments.internal took 9110ms (threshold 2000ms)\n' +
        'Aug 14 14:01:02 ip-10-0-5-9 app[8123]: WARN connection pool exhausted, 0 of 20 free',
    mark:['payments.internal took 8422ms', 'connection pool exhausted'],
    note:'The application usually knows. A slow upstream plus an exhausted pool is a complete causal chain — requests pile up waiting on a dependency, so the pool drains, so everything queues. The box is fine; its dependency is not.' },
  { out:'Filesystem      Size  Used Avail Use% Mounted on\n/dev/nvme0n1p1   30G  9.1G   21G  31% /\n\n' +
        'Filesystem      Inodes  IUsed   IFree IUse% Mounted on\n/dev/nvme0n1p1 1966080  88400 1877680    5% /',
    mark:['31% /', '5% /'],
    note:'Both clean, so storage capacity is out. This step costs two seconds and removes a whole branch — a filesystem near full slows writes long before it errors.' },
  { out:'Device      r/s     w/s     rkB/s   wkB/s  await  aqu-sz  %util\n' +
        'nvme0n1    18.2    41.0     420.6  1204.0   1.12    0.09    4.4',
    mark:['1.12', '4.4'],
    note:'Sub-millisecond await and 4% util: the disk is asleep. Combined with the idle CPU and free memory, everything local is now excluded, which is what makes the network step next rather than a guess.' },
  { out:'$ ss -s\nTotal: 428\nTCP:   381 (estab 44, closed 289, orphaned 0, timewait 287)\n\n' +
        '$ curl -o /dev/null -s -w "connect %{time_connect}s  ttfb %{time_starttransfer}s  total %{time_total}s\\n" http://payments.internal/health\n' +
        'connect 0.002s  ttfb 8.431s  total 8.433s',
    mark:['ttfb 8.431s', 'connect 0.002s'],
    note:'This is the proof. Connect is instant, so the network and the listener are fine; time-to-first-byte is 8.4 seconds, so the remote application is the slow part. That distinction — connect versus TTFB — is the whole answer, and it moves the incident to another team with evidence.' }
];

LX.pbOut['pb-listen'] = [
  { out:'State  Recv-Q Send-Q Local Address:Port Peer Address:Port Process\n' +
        'LISTEN 0      4096       127.0.0.1:8080       0.0.0.0:*     users:(("myapp",pid=8123,fd=7))',
    mark:['127.0.0.1:8080'],
    note:'The address is the finding, not the port. `127.0.0.1:8080` accepts only connections originating on this host; `0.0.0.0:8080` accepts them from anywhere. No output at all means nothing is listening and the problem is the service, not the network.' },
  { out:'*   Trying 127.0.0.1:8080...\n* Connected to 127.0.0.1 (127.0.0.1) port 8080\n' +
        '> GET /health HTTP/1.1\n< HTTP/1.1 200 OK\n{"status":"ok"}',
    mark:['Connected to 127.0.0.1', '200 OK'],
    note:'A 200 from localhost proves the application works and narrows the problem to reachability. This is the step that stops you debugging the app when the app is fine.' },
  { out:'*   Trying 10.0.3.77:8080...\n* connect to 10.0.3.77 port 8080 failed: Connection refused\n' +
        '* Failed to connect to 10.0.3.77 port 8080 after 2 ms: Connection refused',
    mark:['Connection refused', 'after 2 ms'],
    note:'Refused versus timeout is the fork. **Refused** and instant means the packet arrived and nothing was listening on that address — a bind problem. **Timeout** means it never arrived — a firewall, security group or route problem. Two milliseconds says refused.' },
  { out:'$ getent hosts app.example.com\n10.0.3.77       app.example.com\n' +
        '$ dig +short app.example.com\n10.0.3.77',
    mark:['10.0.3.77'],
    note:'Run both, because they answer different questions. `dig` asks DNS directly; `getent` goes through NSS the way an application does, consulting /etc/hosts first. When they disagree, the gap is your bug.' },
  { out:'$ ip route\ndefault via 10.0.3.1 dev eth0 proto dhcp metric 100\n10.0.3.0/24 dev eth0 proto kernel scope link src 10.0.3.77\n\n' +
        '$ ip route get 10.0.3.77\nlocal 10.0.3.77 dev lo src 10.0.3.77 uid 1000',
    mark:['local 10.0.3.77 dev lo'],
    note:'`ip route get` shows the route the kernel would actually pick for one destination, which beats reading the table by eye. `dev lo` here means the traffic never leaves the host — worth knowing before you go looking at security groups.' },
  null
];

LX.pbOut['pb-dns'] = [
  { out:'$ cat /etc/resolv.conf\nsearch ec2.internal\nnameserver 10.0.0.2\noptions timeout:2 attempts:5\n\n' +
        '# on a systemd-resolved host the file often points at a local stub:\nnameserver 127.0.0.53',
    mark:['nameserver 10.0.0.2', '127.0.0.53'],
    note:'Start here so you know who you are actually asking. `127.0.0.53` means systemd-resolved is in the path and the real upstream is in `resolvectl status`, not this file — a distinction that changes every command after it.' },
  { out:'$ getent hosts app.example.com\n# (no output, exit status 2)\n\n' +
        '# when it does work:\n10.0.3.77       app.example.com',
    mark:['(no output, exit status 2)'],
    note:'This is the one that matches what your application sees, because it goes through NSS. If `getent` fails but `dig` succeeds, DNS is fine and the problem is nsswitch.conf, /etc/hosts, or the resolver library — not the DNS server.' },
  { out:'$ dig +short app.example.com\n# (empty)\n\n' +
        '$ dig @10.0.0.2 app.example.com\n;; ->>HEADER<<- opcode: QUERY, status: NXDOMAIN, id: 44821\n' +
        ';; QUESTION SECTION:\n;app.example.com.               IN      A\n;; AUTHORITY SECTION:\n' +
        'example.com.  60  IN  SOA  ns-1.example.com. root.example.com. 2026081401 7200 900 1209600 60',
    mark:['NXDOMAIN'],
    note:'`NXDOMAIN` means the name genuinely does not exist — a typo, or a record never created. `SERVFAIL` means the resolver broke trying. `status: NOERROR` with an empty answer means the name exists but has no record of that type. Three different bugs, three different next steps.' },
  { out:'$ grep -n app.example.com /etc/hosts\n12:10.0.9.99   app.example.com   # temporary, added during the Aug 2 incident\n\n' +
        '$ cat /etc/nsswitch.conf\nhosts:      files dns myhostname',
    mark:['10.0.9.99', 'files dns'],
    note:'`files dns` means /etc/hosts wins over DNS every time. A stale entry someone added during an old incident is the classic cause of "dig resolves it correctly but the app still connects to the wrong box".' },
  { out:'$ nc -zvu 10.0.0.2 53\nConnection to 10.0.0.2 53 port [udp/domain] succeeded!\n\n' +
        '# when the resolver is unreachable:\n' +
        ';; communications error to 10.0.0.2#53: timed out\n;; no servers could be reached',
    mark:['succeeded!', 'no servers could be reached'],
    note:'Distinguish "the resolver answered and said no" from "the resolver never answered". A timeout here is a network or security-group problem, and on EC2 the VPC resolver is always the base of the CIDR plus two — 10.0.0.2 for a 10.0.0.0/16.' }
];

LX.pbOut['pb-port'] = [
  { out:'10.0.1.10       host.example.com',
    mark:['10.0.1.10'],
    note:'Resolve first so you know which address you are actually testing. Half of "the port is closed" reports are the client having reached the wrong host entirely.' },
  { out:'$ ss -lntp | grep :443\nLISTEN 0 4096 0.0.0.0:443 0.0.0.0:* users:(("nginx",pid=1902,fd=6))\n\n' +
        '# and when nothing is bound, ss prints nothing at all',
    mark:['0.0.0.0:443'],
    note:'Run this on the destination host. Bound to `0.0.0.0` means it will accept from anywhere; empty output means the listener is the problem and no amount of firewall work will help.' },
  { out:'Ncat: Connected to 10.0.1.10:443.\n' +
        'Ncat: 0 bytes sent, 0 bytes received in 0.01 seconds.\n\n' +
        '# the two failure modes:\n' +
        'Ncat: Connection refused.\nNcat: Connection timed out.',
    mark:['Connected to 10.0.1.10:443', 'Connection refused.', 'Connection timed out.'],
    note:'This is the single most useful test in the tree. **Connected** = TCP is fine, so the problem is above it. **Refused** = the packet arrived, nothing listening. **Timed out** = the packet was dropped, which is a security group, NACL or host firewall. Refused and timed out are never the same bug.' },
  { out:'* Connected to host.example.com (10.0.1.10) port 443\n' +
        '* SSL certificate problem: certificate has expired\n' +
        '*  subject: CN=host.example.com\n*  expire date: Aug  9 00:00:00 2026 GMT',
    mark:['certificate has expired', 'expire date: Aug  9 00:00:00 2026 GMT'],
    note:'Once TCP connects, everything remaining is application or TLS. `-k` deliberately ignores certificate errors: if it works with `-k` and fails without, you have found a certificate problem rather than a connectivity one.' },
  { out:'$ ip route get 10.0.1.10\n10.0.1.10 via 10.0.3.1 dev eth0 src 10.0.3.77 uid 1000\n\n' +
        '$ tracepath 10.0.1.10\n 1?: [LOCALHOST]           pmtu 9001\n 1:  10.0.3.1              0.412ms\n 2:  10.0.1.10             1.204ms reached',
    mark:['via 10.0.3.1 dev eth0', 'reached'],
    note:'Only worth doing when the test above timed out. It tells you whether the packet even has a path — and inside one VPC it almost always does, which is what points you at the security group rather than routing.' },
  null
];

LX.pbOut['pb-unhealthy'] = [
  { out:'    PID STAT WCHAN              ELAPSED COMMAND\n' +
        '   8123 Dl   rpc_wait_bit_killable  06:41:12 /usr/bin/java -jar /opt/app/app.jar',
    mark:['8123 Dl', 'rpc_wait_bit_killable'],
    note:'`STAT` is the fastest read in the tree: **D** is blocked on I/O and cannot even be killed, **Z** is a zombie its parent never reaped, **T** is stopped. `WCHAN` names the kernel function it is waiting in — here an RPC wait, which usually means a hung NFS mount.' },
  { out:'# nothing — the process exists but is not bound to anything\n\n' +
        '# what a healthy one looks like:\nLISTEN 0 4096 0.0.0.0:8080 0.0.0.0:* users:(("myapp",pid=8123,fd=7))',
    mark:['nothing'],
    note:'A running process with no listening socket is the definition of this playbook: the supervisor thinks the service is up because the PID exists, while nothing can actually reach it. This is the argument for health checks that make a request rather than checking liveness.' },
  { out:'* Connected to 127.0.0.1 port 8080\n> GET /health HTTP/1.1\n' +
        '< HTTP/1.1 503 Service Unavailable\n{"status":"degraded","db":"unreachable","cache":"ok"}',
    mark:['503 Service Unavailable', '"db":"unreachable"'],
    note:'A good health endpoint names its own failed dependency and saves you the next three commands. Note the process is answering — so it is alive, listening, and failing, which is a different problem from any of the three alone.' },
  { out:'Aug 14 14:31:02 ip-10-0-4-9 app[8123]: ERROR db pool: could not acquire connection after 30000ms\n' +
        'Aug 14 14:31:02 ip-10-0-4-9 app[8123]: WARN  health: marking db unreachable\n' +
        'Aug 14 14:31:33 ip-10-0-4-9 app[8123]: ERROR db pool: could not acquire connection after 30000ms',
    mark:['could not acquire connection', 'marking db unreachable'],
    note:'The log confirms what the health endpoint claimed and adds the timing. Repeating identically every 30 seconds means a hard failure rather than intermittent pressure.' },
  { out:'$ nc -zv db.internal 5432\nNcat: Connection timed out.\n\n' +
        '$ dig +short db.internal\n10.0.5.40\n\n' +
        '$ curl -o /dev/null -s -w "connect %{time_connect}s\\n" http://api.internal/health\nconnect 0.003s',
    mark:['Connection timed out.', '10.0.5.40'],
    note:'DNS resolves but TCP times out: the name is right and the packets are being dropped, which is a security group or firewall on the database side. The other dependency connects instantly, which rules out this host\'s networking generally.' }
];

LX.pbOut['pb-fd'] = [
  { out:'1024',
    mark:['1024'],
    note:'Count first so you know whether you are near a limit or nowhere close. Compare it against the limit in the next step — a raw number on its own means nothing.' },
  { out:'Limit                     Soft Limit           Hard Limit           Units\n' +
        'Max open files            1024                 524288               files',
    mark:['1024', '524288'],
    note:'Read the limit from `/proc/PID/limits`, not from `ulimit -n` in your shell — your shell is a different process with different limits. A soft limit of 1024 against a hard limit of 524288 means nobody raised it, which is the common case for a systemd service ignoring /etc/security/limits.conf.' },
  { out:'    814 sock\n    142 REG\n     51 IPv4\n     12 FIFO\n      5 CHR',
    mark:['814 sock'],
    note:'The type breakdown names the leak. Mostly `sock` is un-closed connections — a client without a connection pool, or one that never closes responses. Mostly `REG` is files left open. The fix follows from which it is, and raising the limit fixes neither.' },
  { out:'$ cat /proc/sys/fs/file-nr\n8544	0	9223372036854775807\n$ sysctl fs.file-max\nfs.file-max = 9223372036854775807',
    mark:['8544'],
    note:'The three numbers are allocated, unused, and the maximum. This checks whether the whole host is out of descriptors or just this process — almost always just the process, which keeps the fix scoped to one unit instead of a sysctl change.' },
  { out:'$ sudo systemctl edit myapp\n# adds /etc/systemd/system/myapp.service.d/override.conf:\n[Service]\nLimitNOFILE=65535\n\n' +
        '$ sudo systemctl daemon-reload && sudo systemctl restart myapp\n' +
        '$ grep -i "open files" /proc/$(pgrep -f myapp)/limits\nMax open files            65535                65535                files',
    mark:['LimitNOFILE=65535', '65535                65535'],
    note:'`systemctl edit` writes a drop-in rather than editing the packaged unit, so a package upgrade will not undo it. Verify from /proc afterwards — this is the step people skip, and the limit silently staying at 1024 is common. Say clearly that raising the ceiling buys time; a leak still needs fixing.' }
];

LX.pbOut['pb-file-access'] = [
  { out:'uid=1002(alice) gid=1002(alice) groups=1002(alice),10(wheel)\n' +
        'alice : alice wheel',
    mark:['groups=1002(alice),10(wheel)'],
    note:'Establish who they actually are before looking at the file. Note what is *not* here — if the file needs group `appdata` and alice is not in it, you already have your answer without reading a single permission bit.' },
  { out:'-rw-r----- 1 root appdata 4096 Aug 14 09:12 /srv/app/config.yaml\n\n' +
        '  File: /srv/app/config.yaml\n  Size: 4096   Blocks: 8   IO Block: 4096   regular file\n' +
        'Access: (0640/-rw-r-----)  Uid: (    0/    root)   Gid: (  109/ appdata)',
    mark:['-rw-r-----', 'appdata', '(0640/-rw-r-----)'],
    note:'`0640` means owner reads and writes, group reads, everyone else gets nothing. alice is not root and not in `appdata`, so she falls into "other" and is denied. `stat` says the same thing as `ls -l` but spells out the octal, which is easier to reason about.' },
  { out:'f: /srv/app/config.yaml\n' +
        ' drwxr-xr-x root root    /\n' +
        ' drwxr-xr-x root root    srv\n' +
        ' drwx------ root root    app\n' +
        '                         config.yaml - Permission denied',
    mark:['drwx------ root root    app', 'Permission denied'],
    note:'The step that catches what `ls -l` on the file never shows. Reaching a file requires execute (search) permission on **every** directory above it, so a 0700 directory two levels up denies a user who can read the file perfectly well. namei walks the whole chain in one line.' },
  { out:'# file: srv/app/config.yaml\n# owner: root\n# group: appdata\n' +
        'user::rw-\nuser:alice:---\ngroup::r--\nmask::r--\nother::---',
    mark:['user:alice:---'],
    note:'A trailing `+` on the `ls -l` mode is the hint that ACLs exist. An explicit deny for alice overrides anything the ordinary bits would allow — and it is invisible unless you look here.' },
  null,
  { out:'$ getenforce\nEnforcing\n\n' +
        '$ sudo ausearch -m avc -ts recent\ntype=AVC msg=audit(1755172800.412:2201): avc:  denied  { read } for  pid=8123 comm="myapp"\n' +
        '  name="config.yaml" dev="nvme0n1p1" ino=1049234 scontext=system_u:system_r:httpd_t:s0\n' +
        '  tcontext=unconfined_u:object_r:default_t:s0 tclass=file permissive=0',
    mark:['Enforcing', 'avc:  denied  { read }', 'default_t'],
    note:'The explanation for "the permissions are definitely right and it still fails". The context mismatch — a process in `httpd_t` reading a file labelled `default_t` — is the denial. `restorecon -v` relabels it; never fix this by disabling SELinux.' },
  { out:'$ sudo chgrp appdata /srv/app/config.yaml\n$ sudo chmod g+r /srv/app/config.yaml\n' +
        '$ sudo -u alice cat /srv/app/config.yaml | head -1\nserver:',
    mark:['sudo -u alice'],
    note:'Make the smallest change that fits the model — add the user to the group, or fix the group on the file — and never `chmod 777`. Then verify as the affected user rather than as root, because root ignores exactly the checks you were trying to fix.' }
];

LX.pbOut['pb-proc-user'] = [
  { out:'8123 /usr/local/bin/myapp --config /etc/myapp/config.yml\n' +
        '\n# ps -ef | grep [m]yapp\nappsvc    8123     1  1 09:02 ?  00:04:12 /usr/local/bin/myapp --config /etc/myapp/config.yml',
    mark:['8123', 'appsvc'],
    note:'`pgrep -af` gives the PID and the full command line without the grep matching itself. The `[m]yapp` bracket trick does the same for `ps -ef | grep` — the pattern no longer matches its own process.' },
  { out:'USER     EUSER    GROUP    EGROUP     PID  PPID COMMAND\n' +
        'appsvc   appsvc   appsvc   appdata   8123     1 /usr/local/bin/myapp',
    mark:['EGROUP', 'appdata'],
    note:'Real and effective identity can differ — that is what setuid binaries and `sudo` do. The effective one is what the kernel checks for file access, so `euser`/`egroup` is the column that decides whether a permission error makes sense.' },
  { out:'User=appsvc\nGroup=appsvc',
    mark:['User=appsvc'],
    note:'This is the declared identity, and it is the one that survives a restart. If it is empty the unit runs as root, which is worth flagging on its own.' },
  { out:'Uid:\t1001\t1001\t1001\t1001\nGid:\t1001\t1009\t1009\t1001',
    mark:['Uid:\t1001\t1001\t1001\t1001', '1009'],
    note:'Straight from the kernel, so nothing can misreport it. The four columns are real, effective, saved and filesystem. The Gid row differing between real (1001) and effective (1009) is a setgid binary — exactly the case `ps` alone would leave you guessing about.' },
  { out:'$ namei -l /srv/app/data/file\nf: /srv/app/data/file\ndrwxr-xr-x root   root   /\n' +
        'drwxr-xr-x root   root   srv\ndrwxr-x--- root   appdata app\n-rw-r----- root   appdata file\n\n' +
        '$ sudo -u appsvc test -r /srv/app/data/file && echo readable || echo denied\nreadable',
    mark:['appdata', 'readable'],
    note:'Test as the identity you just established, not as yourself. `sudo -u <user> test -r` gives a plain yes or no in one line and is the fastest way to close the loop.' }
];

LX.pbOut['pb-root-vs-user'] = [
  { out:'uid=1001(svcuser) gid=1001(svcuser) groups=1001(svcuser)',
    mark:['groups=1001(svcuser)'],
    note:'Read the group list first. Root passes almost every check regardless, so the interesting question is always which groups the service account is missing — here it belongs to nothing but its own.' },
  { out:'$ sudo -u svcuser /usr/local/bin/myapp --check\n' +
        'error: open /srv/app/data/state.db: permission denied\n\n' +
        '# the same command as root:\n$ sudo /usr/local/bin/myapp --check\nok',
    mark:['permission denied', '--check\nok'],
    note:'Reproduce it as the right identity before theorising. Running as root and getting `ok` is not evidence the app works — it is evidence that root bypasses the check. `sudo -u` is how you see what the service sees.' },
  { out:'f: /srv/app/data/state.db\ndrwxr-xr-x root root    /\ndrwxr-xr-x root root    srv\n' +
        'drwxr-xr-x root root    app\ndrwxrwx--- root appdata data\n-rw-rw---- root appdata state.db',
    mark:['drwxrwx--- root appdata data', 'appdata'],
    note:'Both the directory and the file are group `appdata`, and svcuser is not in it. Root does not care; svcuser does. This is the single most common shape of this bug.' },
  { out:'User=svcuser\nGroup=svcuser\nEnvironment=\nWorkingDirectory=/',
    mark:['Environment=', 'WorkingDirectory=/'],
    note:'The second most common cause after groups: a service inherits none of your interactive shell environment. An empty `Environment=` means no PATH additions, no JAVA_HOME, no proxy variables — things that work in your terminal simply do not exist here.' },
  { out:'$ getenforce\nEnforcing\n$ sudo ausearch -m avc -ts recent\n' +
        'type=AVC msg=audit(1755172800.412:2201): avc: denied { write } for pid=8123 comm="myapp"\n' +
        '  scontext=system_u:system_r:init_t:s0 tcontext=unconfined_u:object_r:default_t:s0 tclass=file',
    mark:['Enforcing', 'avc: denied { write }'],
    note:'Check this last, and only when the ordinary model says it should have worked. Nothing in `ls -l` hints at an SELinux denial, which is why it is the answer to "the permissions are correct and it still fails".' }
];

LX.pbOut['pb-readonly'] = [
  { out:'  File: /var/lib/app/data\n  Size: 4096   Blocks: 8   IO Block: 4096   directory\n' +
        'Access: (0755/drwxr-xr-x)  Uid: ( 1001/ appsvc)   Gid: ( 1001/ appsvc)\n\n' +
        '$ namei -l /var/lib/app/data\ndrwxr-xr-x root   root   /\ndrwxr-xr-x root   root   var\n' +
        'drwxr-xr-x root   root   lib\ndrwxr-xr-x appsvc appsvc app\ndrwxr-xr-x appsvc appsvc data',
    mark:['(0755/drwxr-xr-x)', 'appsvc appsvc data'],
    note:'Clear the obvious explanation first. Correct owner, correct mode, whole path traversable — so ordinary permissions are ruled out and everything below becomes worth checking.' },
  { out:'TARGET        SOURCE         FSTYPE OPTIONS\n' +
        '/var/lib/app  /dev/nvme1n1   ext4   ro,relatime,errors=remount-ro',
    mark:['ro,relatime', 'errors=remount-ro'],
    note:'There it is: the filesystem is mounted **ro**. `errors=remount-ro` tells you why — the kernel hit an I/O error and remounted read-only to protect the data. This is a symptom of a failing volume, so remounting rw without investigating just loses the warning.' },
  { out:'Filesystem      Size  Used Avail Use% Mounted on\n/dev/nvme1n1     20G   14G  5.1G  74% /var/lib/app\n\n' +
        'Filesystem      Inodes  IUsed   IFree IUse% Mounted on\n/dev/nvme1n1   1310720 1310720      0  100% /var/lib/app',
    mark:['74%', '100% /var/lib/app'],
    note:'The trap this step exists for: 5.1G free and still "No space left on device", because every inode is used. Blocks and inodes are separate budgets and only `df -i` shows the second one.' },
  { out:'kernel: nvme nvme1: I/O 918 QID 2 timeout, aborting\n' +
        'kernel: EXT4-fs error (device nvme1n1): ext4_journal_check_start:83: Detected aborted journal\n' +
        'kernel: EXT4-fs (nvme1n1): Remounting filesystem read-only',
    mark:['Detected aborted journal', 'Remounting filesystem read-only'],
    note:'The kernel explains itself here and nowhere else. An aborted journal followed by a read-only remount is a storage fault, not a configuration mistake — the next step is a snapshot and a filesystem check, not a `mount -o remount,rw`.' },
  { out:'$ lsattr /var/lib/app/data/state.db\n----i---------e---- /var/lib/app/data/state.db\n' +
        '$ getfacl /var/lib/app/data/state.db\nuser::rw-\nuser:appsvc:r--\nmask::r--\n' +
        '$ getenforce\nEnforcing',
    mark:['----i---------e----', 'user:appsvc:r--'],
    note:'Three blockers that are all invisible to `ls -l`. The `i` attribute is immutable — nobody may write it, root included, until `chattr -i`. An ACL can deny where the mode bits allow. And SELinux can deny both.' }
];

LX.pbOut['pb-deploy'] = [
  { out:'Aug 17 14:02:11 ip-10-0-2-8 systemd[1]: Stopped myapp.service.\n' +
        'Aug 17 14:02:14 ip-10-0-2-8 systemd[1]: Started myapp.service.\n' +
        'Aug 17 14:02:16 ip-10-0-2-8 app[31022]: INFO  version=2.14.0 (was 2.13.4)\n' +
        'Aug 17 14:04:02 ip-10-0-2-8 app[31022]: ERROR upstream timeout after 30s\n' +
        'Aug 17 14:04:33 ip-10-0-2-8 app[31022]: ERROR upstream timeout after 30s',
    mark:['version=2.14.0 (was 2.13.4)', 'ERROR upstream timeout'],
    note:'Anchor to the deploy time and read forward. Errors that begin *after* the restart and not before are correlation worth acting on — errors present on both sides of it mean you are looking at the wrong change.' },
  { out:'     Active: active (running) since Mon 2026-08-17 14:02:14 UTC; 9min ago\n   Main PID: 31022 (myapp)\n\n' +
        '$ systemctl show myapp -p NRestarts\nNRestarts=0',
    mark:['active (running)', 'NRestarts=0'],
    note:'Up and stable, so this is a behaviour regression rather than a crash — which rules out the crash-loop branch entirely and keeps you on config and resources.' },
  { out:'    PID USER   %CPU %MEM     ELAPSED COMMAND\n' +
        '  31022 appsvc 71.2 44.1       09:14 /usr/local/bin/myapp\n\n' +
        '# same host, the previous release:\n  28114 appsvc 12.0 18.2    3-04:11:02 /usr/local/bin/myapp',
    mark:['71.2 44.1', '12.0 18.2'],
    note:'A before-and-after is the argument. 12% CPU and 18% memory becoming 71% and 44% on the same host with the same traffic is a regression you can put in a ticket without further debate.' },
  { out:'--- config/app.yaml (2.13.4)\n+++ config/app.yaml (2.14.0)\n' +
        '@@ -8,7 +8,7 @@\n   pool:\n-    max_connections: 50\n+    max_connections: 5\n     timeout_ms: 30000',
    mark:['-    max_connections: 50', '+    max_connections: 5'],
    note:'Diff the config, the package version and the image tag — the actual change is usually one line and usually a typo. A pool of 5 instead of 50 explains both the upstream timeouts and the CPU: everything is queueing.' },
  null
];

LX.pbOut['pb-systemctl-journalctl'] = [
  { out:'● nginx.service - The nginx HTTP and reverse proxy server\n' +
        '     Loaded: loaded (/usr/lib/systemd/system/nginx.service; enabled; preset: disabled)\n' +
        '     Active: active (running) since Fri 2026-08-14 09:02:11 UTC; 6h ago\n' +
        '   Main PID: 1902 (nginx)\n      Tasks: 3 (limit: 4657)\n' +
        '     Memory: 12.4M\n\n' +
        'Aug 14 09:02:11 ip-10-0-2-45 systemd[1]: Started nginx.service.',
    mark:['Loaded: loaded', 'enabled', 'Active: active (running)'],
    note:'Two different words on two different lines. **Loaded/enabled** is whether it starts at boot; **Active** is whether it is running now. A service can be active but disabled — it will vanish after a reboot, which is the answer to "it works until the instance restarts".' },
  { out:'$ sudo systemctl restart nginx\n$ systemctl is-active nginx\nactive\n' +
        '$ systemctl is-enabled nginx\nenabled',
    mark:['active', 'enabled'],
    note:'`is-active` and `is-enabled` print one word and set an exit code, which is what makes them the ones to use in scripts. Prefer `reload` to `restart` where the service supports it — reload keeps connections, restart drops them.' },
  { out:'Aug 14 09:02:11 ip-10-0-2-45 systemd[1]: Starting nginx.service...\n' +
        'Aug 14 09:02:11 ip-10-0-2-45 systemd[1]: Started nginx.service.\n' +
        'Aug 14 14:22:04 ip-10-0-2-45 nginx[1902]: 10.0.3.44 - - [14/Aug/2026:14:22:04] "GET /health" 200 18',
    mark:['systemd[1]', 'nginx[1902]'],
    note:'The journal interleaves systemd\'s own messages with the service\'s output, which is how you tell "systemd could not start it" apart from "it started and then complained". Add `--no-pager` on a small screen and in scripts.' },
  { out:'-- Logs begin at Fri 2026-08-14 14:15:00 UTC. --\n' +
        'Aug 14 14:22:04 ip-10-0-2-45 nginx[1902]: 2026/08/14 14:22:04 [error] 1902#0: *18 upstream timed out',
    mark:['-- Logs begin at Fri 2026-08-14 14:15:00 UTC. --'],
    note:'Always bound the window during an incident — an unbounded journal on a busy host is thousands of lines you have to read past. `--since`/`--until` accept plain English ("15 min ago", "today", "2026-08-14 14:00").' },
  { out:'$ journalctl --list-boots\n 0 4f2a... Fri 2026-08-14 09:01:44 UTC—Fri 2026-08-14 15:41:02 UTC\n' +
        '-1 91cd... Thu 2026-08-13 08:12:07 UTC—Fri 2026-08-14 09:01:02 UTC\n\n' +
        '$ journalctl -b -1 -e\nAug 14 09:00:58 ip-10-0-2-45 kernel: Kernel panic - not syncing',
    mark:['-1 91cd...', 'journalctl -b -1 -e', 'Kernel panic - not syncing'],
    note:'`-b` is this boot, `-b -1` the one before. This is how you investigate a reboot you did not order: the evidence is always in the *previous* boot, and `-e` jumps to the end where the last thing before the crash lives.' }
];

LX.pbOut['pb-pocket'] = [
  { out:'     Active: failed (Result: exit-code) since Fri 2026-08-14 11:42:07 UTC; 3min ago\n' +
        '    Process: 20455 ExecStart=/usr/sbin/nginx (code=exited, status=1/FAILURE)',
    mark:['Active: failed', 'code=exited, status=1/FAILURE'],
    note:'Ten seconds, and it splits the whole tree: exited means the app rejected something, killed means something external ended it.' },
  { out:'Aug 14 11:42:07 ip-10-0-2-45 nginx[20455]: nginx: [emerg] unknown directive in /etc/nginx/nginx.conf:5',
    mark:['[emerg]', '/etc/nginx/nginx.conf:5'],
    note:'Bounded to the incident window. The file and line are usually right here — read before you act.' },
  { out:' 15:41:02 up 41 days,  load average: 7.94, 7.61, 6.20\n4\n' +
        '%Cpu(s): 94.2 us,  3.1 sy,  2.1 id,  0.4 wa',
    mark:['load average: 7.94', '6.20\n4', '94.2 us'],
    note:'Load against cores, then the split. High `us` is your code; high `sy` is the kernel; high `wa` is storage; high load with an idle CPU is blocked I/O.' },
  { out:'               total        used        free      shared  buff/cache   available\n' +
        'Mem:           3.7Gi       2.8Gi       148Mi        21Mi       767Mi       610Mi\n' +
        'Swap:            0Bi         0Bi         0Bi',
    mark:['610Mi', '0Bi'],
    note:'Read available, not free. Then `si`/`so` in vmstat for whether it is actively swapping.' },
  { out:'/dev/nvme1n1     20G   20G     0 100% /var\n' +
        '/dev/nvme1n1   1310720  41003 1269717    4% /var',
    mark:['100% /var', '4% /var'],
    note:'Both, always. Blocks full and inodes full give the identical error message and have completely different fixes.' },
  { out:'Device      r/s     w/s   rkB/s     wkB/s   await  aqu-sz  %util\n' +
        'nvme1n1    14.0  1880.6   210.0  200714.0  240.18   18.62   100.0',
    mark:['240.18', '100.0'],
    note:'`await` is the latency the application feels; `%util` is how busy the device was. Quote both — util alone misleads on SSDs.' },
  { out:'LISTEN 0 4096 127.0.0.1:8080 0.0.0.0:* users:(("myapp",pid=8123,fd=7))\n' +
        'Ncat: Connection timed out.\n10.0.3.77',
    mark:['127.0.0.1:8080', 'Connection timed out.'],
    note:'The address, not the port. Then refused (arrived, nothing listening) versus timeout (dropped by a firewall) — never confuse the two.' },
  { out:'uid=1001(appsvc) gid=1001(appsvc) groups=1001(appsvc)\n' +
        'Access: (0640/-rw-r-----)  Uid: (0/root)   Gid: (109/appdata)\n' +
        'drwx------ root root app        <- denied here',
    mark:['groups=1001(appsvc)', 'drwx------ root root app'],
    note:'Identity, then the file, then the whole path. `namei -l` is the one that finds the directory five levels up that nobody thought to check.' }
];

LX.pbOut['pb-framework'] = [null, null, null, null];
LX.pbOut['pb-talktracks'] = [null, null, null, null, null, null];
