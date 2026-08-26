const H = require('../helpers');
/* Objectives must require evidence. A fragment, a typo, or a command that
   errored must never tick a box. */
global.LXShell = require(H.repoFile('assets/js/shell.js'));
global.window = global;
global.LX = { commands: [], scenarios: [], drills: [], quiz: [], labs: [] };
require(H.repoFile('assets/js/data/missions.js'));

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
  ['m-slow', 'iostat',                           'device',    null]            // iostat does name nvme1n1
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
