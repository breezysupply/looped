/* Second lab set: memory, access, and performance triage */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.labs = LX.labs || [];

LX.labs.push(

/* ────────────────────────────────────── 4. the OOM killer ── */
{
  id:'oom-kill', title:'The service dies every few hours with no error', cat:'procs', level:'intermediate',
  mins:7,
  brief:'A Java service on a t3.medium disappears two or three times a day. The application log ends mid-line with no exception, no shutdown message. It restarts by itself and runs fine for hours. The team thinks it is a JVM bug.',
  user:'ec2-user', host:'ip-10-0-1-52',
  steps:[
    { kind:'cmd',
      ask:'The process is gone. What is the first thing that tells you how it died?',
      hint:'systemd records how a unit exited, including the signal.',
      opts:[
        { c:'systemctl status myapp', ok:true,
          out:'● myapp.service - Order API\n     Active: active (running) since Fri 2026-08-14 13:22:07 UTC; 12min ago\n   Main PID: 14882 (java)\n\nAug 14 13:22:05 ip-10-0-1-52 systemd[1]: myapp.service: Main process exited, code=killed, status=9/KILL\nAug 14 13:22:05 ip-10-0-1-52 systemd[1]: myapp.service: Failed with result "signal".\nAug 14 13:22:07 ip-10-0-1-52 systemd[1]: myapp.service: Scheduled restart job, restart counter is at 7.',
          fb:'code=killed, status=9/KILL, and a restart counter at 7. Something external sent SIGKILL — the process did not crash, it was executed. A JVM bug would leave a stack trace, not a signal.',
          parts:[['systemctl status','Unit state plus the exit code or signal and recent journal lines'],['code=killed','systemd is telling you the process was signalled rather than exiting on its own'],['status=9/KILL','Signal 9 — cannot be caught or ignored, so no cleanup and no application log entry']] },
        { c:'tail -100 /var/log/myapp/app.log',
          out:'2026-08-14T13:21:58Z INFO  order 88213 accepted\n2026-08-14T13:21:59Z INFO  order 88214 accep',
          fb:'It ends mid-word, which is itself a clue — the process died between buffer flushes. But the application cannot log its own SIGKILL, so this log will never contain the answer.' },
        { c:'java -version',
          out:'openjdk version "17.0.9" 2026-01-16',
          fb:'Chasing the team\'s theory before establishing any evidence. Confirm how it died first.' }
      ] },

    { kind:'cmd',
      ask:'Who sent SIGKILL? The application log will never say.',
      hint:'The kernel logs its own decisions somewhere userspace tools do not write.',
      opts:[
        { c:'dmesg -T | grep -i "out of memory" -A2', ok:true,
          out:'[Fri Aug 14 13:22:04 2026] java invoked oom-killer: gfp_mask=0x140dca, order=0, oom_score_adj=0\n[Fri Aug 14 13:22:04 2026] Out of memory: Killed process 14203 (java) total-vm:5731204kB, anon-rss:3402180kB, file-rss:0kB, shmem-rss:0kB, UID:993 pgtables:7204kB oom_score_adj:0\n[Fri Aug 14 13:22:04 2026] oom_reaper: reaped process 14203 (java), now anon-rss:0kB',
          fb:'There it is. The kernel OOM killer chose java, which had 3.4G resident on a 3.8G instance. Not a JVM bug — the host ran out of memory and the kernel picked the biggest consumer.',
          parts:[['dmesg','Print the kernel ring buffer'],['-T','Human-readable timestamps instead of seconds since boot'],['grep -i "out of memory"','Case-insensitive search for the OOM banner'],['-A2','Also show 2 lines after each match, where the victim and its RSS are named']] },
        { c:'journalctl -u myapp --since "1 hour ago" -p err',
          out:'-- No entries --',
          fb:'Reasonable instinct, but the service was killed rather than erroring, so it logged nothing. Absence of errors is itself evidence that this was external.' },
        { c:'last -x | head',
          out:'reboot   system boot  6.1.0-aws  Fri Jun 20 08:11   still running',
          fb:'No reboots or shutdowns today, so the host stayed up. Rules out an instance-level event, but does not explain the kill.' },
        { c:'grep -i kill /var/log/secure',
          out:'(no output)',
          fb:'That log covers authentication and sudo. A kernel decision does not appear there.' }
      ] },

    { kind:'think',
      ask:'What does "Out of memory: Killed process (java) anon-rss:3402180kB" actually tell you?',
      hint:'Think about what the OOM killer optimises for.',
      opts:[
        { t:'The host exhausted memory, and the kernel killed the largest-scoring process — which is usually the biggest consumer, not necessarily the guilty one', ok:true,
          fb:'Correct, and the nuance matters: the OOM killer picks by score, largely from memory footprint adjusted by oom_score_adj. On a single-app host the victim and the cause are the same process, but on a shared host the leaker can survive while an innocent large process dies.' },
        { t:'The JVM has a memory leak',
          fb:'Maybe, but nothing here proves it. A heap sized larger than the instance can supply produces exactly this without any leak.' },
        { t:'The disk is full so memory could not be paged',
          fb:'Different failure entirely — that surfaces as ENOSPC, not an OOM kill.' },
        { t:'systemd killed it because of a unit timeout',
          fb:'A systemd timeout appears as a timeout in the journal and normally sends SIGTERM first. The kernel ring buffer named the OOM killer explicitly.' }
      ] },

    { kind:'cmd',
      ask:'How much memory does this host actually have to work with?',
      hint:'And check whether there is any cushion at all.',
      opts:[
        { c:'free -h', ok:true,
          out:'               total        used        free      shared  buff/cache   available\nMem:           3.7Gi       2.9Gi       147Mi        18Mi       680Mi       610Mi\nSwap:             0B          0B          0B',
          fb:'3.7G total and — critically — zero swap. With no swap there is no cushion at all: memory pressure goes straight to an OOM kill with no warning period.',
          parts:[['free','Show memory and swap usage'],['-h','Human-readable units'],['available','The number that matters — memory usable by new allocations, including reclaimable page cache'],['Swap: 0B','Amazon Linux ships with no swap by default']] },
        { c:'cat /proc/meminfo | head -5',
          ok:true,
          out:'MemTotal:        3921348 kB\nMemFree:          150612 kB\nMemAvailable:     624884 kB\nBuffers:            2144 kB\nCached:           697320 kB',
          fb:'The same picture from the source. MemAvailable is the figure to reason about, not MemFree.',
          parts:[['/proc/meminfo','Kernel memory statistics as a virtual file'],['MemAvailable','Estimate of memory available without swapping']] },
        { c:'df -h',
          out:'Filesystem      Size  Used Avail Use% Mounted on\n/dev/nvme0n1p1   30G  9.1G   21G  31% /',
          fb:'Disk is healthy. Wrong resource — you are chasing memory.' }
      ] },

    { kind:'cmd',
      ask:'The JVM is the biggest consumer. What is it configured to use?',
      hint:'Look at how the service is actually started.',
      opts:[
        { c:'systemctl cat myapp | grep -E "ExecStart|Environment|Memory"', ok:true,
          out:'Environment=JAVA_OPTS=-Xms1g -Xmx3584m\nExecStart=/usr/bin/java $JAVA_OPTS -jar /opt/myapp/app.jar',
          fb:'There is the root cause. A 3584m maximum heap on a host with 3.7G total — and the JVM needs metaspace, thread stacks, and native buffers on top of the heap, while the OS needs a few hundred megabytes of its own. It is oversubscribed by design.',
          parts:[['systemctl cat','Show the effective unit file including drop-ins'],['grep -E','Extended regex, so you can alternate patterns with |'],['-Xmx3584m','JVM maximum heap — the ceiling the JVM will grow to before it garbage-collects hard'],['-Xms1g','Initial heap']] },
        { c:'ps -o pid,rss,cmd -p $(pgrep -f app.jar)',
          ok:true,
          out:'  PID   RSS CMD\n14882 2914304 /usr/bin/java -Xms1g -Xmx3584m -jar /opt/myapp/app.jar',
          fb:'Also correct, and it shows the live footprint: 2.9G resident already, twelve minutes after a restart, heading for the same wall.',
          parts:[['ps','Process snapshot'],['-o pid,rss,cmd','Choose columns: PID, resident set size in KB, and the full command'],['-p','Restrict to specific PIDs'],['$(pgrep -f app.jar)','Command substitution — find the PID by matching the full command line']] },
        { c:'top -b -n1 | head -12',
          out:'MiB Mem :   3829.1 total,    148.2 free,   2913.4 used,    767.5 buff/cache\n  PID USER      PR  NI    VIRT    RES  %CPU  %MEM COMMAND\n14882 appsvc    20   0   5.6g   2.8g   4.0  76.1 java',
          fb:'Shows java at 76% of memory, which supports the theory but does not reveal the configured limit — the number you actually need to change.' }
      ] },

    { kind:'think',
      ask:'What is the right fix?',
      hint:'Something that stops the kill without hiding it.',
      opts:[
        { t:'Size the heap to fit the host — roughly 2g here — and either right-size the instance or add a small swap cushion', ok:true,
          fb:'Right. Heap plus JVM overhead plus OS must fit in RAM with headroom. If 2g of heap is genuinely not enough for the workload, that is a capacity decision: move to a larger instance rather than overcommitting.' },
        { t:'Set Restart=always so it comes back faster',
          fb:'It is already restarting — the counter is at 7. That masks the symptom, drops in-flight requests every few hours, and leaves the cause untouched.' },
        { t:'Set oom_score_adj to -1000 so the kernel never kills java',
          fb:'Then the kernel kills sshd or systemd instead and you lose the whole host. Protecting the largest consumer from the OOM killer makes the outage worse, not better.' },
        { t:'Disable the OOM killer entirely',
          fb:'With overcommit disabled or the killer off, allocations start failing instead — the host locks up or the application crashes in less predictable ways.' }
      ] },

    { kind:'cmd',
      ask:'Apply the heap change to the unit.',
      hint:'Override the environment, then make systemd re-read it.',
      opts:[
        { c:'sudo systemctl edit myapp   # add Environment=JAVA_OPTS=-Xms512m -Xmx2g', ok:true,
          out:'(editor opens, drop-in written to /etc/systemd/system/myapp.service.d/override.conf)',
          fb:'A drop-in override rather than editing the shipped unit, so a package update will not silently revert it.',
          parts:[['systemctl edit','Create or edit a drop-in override for a unit'],['override.conf','Lives in myapp.service.d/ and layers on top of the vendor unit'],['-Xmx2g','New maximum heap, leaving room for JVM overhead and the OS']] },
        { c:'sudo systemctl daemon-reload && sudo systemctl restart myapp', ok:true,
          out:'(no output)',
          fb:'daemon-reload is mandatory after any unit change — without it systemd keeps running the old definition and your edit appears to do nothing.',
          parts:[['daemon-reload','Re-read unit files from disk into systemd'],['restart','Apply the new environment to a fresh process']] },
        { c:'export JAVA_OPTS="-Xmx2g"',
          out:'(no output)',
          fb:'That only affects your shell. A systemd service does not inherit your interactive environment — the same trap as ulimit.' }
      ] },

    { kind:'cmd',
      ask:'Add a memory guard rail so the next surprise is visible instead of fatal.',
      hint:'systemd can cap and report a service\'s memory at the cgroup level.',
      opts:[
        { c:'systemctl show myapp -p MemoryMax -p MemoryCurrent', ok:true,
          out:'MemoryMax=infinity\nMemoryCurrent=1476395008',
          fb:'No cgroup limit at all today. Setting MemoryMax=2600M means the service is contained and killed predictably within its own cgroup — with a clear journal entry — instead of taking a random victim across the whole host.',
          parts:[['systemctl show','Print unit properties, including ones status does not display'],['-p MemoryMax','The cgroup memory ceiling for this service'],['-p MemoryCurrent','Current cgroup memory usage in bytes']] },
        { c:'sudo dd if=/dev/zero of=/swapfile bs=1M count=1024 && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile',
          ok:true,
          out:'1024+0 records in\n1024+0 records out\nSetting up swapspace version 1, size = 1024 MiB',
          fb:'A 1G swap cushion is also defensible — it converts an instant kill into slow paging you can alarm on. Add it to fstab to survive reboot, and keep vm.swappiness low.',
          parts:[['dd if=/dev/zero of=/swapfile','Write a 1G file of zeros to act as swap'],['chmod 600','Swap files must not be world-readable'],['mkswap','Format the file as swap space'],['swapon','Activate it now — add an fstab entry to make it permanent']] },
        { c:'sudo sysctl -w vm.overcommit_memory=2',
          out:'vm.overcommit_memory = 2',
          fb:'Strict overcommit accounting makes allocations fail early instead of OOM-killing later. It is a real option, but it changes behaviour fleet-wide and can break applications that reserve large address spaces — the JVM among them.' }
      ] }
  ],
  debrief:{
    why:[
      'systemctl status showed code=killed, status=9/KILL — the process was signalled, not crashed, which immediately rules out an application-level exception.',
      'dmesg -T named the OOM killer and its victim with the resident size, proving the host ran out of memory.',
      'free -h showed 3.7G total and no swap, so there was no cushion between pressure and a kill.',
      'systemctl cat exposed -Xmx3584m on a 3.7G host — the heap ceiling alone nearly equalled total RAM before JVM overhead and the OS.',
      'The fix sized the heap to the host via a drop-in override, followed by daemon-reload so systemd actually picked it up.',
      'MemoryMax (or a small swap file) turns the next memory surprise into a contained, observable event rather than a random kill.'
    ],
    interview:'"Silent death with no application log means something external killed it, so I go to the kernel: dmesg or journalctl -k for the OOM killer. That gives me the victim and its RSS. Then free -h for total memory and whether there is swap — Amazon Linux has none by default, so pressure goes straight to a kill. Then I check what the process was configured to use; here it was a JVM with Xmx nearly equal to total RAM, which cannot work once you account for metaspace, thread stacks, and the OS. I fix it with a drop-in override and daemon-reload, and I add MemoryMax so the service is contained in its own cgroup. Restart=always would have hidden this for months."',
    prevent:[
      'Size JVM heap against instance memory explicitly, and treat it as part of capacity planning rather than a default.',
      'MemoryMax on the unit so a runaway service is contained instead of the kernel choosing a victim.',
      'Alarm on available memory and on OOM events in the journal, not on free memory.',
      'Treat a rising systemd restart counter as an alert in its own right — it is a service failing repeatedly and quietly.'
    ]
  }
},

/* ────────────────────────────────────── 5. cannot SSH in ── */
{
  id:'ssh-denied', title:'Locked out: Permission denied (publickey)', cat:'transfer', level:'beginner',
  mins:6,
  brief:'A new instance launched from your team AMI passed both status checks ten minutes ago. Your SSH attempt is refused immediately. You have AWS CLI access from your laptop.',
  user:'you', host:'laptop',
  steps:[
    { kind:'think',
      ask:'Your connection is refused instantly with "Permission denied (publickey)" rather than hanging. What has that already told you?',
      hint:'Compare a refusal with a timeout.',
      opts:[
        { t:'The network path works and sshd answered — this is an authentication problem, not connectivity', ok:true,
          fb:'Exactly the split that saves you twenty minutes. Security group, NACL, and routing are all proven working, because you got an application-layer response from sshd.' },
        { t:'The security group is blocking port 22',
          fb:'Then you would hang and eventually time out. A blocked packet produces silence, not a protocol-level denial.' },
        { t:'The instance is still booting',
          fb:'Possible in general, but sshd replied — so it is up and listening.' },
        { t:'DNS is resolving to the wrong host',
          fb:'Worth ruling out in principle, but you connected to something running sshd. Start with the message you were given.' }
      ] },

    { kind:'cmd',
      ask:'Get the detail on why the key was rejected.',
      hint:'ssh will tell you exactly what it offered and what happened.',
      opts:[
        { c:'ssh -vvv -i ~/keys/team-2026.pem ec2-user@10.0.1.20', ok:true,
          out:'debug1: Reading configuration data /etc/ssh/ssh_config\n@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n@         WARNING: UNPROTECTED PRIVATE KEY FILE!          @\n@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\nPermissions 0644 for "/home/you/keys/team-2026.pem" are too open.\nIt is required that your private key files are NOT accessible by others.\nThis private key will be ignored.\nLoad key "/home/you/keys/team-2026.pem": bad permissions\nec2-user@10.0.1.20: Permission denied (publickey).',
          fb:'The key was never even offered — ssh refused to load it because it is world-readable. First problem found, and it is on your side.',
          parts:[['ssh','SSH client'],['-vvv','Maximum verbosity — shows config parsing, key loading, and each authentication method attempted'],['-i PATH','Use this identity (private key) file'],['ec2-user@10.0.1.20','Login user and host — the user matters as much as the key']] },
        { c:'ping -c 3 10.0.1.20',
          out:'PING 10.0.1.20 56(84) bytes of data.\n--- 10.0.1.20 ping statistics ---\n3 packets transmitted, 0 received, 100% packet loss',
          fb:'And this is why ping is a poor reachability test on AWS: ICMP is not allowed by the security group, yet SSH clearly reached the host. A failed ping proves nothing.' },
        { c:'aws ec2 reboot-instances --instance-ids i-0ab12cd34ef56',
          out:'(no output)',
          fb:'Rebooting a host because you cannot authenticate to it. It will come back with the same authorized_keys and the same result.' }
      ] },

    { kind:'cmd',
      ask:'Fix the key file permissions.',
      hint:'Private keys must be readable only by you.',
      opts:[
        { c:'chmod 600 ~/keys/team-2026.pem', ok:true,
          out:'(no output)',
          fb:'Owner read-write, nothing for group or other. 400 is equally acceptable — ssh only objects to group and other access.',
          parts:[['chmod','Change file mode bits'],['600','rw for the owner, nothing for group or other — 6 = 4(read)+2(write)'],['~/keys/team-2026.pem','The private key']] },
        { c:'chmod 777 ~/keys/team-2026.pem',
          out:'(no output)',
          fb:'That is the opposite direction — now everyone on the machine can read your private key, and ssh will still refuse it.' },
        { c:'sudo ssh -i ~/keys/team-2026.pem ec2-user@10.0.1.20',
          out:'Warning: Identity file /home/you/keys/team-2026.pem not accessible: No such file or directory.\nroot@10.0.1.20: Permission denied (publickey).',
          fb:'Running as root changed your home directory and your identity — now it cannot find the key at all, and it tried to log in as root.' }
      ] },

    { kind:'cmd',
      ask:'Try again. What happens now?',
      hint:'Same command, correct permissions.',
      opts:[
        { c:'ssh -v -i ~/keys/team-2026.pem ec2-user@10.0.1.20', ok:true,
          out:'debug1: Offering public key: /home/you/keys/team-2026.pem RSA SHA256:9Lk2...\ndebug1: Authentications that can continue: publickey\ndebug1: No more authentication methods to try.\nec2-user@10.0.1.20: Permission denied (publickey).',
          fb:'Progress — the key is offered now, and the server still rejects it. So either the server does not have this public key, or something server-side is refusing to use it. You need to get onto the host another way.',
          parts:[['-v','One level of verbosity, enough to see which keys are offered and what the server accepts'],['Offering public key','The client is presenting the key; rejection after this point is a server-side decision']] },
        { c:'ssh-keygen -R 10.0.1.20',
          out:'# Host 10.0.1.20 found: line 42\n/home/you/.ssh/known_hosts updated.',
          fb:'That clears a stale host key — the right fix for a REMOTE HOST IDENTIFICATION HAS CHANGED warning, which is not what you are seeing. Harmless, but not the problem.' },
        { c:'ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i ~/keys/team-2026.pem ec2-user@10.0.1.20',
          out:'Warning: Permanently added "10.0.1.20" to the list of known hosts.\nec2-user@10.0.1.20: Permission denied (publickey).',
          fb:'Same result, and you disabled host key verification to get it — that is how you end up accepting a man-in-the-middle. Never make this a habit.' }
      ] },

    { kind:'cmd',
      ask:'You cannot SSH in. How do you get a shell to investigate?',
      hint:'There is a path that does not use port 22 or a key pair at all.',
      opts:[
        { c:'aws ssm start-session --target i-0ab12cd34ef56', ok:true,
          out:'Starting session with SessionId: you-08f3a9c1b2\nsh-5.2$ sudo -i\n[root@ip-10-0-1-20 ~]#',
          fb:'This is the answer interviewers are listening for. SSM needs no inbound port and no key — just the agent running, an instance role, and outbound reachability to the SSM endpoints. It is also fully logged.',
          parts:[['aws ssm start-session','Open an interactive shell through Systems Manager'],['--target','The instance ID — not an IP, because no network path to you is required']] },
        { c:'aws ec2-instance-connect send-ssh-public-key --instance-id i-0ab12cd34ef56 --instance-os-user ec2-user --ssh-public-key file://~/.ssh/id_ed25519.pub',
          ok:true,
          out:'{\n    "RequestId": "1c9f...",\n    "Success": true\n}',
          fb:'Also valid — EC2 Instance Connect pushes a temporary key valid for 60 seconds. It still needs port 22 reachable, which you have proven it is.',
          parts:[['ec2-instance-connect send-ssh-public-key','Inject a one-time public key into the instance for 60 seconds'],['--instance-os-user','Which OS account to add it to']] },
        { c:'aws ec2 stop-instances --instance-ids i-0ab12cd34ef56',
          out:'{"StoppingInstances": [{"CurrentState": {"Name": "stopping"}}]}',
          fb:'Detaching the root volume to fix authorized_keys is a legitimate last-resort recovery, but it means an outage. Try SSM first — it costs nothing and takes seconds.' }
      ] },

    { kind:'cmd',
      ask:'You are on the host as root. Why did sshd reject a key it should have?',
      hint:'The server logs its reasoning.',
      opts:[
        { c:'journalctl -u sshd -n 20 --no-pager', ok:true,
          out:'Aug 14 14:03:11 ip-10-0-1-20 sshd[3312]: Authentication refused: bad ownership or modes for directory /home/ec2-user/.ssh\nAug 14 14:03:11 ip-10-0-1-20 sshd[3312]: Connection closed by authenticating user ec2-user 10.0.3.9 port 51422 [preauth]',
          fb:'"bad ownership or modes for directory /home/ec2-user/.ssh". sshd refuses to trust authorized_keys if the directory or file is writable by anyone but the owner — a deliberate safety check, because a group-writable .ssh means anyone in that group can add their own key.',
          parts:[['journalctl -u sshd','Journal entries for the SSH daemon'],['-n 20','Last 20 lines'],['--no-pager','Straight to stdout'],['Authentication refused','sshd\'s own explanation, which the client never sees for security reasons']] },
        { c:'cat /home/ec2-user/.ssh/authorized_keys',
          ok:true,
          out:'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC9... team-2026',
          fb:'The key is present and matches — so this is not a missing-key problem. Worth checking, but the server log names the actual reason.',
          parts:[['authorized_keys','Public keys permitted to log in as this user']] },
        { c:'systemctl restart sshd',
          out:'(no output)',
          fb:'Restarting a daemon that is working correctly and correctly refusing you. It will refuse again for exactly the same reason.' }
      ] },

    { kind:'cmd',
      ask:'Inspect and fix the permissions on the host.',
      hint:'700 on the directory, 600 on the file, owned by the user.',
      opts:[
        { c:'ls -ld /home/ec2-user/.ssh && ls -l /home/ec2-user/.ssh/authorized_keys', ok:true,
          out:'drwxrwxrwx 2 ec2-user ec2-user 4096 Aug 14 13:51 /home/ec2-user/.ssh\n-rw-r--r-- 1 root     root      401 Aug 14 13:51 /home/ec2-user/.ssh/authorized_keys',
          fb:'Two faults from the AMI build: .ssh is 777, and authorized_keys is owned by root instead of ec2-user. Either alone would cause the refusal.',
          parts:[['ls -ld DIR','List the directory itself rather than its contents — the -d is the important part'],['ls -l FILE','Long listing showing mode, owner, and group'],['&&','Run the second command only if the first succeeded']] },
        { c:'chmod 700 /home/ec2-user/.ssh && chmod 600 /home/ec2-user/.ssh/authorized_keys && chown -R ec2-user:ec2-user /home/ec2-user/.ssh', ok:true,
          out:'(no output)',
          fb:'Directory 700, file 600, both owned by the user. That is exactly what sshd requires.',
          parts:[['chmod 700','rwx for the owner only — the user must be able to traverse and write their own .ssh'],['chmod 600','rw for the owner only on authorized_keys'],['chown -R user:group','Recursively set owner and group so sshd trusts the files']] },
        { c:'chmod -R 777 /home/ec2-user/.ssh',
          out:'(no output)',
          fb:'That is the state that broke it, applied harder. sshd will refuse again, and now any user on the box can append their own key.' }
      ] },

    { kind:'cmd',
      ask:'Prove the fix from your laptop.',
      hint:'A verified fix beats an assumed one.',
      opts:[
        { c:'ssh -i ~/keys/team-2026.pem ec2-user@10.0.1.20 "hostname; uptime"', ok:true,
          out:'ip-10-0-1-20.ec2.internal\n 14:09:52 up 23 min,  1 user,  load average: 0.08, 0.14, 0.11',
          fb:'In, with the original key, and you verified without needing an interactive session. Now fix the AMI so the next fifty instances do not inherit this.',
          parts:[['ssh user@host "cmd"','Run a command remotely and exit, instead of opening an interactive shell'],['"hostname; uptime"','Two commands in one remote invocation, separated by a semicolon']] },
        { c:'ssh -i ~/keys/team-2026.pem ec2-user@10.0.1.20',
          ok:true,
          out:'   ,     #_\n   ~\\_  ####_        Amazon Linux 2023\n[ec2-user@ip-10-0-1-20 ~]$',
          fb:'Also fine — you are in. The non-interactive form is handier when you want to script the same check across a fleet.' }
      ] }
  ],
  debrief:{
    why:[
      '"Permission denied (publickey)" arrived instantly, which proved the network path and sshd were both fine — this was authentication, not connectivity. A timeout would have meant the opposite.',
      'ssh -vvv showed the client refusing to load a 0644 private key, so the key was never even offered. chmod 600 fixed the client side.',
      'The key was then offered and still rejected, which moves the problem to the server — and you cannot read the server\'s reasoning from the client.',
      'SSM Session Manager provided a shell with no port 22 and no key pair, which is the recovery path worth naming in an interview.',
      'journalctl -u sshd gave the true reason: bad ownership or modes on /home/ec2-user/.ssh. sshd deliberately refuses a .ssh directory others can write to.',
      'chmod 700 / 600 plus chown to the owning user satisfied sshd, and a non-interactive ssh command verified the fix end to end.'
    ],
    interview:'"First I separate authentication from connectivity: a denial means I reached sshd, a timeout means I did not. For a denial I check three things in order — key file permissions on my side, the right default user for the AMI, and then the server side. The client never learns why the server refused, so I need a shell on the host, and I would use SSM Session Manager because it needs no inbound port and no key. Then journalctl -u sshd tells me plainly: bad ownership or modes on .ssh. That check exists because a world-writable .ssh means anyone can add their own key. I fix 700 on the directory, 600 on authorized_keys, chown to the user, and then fix the AMI so the fleet does not inherit it."',
    prevent:[
      'Bake correct .ssh ownership and modes into the AMI, and test the AMI by logging into it before it is published.',
      'Prefer SSM Session Manager over open SSH: no inbound port, no key distribution, and full session logging.',
      'Remember the default users: ec2-user on Amazon Linux, ubuntu on Ubuntu, admin or centos elsewhere.',
      'ssh-keygen -R for a changed host key after an instance is replaced — never disable host key checking to get past it.'
    ]
  }
},

/* ─────────────────────────────── 6. slow host triage ── */
{
  id:'slow-host', title:'"The server is slow" — sixty seconds to triage', cat:'procs', level:'intermediate',
  mins:7,
  brief:'Support says the application is crawling on ip-10-0-5-9. No alarms have fired. You have a shell and about a minute before someone asks for an update.',
  user:'ec2-user', host:'ip-10-0-5-9',
  steps:[
    { kind:'cmd',
      ask:'Open with the cheapest command that frames the whole problem.',
      hint:'You want to know whether there is real pressure before deciding what kind.',
      opts:[
        { c:'uptime; nproc', ok:true,
          out:' 15:41:02 up 12 days,  4:18,  2 users,  load average: 14.72, 13.90, 9.55\n4',
          fb:'Load 14.7 on 4 cores — genuine saturation, and the 1-minute figure is above the 15-minute, so it is still getting worse. Always pair uptime with nproc; load is meaningless without the core count.',
          parts:[['uptime','Uptime, logged-in users, and 1/5/15-minute load averages'],['nproc','Number of processing units available — the number you compare load against'],[';','Run both sequentially regardless of exit status']] },
        { c:'top',
          out:'(interactive full-screen view)',
          fb:'Fine on a laptop, awkward on a phone and impossible to paste into a ticket. Use top -b -n1 for a snapshot you can capture.' },
        { c:'systemctl list-units --failed',
          out:'0 loaded units listed.',
          fb:'Good triage habit on a systemd box and worth doing — but nothing has failed, so it does not explain slowness.' },
        { c:'sudo reboot',
          out:'Connection closed by remote host.',
          fb:'You destroyed the evidence and any chance of a root cause, and the load will very likely come straight back.' }
      ] },

    { kind:'cmd',
      ask:'High load. Is the CPU actually busy?',
      hint:'Linux load counts uninterruptible sleep too, so high load does not have to mean CPU.',
      opts:[
        { c:'top -b -n1 | head -12', ok:true,
          out:'top - 15:41:20 up 12 days,  4:18,  2 users,  load average: 14.72, 13.90, 9.55\nTasks: 141 total,   1 running, 128 sleeping,  12 D\n%Cpu(s):  2.1 us,  1.4 sy,  0.0 ni,  8.0 id, 88.5 wa,  0.0 hi,  0.0 si\nMiB Mem :   7924.0 total,   3011.2 free,   1902.6 used,   3010.2 buff/cache\n\n  PID USER      PR  NI    VIRT    RES  %CPU  %MEM TIME+   COMMAND\n 4412 root      20   0  118204   2884   1.9   0.0 0:41.02 tar\n 8890 appsvc    20   0  2418000 892112  1.7  11.0 12:02.9 python',
          fb:'The key number is 88.5 wa — the CPU is idle, waiting on I/O. 12 tasks are in D state. This is not a CPU problem at all, and no process is using meaningful CPU.',
          parts:[['top','Process and system summary'],['-b','Batch mode — plain text, no interactive display'],['-n1','One iteration and exit'],['| head -12','Just the summary block and the top few processes'],['wa','Percentage of CPU time idle while waiting for outstanding disk I/O']] },
        { c:'ps aux --sort=-%cpu | head -5',
          out:'USER   PID %CPU %MEM COMMAND\nroot  4412  1.9  0.0 tar czf /backup/data-20260814.tgz /data\nappsvc 8890 1.7 11.0 python /opt/app/worker.py',
          fb:'Highest CPU on the box is 1.9% — so nothing is CPU-bound. That is a useful negative, but it does not tell you what everything is waiting on.' },
        { c:'free -h',
          out:'               total        used        free      shared  buff/cache   available\nMem:           7.7Gi       1.8Gi       2.9Gi        21Mi       2.9Gi       5.5Gi',
          fb:'5.5G available and no swap in use — memory is comfortably fine. Another good elimination, but not the cause.' }
      ] },

    { kind:'think',
      ask:'88% of CPU time is in "wa" and a dozen tasks are in D state. What does that mean?',
      hint:'D is uninterruptible sleep.',
      opts:[
        { t:'Processes are blocked waiting on disk I/O — the storage is the bottleneck, not the CPU', ok:true,
          fb:'Right, and this is exactly why load average on Linux can be high while the CPU is nearly idle: D-state tasks count toward load. It is also why those processes cannot be killed, even with -9, until their I/O completes.' },
        { t:'The CPU is oversubscribed and processes are queuing for it',
          fb:'Then you would see high us or sy and near-zero idle. Here 88% of the time is spent waiting, with actual CPU work close to nothing.' },
        { t:'The system is out of memory and swapping',
          fb:'Swapping does produce I/O wait, but free -h showed 5.5G available and no swap in use. Check si/so in vmstat if you want to be certain.' },
        { t:'A network partition is causing retries',
          fb:'Possible in principle — an NFS hang looks like this — but nothing yet points at the network, and the local disk has not been examined.' }
      ] },

    { kind:'cmd',
      ask:'Find out which device is saturated.',
      hint:'You want per-device utilisation and latency.',
      opts:[
        { c:'iostat -xz 1 3', ok:true,
          out:'Device   r/s     w/s   rkB/s    wkB/s  await  aqu-sz  %util\nnvme0n1  2.00    8.00   16.0     96.0    1.21   0.01    1.4\nnvme1n1  412.00  980.00 41200.0 198400.0 241.86  38.42   99.9\n\nDevice   r/s     w/s   rkB/s    wkB/s  await  aqu-sz  %util\nnvme1n1  398.00  1004.0 39800.0 201200.0 248.13  39.11  100.0',
          fb:'nvme1n1 is pinned at 100% utilisation with 240ms average wait and a queue depth near 40. The root volume is idle. One device is absorbing everything.',
          parts:[['iostat','Per-device I/O statistics'],['-x','Extended statistics including await, queue size, and utilisation'],['-z','Omit devices with no activity'],['1 3','Three samples, one second apart — the first sample is averages since boot, so always take more than one']] },
        { c:'df -h',
          out:'Filesystem      Size  Used Avail Use% Mounted on\n/dev/nvme0n1p1   30G   11G   19G  37% /\n/dev/nvme1n1    500G  310G  190G  62% /data',
          fb:'Space is fine. Being full and being saturated are different problems — this one is about throughput, not capacity.' },
        { c:'vmstat 1 3',
          ok:true,
          out:'procs -----------memory---------- ---swap-- -----io---- -system-- ------cpu-----\n r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa\n 1 12      0 3084212  2104 3082140    0    0  4102 49820 2201 3902  2  1  9 88\n 0 13      0 3081008  2104 3082140    0    0  3980 50100 2180 3877  2  1  8 89',
          fb:'Also correct: b=12 blocked processes, si/so at zero ruling out swapping, and wa at 88. It confirms disk I/O but does not name the device — follow it with iostat.',
          parts:[['vmstat','Virtual memory and system activity'],['1 3','Three one-second samples'],['b','Processes blocked on I/O'],['si/so','Swap in / swap out — zero means no memory pressure'],['wa','CPU time waiting on I/O']] }
      ] },

    { kind:'cmd',
      ask:'Which process is generating that I/O?',
      hint:'Per-process disk statistics.',
      opts:[
        { c:'sudo pidstat -d 1 3', ok:true,
          out:'UID  PID   kB_rd/s   kB_wr/s kB_ccwr/s iodelay Command\n0    4412   39200.0  196800.0     0.00    8821 tar\n993  8890      42.0      88.0     0.00      12 python\n0    3301       0.0      12.0     0.00       0 rsyslogd',
          fb:'PID 4412, a tar, is doing 196 MB/s of writes and 39 MB/s of reads. Everything else on the box is rounding error.',
          parts:[['pidstat','Per-process statistics from the sysstat package'],['-d','Disk I/O per process'],['1 3','Three one-second samples'],['iodelay','Time this task spent blocked waiting for I/O']] },
        { c:'ps -eo state,pid,cmd | grep "^D"',
          ok:true,
          out:'D 8891 python /opt/app/worker.py\nD 8892 python /opt/app/worker.py\nD 4412 tar czf /backup/data-20260814.tgz /data',
          fb:'Shows the victims and one of the causes. The workers are blocked, and tar is in the list — but pidstat -d quantifies who is actually generating the load.',
          parts:[['ps -eo state,pid,cmd','Every process, printing state, PID, and command'],['grep "^D"','Lines starting with D — uninterruptible sleep, almost always blocked on I/O']] },
        { c:'lsof /data | head',
          out:'COMMAND  PID USER   FD   TYPE DEVICE  SIZE/OFF NODE NAME\ntar     4412 root  cwd    DIR  259,2      4096    2 /data\npython  8890 appsvc 3r    DIR  259,2      4096  118 /data/queue',
          fb:'Tells you who has files open on that filesystem, which is useful context, but not how much I/O each one is doing.' }
      ] },

    { kind:'cmd',
      ask:'Understand the job before you touch it.',
      hint:'Who started it, when, and is it nearly done?',
      opts:[
        { c:'ps -o pid,ppid,user,etime,nice,cmd -p 4412', ok:true,
          out:'  PID  PPID USER     ELAPSED  NI CMD\n 4412  3987 root       48:12   0 tar czf /backup/data-20260814.tgz /data',
          fb:'A 48-minute-old backup running at normal priority, parented by cron (PPID 3987). It is a legitimate job scheduled at a bad time, competing directly with production I/O.',
          parts:[['ps -o ...','Choose exactly the columns you need'],['ppid','Parent PID — reveals whether cron, systemd, or a human started it'],['etime','Elapsed wall-clock time since the process started'],['nice','Scheduling niceness — 0 is the default, higher is more polite']] },
        { c:'sudo kill -9 4412',
          out:'(no output)',
          fb:'You just killed a backup 48 minutes in, with no idea whether it was nearly finished, leaving a corrupt tarball at the destination. Understand before you act.' },
        { c:'crontab -l -u root',
          ok:true,
          out:'0 15 * * * /opt/scripts/backup.sh',
          fb:'Also useful — it confirms the backup is scheduled for 15:00, in the middle of the business day. That is the real finding.',
          parts:[['crontab -l','List a crontab'],['-u root','For a specific user']] }
      ] },

    { kind:'cmd',
      ask:'Reduce the impact right now without losing the backup.',
      hint:'CPU priority alone will not help a job that is I/O bound.',
      opts:[
        { c:'sudo ionice -c3 -p 4412 && sudo renice -n 19 -p 4412', ok:true,
          out:'4412 (process ID) old priority 0, new priority 19',
          fb:'ionice class 3 is idle — the backup now only gets disk when nothing else wants it — and renice deprioritises its CPU. The job finishes, production recovers, nothing is lost.',
          parts:[['ionice','Set I/O scheduling class and priority'],['-c3','Class 3 = idle: only gets disk time when no other process wants it'],['-p PID','Apply to an already-running process'],['renice -n 19','Lower CPU priority to the most polite value — 19 is the maximum']] },
        { c:'sudo kill -TERM 4412',
          out:'(no output)',
          fb:'Defensible if the backup can be rerun and production is being harmed badly enough — but you lose 48 minutes of work and a partial archive is left behind. Try to contain before you cancel.' },
        { c:'sudo systemctl restart myapp',
          out:'(no output)',
          fb:'The application is not the problem — it is a victim, blocked waiting on a saturated disk. Restarting it just drops in-flight work and it will block again immediately.' }
      ] },

    { kind:'cmd',
      ask:'Confirm recovery, then say what you would change.',
      hint:'Verify with the same measurement you used to diagnose.',
      opts:[
        { c:'iostat -xz 1 3 && uptime', ok:true,
          out:'Device   r/s    w/s   rkB/s   wkB/s  await  aqu-sz  %util\nnvme1n1  88.00  210.0  8800.0 42000.0   9.21    1.94    38.6\n\n 15:47:31 up 12 days,  4:24,  2 users,  load average: 4.12, 9.80, 8.91',
          fb:'Utilisation down to 38%, await from 240ms to 9ms, and load falling from 14 to 4. The application is responsive again and the backup is still running.',
          parts:[['iostat -xz 1 3','Re-measure the device that was saturated'],['await','Average time in milliseconds an I/O request waited — the latency your application feels'],['%util','Percentage of time the device was busy — near 100 means saturated'],['uptime','Confirm load is trending down']] },
        { c:'echo done',
          out:'done',
          fb:'Never end an incident without re-measuring. "It feels better" is not a finding you can put in a ticket.' }
      ] }
  ],
  debrief:{
    why:[
      'uptime with nproc established real saturation — load 14.7 on 4 cores — and the 1-minute above the 15-minute showed it was still worsening.',
      'top -b -n1 showed 88.5% wa and 12 tasks in D state, which reframed the problem from CPU to I/O in a single command.',
      'iostat -xz named the saturated device: nvme1n1 at 100% util with 240ms await, while the root volume was idle.',
      'pidstat -d attributed the I/O to one process — a tar writing 196 MB/s — rather than to the application that was merely blocked by it.',
      'ps -o etime,ppid showed it was a 48-minute-old cron backup, so the fix was scheduling and priority, not killing something.',
      'ionice -c3 plus renice contained it without losing the backup, and re-running iostat proved the recovery instead of assuming it.'
    ],
    interview:'"I triage by resource, one tool each. uptime against nproc for whether there is real pressure. top for the split — if wa is high and CPU is idle, it is I/O, and Linux load includes D-state tasks which is why load can be high with an idle CPU. Then iostat -xz to find the saturated device, looking at %util and await, and pidstat -d to attribute it to a process. Here it was a cron backup competing with production, so I contained it with ionice class 3 and renice rather than killing it, then re-measured to confirm. The durable fixes are scheduling backups outside business hours, ionice in the script itself, and on EBS checking whether we are simply hitting provisioned IOPS."',
    prevent:[
      'Run backups outside peak hours, and start the script with ionice -c3 and nice so it can never crowd out production.',
      'On EBS, check whether %util at 100% means provisioned IOPS exhausted — the fix there is volume type or size, not scheduling.',
      'Alarm on disk await and queue depth, not just utilisation — latency is what the application actually feels.',
      'Keep sysstat installed and collecting, so sar can answer "what did it look like at 3am" after the fact.'
    ]
  }
}

);
