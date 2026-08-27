const H = require('../helpers');
/* Objectives must require evidence. A fragment, a typo, or a command that
   errored must never tick a box. */
H.loadContent({ shell: true });

/* [mission, command typed, objective that must stay unmet, note] */
var CASES = [
  ['m-oom',  'systemctl cat',                    'heap',      'unit name missing (reported)'],
  ['m-oom',  'systemctl cat nosuchunit',         'heap',      'wrong unit'],
  ['m-oom',  'systemctl status',                 'signal',    'no unit'],
  ['m-oom',  'free',                             'memory',    null],           // legitimately meets it
  ['m-oom',  'echo daemon-reload',               'reload',    'talking about it is not doing it'],
  ['m-disk', 'find -size 100M+ /var/log',        'name',      'args reversed (reported)'],
  ['m-disk', 'find /var/log -size 100M+',        'name',      'malformed size'],
  ['m-disk', 'find /home -type f -size +100M',   'name',      'right command, wrong place'],
  ['m-disk', 'du',                               'localise',  'no path'],
  ['m-disk', 'echo logrotate',                   'rootcause', 'never opened the policy'],
  ['m-disk', 'df -h',                            'confirm',   'blocks only, no inodes'],
  ['m-nginx','nginx',                            'validate',  'no -t'],
  ['m-nginx','journalctl -u nosuch',             'log',       'wrong unit, empty journal'],
  ['m-nginx','diff',                             'diff',      'no operands'],
  ['m-bind', 'ss',                               'socket',    null],           // ss alone does show :8080
  ['m-bind', 'grep bind /etc/nginx/nginx.conf',  'config',    'wrong file'],
  ['m-ssh',  'ssh',                              'reproduce', 'no target'],
  ['m-ssh',  'ssh nowhere.example',              'reproduce', 'unresolvable host'],
  ['m-ssh',  'ls /home/ec2-user/.ssh',           'inspect',   'contents, not the directory entry'],
  ['m-slow', 'pidstat',                          'culprit',   'no -d, no I/O breakdown'],
  ['m-slow', 'uptime',                           'pressure',  'load without the core count'],
  ['m-slow', 'iostat',                           'device',    null],           // iostat does name nvme1n1

  /* containers */
  ['cn-m-svc',       'kubectl get pods',                    'endpoints', 'listing pods is not checking endpoints'],
  ['cn-m-svc',       'kubectl get endpoints',               'endpoints', null],
  ['cn-m-svc',       'kubectl label pod api-6c8b9f-2k4mz app=api', 'fix', 'no --overwrite, so nothing changed'],
  ['cn-m-svc',       'kubectl get pods',                    'labels',    'no --show-labels, so no labels shown'],
  ['cn-m-crashloop', 'kubectl logs worker-59d4c-hb2vt',     'prev',      'without --previous it is the wrong container'],
  ['cn-m-crashloop', 'kubectl get pods',                    'how',       'the exit code is in describe, not get'],
  ['cn-m-crashloop', 'kubectl set resources deploy/worker --limits=memory=300Mi', 'fix', 'still below what it needs'],
  ['cn-m-crashloop', 'kubectl set resources deploy/nosuch --limits=memory=512Mi', 'fix', 'wrong deployment'],
  ['cn-m-pending',   'kubectl describe pod reindex-4t7bn',  'taint',     'that is the pod, not the node'],
  ['cn-m-pending',   'kubectl taint node ip-10-0-3-4 wrong=key:NoSchedule-', 'fix', 'removing a taint that is not there'],
  ['cn-m-imagepull', 'kubectl set image deploy/checkout checkout=checkout:2.7.9', 'fix', 'another tag that does not exist'],
  ['cn-m-imagepull', 'kubectl get pods',                    'reason',    'the registry error is in describe'],
  ['cn-m-dns',       'kubectl exec -n payments ledger-8b6c4-r9wzt -- env', 'reproduce', 'ran a command, but not a lookup'],
  ['cn-m-dns',       'echo done > cause.txt',               'name',      'a note that names nothing']
];

var fails = 0, checked = 0;
CASES.forEach(function (t) {
  var mid = t[0], line = t[1], oid = t[2], note = t[3];
  var m = LX.missions.filter(function (x) { return x.id === mid; })[0];
  var o = m.objectives.filter(function (x) { return x.id === oid; })[0];
  if (!o) { console.log('?? no objective ' + mid + '/' + oid); fails++; return; }
  var w = LXShell.createWorld(m.world);
  var ctx = { w: w, ran: [], out: [], code: [], last: null };
  var r;
  try { r = LXShell.run(w, line); } catch (e) { r = { out:'', err:'THREW ' + e.message, code:1 }; }
  ctx.ran.push(line);
  ctx.out.push((r.out || '') + (r.err || ''));
  ctx.code.push(r.code || 0);
  ctx.last = { cmd: line, out: ctx.out[0] };
  var met = false;
  try { met = !!o.done(ctx); } catch (e) { met = 'threw: ' + e.message; }
  if (note === null) {
    checked++;
    console.log((met === true ? 'ok   ' : 'HUH  ') + mid + '/' + oid +
      '  "' + line + '" -> ' + met + '   (expected to count)');
    if (met !== true) fails++;
  } else {
    checked++;
    console.log((met === false ? 'ok   ' : 'FAIL ') + mid + '/' + oid +
      '  "' + line + '" -> ' + met + '   ' + note);
    if (met !== false) fails++;
  }
});
console.log('\n' + checked + ' cases, ' + fails + ' wrong');
process.exit(fails ? 1 : 0);
