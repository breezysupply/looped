/* The SRE & Cloud Deployment Foundations content contract.

   Schema and referential integrity for every entity the track ships: the
   track record, 16 modules summing to 168 hours over 48 weeks, objectives,
   77 lessons, question banks (8+ bank items and distinct gate variants per
   module), L01–L32 lab specs, S01–S32 scenario missions, D01–D06 designs,
   the 24-question diagnostic, review prompts, B01–B08 and C01–C05, sources
   and roles. No module may reference a missing lab, scenario, lesson,
   objective, source or prerequisite; the prerequisite graphs are acyclic;
   nothing is empty or a TODO.

   Scenario behaviour (solvable, wrong fix rejected, unsafe shortcut fails,
   reset exact) is tested separately in test-sre-scenarios.js. */
const H = require('../helpers');
H.loadContent({ shell: true });
require(H.repoFile('assets/js/sre-sim.js'));
const D = global.LX;

let fails = 0, passes = 0;
function ok(cond, label, detail) {
  if (cond) { passes++; return; }
  fails++;
  console.log('FAIL ' + label + (detail ? '\n  ' + String(detail).slice(0, 500) : ''));
}
const str = (x, min) => typeof x === 'string' && x.trim().length >= (min || 1) && !/\bTODO\b|\bTBD\b|lorem ipsum/i.test(x);
const arr = (x, lo, hi) => Array.isArray(x) && x.length >= lo && x.length <= (hi || 1e9);
const ids = (list) => (list || []).map(x => x.id);
const uniq = (list) => new Set(list).size === list.length;

const T = D.sreTrack, MODS = D.sreModules || [], OBJ = D.sreObjectives || [], LES = D.sreLessons || [], Q = D.sreQuestions || [];
const LABS = D.sreLabs || [], DES = D.sreDesigns || [], WEEKS = D.sreWeeks || [], SRC = D.sreSources || [], ROLES = D.sreRoles || [];
const REV = D.sreReviews || [], BR = D.sreBranches || [], CL = D.sreCloud || [], DIAG = D.sreDiagnostic;
const SCEN = (D.missions || []).filter(m => m.sre && m.track === 'sre');
const modIds = ids(MODS), objIds = ids(OBJ), lesIds = ids(LES), labIds = ids(LABS), desIds = ids(DES), srcIds = ids(SRC);
const scenIds = SCEN.map(m => m.sre.scenarioId);
const range = (p, n) => { const out = []; for (let i = 1; i <= n; i++) out.push(p + (i < 10 ? '0' + i : i)); return out; };

/* ── track ─────────────────────────────────────────────────────── */
ok(T && T.id === 'sre-cloud-foundations' && T.trackId === 'sre' && str(T.version), 'track record present and versioned');
ok(T && T.hours === 168 && T.weeks === 48, 'track declares 168 hours over 48 weeks');
ok(T && arr(T.reviewDays, 4, 4) && T.reviewDays.join() === '1,7,21,45', 'review schedule 1/7/21/45');
ok(T && T.pass && T.pass.knowledgePct === 80 && T.pass.explanationMin === 3, 'pass rules: 80% knowledge, explanation 3/4');
ok(T && arr(T.debrief, 5, 5) && arr(T.rubric, 5, 5), 'five-part debrief and five rubric dimensions');

/* ── modules, hours, weeks ─────────────────────────────────────── */
ok(MODS.length === 16 && modIds.join() === range('M', 16).join(), 'sixteen modules M01–M16 in order', modIds.join());
const hours = MODS.reduce((a, m) => a + m.hours, 0);
ok(Math.abs(hours - 168) < 1e-9, 'module hours sum to 168', hours);
ok(WEEKS.length === 48 && WEEKS.every((w, i) => w.n === i + 1), 'exactly 48 weeks numbered 1..48', WEEKS.length);
const weekSet = new Set();
MODS.forEach(m => {
  const w = m.id + ': ';
  ok(str(m.title) && str(m.why, 200) && arr(m.outcomes, 3) && arr(m.concepts, 3) && str(m.debriefPrompt, 40), w + 'title, why (200+ chars), outcomes, concepts, debrief prompt');
  ok(arr(m.weeks, 1) && m.weeks.every(n => n >= 1 && n <= 48), w + 'weeks in range');
  m.weeks.forEach(n => { ok(!weekSet.has(n), w + 'week ' + n + ' not claimed twice'); weekSet.add(n); });
  ok(WEEKS.filter(x => x.moduleId === m.id).map(x => x.n).join() === m.weeks.join(), w + 'week rows match module.weeks');
  const n = m.lessons.length;
  ok((m.id === 'M01' || m.id === 'M16') ? n >= 3 && n <= 6 : n >= 4 && n <= 6, w + 'four to six lessons (three allowed for M01/M16)', n);
  m.lessons.forEach(id => ok(lesIds.indexOf(id) !== -1, w + 'lesson ' + id + ' exists'));
  m.lessons.forEach(id => { const l = LES.filter(x => x.id === id)[0]; ok(!l || l.moduleId === m.id, w + 'lesson ' + id + ' belongs to this module'); });
  ok(arr(m.labs, 2, 2) && m.labs.every(id => labIds.indexOf(id) !== -1), w + 'two labs that exist', m.labs.join());
  ok(arr(m.scenarios, 2, 2) && m.scenarios.every(id => scenIds.indexOf(id) !== -1), w + 'two scenarios that exist', m.scenarios.join());
  (m.designs || []).forEach(id => ok(desIds.indexOf(id) !== -1, w + 'design ' + id + ' exists'));
  ok(arr(m.objectives, 3) && m.objectives.every(id => objIds.indexOf(id) !== -1), w + 'objectives exist');
  (m.prereqs || []).forEach(p => ok(modIds.indexOf(p) !== -1 && modIds.indexOf(p) < modIds.indexOf(m.id), w + 'prerequisite ' + p + ' is an earlier module'));
  (m.sources || []).forEach(s => ok(srcIds.indexOf(s) !== -1, w + 'source ' + s + ' is in the register'));
  ok(m.gate && m.gate.questions >= 6 && m.gate.passPct === 80, w + 'gate assigns 6+ questions at 80%');
  const bank = Q.filter(q => q.moduleId === m.id && q.pool === 'bank'), gate = Q.filter(q => q.moduleId === m.id && q.pool === 'gate');
  ok(bank.length >= 8, w + 'at least eight bank questions', bank.length);
  ok(gate.length >= 4, w + 'at least four unseen gate variants', gate.length);
  ok(m.gate.questions <= bank.length, w + 'assigned count fits the bank');
  const types = new Set(bank.concat(gate).map(q => q.type));
  ok(types.size >= 3, w + 'question styles mixed (3+ types)', [...types].join());
  /* a gate variant must not be the bank item with the choices reordered */
  gate.forEach(g => bank.forEach(b => {
    if (g.q === b.q) ok(false, w + 'gate ' + g.id + ' duplicates bank ' + b.id + ' question text');
    if (g.choices && b.choices && g.choices.slice().sort().join('|') === b.choices.slice().sort().join('|')) ok(false, w + 'gate ' + g.id + ' reuses bank ' + b.id + ' choice set');
  }));
});
/* prerequisite graph acyclic (modules) */
(function () {
  const seen = {}, stack = {};
  let cyclic = false;
  function visit(id) { if (stack[id]) { cyclic = true; return; } if (seen[id]) return; seen[id] = stack[id] = true; const m = MODS.filter(x => x.id === id)[0]; (m && m.prereqs || []).forEach(visit); stack[id] = false; }
  MODS.forEach(m => visit(m.id));
  ok(!cyclic, 'module prerequisite graph is acyclic');
})();

/* ── weeks: three sessions, each ≤ 90 min, items resolve ───────── */
const ITEM_KINDS = ['lesson', 'lab', 'scenario', 'gate', 'debrief', 'teachback', 'design', 'diagnostic', 'review', 'setup', 'recall'];
WEEKS.forEach(w => {
  const p = 'week ' + w.n + ': ';
  ok(str(w.title) && str(w.main) && str(w.evidence) && modIds.indexOf(w.moduleId) !== -1, p + 'title, main work, evidence, module');
  ok(arr(w.sessions, 3, 3), p + 'three sessions');
  (w.sessions || []).forEach(s => {
    ok(s.mins <= 90 && s.mins >= 30, p + 'session "' + s.title + '" within 30–90 min');
    ok(arr(s.items, 1), p + 'session "' + s.title + '" has items');
    (s.items || []).forEach(it => {
      ok(ITEM_KINDS.indexOf(it.kind) !== -1, p + 'item kind ' + it.kind + ' known');
      if (it.kind === 'lesson') ok(lesIds.indexOf(it.id) !== -1, p + 'lesson ' + it.id + ' exists');
      if (it.kind === 'lab') ok(labIds.indexOf(it.id) !== -1, p + 'lab ' + it.id + ' exists');
      if (it.kind === 'scenario') ok(scenIds.indexOf(it.id) !== -1, p + 'scenario ' + it.id + ' exists');
      if (it.kind === 'gate' || it.kind === 'debrief' || it.kind === 'teachback') ok(modIds.indexOf(it.id) !== -1, p + it.kind + ' ' + it.id + ' exists');
      if (it.kind === 'design') ok(desIds.indexOf(it.id) !== -1, p + 'design ' + it.id + ' exists');
      if (it.kind === 'lab' && it.checkpoint) { const L = LABS.filter(x => x.id === it.id)[0]; ok(L && L.checkpoints.some(c => c.id === it.checkpoint), p + it.id + ' checkpoint ' + it.checkpoint + ' exists'); }
    });
  });
});
/* every lesson, lab, scenario, design, gate and debrief is scheduled */
const scheduled = {};
WEEKS.forEach(w => w.sessions.forEach(s => s.items.forEach(it => { scheduled[it.kind + ':' + it.id] = 1; })));
LES.forEach(l => ok(scheduled['lesson:' + l.id], 'lesson ' + l.id + ' is scheduled in a week'));
range('L', 32).forEach(id => ok(scheduled['lab:' + id], 'lab ' + id + ' is scheduled'));
range('S', 32).forEach(id => ok(scheduled['scenario:' + id], 'scenario ' + id + ' is scheduled'));
range('D', 6).forEach(id => ok(scheduled['design:' + id], 'design ' + id + ' is scheduled'));
MODS.forEach(m => { ok(scheduled['gate:' + m.id], 'gate ' + m.id + ' scheduled'); ok(scheduled['debrief:' + m.id], 'debrief ' + m.id + ' scheduled'); });
ok(scheduled['diagnostic:diag'], 'diagnostic scheduled in week 1');

/* ── objectives ────────────────────────────────────────────────── */
ok(uniq(objIds) && OBJ.length >= 60, 'objectives unique and 60+', OBJ.length);
(function () {
  const seen = {}, stack = {}; let cyclic = false;
  function visit(id) { if (stack[id]) { cyclic = true; return; } if (seen[id]) return; seen[id] = stack[id] = true; const o = OBJ.filter(x => x.id === id)[0]; (o && o.prerequisites || []).forEach(visit); stack[id] = false; }
  OBJ.forEach(o => visit(o.id));
  ok(!cyclic, 'objective prerequisite graph is acyclic');
})();
OBJ.forEach(o => {
  const w = o.id + ': ';
  ok(str(o.title) && str(o.observableOutcome, 40) && modIds.indexOf(o.moduleId) !== -1, w + 'title, observable outcome, module');
  (o.prerequisites || []).forEach(p => ok(objIds.indexOf(p) !== -1, w + 'prerequisite ' + p + ' exists'));
  ok(arr(o.evidenceRequired, 1), w + 'evidence required');
  (o.evidenceRequired || []).forEach(e => {
    const [k, id] = e.split(':');
    const okRef = k === 'lab' ? labIds.indexOf(id) !== -1 : k === 'scenario' ? scenIds.indexOf(id) !== -1 : k === 'gate' ? modIds.indexOf(id) !== -1 : k === 'design' ? desIds.indexOf(id) !== -1 : false;
    ok(okRef, w + 'evidence ' + e + ' resolves');
  });
  ok(LES.some(l => (l.objectiveIds || []).indexOf(o.id) !== -1), w + 'taught by at least one lesson');
});

/* ── lessons ───────────────────────────────────────────────────── */
ok(LES.length === 77 && uniq(lesIds), 'seventy-seven lessons with unique ids', LES.length);
LES.forEach(l => {
  const w = l.id + ': ';
  ok(/^les-m\d\d-\d\d$/.test(l.id) && modIds.indexOf(l.moduleId) !== -1, w + 'id format and module');
  ok(str(l.title) && str(l.objective, 30) && l.mins >= 8 && l.mins <= 20, w + 'title, objective, 8–20 min');
  ok(str(l.model, 120), w + 'mental model (120+ chars)');
  ok(arr(l.sections, 2, 6) && l.sections.every(s => str(s.h) && str(s.body, 250)), w + '2–6 substantive sections (250+ chars each)');
  ok(l.example && str(l.example.h) && str(l.example.body, 200), w + 'worked example (200+ chars)');
  ok(arr(l.misconceptions, 2) && l.misconceptions.every(m => str(m.wrong) && str(m.right, 20)), w + '2+ misconceptions with corrections');
  ok(arr(l.recall, 3) && l.recall.every(r => str(r.q, 10) && str(r.a, 10)), w + '3+ recall/prediction items with answers');
  ok(arr(l.objectiveIds, 1) && l.objectiveIds.every(id => objIds.indexOf(id) !== -1), w + 'objective ids resolve');
  ok(arr(l.refs, 1) && l.refs.every(r => srcIds.indexOf(r) !== -1), w + 'references in the source register', (l.refs || []).join());
  (l.prereqs || []).forEach(p => ok(lesIds.indexOf(p) !== -1 && lesIds.indexOf(p) < lesIds.indexOf(l.id), w + 'prerequisite ' + p + ' comes earlier'));
  if (l.diagram) {
    ok(/^<svg[\s\S]*<\/svg>$/.test(l.diagram.trim()) && /role="img"/.test(l.diagram) && /aria-label="[^"]{10,}"/.test(l.diagram) && /viewBox=/.test(l.diagram), w + 'diagram is an accessible inline SVG');
    ok(!/<script|<foreignObject|href=|on\w+=/i.test(l.diagram), w + 'diagram has no scripts, links or handlers');
  }
});

/* ── questions ─────────────────────────────────────────────────── */
ok(uniq(ids(Q)), 'question ids unique');
const QTYPES = ['mcq', 'predict', 'diagnose', 'order', 'explain'];
Q.forEach(q => {
  const w = q.id + ': ';
  ok(/^q-m\d\d-(b|g)\d\d$/.test(q.id) && modIds.indexOf(q.moduleId) !== -1 && (q.pool === 'bank' || q.pool === 'gate'), w + 'id, module, pool');
  ok(QTYPES.indexOf(q.type) !== -1 && [1, 2, 3].indexOf(q.difficulty) !== -1, w + 'type and difficulty');
  ok(str(q.q, 20) && str(q.rationale, 40) && str(q.misconception, 20), w + 'question, rationale (40+), misconception feedback');
  ok(arr(q.objectiveIds, 1) && q.objectiveIds.every(id => objIds.indexOf(id) !== -1), w + 'objective tags resolve');
  ok(lesIds.indexOf(q.remediation) !== -1, w + 'remediation lesson exists');
  if (q.type === 'order') ok(arr(q.steps, 3, 7) && q.steps.every(s => str(s)), w + 'order: 3–7 steps in correct order');
  else if (q.type === 'explain') ok(arr(q.rubric, 2) && str(q.answer, 40), w + 'explain: rubric and model answer');
  else ok(arr(q.choices, 3, 5) && q.a === 0 && q.choices.every(c => str(c)) && uniq(q.choices), w + 'selected-response: 3–5 unique choices, correct first');
  if (q.type === 'predict' || q.type === 'diagnose') ok(str(q.context, 20), w + 'predict/diagnose: context (output, log, config)');
});

/* ── labs L01–L32 ──────────────────────────────────────────────── */
ok(labIds.join() === range('L', 32).join(), 'labs L01–L32 present in order', labIds.join());
const PROFILES = ['linux-arm64', 'compose', 'kind-basic', 'kind-policy', 'observability', 'workstation', 'cloud-sandbox'];
const STATUS = ['draft', 'validated', 'execution-not-tested'];
LABS.forEach(L => {
  const w = L.id + ': ';
  ok(str(L.version) && modIds.indexOf(L.moduleId) !== -1 && str(L.title), w + 'version, module, title');
  ok(arr(L.objectiveIds, 1) && L.objectiveIds.every(id => objIds.indexOf(id) !== -1), w + 'objectives resolve');
  ok(L.executionMode === 'local' || L.executionMode === 'cloud', w + 'execution mode');
  ok(L.estimatedMinutes >= 30 && L.estimatedMinutes <= 300, w + 'estimated minutes plausible', L.estimatedMinutes);
  ok(PROFILES.indexOf(L.environmentProfile) !== -1, w + 'environment profile known', L.environmentProfile);
  (L.prerequisites || []).forEach(p => ok(labIds.indexOf(p) !== -1 && labIds.indexOf(p) < labIds.indexOf(L.id), w + 'prerequisite ' + p + ' is an earlier lab'));
  ok(str(L.learnerBrief, 200), w + 'learner brief (200+ chars)');
  ok(arr(L.checkpoints, 1) && L.checkpoints.every(c => str(c.id) && str(c.title) && str(c.resumeInstructions, 20)), w + 'checkpoints with resume instructions');
  ok(arr(L.assetPaths, 1) && arr(L.setup, 1) && arr(L.tasks, 2) && arr(L.reset, 1) && arr(L.teardown, 1), w + 'assets, setup, tasks, reset, teardown');
  ok(arr(L.validation, 2) && L.validation.every(v => str(v.id) && str(v.description, 10) && typeof v.critical === 'boolean') && L.validation.some(v => v.critical), w + 'validation checks with at least one critical');
  ok(arr(L.evidenceInstructions, 1), w + 'evidence instructions');
  ok(arr(L.hints, 4, 4) && L.hints.map(h => h.level).join() === '1,2,3,4' && L.hints.every(h => str(h.text, 20)), w + 'four staged hints');
  ok(str(L.solutionRef) && arr(L.sourceIds, 1) && L.sourceIds.every(s => srcIds.indexOf(s) !== -1), w + 'solution ref and sources');
  ok(STATUS.indexOf(L.status) !== -1, w + 'content status');
  ok(L.variant && str(L.variant.brief, 40), w + 'independent variant brief');
  ok(arr(L.limits, 1), w + 'states what it does not prove');
  const dir = H.repoFile('labs/sre-cloud-foundations', L.id);
  const fs = require('fs');
  ok(fs.existsSync(dir), w + 'lab directory exists');
  if (fs.existsSync(dir)) {
    ['README.md', 'validate.py', 'reset.sh', 'teardown.sh', 'SOLUTION.md', 'VARIANT.md', 'hints.md', 'evidence-example.json'].forEach(f => ok(fs.existsSync(require('path').join(dir, f)), w + f + ' present'));
    const ex = require('path').join(dir, 'evidence-example.json');
    if (fs.existsSync(ex)) {
      let j = null; try { j = JSON.parse(fs.readFileSync(ex, 'utf8')); } catch (e) {}
      ok(j && j.activityId === L.id && j.trackId === 'sre-cloud-foundations' && Array.isArray(j.checks), w + 'evidence example is a valid report for this lab');
      ok(j && j.note && /example|schema/i.test(j.note), w + 'evidence example says it is an example, not a result');
    }
  }
});

/* ── scenarios S01–S32 ─────────────────────────────────────────── */
ok(scenIds.slice().sort().join() === range('S', 32).join(), 'scenarios S01–S32 present', scenIds.sort().join());
SCEN.forEach(m => {
  const o = m.sre, w = o.scenarioId + ': ';
  ok(m.track === 'sre' && m.cat === 'scenario' && m.mins >= 10 && m.mins <= 45, w + 'mission track, category, 10–45 min');
  ok(modIds.indexOf(o.moduleId) !== -1, w + 'module');
  ok(arr(o.variants, 2), w + 'at least two seeded variants');
  ok(['neutralTitle', 'neutralBrief', 'impact', 'changes', 'mechanism', 'symptom'].every(f => str(o[f], 15)), w + 'neutral ticket, impact, changes, mechanism, symptom');
  ok(arr(o.spoilers, 1) && arr(o.alternatives, 2) && arr(o.simplified, 2) && arr(o.palette, 3) && arr(o.tools, 1) && arr(o.grammar, 1), w + 'spoilers, alternatives, simplifications, palette, tools, grammar');
  ok(arr(o.unsafe, 1) && o.unsafe.every(u => typeof u.test === 'function' && str(u.label) && str(u.why, 20)), w + 'documented unsafe shortcut(s)');
  ok(arr(o.prereqs, 1) && o.prereqs.every(id => lesIds.indexOf(id) !== -1), w + 'prerequisite lessons resolve');
  ok(labIds.indexOf(o.lab) !== -1, w + 'linked local lab exists');
  ok(arr(o.passRubric, 2), w + 'causal explanation rubric');
  const neutral = (o.neutralTitle + ' ' + o.neutralBrief).toLowerCase();
  o.spoilers.forEach(sw => ok(neutral.indexOf(sw.toLowerCase()) === -1, w + 'independent ticket does not reveal "' + sw + '"'));
  ok(typeof m.world === 'function', w + 'world is a function of the seed');
  ok(arr(m.objectives, 4) && m.objectives.every(x => x.id && x.text && typeof x.done === 'function' && x.hint && x.hint2 && x.reveal && ['evidence', 'fix', 'verify'].indexOf(x.stage) !== -1), w + 'objectives with stages, two hints and a reveal');
  ok(m.objectives.some(x => x.stage === 'fix') && m.objectives.some(x => x.stage === 'verify') && m.objectives.some(x => x.stage === 'evidence'), w + 'evidence, fix and verify stages');
  /* instructor-only material stays out of the learner-visible initial view */
  const visible = [m.brief, o.neutralBrief, o.neutralTitle, m.title].concat(m.objectives.map(x => x.text)).join(' ').toLowerCase();
  ok(!/root cause:|solution:/.test(visible), w + 'no instructor-only root cause in the learner-visible text');
});

/* ── designs ───────────────────────────────────────────────────── */
ok(desIds.join() === range('D', 6).join(), 'designs D01–D06', desIds.join());
DES.forEach(d => {
  const w = d.id + ': ';
  ok(modIds.indexOf(d.moduleId) !== -1 && str(d.title) && str(d.brief, 150), w + 'module, title, brief');
  ok(arr(d.worksheet, 8) && d.worksheet.every(f => str(f.id) && str(f.label) && str(f.prompt, 20)), w + 'worksheet with 8+ fields');
  ok(arr(d.mustAddress, 4), w + 'required tradeoffs (4+)');
  ok(arr(d.rubric, 4) && d.rubric.every(r => str(r.id) && str(r.label)), w + 'rubric dimensions (4+)');
  ok(str(d.reference, 400), w + 'reference discussion (400+ chars)');
  ok(d.timeboxMins >= 30 && d.timeboxMins <= 45, w + 'timebox 30–45 min');
  ok(arr(d.sourceIds, 1) && d.sourceIds.every(x => srcIds.indexOf(x) !== -1), w + 'sources resolve');
});

/* ── diagnostic ────────────────────────────────────────────────── */
ok(!!DIAG, 'diagnostic present');
if (DIAG) {
  ok(arr(DIAG.questions, 24, 24) && uniq(ids(DIAG.questions)), 'diagnostic: exactly 24 questions', (DIAG.questions || []).length);
  ok(arr(DIAG.practicals, 2, 2) && DIAG.practicals.every(p => str(p.title) && str(p.brief, 80) && arr(p.checklist, 3)), 'diagnostic: two investigations with checklists');
  ok(DIAG.python && str(DIAG.python.brief, 80) && str(DIAG.python.starter, 80) && str(DIAG.python.run), 'diagnostic: one Python attempt with starter');
  ok(arr(DIAG.domains, 6) && DIAG.domains.every(d => str(d.id) && str(d.label) && arr(d.moduleIds, 1) && d.moduleIds.every(id => modIds.indexOf(id) !== -1)), 'diagnostic: domains map to modules');
  const domIds = ids(DIAG.domains || []);
  (DIAG.questions || []).forEach(q => {
    ok(domIds.indexOf(q.domain) !== -1 && str(q.q, 15) && arr(q.choices, 3, 5) && q.a === 0 && str(q.why, 30), q.id + ': domain, question, choices (correct first), rationale');
  });
  const themes = [/dns|resol/i, /tcp|udp/i, /permission|mode|owner/i, /log/i, /dict|count/i, /plan/i, /pod|deployment/i, /retry|idempot/i, /sli|numerator|denominator/i, /trade.?off|design/i];
  themes.forEach(re => ok((DIAG.questions || []).some(q => re.test(q.q + ' ' + (q.context || '') + ' ' + q.domain)), 'diagnostic covers ' + re));
  ok(!/install (kind|kubernetes|docker)/i.test(JSON.stringify(DIAG)), 'diagnostic does not ask to install Kubernetes');
}

/* ── reviews, branches, cloud, sources, roles ──────────────────── */
ok(REV.length >= 32 && uniq(ids(REV)), 'review prompts (32+)', REV.length);
REV.forEach(r => ok(arr(r.objectiveIds, 1) && r.objectiveIds.every(id => objIds.indexOf(id) !== -1) && str(r.prompt, 20) && str(r.answer, 15) && ['recall', 'changed-symptom'].indexOf(r.kind) !== -1, r.id + ': review prompt resolves'));
MODS.forEach(m => ok(REV.some(r => r.objectiveIds.some(id => m.objectives.indexOf(id) !== -1)), m.id + ': has at least one review prompt'));
ok(ids(BR).join() === range('B', 8).join(), 'branches B01–B08', ids(BR).join());
BR.forEach(b => {
  const w = b.id + ': ';
  ok(str(b.title) && str(b.audience, 20) && arr(b.hours, 2, 2) && b.hours[0] < b.hours[1], w + 'title, audience, hour range');
  ok(arr(b.objectives, 3) && arr(b.sequence, 3) && arr(b.exercises, 2) && b.exercises.every(e => str(e.id) && str(e.title) && e.mins > 0 && str(e.brief, 60) && arr(e.steps, 2) && arr(e.pass, 1)), w + 'objectives, sequence, 2+ exercises with steps and pass criteria');
  ok(arr(b.prereqs, 1) && b.prereqs.every(p => modIds.indexOf(p) !== -1), w + 'prerequisite modules');
  ok(['authored-spec', 'implemented', 'runtime-validated'].indexOf(b.status) !== -1, w + 'honest status');
});
ok(ids(CL).join() === range('C', 5).join(), 'cloud extensions C01–C05', ids(CL).join());
CL.forEach(c => {
  const w = c.id + ': ';
  ok(str(c.title) && str(c.summary, 30) && str(c.hours) && arr(c.prereqs, 1) && c.prereqs.every(p => modIds.indexOf(p) !== -1), w + 'title, summary, hours, prerequisites');
  ok(arr(c.estimate, 1) && arr(c.allowedResources, 1) && arr(c.cleanup, 3) && arr(c.pass, 1) && arr(c.commands, 1) && str(c.tag) && str(c.brief, 60), w + 'estimate, allowed resources, cleanup inventory, pass, commands, tag');
  ok(c.defaultEnabled === false, w + 'disabled by default');
  ok(!/eks|aks|gke/i.test(c.allowedResources.join(' ')) || c.id === 'C03', w + 'no managed Kubernetes outside C03');
  ok(!/nat gateway/i.test(c.allowedResources.join(' ')), w + 'no NAT gateway in allowed resources');
  /* every repository path a cloud extension tells the learner to use must exist */
  (c.commands.concat([c.brief]).join('\n').match(/labs\/sre-cloud-foundations\/[\w./-]+/g) || []).forEach(p => {
    const clean = p.replace(/[.,;:)]+$/, '');
    ok(require('fs').existsSync(H.repoFile(clean)), w + 'referenced path exists: ' + clean);
  });
});
ok(SRC.length >= 20 && uniq(srcIds), 'source register (20+)');
SRC.forEach(s => ok(str(s.title) && /^https:\/\//.test(s.url) && /^\d{4}-\d\d-\d\d$/.test(s.retrieved) && ['verified', 'index-only', 'historical'].indexOf(s.status) !== -1 && str(s.scope), s.id + ': title, url, retrieved date, status, scope'));
['J1', 'J2', 'J3', 'J4', 'J5', 'J6', 'J7', 'J8', 'J9', 'J10', 'J11', 'T01', 'T02', 'T03', 'T04', 'T05', 'T06', 'T07', 'T08', 'T09', 'T10'].forEach(id => ok(srcIds.indexOf(id) !== -1, 'source ' + id + ' registered'));
ROLES.forEach(r => { ok(str(r.title) && Array.isArray(r.objectiveIds) && r.objectiveIds.every(id => objIds.indexOf(id) !== -1), r.id + ': role maps to existing objectives'); ok(!/probab|score|%/.test(JSON.stringify(r)), r.id + ': no probability or score language'); });

/* ── accuracy lint: the things the spec says never to copy forward ── */
const everything = JSON.stringify({ LES, Q, LABS, DES, BR, CL, SCEN: SCEN.map(m => m.sre) });
ok(!/dynamodb[^"]{0,60}(default|recommended|required) (for )?lock/i.test(everything), 'no "DynamoDB is the default lock" claim (T03: use_lockfile; DynamoDB deprecated)');
ok(!/extensions\/v1beta1|apps\/v1beta/i.test(everything), 'no deprecated Kubernetes API groups');
ok(!/:latest\b/.test(everything.replace(/never use .latest|not .latest|avoid .latest|latest. is not|latest\\" as a reproducibility/gi, '')), 'no image or chart pinned to :latest');
ok(!/\b(IL5|IL6|ATO)\b[^"]{0,40}(certified|granted|achieved)/i.test(everything), 'no accreditation claims');

console.log((fails ? fails + ' failed, ' : '') + passes + ' SRE content checks passed');
process.exit(fails ? 1 : 0);
