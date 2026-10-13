/* Plays every SRE simulated incident (S01–S32) headlessly, for every seeded
   variant, the way the sandbox does: same world(seed), same ctx shape, same
   objective and unsafe-shortcut checks after each command.

   For each scenario × variant:
     ladder   — the reveal of each unmet objective, in order, meets every
                objective and trips no unsafe check
     alt      — sre.alt(variant) (a different, valid repair) also meets every
                objective without a critical (required: 2+ paths per §8)
     verify   — running only the verify-stage reveals on the broken world meets
                no fix or verify objective ("checking first proves nothing")
     typed    — echoing every reveal as text meets nothing ("typed text is not
                evidence")
     unsafe   — each documented shortcut's demo trips its check; the attempt
                is then critical even if the ladder completes afterwards
     reset    — world(seed) twice yields identical state, before and after a
                full playthrough (no shared mutable fixtures between attempts)
     variants — different variants start from different states
     honest   — an unknown command says it is not supported, never "ok"

   Usage: node tests/data/test-sre-scenarios.js [S07]   V=1 for transcripts */
const H = require('../helpers');
H.loadContent({ shell: true });

const only = process.argv[2];
const SCEN = LX.missions.filter(m => m.track === 'sre' && m.sre);
let fails = 0, passes = 0;
function ok(cond, label, detail) { if (cond) { passes++; return; } fails++; console.log('FAIL ' + label + (detail ? '\n  ' + String(detail).slice(0, 600).replace(/\n/g, '\n  ') : '')); }

function play(m, seed) {
  const w = LXShell.createWorld(m.world(seed));
  const c = { w: w, ran: [], out: [], code: [], last: null };
  const met = {}, critical = [];
  function check() {
    (m.sre.unsafe || []).forEach(u => { if (critical.indexOf(u) !== -1) return; let hit = false; try { hit = !!u.test(c); } catch (e) {} if (hit) critical.push(u); });
    m.objectives.forEach(o => { if (met[o.id]) return; let p = false; try { p = !!o.done(c); } catch (e) { p = false; } if (p) met[o.id] = true; });
  }
  function cmd(line) {
    let r;
    try { r = LXShell.run(w, line); } catch (e) { r = { out: '', err: 'THREW ' + e.message, code: 1 }; }
    const text = (r.out || '') + (r.err || '');
    c.ran.push(line); c.out.push(text); c.code.push(r.code || 0); c.last = { cmd: line, out: text };
    if (process.env.V) console.log('$ ' + line + '\n' + text.replace(/\n$/, ''));
    check();
    return text;
  }
  const revealOf = o => typeof o.reveal === 'function' ? o.reveal(c) : o.reveal;
  return { w, c, met, critical, cmd, check, revealOf, all: () => m.objectives.every(o => met[o.id]), unmet: () => m.objectives.filter(o => !met[o.id]).map(o => o.id) };
}

/* deterministic snapshot of a world: files, dirs, and the scenario state */
function snap(w) {
  const seen = new WeakSet();
  return JSON.stringify({ fs: w.fs || w.root || null, files: w.files, sre: w.sre, units: w.units, procs: w.procs, k8s: w.k8sModel && w.k8sModel.state }, (k, v) => {
    if (typeof v === 'function') return undefined;
    if (v && typeof v === 'object') { if (seen.has(v)) return '[cycle]'; seen.add(v); }
    return v;
  });
}

SCEN.forEach(m => {
  const S = m.sre, sid = S.scenarioId;
  if (only && sid !== only && m.id !== only) return;
  const variants = S.variants || ['a'];
  const starts = {};
  variants.forEach(v => {
    const seed = sid + '-variant-' + v, tag = sid + '/' + v + ': ';

    /* ladder */
    const L = play(m, seed);
    m.objectives.forEach(o => { if (!L.met[o.id]) L.cmd(L.revealOf(o)); });
    L.check();
    ok(L.all(), tag + 'reveal ladder meets every objective', 'unmet: ' + L.unmet().join(', ') + '\n' + L.c.ran.map((r, i) => '$ ' + r + '\n' + L.c.out[i]).join('\n'));
    ok(!L.critical.length, tag + 'reveal ladder trips no unsafe check', L.critical.map(u => u.label).join('; '));

    /* alternative valid path */
    const alt = typeof S.alt === 'function' ? S.alt(v) : null;
    ok(Array.isArray(alt) && alt.length >= 2, tag + 'declares an alternative repair path (sre.alt)');
    if (Array.isArray(alt)) {
      const A = play(m, seed);
      alt.forEach(line => A.cmd(typeof line === 'function' ? line(A.c) : line));
      ok(A.all() && !A.critical.length, tag + 'alternative path meets every objective without a critical', 'unmet: ' + A.unmet().join(', ') + ' critical: ' + A.critical.map(u => u.label).join('; ') + '\n' + A.c.ran.map((r, i) => '$ ' + r + '\n' + A.c.out[i]).join('\n'));
      ok(alt.join('\n') !== m.objectives.map(o => typeof o.reveal === 'string' ? o.reveal : '').join('\n'), tag + 'alternative path is not the reveal ladder');
    }

    /* verify first proves nothing */
    const VF = play(m, seed);
    m.objectives.filter(o => o.stage === 'verify').forEach(o => VF.cmd(VF.revealOf(o)));
    const premature = m.objectives.filter(o => (o.stage === 'fix' || o.stage === 'verify') && VF.met[o.id]).map(o => o.id);
    ok(!premature.length, tag + 'running the verification first meets no fix/verify objective', premature.join(', '));

    /* typed text is not evidence */
    const T = play(m, seed);
    m.objectives.forEach(o => { const r = T.revealOf(o); T.cmd('echo ' + JSON.stringify(String(r))); T.cmd('# ' + r); });
    const typed = Object.keys(T.met);
    ok(!typed.length, tag + 'echoing the reveals meets nothing', typed.join(', '));

    /* unsafe shortcuts */
    (S.unsafe || []).forEach((u, i) => {
      ok(u.demo, tag + 'unsafe #' + (i + 1) + ' (' + u.label + ') has a demo command');
      if (!u.demo) return;
      const U = play(m, seed);
      const demo = typeof u.demo === 'function' ? u.demo(U.c, v) : u.demo;
      (Array.isArray(demo) ? demo : [demo]).forEach(line => U.cmd(line));
      ok(U.critical.indexOf(u) !== -1, tag + 'unsafe demo trips "' + u.label + '"', U.c.ran.map((r, j) => '$ ' + r + '\n' + U.c.out[j]).join('\n'));
    });

    /* reset is exact for the seed, and a playthrough does not leak into it */
    const a = snap(LXShell.createWorld(m.world(seed)));
    const b = snap(LXShell.createWorld(m.world(seed)));
    ok(a === b, tag + 'same seed builds the same world');
    ok(snap(LXShell.createWorld(m.world(seed))) === a, tag + 'a played attempt does not change the next reset');
    starts[v] = a;

    /* honest unsupported command */
    const X = play(m, seed);
    const unk = X.cmd('frobnicate --all');
    ok(/not (found|supported|modelled|available)|command not found|unsupported/i.test(unk) && X.c.code[0] !== 0, tag + 'unknown command is reported honestly', unk);
  });
  const distinct = new Set(Object.values(starts)).size;
  ok(distinct === variants.length, sid + ': each variant starts from a different state', distinct + ' distinct of ' + variants.length);
  ok(m.objectives.every(o => o.explain || S.mechanism), sid + ': fourth hint rung has text');
});

console.log((fails ? fails + ' failed, ' : '') + passes + ' scenario checks passed · ' + SCEN.length + ' scenarios');
process.exit(fails ? 1 : 0);
