#!/usr/bin/env node
/* Plays every hands-on scenario (assets/js/data/onsite-handson.js) against a
   real cluster, so the commands, expected output and PASS checks in the app are
   known to work rather than hoped to.

   You do not need this to do the scenarios. It exists for development.

     node labs/hands-on/validate.js                 all scenarios
     node labs/hands-on/validate.js ons-hands-04    one

   Safety: it only ever talks to the kind lab cluster. It copies that one
   context (kind-looped-onsite, from labs/kind) into a temporary kubeconfig and
   points KUBECONFIG at it, so the scenario commands — which, as written for
   you, do not name a context — cannot reach anything else. It refuses to run
   if that context is missing or its server is not a local address.

   Per task it runs `test` if present (a non-interactive or environment-neutral
   variant), otherwise `cmd`, and requires the output to match `re`. When the
   match needs time (a rollout, a crash loop), it re-runs only the read-only
   lines of the command until `wait` seconds pass — never a mutating line
   twice. Then the scenario's PASS check must print PASS, and cleanup runs. */
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CTX = 'kind-looped-onsite';
global.window = global; global.LX = {};
require(path.join(ROOT, 'assets/js/data/onsite-handson.js'));
const join = x => Array.isArray(x) ? x.join('\n') : (x || '');

/* ── pin to the lab cluster ─────────────────────────────────────── */
let kc;
try {
  kc = execFileSync('kubectl', ['config', 'view', '--minify', '--flatten', '--context', CTX], { encoding: 'utf8' });
} catch (e) { console.error('refusing: context ' + CTX + ' not found (run labs/kind/setup.sh first)'); process.exit(2); }
const server = (/server:\s*(\S+)/.exec(kc) || [])[1] || '';
if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0)(:\d+)?/.test(server)) {
  console.error('refusing: ' + CTX + ' points at ' + server + ', which is not a local address'); process.exit(2);
}
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'looped-hands-'));
const kubeconfig = path.join(work, 'kubeconfig');
fs.writeFileSync(kubeconfig, kc, { mode: 0o600 });
const ENV = Object.assign({}, process.env, { KUBECONFIG: kubeconfig });

function sh(cmd, timeoutSec) {
  const r = spawnSync('bash', ['-c', cmd], { cwd: work, env: ENV, encoding: 'utf8', timeout: (timeoutSec || 240) * 1000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
const READONLY = /^\s*(kubectl\s+(get|describe|logs|exec|top|explain|api-resources|config|rollout\s+(status|history)|wait)\b|curl\b|cat\b|echo\b|sleep\b|NODE_\w+=)/;
function readOnlyPart(cmd) {
  const lines = cmd.split('\n');
  /* heredocs are one unit; if the command has one, retry only what follows it */
  const eof = lines.lastIndexOf('EOF');
  const tail = eof >= 0 ? lines.slice(eof + 1) : lines;
  const ro = tail.filter(l => READONLY.test(l));
  return ro.length ? ro.join('\n') : null;
}
const sleep = s => spawnSync('sleep', [String(s)]);

const only = process.argv[2];
const results = [];
for (const s of LX.onsiteHands) {
  if (only && s.id !== only) continue;
  const res = { id: s.id, title: s.title, tasks: [], check: null, ok: true, started: new Date().toISOString() };
  console.log('\n=== ' + s.id + ' — ' + s.title);
  for (const c of (s.setup || [])) {
    const r = sh(join(c));
    if (r.code !== 0) { console.log('  setup failed: ' + join(c) + '\n' + r.out); res.ok = false; }
  }
  s.tasks.forEach(function (t, i) {
    const cmd = join(t.test || t.cmd);
    if (cmd === 'skip') { res.tasks.push({ i: i, skipped: true }); return; }
    const re = new RegExp(t.re || '.*', 'm');
    const t0 = Date.now();
    let r = sh(cmd), tries = 1;
    const retry = readOnlyPart(cmd);
    while (!re.test(r.out) && retry && (Date.now() - t0) / 1000 < (t.wait || 60)) {
      sleep(3); r = sh(retry); tries++;
    }
    const pass = re.test(r.out);
    const secs = Math.round((Date.now() - t0) / 1000);
    res.tasks.push({ i: i, pass: pass, tries: tries, secs: secs, used: t.test ? 'test' : 'cmd' });
    console.log('  ' + (pass ? 'ok  ' : 'FAIL') + ' ' + (i + 1) + '. ' + t.do.slice(0, 70) + (t.test ? '  [test variant]' : '') + '  (' + secs + 's, ' + tries + ' run' + (tries > 1 ? 's' : '') + ')');
    if (!pass) { res.ok = false; console.log('      wanted /' + t.re + '/, got:\n      ' + r.out.trim().split('\n').slice(-12).join('\n      ')); }
  });
  let chk = sh(join(s.check.cmd)), ctries = 1; const c0 = Date.now();
  while (!/^PASS/m.test(chk.out) && (Date.now() - c0) / 1000 < 90) { sleep(3); chk = sh(join(s.check.cmd)); ctries++; }
  res.check = { pass: /^PASS/m.test(chk.out), out: chk.out.trim(), tries: ctries };
  console.log('  check: ' + chk.out.trim());
  if (!res.check.pass) res.ok = false;
  const cl = sh(join(s.cleanup));
  res.cleanup = cl.code === 0;
  results.push(res);
}
const failed = results.filter(r => !r.ok);
fs.writeFileSync(path.join(work, 'results.json'), JSON.stringify(results, null, 1));
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' scenarios passed' + (failed.length ? ' — failed: ' + failed.map(r => r.id).join(', ') : '') + '\nresults: ' + path.join(work, 'results.json'));
process.exit(failed.length ? 1 : 0);
