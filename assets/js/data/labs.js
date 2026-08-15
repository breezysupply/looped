/* Interactive labs: pick a command, see realistic output, work the problem.
   step.kind 'cmd'  → the choice is a command; it echoes into the terminal
   step.kind 'think'→ the choice is an interpretation; nothing is executed        */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.labs = LX.labs || [];

LX.labs.push(

/* ───────────────────────────────────────────── 1. disk full ── */
{
  id:'disk-full', title:'/var is 100% full', cat:'disk', level:'beginner',
  mins:6,
  brief:'02:14. Pager: DiskSpaceCritical on ip-10-0-4-118. The application has stopped writing logs and health checks are starting to fail. You have a shell.',
  user:'ec2-user', host:'ip-10-0-4-118',
  steps:[
    { kind:'cmd',
      ask:'Confirm the problem. What do you run first?',
      hint:'Before you go hunting for big files, establish which filesystem is full and by how much.',
      opts:[
        { c:'df -h', ok:true,
          out:'Filesystem      Size  Used Avail Use% Mounted on\ndevtmpfs        3.8G     0  3.8G   0% /dev\n/dev/nvme0n1p1   30G  8.2G   22G  28% /\n/dev/nvme1n1     20G   20G   20K 100% /var\ntmpfs           768M     0  768M   0% /run/user/1000',
          fb:'/var is genuinely full — 20G of 20G, 20K free. Root is fine, so this is contained to one filesystem.',
          parts:[['df','Report free space per mounted filesystem'],['-h','Human-readable sizes (G/M/K) instead of 1K blocks']] },
        { c:'du -sh /var',
          out:'du: cannot read directory ...\n19G\t/var\n\n(took 47 seconds)',
          fb:'It works, but du walks every file — slow, and it does not tell you which filesystem is full or whether inodes are the problem. Start with df.' },
        { c:'top -b -n1 | head',
          out:'top - 02:14:41 up 41 days,  3:02,  1 user,  load average: 0.62, 0.71, 0.68\nTasks: 118 total,   1 running, 117 sleeping\n%Cpu(s):  1.7 us,  0.8 sy,  0.0 ni, 97.1 id,  0.4 wa',
          fb:'CPU and memory look fine — which you would expect, because the alarm was about disk. This tells you nothing about the problem.' },
        { c:'systemctl restart app',
          out:'Job for app.service failed. See "systemctl status app" for details.',
          fb:'Restarting before you understand the failure is a reflex to break. The disk is still full, so it cannot start.' }
      ] },

    { kind:'cmd',
      ask:'Blocks are full. What is the other way a filesystem runs out of space — and how do you rule it out?',
      hint:'A filesystem can be out of one of two things.',
      opts:[
        { c:'df -i', ok:true,
          out:'Filesystem      Inodes  IUsed   IFree IUse% Mounted on\n/dev/nvme0n1p1  15728640 82471 15646169    1% /\n/dev/nvme1n1    10485760 41003 10444757    1% /var',
          fb:'Inode usage is 1% — so this is real block exhaustion, not millions of tiny files. Ruling this out in one command is the mark of someone who has been burned by it.',
          parts:[['df','Filesystem usage report'],['-i','Show inode counts instead of block counts — inodes can run out while space remains']] },
        { c:'lsblk',
          out:'NAME        MAJ:MIN RM SIZE RO TYPE MOUNTPOINT\nnvme0n1     259:0    0  30G  0 disk\n└─nvme0n1p1 259:1    0  30G  0 part /\nnvme1n1     259:2    0  20G  0 disk /var',
          fb:'Confirms the layout — /var is its own 20G volume — but says nothing about why it filled.' },
        { c:'fsck /dev/nvme1n1',
          out:'fsck from util-linux 2.37.4\n/dev/nvme1n1 is mounted.\ne2fsck: Cannot continue, aborting.',
          fb:'Never run a repair on a mounted filesystem, and nothing here suggests corruption. Wrong tool entirely.' }
      ] },

    { kind:'cmd',
      ask:'Find where the space went. Which command narrows it down fastest?',
      hint:'Descend one level at a time rather than scanning everything.',
      opts:[
        { c:'du -h -d1 /var | sort -h', ok:true,
          out:'1.2M\t/var/tmp\n8.4M\t/var/cache\n24M\t/var/lib\n61M\t/var/spool\n19G\t/var/log\n19G\t/var',
          fb:'/var/log is 19 of the 20 gigabytes. One command, one suspect.',
          parts:[['du','Disk usage per directory'],['-h','Human-readable sizes'],['-d1','Depth 1 — summarise each child, do not recurse into every file'],['| sort -h','Sort those human-readable sizes numerically, so the biggest lands last']] },
        { c:'ls -lah /var',
          out:'total 44K\ndrwxr-xr-x 19 root root 4.0K Jun  2 09:12 .\ndrwxr-xr-x  4 root root 4.0K Jan  8 14:41 log\ndrwxr-xr-x 12 root root 4.0K Mar 21 11:02 lib',
          fb:'ls shows the size of the directory entry itself — always about 4K — not the size of its contents. A common trap.' },
        { c:'find /var -type f -size +1G',
          out:'/var/log/app/app.log',
          fb:'Not wrong, and it found something. But it scans the whole tree and misses the case where thousands of medium files add up. du -h -d1 is the faster way in.' },
        { c:'rm -rf /var/log/*',
          out:'(no output)',
          fb:'Never. You just destroyed the evidence you need for the post-incident review, may have deleted audit logs, and probably did not even free the space — see the next step.' }
      ] },

    { kind:'cmd',
      ask:'Drill into /var/log. What is actually consuming it?',
      hint:'You want file names and sizes, not just a directory total.',
      opts:[
        { c:'du -h -d1 /var/log | sort -h | tail -5', ok:true,
          out:'24M\t/var/log/journal\n52M\t/var/log/audit\n180M\t/var/log/nginx\n18G\t/var/log/app\n19G\t/var/log',
          fb:'/var/log/app holds 18G. Keep descending — you are two commands from the file itself.',
          parts:[['du -h -d1','Human-readable totals, one level deep'],['| sort -h','Rank them by size'],['| tail -5','Only the five biggest — the rest is noise on a phone-sized terminal']] },
        { c:'cat /var/log/app/app.log',
          out:'2026-08-14T02:11:04Z DEBUG pool: acquired conn 41822\n2026-08-14T02:11:04Z DEBUG pool: released conn 41822\n^C (terminal flooded — 12G of output)',
          fb:'You just tried to print twelve gigabytes to a phone screen. Use ls -lh, tail, or less on an unknown log.' },
        { c:'journalctl --disk-usage',
          out:'Archived and active journals take up 24.0M in the file system.',
          fb:'Worth knowing — the journal is often the hidden hog — but here it is 24M out of 19G. Not your problem today.' }
      ] },

    { kind:'cmd',
      ask:'Name the offending file with its size.',
      hint:'You want ls-style detail for anything over 100M.',
      opts:[
        { c:'find /var/log/app -type f -size +100M -exec ls -lh {} +', ok:true,
          out:'-rw-r--r-- 1 appsvc appsvc  12G Aug 14 02:14 /var/log/app/app.log\n-rw-r--r-- 1 appsvc appsvc 2.1G Aug 13 00:00 /var/log/app/app.log-20260813\n-rw-r--r-- 1 appsvc appsvc 2.0G Aug 12 00:00 /var/log/app/app.log-20260812\n-rw-r--r-- 1 appsvc appsvc 1.9G Aug 11 00:00 /var/log/app/app.log-20260811',
          fb:'A live 12G app.log plus three uncompressed rotations. Two problems: something is logging far too much, and rotation is not compressing or expiring anything.',
          parts:[['find /var/log/app','Walk this tree'],['-type f','Regular files only, skip directories'],['-size +100M','Larger than 100 megabytes'],['-exec ls -lh {} +','Run ls -lh on the matches, batching them into as few invocations as possible']] },
        { c:'ls -lhS /var/log/app | head',
          ok:true,
          out:'total 18G\n-rw-r--r-- 1 appsvc appsvc  12G Aug 14 02:14 app.log\n-rw-r--r-- 1 appsvc appsvc 2.1G Aug 13 00:00 app.log-20260813\n-rw-r--r-- 1 appsvc appsvc 2.0G Aug 12 00:00 app.log-20260812',
          fb:'Also correct, and shorter: -S sorts by size descending. Same conclusion — a 12G live log and uncompressed rotations.',
          parts:[['ls -lh','Long listing, human-readable sizes'],['-S','Sort by file size, largest first'],['| head','Just the top of the list']] },
        { c:'stat /var/log/app',
          out:'  File: /var/log/app\n  Size: 4096      \tBlocks: 8          IO Block: 4096   directory',
          fb:'Metadata for the directory itself. You need the files inside it.' }
      ] },

    { kind:'think',
      ask:'app.log is 12G and the service is still running and writing to it. What reclaims the space?',
      hint:'Think about what happens to an open file descriptor when the file is unlinked.',
      opts:[
        { t:'truncate -s 0 the file — it frees the blocks while the writer keeps its descriptor', ok:true,
          fb:'Correct. The process keeps writing to the same open file, which now starts from zero bytes. Space is returned immediately.' },
        { t:'rm the file — deleting is the only way to actually free blocks',
          fb:'This is the classic trap. Unlinking removes the directory entry, but the inode and its blocks survive until the last file descriptor closes. df would still show 100%, and lsof +L1 would show a 12G deleted-but-open file.' },
        { t:'mv it to /tmp and let the app create a new one',
          fb:'/tmp is on a different filesystem here, so this copies 12G you do not have room for. Even on the same filesystem, the app holds the inode and keeps writing to the moved file — it never opens a new one.' },
        { t:'Restart the service so it releases the file',
          fb:'It does free the space if you also delete the file, but you have taken an outage to solve a disk problem — and you still have not fixed the rotation policy.' }
      ] },

    { kind:'cmd',
      ask:'Reclaim the space now.',
      hint:'Zero the live log, and deal with the stale rotations separately.',
      opts:[
        { c:'truncate -s 0 /var/log/app/app.log', ok:true,
          out:'(no output)',
          fb:'Twelve gigabytes back, no restart, no dropped file descriptor.',
          parts:[['truncate','Shrink or extend a file to a given length'],['-s 0','Set the size to zero bytes — the writer keeps its open descriptor and its offset'],['/var/log/app/app.log','The live log']] },
        { c:'rm -f /var/log/app/app.log',
          out:'(no output)',
          fb:'df still reports 100%. The file is unlinked but appsvc still holds it open — lsof +L1 would show it. Now the app is also logging into a file you cannot read.' },
        { c:'gzip /var/log/app/app.log',
          out:'gzip: write error: No space left on device',
          fb:'Compressing needs free space to write the output — and the disk is already full. Sensible instinct, wrong order.' }
      ] },

    { kind:'cmd',
      ask:'Clear the old rotations and confirm you have room.',
      hint:'Old compressed or rotated logs older than a couple of weeks are safe to remove.',
      opts:[
        { c:'find /var/log/app -name "app.log-*" -mtime +2 -delete && df -h /var', ok:true,
          out:'Filesystem      Size  Used Avail Use% Mounted on\n/dev/nvme1n1     20G  1.4G   18G   8% /var',
          fb:'8% used. The immediate incident is over — now stop it happening again.',
          parts:[['find /var/log/app','Search this directory'],['-name "app.log-*"','Rotated files only — quoted so the shell does not expand the glob first'],['-mtime +2','Last modified more than two days ago'],['-delete','Remove the matches'],['&& df -h /var','Only if that succeeded, show the result']] },
        { c:'rm -rf /var/log/*',
          out:'(no output)',
          fb:'You deleted nginx logs, audit logs, and the journal along with the app logs. During an incident that is how you lose the ability to explain what happened.' },
        { c:'df -h /var',
          out:'Filesystem      Size  Used Avail Use% Mounted on\n/dev/nvme1n1     20G  6.4G   14G  32% /var',
          fb:'Verifying is right, and you are at 32% — but you left 6G of stale rotations behind that will fill it again in a few days.' }
      ] },

    { kind:'cmd',
      ask:'Make it not recur. What do you do before you go back to bed?',
      hint:'The root cause is a rotation policy that never compressed or expired anything.',
      opts:[
        { c:'logrotate -d /etc/logrotate.d/app', ok:true,
          out:'reading config file /etc/logrotate.d/app\nHandling 1 logs\nrotating pattern: /var/log/app/*.log  after 1 days (0 rotations)\nempty log files are rotated, old logs are removed\nconsidering log /var/log/app/app.log\n  log does not need rotating (log has been already rotated)',
          fb:'"0 rotations" and no compress directive — that is the bug. Dry-run first with -d, then set rotate 7, compress, and a size cap, and force one run.',
          parts:[['logrotate','Rotate, compress, and expire log files'],['-d','Debug / dry run — print what it would do and change nothing'],['/etc/logrotate.d/app','The policy file for this application']] },
        { c:'systemctl restart app',
          out:'(no output)',
          fb:'The service was never the problem, and restarting fixes nothing about tomorrow night.' },
        { c:'crontab -e',
          out:'(opens an editor)',
          fb:'A hand-rolled cron cleanup is a worse version of logrotate, which is already installed and already running.' }
      ] }
  ],
  debrief:{
    why:[
      'df -h located the full filesystem — /var, not / — so the blast radius was known in one command.',
      'df -i ruled out inode exhaustion, which presents identically to the application (ENOSPC) but has a completely different fix.',
      'du -h -d1 walked down one level at a time instead of scanning everything, going /var → /var/log → /var/log/app in three cheap commands.',
      'find -size +100M named the actual file: a 12G live log plus 6G of uncompressed rotations.',
      'truncate -s 0 freed the space without breaking the writer, because the process keeps its open file descriptor and simply continues at offset zero.',
      'Deleting the rotations reclaimed the rest, and logrotate -d exposed the real root cause: a policy with 0 rotations and no compression.',
      'Every destructive option along the way — rm -rf /var/log/*, gzip on a full disk, cat on a 12G file — was avoided by asking what the command does to a live system first.',
      'The order matters as much as the commands: confirm, rule out the lookalike failure, localise, name the file, reclaim safely, verify, then fix the cause.'
    ],
    interview:'Say it as a sequence with a reason attached to each step. "First df -h to confirm which filesystem and how bad. Then df -i, because inode exhaustion looks identical to the application but is a different problem. Then du one level at a time to find the consumer rather than scanning the whole tree. Once I have the file, if a process is still writing to it I truncate rather than delete — unlinking does not free blocks while a descriptor is open, which is the classic df-versus-du mismatch. Then I clear old rotations, and finally I fix the rotation policy, because reclaiming space without fixing logrotate just moves the page to next week."',
    prevent:[
      'logrotate with rotate, compress, and a maxsize cap — then logrotate -d to verify before trusting it.',
      'Alarm at 80% rather than 100%, so the page arrives while you still have room to work.',
      'Ship logs off the instance (CloudWatch Logs, S3) so local disk is a buffer and not the system of record.',
      'If it recurs at the same hour, the real cause is a DEBUG log level left on in production.'
    ]
  }
},

/* ────────────────────────────────── 2. service will not start ── */
{
  id:'nginx-down', title:'nginx will not start after a config change', cat:'sys', level:'beginner',
  mins:5,
  brief:'A colleague edited nginx.conf half an hour ago and restarted. The site is down and they have gone to lunch. Fix it.',
  user:'ec2-user', host:'ip-10-0-2-45',
  steps:[
    { kind:'cmd',
      ask:'Where do you start?',
      hint:'One command gives you state, exit code, and the last few log lines together.',
      opts:[
        { c:'systemctl status nginx', ok:true,
          out:'● nginx.service - The nginx HTTP and reverse proxy server\n     Loaded: loaded (/usr/lib/systemd/system/nginx.service; enabled)\n     Active: failed (Result: exit-code) since Fri 2026-08-14 11:42:07 UTC; 28min ago\n    Process: 20455 ExecStartPre=/usr/sbin/nginx -t (code=exited, status=1/FAILURE)\n\nAug 14 11:42:07 ip-10-0-2-45 nginx[20455]: nginx: configuration file /etc/nginx/nginx.conf test failed',
          fb:'Failed with exit code 1 from the ExecStartPre config test. It never even tried to bind a port — this is a config problem, not a port conflict.',
          parts:[['systemctl','Control and inspect systemd units'],['status','Show current state, the main PID, the exit code, and recent journal lines'],['nginx','The unit name — nginx.service']] },
        { c:'curl -I http://localhost',
          out:'curl: (7) Failed to connect to localhost port 80: Connection refused',
          fb:'Confirms the symptom you already knew about. Connection refused means nothing is listening — true, but it does not tell you why.' },
        { c:'sudo reboot',
          out:'Connection to ip-10-0-2-45 closed by remote host.',
          fb:'You just rebooted a production host to fix a text file, lost the running state, and the service will fail exactly the same way on the way back up.' },
        { c:'ps aux | grep nginx',
          out:'ec2-user 21033  0.0  0.0 221928  1080 pts/0  S+  12:10  0:00 grep --color=auto nginx',
          fb:'Only your own grep matched — so nginx really is not running. Note the trick to avoid that: grep [n]ginx.' }
      ] },

    { kind:'cmd',
      ask:'Get the actual error message.',
      hint:'systemd captured stderr; you just need to read it.',
      opts:[
        { c:'journalctl -u nginx -n 30 --no-pager', ok:true,
          out:'Aug 14 11:42:07 ip-10-0-2-45 nginx[20455]: nginx: [emerg] unknown directive "worker_connection" in /etc/nginx/nginx.conf:14\nAug 14 11:42:07 ip-10-0-2-45 nginx[20455]: nginx: configuration file /etc/nginx/nginx.conf test failed\nAug 14 11:42:07 ip-10-0-2-45 systemd[1]: nginx.service: Control process exited, code=exited, status=1/FAILURE\nAug 14 11:42:07 ip-10-0-2-45 systemd[1]: Failed to start The nginx HTTP and reverse proxy server.',
          fb:'There it is: unknown directive "worker_connection" at line 14. Singular, when the real directive is worker_connections.',
          parts:[['journalctl','Query the systemd journal'],['-u nginx','Only this unit'],['-n 30','Last 30 lines'],['--no-pager','Print straight out instead of opening less — essential when scripting or on a small screen']] },
        { c:'tail -50 /var/log/nginx/error.log',
          out:'2026/08/13 22:04:11 [error] 18822#0: *4021 upstream timed out while reading response header',
          fb:'This is yesterday\'s traffic error. nginx never started today, so it never wrote to its own error log — the failure is only in the journal.' },
        { c:'dmesg -T | tail',
          out:'[Fri Aug 14 09:31:02 2026] ena 0000:00:05.0 eth0: Link is Up',
          fb:'Kernel messages. Right instinct for a mysterious kill or hardware fault, wrong layer for a config parse error.' }
      ] },

    { kind:'cmd',
      ask:'Confirm the fault independently and see the surrounding context.',
      hint:'Most daemons ship a config validator.',
      opts:[
        { c:'nginx -t', ok:true,
          out:'nginx: [emerg] unknown directive "worker_connection" in /etc/nginx/nginx.conf:14\nnginx: configuration file /etc/nginx/nginx.conf test failed',
          fb:'Independent confirmation, and this is the command you will use to verify the fix before restarting anything.',
          parts:[['nginx','The nginx binary itself, not the service'],['-t','Test the configuration and exit — parses the file without starting or reloading the server']] },
        { c:'sed -n "10,18p" /etc/nginx/nginx.conf',
          ok:true,
          out:'10: user nginx;\n11: worker_processes auto;\n12:\n13: events {\n14:     worker_connection 1024;\n15: }\n16:\n17: http {\n18:     include /etc/nginx/mime.types;',
          fb:'Also good — you read the offending line directly. Line 14 says worker_connection; it should be worker_connections.',
          parts:[['sed','Stream editor'],['-n','Do not print every line by default'],['"10,18p"','Print only lines 10 through 18'],['/etc/nginx/nginx.conf','The file to read']] },
        { c:'systemctl restart nginx',
          out:'Job for nginx.service failed because the control process exited with error code.',
          fb:'Restarting without changing anything gives you the same failure. Validate, fix, then restart.' }
      ] },

    { kind:'cmd',
      ask:'What did your colleague actually change? The file was backed up before the edit.',
      hint:'You have nginx.conf and nginx.conf.bak.',
      opts:[
        { c:'diff -u /etc/nginx/nginx.conf.bak /etc/nginx/nginx.conf', ok:true,
          out:'--- /etc/nginx/nginx.conf.bak\n+++ /etc/nginx/nginx.conf\n@@ -11,7 +11,7 @@\n events {\n-    worker_connections 1024;\n+    worker_connection 1024;\n }\n@@ -24,6 +24,7 @@\n     keepalive_timeout 65;\n+    client_max_body_size 20M;',
          fb:'Two changes: an intended one (client_max_body_size) and an accidental typo that dropped the s. Now you know exactly what to fix and what to keep.',
          parts:[['diff','Compare two files'],['-u','Unified format — the +/- patch style everyone reads'],['a b','Backup first, current second, so + lines are what was added']] },
        { c:'ls -l /etc/nginx/',
          out:'-rw-r--r-- 1 root root 2721 Aug 14 11:41 nginx.conf\n-rw-r--r-- 1 root root 2698 Jul 30 09:03 nginx.conf.bak',
          fb:'Confirms the file changed 30 minutes ago and a backup exists — useful, but it does not show you what changed.' },
        { c:'cp /etc/nginx/nginx.conf.bak /etc/nginx/nginx.conf',
          out:'(no output)',
          fb:'The site comes back, but you just silently discarded your colleague\'s intended change. Reverting blind is a last resort, not a first move.' }
      ] },

    { kind:'cmd',
      ask:'Fix the typo, keeping the intended change.',
      hint:'A targeted substitution, with a backup, beats hand-editing on a phone.',
      opts:[
        { c:'sudo sed -i.bak2 "s/worker_connection /worker_connections /" /etc/nginx/nginx.conf', ok:true,
          out:'(no output)',
          fb:'Surgical: only that directive changes, client_max_body_size survives, and you have another backup if the substitution was wrong.',
          parts:[['sed','Stream editor'],['-i.bak2','Edit in place, saving the original as nginx.conf.bak2 first'],['"s/old/new/"','Substitute the first match on each line — note the trailing space, so it only matches the directive and not a longer word'],['/etc/nginx/nginx.conf','Target file']] },
        { c:'sudo sed -i "s/worker_connection/worker_connections/g" /etc/nginx/nginx.conf',
          out:'(no output)',
          fb:'Careful — without the trailing space this also rewrites any already-correct worker_connections into worker_connectionss. Anchor your patterns.' },
        { c:'sudo truncate -s 0 /etc/nginx/nginx.conf',
          out:'(no output)',
          fb:'You just emptied the config file. Truncate is for logs, never for configuration.' }
      ] },

    { kind:'cmd',
      ask:'Verify before you restart.',
      hint:'Never restart a service on hope when a validator exists.',
      opts:[
        { c:'sudo nginx -t', ok:true,
          out:'nginx: the configuration file /etc/nginx/nginx.conf syntax is ok\nnginx: configuration file /etc/nginx/nginx.conf test is successful',
          fb:'Clean. Now a restart is a safe, predictable action rather than a gamble.',
          parts:[['nginx -t','Parse and validate the configuration without touching the running service']] },
        { c:'sudo systemctl restart nginx',
          out:'(no output — it happens to work)',
          fb:'It worked this time. But on a config with two mistakes you would have taken the site down again for the second one. Validate first, every time.' }
      ] },

    { kind:'cmd',
      ask:'Bring it up and prove it is actually serving.',
      hint:'Starting and being healthy are two different claims.',
      opts:[
        { c:'sudo systemctl restart nginx && systemctl is-active nginx && curl -sI localhost | head -1', ok:true,
          out:'active\nHTTP/1.1 200 OK',
          fb:'Started, active, and returning 200. That is a verified fix rather than an assumed one.',
          parts:[['systemctl restart nginx','Stop then start the unit'],['&&','Only continue if the previous command succeeded'],['is-active','Scriptable state check — prints active and exits 0'],['curl -sI localhost','Silent HEAD request'],['| head -1','Just the status line']] },
        { c:'sudo systemctl start nginx',
          ok:true,
          out:'(no output)',
          fb:'Fine — it starts. But you did not verify it is serving traffic, and "no output" from systemd is not the same as a working site.',
          parts:[['systemctl start','Start the unit now — note this does not affect whether it starts at boot']] },
        { c:'sudo systemctl enable nginx',
          out:'(no output — already enabled)',
          fb:'enable controls boot behaviour, not the current state. It was already enabled; the site is still down.' }
      ] },

    { kind:'think',
      ask:'Last question, the one an interviewer always asks: how do you stop this class of failure?',
      hint:'The failure was possible because an invalid config reached a restart.',
      opts:[
        { t:'Validate config in CI and require nginx -t before any restart, ideally in the deploy tooling', ok:true,
          fb:'Right. The unit already runs nginx -t as ExecStartPre, which is why it failed safely instead of half-starting — push the same check earlier, into the change process.' },
        { t:'Set Restart=always on the unit so it keeps retrying',
          fb:'It would restart-loop forever against a config that cannot parse, and fill the journal doing it. Restart policies help with crashes, not with invalid input.' },
        { t:'Give fewer people access to /etc/nginx',
          fb:'Sometimes appropriate, but it addresses who makes mistakes rather than catching them. Validation scales; access restriction alone does not.' },
        { t:'Keep a .bak file and revert whenever something breaks',
          fb:'Backups are how you recovered here, and they matter — but reverting discards intended changes and does not stop the bad config from reaching production in the first place.' }
      ] }
  ],
  debrief:{
    why:[
      'systemctl status established that the unit failed at ExecStartPre with exit code 1 — a config test failure, not a crash and not a port conflict.',
      'journalctl -u nginx produced the actual error text, including the directive and the line number. The service could not write its own error log because it never started.',
      'nginx -t confirmed the fault independently, and became the verification step later.',
      'diff -u against the backup separated the intended change from the accidental typo, so the fix preserved the colleague\'s work.',
      'sed -i.bak2 with an anchored pattern made a surgical edit with a rollback available.',
      'restart && is-active && curl proved the fix instead of assuming it.'
    ],
    interview:'"systemctl status first, for state and exit code. Then journalctl -u for the actual error — a service that fails to start often cannot write its own log, so the journal is the only record. Then the config validator, nginx -t or sshd -t or whatever the daemon provides. I diff against the backup so I fix the typo without throwing away the intended change, validate again, restart, and verify with a real request. And I would push that validation into CI, because the unit already had ExecStartPre=nginx -t — the check existed, it just ran too late to prevent the outage."',
    prevent:[
      'Config validation in CI, plus a pre-restart check in the deploy pipeline.',
      'Configuration in version control, so diff and revert are trivial and attributable.',
      'ExecStartPre validators in unit files, so a bad config fails at start instead of half-loading.',
      'Deploy to a canary host first, and health-check before rolling to the fleet.'
    ]
  }
},

/* ─────────────────────────── 3. service unreachable from off-box ── */
{
  id:'bind-address', title:'The API answers locally but not from anywhere else', cat:'net', level:'intermediate',
  mins:7,
  brief:'A new service is deployed on port 8080. On the instance, curl localhost:8080/health returns 200. From your laptop and from the load balancer, the connection times out. The team suspects "a firewall thing".',
  user:'ec2-user', host:'ip-10-0-3-77',
  steps:[
    { kind:'cmd',
      ask:'First move on the instance itself.',
      hint:'Before touching any firewall, find out exactly what the process is listening on.',
      opts:[
        { c:'ss -tulpn | grep 8080', ok:true,
          out:'tcp   LISTEN 0  4096   127.0.0.1:8080   0.0.0.0:*   users:(("myapp",pid=8123,fd=7))',
          fb:'Look at the address, not just the port: 127.0.0.1:8080. It is bound to loopback only.',
          parts:[['ss','Socket statistics — the modern replacement for netstat'],['-t','TCP sockets'],['-u','UDP sockets'],['-l','Listening sockets only'],['-p','Show the owning process and PID'],['-n','Numeric — do not resolve names, which is faster and clearer'],['| grep 8080','Filter to the port you care about']] },
        { c:'systemctl status myapp',
          out:'● myapp.service - Demo API\n     Active: active (running) since Fri 2026-08-14 09:02:11 UTC; 3h ago\n   Main PID: 8123 (myapp)',
          fb:'The service is healthy and running — which you already knew, because localhost works. It cannot tell you about bind addresses.' },
        { c:'sudo iptables -F',
          out:'(no output)',
          fb:'You just flushed every firewall rule on a production host, on a hunch, without reading them first. On many hosts that also removes rules other systems depend on. Never open with this.' },
        { c:'curl -I http://localhost:8080/health',
          out:'HTTP/1.1 200 OK\nContent-Type: application/json',
          fb:'Re-confirms what the brief already told you. It also cannot distinguish "listening on loopback" from "listening everywhere", because localhost matches both.' }
      ] },

    { kind:'think',
      ask:'The socket is 127.0.0.1:8080 rather than 0.0.0.0:8080. What does that mean?',
      hint:'The bind address decides which interfaces can accept a connection.',
      opts:[
        { t:'The process only accepts connections arriving on the loopback interface, so nothing off the host can ever reach it', ok:true,
          fb:'Exactly. No firewall change can fix this — packets from outside arrive on eth0 and there is no listener there to accept them.' },
        { t:'It is listening on all interfaces; 127.0.0.1 is just how ss displays it',
          fb:'No — ss shows the literal bind address. All interfaces is displayed as 0.0.0.0 for IPv4 or [::] for IPv6.' },
        { t:'The port is open but the security group is dropping the traffic',
          fb:'Plausible-sounding, and it is the assumption the team already made. But the security group is not why localhost works and eth0 does not — that distinction is decided on the host.' },
        { t:'The service needs to run as root to bind externally',
          fb:'Root is only required for ports below 1024. 8080 is unprivileged, and the process is already bound successfully — just to the wrong address.' }
      ] },

    { kind:'cmd',
      ask:'Prove it from the host, using the real interface address rather than localhost.',
      hint:'Same request, different destination address.',
      opts:[
        { c:'curl -sv --max-time 3 http://10.0.3.77:8080/health', ok:true,
          out:'*   Trying 10.0.3.77:8080...\n* connect to 10.0.3.77 port 8080 failed: Connection refused\n* Failed to connect to 10.0.3.77 port 8080 after 2 ms: Connection refused\ncurl: (7) Failed to connect to 10.0.3.77 port 8080',
          fb:'Connection refused from the instance\'s own private IP. That is conclusive — the packet reached the host\'s TCP stack and no listener claimed it. This is a bind problem, not a network problem.',
          parts:[['curl','HTTP client'],['-s','Silent — no progress meter'],['-v','Verbose — show connection, TLS, and header detail'],['--max-time 3','Give up after 3 seconds instead of hanging'],['http://10.0.3.77:8080/health','The private IP of this instance, not localhost']] },
        { c:'ping -c 2 10.0.3.77',
          out:'PING 10.0.3.77 (10.0.3.77) 56(84) bytes of data.\n64 bytes from 10.0.3.77: icmp_seq=1 ttl=64 time=0.031 ms\n64 bytes from 10.0.3.77: icmp_seq=2 ttl=64 time=0.028 ms',
          fb:'You pinged the host from itself — that never leaves the box and proves nothing about the service.' },
        { c:'firewall-cmd --list-all',
          out:'FirewallD is not running',
          fb:'Useful to know there is no host firewall at all — which means the drop is not happening here. But you skipped establishing the bind address, which is the actual cause.' }
      ] },

    { kind:'cmd',
      ask:'Find the setting that controls the bind address.',
      hint:'Application config, not system config.',
      opts:[
        { c:'grep -rn "127.0.0.1\\|bind\\|listen" /etc/myapp/config.yml', ok:true,
          out:'7:  # host: 0.0.0.0 to accept external traffic\n8:  bind_host: 127.0.0.1\n9:  bind_port: 8080',
          fb:'A development default that shipped to production — and the comment on line 7 tells you exactly what it should be.',
          parts:[['grep','Search text for a pattern'],['-r','Recursive, if given a directory'],['-n','Show line numbers'],['"a\\|b"','Alternation — match any of several patterns'],['/etc/myapp/config.yml','Where to look']] },
        { c:'systemctl cat myapp',
          ok:true,
          out:'# /etc/systemd/system/myapp.service\n[Service]\nUser=appsvc\nExecStart=/usr/local/bin/myapp --config /etc/myapp/config.yml\nRestart=always',
          fb:'Also a good move — it tells you which config file the service actually reads, which matters when there are three candidates on disk.',
          parts:[['systemctl cat','Print the unit file (and any drop-in overrides) systemd is really using']] },
        { c:'vi /etc/sysctl.conf',
          out:'(opens an editor)',
          fb:'Kernel tunables have nothing to do with which address a userspace process chose to bind.' }
      ] },

    { kind:'cmd',
      ask:'Change it and apply.',
      hint:'Edit, restart, and remember the service must re-read the file.',
      opts:[
        { c:'sudo sed -i.bak "s/bind_host: 127.0.0.1/bind_host: 0.0.0.0/" /etc/myapp/config.yml && sudo systemctl restart myapp', ok:true,
          out:'(no output)',
          fb:'Backed up, changed, restarted. The process must restart to re-bind — a config file edit alone changes nothing about an already-open socket.',
          parts:[['sed -i.bak','In-place edit keeping a .bak copy'],['0.0.0.0','Bind to every IPv4 interface on the host'],['&&','Only restart if the edit succeeded'],['systemctl restart myapp','Restart so the process re-reads config and re-binds']] },
        { c:'sudo systemctl reload myapp',
          out:'Failed to reload myapp.service: Job type reload is not applicable for unit myapp.service.',
          fb:'This unit has no ExecReload, so reload is not available. Reload works for daemons like nginx that support it; otherwise you restart.' },
        { c:'sudo firewall-cmd --add-port=8080/tcp --permanent && sudo firewall-cmd --reload',
          out:'FirewallD is not running',
          fb:'Opening a firewall that is not running, for a listener that does not exist on that interface. Two layers away from the actual cause.' }
      ] },

    { kind:'cmd',
      ask:'Confirm the socket changed.',
      hint:'Same command as step one.',
      opts:[
        { c:'ss -tulpn | grep 8080', ok:true,
          out:'tcp   LISTEN 0  4096   0.0.0.0:8080   0.0.0.0:*   users:(("myapp",pid=9440,fd=7))',
          fb:'0.0.0.0:8080 — now listening on every interface, with a new PID confirming the restart really happened.',
          parts:[['ss -tulpn','Listening TCP/UDP sockets with owning processes, numeric'],['0.0.0.0:8080','All IPv4 interfaces on port 8080']] },
        { c:'curl -s -o /dev/null -w "%{http_code}\\n" http://10.0.3.77:8080/health',
          ok:true,
          out:'200',
          fb:'Even better — an end-to-end check from the host\'s real address, printing just the status code.',
          parts:[['curl -s','Silent'],['-o /dev/null','Discard the body'],['-w "%{http_code}"','Print only the HTTP status code'],['http://10.0.3.77:8080/health','Real interface address']] }
      ] },

    { kind:'cmd',
      ask:'Your laptop still times out, though the load balancer is now healthy. Where is that drop happening?',
      hint:'Timeout means the packet was discarded silently. Find out whether it is even arriving.',
      opts:[
        { c:'sudo tcpdump -i any -nn port 8080 -c 20', ok:true,
          out:'tcpdump: listening on any, link-type LINUX_SLL2\n11:58:02.114 IP 10.0.3.201.44112 > 10.0.3.77.8080: Flags [S], seq 771..\n11:58:02.114 IP 10.0.3.77.8080 > 10.0.3.201.44112: Flags [S.], seq 220..\n11:58:02.115 IP 10.0.3.201.44112 > 10.0.3.77.8080: Flags [.], ack 1\n^C\n3 packets captured',
          fb:'The only traffic is a healthy handshake from 10.0.3.201 — the load balancer. Nothing at all arrives from your laptop\'s address, so the drop is upstream of this host: security group, NACL, or routing.',
          parts:[['tcpdump','Capture packets'],['-i any','All interfaces'],['-nn','Do not resolve hostnames or port names'],['port 8080','Berkeley Packet Filter — only this port'],['-c 20','Stop after 20 packets so it does not run forever']] },
        { c:'sudo systemctl restart myapp',
          out:'(no output)',
          fb:'The service is healthy and the load balancer can reach it. Restarting again cannot change what a network control does to your laptop\'s packets.' },
        { c:'dig +short api.internal',
          out:'10.0.3.77',
          fb:'Worth ruling out, and it resolves correctly — so this is not a DNS problem.' }
      ] },

    { kind:'think',
      ask:'No SYN from your laptop ever arrives. What is the correct conclusion?',
      hint:'Distinguish a silent drop from an active rejection.',
      opts:[
        { t:'Something upstream is dropping it — security group, NACL, or route — and the instance is now correctly configured', ok:true,
          fb:'Right, and note how you proved it: a timeout with no packet on the wire is a network control; connection refused means it arrived and nothing was listening. Your laptop is also outside the VPC, so it was never going to reach a private subnet without a VPN or bastion.' },
        { t:'The application is still misconfigured',
          fb:'The load balancer completes a handshake against the same socket. The host side is proven working.' },
        { t:'The host firewall is rejecting it',
          fb:'A host firewall REJECT sends back an ICMP error you would see; a DROP would still show the inbound SYN in tcpdump. You saw no packet at all, so it never reached the host.' },
        { t:'MTU mismatch',
          fb:'MTU problems break large packets after a connection is established. A SYN is tiny and would get through.' }
      ] }
  ],
  debrief:{
    why:[
      'ss -tulpn showed the bind address, not just the port — 127.0.0.1:8080 meant nothing off-box could ever connect, regardless of firewalls.',
      'curl against the instance\'s own private IP returned connection refused, which distinguishes a missing listener from a dropped packet.',
      'The application config held a development default (bind_host: 127.0.0.1) that shipped to production.',
      'A restart was required because a running process does not re-bind when you edit a file.',
      'tcpdump proved the load balancer handshake succeeded and no packet from the laptop arrived at all — moving the remaining problem off the host and into the VPC controls.',
      'Timeout versus connection refused was the through-line: silent drop means a network control, refusal means the host answered.'
    ],
    interview:'"I work outward one layer at a time. First the process: ss -tulpn, and I look at the bind address, because 127.0.0.1 versus 0.0.0.0 decides whether anything external can connect at all. Then the host: curl against the private IP, and connection refused tells me the packet reached the stack and nothing was listening. Then the network: tcpdump to see whether a SYN even arrives. A SYN with no SYN-ACK, or no SYN at all, puts the problem in the security group, the NACL, or routing — and I check the NACL specifically because it is stateless, so return traffic on ephemeral ports has to be allowed explicitly."',
    prevent:[
      'Make the bind address explicit and environment-driven, so a development default cannot ship.',
      'Add a smoke test that hits the service on its real interface address, not localhost — localhost passes even when the service is unreachable.',
      'Learn the layer order cold: process bind → host firewall → security group → NACL → route table.',
      'Remember which layers are stateful: security groups are, NACLs are not.'
    ]
  }
}

);
