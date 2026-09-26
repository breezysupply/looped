/* The real kind labs (labs/kind) and their catalogue (LX.onsiteReal).
   Static checks only: no cluster, no Docker. It checks the safety rules the
   labs promise — every kubectl call pinned to the lab context, no privileged
   or host-level manifests, images pinned by digest, teardown and preflight
   refusing anything but the lab cluster — plus structure, the catalogue's
   1:1 mapping to lab directories, and that the learner-facing READMEs do not
   give away the scripted fixes. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const KIND = path.join(ROOT, 'labs', 'kind');

let fails = 0, passes = 0;
function ok(cond, label, detail) {
  if (cond) { passes++; return; }
  fails++;
  console.log('FAIL ' + label + (detail ? '\n  ' + String(detail).split('\n').slice(0, 12).join('\n  ') : ''));
}

function walk(dir, out) {
  out = out || [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const rel = p => path.relative(ROOT, p);
const read = p => fs.readFileSync(p, 'utf8');

const LAB_NAMES = ['01-reconcile', '02-image-rollout', '03-service-selector', '04-probes', '05-pending',
  '06-crashloop', '07-oom-vs-kill', '08-pvc', '09-rbac', '10-disconnected'];

ok(fs.existsSync(KIND), 'labs/kind exists');
const files = walk(KIND);
const shFiles = files.filter(f => f.endsWith('.sh'));
const yamlFiles = files.filter(f => /\.ya?ml$/.test(f));
const mdFiles = files.filter(f => f.endsWith('.md'));
const labDirs = fs.readdirSync(KIND).filter(d => /^\d\d-/.test(d)).sort();

/* ── structure ─────────────────────────────────────────────────────── */
ok(JSON.stringify(labDirs) === JSON.stringify(LAB_NAMES), 'exactly the ten lab directories', labDirs.join(' '));
for (const f of ['README.md', 'kind-config.yaml', 'lib/common.sh', 'lib/preflight.sh', 'setup.sh', 'reset.sh',
  'teardown.sh', 'EXECUTION.md', 'harness/run-lab.sh']) {
  ok(fs.existsSync(path.join(KIND, f)), 'labs/kind/' + f + ' exists');
}
for (const d of labDirs) {
  const L = path.join(KIND, d);
  for (const f of ['README.md', 'inject.sh', 'verify.sh', 'SOLUTION.md', 'solution/solve.sh']) {
    ok(fs.existsSync(path.join(L, f)), d + '/' + f + ' exists');
  }
  const man = path.join(L, 'manifests');
  ok(fs.existsSync(man) && fs.readdirSync(man).some(f => f.endsWith('.yaml')), d + '/manifests/ has YAML');
  const id = d.slice(0, 2);
  if (fs.existsSync(path.join(L, 'inject.sh'))) {
    const inj = read(path.join(L, 'inject.sh'));
    ok(/^preflight\b/m.test(inj), d + '/inject.sh runs preflight');
    ok(new RegExp('reset_lab ' + id + '\\b').test(inj), d + '/inject.sh resets its own lab (' + id + ') first');
  }
  if (fs.existsSync(path.join(L, 'verify.sh'))) {
    const v = read(path.join(L, 'verify.sh'));
    ok(/^preflight\b/m.test(v) && /\breport "/.test(v), d + '/verify.sh runs preflight and reports PASS/FAIL');
  }
  for (const y of walk(L).filter(f => f.endsWith('.yaml'))) {
    ok(new RegExp('looped\\.lab/id: "' + id + '"').test(read(y)), rel(y) + ' labels its objects looped.lab/id: "' + id + '"');
  }
}
for (const f of shFiles.filter(f => !f.endsWith('harness.sh') && !f.endsWith('common.sh'))) {
  ok((fs.statSync(f).mode & 0o111) !== 0, rel(f) + ' is executable');
}

/* ── bash -n on every script ───────────────────────────────────────── */
for (const f of shFiles) {
  const r = spawnSync('bash', ['-n', f], { encoding: 'utf8' });
  ok(r.status === 0, 'bash -n ' + rel(f), r.stderr);
}

/* ── every script sources the shared library ───────────────────────── */
for (const f of shFiles) {
  const s = read(f), base = path.basename(f);
  if (f === path.join(KIND, 'lib', 'common.sh')) continue;
  if (base === 'harness.sh') {
    ok(/Sourced by harness\/run-lab\.sh/.test(s), rel(f) + ' says it is sourced by the harness (uses its common.sh)');
    continue;
  }
  ok(/^\.\s+".*\/common\.sh"\s*$/m.test(s) || /lib\/preflight\.sh/.test(s),
    rel(f) + ' sources lib/common.sh (or runs lib/preflight.sh)');
}

/* ── no kubectl call without --context ─────────────────────────────── */
function stripQuoted(line) {
  return line.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'[^']*'/g, "''");
}
for (const f of shFiles) {
  read(f).split('\n').forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const code = stripQuoted(t).replace(/\s#.*$/, '').replace(/command -v kubectl/g, '');
    if (/(^|[\s;&|({`$])kubectl\s/.test(code)) {
      ok(/--context\s+("\$CTX"|\$CTX|kind-looped-onsite)/.test(t), rel(f) + ':' + (i + 1) + ' kubectl call passes --context', t);
    }
    /* a kubectl command inside a string (sh -c, printed hint) must be pinned too */
    const inStr = t.match(/["']kubectl\s[^"']*/g) || [];
    inStr.forEach(sv => {
      if (/^["']kubectl\s+(not|context|\d)/.test(sv)) return; /* prose: "kubectl not found", "kubectl 1.x vs" */
      ok(/--context/.test(sv), rel(f) + ':' + (i + 1) + ' kubectl in a string passes --context', t);
    });
  });
}
const common = read(path.join(KIND, 'lib', 'common.sh'));
ok(/^k\(\)\s*\{\s*kubectl --context "\$CTX" -n "\$NS" "\$@";\s*\}/m.test(common), 'common.sh defines k() with --context and -n');
ok(/^readonly CTX="kind-looped-onsite"/m.test(common) && /^readonly CLUSTER="looped-onsite"/m.test(common) &&
   /^readonly NS="looped-lab"/m.test(common), 'cluster, context and namespace are readonly constants');

/* code blocks in the docs: kubectl lines are pinned to the lab context */
for (const f of mdFiles) {
  let inCode = false;
  read(f).split('\n').forEach((line, i) => {
    if (/^\s*```/.test(line)) { inCode = !inCode; return; }
    if (inCode && /^\s*kubectl\s/.test(line)) {
      ok(/--context kind-looped-onsite/.test(line), rel(f) + ':' + (i + 1) + ' documented kubectl command passes --context', line);
    }
  });
}

/* ── manifests: nothing privileged or host-level; images pinned ────── */
const FORBIDDEN = [[/hostPath/, 'hostPath'], [/privileged:\s*true/, 'privileged: true'], [/hostNetwork/, 'hostNetwork'],
  [/hostPID/, 'hostPID'], [/hostIPC/, 'hostIPC'], [/cluster-admin/, 'cluster-admin'], [/capabilities:[^\n]*add\s*:/, 'added capabilities'],
  [/^\s*add:\s*\[/m, 'added capabilities'], [/kind:\s*ClusterRoleBinding/, 'ClusterRoleBinding'], [/extraMounts/, 'extraMounts']];
const scanFiles = yamlFiles.concat(shFiles);
for (const f of scanFiles) {
  const body = read(f).split('\n').filter(l => !l.trim().startsWith('#')).join('\n');
  for (const [re, what] of FORBIDDEN) ok(!re.test(body), rel(f) + ' contains no ' + what);
}
let faults = 0, images = 0;
for (const f of yamlFiles) {
  read(f).split('\n').forEach((line, i) => {
    const m = line.match(/^\s*(?:-\s*)?image:\s*(\S+)/);
    if (!m) return;
    images++;
    if (/#\s*lab-fault:/.test(line)) { faults++; return; }
    ok(/@sha256:[0-9a-f]{64}$/.test(m[1]), rel(f) + ':' + (i + 1) + ' image pinned by @sha256 digest', line.trim());
  });
}
ok(images >= 12, 'found the lab image references', images);
ok(faults === 2, 'exactly two deliberate unpullable images (labs 02 and 10), marked # lab-fault:', faults);
for (const m of common.matchAll(/^readonly \w+_IMAGE="([^"]+)"/gm)) {
  ok(/@sha256:[0-9a-f]{64}$/.test(m[1]), 'common.sh image constant pinned: ' + m[1]);
}
const kindCfg = read(path.join(KIND, 'kind-config.yaml'));
ok(/kindest\/node:v1\.37\.0@sha256:a1ed56cfb0e7b93589bdf97c8cd566405a265939e3620fc4f5de89adff580ae5/.test(kindCfg),
  'kind-config.yaml pins the node image digest kind v0.33.0 uses');
ok(/^name: looped-onsite$/m.test(kindCfg) && /pool: general/.test(kindCfg), 'kind-config names the cluster and labels the worker');
ok(!/failCgroupV1|kubeadmConfigPatches|oomclamp/.test(kindCfg), 'kind-config.yaml carries no harness-only workaround');

/* harness-only knobs stay in harness/ */
for (const f of shFiles.filter(f => !f.includes(path.sep + 'harness' + path.sep))) {
  ok(!/LOOPED_HARNESS|oomclamp|failCgroupV1/.test(read(f)), rel(f) + ' does not read harness-only settings');
}

/* ── READMEs do not give away the scripted fix ─────────────────────── */
function fixKeys(solve) {
  const keys = [];
  solve.split('\n').forEach(line => {
    const t = line.trim();
    if (t.startsWith('#')) return;
    let m = t.match(/^(?:k|kc)\s+(.*)$/);
    let rest = null;
    if (m) rest = m[1];
    else if ((m = t.match(/^(docker\s+tag|kind\s+load)\s+(.*)$/))) rest = m[1] + ' ' + m[2];
    if (!rest) return;
    if (/^(get|wait|logs|describe)\b/.test(rest)) return;
    const toks = rest.replace(/["']/g, '').split(/\s+/).filter(Boolean);
    keys.push(toks.slice(0, 3).join(' '));
    const js = t.match(/-p\s+'([^']{12,})'/); /* the patch body itself */
    if (js) keys.push(js[1].slice(0, 40));
    const file = t.match(/\$SOL_DIR\/([\w.-]+\.yaml)/);
    if (file) keys.push('solution/' + file[1]);
  });
  return keys;
}
const solveKeys = {};
for (const d of labDirs) {
  const sp = path.join(KIND, d, 'solution', 'solve.sh');
  if (!fs.existsSync(sp)) continue;
  const keys = fixKeys(read(sp));
  solveKeys[d] = keys;
  ok(keys.length > 0, d + ': solve.sh has recognisable fix lines');
  const readme = read(path.join(KIND, d, 'README.md'));
  keys.forEach(k => ok(!readme.includes(k), d + '/README.md does not contain the fix "' + k + '"'));
  ok(/SOLUTION\.md/.test(readme), d + '/README.md points to SOLUTION.md for after the lab');
  ok(/## References/.test(readme) && /## Lab vs production/.test(readme) && /simulated or simplified/i.test(readme),
    d + '/README.md has the required sections');
  ok(new RegExp('ons-lab-' + d.slice(0, 2)).test(readme) && /les-/.test(readme), d + '/README.md names its sim lab and lessons');
}

/* reference URLs: official docs only */
for (const f of mdFiles) {
  for (const m of read(f).matchAll(/\]\((https?:[^)\s]+)\)/g)) {
    ok(/^https:\/\/(kubernetes\.io|kind\.sigs\.k8s\.io)\//.test(m[1]), rel(f) + ' links only to kubernetes.io / kind.sigs.k8s.io', m[1]);
  }
}

/* ── the catalogue: LX.onsiteReal ──────────────────────────────────── */
global.window = global; global.LX = {};
const dataFile = path.join(ROOT, 'assets', 'js', 'data', 'onsite-reallabs.js');
ok(fs.existsSync(dataFile), 'assets/js/data/onsite-reallabs.js exists');
if (fs.existsSync(dataFile)) require(dataFile);
const real = (global.LX && global.LX.onsiteReal) || [];
const simSrc = read(path.join(ROOT, 'assets', 'js', 'data', 'onsite-labs.js'));
const simIds = new Set([...simSrc.matchAll(/id:\s*'(ons-lab-\d\d)'/g)].map(m => m[1]));
const execMd = fs.existsSync(path.join(KIND, 'EXECUTION.md')) ? read(path.join(KIND, 'EXECUTION.md')) : '';
ok(real.length === 10, 'LX.onsiteReal has 10 entries', real.length);
real.forEach((r, i) => {
  const nn = String(i + 1).padStart(2, '0'), d = LAB_NAMES[i];
  const tag = r.id || ('#' + i);
  ok(r.id === 'ons-real-' + nn, tag + ': id in lab order');
  ok(r.track === 'onsite', tag + ': track onsite');
  ok(r.sim === 'ons-lab-' + nn && simIds.has(r.sim), tag + ': sim id exists and mirrors ons-lab-' + nn, r.sim);
  ok(r.dir === 'labs/kind/' + d && fs.existsSync(path.join(ROOT, r.dir)), tag + ': dir maps to ' + d, r.dir);
  ok(r.verify === r.dir + '/verify.sh', tag + ': verify path');
  ok(typeof r.title === 'string' && r.title.length > 10 && typeof r.objective === 'string' && r.objective.length > 20, tag + ': title and objective');
  ok(typeof r.simulated === 'string', tag + ': simulated is a string');
  ok(typeof r.mins === 'number' && /^P[0-3]$/.test(r.priority), tag + ': mins and priority');
  ok(Array.isArray(r.steps) && r.steps.length >= 4 && r.steps.every(s => s.t && s.cmd), tag + ': steps have t and cmd');
  const cmds = (r.steps || []).map(s => s.cmd).join('\n');
  ok(cmds.includes(r.dir + '/inject.sh') && cmds.includes(r.verify) && /reset\.sh/.test(cmds), tag + ': steps cover inject, verify, reset');
  cmds.split('\n').filter(l => /(^|\s)kubectl\s/.test(l)).forEach(l =>
    ok(/--context kind-looped-onsite/.test(l), tag + ': step kubectl passes --context', l));
  (solveKeys[d] || []).forEach(k => ok(!cmds.includes(k), tag + ': steps do not contain the fix "' + k + '"'));
  ok(Array.isArray(r.expected) && r.expected.length > 0 && Array.isArray(r.timing), tag + ': expected and timing');
  ok(typeof r.production === 'string' && r.production.length > 20, tag + ': production note');
  ok(Array.isArray(r.lessons) && r.lessons.length > 0 && r.lessons.every(l => /^les-[a-z-]+$/.test(l)), tag + ': lesson ids');
  ok(Array.isArray(r.refs) && r.refs.length > 0 && r.refs.every(x => x.t && /^https:\/\/(kubernetes\.io|kind\.sigs\.k8s\.io)\//.test(x.u)), tag + ': refs official only');
  const ex = r.executed || {};
  ok(ex.status === 'executed' || ex.status === 'not-executed', tag + ': executed.status');
  ok(typeof ex.where === 'string' && typeof ex.note === 'string' && ex.note.length > 10, tag + ': executed.where and note');
  const row = execMd.match(new RegExp('^\\|\\s*' + d + '\\s*\\|\\s*(executed|not-executed)\\s*\\|', 'm'));
  ok(row && row[1] === ex.status, tag + ': executed.status matches the EXECUTION.md summary table', row ? row[1] : 'no row');
});

/* ── EXECUTION.md ─────────────────────────────────────────────────── */
ok(execMd.length > 0, 'EXECUTION.md exists');
LAB_NAMES.forEach(d => ok(execMd.includes(d), 'EXECUTION.md mentions ' + d));
ok(/Apple Silicon/.test(execMd) && /not executed on Apple Silicon|Nothing was executed on Apple Silicon/i.test(execMd),
  'EXECUTION.md states nothing ran on Apple Silicon');

/* ── teardown refuses anything but the lab cluster ─────────────────── */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'looped-kind-test-'));
const fakeBin = path.join(tmp, 'bin'), marker = path.join(tmp, 'kind-was-called');
fs.mkdirSync(fakeBin);
fs.writeFileSync(path.join(fakeBin, 'kind'), '#!/bin/sh\necho "$@" >> "' + marker + '"\nexit 0\n', { mode: 0o755 });
const envFake = Object.assign({}, process.env, { PATH: fakeBin + path.delimiter + process.env.PATH });
let r = spawnSync('bash', [path.join(KIND, 'teardown.sh'), 'some-other-cluster'], { encoding: 'utf8', env: envFake });
ok(r.status !== 0 && /REFUSED/.test(r.stderr), 'teardown.sh refuses a cluster name argument', r.stdout + r.stderr);
r = spawnSync('bash', [path.join(KIND, 'teardown.sh'), '--name', 'prod'], { encoding: 'utf8', env: envFake });
ok(r.status !== 0, 'teardown.sh refuses --name', r.stdout + r.stderr);
r = spawnSync('bash', [path.join(KIND, 'teardown.sh'), '--dry-run'], { encoding: 'utf8', env: envFake });
ok(r.status === 0 && /kind delete cluster --name looped-onsite/.test(r.stdout), 'teardown.sh --dry-run names only looped-onsite', r.stdout + r.stderr);
ok(!fs.existsSync(marker), 'teardown.sh never called kind while refusing or in dry-run');

/* ── preflight --context-only refuses a non-local or missing context ─ */
function kubeconfig(server) {
  return 'apiVersion: v1\nkind: Config\nclusters:\n- name: c\n  cluster:\n    server: ' + server +
    '\ncontexts:\n- name: kind-looped-onsite\n  context:\n    cluster: c\n    user: u\n' +
    '- name: something-else\n  context:\n    cluster: c\n    user: u\ncurrent-context: something-else\nusers:\n- name: u\n  user:\n    token: fake\n';
}
const kcRemote = path.join(tmp, 'remote.yaml'), kcLocal = path.join(tmp, 'local.yaml'), kcNone = path.join(tmp, 'none.yaml');
fs.writeFileSync(kcRemote, kubeconfig('https://203.0.113.10:6443'));
fs.writeFileSync(kcLocal, kubeconfig('https://127.0.0.1:6443'));
fs.writeFileSync(kcNone, 'apiVersion: v1\nkind: Config\nclusters: []\ncontexts: []\nusers: []\n');
const haveKubectl = spawnSync('bash', ['-c', 'command -v kubectl'], { encoding: 'utf8' }).status === 0;
const pf = (kc) => spawnSync('bash', [path.join(KIND, 'lib', 'preflight.sh'), '--context-only'],
  { encoding: 'utf8', env: Object.assign({}, process.env, { KUBECONFIG: kc }) });
r = pf(kcRemote);
ok(r.status !== 0, 'preflight --context-only refuses a remote API server', r.stdout + r.stderr);
if (haveKubectl) {
  ok(/not a local address/.test(r.stderr), 'preflight explains the remote-server refusal', r.stderr);
  r = pf(kcNone);
  ok(r.status !== 0 && /not found/.test(r.stderr), 'preflight --context-only refuses a missing context', r.stdout + r.stderr);
  r = pf(kcLocal);
  ok(r.status === 0, 'preflight --context-only accepts a local API server', r.stdout + r.stderr);
} else {
  ok(/kubectl not found/.test(r.stderr), 'without kubectl, preflight refuses and says why', r.stderr);
  console.log('note: kubectl not on PATH; context-check assertions ran in refusal-only mode');
}
r = spawnSync('bash', [path.join(KIND, 'lib', 'preflight.sh'), '--bogus'], { encoding: 'utf8' });
ok(r.status !== 0, 'preflight rejects unknown options');
fs.rmSync(tmp, { recursive: true, force: true });

console.log((fails ? fails + ' failed, ' : '') + passes + ' kind lab asset checks passed');
process.exit(fails ? 1 : 0);
