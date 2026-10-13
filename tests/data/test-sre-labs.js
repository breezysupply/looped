/* Static checks on labs/sre-cloud-foundations: structure, syntax and the
   safety promises every lab makes (curriculum §5/§6).

   No cluster, no Docker, no VM. What was actually executed, and where, is in
   docs/sre-cloud-foundations/implementation-status.md — this suite never
   claims runtime validation.

   - every lab directory ships README, validate.py, reset.sh, teardown.sh,
     SOLUTION.md, VARIANT.md, hints.md, evidence-example.json (+ setup.sh)
   - bash -n on every script, py_compile on every Python file
   - every shell script sources lib/looped.sh and calls a require_* guard
     before mutating; no broad deletes (rm -rf /, docker system prune,
     kubectl delete --all without a lab namespace, kind delete without a
     looped-* name, unscoped volume removal)
   - validate.py uses labcheck, records checks with observations and calls
     finish(); it never prints a canned success
   - no hardcoded credentials, no :latest images, no DynamoDB-lock advice
   - evidence-example.json is labelled as an example and is importable */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const H = require('../helpers');

const ROOT = H.repoFile('labs', 'sre-cloud-foundations');
let fails = 0, passes = 0;
function ok(cond, label, detail) { if (cond) { passes++; return; } fails++; console.log('FAIL ' + label + (detail ? '\n  ' + String(detail).slice(0, 400) : '')); }
function walk(dir, out) { out = out || []; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) { if (e.name !== 'evidence' && e.name !== '__pycache__' && e.name !== '.terraform') walk(p, out); } else out.push(p); } return out; }
const rel = p => path.relative(H.ROOT, p);
const read = p => fs.readFileSync(p, 'utf8');

ok(fs.existsSync(ROOT), 'labs/sre-cloud-foundations exists');
['lib/labcheck.py', 'lib/looped.sh', 'beacon/beacon/api.py', 'beacon/beacon/worker.py', 'beacon/beacon/client.py', 'beacon/README.md', 'beacon/Dockerfile', 'beacon/tests/test_beacon.py', 'profiles/linux-arm64/README.md'].forEach(f => ok(fs.existsSync(path.join(ROOT, f)), f + ' present'));

const labDirs = fs.readdirSync(ROOT).filter(d => /^L\d\d$/.test(d)).sort();
const REQUIRED = ['README.md', 'validate.py', 'reset.sh', 'teardown.sh', 'SOLUTION.md', 'VARIANT.md', 'hints.md', 'evidence-example.json'];
const py = spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0;
if (!py) console.log('note: python3 not available; py_compile checks skipped (reported, not passed)');

labDirs.forEach(d => {
  const L = path.join(ROOT, d), w = d + ': ';
  REQUIRED.forEach(f => ok(fs.existsSync(path.join(L, f)), w + f + ' present'));
  const readme = fs.existsSync(path.join(L, 'README.md')) ? read(path.join(L, 'README.md')) : '';
  ok(/## Ticket|## Brief|## Objective/.test(readme) && /Limits|does not prove|Lab versus production/i.test(readme) && readme.length > 1500, w + 'README has ticket/objective, limits, and substance');
  ok(!/\bTODO\b|\bTBD\b/.test(readme), w + 'README has no TODO');
  const ex = path.join(L, 'evidence-example.json');
  if (fs.existsSync(ex)) {
    let j = null; try { j = JSON.parse(read(ex)); } catch (e) {}
    ok(j && j.note && /example/i.test(j.note) && j.activityId === d && Array.isArray(j.checks) && j.checks.length >= 2 && j.checks.every(c => typeof c.passed === 'boolean'), w + 'evidence example is labelled and well-formed');
  }
  const sol = fs.existsSync(path.join(L, 'SOLUTION.md')) ? read(path.join(L, 'SOLUTION.md')) : '';
  ok(sol.length > 400 && !/\bTODO\b/.test(sol), w + 'worked solution is substantive');
  const hints = fs.existsSync(path.join(L, 'hints.md')) ? read(path.join(L, 'hints.md')) : '';
  ok((hints.match(/^\s*[1-4]\.\s/mg) || []).length >= 4, w + 'four staged hints');
  const v = path.join(L, 'validate.py');
  if (fs.existsSync(v)) {
    const src = read(v);
    ok(/import labcheck as L|from labcheck import|import labcheck/.test(src), w + 'validate.py uses labcheck');
    ok((src.match(/\.check\(/g) || []).length >= 2 && /\.finish\(/.test(src), w + 'validate.py records checks and finishes with an exit code');
    ok(!/"passed":\s*true/.test(src) && !/passed=True/.test(src.replace(/critical=False/g, '')), w + 'validate.py has no hardcoded passing check');
  }
});

/* ── every script: syntax, guard, no broad deletes ───────────────── */
const files = walk(ROOT);
files.filter(f => f.endsWith('.sh')).forEach(f => {
  const r = spawnSync('bash', ['-n', f], { encoding: 'utf8' });
  ok(r.status === 0, 'bash -n ' + rel(f), r.stderr);
  const src = read(f);
  const isLib = /\/lib\/looped\.sh$/.test(f);
  if (!isLib && /\/L\d\d\//.test(f)) {
    ok(/\. "\$HERE\/\.\.\/lib\/looped\.sh"|looped\.sh/.test(src), rel(f) + ' sources lib/looped.sh');
    ok(/require_(linux_vm|kind_context|compose_project|terraform_dir|workstation)|preflight/.test(src), rel(f) + ' calls a scope guard');
  }
  /* rm -rf on a bare variable is allowed only in the ${VAR:?} form, which refuses to run when the variable is unset */
  ok(!/rm\s+-rf?\s+("?\$\{?[A-Z_]+\}?"?\/?(\s|$)|\/\s|\/\*|~|\$HOME)/.test(src.replace(/\$\{[A-Z_]+:\?[^}]*\}/g, 'SAFE')), rel(f) + ' no broad rm -rf (use "${VAR:?}" for scoped paths)');
  ok(!/docker\s+(system|volume|container|image)\s+prune/.test(src), rel(f) + ' no docker prune');
  ok(!/docker\s+rm\s+-f\s+\$\(docker\s+ps\s+-aq\)/.test(src), rel(f) + ' no delete-all-containers');
  ok(!/kubectl\s+delete\s+[^\n]*--all(?!-namespaces)[^\n]*$/m.test(src.split('\n').filter(l => !/-n\s+"?\$?\{?SRE_NS|--namespace|-l\s+"?\$?\{?SRE_LABEL|looped/.test(l)).join('\n')), rel(f) + ' kubectl delete --all is namespace/label scoped');
  (src.match(/kind\s+delete\s+cluster[^\n]*/g) || []).forEach(m => ok(/--name\s+"?\$\{?SRE_KIND_(BASIC|POLICY)\}?"?|--name\s+looped-/.test(m), rel(f) + ' kind delete names a looped-* cluster: ' + m));
  ok(!/(AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/.test(src), rel(f) + ' no credential');
});
files.filter(f => f.endsWith('.py')).forEach(f => {
  if (!py) return;
  const r = spawnSync('python3', ['-m', 'py_compile', f], { encoding: 'utf8' });
  ok(r.status === 0, 'py_compile ' + rel(f), r.stderr);
  const src = read(f);
  ok(!/os\.system\(|subprocess\.(run|call|Popen)\([^)]*shell\s*=\s*True/.test(src.replace(/#.*$/mg, '')), rel(f) + ' no shell=True');
  ok(!/(AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/.test(src), rel(f) + ' no credential');
});
files.filter(f => /\.(ya?ml|json|tf|hcl|toml|Dockerfile)$|Dockerfile$/.test(f) || /Dockerfile/.test(path.basename(f))).forEach(f => {
  const src = read(f);
  ok(!/:latest\b/.test(src), rel(f) + ' no :latest');
  ok(!/(AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/.test(src), rel(f) + ' no credential');
  ok(!/privileged:\s*true|hostPID:\s*true|hostNetwork:\s*true/.test(src) || /# allowed-for-lab/.test(src), rel(f) + ' no privileged/host namespaces');
});
files.filter(f => f.endsWith('.md')).forEach(f => {
  const src = read(f);
  ok(!/dynamodb[^\n]{0,60}(default|recommended) (for )?lock/i.test(src), rel(f) + ' no DynamoDB-default-lock advice');
});

/* beacon starter tests run (python) */
if (py) {
  const r = spawnSync('python3', ['-I', '-m', 'unittest', 'discover', '-s', 'tests', '-t', '.'], { cwd: path.join(ROOT, 'beacon'), encoding: 'utf8', timeout: 120000 });
  const ran = /Ran (\d+) tests?/.exec((r.stdout || '') + (r.stderr || ''));
  ok(r.status === 0 && ran && Number(ran[1]) >= 10, 'beacon starter: unit tests pass (' + (ran ? ran[1] : '?') + ')', (r.stdout || '') + (r.stderr || ''));
}

console.log((fails ? fails + ' failed, ' : '') + passes + ' lab asset checks passed · ' + labDirs.length + ' lab directories');
process.exit(fails ? 1 : 0);
