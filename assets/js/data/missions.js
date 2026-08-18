/* Sandbox missions: a world seed + objectives checked against real state.
   ctx = { w: world, ran: [command strings], last: {cmd, out} }              */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.missions = LX.missions || [];

var GB = 1024 * 1024 * 1024, MB = 1024 * 1024;
function ranRe(ctx, re) { return ctx.ran.some(function (c) { return re.test(c); }); }
function outHas(ctx, re) { return ctx.last && re.test(ctx.last.out || ''); }

/* ═══ 1. disk full ═══════════════════════════════════════════ */
LX.missions.push({
  id:'m-disk', title:'/var is 100% full', labId:'disk-full',
  cat:'disk', level:'beginner', mins:8, kind:'incident',
  brief:'02:14. DiskSpaceCritical on ip-10-0-4-118. The app has stopped writing logs. Get the filesystem under 50% without breaking the running service, then find out why rotation never kicked in.',
  keys:['man ', 'guide ', 'df -h', 'df -i', 'du -h -d1', '/var/log', 'find', '-size +100M', 'truncate -s 0', 'ls -lh', '|', 'sort -h'],
  world:{
    user:'ec2-user', host:'ip-10-0-4-118', cwd:'/home/ec2-user',
    disks:[
      { fs:'/dev/nvme0n1p1', size:30 * GB, base:8 * GB, mount:'/', inodes:1966080, iused:82471 },
      { fs:'/dev/nvme1n1', size:20 * GB, base:900 * MB, mount:'/var', inodes:1310720, iused:41003 }
    ],
    files:[
      { path:'/var/log/app/app.log', size:12 * GB, owner:'appsvc', group:'appsvc', mtime:'Aug 14 02:14',
        fake:'2026-08-14T02:11:04Z DEBUG pool: acquired conn 41822\n2026-08-14T02:11:04Z DEBUG pool: released conn 41822\n2026-08-14T02:11:05Z ERROR upstream timeout after 30s\n2026-08-14T02:11:05Z DEBUG pool: acquired conn 41823' },
      { path:'/var/log/app/app.log-20260813', group:'appsvc', size:2100 * MB, owner:'appsvc', ageDays:3 },
      { path:'/var/log/app/app.log-20260812', group:'appsvc', size:2000 * MB, owner:'appsvc', ageDays:4 },
      { path:'/var/log/app/app.log-20260811', group:'appsvc', size:1900 * MB, owner:'appsvc', ageDays:5 },
      { path:'/var/log/nginx/access.log', size:180 * MB, owner:'nginx', group:'nginx' },
      { path:'/var/log/messages', size:24 * MB, owner:'root', group:'root' },
      { path:'/etc/logrotate.d/app', owner:'root',
        content:'/var/log/app/*.log {\n    daily\n    rotate 0\n    missingok\n    notifempty\n}\n' }
    ],
    procs:[
      { pid:8123, user:'appsvc', cmd:'/usr/bin/java -jar /opt/app/app.jar', cpu:1.7, mem:11.0,
        rss:892112, open:['/var/log/app/app.log'], unit:'myapp' },
      { pid:3301, user:'root', cmd:'/usr/sbin/rsyslogd -n', cpu:0.1, mem:0.4 }
    ],
    units:{ myapp:{ desc:'Order API', active:true, enabled:true, pid:8123,
      log:['Aug 14 02:12:41 ip-10-0-4-118 app[8123]: WARN could not write log: No space left on device'] } }
  },
  objectives:[
    { id:'confirm', text:'Confirm which filesystem is full — and rule out the other way one fills up',
      hint:'One command shows every mount with its usage. The same command has a flag for the other resource a filesystem runs out of.',
      hint2:'df -h reads blocks; df -i reads inodes. You want both before going further — a full-looking disk with free blocks is an inode problem.',
      reveal:'df -h && df -i',
      done:function (c) {
        var blocks = false, inodes = false;
        c.ran.forEach(function (line) {
          line.split(/[;&|]+/).forEach(function (seg) {
            if (!/^\s*df\b/.test(seg)) return;
            if (/\s-[a-zA-Z]*i/.test(seg)) inodes = true; else blocks = true;
          });
        });
        return blocks && inodes;
      } },
    { id:'localise', text:'Narrow it to the directory eating the space', hint:'Walk down a level at a time rather than scanning everything.',
      reveal:'du -h -d1 /var/log | sort -h', done:function (c) { return ranRe(c, /\bdu\b.*\/var/); } },
    { id:'name', text:'Name the specific large files', hint:'find with a size test, or ls sorted by size.',
      reveal:'find /var/log/app -type f -size +100M -exec ls -lh {} +',
      done:function (c) { return ranRe(c, /find\b.*-size|ls\b.*-l.*S|ls\b.*S.*\/var\/log/); } },
    { id:'reclaim', text:'Get /var below 50% — without breaking the writer',
      hint:'The service still holds app.log open. Deleting it would not return the blocks.',
      reveal:'truncate -s 0 /var/log/app/app.log',
      done:function (c) {
        var d = c.w.disks.filter(function (x) { return x.mount === '/var'; })[0];
        return LXShell.diskUsed(c.w, d) / d.size < 0.5;
      } },
    { id:'rotations', text:'Clear the stale rotated logs', hint:'They are older than two days and nothing holds them open.',
      reveal:'find /var/log/app -name "app.log-*" -mtime +2 -delete',
      done:function (c) {
        return !Object.keys(c.w.fs).some(function (p) { return /app\.log-2026081[123]$/.test(p); });
      } },
    { id:'rootcause', text:'Read the rotation policy and spot why this recurred',
      hint:'The policy file is in /etc/logrotate.d/.', reveal:'cat /etc/logrotate.d/app',
      done:function (c) { return ranRe(c, /logrotate/); } }
  ]
});

/* ═══ 2. nginx will not start ════════════════════════════════ */
LX.missions.push({
  id:'m-nginx', title:'nginx will not start after a config edit', labId:'nginx-down',
  cat:'sys', level:'beginner', mins:8, kind:'incident',
  brief:'A colleague edited nginx.conf and restarted. The site is down and they are at lunch. Get it serving again — and keep the change they meant to make.',
  keys:['man ', 'guide ', 'systemctl status nginx', 'journalctl -u nginx', 'nginx -t', 'diff -u', 'sed -i', '/etc/nginx/nginx.conf', 'sudo'],
  world:{
    user:'ec2-user', host:'ip-10-0-2-45',
    disks:[{ fs:'/dev/nvme0n1p1', size:30 * GB, base:9 * GB, mount:'/', inodes:1966080, iused:91002 }],
    files:[
      { path:'/etc/nginx/nginx.conf', owner:'root', mtime:'Aug 14 11:41',
        content:'user nginx;\nworker_processes auto;\n\nevents {\n    worker_connection 1024;\n}\n\nhttp {\n    include /etc/nginx/mime.types;\n    keepalive_timeout 65;\n    client_max_body_size 20M;\n    server {\n        listen 80;\n        root /usr/share/nginx/html;\n    }\n}\n' },
      { path:'/etc/nginx/nginx.conf.bak', owner:'root', mtime:'Jul 30 09:03',
        content:'user nginx;\nworker_processes auto;\n\nevents {\n    worker_connections 1024;\n}\n\nhttp {\n    include /etc/nginx/mime.types;\n    keepalive_timeout 65;\n    server {\n        listen 80;\n        root /usr/share/nginx/html;\n    }\n}\n' }
    ],
    procs:[{ pid:3301, user:'root', cmd:'/usr/sbin/rsyslogd -n', cpu:0.1, mem:0.4 }],
    units:{ nginx:{ desc:'The nginx HTTP and reverse proxy server', active:false, enabled:true, failed:true,
      log:['Aug 14 11:42:07 ip-10-0-2-45 nginx[20455]: nginx: [emerg] unknown directive "worker_connection" in /etc/nginx/nginx.conf:14',
           'Aug 14 11:42:07 ip-10-0-2-45 nginx[20455]: nginx: configuration file /etc/nginx/nginx.conf test failed',
           'Aug 14 11:42:07 ip-10-0-2-45 systemd[1]: nginx.service: Control process exited, code=exited, status=1/FAILURE'],
      validate:function (w) {
        var n = w.fs['/etc/nginx/nginx.conf'];
        return !!n && /worker_connections\s+\d+/.test(n.content) && !/worker_connection\s+\d/.test(n.content);
      },
      onStart:function (w) {
        w.sockets = [{ addr:'0.0.0.0', port:80, pid:20512, cmd:'nginx', user:'root' }];
      } }
    },
    extra:{
      nginx:function (w, a) {
        if (a.indexOf('-t') === -1) return { out:'', code:0 };
        var n = w.fs['/etc/nginx/nginx.conf'];
        if (!n) return { out:'', err:'nginx: [emerg] open() "/etc/nginx/nginx.conf" failed', code:1 };
        if (/worker_connection\s+\d/.test(n.content)) {
          return { out:'', code:1,
            err:'nginx: [emerg] unknown directive "worker_connection" in /etc/nginx/nginx.conf:5\nnginx: configuration file /etc/nginx/nginx.conf test failed' };
        }
        return { out:'nginx: the configuration file /etc/nginx/nginx.conf syntax is ok\nnginx: configuration file /etc/nginx/nginx.conf test is successful\n', code:0 };
      },
      diff:function (w, a) {
        var files = a.filter(function (x) { return x.charAt(0) !== '-'; });
        if (files.length < 2) return { out:'', err:'diff: missing operand', code:2 };
        var A = w.fs[LXShell.resolve(w, files[0])], B = w.fs[LXShell.resolve(w, files[1])];
        if (!A || !B) return { out:'', err:'diff: No such file or directory', code:2 };
        var la = (A.content || '').split('\n'), lb = (B.content || '').split('\n');
        var out = ['--- ' + files[0], '+++ ' + files[1]], any = false;
        var max = Math.max(la.length, lb.length);
        for (var i = 0; i < max; i++) {
          if (la[i] !== lb[i]) {
            any = true;
            if (la[i] != null && la[i] !== '') out.push('-' + la[i]);
            if (lb[i] != null && lb[i] !== '') out.push('+' + lb[i]);
          }
        }
        return { out: any ? out.join('\n') + '\n' : '', code: any ? 1 : 0 };
      }
    }
  },
  objectives:[
    { id:'state', text:'Establish how the unit failed', hint:'State, exit code, and recent log lines in one command.',
      reveal:'systemctl status nginx', done:function (c) { return ranRe(c, /systemctl\s+status\s+nginx/); } },
    { id:'log', text:'Read the actual error message', hint:'The service never started, so it never wrote its own error log.',
      reveal:'journalctl -u nginx -n 20 --no-pager', done:function (c) { return ranRe(c, /journalctl/); } },
    { id:'validate', text:'Confirm the fault with the config validator', hint:'Most daemons ship one.',
      reveal:'nginx -t', done:function (c) { return ranRe(c, /nginx\s+-t/); } },
    { id:'diff', text:'See what actually changed against the backup', hint:'There is an nginx.conf.bak next to it.',
      reveal:'diff -u /etc/nginx/nginx.conf.bak /etc/nginx/nginx.conf',
      done:function (c) { return ranRe(c, /\bdiff\b/); } },
    { id:'fix', text:'Fix the typo, keeping client_max_body_size',
      hint:'A targeted substitution beats reverting the whole file.',
      reveal:'sudo sed -i.bak2 "s/worker_connection /worker_connections /" /etc/nginx/nginx.conf',
      done:function (c) {
        var n = c.w.fs['/etc/nginx/nginx.conf'];
        return !!n && /worker_connections\s+\d/.test(n.content) && /client_max_body_size/.test(n.content);
      } },
    { id:'serving', text:'Get nginx running and prove it', hint:'Validate, restart, then check it is actually active.',
      reveal:'sudo nginx -t && sudo systemctl restart nginx && systemctl is-active nginx',
      done:function (c) { return c.w.units.nginx.active && ranRe(c, /is-active|curl/); } }
  ]
});

/* ═══ 3. bound to loopback ═══════════════════════════════════ */
LX.missions.push({
  id:'m-bind', title:'The API answers locally but not from outside', labId:'bind-address',
  cat:'net', level:'intermediate', mins:8, kind:'incident',
  brief:'curl localhost:8080/health returns 200 on the box. From the load balancer it times out. The team says it is "a firewall thing". Find out what it really is and fix it.',
  keys:['man ', 'guide ', 'ss -tulpn', 'curl -s', 'http://10.0.3.77:8080/health', 'grep -rn', '/etc/myapp/config.yml', 'sed -i', 'sudo', 'systemctl restart myapp'],
  world:{
    user:'ec2-user', host:'ip-10-0-3-77', ip:'10.0.3.77',
    disks:[{ fs:'/dev/nvme0n1p1', size:30 * GB, base:9 * GB, mount:'/', inodes:1966080, iused:88123 }],
    files:[
      { path:'/etc/myapp/config.yml', owner:'root',
        content:'server:\n  # host: 0.0.0.0 to accept external traffic\n  bind_host: 127.0.0.1\n  bind_port: 8080\n  workers: 4\n' }
    ],
    procs:[{ pid:8123, user:'appsvc', cmd:'/usr/local/bin/myapp --config /etc/myapp/config.yml', cpu:1.2, mem:8.0, unit:'myapp' }],
    sockets:[{ addr:'127.0.0.1', port:8080, pid:8123, cmd:'myapp', user:'appsvc' }],
    units:{ myapp:{ desc:'Demo API', active:true, enabled:true, pid:8123,
      log:['Aug 14 09:02:11 ip-10-0-3-77 myapp[8123]: listening on 127.0.0.1:8080'],
      onStart:function (w) {
        var cfg = w.fs['/etc/myapp/config.yml'];
        var m = cfg && cfg.content.match(/bind_host:\s*(\S+)/);
        w.sockets = [{ addr:(m ? m[1] : '127.0.0.1'), port:8080, pid:9440, cmd:'myapp', user:'appsvc' }];
        w.units.myapp.log.push('Aug 14 12:01:44 ip-10-0-3-77 myapp[9440]: listening on ' + (m ? m[1] : '127.0.0.1') + ':8080');
      } } }
  },
  objectives:[
    { id:'socket', text:'Find what address the process is actually listening on',
      hint:'The port is not the interesting part — the address is.', reveal:'ss -tulpn | grep 8080',
      done:function (c) { return ranRe(c, /\bss\b|\blsof\b.*-i/); } },
    { id:'prove', text:'Prove it from the instance\'s own private IP, not localhost',
      hint:'Same request, different destination address.', reveal:'curl -s -o /dev/null -w "%{http_code}" http://10.0.3.77:8080/health',
      done:function (c) { return ranRe(c, /curl\b(?!.*(localhost|127\.0\.0\.1))/); } },
    { id:'config', text:'Find the setting that controls the bind address',
      hint:'Application config, not system config.', reveal:'grep -n bind /etc/myapp/config.yml',
      done:function (c) { return ranRe(c, /(grep|cat).*(myapp|config)/); } },
    { id:'change', text:'Change it to listen on every interface',
      hint:'0.0.0.0 means all IPv4 interfaces.',
      reveal:'sudo sed -i "s/bind_host: 127.0.0.1/bind_host: 0.0.0.0/" /etc/myapp/config.yml',
      done:function (c) {
        var n = c.w.fs['/etc/myapp/config.yml'];
        return !!n && /bind_host:\s*0\.0\.0\.0/.test(n.content);
      } },
    { id:'apply', text:'Make the running process pick it up', hint:'An edit alone does not re-bind an open socket.',
      reveal:'sudo systemctl restart myapp',
      done:function (c) { return (c.w.sockets[0] || {}).addr === '0.0.0.0'; } },
    { id:'verify', text:'Verify it now answers on the private IP',
      hint:'Re-run the check that failed earlier.', reveal:'curl -s -o /dev/null -w "%{http_code}\\n" http://10.0.3.77:8080/health',
      done:function (c) {
        return (c.w.sockets[0] || {}).addr === '0.0.0.0' &&
          c.ran.slice(-6).some(function (x) { return /curl.*10\.0\.3\.77|ss\b/.test(x); });
      } }
  ]
});

/* ═══ 4. OOM kill ════════════════════════════════════════════ */
LX.missions.push({
  id:'m-oom', title:'The service dies every few hours with no error', labId:'oom-kill',
  cat:'procs', level:'intermediate', mins:8, kind:'incident',
  brief:'A Java service on a 3.7G instance disappears two or three times a day. The application log ends mid-line. The team blames the JVM. Find the real cause and prove it.',
  keys:['man ', 'guide ', 'systemctl status myapp', 'dmesg -T', 'grep -i "out of memory"', 'free -h', 'systemctl cat myapp', 'ps -eo pid,rss,cmd', '|'],
  world:{
    user:'ec2-user', host:'ip-10-0-1-52',
    mem:{ total:3829, free:148, used:2913, cache:767, available:610, swap:0 },
    disks:[{ fs:'/dev/nvme0n1p1', size:30 * GB, base:9 * GB, mount:'/', inodes:1966080, iused:77001 }],
    procs:[{ pid:14882, user:'appsvc', cmd:'/usr/bin/java -Xms1g -Xmx3584m -jar /opt/myapp/app.jar',
             cpu:4.0, mem:76.1, rss:2914304, vsz:5731204, unit:'myapp' }],
    dmesg:[
      '[Fri Aug 14 13:22:04 2026] java invoked oom-killer: gfp_mask=0x140dca, order=0, oom_score_adj=0',
      '[Fri Aug 14 13:22:04 2026] Out of memory: Killed process 14203 (java) total-vm:5731204kB, anon-rss:3402180kB, file-rss:0kB, UID:993',
      '[Fri Aug 14 13:22:04 2026] oom_reaper: reaped process 14203 (java), now anon-rss:0kB',
      '[Fri Aug 14 13:22:07 2026] ena 0000:00:05.0 eth0: Link is Up'
    ],
    files:[{ path:'/etc/systemd/system/myapp.service', owner:'root',
      content:'[Unit]\nDescription=Order API\nAfter=network.target\n\n[Service]\nUser=appsvc\nEnvironment=JAVA_OPTS=-Xms1g -Xmx3584m\nExecStart=/usr/bin/java $JAVA_OPTS -jar /opt/myapp/app.jar\nRestart=always\n\n[Install]\nWantedBy=multi-user.target\n' }],
    units:{ myapp:{ desc:'Order API', active:true, enabled:true, pid:14882,
      unitFile:'# /etc/systemd/system/myapp.service\n[Service]\nUser=appsvc\nEnvironment=JAVA_OPTS=-Xms1g -Xmx3584m\nExecStart=/usr/bin/java $JAVA_OPTS -jar /opt/myapp/app.jar\nRestart=always',
      log:['Aug 14 13:22:05 ip-10-0-1-52 systemd[1]: myapp.service: Main process exited, code=killed, status=9/KILL',
           'Aug 14 13:22:05 ip-10-0-1-52 systemd[1]: myapp.service: Failed with result "signal".',
           'Aug 14 13:22:07 ip-10-0-1-52 systemd[1]: myapp.service: Scheduled restart job, restart counter is at 7.'] } }
  },
  objectives:[
    { id:'signal', text:'Establish how the process died', hint:'systemd records the exit code or signal.',
      reveal:'systemctl status myapp', done:function (c) { return ranRe(c, /systemctl\s+status|journalctl/); } },
    { id:'kernel', text:'Find who killed it — the app log will never say',
      hint:'The kernel logs its own decisions in a place userspace tools do not write.',
      reveal:'dmesg -T | grep -i "out of memory"',
      done:function (c) { return ranRe(c, /dmesg/) && outHas(c, /[Oo]ut of memory|oom/i); } },
    { id:'memory', text:'Check how much memory the host actually has, and whether there is swap',
      hint:'Read "available", and look at the swap line.', reveal:'free -h',
      done:function (c) { return ranRe(c, /\bfree\b/); } },
    { id:'heap', text:'Find the configured JVM heap ceiling',
      hint:'Look at how the service is actually started.', reveal:'systemctl cat myapp | grep Xmx',
      done:function (c) { return ranRe(c, /systemctl\s+cat|cat\s+\/etc\/systemd|ps\b.*cmd|grep.*Xmx/); } },
    { id:'fix', text:'Size the heap to fit the host — set Xmx to 2g in the unit file',
      hint:'sed can edit the unit file; then systemd has to re-read it.',
      reveal:'sudo sed -i "s/-Xmx3584m/-Xmx2g/" /etc/systemd/system/myapp.service',
      done:function (c) {
        var n = c.w.fs['/etc/systemd/system/myapp.service'];
        return !!n && /-Xmx(2g|2048m|1[0-9]{3}m)/.test(n.content) && !/-Xmx3584m/.test(n.content);
      } },
    { id:'reload', text:'Make systemd pick up the change', hint:'Editing a unit file is not enough on its own.',
      reveal:'sudo systemctl daemon-reload && sudo systemctl restart myapp',
      done:function (c) { return ranRe(c, /daemon-reload/); } }
  ]
});

/* ═══ 5. log pipeline drill ══════════════════════════════════ */
LX.missions.push({
  id:'m-pipeline', title:'Log forensics: 8 GB overnight', cat:'text', level:'beginner', mins:7, kind:'drill',
  brief:'access.log grew overnight. Answer four questions with pipelines: who is hitting us hardest, which endpoints are erroring, how many 503s, and how many bytes we served. Fields are: IP - - [time] "METHOD /path" status bytes.',
  keys:['man ', 'guide ', 'awk', "'{print $1}'", 'sort', 'uniq -c', 'sort -rn', 'head', 'grep -c', '|', '$7', '$6', 'wc -l'],
  world:{
    user:'ec2-user', host:'ip-10-0-6-14', cwd:'/home/ec2-user',
    disks:[{ fs:'/dev/nvme0n1p1', size:30 * GB, base:9 * GB, mount:'/', inodes:1966080, iused:70112 }],
    files:[{ path:'/home/ec2-user/access.log', content:
      '203.0.113.44 - - [14/Aug/2026:03:11:02] "GET /api/orders" 200 4821\n' +
      '203.0.113.44 - - [14/Aug/2026:03:11:03] "GET /api/orders" 200 4903\n' +
      '198.51.100.7 - - [14/Aug/2026:03:11:04] "POST /api/checkout" 503 122\n' +
      '203.0.113.44 - - [14/Aug/2026:03:11:05] "GET /api/orders" 200 4788\n' +
      '192.0.2.19 - - [14/Aug/2026:03:11:06] "GET /health" 200 18\n' +
      '198.51.100.7 - - [14/Aug/2026:03:11:07] "POST /api/checkout" 503 122\n' +
      '203.0.113.44 - - [14/Aug/2026:03:11:08] "GET /api/orders" 200 4655\n' +
      '198.51.100.7 - - [14/Aug/2026:03:11:09] "POST /api/checkout" 500 210\n' +
      '192.0.2.19 - - [14/Aug/2026:03:11:10] "GET /health" 200 18\n' +
      '203.0.113.44 - - [14/Aug/2026:03:11:11] "GET /api/search" 200 9120\n' +
      '198.51.100.7 - - [14/Aug/2026:03:11:12] "POST /api/checkout" 503 122\n' +
      '203.0.113.44 - - [14/Aug/2026:03:11:13] "GET /api/orders" 200 4712\n' }]
  },
  objectives:[
    { id:'count', text:'How many requests are in the file?', hint:'One line per request.',
      reveal:'wc -l access.log', done:function (c) { return outHas(c, /\b12\b/) && ranRe(c, /wc\b|grep -c/); } },
    { id:'talkers', text:'Rank the client IPs by request count, busiest first',
      hint:'Extract the field, sort, count adjacent duplicates, then sort numerically descending.',
      reveal:"awk '{print $1}' access.log | sort | uniq -c | sort -rn",
      done:function (c) { return outHas(c, /6\s+203\.0\.113\.44/) && ranRe(c, /uniq\s+-c/); } },
    { id:'errors', text:'Show only the endpoints returning 5xx',
      hint:'Count the fields: the quoted request splits into two, so the path is $6 and the status is $7.',
      reveal:"awk '$7 >= 500 {print $6}' access.log | sort | uniq -c",
      done:function (c) { return ranRe(c, /awk/) && outHas(c, /checkout/) && !outHas(c, /health/); } },
    { id:'503s', text:'Count the 503s exactly', hint:'grep can count without piping to wc.',
      reveal:'grep -c " 503 " access.log', done:function (c) { return outHas(c, /^\s*3\s*$/m) && ranRe(c, /503/); } },
    { id:'bytes', text:'Total the bytes served', hint:'Bytes are the last field ($8). awk can accumulate into a variable and print it at END.',
      reveal:"awk '{sum += $8} END {print sum}' access.log",
      done:function (c) { return outHas(c, /33611/) && ranRe(c, /END/); } }
  ],
  debrief:{
    why:['`sort | uniq -c | sort -rn` is the top-offenders pipeline every ops interview expects you to type without hesitating — uniq only collapses *adjacent* duplicates, which is why sort has to come first.',
      'awk field filtering (`$6 >= 500`) replaces grep when the condition is about a column rather than the whole line.',
      '`grep -c` counts without spawning a second process, and reads better than `| wc -l`.',
      'Accumulating in awk with `END { print sum }` answers "how much total?" questions in one pass over the file.'],
    interview:'"For log analysis I stay in the shell: awk to pull the field I care about, sort then uniq -c to get counts, and sort -rn to rank them. If the condition is about a column — status code, byte count — I filter in awk rather than grepping the whole line. For totals I accumulate in awk and print at END. On rotated logs I use zgrep and zcat so I am not unpacking gigabytes onto a disk that may already be full."',
    prevent:['Ship logs to CloudWatch or S3 so this analysis is not gated on the instance staying alive.',
      'Learn the field positions of your log format once — it makes every one of these one-liners instant.',
      'zcat / zgrep / zless read compressed rotations directly.']
  }
});

/* ═══ 6. bash scripting drill ════════════════════════════════ */
LX.missions.push({
  id:'m-bash', title:'Bash: loops, reads, and exit codes', cat:'shell', level:'beginner', mins:8, kind:'drill',
  brief:'Five small scripting tasks against fruit.txt and hosts.txt — the kind of thing you get asked to write on a shared screen. Everything runs as a one-liner.',
  keys:['man ', 'guide ', 'while IFS= read -r', 'do', 'done <', 'for', 'in', 'echo', '"$line"', 'if [ ', ' ]; then', 'fi', '$?', '$(', ')'],
  world:{
    user:'ec2-user', host:'ip-10-0-7-22', cwd:'/home/ec2-user',
    disks:[{ fs:'/dev/nvme0n1p1', size:30 * GB, base:9 * GB, mount:'/', inodes:1966080, iused:70112 }],
    files:[
      { path:'/home/ec2-user/fruit.txt', content:'apple red\nbanana yellow\ncherry red\nchocolate brown\nstrawberries red\n' },
      { path:'/home/ec2-user/hosts.txt', content:'web01\nweb02\ndb01\n' },
      { path:'/home/ec2-user/deploy.sh', mode:'644', content:'#!/usr/bin/env bash\nset -euo pipefail\necho deploying\n' }
    ]
  },
  objectives:[
    { id:'read2', text:'Print every fruit as "<name> is <colour>" using a while-read loop',
      hint:'while IFS=" " read -r a b; do … ; done < file — the last variable soaks up the rest of the line.',
      reveal:'while IFS=" " read -r name colour; do echo "$name is $colour"; done < fruit.txt',
      done:function (c) { return outHas(c, /apple is red/) && outHas(c, /strawberries is red/) && ranRe(c, /while\b.*read/); } },
    { id:'for', text:'Loop over hosts.txt and print "checking <host>" for each',
      hint:'A for loop over $(cat file), or another while-read.',
      reveal:'for h in $(cat hosts.txt); do echo "checking $h"; done',
      done:function (c) { return outHas(c, /checking web01/) && outHas(c, /checking db01/) && ranRe(c, /\bfor\b|\bwhile\b/); } },
    { id:'grepcount', text:'Count how many fruit are red', hint:'grep can count directly.',
      reveal:'grep -c " red$" fruit.txt', done:function (c) { return outHas(c, /^\s*3\s*$/m); } },
    { id:'exitcode', text:'Run something that fails, then print its exit status',
      hint:'$? holds the status of the last command. `false` is a command that always fails.',
      reveal:'grep zzz fruit.txt; echo $?',
      done:function (c) { return ranRe(c, /\$\?/) && outHas(c, /^\s*1\s*$/m); } },
    { id:'ifexec', text:'Make deploy.sh executable, then use an if test to print "runnable" only when it is',
      hint:'chmod +x, then if [ -x deploy.sh ]; then … ; fi',
      reveal:'chmod +x deploy.sh; if [ -f deploy.sh ]; then echo runnable; fi',
      done:function (c) {
        var n = c.w.fs['/home/ec2-user/deploy.sh'];
        return !!n && /[1357]/.test(String(n.mode).charAt(0)) && outHas(c, /runnable/);
      } }
  ],
  debrief:{
    why:['`while IFS= read -r line` is the safe way to read a file line by line: IFS empty preserves leading and trailing whitespace, and -r stops backslashes being interpreted as escapes.',
      'With two variables, `read -r name colour` puts the first field in name and *everything remaining* in colour — so a three-word line still works.',
      'A `for h in $(cat file)` loop splits on whitespace, which breaks on filenames or values containing spaces; while-read does not.',
      '`$?` holds the exit status of the last command: 0 is success, anything else is failure. grep returns 1 when it matches nothing, which is not an error.',
      '`if [ -f file ]` tests existence, `-x` tests the execute bit, `-d` tests for a directory — these are the tests that show up in every real script.'],
    interview:'"For reading a file line by line I use `while IFS= read -r line; do … done < file` — IFS empty so whitespace is preserved, -r so backslashes are literal. I avoid `for x in $(cat file)` because word splitting breaks on spaces. Every script I write starts with `set -euo pipefail` so it exits on error, on an unset variable, and on a failure anywhere in a pipe — without pipefail, `cmd1 | cmd2` reports success even when cmd1 died. And I check `$?` or use `&&` chaining rather than assuming a command worked."',
    prevent:['`set -euo pipefail` at the top of every script, plus `trap cleanup EXIT` when there is state to clean up.',
      'Quote every expansion: "$var", not $var.',
      'Prefer `while IFS= read -r` over `for` when iterating file contents.']
  }
});

/* ═══ 7. locked out of SSH ═══════════════════════════════════ */
LX.missions.push({
  id:'m-ssh', title:'Permission denied (publickey) on a fresh instance', labId:'ssh-denied',
  cat:'transfer', level:'beginner', mins:8, kind:'incident',
  brief:'A new instance from the team AMI refuses every SSH attempt instantly. You got a shell through SSM Session Manager — no port 22, no key. The client is never told why it was refused, so find out from this side and fix it.',
  keys:['man ', 'guide ', 'ssh -v ', 'ec2-user@localhost', 'journalctl -u sshd', 'ls -ld', '/home/ec2-user/.ssh', 'stat', 'chmod 700', 'chmod 600', 'chown', 'grep -i', '/etc/ssh/sshd_config', 'sudo'],
  world:{
    user:'ec2-user', host:'ip-10-0-1-20', ip:'10.0.1.20',
    disks:[{ fs:'/dev/nvme0n1p1', size:8 * GB, base:2 * GB, mount:'/', inodes:524288, iused:41220 }],
    dirs:[
      { path:'/home/ec2-user', mode:'777', owner:'ec2-user', group:'ec2-user' },
      { path:'/home/ec2-user/.ssh', mode:'777', owner:'ec2-user', group:'ec2-user' }
    ],
    files:[
      { path:'/home/ec2-user/.ssh/authorized_keys', mode:'644', owner:'centos', group:'centos',
        content:'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIH4tJ2mQ7fVn0oQ3zK9pR6sW1xY8bC5dE2gT7hL0nM4v team-2026\n' },
      { path:'/etc/ssh/sshd_config', owner:'root', mode:'600',
        content:'# Managed by the team AMI build\nPort 22\nPermitRootLogin no\nPubkeyAuthentication yes\nAuthorizedKeysFile\t.ssh/authorized_keys\nPasswordAuthentication no\n\n# sshd refuses a key file it cannot trust: a home or .ssh directory that\n# others can write to, or a key file owned by somebody else.\nStrictModes yes\n\nSubsystem\tsftp\t/usr/libexec/openssh/sftp-server\n' }
    ],
    procs:[
      { pid:1201, user:'root', cmd:'/usr/sbin/sshd -D', cpu:0.0, mem:0.3, unit:'sshd' },
      { pid:2044, user:'root', cmd:'/usr/bin/amazon-ssm-agent', cpu:0.2, mem:1.1 }
    ],
    sockets:[{ addr:'0.0.0.0', port:22, pid:1201, cmd:'sshd', user:'root' }],
    units:{ sshd:{ desc:'OpenSSH server daemon', active:true, enabled:true, pid:1201,
      log:['Aug 14 14:02:11 ip-10-0-1-20 sshd[4471]: Connection from 203.0.113.9 port 51922',
           'Aug 14 14:02:11 ip-10-0-1-20 sshd[4471]: Authentication refused: bad ownership or modes for directory /home/ec2-user',
           'Aug 14 14:02:11 ip-10-0-1-20 sshd[4471]: Connection closed by authenticating user ec2-user 203.0.113.9 port 51922 [preauth]'] } },
    extra:{
      /* a local login attempt, applying the same StrictModes checks real sshd does */
      ssh:function (w, a) {
        var args = a.filter(function (x) { return x.charAt(0) !== '-'; });
        var target = args[0] || '';
        if (!target) return { out:'', err:'usage: ssh [-v] [user@]hostname [command]', code:255 };
        var hostPart = target.replace(/^[^@]*@/, '');
        if (!/^(localhost|127\.0\.0\.1|10\.0\.1\.20)$/.test(hostPart)) {
          return { out:'', err:'ssh: Could not resolve hostname ' + hostPart +
            ': Name or service not known', code:255 };
        }
        var loud = a.some(function (x) { return /^-v+$/.test(x); });
        var pre = loud
          ? 'debug1: Connecting to ' + hostPart + ' [127.0.0.1] port 22.\n' +
            'debug1: Connection established.\n' +
            'debug1: Offering public key: /home/ec2-user/.ssh/id_ed25519 ED25519\n' +
            'debug1: Authentications that can continue: publickey\n'
          : '';
        function writableByOthers(n) {
          var m = String(n.mode);
          return (parseInt(m.charAt(1), 10) & 2) !== 0 || (parseInt(m.charAt(2), 10) & 2) !== 0;
        }
        var home = w.fs['/home/ec2-user'];
        var dir = w.fs['/home/ec2-user/.ssh'];
        var key = w.fs['/home/ec2-user/.ssh/authorized_keys'];
        if (!key) {
          return { out: pre, err:'ec2-user@' + hostPart + ': Permission denied (publickey).', code:255 };
        }
        var refuse = null;
        if (!home || writableByOthers(home)) refuse = 'directory /home/ec2-user';
        else if (!dir || writableByOthers(dir)) refuse = 'directory /home/ec2-user/.ssh';
        else if (writableByOthers(key) || (key.owner !== 'ec2-user' && key.owner !== 'root')) {
          refuse = 'file /home/ec2-user/.ssh/authorized_keys';
        }
        if (refuse) {
          w.units.sshd.log.push('Aug 14 14:19:40 ip-10-0-1-20 sshd[5120]: Authentication refused: ' +
            'bad ownership or modes for ' + refuse);
          return { out: pre, err:'ec2-user@' + hostPart + ': Permission denied (publickey).', code:255 };
        }
        w.sshOk = true;
        w.units.sshd.log.push('Aug 14 14:22:05 ip-10-0-1-20 sshd[5188]: Accepted publickey for ec2-user ' +
          'from 127.0.0.1 port 40122 ssh2: ED25519 SHA256:3nJ0pQ7wV2xR');
        var cmd = args.slice(1).join(' ');
        if (!cmd) return { out: pre + 'Last login: Fri Aug 14 14:22:05 2026 from 127.0.0.1\n', code:0 };
        if (cmd === 'hostname') return { out: pre + w.host + '\n', code:0 };
        var r = LXShell.exec(w, cmd);
        return { out: pre + (r.out || ''), err: r.err || null, code: r.code || 0 };
      }
    }
  },
  objectives:[
    { id:'reproduce', text:'Reproduce the refusal from the box itself',
      hint:'You have a shell here. Try the login against this host and watch what the client is told.',
      hint2:'ssh takes -v for a verbose trace. Target localhost so you are testing this sshd.',
      reveal:'ssh -v ec2-user@localhost hostname',
      done:function (c) { return ranRe(c, /^\s*ssh\b/m); } },
    { id:'server', text:'Get the reason the server refused — the client is never told',
      hint:'sshd writes its own reasoning to the journal. The client only ever sees "Permission denied".',
      reveal:'journalctl -u sshd -n 20 --no-pager',
      done:function (c) { return ranRe(c, /journalctl|systemctl\s+status\s+sshd/); } },
    { id:'inspect', text:'Inspect the ownership and modes on the home dir, .ssh, and the key file',
      hint:'Listing a directory shows what is inside it; you want the directory entry itself.',
      hint2:'ls -ld <dir> prints the directory rather than its contents. stat gives the same in long form.',
      reveal:'ls -ld /home/ec2-user /home/ec2-user/.ssh && ls -l /home/ec2-user/.ssh/authorized_keys',
      done:function (c) { return ranRe(c, /(ls\b[^|]*-\w*d\w*|stat)\b[^|]*(\.ssh|\/home\/ec2-user)/); } },
    { id:'strict', text:'Find the sshd setting that makes those modes fatal',
      hint:'One directive tells sshd to refuse keys it cannot trust. It is in the server config, not the client one.',
      reveal:'grep -i strictmodes /etc/ssh/sshd_config',
      done:function (c) {
        return ranRe(c, /strictmodes/i) ||
          (ranRe(c, /(cat|grep|less|more|tail)\b.*sshd_config/) && outHas(c, /StrictModes/i));
      } },
    { id:'perms', text:'Tighten the modes: 700 on .ssh, 600 on the key, home not writable by others',
      hint:'sshd objects to anything group- or world-writable anywhere on the path to the key.',
      reveal:'chmod 755 /home/ec2-user && chmod 700 /home/ec2-user/.ssh && chmod 600 /home/ec2-user/.ssh/authorized_keys',
      done:function (c) {
        var h = c.w.fs['/home/ec2-user'], d = c.w.fs['/home/ec2-user/.ssh'],
            k = c.w.fs['/home/ec2-user/.ssh/authorized_keys'];
        function tight(n) {
          var m = String(n.mode);
          return (parseInt(m.charAt(1), 10) & 2) === 0 && (parseInt(m.charAt(2), 10) & 2) === 0;
        }
        return !!h && !!d && !!k && tight(h) && String(d.mode) === '700' && String(k.mode) === '600';
      } },
    { id:'owner', text:'Give the key file back to ec2-user, then prove the login works',
      hint:'The AMI baked it as another user. sshd will not read a key file owned by somebody else.',
      hint2:'chown user:group <file> — it needs sudo — then run the ssh test again.',
      reveal:'sudo chown ec2-user:ec2-user /home/ec2-user/.ssh/authorized_keys && ssh ec2-user@localhost hostname',
      done:function (c) {
        var k = c.w.fs['/home/ec2-user/.ssh/authorized_keys'];
        return !!k && k.owner === 'ec2-user' && !!c.w.sshOk;
      } }
  ]
});

/* ═══ 8. the box is crawling ═════════════════════════════════ */
LX.missions.push({
  id:'m-slow', title:'"The server is slow" — sixty seconds to triage', labId:'slow-host',
  cat:'procs', level:'intermediate', mins:8, kind:'incident',
  brief:'Support says the application is crawling on ip-10-0-5-9. No alarms have fired. You have a shell and about a minute before someone asks for an update. Work down the resources one tool at a time, find what is actually starving, and contain it without losing the backup.',
  keys:['man ', 'guide ', 'uptime', 'nproc', 'top', 'free -h', 'iostat -xz', 'pidstat -d', 'ps aux', 'ionice -c 3 -p ', 'renice -n 19 -p ', 'sudo'],
  world:{
    user:'ec2-user', host:'ip-10-0-5-9', cwd:'/home/ec2-user',
    uptime:'41 days', load:'14.72, 11.90, 7.44', cores:4,
    cpu:{ us:5.2, sy:3.8, id:2.4, wa:88.5 },
    mem:{ total:15773, free:402, used:5120, cache:10251, available:9902, swap:0 },
    disks:[
      { fs:'/dev/nvme0n1p1', size:30 * GB, base:9 * GB, mount:'/', inodes:1966080, iused:88400 },
      { fs:'/dev/nvme1n1', size:500 * GB, base:210 * GB, mount:'/data', inodes:32768000, iused:412003 }
    ],
    io:{
      devices:[
        { name:'nvme0n1', r:2.1, w:8.4, rkb:18.2, wkb:96.0, await:0.44, qu:0.01, util:1.8 },
        { name:'nvme1n1', r:14.0, w:1880.6, rkb:210.0, wkb:200714.0, await:240.18, qu:18.62, util:100.0 }
      ],
      perProcess:[
        { uid:0, pid:20114, rd:2140.0, wr:200714.0, delay:412, cmd:'tar' },
        { uid:993, pid:8123, rd:88.4, wr:1204.0, delay:38, cmd:'java' }
      ]
    },
    files:[
      { path:'/etc/cron.d/nightly-backup', owner:'root',
        content:'# Full /data snapshot to the backup volume\n0 13 * * * root /usr/local/bin/backup.sh\n' },
      { path:'/usr/local/bin/backup.sh', owner:'root', mode:'755',
        content:'#!/usr/bin/env bash\nset -euo pipefail\ntar -czf /data/backups/data-$(date +%F).tgz /data/app\n' }
    ],
    procs:[
      { pid:20114, user:'root', cmd:'tar -czf /data/backups/data-2026-08-14.tgz /data/app',
        cpu:9.4, mem:0.6, rss:24880, vsz:118204, state:'D', time:'48:12' },
      { pid:8123, user:'appsvc', cmd:'/usr/bin/java -jar /opt/app/app.jar',
        cpu:3.1, mem:31.2, rss:5041220, vsz:9112044, state:'D', time:'2:14', unit:'myapp' },
      { pid:8140, user:'appsvc', cmd:'/usr/bin/java -jar /opt/app/worker.jar',
        cpu:1.8, mem:6.4, rss:1024880, vsz:3110024, state:'D', time:'0:48' },
      { pid:3301, user:'root', cmd:'/usr/sbin/rsyslogd -n', cpu:0.1, mem:0.4 },
      { pid:1201, user:'root', cmd:'/usr/sbin/sshd -D', cpu:0.0, mem:0.3 }
    ],
    units:{ myapp:{ desc:'Order API', active:true, enabled:true, pid:8123,
      log:['Aug 14 13:44:02 ip-10-0-5-9 app[8123]: WARN request took 18422ms (threshold 2000ms)'] } }
  },
  objectives:[
    { id:'pressure', text:'Establish whether there is real saturation: load average against core count',
      hint:'A load average means nothing until you know how many cores it is spread across.',
      hint2:'One command prints the three load averages; another prints the core count.',
      reveal:'uptime; nproc',
      done:function (c) { return ranRe(c, /uptime|\btop\b/) && ranRe(c, /nproc|cpuinfo|lscpu/); } },
    { id:'split', text:'Split it: is the CPU busy, or is it waiting on something?',
      hint:'The CPU line breaks into user, system, idle and iowait. One of those is doing all the work here.',
      reveal:'top -b -n1 | head -5',
      done:function (c) { return ranRe(c, /\btop\b|vmstat|mpstat/); } },
    { id:'mem', text:'Rule memory out before you go further',
      hint:'Read the available column and the swap line — heavy swapping looks exactly like this from outside.',
      reveal:'free -h',
      done:function (c) { return ranRe(c, /\bfree\b/); } },
    { id:'device', text:'Name the device that is saturated',
      hint:'Per-device I/O statistics: you want %util and await, not throughput.',
      hint2:'iostat -xz 1 3 — x is extended stats, z hides the idle devices.',
      reveal:'iostat -xz 1 3',
      done:function (c) { return ranRe(c, /iostat/) && outHas(c, /nvme1n1/); } },
    { id:'culprit', text:'Attribute the I/O to a single process',
      hint:'The app is a victim here, not the cause — it is blocked in D state waiting on the same device.',
      hint2:'pidstat breaks I/O down per process with -d.',
      reveal:'pidstat -d 1 3',
      done:function (c) { return ranRe(c, /pidstat\b.*-d|iotop/); } },
    { id:'contain', text:'Stand the backup down without killing it, then re-measure to prove recovery',
      hint:'You do not want to lose the backup — you want it to stop competing. There is a scheduling class for exactly that.',
      hint2:'ionice -c 3 -p <pid> puts it in the idle I/O class. Then run iostat again rather than assuming.',
      reveal:'sudo ionice -c 3 -p 20114 && iostat -xz',
      done:function (c) {
        var d = ((c.w.io || {}).devices || []).filter(function (x) { return x.name === 'nvme1n1'; })[0];
        return !!d && d.util < 50 &&
          c.ran.slice(-4).some(function (x) { return /iostat|uptime|top|pidstat/.test(x); });
      } }
  ]
});

/* ═══ 9. free play ═══════════════════════════════════════════ */
LX.missions.push({
  id:'m-free', title:'Free play — a box to poke at', cat:'files', level:'beginner', mins:0, kind:'free',
  brief:'No objectives. A populated instance with logs, config, processes, and a full-ish disk. Explore, break things, run `help` to see what is implemented. Nothing here can hurt anything.',
  keys:['man ', 'guide ', 'ls -lah', 'cd', 'cat', 'grep -rn', 'df -h', 'du -h -d1', 'ps aux', 'systemctl status', '|', 'help'],
  world:{
    user:'ec2-user', host:'ip-10-0-9-100', cwd:'/home/ec2-user',
    disks:[
      { fs:'/dev/nvme0n1p1', size:30 * GB, base:11 * GB, mount:'/', inodes:1966080, iused:101223 },
      { fs:'/dev/nvme1n1', size:100 * GB, base:31 * GB, mount:'/data', inodes:6553600, iused:88123 }
    ],
    files:[
      { path:'/home/ec2-user/notes.txt', content:'todo: check the app logs\ntodo: verify backups ran\n' },
      { path:'/home/ec2-user/servers.csv', content:'name,role,az\nweb01,frontend,us-east-1a\nweb02,frontend,us-east-1b\ndb01,database,us-east-1a\n' },
      { path:'/var/log/messages', size:24 * MB, owner:'root',
        fake:'Aug 14 09:31:02 ip-10-0-9-100 kernel: ena 0000:00:05.0 eth0: Link is Up\nAug 14 09:44:12 ip-10-0-9-100 systemd[1]: Started Session 42 of user ec2-user.' },
      { path:'/var/log/app/app.log', size:340 * MB, owner:'appsvc',
        fake:'2026-08-14T09:40:01Z INFO  request id=8821 path=/api/orders status=200\n2026-08-14T09:40:02Z ERROR upstream timeout after 30s\n2026-08-14T09:40:03Z INFO  request id=8822 path=/health status=200' },
      { path:'/etc/myapp/config.yml', owner:'root', content:'server:\n  bind_host: 0.0.0.0\n  bind_port: 8080\n  log_level: info\n' },
      { path:'/data/backups/db-20260814.tgz', size:14 * GB, owner:'root', ageDays:0 },
      { path:'/data/backups/db-20260813.tgz', size:14 * GB, owner:'root', ageDays:1 }
    ],
    procs:[
      { pid:8123, user:'appsvc', cmd:'/usr/local/bin/myapp --config /etc/myapp/config.yml', cpu:1.2, mem:8.0, unit:'myapp' },
      { pid:3301, user:'root', cmd:'/usr/sbin/rsyslogd -n', cpu:0.1, mem:0.4 },
      { pid:1201, user:'root', cmd:'/usr/sbin/sshd -D', cpu:0.0, mem:0.3 }
    ],
    sockets:[
      { addr:'0.0.0.0', port:8080, pid:8123, cmd:'myapp', user:'appsvc' },
      { addr:'0.0.0.0', port:22, pid:1201, cmd:'sshd', user:'root' }
    ],
    units:{ myapp:{ desc:'Demo API', active:true, enabled:true, pid:8123, log:['Aug 14 09:02:11 started'] },
            sshd:{ desc:'OpenSSH server daemon', active:true, enabled:true, pid:1201, log:[] } }
  },
  objectives:[]
});
