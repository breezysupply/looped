/* Second drill set + extra quiz questions for the added material */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.quiz = LX.quiz || [];

LX.drills.push(

{ q:'Explain the TCP three-way handshake and what TIME_WAIT is for.', cat:'net', level:'intermediate',
  a:'The client sends SYN, the server replies SYN-ACK, the client sends ACK — three packets and the connection is established. Teardown is four: FIN, ACK, FIN, ACK. Whichever side closes first enters TIME_WAIT for twice the maximum segment lifetime, so that delayed duplicate packets from the old connection cannot be mistaken for part of a new one reusing the same port pair.',
  points:['A SYN with no SYN-ACK localises the drop to the network — security group, NACL, or firewall — not the application.','Connection refused means an RST came back: the host is reachable and nothing is listening.','Many TIME_WAIT sockets is normal for a busy client; many CLOSE_WAIT sockets is an application bug — it is not closing them.','ss -tan state time-wait | wc -l, and ip_local_port_range for the ephemeral pool.'] },

{ q:'What happens between typing a URL and seeing the page?', cat:'net', level:'intermediate',
  a:'Resolve the name (cache, /etc/hosts, then DNS along the delegation chain), pick a route to the resulting IP, complete the TCP handshake, negotiate TLS (ClientHello, certificate, key exchange), send the HTTP request, and receive the response — often via a load balancer that terminates TLS and forwards to a target. Then the browser renders it.',
  points:['Every stage is a place to debug: dig, ip r get, nc -zv, openssl s_client, curl -v.','On AWS, insert the layers: Route 53, ALB/NLB listener, target group, instance.','curl -w breaks a real request into exactly these timings, which is how you prove where the latency lives.'] },

{ q:'How do you decide whether a problem is CPU, memory, disk, or network?', cat:'procs', level:'intermediate',
  a:'Take one pass over each with a dedicated tool. CPU: top and load against nproc. Memory: free -h available plus si/so in vmstat. Disk: iostat -xz for %util and await, then pidstat -d for the culprit. Network: ss -s, ip -s link for errors, mtr for loss. Whichever is saturated gets the drill-down; the others are eliminated out loud.',
  points:['Name the tool per resource — that structure is the answer, not any single command.','sar gives the same picture for a time window that has already passed.','High load with idle CPU means D-state I/O blocking, not CPU pressure.'] },

{ q:'LVM versus plain partitions — when and why?', cat:'disk', level:'intermediate',
  a:'LVM inserts a layer between physical devices and filesystems: physical volumes join a volume group, and logical volumes are carved out of it. That means you can add a disk and grow a filesystem while it is mounted, span volumes across devices, and take snapshots. Plain partitions are simpler but resizing them is rigid and usually offline.',
  points:['pvs / vgs / lvs to orient on an unfamiliar host.','lvextend -r extends the volume and the filesystem in one step.','On EC2 you can often skip LVM: modify the EBS volume, growpart, then xfs_growfs.','XFS grows online but never shrinks — say this before they ask.'] },

{ q:'What is swap, and should a server have it?', cat:'disk', level:'intermediate',
  a:'Swap is disk space the kernel uses to page out memory that is not actively needed. It provides a cushion so a brief spike triggers slow paging rather than an immediate OOM kill. The cost is that heavy swapping is far slower than RAM, so a latency-sensitive service can appear hung. A modest swap file with a low vm.swappiness is a reasonable middle ground.',
  points:['Amazon Linux ships without swap by default, so memory exhaustion goes straight to the OOM killer.','Swap present is fine; sustained si/so in vmstat is the problem signal.','vm.swappiness=10 prefers reclaiming page cache before swapping anonymous pages.','Never use swap as a substitute for right-sizing the instance.'] },

{ q:'Explain containers in kernel terms.', cat:'sys', level:'intermediate',
  a:'A container is just a process on the host kernel with its view restricted. Namespaces isolate what it can see — PIDs, mounts, network, users, hostname, IPC. Cgroups limit what it can consume — CPU, memory, I/O. A union filesystem gives it its own root. There is no hypervisor and no guest kernel, which is why it starts in milliseconds and why kernel-level isolation is weaker than a VM.',
  points:['Namespaces = visibility, cgroups = resources. That one line answers most of the question.','ps on the host shows container processes; their PID inside the container is different.','A container OOM is a cgroup memory limit — same dmesg evidence, different scope.','VMs isolate at the hardware boundary; containers share the kernel, so a kernel CVE crosses the boundary.'] },

{ q:'How would you automate something you have done manually three times?', cat:'ops', level:'intermediate',
  a:'Write it down as a runbook first so the steps are explicit and reviewable, then convert it into a script with error handling — set -euo pipefail, idempotent operations, a dry-run mode, and logging. Put it under version control, test it somewhere disposable, and then move it into the standard tooling — Systems Manager documents, configuration management, or a pipeline — so it is not a script only I can run.',
  points:['Idempotent means running it twice is safe: mkdir -p, systemctl enable --now, checks before changes.','Dry-run flags and confirmation prompts for anything destructive.','The finish line is not "I wrote a script" — it is "the team can run it and it is in source control".','Amazon framing: this is Invent and Simplify plus Ownership, and eliminating toil is how an L5 scales.'] },

{ q:'How do you decide what to monitor and alert on?', cat:'ops', level:'intermediate',
  a:'Alert on symptoms customers feel — error rate, latency, availability — not on causes like CPU being at 80%. Every page must be actionable and have a runbook; anything else becomes a dashboard or a ticket. Set thresholds from observed behaviour rather than round numbers, alert early enough to act (disk at 80%, not 100%), and delete alerts that have never once led to action.',
  points:['Cause-based alerts generate noise; symptom-based alerts generate signal.','Every page answers: what is broken, who is affected, what do I do first.','Alert fatigue is an availability risk in itself — say that explicitly.','On AWS: CloudWatch alarms on custom metrics, composite alarms to suppress downstream noise.'] },

{ q:'Tell me about a time you had to debug something with very little information.', cat:'behavioral', level:'intermediate',
  a:'STAR, aimed at Dive Deep. Set the scene briefly, then spend the bulk of it on what you personally did: how you narrowed the problem, what you measured rather than assumed, the hypotheses you eliminated and why. Close with the outcome in numbers and the durable fix you put in so it could not recur.',
  points:['Show the method, not just the answer — interviewers score how you reason under uncertainty.','Include a wrong turn and what corrected it; it makes the story credible.','End with prevention: the monitoring, runbook, or automation you added afterwards.','Have two of these ready — Dive Deep and Ownership both draw on the same kind of story.'] },

{ q:'How do you handle being on call for a system you did not build?', cat:'behavioral', level:'intermediate',
  a:'Read the runbooks and recent incidents before the shift, get the dashboards open, and learn the escalation paths. During a page, mitigate with the documented action first and escalate early with what you have already ruled out. Afterwards, improve the runbook you just used — every shift should leave the documentation better than you found it.',
  points:['Ownership: the on-call owns the outcome, not just the alert queue.','Escalating early with evidence is strength, not weakness — say it plainly.','Leaving the runbook better is the detail that separates a good answer from a generic one.','Tie it to a real example: a page you took, what you fixed, what you documented.'] }

);

LX.quiz.push(
{ q:'A service needs more open file descriptors. Where does the limit belong?', cat:'sys', level:'intermediate',
  choices:['LimitNOFILE= in the systemd unit','ulimit -n in your shell','~/.bashrc','/etc/hosts'], a:0,
  why:'Check the result in /proc/PID/limits — the shell\'s ulimit never applies to a systemd-managed service.' },

{ q:'Which pair of kernel features makes a container?', cat:'sys', level:'intermediate',
  choices:['Namespaces (visibility) and cgroups (resources)','A hypervisor and a guest kernel','chroot and SELinux','systemd and iptables'], a:0,
  why:'A container is a normal host process with a restricted view and capped resources — no guest kernel involved.' },

{ q:'Many sockets sitting in CLOSE_WAIT means what?', cat:'net', level:'intermediate',
  choices:['The application is not closing its sockets','Normal TCP teardown behaviour','The network is dropping packets','DNS is failing'], a:0,
  why:'TIME_WAIT is normal and belongs to the side that closed first; CLOSE_WAIT is your code holding the socket open.' },

{ q:'Which command grows an LVM logical volume and its filesystem together?', cat:'disk', level:'intermediate',
  choices:['lvextend -r -L +50G /dev/vg/lv','lvcreate -L 50G','vgextend vg /dev/xvdg','pvcreate /dev/xvdg'], a:0,
  why:'-r calls the right resize tool for you. Without it you extend the volume and the filesystem still shows the old size.' },

{ q:'Root cannot edit a file despite mode 644 and owning it. What do you check?', cat:'perms', level:'intermediate',
  choices:['lsattr — the immutable (+i) attribute','The file size','The inode number','$PATH'], a:0,
  why:'chattr +i blocks modification for everyone including root. chattr -i releases it.' },

{ q:'Which tool shows what a hung process is actually waiting on?', cat:'procs', level:'intermediate',
  choices:['strace -p PID','ps aux','df -h','uptime'], a:0,
  why:'strace -e trace=file is also the fastest way to find the exact path returning ENOENT or EACCES.' },

{ q:'You need CPU and memory data from 3am last night. Which tool?', cat:'procs', level:'intermediate',
  choices:['sar','top','free','vmstat'], a:0,
  why:'sar reads the collected history in /var/log/sa. Every other tool only shows the present moment.' },

{ q:'An ALB returns 502. What does that indicate?', cat:'cloud', level:'intermediate',
  choices:['The target closed or reset the connection','The target did not answer within the timeout','DNS failed','The listener has no certificate'], a:0,
  why:'504 is the timeout case. A common 502 cause is the app keep-alive being shorter than the ALB idle timeout.' },

{ q:'Port 22 is closed by policy. How do you get a shell on the instance?', cat:'cloud', level:'intermediate',
  choices:['SSM Session Manager','Open port 22 temporarily','Use the private key over HTTPS','Attach an Elastic IP'], a:0,
  why:'SSM needs no inbound rule — just outbound reachability, an instance role, and the agent running. It is also fully logged.' },

{ q:'Safest way to add a sudo rule?', cat:'perms', level:'intermediate',
  choices:['visudo -f /etc/sudoers.d/name','vi /etc/sudoers','echo the rule >> /etc/sudoers','chmod 666 /etc/sudoers'], a:0,
  why:'visudo validates syntax before saving, and a drop-in file can simply be deleted if it turns out to be wrong.' },

{ q:'Monitoring alarms that free memory is under 5% while the app is healthy. What is wrong?', cat:'procs', level:'beginner',
  choices:['The alarm should use available, not free','The host needs more RAM','Swap is disabled','There is a memory leak'], a:0,
  why:'Linux fills spare RAM with page cache and reclaims it on demand. Alarm on available memory and on swap activity.' },

{ q:'Which mount option keeps a missing secondary volume from blocking boot?', cat:'disk', level:'intermediate',
  choices:['nofail','defaults','noexec','ro'], a:0,
  why:'That plus UUIDs instead of device names is how you keep an fstab edit from making an instance unbootable.' }
);

/* ── Added: mock-bank drills and rapid-fire recall from the playbook ── */
LX.drills.push(

{ q:'What does namei -l solve that ls -l on the file does not?', cat:'perms', level:'intermediate',
  a:'ls -l tells you about the final file only. namei -l walks every component of the path and prints the owner and mode of each one, so you can see whether the user can actually traverse to the file. You need execute on every directory in the chain; one missing x halfway down blocks access even when the file itself is world-readable.',
  points:['Directory x means traverse, not read. It is the single most-missed cause of "permission denied".',
    'Run it as the identity that is failing — a service account, not your login.',
    'Pair it with getfacl when the mode bits look correct: a trailing + in ls -l means ACLs are involved.'] },

{ q:'RSS versus VSZ — what is the difference, and which do you sort by?', cat:'procs', level:'intermediate',
  a:'VSZ is virtual size: everything the process has mapped, including memory it has never touched, shared libraries, and reserved address space. RSS is resident set size: the physical pages actually in RAM right now. Sort by RSS when hunting a memory problem, because that is the memory really being consumed.',
  points:['A JVM commonly shows a huge VSZ and a much smaller RSS — the VSZ is not a problem.',
    'ps -eo pid,user,%mem,rss,vsz,cmd --sort=-rss | head is the command.',
    'RSS also double-counts shared pages across processes, so summing RSS overstates total use.'] },

{ q:'When is du a sensible next step for a slow service, and when is it a poor one?', cat:'disk', level:'beginner',
  a:'It is sensible after df has shown capacity pressure, or when you have specific reason to think a directory is growing. It is poor as a first response to "the service is slow", because du measures where space is allocated and says nothing about performance — and walking a large tree is expensive on a host that is already struggling.',
  points:['Establish why storage is a likely branch before you go looking in it.',
    'For performance the storage question is iostat, not du: utilisation, await, queue depth.',
    'This is a real interview trap — the sequence df then du is right, du alone is not.'] },

{ q:'What is the difference between a symptom, a hypothesis, and evidence?', cat:'ops', level:'intermediate',
  a:'The symptom is what the user reports — "it is slow", "it returns 500s". The hypothesis is your candidate explanation — "the disk is saturated". Evidence is the output that confirms or kills it — iostat showing 100% utilisation with 240ms await on the volume the app writes to. Interviews are largely a test of whether you keep those three separate.',
  points:['State which one you are on: "my hypothesis is X, and the command that would prove it is Y".',
    'A hypothesis with no test attached is a guess.',
    'Change hypothesis cleanly when evidence contradicts it — that is a scored behaviour, not a weakness.'] },

{ q:'How do you validate that your remediation actually solved the incident?', cat:'ops', level:'intermediate',
  a:'Re-run the original failing test, not a proxy for it. Confirm the service is healthy at the layer the user touches, check that the metric you were watching has recovered and stayed recovered, read the logs for new errors, and confirm the user-visible symptom is gone. Then write down what you changed.',
  points:['"The metric looks better" is not the same as "the customer request succeeds".',
    'Watch for a few minutes — a restart can look like a fix for exactly as long as it takes to refill.',
    'Close the loop with the durable fix and an owner, or the same page fires next week.'] },

{ q:'Why can restarting a service make troubleshooting harder?', cat:'ops', level:'beginner',
  a:'It changes state before you have understood it. You lose the process state, open file descriptors, memory profile and often the in-memory evidence of what went wrong; a deleted-but-open file disappears along with the space it explained. The symptom usually returns later, now without the clues.',
  points:['Capture first: systemctl status, journalctl, ps, and the relevant resource command.',
    'Say this out loud before proposing a restart — it is one of the clearest seniority signals available.',
    'If you must restart to restore service, capture state first, then restart, then investigate.'] },

{ q:'What does vmstat show you that top does not make obvious?', cat:'procs', level:'intermediate',
  a:'The b column — processes blocked on I/O — and si/so, actual swap in and out. top gives you a wait percentage but vmstat makes the distinction between memory pressure and I/O pressure explicit, sampled over time so you can see whether it is sustained or a spike.',
  points:['vmstat 1 5 gives five one-second samples; the first line is averages since boot, so ignore it.',
    'r is the run queue: sustained r above core count is genuine CPU saturation.',
    'si/so at zero rules out swapping, which is the fastest way to eliminate memory as the cause.'] },

{ q:'What is the difference between getent hosts and dig?', cat:'net', level:'intermediate',
  a:'getent goes through the system name-service path defined in nsswitch.conf — so it consults /etc/hosts first, then DNS, exactly like a normal application does. dig speaks DNS directly and ignores that path. When the two disagree, a hosts entry or the nsswitch order is your answer.',
  points:['Applications resolve like getent, not like dig. Test the way the app resolves.',
    'dig @server lets you interrogate one resolver specifically, which separates "my resolver is broken" from "the record is wrong".',
    'ping mixes resolution and reachability into one result — isolate them instead.'] },

{ q:'How do you check the exact route Linux will use for one destination?', cat:'net', level:'intermediate',
  a:'ip route get ADDRESS. It resolves the actual decision the kernel will make for that destination, including the interface, the gateway, and the source address it will use — rather than making you read the whole table and infer it.',
  points:['This is how you answer "why is traffic to that subnet leaving the wrong interface".',
    'ip route alone shows the table; ip route get shows the decision.',
    'tracepath then shows where along that path things stop, and works where traceroute is not installed.'] },

{ q:'What evidence would make you suspect disk I/O latency?', cat:'disk', level:'intermediate',
  a:'High load average with idle CPU, a high wa percentage in top, processes sitting in D state, and a b column above zero in vmstat. Confirm with iostat -xz: a device at or near 100% utilisation with a high await and a deep queue. Then attribute it with pidstat -d.',
  points:['await is the latency the application actually feels; %util alone can mislead on SSDs.',
    'On EBS, saturation often means provisioned IOPS exhausted rather than a failing device.',
    'D-state processes cannot be killed until the I/O returns — that is a useful corroborating sign.'] },

{ q:'How do dependencies create latency even when the local service looks healthy?', cat:'ops', level:'intermediate',
  a:'The local process is fine but every request blocks on something downstream — a database, an internal API, DNS, a lock. Threads or connections pile up waiting, the pool exhausts, and new requests queue behind them. Locally you see healthy CPU and memory with rising response times and connection counts.',
  points:['Measure the dependency directly with curl -w timings, or nc for plain reachability.',
    'ss -s and connection-pool metrics show the pile-up before the application logs do.',
    'A slow dependency and a failing one look different: failures are fast, slowness is what exhausts pools.'] },

{ q:'Explain chmod 750 on a directory in words.', cat:'perms', level:'beginner',
  a:'Owner gets read, write and execute — list it, create and delete entries, and traverse into it. Group gets read and execute — list and traverse, but not modify. Other gets nothing, so they cannot even traverse through it to reach anything below.',
  points:['7 = 4+2+1, 5 = 4+1, 0 = none.',
    'On a directory x is traverse, not run: without it, r only gets you the names.',
    '750 on a parent directory is a very common reason a service account cannot reach a file it has permission to read.'] },

{ q:'What is the principle behind never using chmod 777 as a quick fix?', cat:'perms', level:'beginner',
  a:'It grants write to every account on the host, which on a web root means anyone can replace the application code. It also destroys the diagnostic information — you no longer know which permission was actually missing, so the real defect is hidden rather than fixed.',
  points:['Grant the narrowest thing that works: group read, one traverse bit, or an ACL for one account.',
    'If 777 "fixes" it, the real answer was ownership or a single missing bit.',
    'Naming the security consequence, not just the tidiness one, is what scores here.'] },

{ q:'Give a 30-second answer that could open almost any Linux troubleshooting question.', cat:'ops', level:'beginner',
  a:'"I would start with read-only information so I do not change state before I understand the problem. First confirm the symptom and its scope — one user, one host, or everyone, and what changed. Then check the layer most likely involved: service state and logs, then CPU, memory, storage and network. I would use what I find to pick the next check, and only propose a change once I have evidence for the cause."',
  points:['Memorise this. It buys thinking time and it is a genuinely correct answer.',
    'Follow it immediately with the first concrete command so it does not sound rehearsed.',
    'Scope first is the part most candidates skip, and it is free information.'] }

);

LX.quiz.push(
{ q:'What does `namei -l /srv/app/config.yaml` show you?', cat:'perms', level:'intermediate',
  choices:['Ownership and permissions for every component of the path','The ACLs on the final file','The inode number','Which process has the file open'], a:0,
  why:'It is how you find the parent directory missing a traverse bit — the most common cause of a permission denial that ls -l cannot explain.' },

{ q:'What does `findmnt -T /var/lib/app` answer?', cat:'disk', level:'intermediate',
  choices:['Which filesystem contains that path, and its mount options','How much space the path uses','Which user owns the path','Whether the path exists'], a:0,
  why:'It is the fastest way to spot a read-only mount when an application cannot write despite correct permissions.' },

{ q:'`lsof +L1` lists what?', cat:'disk', level:'intermediate',
  choices:['Open files with a link count below 1 — deleted but still held','Files locked by another user','Files larger than 1 GB','Files opened in the last minute'], a:0,
  why:'This is the df-versus-du mismatch: the directory entry is gone but the blocks stay allocated until the holding process closes the descriptor.' },

{ q:'A process is in Z state. What is happening?', cat:'procs', level:'beginner',
  choices:['It has exited and its parent has not reaped the exit status','It is swapped out','It is waiting on disk','It has been stopped by a signal'], a:0,
  why:'A zombie consumes nothing but a PID slot. You cannot kill it — you signal the parent, which is where the bug is.' },

{ q:'What does a bind address of 0.0.0.0 mean?', cat:'net', level:'beginner',
  choices:['Listening on every IPv4 interface','Listening on loopback only','The port is closed','IPv6 only'], a:0,
  why:'127.0.0.1 is loopback only and unreachable from off-box; 0.0.0.0 is all IPv4 interfaces; :: covers IPv6 and, depending on configuration, dual-stack.' },

{ q:'You get "connection refused". What does that tell you?', cat:'net', level:'beginner',
  choices:['The host was reachable and something rejected the connection','The packet was silently dropped','DNS failed','The route is missing'], a:0,
  why:'Refused means a response came back — usually no listener on that port. A timeout means silence, which points at filtering, loss, routing, or a dead host.' },

{ q:'A user was added to a group but still cannot access the shared directory. Why?', cat:'perms', level:'beginner',
  choices:['Their existing session does not carry the new supplementary group','Group permissions take an hour to apply','The group needs a password','Groups do not affect directories'], a:0,
  why:'Supplementary groups attach at login. Check with id in their shell; fix with a new login or newgrp.' },

{ q:'What does `systemctl show myservice -p User -p Group` give you?', cat:'sys', level:'intermediate',
  choices:['The account the unit is configured to run as','The user who started the service','The owner of the unit file','The last user to edit the unit'], a:0,
  why:'That is the configured intent, including drop-ins. ps shows the runtime reality — when they disagree, something overrode the unit.' },

{ q:'Which command shows the kernel view of a process’s real and effective IDs?', cat:'procs', level:'intermediate',
  choices:['grep -E "^(Uid|Gid):" /proc/PID/status','id','whoami','ps -ef'], a:0,
  why:'The four numbers are real, effective, saved-set and filesystem IDs. Permission checks generally use the effective ID.' },

{ q:'`tracepath host` is useful because…', cat:'net', level:'intermediate',
  choices:['It maps the path and reveals MTU issues without needing root or traceroute','It is faster than ping','It tests DNS','It shows open ports'], a:0,
  why:'Handy on locked-down hosts where traceroute is not installed, and path-MTU problems break large packets while small ones pass.' },

{ q:'What is the fastest way to see a systemd unit’s effective configuration?', cat:'sys', level:'beginner',
  choices:['systemctl cat NAME','cat /etc/systemd/system/NAME.service','systemctl status NAME','journalctl -u NAME'], a:0,
  why:'It includes drop-in overrides, which reading the vendor file by hand does not — and drop-ins are exactly where surprises live.' },

{ q:'Which pair of commands is the strongest opening for a failed service?', cat:'sys', level:'beginner',
  choices:['systemctl status, then journalctl -u','ps aux, then top','df -h, then du','ping, then curl'], a:0,
  why:'Status gives state and exit code; the journal gives the message the service printed before dying, which it often could not write to its own log file.' }
);
