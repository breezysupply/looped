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
