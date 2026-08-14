/* Interview drills (question + model answer) and the hand-written quiz bank */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.quiz = LX.quiz || [];

/* ── Drills: say these out loud until they are automatic ────── */
LX.drills.push(

{ q:'Walk me through what happens when a Linux box boots.', cat:'sys', level:'intermediate',
  a:'Firmware/BIOS or UEFI runs POST and hands off to the bootloader (GRUB2), which loads the kernel and initramfs. The kernel initialises hardware, mounts the real root filesystem, and starts PID 1 — systemd. systemd brings up targets and their unit dependencies until it reaches multi-user.target (or graphical.target), starting services along the way.',
  points:['Failures map to stages: GRUB → kernel panic → initramfs → fstab/root mount → failed units.','On EC2 you cannot watch the console live, so the tools are the serial console output and journalctl -b -1.','systemd-analyze blame and critical-chain show what is slowing boot.'] },

{ q:'What actually happens when you run `ls` in a shell?', cat:'shell', level:'intermediate',
  a:'The shell parses the line, expands globs/variables, and looks up ls — alias, then function, then builtin, then $PATH. It fork()s, and the child execve()s /usr/bin/ls, which the kernel loads along with the dynamic linker and its shared libraries. The child inherits the shell\'s file descriptors, writes to stdout, and exits; the parent wait()s and stores the exit status in $?.',
  points:['fork + exec + wait is the answer they are listening for.','`type -a ls` shows what would actually be chosen.','strace -f ls shows the syscalls; ldd /usr/bin/ls shows the library dependencies.'] },

{ q:'Explain Linux file permissions to someone who has never seen them.', cat:'perms', level:'beginner',
  a:'Every file has an owner, a group, and three permission sets: owner, group, other. Each set carries read (4), write (2), execute (1), which add up to the octal digit you see in 644 or 755. On a directory the meanings shift: read = list names, write = create/delete entries, execute = traverse into it.',
  points:['644 = owner rw, everyone else r. 755 adds execute for all — normal for directories and binaries.','600 on a private key; SSH refuses anything looser.','umask subtracts from 666/777 at creation; 022 yields 644 and 755.','Special bits: setuid (4000), setgid (2000), sticky (1000) — /tmp is 1777 so users cannot delete each other\'s files.'] },

{ q:'A user cannot access a file even though the permissions look right. What else could it be?', cat:'perms', level:'intermediate',
  a:'Check traverse permissions on every parent directory (namei -l shows the chain), then ACLs — a "+" in ls -l means the basic bits are not the whole story. After that, SELinux context, whether the filesystem is mounted read-only or noexec, group membership not yet applied to the live session, and immutable attributes (lsattr).',
  points:['namei -l /path/to/file walks each component.','getfacl for ACLs, getenforce plus ausearch -m avc for SELinux.','mount | grep <fs> for ro/noexec/nosuid.','chattr +i makes a file unmodifiable even by root — lsattr reveals it.'] },

{ q:'Difference between a hard link and a symbolic link?', cat:'files', level:'intermediate',
  a:'A hard link is a second directory entry pointing at the same inode — same data, same permissions, and the data survives until every link is removed. A symlink is a small file containing a path; it can cross filesystems and point at directories, but it breaks if the target moves.',
  points:['Hard links cannot cross filesystems (inodes are per-filesystem) and cannot target directories.','ls -i shows shared inode numbers; ls -l shows the link count.','Deleting the original leaves a hard link fully working, but leaves a symlink dangling.'] },

{ q:'How does the OOM killer decide what to kill?', cat:'procs', level:'intermediate',
  a:'When the kernel cannot reclaim enough memory, it scores each process — mostly by memory footprint, adjusted by oom_score_adj — and kills the highest scorer, logging it to the kernel ring buffer. Big memory consumers get killed even if they are not the leaker.',
  points:['Evidence: dmesg -T | grep -i "out of memory", or journalctl -k.','Tune with /proc/PID/oom_score_adj (-1000 protects a process entirely).','Real fixes: cap the JVM heap under the cgroup limit, size the instance correctly, add swap, fix the leak.','A systemd MemoryMax= limit produces the same symptom at the cgroup level.'] },

{ q:'How do you find what is using all the disk space, and what if du and df disagree?', cat:'disk', level:'beginner',
  a:'df -h to find the full filesystem, df -i to rule out inode exhaustion, then du -h -d1 walked down level by level. If df shows full while du does not account for it, a deleted file is still held open by a running process — lsof +L1 names it, and restarting that process releases the blocks.',
  points:['du measures reachable files; df measures allocated blocks.','Truncate an in-use log rather than deleting it: truncate -s 0.','Inode exhaustion presents as ENOSPC with free space in df -h.'] },

{ q:'Explain load average. Is a load of 5 bad?', cat:'procs', level:'intermediate',
  a:'Load average is the running average of processes that are runnable *or* in uninterruptible sleep, over 1, 5, and 15 minutes. It has to be read against core count: 5 on an 8-core box is comfortable, 5 on a 2-core box is saturated. And because Linux includes D-state, high load can mean I/O blocking with a nearly idle CPU.',
  points:['Compare against nproc every time.','Rising 1-min above 15-min = getting worse; the reverse = recovering.','High load, idle CPU → check D-state processes and iostat.'] },

{ q:'Difference between SIGTERM, SIGKILL, and SIGHUP?', cat:'procs', level:'beginner',
  a:'TERM (15) asks the process to shut down and can be caught, so it can flush buffers and clean up. KILL (9) is handled by the kernel, cannot be caught or ignored, and gives the process no chance to clean up. HUP (1) originally meant the terminal hung up; daemons conventionally repurpose it as "reload your configuration".',
  points:['Always TERM first, wait, then escalate to KILL.','-9 can leave stale lock files, PID files, and corrupt state.','kill -HUP reloads nginx config without dropping connections.','A D-state process ignores even KILL until its I/O completes.'] },

{ q:'A service works now but does not come back after a reboot. Why?', cat:'sys', level:'beginner',
  a:'It was started but never enabled. systemctl start affects the current boot only; systemctl enable creates the symlink that makes systemd start it at boot. systemctl enable --now does both.',
  points:['Verify with systemctl is-enabled <unit>.','Other causes: a dependency ordering problem (After=/Requires=), a filesystem that failed to mount, or a mount missing from fstab.','Same class of bug: sysctl -w and ip addr add are runtime-only and need /etc/sysctl.d or persistent network config.'] },

{ q:'How do you troubleshoot "my application cannot reach the database"?', cat:'net', level:'intermediate',
  a:'Layer by layer. Does the name resolve (dig)? Is the port reachable (nc -zv host 3306)? Does a TCP handshake complete (tcpdump for SYN/SYN-ACK)? Does the application authenticate? At each stop, the failing layer tells you where to look: DNS, routing/security group/NACL, host firewall or listener bind address, or credentials.',
  points:['Timeout = silently dropped, look at network controls. Connection refused = it arrived, nothing listening.','On the DB host: ss -tulpn | grep 3306 and check the bind address.','Do not forget connection limits — max_connections exhaustion looks like a network problem.'] },

{ q:'What is the difference between a security group and a network ACL?', cat:'cloud', level:'intermediate',
  a:'Security groups are stateful and attach to the ENI: return traffic is allowed automatically, and they only support allow rules. NACLs are stateless and attach to the subnet: they evaluate rules in numbered order, support explicit deny, and you must permit both directions — including ephemeral ports for return traffic.',
  points:['A one-way NACL rule is the classic cause of "the request goes out but nothing comes back".','Evaluation order for inbound traffic: route table → NACL → security group → host firewall.','Security groups can reference other security groups; NACLs are CIDR-only.'] },

{ q:'Describe how you would harden a fresh Linux host.', cat:'perms', level:'intermediate',
  a:'Disable root SSH login and password authentication, use keys with correct permissions, patch to current, remove unnecessary packages and services, close every port that is not required at both the host firewall and the security group, enforce least privilege in sudoers, keep SELinux enforcing, enable auditing and centralised logging, and set up automated security patching.',
  points:['sshd_config: PermitRootLogin no, PasswordAuthentication no, AllowGroups.','ss -tulpn to enumerate the actual attack surface.','Audit setuid binaries: find / -perm -4000 -type f 2>/dev/null.','Ship logs off-box so an attacker cannot erase them; on AWS, prefer SSM Session Manager over open SSH entirely.'] },

{ q:'What runs at boot, and how do you make your own service?', cat:'sys', level:'intermediate',
  a:'Write a unit file in /etc/systemd/system/myapp.service with [Unit] (description, After=network.target), [Service] (ExecStart, User, Restart=always, Environment), and [Install] (WantedBy=multi-user.target). Then systemctl daemon-reload, systemctl enable --now myapp, and verify with systemctl status plus journalctl -u myapp.',
  points:['daemon-reload after every unit-file edit, or systemd keeps the old definition.','Type=simple vs forking matters — the wrong one makes systemd think the service failed.','Restart=always with RestartSec gives crash resilience; LimitNOFILE= raises the fd limit for the service.'] },

{ q:'How would you find which process is listening on a port, and kill it safely?', cat:'net', level:'beginner',
  a:'ss -tulpn | grep :8080 to get the PID and command, lsof -i :8080 as a cross-check, ps to understand what it is and how long it has been running, then kill -TERM and only escalate to -9 if it ignores that. If it is a managed service, stop it through systemctl so systemd does not immediately restart it.',
  points:['Killing the PID of a Restart=always service just gets it restarted — use systemctl stop.','Confirm the port is free afterwards before starting the replacement.'] },

{ q:'What is in /proc, and when have you used it?', cat:'sys', level:'intermediate',
  a:'/proc is a virtual filesystem exposing kernel and process state as files. Per-process directories give you the command line, environment, open file descriptors, limits, and memory maps; system-wide entries cover CPU, memory, mounts, and tunables. It is where you look when the normal tools are not telling you enough.',
  points:['/proc/PID/fd — find deleted-but-open files and what a process has open.','/proc/PID/limits — the limits actually applied, not what your shell reports.','/proc/PID/environ — what environment the process was really started with.','/proc/meminfo, /proc/cpuinfo, /proc/mounts, /proc/net/tcp.'] },

{ q:'Tell me how you would debug a slow API endpoint end to end.', cat:'net', level:'intermediate',
  a:'Establish where the time goes before changing anything. curl -w breaks a request into DNS, connect, TLS, and time-to-first-byte. If TTFB dominates, the work is server-side: check CPU, memory, I/O, and downstream dependency latency. If connect or DNS dominates, it is infrastructure. Then correlate with logs and metrics over the same window, and only then form a hypothesis.',
  points:['curl -s -o /dev/null -w "dns:%{time_namelookup} conn:%{time_connect} tls:%{time_appconnect} ttfb:%{time_starttransfer} total:%{time_total}\\n" URL','Server-side: top, iostat -xz, ss -s, application and GC logs.','Say explicitly that you measure before you tune — that is the senior signal.'] },

{ q:'You are on call and get paged at 3am for a service that is down. Walk me through it.', cat:'ops', level:'intermediate',
  a:'Acknowledge the page and establish scope and impact first — one host or all of them, one AZ or the region, are customers affected. Mitigate before diagnosing: failover, roll back the recent deploy, or restart. Communicate status to stakeholders. Once it is stable, gather evidence — logs, metrics, what changed — and then do the root-cause analysis in a correction-of-error document with action items.',
  points:['Mitigate first, root-cause second. Getting that order backwards is the most common failure in this question.','"What changed?" — deploys, config, packages, certificates, and capacity are the usual suspects.','Say you keep a timeline as you go; it makes the write-up honest.','Amazon frames the follow-up as a COE: five whys, and action items that prevent the class of failure, not just the instance.'] },

{ q:'How do you approach a problem you have never seen before, on a system you do not know?', cat:'ops', level:'intermediate',
  a:'Start from the symptom and confirm it directly rather than trusting the report. Establish a timeline — when did it start, what changed then. Bisect the system: narrow the failure to a layer with a test at each boundary. Form one hypothesis at a time, test it, and keep notes of what you have eliminated. Escalate early with what you have already ruled out rather than late with nothing.',
  points:['Reproduce → localise → hypothesise → test → fix → verify → document.','Change one thing at a time, and undo failed experiments.','On an unfamiliar box: uptime, df -h, free -h, systemctl --failed, journalctl -p err — five commands and you have the shape of it.'] },

{ q:'Tell me about a time you disagreed with your team on a technical decision.', cat:'behavioral', level:'intermediate',
  a:'Answer in STAR form and land it on Have Backbone; Disagree and Commit. Situation and task in two sentences, then most of your time on your specific actions — the data you gathered, how you framed the disagreement, what you proposed — and finish with a measurable result and what you would do differently.',
  points:['Say "I", not "we". The interviewer is scoring your actions, not your team\'s.','Bring numbers: latency, cost, incident count, hours saved.','Show the commit half — you disagreed, the decision went the other way, and you executed fully anyway.','Prepare two examples per Leadership Principle; expect follow-up drilling on details.'] },

{ q:'How do you decide between fixing something now and doing it properly later?', cat:'behavioral', level:'intermediate',
  a:'Frame it as customer impact versus risk. During an incident, mitigate immediately and take the small, reversible action — then file the durable fix with an owner and a date so it does not evaporate. Outside an incident, size the blast radius: irreversible or wide-reaching changes get the full process, narrow and reversible ones can move fast.',
  points:['Bias for Action and Are Right, A Lot are both in play — name the trade-off explicitly.','One-way versus two-way doors is the framing Amazon uses; use it.','Always close the loop: mitigation without a follow-up ticket is how the same page fires again next month.'] }

);

/* ── Hand-written quiz bank ─────────────────────────────────── */
LX.quiz.push(
{ q:'Which command shows every listening TCP port together with the owning process?', cat:'net', level:'beginner',
  choices:['ss -tulpn','netstat -r','ip a','lsof -R'], a:0,
  why:'ss -tulpn: t=TCP, u=UDP, l=listening, p=process, n=numeric. It replaced netstat -tulpn.' },

{ q:'df -h shows 45% used, but writes fail with "No space left on device". Most likely cause?', cat:'disk', level:'intermediate',
  choices:['Inodes are exhausted (df -i)','The disk is failing','Swap is full','The file is too large for the filesystem'], a:0,
  why:'A filesystem has a finite inode count. Millions of tiny files exhaust inodes while blocks remain free.' },

{ q:'What does 755 mean?', cat:'perms', level:'beginner',
  choices:['Owner rwx, group rx, other rx','Owner rw, group rw, other r','Owner rwx, group rwx, other rx','Owner rx, group rx, other rwx'], a:0,
  why:'7 = 4+2+1 (rwx) for the owner; 5 = 4+1 (rx) for group and other.' },

{ q:'You deleted a 10 GB log but df still shows the space used. Why?', cat:'disk', level:'intermediate',
  choices:['A process still holds the file open','The filesystem needs fsck','The delete is queued asynchronously','df caches results for 60 seconds'], a:0,
  why:'Blocks are freed only when the last file descriptor closes. Find it with lsof +L1 and restart the holder.' },

{ q:'Which signal asks a process to terminate gracefully?', cat:'procs', level:'beginner',
  choices:['SIGTERM (15)','SIGKILL (9)','SIGSTOP (19)','SIGINT (6)'], a:0,
  why:'TERM can be caught, letting the process flush and clean up. KILL cannot be caught or ignored.' },

{ q:'Difference between systemctl start and systemctl enable?', cat:'sys', level:'beginner',
  choices:['start = now; enable = at every boot','start = foreground; enable = background','They are aliases','enable also restarts on crash'], a:0,
  why:'enable --now does both. "Works until reboot" almost always means enable was skipped.' },

{ q:'Which command reveals why a process was killed with no application-level log entry?', cat:'procs', level:'intermediate',
  choices:['dmesg -T | grep -i "out of memory"','ps aux','top -b -n1','df -h'], a:0,
  why:'The OOM killer writes to the kernel ring buffer, visible via dmesg or journalctl -k.' },

{ q:'ss shows your service listening on 127.0.0.1:8080. What does that mean?', cat:'net', level:'intermediate',
  choices:['Only processes on this host can reach it','It is reachable from the whole VPC','The firewall is blocking it','It is listening on IPv6 only'], a:0,
  why:'Bound to loopback. To accept external connections it must bind 0.0.0.0 (or the specific interface IP).' },

{ q:'Which pipeline gives the top 10 client IPs in an access log?', cat:'text', level:'beginner',
  choices:["awk '{print $1}' log | sort | uniq -c | sort -rn | head","awk '{print $1}' log | uniq -c | head","grep IP log | wc -l","cut -d' ' -f1 log | uniq | head -10"], a:0,
  why:'uniq only collapses adjacent duplicates, so the input must be sorted first; the second sort -rn ranks by count.' },

{ q:'ssh fails with "Permission denied (publickey)". What has already been proven?', cat:'transfer', level:'intermediate',
  choices:['The network path works and sshd answered','DNS is broken','The security group blocks port 22','The host is down'], a:0,
  why:'You got an authentication error, so you reached sshd. A network problem would time out instead.' },

{ q:'Why use -F rather than -f with tail on a rotated log?', cat:'text', level:'intermediate',
  choices:['-F follows the filename across rotation','-F is faster','-F formats the output','-F filters blank lines'], a:0,
  why:'-f follows the inode, so after logrotate you sit on the rotated-away file forever. -F reopens by name.' },

{ q:'Which command persists a kernel tunable across reboots?', cat:'sys', level:'intermediate',
  choices:['Add it to /etc/sysctl.d/ then sysctl -p','sysctl -w','echo into /proc/sys/...','export in ~/.bashrc'], a:0,
  why:'sysctl -w and direct /proc writes are runtime-only and are lost at reboot.' },

{ q:'Correct way to append to a root-owned file from a normal shell?', cat:'shell', level:'intermediate',
  choices:['echo x | sudo tee -a /etc/file','sudo echo x >> /etc/file','sudo "echo x >> /etc/file"','echo x >> sudo /etc/file'], a:0,
  why:'The shell opens the redirection target as *you*, before sudo runs. tee does the writing as root instead.' },

{ q:'What does `2>&1` do in `cmd > out.log 2>&1`?', cat:'shell', level:'beginner',
  choices:['Sends stderr to wherever stdout currently points','Sends stdout to stderr','Runs the command twice','Merges two files'], a:0,
  why:'Order matters: `2>&1 > f` sends stderr to the terminal instead, because stdout is redirected afterwards.' },

{ q:'After expanding an EBS volume, df still shows the old size. What is missing?', cat:'disk', level:'intermediate',
  choices:['Grow the partition and filesystem (growpart, xfs_growfs/resize2fs)','Reboot the instance','Remount with -o resize','Nothing — it updates hourly'], a:0,
  why:'Three layers: volume, partition, filesystem. Growing the volume alone changes nothing the OS reports.' },

{ q:'Which command shows the route the kernel would use for a specific destination?', cat:'net', level:'intermediate',
  choices:['ip r get 10.0.2.15','ip a','netstat -i','traceroute -n'], a:0,
  why:'ip route get resolves the exact route and source interface — the fast answer to asymmetric-routing questions.' },

{ q:'Why should find -print0 be paired with xargs -0?', cat:'search', level:'intermediate',
  choices:['So filenames with spaces are not split into multiple arguments','It is faster','It enables parallelism','It suppresses errors'], a:0,
  why:'NUL is the only byte that cannot appear in a filename, so it is the only safe separator.' },

{ q:'What does the "available" column in free -h represent?', cat:'procs', level:'beginner',
  choices:['Memory usable by new processes, including reclaimable cache','Memory never touched since boot','Free memory plus swap','Memory reserved for the kernel'], a:0,
  why:'Linux uses spare RAM as page cache and reclaims it on demand, so low "free" is normal and healthy.' },

{ q:'Which one edits a file in place while keeping a backup?', cat:'text', level:'intermediate',
  choices:["sed -i.bak 's/a/b/' file","sed 's/a/b/' file","sed -n 's/a/b/p' file","sed -e 's/a/b/' file > file"], a:0,
  why:'The last option truncates the file before sed reads it — a genuine way to lose data.' },

{ q:'A security group allows inbound 443, but traffic still fails. What is the stateless layer to check?', cat:'cloud', level:'intermediate',
  choices:['The network ACL, in both directions','The route table only','IAM policy','The instance profile'], a:0,
  why:'NACLs are stateless, so return traffic on ephemeral ports must be explicitly allowed.' },

{ q:'Which command shows recent failed login attempts?', cat:'users', level:'beginner',
  choices:['lastb','last','w','who'], a:0,
  why:'lastb reads /var/log/btmp. /var/log/secure and journalctl -u sshd carry the same evidence.' },

{ q:'What must you run after editing a systemd unit file?', cat:'sys', level:'beginner',
  choices:['systemctl daemon-reload','systemctl reboot','systemctl reset-failed','Nothing'], a:0,
  why:'Without daemon-reload systemd keeps the cached old definition and your change appears to do nothing.' },

{ q:'"Too many open files" from a systemd service. Where do you raise the limit?', cat:'sys', level:'intermediate',
  choices:['LimitNOFILE= in the unit file','ulimit -n in your shell','/etc/profile','sysctl -w fs.file-max'], a:0,
  why:'A service does not inherit your interactive shell\'s limits. fs.file-max is the system-wide ceiling, not the per-process limit.' },

{ q:'Which is the safest first step when the root filesystem goes read-only?', cat:'disk', level:'intermediate',
  choices:['Read dmesg -T for the I/O error that caused it','Immediately remount rw','Reboot','Run fsck on the mounted filesystem'], a:0,
  why:'Read-only is the kernel protecting you from a failing device. Remounting first destroys the evidence.' },

{ q:'Which command answers "which AWS principal am I right now?"', cat:'cloud', level:'beginner',
  choices:['aws sts get-caller-identity','aws iam list-users','aws configure list-profiles','whoami'], a:0,
  why:'Always the first step on an AccessDenied — confirm the identity before you touch the policy.' },

{ q:'A process is stuck in D state and ignores kill -9. Why?', cat:'procs', level:'intermediate',
  choices:['It is in uninterruptible sleep and cannot handle signals until the I/O completes','It is running as root','It is a zombie','SELinux is blocking the signal'], a:0,
  why:'D state means blocked in the kernel — usually storage or NFS. Fix the I/O path, or reboot.' },

{ q:'What does the sticky bit on /tmp (mode 1777) do?', cat:'perms', level:'intermediate',
  choices:['Only a file\'s owner may delete it, despite the directory being world-writable','Files are kept in memory','New files inherit the directory group','Files cannot be modified'], a:0,
  why:'Without it, any user could delete any other user\'s files in a world-writable directory. Group inheritance is setgid.' },

{ q:'Which command proves whether a TCP port is reachable, with no application involved?', cat:'net', level:'beginner',
  choices:['nc -zv host 443','ping host','dig host','curl host'], a:0,
  why:'nc tests the TCP handshake alone, separating "network path blocked" from "application misbehaving".' },

{ q:'Why does `sort | uniq -c` need the sort?', cat:'text', level:'beginner',
  choices:['uniq only collapses adjacent duplicate lines','sort removes blank lines','uniq requires numeric input','It does not — sort is optional'], a:0,
  why:'Non-adjacent duplicates are silently counted separately without sorting first.' },

{ q:'You need a long migration to survive a dropped SSH session. Best option?', cat:'shell', level:'beginner',
  choices:['Run it inside tmux or screen','nohup with no logging','Run it faster','Increase ClientAliveInterval'], a:0,
  why:'tmux lets you detach and reattach to watch progress; nohup survives but you cannot get the session back.' }
);
