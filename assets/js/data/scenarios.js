/* Real-world troubleshooting scenarios, framed the way an interviewer wants them answered */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };

LX.scenarios.push(

{ title:'Disk is 100% full on /var', cat:'disk', level:'beginner',
  situation:'Alarm fires: /var is at 100%. Writes are failing and the application has stopped logging.',
  steps:[
    ['df -h','Confirm which filesystem is actually full, and by how much.'],
    ['df -i','Rule out the other failure mode — inode exhaustion looks identical to the app.'],
    ['du -h -d1 /var | sort -h','Walk down one level at a time to the biggest consumer.'],
    ['du -h -d1 /var/log | sort -h | tail','Usually the answer lives here.'],
    ['find /var/log -type f -size +100M -exec ls -lh {} +','Name the specific large files.'],
    ['lsof +L1','If du does not account for the space, a deleted file is still held open.'],
    ['truncate -s 0 /var/log/huge.log','Free space without breaking the writer\'s file descriptor.'],
    ['logrotate -f /etc/logrotate.d/app','Force rotation, then fix the policy so it does not recur.']
  ],
  key:'Never `rm` a log a live process is writing — the space is not returned until that process closes the file. Truncate instead, then fix rotation.',
  followups:['What if df shows space free but writes still fail? → inodes: df -i','How would you prevent a recurrence? → logrotate policy, size caps, ship logs off-box, CloudWatch alarm at 80%'] },

{ title:'df says full, du says the data is not there', cat:'disk', level:'intermediate',
  situation:'df -h shows 96% used on /var, but du -sh /var adds up to a fraction of that.',
  steps:[
    ['lsof +L1','List open files whose link count is 0 — deleted, but still held.'],
    ['lsof +L1 | awk \'{print $1, $2, $7}\' | sort -k3 -n | tail','Rank the holders by size.'],
    ['ls -l /proc/PID/fd | grep deleted','Confirm from the process side.'],
    ['systemctl restart the-holding-service','Closing the descriptor releases the blocks immediately.'],
    ['df -h','Verify the space came back.']
  ],
  key:'Unlinking a file only removes the directory entry. The inode and its blocks survive until the last open file descriptor closes.',
  followups:['Can you free it without a restart? Sometimes — truncate via /proc/PID/fd/N — but a controlled restart is the honest answer.'] },

{ title:'"No space left on device" but df shows free space', cat:'disk', level:'intermediate',
  situation:'Writes fail with ENOSPC. df -h shows 40% used.',
  steps:[
    ['df -i','Inode usage at 100% — this is the tell.'],
    ['for d in /var/*; do echo -n "$d "; find $d -xdev -type f | wc -l; done','Count files per directory to find the offender.'],
    ['find /var/spool -type f | wc -l','Mail spools, session files, and tiny cache files are the usual cause.'],
    ['find /var/spool/cache -type f -mtime +7 -delete','Remove the accumulation.']
  ],
  key:'A filesystem has a fixed inode count set at mkfs time. Millions of tiny files exhaust inodes long before they exhaust blocks.',
  followups:['Permanent fix? Change the app to stop creating them, or recreate the filesystem with more inodes — XFS allocates dynamically, ext4 does not.'] },

{ title:'A service will not start after a config change', cat:'sys', level:'beginner',
  situation:'You edited nginx.conf, ran restart, and the service is dead.',
  steps:[
    ['systemctl status nginx','Read the exit code and the last few log lines.'],
    ['journalctl -u nginx -n 50 --no-pager','The real error message is almost always here.'],
    ['nginx -t','Most daemons ship a config validator — use it before restarting.'],
    ['diff -u /etc/nginx/nginx.conf.bak /etc/nginx/nginx.conf','What exactly did I change?'],
    ['ss -tulpn | grep :80','If it is a bind failure, find who already owns the port.'],
    ['systemctl restart nginx && systemctl is-active nginx','Fix, restart, verify.']
  ],
  key:'status → journalctl → validate config → diff against the backup. Say that sequence out loud; it is the answer they are scoring.',
  followups:['Config valid but still failing? Check permissions, SELinux (ausearch -m avc -ts recent), and whether the port is taken.'] },

{ title:'The application process keeps disappearing', cat:'procs', level:'intermediate',
  situation:'A Java service vanishes every few hours. Nothing in the application log.',
  steps:[
    ['dmesg -T | grep -i "out of memory"','The OOM killer logs to the kernel ring buffer, not the app log.'],
    ['journalctl -u myapp --since "1 hour ago"','systemd records the exit status and signal.'],
    ['grep -i "killed process" /var/log/messages','Same evidence on older systems.'],
    ['free -h','How much headroom is there normally?'],
    ['ps aux --sort=-%mem | head','Who else is competing for memory?'],
    ['systemctl show myapp -p MemoryMax -p Restart','Is a cgroup limit clipping it? Is it set to restart?']
  ],
  key:'Silent death with no application log almost always means an external killer: OOM, a cgroup limit, or SIGKILL from somewhere. Prove it from dmesg.',
  followups:['Fix options: raise the instance size, cap the JVM heap below the cgroup limit, add swap, or fix the leak.','What does Restart=always in the unit file change? It masks the symptom — you still need the root cause.'] },

{ title:'The server feels slow — where do you start?', cat:'procs', level:'beginner',
  situation:'Users report the box is sluggish. You have SSH and sixty seconds.',
  steps:[
    ['uptime','Load average against nproc tells you whether there is real pressure.'],
    ['top -b -n1 | head -20','Is it one process or everything?'],
    ['vmstat 1 5','r = CPU pressure, b = blocked on I/O, si/so = swapping, wa = waiting on disk.'],
    ['free -h','Memory pressure and swap use.'],
    ['iostat -xz 1 3','If wa is high, find the saturated device — check %util and await.'],
    ['ss -s','Connection counts — a socket leak or a flood.'],
    ['journalctl -p err --since "30 min ago"','Anything the system already noticed.']
  ],
  key:'Narrate it as a resource triage: CPU, memory, disk I/O, network — check each, then drill into whichever is saturated. Structure scores higher than any single command.',
  followups:['High load but idle CPU? Processes blocked in uninterruptible I/O — check D-state: ps -eo state,pid,cmd | grep "^D"'] },

{ title:'One process is pinning the CPU', cat:'procs', level:'intermediate',
  situation:'top shows a single process at 400% CPU on a 4-core instance.',
  steps:[
    ['top -b -n1 | head','Identify the PID and its owner.'],
    ['ps -o pid,ppid,user,etime,cmd -p PID','How long has it been running, and who started it?'],
    ['top -H -p PID','Break it down by thread.'],
    ['strace -c -p PID','Which syscalls dominate — is it spinning on I/O or in userspace?'],
    ['ls -l /proc/PID/cwd /proc/PID/exe','What is it actually running, and from where?'],
    ['renice -n 19 -p PID','Contain the damage while you decide.'],
    ['kill -TERM PID','Graceful stop first; escalate to -9 only if it ignores TERM.']
  ],
  key:'Identify → understand → contain → stop. Reaching for kill -9 as step one is the answer that loses points.',
  followups:['How would you keep it contained long-term? systemd CPUQuota=, cgroups, or fixing the workload.'] },

{ title:'Cannot SSH: Permission denied (publickey)', cat:'transfer', level:'beginner',
  situation:'A new instance refuses your key. The console shows it booted fine.',
  steps:[
    ['ssh -vvv -i key.pem ec2-user@host','The verbose output names the key it offered and how the server replied.'],
    ['ls -l key.pem','Must be 400/600 — SSH refuses a world-readable private key.'],
    ['chmod 600 key.pem','Fix the local permissions.'],
    ['whoami-check','Confirm the right default user: ec2-user on Amazon Linux, ubuntu on Ubuntu, centos on CentOS.'],
    ['(on the host) ls -ld ~/.ssh; ls -l ~/.ssh/authorized_keys','700 on ~/.ssh and 600 on authorized_keys, owned by that user.'],
    ['(on the host) journalctl -u sshd -n 50','The server side states the real reason.'],
    ['(on the host) sshd -t','Validate sshd_config after any edit.']
  ],
  key:'Split it: is this an authentication failure or a network failure? "Permission denied" means you reached sshd — so the network is fine and the problem is key, user, or permissions.',
  followups:['No route at all instead? That is a timeout, not a denial — security group, NACL, route table, or the host being down.','No key at all? Use SSM Session Manager, or attach the root volume to another instance and fix authorized_keys.'] },

{ title:'SSH just hangs and times out', cat:'net', level:'intermediate',
  situation:'ssh to a private-subnet host never returns a prompt or an error.',
  steps:[
    ['nc -zv 10.0.2.30 22','Is the port reachable at all from here?'],
    ['ping -c 3 10.0.2.30','ICMP may be blocked, so a failure here proves nothing on its own.'],
    ['ip r get 10.0.2.30','Would this traffic even leave via the interface you expect?'],
    ['traceroute -T -p 22 -n 10.0.2.30','Where does the path stop?'],
    ['(check) security group inbound 22 from your source','Layer one on EC2.'],
    ['(check) network ACL — remember it is stateless, both directions','Layer two, and the one people forget.'],
    ['(on the host, via SSM) ss -tulpn | grep :22','Is sshd even listening?']
  ],
  key:'Timeout = the packet was dropped silently. Denial = it arrived and was rejected. That distinction drives the whole investigation.',
  followups:['Name the layers in order: route table → security group → NACL → host firewall → sshd listening.'] },

{ title:'The app answers locally but not from outside', cat:'net', level:'intermediate',
  situation:'curl localhost:8080 works on the host. From anywhere else it times out.',
  steps:[
    ['ss -tulpn | grep 8080','Look at the bind address, not just the port.'],
    ['(observe) 127.0.0.1:8080 vs 0.0.0.0:8080','Bound to loopback means it is unreachable from off-box by design.'],
    ['curl -v http://PRIVATE_IP:8080/','Test against the real interface, not localhost.'],
    ['firewall-cmd --list-all','Host firewall next.'],
    ['iptables -L -n -v','Raw rules and their packet counters.'],
    ['tcpdump -i any -nn port 8080','Are SYNs even arriving?'],
    ['(check) security group and NACL','If no SYN arrives, the drop is upstream of the host.']
  ],
  key:'Work outward one layer at a time: process bind address → host firewall → security group → NACL → route/gateway. A SYN with no SYN-ACK localises the drop instantly.',
  followups:['Why does 0.0.0.0 matter? It means all interfaces. Many frameworks default to 127.0.0.1 in development configs.'] },

{ title:'DNS resolution is failing', cat:'net', level:'intermediate',
  situation:'The app throws "name or service not known" but the network is otherwise fine.',
  steps:[
    ['ping -c1 8.8.8.8','Rule out plain connectivity first — IP works, names do not.'],
    ['cat /etc/resolv.conf','Which resolvers is this host actually using?'],
    ['dig +short api.internal','Ask normally.'],
    ['dig @10.0.0.2 api.internal','Ask the VPC resolver (base of the VPC CIDR, +2) directly.'],
    ['cat /etc/hosts','A stale static entry overrides DNS entirely.'],
    ['cat /etc/nsswitch.conf','Confirm the lookup order: files then dns.'],
    ['dig +trace api.example.com','For public names, find which link in the delegation chain fails.']
  ],
  key:'Separate connectivity from resolution, then separate "my resolver is broken" from "the record is wrong" by querying a second resolver.',
  followups:['Private hosted zone not resolving? Check enableDnsSupport / enableDnsHostnames on the VPC and the zone association.'] },

{ title:'Intermittent latency and packet loss', cat:'net', level:'intermediate',
  situation:'A dependency call times out roughly one time in twenty.',
  steps:[
    ['mtr -rwc 100 10.0.3.40','Sustained per-hop loss statistics beat a single traceroute.'],
    ['ping -c 100 10.0.3.40 | tail -3','Loss percentage and latency spread.'],
    ['ip -s link show eth0','Interface errors, drops, and overruns.'],
    ['ss -s','Are we exhausting sockets or sitting in TIME_WAIT?'],
    ['netstat -s | grep -i retrans','TCP retransmissions confirm real network loss.'],
    ['tcpdump -i any -nn host 10.0.3.40 -c 200','Look at the retransmits directly.']
  ],
  key:'Loss appearing at a middle hop and clearing afterwards is a router deprioritising ICMP — not a real problem. Only loss that persists to the final hop counts.',
  followups:['Instance-level causes: network credits exhausted on a burstable type, ENA driver limits, or the instance simply being too small.'] },

{ title:'HTTPS fails with a certificate error', cat:'net', level:'intermediate',
  situation:'curl reports "certificate verify failed" against an internal endpoint.',
  steps:[
    ['curl -v https://api.example.com 2>&1 | head -30','Read the handshake and the exact verify error.'],
    ['openssl s_client -connect api.example.com:443 -servername api.example.com </dev/null','Full chain and negotiated protocol.'],
    ['openssl s_client -connect host:443 </dev/null 2>/dev/null | openssl x509 -noout -dates','Not-before and not-after — is it simply expired?'],
    ['openssl x509 -in cert.pem -noout -subject -issuer','Does the CN/SAN match the name you requested?'],
    ['date; timedatectl','A badly skewed clock makes a valid certificate look expired.'],
    ['update-ca-trust extract','Refresh the trust store after adding an internal CA.']
  ],
  key:'Three questions in order: expired, wrong name, or untrusted issuer? Each has a different fix, and clock skew masquerades as the first.',
  followups:['Why never -k in production? It disables verification entirely and hides an active MITM.'] },

{ title:'Find the top offenders in a flooded log', cat:'text', level:'beginner',
  situation:'access.log grew 8 GB overnight. Which clients and which endpoints are responsible?',
  steps:[
    ['wc -l access.log','Scale of the problem.'],
    ['awk \'{print $1}\' access.log | sort | uniq -c | sort -rn | head','Top client IPs — the canonical one-liner.'],
    ['awk \'$9 >= 500 {print $7}\' access.log | sort | uniq -c | sort -rn | head','Which endpoints are actually erroring.'],
    ['awk \'{print $9}\' access.log | sort | uniq -c | sort -rn','Status code distribution.'],
    ['grep -c " 503 " access.log','Count one specific failure mode.'],
    ['awk \'{sum+=$10} END {print sum/1024/1024/1024 " GB"}\' access.log','Total bytes served.'],
    ['zgrep -c ERROR app.log.*.gz','Search rotated archives without unpacking them.']
  ],
  key:'sort | uniq -c | sort -rn is the pipeline they want to see you type without hesitating. Know why sort must come first.',
  followups:['Restrict to a time window: awk \'$4 > "[14/Aug/2026:03:00"\' access.log'] },

{ title:'Attach, format, and mount a new EBS volume', cat:'disk', level:'intermediate',
  situation:'You attached a 500 GB volume to an instance and need it mounted at /data, surviving reboot.',
  steps:[
    ['lsblk -f','Confirm the device appeared and whether it already has a filesystem.'],
    ['file -s /dev/xvdf','"data" means it is raw and unformatted.'],
    ['mkfs -t xfs /dev/xvdf','Create the filesystem. Destructive — be certain of the device.'],
    ['mkdir -p /data','Create the mount point.'],
    ['blkid /dev/xvdf','Get the UUID — never reference the device name in fstab.'],
    ['echo "UUID=xxxx /data xfs defaults,nofail 0 2" >> /etc/fstab','Persist it.'],
    ['mount -a','Test the fstab entry now, while you can still fix it.'],
    ['df -h /data','Confirm.']
  ],
  key:'Two things to say out loud: use the UUID because device names can be reordered on reboot, and add nofail so a missing volume never blocks boot.',
  followups:['Volume resized in the console? growpart /dev/xvdf 1 (if partitioned) then xfs_growfs /data or resize2fs for ext4.'] },

{ title:'Filesystem did not grow after resizing the volume', cat:'disk', level:'intermediate',
  situation:'You expanded an EBS volume from 100 to 200 GB, but df still shows 100 GB.',
  steps:[
    ['lsblk','The block device shows the new size; the filesystem does not.'],
    ['df -hT /','Note the filesystem type — the grow command differs.'],
    ['growpart /dev/nvme0n1 1','Grow the partition first if the filesystem sits on one.'],
    ['xfs_growfs /','XFS — grows by mount point.'],
    ['resize2fs /dev/nvme0n1p1','ext4 — grows by device.'],
    ['df -h /','Confirm the new size.']
  ],
  key:'Three layers: volume, partition, filesystem. Expanding the volume alone changes nothing the OS reports.',
  followups:['XFS can only grow, never shrink. ext4 can shrink, but only unmounted.'] },

{ title:'Permission denied on a shared directory', cat:'perms', level:'beginner',
  situation:'A user in the right group still cannot write to /srv/shared.',
  steps:[
    ['ls -ld /srv/shared','Owner, group, and mode of the directory itself.'],
    ['id theuser','Is the group membership actually in effect?'],
    ['groups theuser','Same question, shorter output.'],
    ['namei -l /srv/shared/sub/file','Check every component of the path — one missing x anywhere blocks it.'],
    ['chmod g+w /srv/shared','Grant group write.'],
    ['chmod g+s /srv/shared','Setgid so new files inherit the group.'],
    ['getfacl /srv/shared','A "+" in ls -l means ACLs are also in play.'],
    ['getenforce','SELinux can deny even when the mode bits look correct.']
  ],
  key:'Traverse permissions are the usual culprit: you need x on every directory in the path, not just the final one. namei -l shows the whole chain at once.',
  followups:['Why does the group change not apply? Group membership is fixed at login — the user must reconnect or run newgrp.'] },

{ title:'A cron job never runs', cat:'sys', level:'beginner',
  situation:'The script works when you run it by hand, but the cron entry produces nothing.',
  steps:[
    ['crontab -l -u appuser','Confirm the entry exists under the right user.'],
    ['grep CRON /var/log/cron','Did cron even attempt it? (journalctl -u crond on systemd)'],
    ['ls -l /opt/scripts/job.sh','Is it executable?'],
    ['head -1 /opt/scripts/job.sh','A missing or wrong shebang silently breaks it.'],
    ['(fix) use absolute paths everywhere','Cron\'s PATH is minimal and your profile is never sourced.'],
    ['(fix) 0 3 * * * /opt/scripts/job.sh >> /var/log/job.log 2>&1','Capture output so failures are visible next time.'],
    ['env -i /bin/sh -c /opt/scripts/job.sh','Reproduce cron\'s bare environment.']
  ],
  key:'Nine times out of ten it is environment: PATH, no profile, relative paths, or output going nowhere. Say that before touching the schedule.',
  followups:['Cron vs systemd timers: timers give you logging, dependencies, and randomised delays — and they are the modern choice.'] },

{ title:'Something is already using the port', cat:'net', level:'beginner',
  situation:'The service fails to start with "Address already in use".',
  steps:[
    ['ss -tulpn | grep :8080','Identify the listening process and its PID.'],
    ['lsof -i :8080','Same answer from the file-descriptor side.'],
    ['ps -o pid,ppid,user,etime,cmd -p PID','What is it and how long has it been there?'],
    ['systemctl status $(systemctl list-units --type=service | grep -i app)','Is it an orphaned copy of your own service?'],
    ['kill -TERM PID','Stop it gracefully.'],
    ['ss -tulpn | grep :8080','Confirm the port is free before restarting.']
  ],
  key:'Identify the owner before killing anything. A stale copy of your own service and a completely different product need different responses.',
  followups:['Port free but bind still fails? A socket in TIME_WAIT, or the app needs SO_REUSEADDR.'] },

{ title:'Reclaim space from logs immediately', cat:'disk', level:'beginner',
  situation:'The disk is full right now and you need breathing room before you can debug anything.',
  steps:[
    ['du -h -d1 /var/log | sort -h | tail','Find the biggest directory.'],
    ['find /var/log -name "*.gz" -mtime +14 -delete','Old compressed rotations are safe to remove.'],
    ['journalctl --disk-usage','The systemd journal is frequently the hidden hog.'],
    ['journalctl --vacuum-size=200M','Cap it immediately.'],
    ['truncate -s 0 /var/log/huge-active.log','Zero an in-use log without breaking the writer.'],
    ['logrotate -f /etc/logrotate.d/app','Force rotation now.'],
    ['df -h','Confirm you actually recovered space.']
  ],
  key:'Buy space first, then diagnose. Truncate rather than delete anything a running process holds open.',
  followups:['Long-term: rotation policy with size limits, ship logs to CloudWatch/S3, alarm at 80% not 100%.'] },

{ title:'Work out what changed on this host', cat:'sys', level:'intermediate',
  situation:'A box that has been stable for months started failing this morning. Nobody admits to changing anything.',
  steps:[
    ['last -n 20','Who logged in, and when?'],
    ['journalctl --since "24 hours ago" -p warning','What did the system notice?'],
    ['rpm -qa --last | head -20','Recently installed or updated packages.'],
    ['yum history','Transaction log — with the option to undo.'],
    ['find /etc -mtime -2 -type f','Config files touched in the last two days.'],
    ['rpm -V httpd','Which shipped files differ from the package.'],
    ['systemctl list-units --failed','What is broken right now.'],
    ['grep -r "" /root/.bash_history ~/.bash_history 2>/dev/null | tail -40','Recent hands-on commands.']
  ],
  key:'Change is the leading cause of incidents. find /etc -mtime -2 plus yum history reconstructs the timeline in about thirty seconds.',
  followups:['Prevention: configuration management, immutable AMIs, and CloudTrail for the API-side changes.'] },

{ title:'Root filesystem went read-only', cat:'disk', level:'intermediate',
  situation:'Writes fail everywhere with "Read-only file system" and the instance is still up.',
  steps:[
    ['mount | grep " / "','Confirm it is mounted ro.'],
    ['dmesg -T | tail -50','The kernel remounted it read-only for a reason — usually an I/O error.'],
    ['dmesg -T | grep -iE "I/O error|EXT4-fs error|XFS.*error"','Find the specific fault.'],
    ['mount -o remount,rw /','Try to bring it back; if it flips again the device is genuinely unhealthy.'],
    ['xfs_repair /dev/nvme0n1p1','Repair — unmounted only (ext4: fsck -y).'],
    ['(EC2) check EBS volume status and CloudWatch','Confirm whether the underlying volume is degraded.']
  ],
  key:'Read-only is a protective response to an I/O error, not the disease. Read dmesg before remounting, or you will just hide the evidence.',
  followups:['Recovery path on EC2: snapshot the volume, then repair — or detach it and attach to a rescue instance.'] },

{ title:'Zombie and D-state processes', cat:'procs', level:'intermediate',
  situation:'ps shows a growing pile of <defunct> entries, and some processes will not die even with -9.',
  steps:[
    ['ps aux | awk \'$8 ~ /Z/ {print}\'','List the zombies.'],
    ['ps -eo stat,pid,ppid,cmd | grep "^Z"','Get each zombie\'s parent PID.'],
    ['kill -CHLD PPID','Nudge the parent to reap its children.'],
    ['ps -eo state,pid,cmd | grep "^D"','D-state = uninterruptible sleep, usually blocked on I/O or NFS.'],
    ['cat /proc/PID/stack','What the kernel is waiting on.'],
    ['iostat -xz 1','Confirm whether the underlying device is stuck.']
  ],
  key:'A zombie is already dead — it is just an unreaped exit status, so it uses no resources beyond a PID slot. The bug is in the parent. A D-state process cannot be killed at all until its I/O completes.',
  followups:['Why does kill -9 not work on D-state? The process is in the kernel and cannot handle signals until the syscall returns. Fix the I/O or reboot.'] },

{ title:'Instance role credentials stopped working', cat:'cloud', level:'intermediate',
  situation:'An application on EC2 suddenly gets AccessDenied on every AWS API call.',
  steps:[
    ['aws sts get-caller-identity','Which principal is actually in play?'],
    ['TOKEN=$(curl -sX PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 300")','IMDSv2 token.'],
    ['curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/iam/security-credentials/','Is a role attached at all?'],
    ['env | grep -i aws','Static keys in the environment silently override the instance role.'],
    ['cat ~/.aws/credentials','So does a stale profile on disk.'],
    ['date; timedatectl','Clock skew over five minutes breaks SigV4 signing.'],
    ['ip r get 169.254.169.254','A bad route or a hop-limit of 1 behind a container breaks IMDS.']
  ],
  key:'Walk the credential chain in order: environment variables, then the shared config file, then the instance role. Whatever comes first wins, and that is usually the surprise.',
  followups:['401 from IMDS = IMDSv2 required and the client only speaks v1.','Containers need HttpPutResponseHopLimit=2 to reach IMDS at all.'] },

{ title:'Time drift on the host', cat:'sys', level:'beginner',
  situation:'Logs are out of order across hosts and signed API calls are being rejected.',
  steps:[
    ['date; timedatectl','Current time, timezone, and sync status.'],
    ['chronyc tracking','Offset and drift from the reference clock.'],
    ['chronyc sources -v','Which time sources are in use and reachable.'],
    ['systemctl status chronyd','Is the daemon even running?'],
    ['(EC2) confirm 169.254.169.123','The Amazon Time Sync Service — the correct source inside a VPC.'],
    ['systemctl restart chronyd; chronyc makestep','Force a step correction.']
  ],
  key:'Skew beyond five minutes breaks SigV4 request signing and TLS validation. On EC2 the answer is chrony pointed at 169.254.169.123.',
  followups:['Why chrony over ntpd? Faster convergence, better on virtualised and intermittently-connected hosts.'] }

);
