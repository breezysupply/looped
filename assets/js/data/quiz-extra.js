/* Output-reading and hazard questions.
   LX.outputQs : you are shown real terminal output and asked what it means.
   LX.dangerQs : which command is the wrong/destructive move here.            */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.outputQs = LX.outputQs || [];
LX.dangerQs = LX.dangerQs || [];

LX.outputQs.push(

{ cat:'disk', level:'beginner', cmd:'df -h',
  out:'Filesystem      Size  Used Avail Use% Mounted on\n/dev/nvme0n1p1   30G   28G     0 100% /\n/dev/nvme1n1    500G  180G  320G  37% /data',
  q:'What does this tell you?',
  choices:['The root filesystem is full; /data has plenty of room','The whole instance is out of disk','The disk has failed','Inodes are exhausted on /'],
  a:0, why:'Read it per filesystem. / is at 100% with zero available, /data is fine — so the fix is local to /, and df -i is the next command to rule out the inode variant.' },

{ cat:'disk', level:'intermediate', cmd:'df -i',
  out:'Filesystem       Inodes   IUsed   IFree IUse% Mounted on\n/dev/nvme0n1p1  1966080 1966080       0  100% /',
  q:'Writes are failing with ENOSPC but df -h shows 40% used. What is happening?',
  choices:['Inodes are exhausted — too many files, regardless of their size','The disk is physically full','The filesystem is mounted read-only','Quota limits were exceeded'],
  a:0, why:'Inode count is fixed at mkfs time on ext4. Millions of tiny files exhaust it while blocks remain free. Find the directory with the file count, not the byte count.' },

{ cat:'net', level:'intermediate', cmd:'ss -tulpn | grep 8080',
  out:'tcp   LISTEN  0  4096   127.0.0.1:8080   0.0.0.0:*   users:(("myapp",pid=8123,fd=7))',
  q:'A client on another host cannot connect. Why?',
  choices:['It is bound to loopback, so only this host can reach it','The security group is blocking 8080','The process lacks permission to bind','The port is already in use'],
  a:0, why:'127.0.0.1 means loopback only. No firewall change can fix this — the process must bind 0.0.0.0 or the interface address.' },

{ cat:'procs', level:'intermediate', cmd:'top -b -n1 | head -4',
  out:'top - 15:41:20 up 12 days,  load average: 14.72, 13.90, 9.55\nTasks: 141 total,   1 running, 128 sleeping,  12 D\n%Cpu(s):  2.1 us,  1.4 sy,  0.0 ni,  8.0 id, 88.5 wa',
  q:'Where is the bottleneck?',
  choices:['Disk I/O — 88.5% of CPU time is spent waiting on it','CPU — load average is 14','Memory — processes are swapping','Network — packets are being retransmitted'],
  a:0, why:'wa is time idle while waiting on I/O, and 12 tasks are in D state. Actual CPU work is under 4%. Load is high because Linux counts uninterruptible sleep toward it.' },

{ cat:'procs', level:'beginner', cmd:'free -h',
  out:'               total        used        free      shared  buff/cache   available\nMem:           7.7Gi       1.8Gi       201Mi        21Mi       5.7Gi       5.5Gi\nSwap:             0B          0B          0B',
  q:'Free memory is 201Mi. Is this host under memory pressure?',
  choices:['No — 5.5Gi is available; the rest is reclaimable page cache','Yes — it is nearly out of memory','Yes — swap is exhausted','Cannot tell without running top'],
  a:0, why:'Linux deliberately fills unused RAM with page cache and reclaims it on demand. Always read available, never free. Alarming on free generates permanent false pages.' },

{ cat:'procs', level:'intermediate', cmd:'dmesg -T | tail -2',
  out:'[Fri Aug 14 13:22:04 2026] java invoked oom-killer: gfp_mask=0x140dca, order=0\n[Fri Aug 14 13:22:04 2026] Out of memory: Killed process 14203 (java) total-vm:5731204kB, anon-rss:3402180kB',
  q:'The application log ends mid-line with no exception. What happened?',
  choices:['The kernel OOM killer terminated it with SIGKILL for using 3.4G','The JVM crashed with an unhandled exception','systemd stopped it after a failed health check','The process exited cleanly'],
  a:0, why:'SIGKILL cannot be caught, so the process gets no chance to log or flush — which is exactly why the log ends mid-write. The evidence only exists in the kernel ring buffer.' },

{ cat:'sys', level:'beginner', cmd:'systemctl status myapp | head -6',
  out:'● myapp.service - Order API\n     Loaded: loaded (/etc/systemd/system/myapp.service; disabled)\n     Active: active (running) since Fri 2026-08-14 09:02:11 UTC; 3h ago\n   Main PID: 8123 (myapp)',
  q:'The service works now. What happens after a reboot?',
  choices:['It will not start — the unit is loaded but disabled','It starts automatically, since it is active','It starts only if a dependency requires it','It starts in degraded mode'],
  a:0, why:'"disabled" on the Loaded line means no boot-time symlink exists. active = right now, enabled = at boot. systemctl enable --now sets both.' },

{ cat:'perms', level:'beginner', cmd:'ls -l /opt/deploy.sh',
  out:'-rw-r--r-- 1 root root 842 Aug 14 09:12 /opt/deploy.sh',
  q:'A user runs ./deploy.sh and gets "Permission denied". Why?',
  choices:['No execute bit is set for anyone','The file is owned by root','The user is not in the root group','SELinux is blocking it'],
  a:0, why:'Mode 644 is rw-r--r--: readable but not executable. chmod +x adds it. Note that bash /opt/deploy.sh would work anyway, since that only needs read.' },

{ cat:'perms', level:'intermediate', cmd:'ls -ld /srv/shared',
  out:'drwxr-x---+ 4 root developers 4096 Aug 14 10:02 /srv/shared',
  q:'What are the two things worth noticing here?',
  choices:['Others have no access at all, and the + means ACLs are also in effect','It is world-readable and has the sticky bit','It is a symlink with extended attributes','It is setuid and group-writable'],
  a:0, why:'The trailing + is easy to miss and means ls is not telling the whole story — run getfacl. Also note others have no x, so they cannot even traverse into it.' },

{ cat:'procs', level:'intermediate', cmd:'ps -eo stat,pid,cmd | head -4',
  out:'STAT   PID CMD\nZ     8891 [worker] <defunct>\nD     8892 /usr/bin/rsync /data /mnt/nfs\nS     8893 /usr/sbin/sshd',
  q:'Which of these will not respond to kill -9, and why?',
  choices:['The D-state rsync — it is in uninterruptible sleep inside a syscall','The Z-state worker — zombies ignore all signals','The S-state sshd — it is a daemon','All three will die immediately'],
  a:0, why:'D state means blocked in the kernel, usually on storage or NFS; signals are only delivered when it returns. The zombie is already dead — it is an unreaped exit status, and you signal its parent instead.' },

{ cat:'disk', level:'intermediate', cmd:'iostat -xz 1 2 | tail -3',
  out:'Device   r/s     w/s    rkB/s     wkB/s  await  aqu-sz  %util\nnvme1n1  412.0   980.0  41200.0  198400.0 241.86   38.42   99.9',
  q:'What does this say about nvme1n1?',
  choices:['It is saturated — 100% busy with 240ms latency and a deep queue','It is idle','It is failing and should be replaced','It is nearly out of space'],
  a:0, why:'%util near 100 with high await means requests are queueing. On EBS this often means you are hitting provisioned IOPS rather than a hardware fault — and %util says nothing about free space.' },

{ cat:'net', level:'intermediate', cmd:'curl -s -o /dev/null -w "dns:%{time_namelookup} conn:%{time_connect} tls:%{time_appconnect} ttfb:%{time_starttransfer}\\n" https://api.example.com',
  out:'dns:0.004 conn:0.008 tls:0.031 ttfb:2.418',
  q:'Where is the 2.4 seconds going?',
  choices:['Server-side processing — DNS, TCP, and TLS all completed in 31ms','DNS resolution','The TLS handshake','Network latency on the path'],
  a:0, why:'Time to first byte is measured after the handshake completes, so everything before it is fast. The next step is server-side: CPU, I/O, and downstream dependency latency.' },

{ cat:'net', level:'intermediate', cmd:'ss -tan | awk \'{print $1}\' | sort | uniq -c | sort -rn',
  out:'  18422 TIME-WAIT\n    412 ESTAB\n     88 CLOSE-WAIT\n      2 LISTEN',
  q:'Outbound connections are now failing with "cannot assign requested address". What is the cause?',
  choices:['Ephemeral ports are exhausted by 18k sockets in TIME_WAIT','The listener has crashed','A SYN flood is in progress','DNS resolution is failing'],
  a:0, why:'The ephemeral range is about 28k ports. TIME_WAIT is correct TCP behaviour for the side that closes first; the real fix is connection reuse (keep-alive/pooling), not tuning the timer away.' },

{ cat:'disk', level:'intermediate', cmd:'lsof +L1 | head -3',
  out:'COMMAND   PID   USER   FD   TYPE DEVICE SIZE/OFF NLINK  NODE NAME\njava     8123 appsvc  12w   REG  259,2 12884901888     0 44210 /var/log/app/app.log (deleted)',
  q:'df shows /var at 100% but du accounts for only a fraction. What does this output explain?',
  choices:['A deleted 12G file is still held open, so its blocks are not freed','The filesystem needs fsck','du is excluding hidden directories','The journal is consuming the space'],
  a:0, why:'NLINK 0 means the directory entry is gone but the inode survives until the last descriptor closes. Restart the holder — or truncate via /proc/PID/fd — to reclaim it.' },

{ cat:'net', level:'beginner', cmd:'ip r',
  out:'default via 10.0.0.1 dev eth0 proto dhcp metric 100\n10.0.0.0/16 dev eth0 proto kernel scope link src 10.0.3.77\n169.254.169.254 dev eth0 scope link',
  q:'What is the default gateway for this host?',
  choices:['10.0.0.1 via eth0','10.0.3.77','169.254.169.254','There is no default route'],
  a:0, why:'The default line is the route of last resort. The 169.254.169.254 entry is the EC2 instance metadata service, and 10.0.3.77 is this host\'s own address.' },

{ cat:'transfer', level:'beginner', cmd:'ssh -i key.pem ec2-user@10.0.1.20',
  out:'@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n@         WARNING: UNPROTECTED PRIVATE KEY FILE!          @\n@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\nPermissions 0644 for "key.pem" are too open.\nThis private key will be ignored.',
  q:'What fixes this?',
  choices:['chmod 600 key.pem','chmod 777 key.pem','Regenerate the key pair','Add -o StrictHostKeyChecking=no'],
  a:0, why:'ssh refuses to use a private key that group or other can read. 600 or 400 both satisfy it — and note the key was never offered, so this is not yet a server-side problem.' },

{ cat:'sys', level:'intermediate', cmd:'journalctl -u sshd -n 3 --no-pager',
  out:'sshd[3312]: Authentication refused: bad ownership or modes for directory /home/ec2-user/.ssh\nsshd[3312]: Connection closed by authenticating user ec2-user 10.0.3.9 port 51422 [preauth]',
  q:'The key is present in authorized_keys. Why is login still refused?',
  choices:['~/.ssh is writable by group or other, so sshd will not trust it','The key format is unsupported','The user account is locked','PasswordAuthentication is disabled'],
  a:0, why:'sshd requires 700 on ~/.ssh and 600 on authorized_keys, owned by the user — otherwise anyone with write access could add their own key. The client never sees this reason.' },

{ cat:'cloud', level:'intermediate', cmd:'curl -s http://169.254.169.254/latest/meta-data/instance-id',
  out:'<?xml version="1.0" encoding="iso-8859-1"?>\n<html><head><title>401 - Unauthorized</title></head></html>',
  q:'What does a 401 from the metadata service mean?',
  choices:['IMDSv2 is enforced and this request had no token','The instance has no IAM role','The metadata service is down','A security group is blocking it'],
  a:0, why:'With HttpTokens=required you must first PUT to /latest/api/token and then send X-aws-ec2-metadata-token. Old SDKs and scripts that only speak IMDSv1 break exactly here.' },

{ cat:'text', level:'beginner', cmd:'awk \'{print $1}\' access.log | sort | uniq -c | sort -rn | head -3',
  out:'  48211 203.0.113.44\n   1902 198.51.100.7\n    884 192.0.2.19',
  q:'What have you learned?',
  choices:['One client sent 48k requests — 25x the next busiest','The site served 48k requests in total','203.0.113.44 is the server address','There were three unique clients'],
  a:0, why:'This is the top-talkers pipeline. The distribution matters more than the total: one address at 25x the next is a scraper, a retry storm, or an attack.' },

{ cat:'procs', level:'beginner', cmd:'uptime; nproc',
  out:' 15:41:02 up 12 days,  2 users,  load average: 3.10, 6.44, 8.92\n8',
  q:'How healthy is this host?',
  choices:['Fine, and recovering — load 3.1 on 8 cores, trending down from 8.9','Overloaded — load above 3 is dangerous','Cannot tell without checking memory','Saturated — the 15-minute figure is what matters'],
  a:0, why:'Always compare load against core count, and read the three figures as a trend: 1-min below 15-min means the pressure is easing. The reverse means it is getting worse.' }

);

LX.dangerQs.push(

{ cat:'disk', level:'beginner',
  q:'A 12G log is filling /var and the service writing it is still running. Which command frees the space WITHOUT breaking the writer?',
  choices:['truncate -s 0 /var/log/app.log','rm -f /var/log/app.log','mv /var/log/app.log /tmp/','gzip /var/log/app.log'],
  a:0, why:'Unlinking leaves the blocks allocated until the process closes its descriptor; moving it means the app keeps writing to the moved inode; gzip needs free space you do not have.' },

{ cat:'net', level:'intermediate',
  q:'Traffic to a service is being dropped and you suspect the host firewall. Which of these should you NOT run on a production host?',
  choices:['iptables -F','iptables -L -n -v','firewall-cmd --list-all','ss -tulpn'],
  a:0, why:'Flushing every rule removes protections other systems depend on and destroys the evidence. Read the rules with counters first; only then change one deliberately.' },

{ cat:'procs', level:'beginner',
  q:'A process is misbehaving. What is the correct first signal?',
  choices:['kill -TERM, then escalate if it ignores you','kill -9 immediately','kill -STOP and leave it','kill -HUP to force an exit'],
  a:0, why:'TERM can be caught, so the process flushes buffers and removes lock and PID files. -9 gives it no chance and is how you get corrupt state. HUP usually means "reload config", not exit.' },

{ cat:'disk', level:'intermediate',
  q:'A filesystem shows I/O errors in dmesg. Which action is unsafe?',
  choices:['Running fsck on it while it is still mounted','Reading dmesg for the underlying error','Taking an EBS snapshot before touching it','Unmounting it first, then repairing'],
  a:0, why:'Repairing a mounted filesystem corrupts it. Snapshot first, unmount, then fsck or xfs_repair — and read dmesg before remounting, or you erase the evidence of why it went read-only.' },

{ cat:'perms', level:'intermediate',
  q:'You need to add a sudo rule for a deploy user. What is the safe way?',
  choices:['visudo -f /etc/sudoers.d/deploy','vi /etc/sudoers','echo the rule >> /etc/sudoers','chmod 666 /etc/sudoers then edit it'],
  a:0, why:'visudo validates syntax before saving. A malformed sudoers locks everyone out of sudo — on EC2 that means console or volume-detach recovery. A drop-in file can also just be deleted.' },

{ cat:'sys', level:'beginner',
  q:'You edited a systemd unit file. What must happen before the change takes effect?',
  choices:['systemctl daemon-reload, then restart the unit','Nothing — systemd watches the file','A full reboot','systemctl enable the unit again'],
  a:0, why:'Without daemon-reload systemd keeps the cached definition and your edit silently does nothing — one of the most common "why did that not work" moments.' },

{ cat:'transfer', level:'intermediate',
  q:'You are changing sshd_config on a remote host. Which habit prevents locking yourself out?',
  choices:['Run sshd -t and open a second session to verify before closing the first','Restart sshd and reconnect immediately','Edit and reboot to apply cleanly','Disable PasswordAuthentication first, then test'],
  a:0, why:'sshd -t validates the config, and keeping the working session open means a broken change is recoverable. Otherwise recovery is the serial console or detaching the root volume.' },

{ cat:'disk', level:'intermediate',
  q:'You added a new volume to /etc/fstab. What do you do before rebooting?',
  choices:['mount -a (and findmnt --verify) to test the entry now','Reboot and see if it comes back','Nothing — fstab syntax is validated on save','Remove the old entries first'],
  a:0, why:'A bad fstab line can stop the instance booting entirely. Test while you still have a shell, and use nofail plus a UUID so a missing volume degrades instead of blocking boot.' },

{ cat:'text', level:'beginner',
  q:'Which of these silently destroys the file you are trying to edit?',
  choices:['sed "s/a/b/" file > file','sed -i.bak "s/a/b/" file','sed "s/a/b/" file > new && mv new file','sed -n "1,10p" file'],
  a:0, why:'The shell truncates the redirect target before sed reads it, so you end up with an empty file. Use -i (ideally with a backup suffix) or write to a temporary file first.' },

{ cat:'procs', level:'intermediate',
  q:'A long migration is running over SSH and your connection is unstable. What should you have done?',
  choices:['Started it inside tmux or screen so you can reattach','Run it with nohup and no logging','Increased ClientAliveInterval','Nothing — SSH sessions survive disconnects'],
  a:0, why:'tmux survives the disconnect and lets you reattach and watch. nohup survives too, but you can never get the session back to see progress or answer a prompt.' },

{ cat:'cloud', level:'intermediate',
  q:'An API call returns AccessDenied from an EC2 instance. What is the first command?',
  choices:['aws sts get-caller-identity','Edit the IAM policy','Restart the application','Detach and reattach the instance profile'],
  a:0, why:'Confirm which principal is actually in play first. Environment variables and a stale ~/.aws/credentials both override the instance role, and that is usually the surprise.' },

{ cat:'perms', level:'beginner',
  q:'Which command would you never run to "fix" a permissions problem on a web root?',
  choices:['chmod -R 777 /var/www','chmod -R g+w /var/www','chown -R nginx:nginx /var/www','setfacl -m u:nginx:rx /var/www'],
  a:0, why:'777 makes every file world-writable — anyone on the host can replace your application code. Grant the narrowest access that solves it: ownership, group write, or an ACL.' }

);
