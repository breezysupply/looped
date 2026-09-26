/* The Python exercises in labs/python: each suite must pass against its
   reference solution and fail against every deliberately broken variant —
   proof the tests check behaviour rather than mirror one implementation.
   The starter must fail cleanly (NotImplementedError), not on import.

   Needs python3 on PATH. Without it this reports SKIPPED and exits 0, and
   says so plainly rather than claiming a pass. */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const H = require('../helpers');

const ROOT = H.repoFile('labs', 'python');
const py = spawnSync('python3', ['--version'], { encoding: 'utf8' });
if (py.status !== 0) {
  console.log('SKIPPED: python3 is not available, so the Python exercises were not run');
  process.exit(0);
}

let fails = 0, passes = 0;
function ok(cond, label, detail) {
  if (cond) { passes++; return; }
  fails++;
  console.log('FAIL ' + label + (detail ? '\n  ' + String(detail).split('\n').slice(-12).join('\n  ') : ''));
}
function run(dir, impl) {
  const env = Object.assign({}, process.env, { PYTHONPATH: impl, PYTHONDONTWRITEBYTECODE: '1' });
  const r = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', 'tests', '-t', '.'],
                      { cwd: dir, env: env, encoding: 'utf8', timeout: 120000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

const exercises = fs.readdirSync(ROOT).filter(d => /^\d\d-/.test(d)).sort();
ok(exercises.length >= 3, 'at least three exercises', exercises.join(', '));
exercises.forEach(function (ex) {
  const dir = path.join(ROOT, ex);
  ['README.md', 'solution', 'broken', 'tests'].forEach(function (f) {
    ok(fs.existsSync(path.join(dir, f)), ex + ': has ' + f);
  });
  const sol = run(dir, 'solution');
  const ran = /Ran (\d+) tests?/.exec(sol.out);
  ok(sol.code === 0 && /\bOK\b/.test(sol.out), ex + ': tests pass against the reference solution', sol.out);
  ok(ran && Number(ran[1]) >= 10, ex + ': at least ten tests', ran && ran[0]);
  const starter = run(dir, '.');
  ok(starter.code !== 0 && /NotImplementedError/.test(starter.out) && !/ModuleNotFoundError|ImportError/.test(starter.out),
     ex + ': the starter fails on NotImplementedError, not on import', starter.out);
  const broken = fs.readdirSync(path.join(dir, 'broken')).sort();
  ok(broken.length >= 2, ex + ': at least two broken variants');
  broken.forEach(function (b) {
    const r = run(dir, path.join('broken', b));
    ok(r.code !== 0 && /FAILED/.test(r.out), ex + ': tests catch broken/' + b, r.out);
  });
  console.log('     ' + ex + ': solution ' + (ran ? ran[1] : '?') + ' tests OK; ' + broken.length + ' broken variants caught');
});

/* the in-app copy of each solution is the file on disk, byte for byte */
global.window = global; global.LX = global.LX || {};
require(H.repoFile('assets/js/data/onsite-scripting.js'));
(LX.onsiteScripting || []).forEach(function (x) {
  const dir = H.repoFile(x.dir);
  const mod = fs.readdirSync(path.join(dir, 'solution')).filter(f => f.endsWith('.py'))[0];
  ok(mod && fs.readFileSync(path.join(dir, 'solution', mod), 'utf8') === x.solution, x.id + ': in-app solution matches ' + x.dir + '/solution/' + mod);
});

console.log((fails ? fails + ' failed, ' : '') + passes + ' python exercise checks passed');
process.exit(fails ? 1 : 0);
