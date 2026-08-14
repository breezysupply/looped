/* Second scenario set: fleet, storage, security, and AWS-side failure chains */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };

LX.scenarios.push(

{ title:'Instance does not come back after a reboot', cat:'disk', level:'intermediate',
  situation:'You rebooted an instance after a config change and it never returns. SSH times out, status checks fail.',
  steps:[
    ['(console) read the EC2 system log / serial console','This is the only view you have — read it before touching anything.'],
    ['(look for) "Cannot open root device" or "dependency failed for /data"','A bad fstab entry stops boot dead.'],
    ['(look for) kernel panic after a kernel update','Boot the previous kernel from the GRUB menu.'],
    ['(recover) stop the instance, detach the root volume','Attach it to a working instance as a secondary volume.'],
    ['mount /dev/xvdf1 /mnt && vi /mnt/etc/fstab','Fix the offending line — or add nofail to it.'],
    ['umount /mnt','Detach cleanly, reattach as /dev/xvda, start the instance.'],
    ['(prevention) mount -a and findmnt --verify before every reboot','Validate fstab while you still have a shell.']
  ],
  key:'Name the recovery path without hesitating: detach the root volume, attach it to a rescue instance, fix the file, put it back. That is the answer they want.',
  followups:['Why nofail? So a missing or slow secondary volume degrades the boot instead of blocking it.','Why UUIDs? Device names can be reordered between boots; UUIDs cannot.'] },

{ title:'Out of file descriptors under load', cat:'sys', level:'intermediate',
  situation:'Under peak traffic the application logs "Too many open files" and starts refusing connections.',
  steps:[
    ['ulimit -a','Your shell\'s limits — informative but not what the service is using.'],
    ['cat /proc/$(pgrep -f myapp | head -1)/limits','The limits actually applied to the running process.'],
    ['ls /proc/PID/fd | wc -l','How many descriptors it currently holds.'],
    ['lsof -p PID | awk \'{print $5}\' | sort | uniq -c | sort -rn','Sockets, or files, or both?'],
    ['ss -s','If sockets dominate, look for connections that are never closed.'],
    ['systemctl edit myapp','Add LimitNOFILE=65535 under [Service].'],
    ['systemctl daemon-reload && systemctl restart myapp','Apply, then re-check /proc/PID/limits.'],
    ['sysctl fs.file-max','The system-wide ceiling, separate from the per-process limit.']
  ],
  key:'Raising ulimit in your shell does nothing for a systemd service. The fix is LimitNOFILE= in the unit, and the proof is /proc/PID/limits.',
  followups:['If the count keeps climbing, it is a descriptor leak in the application — the limit only buys time.'] },

{ title:'Ephemeral ports and TIME_WAIT exhaustion', cat:'net', level:'intermediate',
  situation:'A busy service starts failing outbound connections with "cannot assign requested address".',
  steps:[
    ['ss -s','Total sockets and how many are in timewait.'],
    ['ss -tan state time-wait | wc -l','Count them precisely.'],
    ['sysctl net.ipv4.ip_local_port_range','How many ephemeral ports exist — typically about 28,000.'],
    ['ss -tan | awk \'{print $1}\' | sort | uniq -c | sort -rn','State census: established vs time-wait vs close-wait.'],
    ['sysctl -w net.ipv4.ip_local_port_range="10240 65535"','Widen the range as an immediate mitigation.'],
    ['sysctl -w net.ipv4.tcp_tw_reuse=1','Allow reuse of TIME_WAIT sockets for outbound connections.'],
    ['(fix properly) enable connection pooling / keep-alive','Stop opening a new connection per request.']
  ],
  key:'TIME_WAIT is correct TCP behaviour — the side that closes first holds the socket for 2×MSL. The real fix is reusing connections, not tuning the timer away.',
  followups:['Lots of CLOSE_WAIT instead? That is your application failing to close sockets — a code bug, not a kernel one.','Never enable tcp_tw_recycle; it breaks clients behind NAT and has been removed from modern kernels.'] },

{ title:'Brute-force attempts in the auth log', cat:'perms', level:'intermediate',
  situation:'Monitoring flags a spike in failed SSH logins on a bastion.',
  steps:[
    ['grep "Failed password" /var/log/secure | wc -l','Scale of the attempt.'],
    ['grep "Failed password" /var/log/secure | awk \'{print $(NF-3)}\' | sort | uniq -c | sort -rn | head','Source IPs ranked.'],
    ['grep "Accepted" /var/log/secure | tail -20','Did anything actually succeed? This is the question that matters.'],
    ['last -n 30','Successful sessions and their origins.'],
    ['lastb | head -20','Failed attempts with usernames.'],
    ['journalctl -u sshd --since "24 hours ago" | grep -i invalid','Invalid users being probed.'],
    ['(harden) PasswordAuthentication no in sshd_config','Key-only authentication makes the whole class of attack moot.'],
    ['(restrict) tighten the security group to known CIDRs','Stop it at the network edge.']
  ],
  key:'Answer the containment question first — did anyone get in? — then harden. Failed attempts against a key-only bastion are noise; one Accepted line is an incident.',
  followups:['Longer term: SSM Session Manager instead of an open port, fail2ban, and centralised log shipping so an attacker cannot erase the evidence.'] },

{ title:'NFS mount hangs and processes pile up', cat:'disk', level:'intermediate',
  situation:'Anything touching /mnt/shared freezes. Load average climbs but CPU is idle.',
  steps:[
    ['uptime; top -b -n1 | head','High load, idle CPU — the signature of blocked I/O.'],
    ['ps -eo state,pid,cmd | grep "^D"','Processes stuck in uninterruptible sleep.'],
    ['df -h','This will itself hang on the dead mount — use timeout 5 df -h.'],
    ['findmnt -t nfs4','Which server the mount points at.'],
    ['nc -zv nfs-server 2049','Is the NFS port still reachable?'],
    ['dmesg -T | grep -i "nfs.*not responding"','The kernel says it plainly.'],
    ['umount -f -l /mnt/shared','Force and lazy unmount to release the tree.'],
    ['(prevent) mount with soft,timeo=,retrans= or intr','So a server outage degrades instead of hanging forever.']
  ],
  key:'A hard NFS mount blocks I/O indefinitely by design, and D-state processes cannot be killed — not even with -9. That is why the mount options matter.',
  followups:['Load average includes D-state on Linux, which is why it can be high with an idle CPU. Expect this follow-up.'] },

{ title:'Load balancer returns 502 and 504', cat:'cloud', level:'intermediate',
  situation:'The ALB serves 502s intermittently and 504s under load. The instances look healthy in top.',
  steps:[
    ['(distinguish) 502 = bad gateway, 504 = gateway timeout','Different failures: the target broke the connection vs it never answered in time.'],
    ['curl -s -o /dev/null -w "%{http_code} %{time_total}\\n" http://localhost:8080/health','Test the target directly, bypassing the load balancer.'],
    ['journalctl -u myapp --since "15 min ago" -p err','Application-side errors at the same moment.'],
    ['ss -s; ss -tan state established | wc -l','Connection counts against the app\'s worker/thread limit.'],
    ['(check) target group health check path, interval, and timeout','A health check stricter than the app is a self-inflicted outage.'],
    ['(check) ALB idle timeout vs application keep-alive','The app\'s keep-alive must exceed the ALB idle timeout or you get 502s.'],
    ['tcpdump -i any -nn port 8080 -c 100','Confirm whether connections are being reset by the target.']
  ],
  key:'502 means the target closed or reset the connection; 504 means it never responded within the timeout. Say which one you are seeing and the search space halves.',
  followups:['Classic 502 cause: keep-alive timeout on the instance shorter than the ALB idle timeout, so the ALB reuses a connection the app just closed.'] },

{ title:'Grow storage with no downtime', cat:'disk', level:'intermediate',
  situation:'/data is at 92% on a database host. You cannot take an outage.',
  steps:[
    ['df -h /data; lsblk','Current layout — is this LVM or a plain filesystem?'],
    ['pvs; vgs; lvs','If LVM, confirm the group and free extents.'],
    ['(console) modify the EBS volume to a larger size','The volume stays attached and in use.'],
    ['lsblk','Kernel sees the new size.'],
    ['growpart /dev/nvme1n1 1','Grow the partition if there is one.'],
    ['pvresize /dev/nvme1n1p1','LVM: let the physical volume claim the new space.'],
    ['lvextend -r -l +100%FREE /dev/data_vg/data_lv','Extend the logical volume and the filesystem together.'],
    ['xfs_growfs /data','Non-LVM path: grow the filesystem directly (resize2fs for ext4).'],
    ['df -h /data','Confirm, all while the database stayed up.']
  ],
  key:'XFS and ext4 both grow online while mounted. Nothing here requires downtime — which is exactly why the interviewer is asking.',
  followups:['Shrinking is a different story: XFS cannot shrink at all, ext4 only unmounted.','EBS modification has a cooldown before the volume can be changed again — mention it.'] },

{ title:'Patch a fleet without breaking it', cat:'ops', level:'intermediate',
  situation:'A critical CVE lands. You own 200 instances across two regions.',
  steps:[
    ['rpm -qa | grep openssl','Confirm the installed version on a sample host.'],
    ['yum check-update --security','What is available.'],
    ['yum update --security --assumeno','Preview without committing.'],
    ['(stage) patch one canary instance first','Verify the application, not just the package version.'],
    ['systemctl status myapp; curl -sf localhost:8080/health','Prove the canary is healthy after patching.'],
    ['needs-restarting -r','Does this require a reboot, or just service restarts?'],
    ['aws ssm send-command --targets Key=tag:Env,Values=canary --document-name AWS-RunPatchBaseline','Roll out through Patch Manager, in waves.'],
    ['(verify) rpm -qa | grep openssl across the fleet','Confirm coverage rather than assuming it.']
  ],
  key:'Canary first, then waves, with a health check between each — and a rollback plan. Patching everything at once is the answer that fails the question.',
  followups:['How do you handle instances that must not reboot? Live-patch where supported, or drain and replace via an updated AMI.','Immutable answer: bake a new AMI and roll the ASG — no in-place patching at all.'] },

{ title:'Nobody can sudo any more', cat:'perms', level:'intermediate',
  situation:'A sudoers edit went wrong. Every sudo attempt now fails with a syntax error.',
  steps:[
    ['(do not close your session) check for an open root shell somewhere','An existing root session is your fastest recovery.'],
    ['pkexec visudo','If polkit is available and configured.'],
    ['(EC2) aws ssm start-session --target i-...','SSM runs as root and does not depend on sudoers.'],
    ['visudo -c','Validate and identify the broken line.'],
    ['(rescue) stop the instance, attach the root volume elsewhere','The universal fallback.'],
    ['vi /mnt/etc/sudoers.d/deploy','Fix or remove the drop-in file.'],
    ['(prevent) always use visudo and drop-in files under /etc/sudoers.d/','Never edit the main file directly.']
  ],
  key:'This is a "did you learn it the hard way?" question. The right answer names visudo\'s validation up front, and SSM or volume rescue as the way out.',
  followups:['Why drop-in files? A broken drop-in can be deleted wholesale; a broken main sudoers cannot.'] },

{ title:'Memory looks full but nothing is wrong', cat:'procs', level:'beginner',
  situation:'Monitoring alarms that free memory is under 5%. The application is responding normally.',
  steps:[
    ['free -h','Read the available column, not free.'],
    ['cat /proc/meminfo | grep -E "MemAvailable|Cached|Buffers"','How much is page cache the kernel will hand back on demand.'],
    ['vmstat 1 5','si/so at zero means there is no memory pressure at all.'],
    ['ps aux --sort=-%rss | head','Actual per-process consumption.'],
    ['dmesg -T | grep -i "out of memory"','Nothing here confirms the kernel is not struggling.'],
    ['(fix the alarm) alert on available memory and swap activity','Not on free.']
  ],
  key:'Unused RAM is wasted RAM — Linux fills it with page cache and reclaims it instantly when a process needs memory. Alarming on "free" generates false pages forever.',
  followups:['When is low available memory real? When si/so climb in vmstat, or when the OOM killer appears in dmesg.'] }

);
