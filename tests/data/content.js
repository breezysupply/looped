/* The gate every future content phase has to pass.

   Checks the things that go wrong when a domain is added by someone who has not
   read the whole codebase: an unregistered track or category (which used to be
   silently dropped from every chip row), a duplicate or missing id, a cross-
   reference that points at nothing, a quiz item with no single right answer. */
const H = require('../helpers');
H.loadContent({ shell: true });
const D = global.LX;

let bad = 0;
const fail = (m) => { console.log('  ✗ ' + m); bad++; };

/* ── tracks and categories ──────────────────────────────────────────── */
const trackIds = D.track.ids();
console.log('tracks registered: ' + trackIds.join(', '));

const POOLS = {
  commands: D.commands, scenarios: D.scenarios, drills: D.drills, quiz: D.quiz,
  labs: D.labs, missions: D.missions, playbooks: D.playbooks,
  outputQs: D.outputQs, dangerQs: D.dangerQs
};

Object.keys(POOLS).forEach(function (pool) {
  (POOLS[pool] || []).forEach(function (x, i) {
    const where = pool + '[' + i + '] ' + (x.id || x.name || x.title || x.q || '').slice(0, 40);
    const tr = D.track.of(x);
    if (trackIds.indexOf(tr) === -1) fail(where + ': unknown track "' + tr + '"');
    if (x.cat && !D.track.byId(tr).cats[x.cat]) {
      fail(where + ': category "' + x.cat + '" is not registered for track "' + tr + '"');
    }
    if (x.level && ['beginner', 'intermediate', 'advanced'].indexOf(x.level) === -1) {
      fail(where + ': unknown level "' + x.level + '"');
    }
  });
});

/* ── ids unique within their pool ───────────────────────────────────── */
['labs', 'missions', 'playbooks'].forEach(function (pool) {
  const seen = {};
  (POOLS[pool] || []).forEach(function (x) {
    if (!x.id) { fail(pool + ': an entry has no id'); return; }
    if (seen[x.id]) fail(pool + ': duplicate id "' + x.id + '"');
    seen[x.id] = 1;
  });
});
const cmdNames = {};
D.commands.forEach(function (c) {
  if (cmdNames[c.name]) fail('commands: duplicate name "' + c.name + '"');
  cmdNames[c.name] = 1;
});

/* ── cross-references resolve ───────────────────────────────────────── */
const pbIds = D.playbooks.map(function (p) { return p.id; });
const labIds = (D.labs || []).map(function (l) { return l.id; });
const misIds = (D.missions || []).map(function (m) { return m.id; });

D.playbooks.forEach(function (pb) {
  (pb.steps || []).forEach(function (s, i) {
    (s.branches || []).forEach(function (b) {
      if (b.goto && pbIds.indexOf(b.goto) === -1) {
        fail(pb.id + '[' + i + ']: branch goto "' + b.goto + '" does not exist');
      }
    });
  });
  if (pb.mission && misIds.indexOf(pb.mission) === -1) {
    fail(pb.id + ': mission "' + pb.mission + '" does not exist');
  }
});
(D.missions || []).forEach(function (m) {
  if (m.labId && labIds.indexOf(m.labId) === -1) {
    fail(m.id + ': labId "' + m.labId + '" does not exist');
  }
});

/* ── sample outputs stay index-aligned with their tree ──────────────── */
Object.keys(D.pbOut || {}).forEach(function (id) {
  const pb = D.playbooks.filter(function (p) { return p.id === id; })[0];
  if (!pb) { fail('pbOut: no playbook "' + id + '"'); return; }
  if (D.pbOut[id].length !== pb.steps.length) {
    fail(id + ': ' + D.pbOut[id].length + ' samples for ' + pb.steps.length + ' steps');
  }
});

/* ── quiz items have exactly one correct answer ─────────────────────── */
(D.quiz || []).forEach(function (q, i) {
  if (!q.choices || q.choices.length < 2) fail('quiz[' + i + ']: needs at least two choices');
  else if (typeof q.a !== 'number' || q.a < 0 || q.a >= q.choices.length) {
    fail('quiz[' + i + ']: answer index ' + q.a + ' is outside its choices');
  }
});
(D.outputQs || []).forEach(function (q, i) {
  if (typeof q.a !== 'number' || !q.choices || q.a >= q.choices.length) {
    fail('outputQs[' + i + ']: answer index outside its choices');
  }
});
(D.dangerQs || []).forEach(function (q, i) {
  if (typeof q.a !== 'number' || !q.choices || q.a >= q.choices.length) {
    fail('dangerQs[' + i + ']: answer index outside its choices');
  }
});

/* ── every content file is both loaded and cached ───────────────────── */
const fs = require('fs');
const html = fs.readFileSync(H.repoFile('index.html'), 'utf8');
const sw = fs.readFileSync(H.repoFile('sw.js'), 'utf8');
const inHtml = [...html.matchAll(/src="(assets\/js\/[^"]+)"/g)].map(m => m[1]);
const inSw = [...sw.matchAll(/'\.\/(assets\/js\/[^']+)'/g)].map(m => m[1]);
inHtml.forEach(function (f) {
  if (inSw.indexOf(f) === -1) fail('offline: ' + f + ' is loaded but not in sw.js ASSETS');
  if (!fs.existsSync(H.repoFile(f))) fail('offline: ' + f + ' does not exist');
});
inSw.forEach(function (f) {
  if (inHtml.indexOf(f) === -1) fail('offline: ' + f + ' is cached but never loaded');
});

/* ── report ─────────────────────────────────────────────────────────── */
const counts = Object.keys(POOLS).map(function (k) {
  return k + ' ' + (POOLS[k] || []).length;
}).join(' · ');
console.log(counts);
trackIds.forEach(function (t) {
  const n = Object.keys(POOLS).reduce(function (a, k) {
    return a + (POOLS[k] || []).filter(function (x) { return D.track.of(x) === t; }).length;
  }, 0);
  console.log('  ' + t + ': ' + n + ' items');
});
console.log('\n' + (bad ? bad + ' problems' : 'content valid, 0 problems'));
process.exit(bad ? 1 : 0);
