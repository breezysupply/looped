/* Playbooks, second set: load, connectivity, DNS, ports, crash loops,
   read-only filesystems, fd exhaustion, deploy regressions, health, identity. */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.playbooks = LX.playbooks || [];

LX.playbooks.push(

/* ═══ 9. load high, CPU idle ═══ */
{
  id:'pb-load', title:'Load average is high but CPU is not busy', cat:'procs', level:'intermediate',
  prompt:'"Load average is high, but CPU utilization is not. What could be happening?"',
  say:'"I would check whether tasks are blocked on I/O. Linux load average includes runnable tasks and tasks in uninterruptible sleep, so high storage latency can raise load even when CPU is not saturated. I would inspect process states, vmstat, and disk I/O metrics."',
  steps:[
    { check:'Confirm the load', cmd:'uptime; nproc',
      decide:'Is it sustained, and how does it compare to the core count?',
      why:'A spike that is already falling needs a different response from one that is climbing. Reading 1-, 5- and 15-minute figures as a trend is free information most candidates skip.' },
    { check:'Process states', cmd:'ps -eo state,pid,ppid,cmd | grep "^D"',
      decide:'Are there many tasks in uninterruptible sleep?',
      why:'D state means blocked in the kernel, almost always on storage or a network filesystem. This is the direct explanation for the paradox: Linux counts D-state tasks in load average, so load can be high while the CPU is idle. It also explains why those processes ignore kill -9 until the I/O completes.' },
    { check:'System pressure', cmd:'vmstat 1 5',
      decide:'Blocked tasks and I/O wait, confirmed over time.',
      why:'The b column counts blocked processes and wa is the percentage of CPU time spent waiting on I/O. si/so at zero rules out swapping as the source, which is the other common cause of blocked tasks.' },
    { check:'Disk', cmd:'iostat -xz 1 3',
      decide:'Which device, and how bad is the latency?',
      why:'%util near 100 with a deep queue (aqu-sz) and high await says the device is saturated. Compare devices: one saturated volume while the root disk idles points straight at the workload using it.',
      branches:[
        { when:'One device saturated', then:'Attribute it: pidstat -d 1 names the process doing the I/O.' },
        { when:'All devices idle', then:'The block is elsewhere — NFS, a network filesystem, or a hung mount. Check findmnt and dmesg.' }
      ] },
    { check:'Kernel and storage errors', cmd:'journalctl -k --since "30 min ago"   ·   dmesg -T | tail',
      decide:'Storage errors, filesystem problems, or a device that has gone away?',
      why:'I/O errors, controller resets, or an NFS server "not responding" appear only in the kernel log. If the filesystem was remounted read-only, this is where it says so and why.' }
  ],
  probes:[
    ['What does D state mean?', 'Uninterruptible sleep — the task is inside a kernel call, usually waiting on storage. It cannot be killed, even with -9, until that call returns.'],
    ['What is a load average, precisely?', 'A moving average of runnable plus uninterruptible tasks over 1, 5 and 15 minutes. It is not a CPU percentage.'],
    ['NFS mount hangs. What now?', 'Everything touching it blocks. umount -f -l to release the tree, and mount with soft/timeo/retrans so an outage degrades instead of hanging forever.']
  ],
  trap:'Reading load average as a CPU percentage. On Linux it is not — that is the whole point of this question.',
  remember:'High load with idle CPU means blocked tasks. Follow the I/O, not the scheduler.',
  mission:null
},

/* ═══ 10. listening locally, unreachable remotely ═══ */
{
  id:'pb-listen', title:'Service is up but clients cannot connect', cat:'net', level:'intermediate',
  prompt:'"The service is up, but users cannot connect. Walk me through it."',
  say:'"I would verify the process is listening on the expected address and port, test it locally, then test the network path outward. I would separate application health from name resolution, routing, firewall or security controls, and upstream load-balancer issues."',
  steps:[
    { check:'Listening socket', cmd:'ss -lntp | grep :8080',
      decide:'Correct port — and, critically, which bind address?',
      why:'Look at the address, not just the port. 127.0.0.1:8080 accepts only connections arriving on loopback, so nothing off the host can ever reach it regardless of firewalls. 0.0.0.0 means all IPv4 interfaces. This one line resolves a huge share of "the firewall must be blocking it" tickets.',
      branches:[
        { when:'Bound to 127.0.0.1', then:'Cause found. Fix the app config to bind 0.0.0.0 and restart — an edit alone will not re-bind an open socket.' },
        { when:'Bound to 0.0.0.0 and listening', then:'The host side is healthy; keep walking outward.' },
        { when:'Nothing listening at all', then:'This is a service problem, not a network one', goto:'pb-svc-start' }
      ] },
    { check:'Local test', cmd:'curl -v http://127.0.0.1:8080/health   ·   nc -zv 127.0.0.1 8080',
      decide:'Does the application actually respond on-host?',
      why:'Separates "the process exists" from "the service answers". A process can be running, listening, and still failing every request — a health endpoint is the only honest test.' },
    { check:'Host IP test', cmd:'curl -v --max-time 3 http://10.0.3.77:8080/health',
      decide:'Does it answer on the real interface, not just loopback?',
      why:'This is the test that catches a loopback bind, because localhost succeeds while the interface address returns connection refused. Refused here means the packet reached the stack and no listener claimed it.' },
    { check:'DNS', cmd:'getent hosts app.example.com   ·   dig +short app.example.com',
      decide:'Does the name resolve to the address you expect?',
      why:'getent goes through the full NSS path, which is what applications actually use — including /etc/hosts. dig queries DNS directly. When they disagree, a hosts entry or nsswitch order is the reason.',
      branches:[
        { when:'Name does not resolve', then:'Switch to the DNS tree', goto:'pb-dns' }
      ] },
    { check:'Route', cmd:'ip route   ·   ip route get 10.0.3.77   ·   tracepath 10.0.3.77',
      decide:'Is traffic leaving via the interface and gateway you expect?',
      why:'ip route get resolves the exact decision the kernel will make for one destination, including the source address it will use. That is far more precise than reading the whole table and guessing.' },
    { check:'Filtering', cmd:'host firewall + security group + NACL   ·   tcpdump -i any -nn port 8080 -c 20',
      decide:'Where are the packets being dropped?',
      why:'tcpdump settles it: if a SYN arrives and nothing goes back, the drop is on this host; if no SYN ever arrives, the drop is upstream — security group, NACL, or routing. Remember NACLs are stateless, so return traffic on ephemeral ports must be allowed explicitly.' }
  ],
  probes:[
    ['What does ss -lntp tell you?', 'Listening TCP sockets, numeric addresses and ports, and the owning process. It is the fastest way to answer "is anything actually serving this port, and where is it bound".'],
    ['Refused versus timeout?', 'Refused means something answered and rejected the connection — usually no listener on that port. Timeout means silence: filtering, packet loss, routing, or a dead host.'],
    ['Process is running, so the service is up?', 'No. Running is process state; healthy is service behaviour. Test the listener and the health endpoint.']
  ],
  trap:'Equating "the process is running" with "the service is reachable". The daemon can be perfectly healthy while bound to localhost.',
  remember:'Work outward one layer at a time: bind address → host firewall → security group → NACL → route.',
  mission:'m-bind'
},

/* ═══ 11. DNS ═══ */
{
  id:'pb-dns', title:'Hostname does not resolve but the IP works', cat:'net', level:'intermediate',
  prompt:'"The hostname does not resolve, but the server is reachable by IP."',
  say:'"That points at DNS rather than basic reachability. I would inspect the configured resolver, query the name directly, compare resolvers, check search domains and /etc/hosts, and verify the record exists and has reached the resolver being used."',
  steps:[
    { check:'Resolver config', cmd:'cat /etc/resolv.conf   ·   resolvectl status',
      decide:'Which DNS servers and search domains is this host actually using?',
      why:'Everything else depends on this. In a VPC the resolver is normally the base of the CIDR plus two. A container or a VPN client may have rewritten this file, which explains why one host resolves and its neighbour does not.' },
    { check:'System resolution path', cmd:'getent hosts app.example.com',
      decide:'What will a normal application resolve?',
      why:'getent follows nsswitch.conf — files first, then DNS — so it reflects what your application will see, including any /etc/hosts override. dig bypasses that path entirely, which is why the two can disagree.' },
    { check:'Direct query', cmd:'dig +short app.example.com   ·   dig @10.0.0.2 app.example.com',
      decide:'Does a specific resolver have the record?',
      why:'Asking a named server directly separates "the record is wrong" from "my resolver is broken". If your configured resolver fails but a known-good one answers, the problem is local; if both fail, the record or the zone is the problem.',
      branches:[
        { when:'Configured resolver fails, another answers', then:'Local resolver or resolv.conf is the fault.' },
        { when:'Every resolver fails', then:'Record or delegation problem — dig +trace from the root.' },
        { when:'Answers differ', then:'Caching or split-horizon DNS. Check TTLs and which view you are hitting.' }
      ] },
    { check:'Local overrides', cmd:'grep -n app.example.com /etc/hosts   ·   cat /etc/nsswitch.conf',
      decide:'Is a static entry silently winning?',
      why:'/etc/hosts is consulted before DNS by default, so a stale line there sends traffic to an address that no longer exists and no amount of DNS fixing will help. This is a very common cause of "it only breaks on this one host".' },
    { check:'Reachability to the resolver', cmd:'nc -zvu 10.0.0.2 53   ·   dig @10.0.0.2 app.example.com',
      decide:'Can this host even reach its DNS server?',
      why:'DNS failures are sometimes network failures wearing a disguise — a security group or NACL blocking UDP/TCP 53. If the query times out rather than returning NXDOMAIN or SERVFAIL, suspect the path rather than the data.' }
  ],
  probes:[
    ['getent hosts versus dig?', 'getent uses the system NSS path, so it includes /etc/hosts and reflects what applications see. dig speaks to DNS directly and shows the protocol detail.'],
    ['Why not just use ping to test?', 'ping mixes name resolution and ICMP reachability into one result, and ICMP is often blocked. Test resolution and connectivity separately.'],
    ['Private hosted zone does not resolve on EC2.', 'Check enableDnsSupport and enableDnsHostnames on the VPC, and that the zone is associated with that VPC.']
  ],
  trap:'Concluding "the network is down" when only name resolution is broken. Reaching the host by IP has already proven the path works.',
  remember:'IP works, name does not — that is DNS. Isolate resolver, record, and local overrides in that order.'
},

/* ═══ 12. port unreachable ═══ */
{
  id:'pb-port', title:'A port is not reachable', cat:'net', level:'intermediate',
  prompt:'"You cannot connect to host X on port 443. What do you check?"',
  say:'"I would determine whether the failure is name resolution, routing, refusal, or timeout. On the destination I would verify something is listening on 443 and on which address. From the client I would test TCP connectivity, then inspect routing and filtering based on whether I see refused or timeout."',
  steps:[
    { check:'Resolution', cmd:'getent hosts host.example.com',
      decide:'Are you even aiming at the right IP?',
      why:'Cheap and eliminates a whole class of confusion before you start capturing packets. A stale DNS record means you are testing a host that has nothing to do with the problem.' },
    { check:'Destination socket', cmd:'ss -lntp | grep :443',
      decide:'Is anything listening — and on all interfaces or only localhost?',
      why:'If you can get onto the destination, this answers the question outright. No listener means the service problem is local to that host; a loopback bind means it can never be reached remotely.' },
    { check:'Client TCP test', cmd:'nc -zv host.example.com 443',
      decide:'Refused, timeout, or success?',
      why:'This is the fork in the tree, and naming it is what separates a structured answer from guesswork. Refused means a packet came back — the host is reachable and nothing accepted the port. Timeout means silence, which points at filtering, loss, routing, or a dead host.',
      branches:[
        { when:'Connection refused', then:'The path works. Focus on the service: is it listening, on which address, and is it healthy?', goto:'pb-listen' },
        { when:'Timeout', then:'Silent drop. Check security group, NACL (stateless — both directions), host firewall, and routing.' },
        { when:'Success', then:'TCP is fine; move up to the application and TLS layer.' }
      ] },
    { check:'Application and TLS', cmd:'curl -vk https://host.example.com   ·   openssl s_client -connect host:443 -servername host',
      decide:'Does the handshake complete, and is the certificate valid for this name?',
      why:'Once TCP connects, failures move up the stack: expired certificate, wrong SAN, untrusted issuer, or an HTTP-level error. openssl shows the chain and the validity dates; remember that a badly skewed clock makes a valid certificate look expired.' },
    { check:'Route', cmd:'ip route get 10.0.1.10   ·   tracepath 10.0.1.10',
      decide:'Which interface and gateway, and where does the path stop?',
      why:'ip route get shows the exact decision for that destination. tracepath works where traceroute is missing and also reveals path MTU problems, which break large packets while small ones sail through.' },
    { check:'Filtering', cmd:'security group · NACL · host firewall · tcpdump -i any -nn port 443',
      decide:'Which layer is dropping it?',
      why:'Check them in order of likelihood and remember which are stateful: security groups allow return traffic automatically, NACLs do not. tcpdump on the destination tells you whether the SYN ever arrived, which cuts the search space in half instantly.' }
  ],
  probes:[
    ['ping fails but the service works. Why?', 'ICMP is frequently blocked while TCP is allowed. A failed ping proves nothing on AWS.'],
    ['ping, nc and curl — when to use each?', 'ping tests ICMP reachability only, nc tests whether a TCP port accepts a connection, curl tests the application layer including TLS and HTTP status.'],
    ['What does a RST tell you?', 'Something actively refused: either no listener, or a firewall configured to reject rather than drop.']
  ],
  trap:'Not distinguishing refused from timeout. They point at opposite halves of the stack, and the interviewer is listening for that word.',
  remember:'Refused = reached, rejected. Timeout = dropped in silence.',
  mission:'m-bind'
},

/* ═══ 13. crash loop ═══ */
{
  id:'pb-crashloop', title:'A process is crash-looping', cat:'sys', level:'intermediate',
  prompt:'"The service keeps restarting every few seconds."',
  say:'"I would confirm the restart pattern in systemctl and the journal, then inspect the exit status and the restart policy. I would correlate the crash with configuration, dependencies, ports, permissions, or resource failures. I would avoid restarting it myself, because systemd is already doing that and the logs are the evidence I need."',
  steps:[
    { check:'State and restart count', cmd:'systemctl status NAME   ·   systemctl show NAME -p NRestarts -p ExecMainStatus',
      decide:'How many restarts, and with what exit status each time?',
      why:'The restart counter converts a vague "it keeps dying" into a number you can reason about, and the exit status narrows the cause: a non-zero application exit means it rejected something, signal 9 means it was killed externally, signal 11 means it segfaulted.' },
    { check:'Timeline', cmd:'journalctl -u NAME -b -n 200 --no-pager',
      decide:'What happens in the few lines immediately before each exit?',
      why:'Crash loops are extremely legible in the journal because the same sequence repeats. The root cause is nearly always in the last two or three lines before the exit — a missing file, a refused connection, a config parse error.' },
    { check:'Unit policy', cmd:'systemctl cat NAME',
      decide:'Restart=, RestartSec=, ExecStart=, and dependencies.',
      why:'Restart=always with a short RestartSec produces a tight loop that floods the journal and can mask the cause. It also tells you whether systemd is fighting you: your manual stop may be undone in seconds.' },
    { check:'Exit cause', cmd:'coredumpctl list   ·   application logs',
      decide:'Crash, config error, signal, or a resource failure?',
      why:'A core dump means a genuine crash worth a stack trace. No core plus a clean exit code means the process chose to exit — which is a configuration or dependency problem, and far more common.',
      branches:[
        { when:'Killed by signal 9', then:'Something external. Check memory', goto:'pb-mem' },
        { when:'Exits immediately with a config error', then:'Validate the config', goto:'pb-svc-start' },
        { when:'Dies when it reaches a dependency', then:'Test that dependency from this host — port, DNS, credentials.' }
      ] },
    { check:'External requirements', cmd:'ss -lntp   ·   namei -l /path/it/needs   ·   df -h',
      decide:'Is it failing because something it needs is unavailable?',
      why:'Port already bound, a file it cannot traverse to, or a full disk are the three classic external causes — none of which are visible in the application code, and all of which are one command each to eliminate.' }
  ],
  probes:[
    ['Why not just keep restarting it?', 'systemd already is. Manual restarts add noise, reset counters, and can destroy the state that explains the failure.'],
    ['Restart=always — good or bad?', 'Good for transient crashes, bad as a substitute for diagnosis. A climbing restart counter deserves an alert of its own.'],
    ['Where do you look first?', 'The few lines before the exit, repeated identically each cycle. That is the root cause.']
  ],
  trap:'Treating the restart loop as the problem. It is a symptom of whatever happens just before each exit.',
  remember:'Restart count, exit status, then the lines immediately before the exit.',
  mission:'m-nginx'
},

/* ═══ 14. read-only filesystem ═══ */
{
  id:'pb-readonly', title:'Cannot write even though permissions look correct', cat:'disk', level:'intermediate',
  prompt:'"An application cannot write to a path even though permissions look correct."',
  say:'"After verifying normal permissions I would check the mount and filesystem state. I would use findmnt to see whether the filesystem is mounted read-only, check capacity and kernel logs for device errors, and only then decide whether remediation means remounting, repair, or something else."',
  steps:[
    { check:'Rule out normal permissions', cmd:'stat FILE; namei -l /var/lib/app/data',
      decide:'Is this actually a DAC or path-traversal problem after all?',
      why:'Cheap and eliminates the obvious. namei walks every component so a missing traverse bit halfway down the path cannot hide from you.' },
    { check:'Mount options', cmd:'findmnt -T /var/lib/app -o TARGET,SOURCE,FSTYPE,OPTIONS',
      decide:'Is the filesystem mounted ro or rw?',
      why:'findmnt -T finds the filesystem containing a path, which saves you from reading the whole mount table. If OPTIONS shows ro, no permission change on earth will let you write — and the interesting question becomes why it is read-only.',
      branches:[
        { when:'Mounted ro', then:'The kernel usually did this to protect you. Read dmesg before remounting rw.' },
        { when:'Mounted rw', then:'Check capacity and then the other blockers: ACLs, SELinux, immutable attribute.' }
      ] },
    { check:'Capacity', cmd:'df -h /var/lib/app; df -i /var/lib/app',
      decide:'Space or inode exhaustion masquerading as a permission error?',
      why:'ENOSPC surfaces in application logs as all sorts of confusing failures. Two commands eliminate both variants.' },
    { check:'Kernel evidence', cmd:'journalctl -k --since "30 min ago"   ·   dmesg -T | grep -iE "I/O error|remount|EXT4-fs|XFS"',
      decide:'Did the kernel remount it read-only after an I/O error?',
      why:'This is the answer most people miss. Filesystems flip themselves to read-only in response to write errors — it is protective behaviour, not the disease. If you remount rw without reading this, you erase the evidence and it will happen again.' },
    { check:'Other blockers', cmd:'lsattr FILE   ·   getfacl FILE   ·   getenforce',
      decide:'Immutable attribute, an ACL, or mandatory access control?',
      why:'chattr +i makes a file unmodifiable even by root — lsattr is the only way to see it. An ACL mask can clamp what the mode bits appear to grant. SELinux denies with correct-looking permissions and logs an AVC.' }
  ],
  probes:[
    ['Permission denied as root — how?', 'The immutable attribute (chattr +i), a read-only mount, or SELinux. Root is not exempt from any of the three.'],
    ['How do you check mount options for one path?', 'findmnt -T PATH. It resolves which filesystem contains that path and prints its options.'],
    ['Filesystem went read-only. First move?', 'Read dmesg for the I/O error that caused it, and snapshot the volume before repairing. Remounting first destroys the evidence.']
  ],
  trap:'Remounting rw immediately. If the device is genuinely failing it will flip back, and you have thrown away the reason.',
  remember:'When permissions look perfect, ask what other layer can deny: ACL, MAC, mount mode, filesystem health, or immutable flags.'
},

/* ═══ 15. too many open files ═══ */
{
  id:'pb-fd', title:'Too many open files', cat:'sys', level:'intermediate',
  prompt:'"The application reports too many open files or stops accepting connections."',
  say:'"I would identify the process limit and its current descriptor count, then determine what kind of descriptors are accumulating. I would distinguish a legitimate capacity problem from a leak before raising limits, because raising the limit can simply hide a leak."',
  steps:[
    { check:'Current use', cmd:'ls /proc/1234/fd | wc -l',
      decide:'How many descriptors is it actually holding?',
      why:'A single number that tells you whether you are near the limit or nowhere near it. Sampling it twice a few minutes apart also tells you whether it is growing, which is the difference between a leak and a busy day.' },
    { check:'The limit that applies', cmd:'grep -i "open files" /proc/1234/limits',
      decide:'What soft and hard limits does this process actually have?',
      why:'Read the limit from the process, not from your shell. ulimit -n in your terminal describes your session and has nothing to do with a systemd service, which inherits LimitNOFILE from its unit. This distinction is the entire point of the question.' },
    { check:'Descriptor types', cmd:'lsof -p 1234 | awk \'{print $5}\' | sort | uniq -c | sort -rn',
      decide:'Files, sockets, pipes, or deleted files?',
      why:'The mix names the bug. Thousands of sockets means connections are not being closed — check for CLOSE_WAIT. Thousands of regular files means a file handle leak. Deleted files means something is holding unlinked data and also wasting disk.',
      branches:[
        { when:'Mostly sockets in CLOSE_WAIT', then:'The application is not closing connections — a code bug, not a limit problem.' },
        { when:'Mostly regular files', then:'A file handle leak, or a legitimate workload that needs a higher limit.' }
      ] },
    { check:'System-wide', cmd:'cat /proc/sys/fs/file-nr   ·   sysctl fs.file-max',
      decide:'Is the host near a global limit, or is this one process?',
      why:'file-nr gives allocated, free and maximum handles system-wide. If the host is fine and one process is at its ceiling, the fix is that unit; if the host is near fs.file-max, it is a kernel tunable and a capacity conversation.' },
    { check:'Raise deliberately', cmd:'systemctl edit NAME  →  LimitNOFILE=65535, then daemon-reload and restart',
      decide:'Is a higher limit justified, and where does it belong?',
      why:'For a service the limit belongs in the unit file, not in a shell profile. Verify afterwards by re-reading /proc/PID/limits — that is the only proof it took effect. If the count keeps climbing afterwards, you have bought time, not a fix.' }
  ],
  probes:[
    ['Why might raising ulimit not fix it?', 'Because a leak grows without bound. A higher ceiling delays the failure instead of preventing it.'],
    ['ulimit -n in my shell shows 65535 but the service still fails.', 'A systemd service does not inherit your interactive shell. Set LimitNOFILE= in the unit and check /proc/PID/limits.'],
    ['What counts as an open file?', 'Regular files, sockets, pipes, epoll and eventfd instances — every descriptor the process holds.']
  ],
  trap:'Raising the limit first. It is the fastest way to turn a diagnosable leak into a mystery that returns next week.',
  remember:'The limit that matters is the one in /proc/PID/limits, not the one in your shell.'
},

/* ═══ 16. deploy regression ═══ */
{
  id:'pb-deploy', title:'A deployment caused a regression', cat:'ops', level:'intermediate',
  prompt:'"The service was healthy before a deployment and is now failing or slow."',
  say:'"I would establish the exact deployment time and compare health, logs, resource use, configuration and dependencies immediately before and after it. I would look for a clear causal signal before deciding whether rollback is the safest mitigation, then validate recovery and preserve evidence for the write-up."',
  steps:[
    { check:'Timeline', cmd:'journalctl -u NAME --since "2026-08-17 14:00"',
      decide:'Did symptoms begin at the change boundary?',
      why:'Correlation with a change boundary is the single highest-yield troubleshooting question there is. Anchor on the deploy timestamp and read across it — if the first error is minutes after the deploy, you have your suspect and your rollback justification.' },
    { check:'Service state', cmd:'systemctl status NAME   ·   systemctl show NAME -p NRestarts',
      decide:'New crash, restart, or failure behaviour?',
      why:'Compare against what normal looked like. A restart counter that was zero yesterday and is seven today is a fact you can act on.' },
    { check:'Resource delta', cmd:'ps -eo pid,user,%cpu,%mem,etime,cmd --sort=-%cpu | head   ·   sar -r -s 13:00',
      decide:'Did the CPU or memory profile change?',
      why:'sar is what lets you compare before and after when the "before" has already scrolled past. A new version using twice the memory is a strong signal even without reading a line of code.' },
    { check:'What actually changed', cmd:'diff of config · package version · image tag · git log',
      decide:'Which specific change is the candidate?',
      why:'"The deploy" is not a cause; a specific changed line is. rpm -qa --last, yum history, and a config diff turn a vague window into a short list you can reason about.',
      branches:[
        { when:'Config change', then:'Diff against the previous version and validate with the app\'s own checker.' },
        { when:'New dependency or endpoint', then:'Test it from this host — DNS, port, credentials, latency.' },
        { when:'Nothing obvious changed here', then:'Look upstream: a dependency may have deployed at the same time.' }
      ] },
    { check:'Mitigate', cmd:'roll back if evidence supports it, then validate',
      decide:'What restores service fastest with the least risk?',
      why:'Mitigate first, root-cause second — but capture logs and state before rolling back, or you lose the evidence entirely. After rollback, re-run the original failing test and confirm the user-visible symptom is gone.' }
  ],
  probes:[
    ['Why is "what changed?" so valuable?', 'Because most incidents are caused by change. It converts an open-ended search into a bounded one.'],
    ['How do you find package-level changes?', 'rpm -qa --last, yum history (with undo), or dpkg -l plus the apt history log.'],
    ['Rollback or fix forward?', 'Whichever restores service faster with less risk. Rollback is usually the smaller, more reversible action during an incident.']
  ],
  trap:'Rolling back without capturing evidence. Service comes back, nobody learns anything, and it ships again next sprint.',
  remember:'Anchor on the change boundary, then compare across it.'
},

/* ═══ 17. running but unhealthy ═══ */
{
  id:'pb-unhealthy', title:'The process exists but the service is broken', cat:'procs', level:'intermediate',
  prompt:'"ps shows the process running. Why might the service still be broken?"',
  say:'"A running PID only proves the process exists. I would test actual service behaviour: listener state, a local health endpoint, recent logs, dependency connectivity, resource pressure, and whether the process is stuck or blocked. I would measure health at the layer users depend on."',
  steps:[
    { check:'Process state', cmd:'ps -o pid,stat,wchan,etime,cmd -p 1234',
      decide:'Running, sleeping, blocked, or a zombie?',
      why:'The STAT column is the fastest health signal there is. R is runnable, S is a normal idle wait, D is blocked in the kernel on I/O and cannot be killed, T is stopped, Z is a zombie whose parent never reaped it. wchan names the kernel function it is waiting in.' },
    { check:'Listener', cmd:'ss -lntp | grep myapp',
      decide:'Is it listening where it is supposed to?',
      why:'A process can be alive and not listening — still initialising, failed to bind, or bound to the wrong address. This is the first behavioural test rather than an existence test.' },
    { check:'Health check', cmd:'curl -v http://127.0.0.1:8080/health',
      decide:'Does the application answer correctly?',
      why:'The only test that reflects what a user experiences. A 200 with a healthy body is evidence; a hang or a 503 tells you the process is up but the service is not — which is exactly the distinction this question is about.' },
    { check:'Logs', cmd:'journalctl -u NAME --since "10 min ago"',
      decide:'Errors, retries, deadlocks, dependency failures?',
      why:'A stuck service usually says so: connection pool exhausted, waiting on a lock, retrying a downstream call. Silence in the log while requests hang points at a deadlock or a blocked thread pool.' },
    { check:'Dependencies', cmd:'nc -zv db 5432   ·   dig +short api.internal   ·   curl -w timing',
      decide:'Can it reach what it needs, and how fast?',
      why:'A healthy service in front of an unreachable database looks broken to users and fine to ps. Test each dependency from this host, with timing, so you can say which one is slow rather than that "something" is.' }
  ],
  probes:[
    ['What is a zombie process?', 'A process that has exited but whose parent has not read its exit status. It holds a PID slot and nothing else — the bug is in the parent, and you signal the parent, not the zombie.'],
    ['D state — what does it mean?', 'Uninterruptible sleep, usually blocked on storage or NFS. It ignores every signal including SIGKILL until the I/O completes.'],
    ['Why is a health endpoint better than ps?', 'Because it exercises the code path users depend on, including dependencies and thread pools. ps only proves a PID exists.']
  ],
  trap:'Reporting "the process is running" as if it answers the question. Running is process state; healthy is service behaviour.',
  remember:'Measure health where the user feels it, not where the process table shows it.'
},

/* ═══ 18. works as root, fails as the service user ═══ */
{
  id:'pb-root-vs-user', title:'Works as root, fails as the service user', cat:'perms', level:'intermediate',
  prompt:'"The operation succeeds with sudo but fails when the service runs it."',
  say:'"That points at an identity, environment, or policy difference. I would compare the service account\'s permissions, groups, environment, working directory, PATH, and file ownership, and reproduce as the service user without changing the system to isolate exactly what root is masking."',
  steps:[
    { check:'Identity', cmd:'id svcuser',
      decide:'What UID, primary group and supplementary groups does it have?',
      why:'Root bypasses almost every DAC check, so anything that works only as root is, by definition, a permission the service identity lacks. Start by writing down what that identity actually is.' },
    { check:'Reproduce as that user', cmd:'sudo -u svcuser <command>',
      decide:'Does the failure reproduce under the service identity?',
      why:'This converts a theory into a reproducible test without changing the system. If it fails the same way, you can iterate quickly; if it succeeds, the difference is environment rather than identity — which sends you to the unit configuration.',
      branches:[
        { when:'Fails the same way', then:'It is identity or path permissions — walk the path next.' },
        { when:'Succeeds as that user', then:'The difference is environment: PATH, working directory, or environment variables set by the unit.' }
      ] },
    { check:'Path permissions', cmd:'namei -l /srv/app/data/file   ·   getfacl /srv/app/data/file',
      decide:'Can the service user traverse and access every component?',
      why:'The same traverse rule as any permission problem, but evaluated as the service account. A directory owned by your user with mode 700 is invisible to the service no matter how open the final file is.' },
    { check:'Unit environment', cmd:'systemctl show NAME -p User -p Group -p Environment -p WorkingDirectory',
      decide:'Different PATH, environment, or working directory?',
      why:'Services run with a minimal environment — no profile, no aliases, often a bare PATH. A script that works in your shell fails under systemd because it relied on a PATH entry or an environment variable you never noticed. This is the same class of bug as cron.' },
    { check:'Security policy', cmd:'getenforce   ·   ausearch -m avc -ts recent',
      decide:'Is mandatory access control denying it?',
      why:'SELinux applies to the service context, and root in your shell is often in a different, unconfined context. That asymmetry produces exactly this symptom. Fix with restorecon or a policy change, never by disabling enforcement.' }
  ],
  probes:[
    ['Why not just run the service as root?', 'It removes the isolation that limits the blast radius of a compromise, and hides the real defect. Fix the permission or the environment instead.'],
    ['Why does a script work for me but not under systemd?', 'Minimal environment: no profile is sourced, PATH is short, and the working directory may differ. Use absolute paths and set what you need in the unit.'],
    ['How do you test safely?', 'sudo -u the service user, read-only first, and reproduce before changing anything.']
  ],
  trap:'"It works with sudo" being treated as a solution. It is a clue about what the runtime identity is missing.',
  remember:'Root is masking something. Find out exactly what, and grant only that.'
}

);
