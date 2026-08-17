/* Playbooks — the O.N.V.A. troubleshooting trees.
   Each step: check (what you are doing), cmd, decide (what it settles),
   why (how it works and how to read it), optional branches that fork the tree. */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.playbooks = LX.playbooks || [];

LX.playbooks.push(

/* ═══ 0. the framework — the spine every other tree hangs off ═══ */
{
  id:'pb-framework', title:'Start here: the O.N.V.A. framework', cat:'ops', level:'beginner',
  prompt:'Any "what would you check next?" question. This is the shape of every answer.',
  say:'"I would start by gathering read-only information so I do not change the state of the system before I understand the problem. First I confirm the symptom and scope, then check the layer most likely involved, and use what I find to decide the next check."',
  steps:[
    { check:'Observe', cmd:'who / what / when / scope',
      decide:'Is it one user, one process, one host, or everyone? And what changed?',
      why:'Scope is the cheapest and highest-value information you can get. One user means permissions or session; one host means that host; everyone means a shared dependency or a change. Establishing scope out loud is what makes the rest of your answer sound deliberate rather than lucky.' },
    { check:'Narrow', cmd:'top · ps · free · df · ss · systemctl',
      decide:'Which layer looks unhealthy — process, memory, storage, network, permissions?',
      why:'One cheap read-only command per resource, in a fixed order, so you eliminate rather than guess. You are not trying to find the cause here; you are trying to pick the branch.',
      branches:[
        { when:'Service is failed, inactive, or restarting', then:'Go to the systemd tree', goto:'pb-svc-start' },
        { when:'CPU pinned', then:'Go to the CPU tree', goto:'pb-cpu' },
        { when:'Memory pressure or processes disappearing', then:'Go to the memory tree', goto:'pb-mem' },
        { when:'Disk full or slow', then:'Go to the storage trees', goto:'pb-disk-full' },
        { when:'Load high but CPU idle', then:'Go to the I/O tree', goto:'pb-load' },
        { when:'Reachability problem', then:'Go to the connectivity tree', goto:'pb-listen' },
        { when:'Permission denied', then:'Go to the permissions tree', goto:'pb-file-access' }
      ] },
    { check:'Verify', cmd:'journalctl · stat · namei · iostat · dig · curl',
      decide:'Can I collect evidence that confirms the suspected cause?',
      why:'A hypothesis is not a diagnosis. This step is where you go from "storage looks suspicious" to "nvme1n1 is at 100% utilisation with 240ms await, and the process doing it is the 03:00 backup". Say what you are trying to prove or eliminate before you run the command.' },
    { check:'Act', cmd:'restart · chmod · config · cleanup — only after evidence',
      decide:'What is the smallest safe remediation, and how will I validate it?',
      why:'Smallest reversible change, then re-run the original failing test. Capture state and logs before you change anything, because a restart can erase the only evidence of what happened. Then confirm the user-visible symptom is actually gone, not just the metric.' }
  ],
  probes:[
    ['What are interviewers actually grading?', 'That you observe before you change, that you can move from a symptom to the right subsystem, that you interpret output rather than dumping command names, and that you change direction when new evidence arrives.'],
    ['The phrase that buys you structure', '"Based on that output, I would branch next." Then name the branch: CPU, memory, disk, network, permissions, logs, or dependency.'],
    ['What if the tool is not installed?', '"If that tool is available I would use it; otherwise I would use the closest built-in signal — /proc, ps, vmstat, or the system logs."']
  ],
  trap:'Making a change before you have evidence. Restarting the service is the most common one — it changes state, may hide the cause, and destroys the logs you needed.',
  remember:'Observe → Narrow → Verify → Act. Read-only first, every time.'
},

/* ═══ 1. permission denied on a file ═══ */
{
  id:'pb-file-access', title:'A user cannot access a file', cat:'perms', level:'beginner',
  prompt:'"A user is unable to access a file. They do not have permission. What steps would you take?"',
  say:'"First I would clarify whether they need to read, write, or execute, and capture the exact error. Then I would verify the user identity and group membership, inspect the file and every directory in the path, and check ACLs if the normal mode bits look correct. I would only change permissions after I know exactly which permission is missing."',
  steps:[
    { check:'Confirm identity', cmd:'id alice; groups alice',
      decide:'Is the account actually in the group you assume it is in?',
      why:'Everything downstream depends on which identity is doing the access. id shows UID, primary group and every supplementary group in one line. If the group you expect is missing, you have your answer in one command — and if it is present, you have eliminated the most common cause.' },
    { check:'Inspect the file', cmd:'ls -l FILE; stat FILE',
      decide:'Owner, group, and the rwx bits — which of read, write, execute is actually missing?',
      why:'ls -l gives you the mode string; stat gives it in octal, which is what you quote out loud. Match the missing right to the operation they were attempting: reading needs r, modifying needs w, running needs x.',
      branches:[
        { when:'Mode bits look wrong for the operation', then:'You have the cause — jump to the safe remediation step, granting only the missing right.' },
        { when:'Mode bits look correct', then:'Do not stop here. Walk the path next — a parent directory is the usual culprit.' }
      ] },
    { check:'Inspect the whole path', cmd:'namei -l /srv/app/config.yaml',
      decide:'Can the user traverse every parent directory, not just read the final file?',
      why:'This is the step people skip. You need execute (traverse) permission on every directory in the path; one directory missing x blocks access even when the file itself is world-readable. namei -l prints the ownership and mode of each component in order, so the offending level is obvious.' },
    { check:'Check ACLs', cmd:'getfacl FILE',
      decide:'Is an ACL granting or denying access beyond the normal mode bits?',
      why:'A trailing + on the mode string in ls -l (drwxr-x---+) means ACLs are in play and ls is not telling you the whole story. getfacl shows the per-user and per-group entries, plus the mask that can silently clamp them.' },
    { check:'Check the session', cmd:'(have them re-login) or newgrp GROUP',
      decide:'Was the group membership added after their current login session started?',
      why:'Supplementary groups are attached to the process at login. Adding a user to a group does nothing for shells they already have open — id in that old shell will not show the new group. A fresh login or newgrp picks it up. This explains an enormous number of "I added them to the group and it still fails" tickets.' },
    { check:'Check the security layer', cmd:'getenforce; ausearch -m avc -ts recent',
      decide:'If Unix permissions look correct, is mandatory access control blocking it?',
      why:'SELinux or AppArmor can deny an operation that the mode bits allow — commonly after files were moved with mv, which preserves the old context. Diagnose with the audit log; fix with restorecon rather than by disabling enforcement.' },
    { check:'Remediate safely', cmd:'chmod g+r FILE   /   chgrp GROUP FILE',
      decide:'What is the narrowest change that grants exactly the missing right?',
      why:'Grant the specific right to the specific identity — group read, or traverse on one directory. Then have the user retry the original operation to confirm. Ownership problems need chown, mode problems need chmod: use the tool that matches the actual defect.' }
  ],
  probes:[
    ['What does x mean on a file?', 'It allows executing that file. It does not grant read access — you can have x without r, and the file will fail to run for a different reason.'],
    ['What does x mean on a directory?', 'It allows traversal: entering the directory and accessing known names inside it. Without x you cannot cd into it or reach anything below it, even with r.'],
    ['They were just added to the group — why still denied?', 'Their existing session does not have the new supplementary group. They need a new login, or newgrp for a new shell.'],
    ['Explain chmod 640 in words.', 'Owner read and write, group read only, other nothing. 6 = 4+2, 4 = read, 0 = none.']
  ],
  trap:'Reaching for chmod 777 or blindly adding +x. It hides which right was actually missing, and on a web root it means anyone on the host can replace your application code.',
  remember:'Files: r = read, w = modify, x = execute. Directories: r = list names, w = create/delete entries, x = traverse.',
  mission:null
},

/* ═══ 2. which user is running the process ═══ */
{
  id:'pb-proc-user', title:'Which user is actually running the process?', cat:'procs', level:'beginner',
  prompt:'"What if the file or process is supposed to be run by another user? How would you see which user is running the process?"',
  say:'"I would identify the process and check its real and effective user — ps shows that directly. If it is a systemd service I would also inspect the unit to see the configured User and Group. Then I would evaluate file permissions from the service account\'s perspective, not from my own login account."',
  steps:[
    { check:'Find the process', cmd:'pgrep -af myapp   ·   ps -ef | grep [m]yapp',
      decide:'What is the PID, and what is the full command line?',
      why:'The full command line matters as much as the PID — it tells you which config file and which arguments are in play. The bracket trick, grep [m]yapp, stops grep from matching its own command line.' },
    { check:'Check the identity', cmd:'ps -o user,euser,group,egroup,pid,ppid,cmd -p 1234',
      decide:'Which real and effective user and group is it actually using?',
      why:'Permission checks generally use the effective UID, which can differ from the real UID after a setuid or a privilege drop. Printing both in one line is a precise, interview-friendly answer — much better than assuming it runs as whoever started it.' },
    { check:'If it is a systemd service', cmd:'systemctl show myapp -p User -p Group',
      decide:'Which account is the unit configured to run as?',
      why:'systemctl show reads the effective unit configuration, including drop-ins, without you hunting for files on disk. This is the configured intent; ps is the runtime reality. When they disagree, something overrode the unit.' },
    { check:'Confirm from the kernel', cmd:'grep -E "^(Uid|Gid):" /proc/1234/status',
      decide:'What does the kernel itself say the real, effective, saved and filesystem IDs are?',
      why:'/proc is the source of truth and settles any disagreement between tools. The four numbers on each line are real, effective, saved-set and filesystem IDs, in that order.' },
    { check:'Test the permission chain as that identity', cmd:'namei -l /srv/app/data/file; getfacl /srv/app/data/file',
      decide:'Can the service account traverse and access the target?',
      why:'This closes the loop: you are no longer asking "can I read it" but "can appsvc read it". Evaluate every directory in the path against the service account\'s groups.' }
  ],
  probes:[
    ['Why the effective user?', 'The kernel generally uses effective credentials for permission checks. Real versus effective matters with setuid binaries and with processes that drop privileges after binding a low port.'],
    ['Could top show this?', 'Yes, top has a USER column. ps is cleaner for a targeted answer because you can name exactly the fields you want.'],
    ['Why does it matter for file access?', 'Because your login account may read a file the service account cannot. Always evaluate permissions as the identity doing the access.']
  ],
  trap:'Checking only your own shell user. A daemon may run as nginx, apache, postgres, or a dedicated service account with far fewer groups than you have.',
  remember:'Permissions are evaluated as the identity doing the access, not the identity asking the question.'
},

/* ═══ 3. systemctl vs journalctl ═══ */
{
  id:'pb-systemctl-journalctl', title:'systemctl vs journalctl', cat:'sys', level:'beginner',
  prompt:'"What is the difference between systemctl and journalctl?"',
  say:'"systemctl manages and inspects systemd units — start, stop, restart, enable, disable, status. journalctl queries the logs collected by systemd-journald. In troubleshooting I use them together: systemctl status tells me the state, then journalctl -u gives me the detailed history around the failure."',
  steps:[
    { check:'State', cmd:'systemctl status nginx',
      decide:'Is the unit active, failed, inactive, or restarting — and with what exit code?',
      why:'status is the orientation command: loaded/enabled state, active state, main PID, and a short excerpt of recent log lines. The excerpt is a convenience, not the log itself — that distinction is exactly what this question is testing.' },
    { check:'Management', cmd:'systemctl start|stop|restart|enable NAME',
      decide:'Change unit state, or boot behaviour, once remediation is justified.',
      why:'start affects now; enable affects every boot. "It works until reboot" almost always means someone started without enabling. enable --now does both.' },
    { check:'Logs', cmd:'journalctl -u nginx',
      decide:'What did the service actually say?',
      why:'The journal holds everything the unit wrote to stdout and stderr, including the messages a service emits before it is healthy enough to write its own log file. This is why a service that fails to start has evidence only here.' },
    { check:'Narrow the window', cmd:'journalctl -u nginx --since "15 min ago"',
      decide:'What happened inside the incident window?',
      why:'Time-bounding turns thousands of lines into a readable handful. Combine with -p err to keep only warnings and worse.' },
    { check:'Separate boots', cmd:'journalctl -u nginx -b   ·   journalctl -b -1 -e',
      decide:'Is this from the current boot or the one before?',
      why:'-b is the current boot; -b -1 is the previous one. "Why did the host reboot?" is answered by reading the tail of the previous boot, which is a genuinely impressive move in an interview.' }
  ],
  probes:[
    ['Does systemctl status show logs?', 'It shows a short recent excerpt, but journalctl is the dedicated log-query tool with filtering by unit, time, priority and boot.'],
    ['What is journald?', 'systemd-journald is the service that collects, indexes and stores journal events from the kernel, from units, and from anything logging to syslog.'],
    ['How would you cap journal size?', 'journalctl --disk-usage to measure, then --vacuum-size=200M, or SystemMaxUse= in journald.conf to make it permanent.']
  ],
  trap:'Calling systemctl a logging command. It manages units; the log excerpt in status output is a convenience.',
  remember:'systemctl = unit state and control. journalctl = the logs. Status first, logs second.'
},

/* ═══ 4. service is slow ═══ */
{
  id:'pb-slow', title:'A service is really slow', cat:'procs', level:'beginner',
  prompt:'"A service is really slow. Without changing anything, what is the first thing you would do?"',
  say:'"I would start with read-only observation and confirm whether the slowdown is system-wide or isolated to that service. I would check service state, then CPU and memory, overall load, and logs for timeouts. From there I would branch into disk I/O, storage capacity, or network depending on what the evidence shows."',
  steps:[
    { check:'Scope', cmd:'uptime; nproc; systemctl status NAME',
      decide:'Is the whole host unhealthy, or only this service?',
      why:'Load average is meaningless without the core count, so pair uptime with nproc. Reading the three load figures as a trend tells you whether it is getting worse (1-min above 15-min) or recovering. If the host is fine and only this unit is slow, you have already halved the search space.' },
    { check:'CPU and processes', cmd:'top -b -n1 | head -15   ·   ps -eo pid,user,%cpu,%mem,stat,cmd --sort=-%cpu | head',
      decide:'Is one process CPU-bound, or is nothing actually busy?',
      why:'Read the %Cpu(s) line before the process list: us is user work, sy is kernel, wa is time idle waiting on I/O. High wa with low us means this is not a CPU problem at all — it is storage, and you should switch branches immediately.',
      branches:[
        { when:'One process pinned at high %CPU', then:'Follow the CPU tree', goto:'pb-cpu' },
        { when:'High wa, low us — CPU is waiting', then:'Follow the I/O tree', goto:'pb-load' },
        { when:'Nothing is busy at all', then:'Suspect a dependency or lock — check logs and downstream latency next.' }
      ] },
    { check:'Memory', cmd:'free -h; vmstat 1 5',
      decide:'Memory pressure, swapping, or blocked tasks?',
      why:'Read available, not free — Linux fills spare RAM with cache and hands it back on demand. In vmstat, si/so above zero means real swapping, b counts processes blocked on I/O, and wa is the same wait figure top shows.' },
    { check:'Logs', cmd:'journalctl -u NAME --since "15 min ago"',
      decide:'Timeouts, errors, retries, dependency failures?',
      why:'Application logs often name the slow dependency directly, which saves you from measuring the whole stack. Retry storms and connection-pool exhaustion show up here long before they show up in system metrics.' },
    { check:'Storage capacity', cmd:'df -h; df -i',
      decide:'Full filesystem or inode exhaustion?',
      why:'A full disk produces bizarre slowness and failures that look like anything else. Two cheap commands eliminate both variants — and df -i catches the case where there is space but no inodes.' },
    { check:'Disk performance', cmd:'iostat -xz 1 3',
      decide:'Latency, queueing, saturation on a specific device?',
      why:'%util near 100 with a high await means the device is saturated and requests are queueing. On EBS that usually means you are hitting provisioned IOPS rather than a failing disk. Follow with pidstat -d to attribute the I/O to a process.' },
    { check:'Network and dependencies', cmd:'ss -s; ss -lntp; curl -w timing to the dependency',
      decide:'Connection backlog, reachability, or downstream latency?',
      why:'curl -w splits a request into DNS, connect, TLS and time-to-first-byte, so you can say precisely which layer is slow instead of guessing. ss -s catches socket exhaustion and TIME_WAIT build-up.' }
  ],
  probes:[
    ['Where does du fit here?', 'After df suggests capacity pressure. du answers where space is allocated; it says nothing about performance, and walking a huge tree is expensive.'],
    ['Why not restart first?', 'A restart changes state, may erase the evidence, and often hides the cause for another few hours. Capture state and logs first.'],
    ['Disk is fine, CPU is low, memory is fine, still slow. Next?', 'Dependencies and locking. Measure downstream latency, check connection pools and thread counts, and look for contention in the application logs.']
  ],
  trap:'Jumping straight to du -ha with no evidence of a capacity problem. Investigating storage is not wrong; leading with it, before establishing why storage is a likely branch, is.',
  remember:'"Slow" is a symptom, not a diagnosis. CPU, memory, disk I/O, network, locking, or an unhealthy dependency.',
  mission:'m-disk'
},

/* ═══ 5. systemd service will not start ═══ */
{
  id:'pb-svc-start', title:'A systemd service will not start', cat:'sys', level:'beginner',
  prompt:'"The service fails when you try to start it. Walk me through troubleshooting."',
  say:'"I would check systemctl status first for the unit state and immediate failure reason, then journalctl for the full logs around the attempt. I would verify the unit configuration and dependencies, then check permissions, ports, files and resources indicated by the error before changing anything."',
  steps:[
    { check:'State', cmd:'systemctl status NAME',
      decide:'Exit code, failed state, and the last few log lines.',
      why:'The exit code tells you a lot on its own: code=exited status=1 usually means the process rejected its config, while code=killed status=9/KILL means something external terminated it — most often the OOM killer. A failure in ExecStartPre points at a validator, not the service itself.',
      branches:[
        { when:'code=killed, signal 9', then:'Something external killed it — go to the memory tree', goto:'pb-mem' },
        { when:'Exit code from the app', then:'Read the journal for the message it printed before exiting.' },
        { when:'Restart counter climbing', then:'It is crash-looping — follow that tree', goto:'pb-crashloop' }
      ] },
    { check:'Logs for this boot', cmd:'journalctl -u NAME -b -n 100 --no-pager',
      decide:'What is the full failure context?',
      why:'A service that dies during startup usually cannot write to its own log file, so the journal is the only record. --no-pager matters when you are scripting or on a small screen.' },
    { check:'Unit configuration', cmd:'systemctl cat NAME',
      decide:'ExecStart, User, Group, Environment, dependencies — is the unit itself sane?',
      why:'systemctl cat shows the effective unit including drop-in overrides, which is what systemd is actually running. Check that Type= matches how the process behaves: declaring Type=forking for a process that stays in the foreground makes systemd think it failed.' },
    { check:'Validate the app config', cmd:'nginx -t   ·   sshd -t   ·   the app\'s own checker',
      decide:'Is this a syntax or configuration error rather than a systemd problem?',
      why:'Most daemons ship a validator, and it gives you the file and line number. It is also the command you re-run after the fix, before restarting, so a restart is a predictable action rather than a gamble.' },
    { check:'Dependencies', cmd:'systemctl list-dependencies NAME',
      decide:'Is a required unit missing or failed?',
      why:'A unit that requires a mount, a network target, or another service will fail with a confusing message when that dependency is not there. This is also where ordering problems show up after a reboot.' },
    { check:'Runtime requirements', cmd:'ss -lntp   ·   namei -l /path   ·   df -h',
      decide:'Port conflict, permission problem, or no disk space?',
      why:'Three classic external causes: something already owns the port ("Address already in use"), the service account cannot traverse to a file it needs, or the filesystem is full so it cannot write a PID or socket file.' }
  ],
  probes:[
    ['It starts now but not after reboot. Why?', 'It was started but never enabled, or a dependency it needs is not ordered before it. systemctl is-enabled and list-dependencies answer both.'],
    ['You edited the unit and nothing changed.', 'systemd caches unit files. daemon-reload is mandatory after any unit edit.'],
    ['How do you keep this from recurring?', 'Validate config in CI, keep an ExecStartPre validator in the unit, and deploy to a canary before the fleet.']
  ],
  trap:'Restarting repeatedly and hoping. Each restart adds noise to the journal and the failure message is already there from the first attempt.',
  remember:'Read the error before treating the error. The journal usually names the branch to investigate.',
  mission:'m-nginx'
},

/* ═══ 6. high CPU ═══ */
{
  id:'pb-cpu', title:'CPU is at 95–100 percent', cat:'procs', level:'intermediate',
  prompt:'"CPU is at 95-100 percent. What do you do?"',
  say:'"First I would confirm whether that is total host CPU or one process. I would use top or ps to identify the consumers, look at user versus system CPU and load, then inspect the specific process, its threads, its logs and recent changes. I would not kill it until I understand whether the CPU use is expected and what terminating it would do."',
  steps:[
    { check:'Confirm the load', cmd:'uptime; nproc; top -b -n1 | head',
      decide:'Load average against core count, and the user/system/wait breakdown.',
      why:'Load 8 on 16 cores is comfortable; load 8 on 2 cores is saturation. The %Cpu line then splits the work: high us is application code, high sy is kernel work such as context switching or syscall storms, high wa is not CPU at all.' },
    { check:'Find the consumer', cmd:'ps -eo pid,user,%cpu,%mem,stat,cmd --sort=-%cpu | head',
      decide:'Is it one process, several, or nothing in particular?',
      why:'A repeatable snapshot you can paste into a ticket, sorted by the field that matters. If no process is above a few percent while the host reports 100%, the time is going somewhere else — interrupts, steal on a noisy neighbour, or I/O wait.' },
    { check:'Threads', cmd:'top -H -p 1234   ·   ps -L -p 1234 -o pid,tid,pcpu,stat,comm',
      decide:'One hot thread or all of them?',
      why:'One thread at 100% while the rest idle usually means a spin loop, a stuck lock, or a runaway task. All threads busy is genuine parallel workload. In a JVM the hot thread ID also maps to a thread dump, which is how you get to the actual line of code.' },
    { check:'Process detail', cmd:'ps -p 1234 -o lstart,etime,cmd',
      decide:'How long has it been running, and what exactly was it started with?',
      why:'Start time correlates the spike with a deploy, a cron job, or a traffic change. The full command line often reveals it is a batch job or a debug flag that should not be on in production.' },
    { check:'Correlate', cmd:'journalctl -u NAME --since "15 min ago"   ·   strace -c -p 1234',
      decide:'Errors, retries or restarts around the spike — and where is the time going?',
      why:'strace -c summarises which syscalls dominate, which distinguishes a userspace busy loop from something hammering the kernel. Pair that with the logs: a retry storm against a failing dependency burns CPU and looks like an application bug.' },
    { check:'Contain, do not kill', cmd:'renice -n 19 -p 1234   ·   ionice -c3 -p 1234',
      decide:'Can you reduce the impact while you decide?',
      why:'Deprioritising buys time without losing work or evidence. Only escalate to a signal once you know what the process is; then TERM first so it can clean up, and KILL only if it ignores that.' }
  ],
  probes:[
    ['When is high CPU fine?', 'When it is expected work finishing faster. The real question is whether it is sustained, unexplained, and causing user-visible impact.'],
    ['us vs sy?', 'us is time in application code; sy is time in the kernel on its behalf. High sy points at syscall volume, context switching, or network/filesystem work.'],
    ['What if the CPU is stolen?', 'Check the st column in top — on a shared or burstable instance you may simply be out of credits.']
  ],
  trap:'Answering "kill -9" first. It prevents graceful cleanup, can corrupt state, and in an interview it signals you reach for the biggest hammer available.',
  remember:'High CPU can be legitimate. Identify, understand, contain, then act.',
  mission:'m-oom'
},

/* ═══ 7. memory / OOM ═══ */
{
  id:'pb-mem', title:'Low memory, or processes being killed', cat:'procs', level:'intermediate',
  prompt:'"The host is low on memory or processes are being killed. What would you check?"',
  say:'"I would check available memory and swap, then identify the largest resident-memory consumers. I would look for evidence of OOM kills in the kernel log and determine whether memory is steadily growing, whether the workload changed, or whether there is system-wide pressure."',
  steps:[
    { check:'Memory state', cmd:'free -h',
      decide:'Available memory, cache, and whether swap exists at all.',
      why:'Read the available column: it estimates what a new allocation could get, including reclaimable page cache. Low free with high available is completely healthy. Note whether swap is zero — on Amazon Linux it usually is, which means pressure goes straight to an OOM kill with no warning period.' },
    { check:'Pressure over time', cmd:'vmstat 1 5',
      decide:'Is it actually swapping, and are tasks blocked?',
      why:'si and so are swap-in and swap-out; sustained non-zero values mean real memory pressure, not just a full cache. r is the run queue and b is tasks blocked on I/O — swapping usually raises both.' },
    { check:'Consumers', cmd:'ps -eo pid,user,%mem,rss,vsz,cmd --sort=-rss | head',
      decide:'Which processes hold the most resident memory?',
      why:'Sort by RSS, not VSZ: resident memory is real physical pages, while virtual size includes mappings that were never touched. A JVM with a 5 GB VSZ and 900 MB RSS is not your problem.' },
    { check:'OOM evidence', cmd:'journalctl -k | grep -i -E "oom|out of memory|killed process"   ·   dmesg -T | grep -i "out of memory"',
      decide:'Did the kernel OOM killer actually act, and on whom?',
      why:'This is the one piece of evidence the application can never provide: SIGKILL cannot be caught, so the process logs nothing and its log ends mid-line. The kernel line names the victim and its RSS at death, which tells you whether it was the leaker or an innocent bystander.',
      branches:[
        { when:'OOM line present', then:'Cause confirmed. Now decide: cap the process, right-size the host, or fix the leak.' },
        { when:'No OOM line, but the process vanished', then:'Check systemd — a cgroup MemoryMax or a unit timeout can kill it the same way.' }
      ] },
    { check:'Trend and limits', cmd:'systemctl show NAME -p MemoryMax -p MemoryCurrent   ·   app metrics',
      decide:'Leak, workload spike, cache growth, or a cgroup limit clipping it?',
      why:'A steadily climbing RSS across hours is a leak; a step change matches a deploy or a traffic event. A cgroup limit produces an OOM confined to that service, which is actually the outcome you want — contained and attributable.' }
  ],
  probes:[
    ['free -h shows very little free. Is that bad?', 'Not by itself. Linux deliberately uses free RAM for page cache and reclaims it on demand. Alarm on available memory and on swap activity instead.'],
    ['How does the OOM killer choose?', 'By score, driven mostly by memory footprint and adjusted by oom_score_adj. The largest consumer usually dies, which is not necessarily the process at fault.'],
    ['Should you protect a process with oom_score_adj -1000?', 'Rarely. The kernel then kills something else — possibly sshd or systemd — and you lose the whole host instead of one service.']
  ],
  trap:'Treating Restart=always as the fix. It masks the symptom, drops in-flight work every few hours, and leaves the cause untouched.',
  remember:'Available memory, swap activity and OOM evidence — in that order. The app log will never contain the answer.',
  mission:'m-oom'
},

/* ═══ 8. disk full ═══ */
{
  id:'pb-disk-full', title:'No space left on device', cat:'disk', level:'beginner',
  prompt:'"The application is failing because there is no space left on device. What do you check?"',
  say:'"I would first determine which filesystem is full with df -h, and check inode usage with df -i. Once I know the affected mount I would use du to find where space is going, look for large logs or deleted-but-open files, and verify rotation and retention before deleting anything."',
  steps:[
    { check:'Capacity', cmd:'df -hT',
      decide:'Which filesystem is at or near 100 percent — and what type is it?',
      why:'Per-filesystem, not per-host: / can be fine while /var is full, and the fix is completely different. -T adds the filesystem type, which decides how you would grow it later (xfs_growfs versus resize2fs).' },
    { check:'Inodes', cmd:'df -i',
      decide:'Is it bytes, or millions of small files?',
      why:'Inode exhaustion produces exactly the same ENOSPC error with free space showing in df -h. The inode count is fixed at mkfs time on ext4, so the fix is deleting files or rebuilding the filesystem — not adding space. Ruling this out in one command is a strong signal you have been burned by it before.',
      branches:[
        { when:'IUse% at 100', then:'Find the directory with the file count, not the byte count: for d in /var/*; do echo -n "$d "; find $d -xdev -type f | wc -l; done' },
        { when:'Inodes fine', then:'It is genuine block exhaustion — carry on down the tree.' }
      ] },
    { check:'Locate the usage', cmd:'du -xhd1 /var | sort -h',
      decide:'Which top-level directory is consuming the space?',
      why:'Descend one level at a time rather than scanning the whole tree — three cheap commands beat one expensive one. -x keeps du on a single filesystem so a mounted volume underneath does not distort the numbers.' },
    { check:'Large files', cmd:'find /var -xdev -type f -size +1G -ls',
      decide:'Are there unexpectedly large individual files?',
      why:'Names the actual file, with size and owner, so you can decide whether it is a log, a core dump, a forgotten backup, or a database file you must not touch.' },
    { check:'Deleted-but-open files', cmd:'lsof +L1',
      decide:'Is a process still holding a deleted file open?',
      why:'This is the classic df/du mismatch. Unlinking a file removes the directory entry, but the blocks stay allocated until the last file descriptor closes. lsof +L1 lists files with a link count below 1, naming the holding process. Restarting that process — or truncating through /proc/PID/fd — returns the space.',
      branches:[
        { when:'A deleted file is still held open', then:'Restart the holder, or truncate rather than delete next time.' },
        { when:'Nothing held open', then:'Reclaim safely: truncate live logs, delete old rotations.' }
      ] },
    { check:'Reclaim safely', cmd:'truncate -s 0 /var/log/app/app.log   ·   find /var/log -name "*.gz" -mtime +14 -delete',
      decide:'How do you free space without breaking the writer?',
      why:'Truncating a file that a process holds open keeps the descriptor valid and the writer simply continues at offset zero. Deleting it instead frees nothing until the process restarts, and leaves the app writing into a file you can no longer read.' },
    { check:'Retention', cmd:'logrotate -d /etc/logrotate.d/app   ·   journalctl --disk-usage',
      decide:'Why did it grow, and will it happen again on Thursday?',
      why:'Buying space without fixing rotation just reschedules the page. -d is a dry run that shows what logrotate would do; look for a missing compress, a rotate count of zero, or no size cap. The systemd journal is a frequent hidden consumer — cap it with --vacuum-size or SystemMaxUse.' }
  ],
  probes:[
    ['df and du disagree. Two reasons?', 'A deleted file still held open by a process, or data hidden underneath a mount point that du cannot see because something is mounted over it.'],
    ['Space is free but writes still fail.', 'Inodes, a quota, a read-only remount after an I/O error, or a reserved-blocks percentage that only root can use.'],
    ['How do you prevent it?', 'Rotation with size caps, shipping logs off the box, and alarming at 80% rather than 100% so you still have room to work.']
  ],
  trap:'rm -rf on a log directory during an incident. You destroy the evidence for the write-up, may delete audit logs, and often do not even free the space.',
  remember:'df finds the full filesystem; du finds where the bytes are. They disagree for a reason worth knowing.',
  mission:'m-disk'
}

);
