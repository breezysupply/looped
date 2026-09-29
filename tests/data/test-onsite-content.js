/* The onsite track's content contract.

   Counts per topic, every required field, 2–4 follow-ups, cross-references
   that resolve, references only on the official documentation domains, the
   five stories exactly as provided, and a lint for the specific inaccuracies
   the brief ruled out (a match is allowed only when it is being negated —
   "readiness failure does NOT restart"). */
const H = require('../helpers');
H.loadContent({ shell: true });
const D = global.LX;

let fails = 0, passes = 0;
function ok(cond, label, detail) {
  if (cond) { passes++; return; }
  fails++;
  console.log('FAIL ' + label + (detail ? '\n  ' + String(detail).slice(0, 400) : ''));
}
const str = (x, min) => typeof x === 'string' && x.trim().length >= (min || 1);
const arr = (x, lo, hi) => Array.isArray(x) && x.length >= lo && x.length <= (hi || 1e9);
const REF = /^https:\/\/(kubernetes\.io|kind\.sigs\.k8s\.io|docs\.python\.org)\//;

const Q = D.onsiteQ || [], L = D.onsiteLessons || [], LABS = (D.missions || []).filter(m => m.track === 'onsite');
const qIds = Q.map(q => q.id), lIds = L.map(l => l.id), labIds = LABS.map(m => m.id);
const design = D.onsiteDesign || [], scripts = D.onsiteScripting || [], stories = D.onsiteStories || [], real = D.onsiteReal || [];
const dIds = design.map(x => x.id), sIds = scripts.map(x => x.id), stIds = stories.map(x => x.id), rIds = real.map(x => x.id);
const mockIds = (D.onsiteMock || []).map(x => x.id);

/* ── questions ─────────────────────────────────────────────────── */
const WANT = { arch: 10, net: 10, trouble: 10, config: 8, delivery: 8, design: 8, behavior: 6 };
Object.keys(WANT).forEach(t => {
  const n = Q.filter(q => q.topic === t).length;
  ok(n >= WANT[t], 'questions: ' + t + ' has at least ' + WANT[t], n);
});
ok(Q.length >= 60, 'questions: at least 60', Q.length);
ok(new Set(qIds).size === qIds.length, 'questions: ids unique');
Q.forEach(q => {
  const w = q.id + ': ';
  ok(/^ons-q-[a-z]+-\d\d$/.test(q.id), w + 'stable id format');
  ok(q.track === 'onsite' && WANT[q.topic] != null, w + 'track and topic');
  ok(/^P[0-3]$/.test(q.priority) && [1, 2, 3].indexOf(q.level) !== -1 && q.mins > 0, w + 'priority, level, minutes');
  ok(str(q.q, 15) && str(q.context, 20) && str(q.spoken, 300) && str(q.deep, 300), w + 'question, context, spoken and deep answers');
  ok(arr(q.evaluates, 2, 6), w + '2–6 evaluation points');
  ok(arr(q.followups, 2, 4) && q.followups.every(f => str(f.q, 10) && str(f.guidance, 30)), w + '2–4 follow-ups with guidance');
  ok(arr(q.misconceptions, 2) && arr(q.weak, 2), w + 'misconceptions and weak-answer patterns');
  ok(q.rubric && arr(q.rubric.strong, 3) && arr(q.rubric.acceptable, 1) && arr(q.rubric.redFlags, 2), w + 'rubric with strong, acceptable alternatives and red flags');
  ok(typeof q.evidence === 'string', w + 'evidence field present');
  ok(q.aws === null || (q.aws && str(q.aws.analogy) && str(q.aws.breaks)), w + 'AWS analogy says where it breaks');
  ok(arr(q.refs, 1, 4) && q.refs.every(r => str(r.t) && REF.test(r.u)), w + '1–4 official references', JSON.stringify(q.refs));
  (q.prereqs || []).forEach(p => ok(lIds.indexOf(p) !== -1 || qIds.indexOf(p) !== -1, w + 'prerequisite ' + p + ' resolves'));
  (q.labs || []).forEach(p => ok(labIds.indexOf(p) !== -1, w + 'lab ' + p + ' resolves'));
  if (q.stories) q.stories.forEach(p => ok(stIds.indexOf(p) !== -1, w + 'story ' + p + ' resolves'));
  if (q.design) ok(dIds.indexOf(q.design) !== -1, w + 'design ' + q.design + ' resolves');
});
/* the brief's named questions exist (matched loosely on their subject) */
[/submit(ting)? a Deployment manifest/i, /container crash\w* versus .*Pod .*deleted/i, /worker node becomes unavailable/i,
 /Deployment, ReplicaSet, Pod, and Service differ/i, /running Pod still be unavailable/i, /selectors and EndpointSlices/i,
 /DNS failure from routing/i, /port.*targetPort/i, /requests and limits/i, /Pod remain Pending/i,
 /readiness, liveness and startup/i, /rollout stall while old replicas/i, /rollout undo/i, /Pending PersistentVolumeClaim|Pending PVC/i,
 /service accounts, Kubernetes RBAC and cloud IAM/i, /operator add beyond a Deployment/i, /disconnected environment/i,
 /release and its trust chain without internet/i, /automated remediation from amplifying/i, /control-plane outage/i
].forEach(re => ok(Q.some(q => re.test(q.q)), 'named question present: ' + re));

/* ── lessons ───────────────────────────────────────────────────── */
ok(L.length >= 14, 'lessons: at least 14', L.length);
ok(new Set(lIds).size === lIds.length, 'lessons: ids unique');
L.forEach((l, i) => {
  const w = l.id + ': ';
  ok(str(l.title) && str(l.summary, 30) && /^P[0-3]$/.test(l.priority) && l.mins > 0, w + 'title, summary, priority, minutes');
  ok(arr(l.sections, 3, 8) && l.sections.every(s => str(s.h) && str(s.body, 150)), w + '3+ substantive sections');
  ok(arr(l.keyPoints, 4) && arr(l.misconceptions, 2) && arr(l.check, 3), w + 'key points, misconceptions, self-check');
  ok(arr(l.refs, 1) && l.refs.every(r => REF.test(r.u)), w + 'official references');
  (l.prereqs || []).forEach(p => ok(lIds.indexOf(p) !== -1 && lIds.indexOf(p) < i, w + 'prerequisite ' + p + ' comes earlier'));
  (l.questions || []).forEach(p => ok(qIds.indexOf(p) !== -1, w + 'question ' + p + ' resolves'));
  (l.labs || []).forEach(p => ok(labIds.indexOf(p) !== -1, w + 'lab ' + p + ' resolves'));
  if (l.diagram) {
    ok(/^<svg[\s\S]*<\/svg>$/.test(l.diagram.trim()) && /role="img"/.test(l.diagram) && /aria-label="[^"]{10,}"/.test(l.diagram) && /viewBox=/.test(l.diagram),
       w + 'diagram is an accessible inline SVG');
    ok(!/<script|<foreignObject|href=|on\w+=/i.test(l.diagram), w + 'diagram has no scripts, links or handlers');
    ok(!/<svg[^>]*\s(width|height)=/.test(l.diagram), w + 'diagram root is not fixed-size');
  }
});
ok(L.filter(l => l.diagram).length >= 8, 'lessons: diagrams where useful (8+)');

/* ── labs, design, scripting, stories, real labs ──────────────── */
ok(LABS.length >= 10, 'sim labs: at least 10', LABS.length);
LABS.forEach(m => (m.onsite.prereqs || []).forEach(p => ok(lIds.indexOf(p) !== -1, m.id + ': prerequisite ' + p + ' resolves')));
LABS.forEach(m => (m.onsite.questions || []).forEach(p => ok(qIds.indexOf(p) !== -1, m.id + ': question ' + p + ' resolves')));

ok(design.length >= 4, 'design: four scenarios');
design.forEach(d => {
  const w = d.id + ': ';
  ok(str(d.brief, 100) && arr(d.clarify, 5) && arr(d.assumptions, 3) && arr(d.constraints, 2), w + 'brief, clarifying questions, assumptions, constraints');
  ok(d.architecture && str(d.architecture.summary) && arr(d.architecture.components, 4), w + 'example architecture with responsibilities');
  ok(arr(d.approaches, 2) && arr(d.failureModes, 4) && arr(d.identity, 2) && arr(d.observability, 2) && arr(d.deploy, 2) && arr(d.recovery, 2) && arr(d.ownership, 2), w + 'tradeoffs, failure modes, identity, observability, deploy, recovery, ownership');
  ok(arr(d.reveals, 3) && d.rubric && arr(d.rubric.strong, 3) && arr(d.rubric.acceptable, 1) && arr(d.rubric.redFlags, 2), w + 'follow-up constraints and rubric');
  ok(str(d.example, 1500) && /not the only|one of several|not presented as the only|one reasonable/i.test(d.example.slice(0, 600)), w + 'example is explicitly not the only answer');
  ok(/requirement/i.test(d.stages[0]), w + 'first stage establishes requirements before tools');
  (d.questions || []).forEach(p => ok(qIds.indexOf(p) !== -1, w + 'question ' + p + ' resolves'));
});

ok(scripts.length >= 3, 'scripting: three exercises');
scripts.forEach(x => {
  ok(str(x.statement, 100) && arr(x.expected, 2) && arr(x.run, 1) && arr(x.hints, 2) && str(x.solution, 200) && str(x.explanation, 100), x.id + ': statement, expectations, run, hints, solution, explanation');
  ok(require('fs').existsSync(H.repoFile(x.dir)), x.id + ': directory exists');
});
const art = scripts.filter(x => /manifest/i.test(x.title + x.dir))[0];
ok(art && /publisher|authentic/i.test(art.statement + art.explanation) && /signature/i.test(art.statement + art.explanation) && /key/i.test(art.statement + art.explanation),
   'scripting: the artifact exercise says a hash does not authenticate the publisher');

const FACTS = {
  'ons-story-scope': 'Component rollout exceeded intended scope because empty scoping criteria were treated as unrestricted. A missing identity prerequisite caused failures. Response involved disabling the component, correcting scope, and adding prerequisite verification through the consuming API.',
  'ons-story-dns': 'Region bring-up failed on DNS resolution. Direct authoritative queries distinguished a functioning child zone from missing parent delegation. Post-write verification caught mistakes; negative caching complicated validation.',
  'ons-story-transfer': 'Controlled artifact transfer and receiving-side verification exposed registration, identity, and architecture-related issues.',
  'ons-story-capacity': 'Repeated remediation requests from a small set of clusters consumed shared regional capacity. Investigation ruled out other bottlenecks and produced an evidence-backed escalation. A separate detector confused missing telemetry with a failure condition.',
  'ons-story-runbook': 'Consolidated incomplete operational instructions into a reusable runbook with prerequisites and validation.'
};
ok(stories.length === 5, 'stories: exactly the five provided', stories.length);
stories.forEach(s => {
  ok(FACTS[s.id] === s.facts, s.id + ': facts are verbatim');
  ok(arr(s.concepts, 3) && arr(s.transfers, 3) && arr(s.newKnowledge, 3) && arr(s.followups, 4) && arr(s.structure, 4) && arr(s.supply, 3), s.id + ': bridge fields complete');
  /* no invented metrics: digits are allowed only in general technical tokens */
  const body = JSON.stringify([s.concepts, s.transfers, s.newKnowledge, s.structure, s.followups]);
  const nums = (body.match(/\b\d+(\.\d+)?\s*(%|percent|hours?|minutes?|days?|weeks?|clusters|engineers|people|regions|x)\b/gi) || []);
  ok(nums.length === 0, s.id + ': no invented metrics', nums.join(', '));
});

if (real.length) {
  ok(real.length >= 6, 'real labs: at least six', real.length);
  real.forEach(r => {
    ok(labIds.indexOf(r.sim) !== -1, r.id + ': simulated twin ' + r.sim + ' exists');
    ok(require('fs').existsSync(H.repoFile(r.dir)), r.id + ': directory ' + r.dir + ' exists');
    ok(r.executed && /^(executed|not-executed)$/.test(r.executed.status), r.id + ': execution status recorded');
  });
} else {
  ok(false, 'real labs: index present');
}

/* ── hands-on scenarios (a real practice cluster) ─────────────── */
const hands = D.onsiteHands || [], hIds = hands.map(h => h.id);
const lines = x => Array.isArray(x) ? x.join('\n') : (x || '');
ok(hands.length >= 8, 'hands-on: at least eight scenarios', hands.length);
ok(new Set(hIds).size === hIds.length, 'hands-on: ids unique');
const intro = D.onsiteHandsIntro || {};
ok(str(intro.warning, 40) && /practice/.test(intro.warning) && /work cluster/.test(intro.warning), 'hands-on: the intro warns against work clusters');
(intro.envs || []).concat(intro.more ? [intro.more] : []).forEach(e =>
  ok(/^https:\/\/(killercoda\.com|docs\.docker\.com)\//.test(e.url), 'hands-on: environment link on its official site: ' + e.url));
/* a mutating kubectl line must name the practice namespace (or be about the
   namespace itself); nothing may delete another namespace or use --all */
const MUTATE = /^\s*kubectl\s+(create|apply|delete|scale|set|expose|run|patch|label|annotate|rollout\s+(undo|restart)|edit|replace)\b/;
hands.forEach(h => {
  const w = h.id + ': ';
  ok(/^ons-hands-\d\d$/.test(h.id) && str(h.title) && str(h.goal, 40) && /^P[0-3]$/.test(h.priority) && h.mins > 0, w + 'id, title, goal, priority, minutes');
  ok(arr(h.tasks, 4) && h.tasks.every(t => str(t.do, 15) && str(t.hint, 10) && str(lines(t.cmd), 5) && str(t.expect, 10) && str(t.why, 20)), w + 'every task has do, hint, command, expectation and why');
  ok(h.tasks.every(t => typeof t.re === 'string'), w + 'every task is covered by the validator (re)');
  ok(h.check && /PASS/.test(lines(h.check.cmd)) && /FAIL/.test(lines(h.check.cmd)), w + 'check prints PASS or FAIL');
  ok(str(lines(h.cleanup)) && str(h.talk, 40), w + 'cleanup and interview phrasing');
  (h.lessons || []).forEach(p => ok(lIds.indexOf(p) !== -1, w + 'lesson ' + p + ' resolves'));
  (h.questions || []).forEach(p => ok(qIds.indexOf(p) !== -1, w + 'question ' + p + ' resolves'));
  (h.sims || []).forEach(p => ok(labIds.indexOf(p) !== -1, w + 'sim lab ' + p + ' resolves'));
  const all = [].concat((h.setup || []).map(lines), h.tasks.map(t => lines(t.cmd)), h.tasks.map(t => lines(t.test || '')), [lines(h.cleanup), lines(h.check.cmd)]).join('\n').split('\n');
  all.forEach(l => {
    if (/--context\b/.test(l)) ok(false, w + 'commands stay environment-neutral (no --context)', l);
    if (/--all(-namespaces)?\b|\s-A\b/.test(l) && MUTATE.test(l)) ok(false, w + 'no mutating command across all namespaces', l);
    if (/kubectl\s+delete\s+(ns|namespaces?)\b/.test(l)) ok(/delete\s+(ns|namespaces?)\s+practice\s*$/.test(l.trim()), w + 'only the practice namespace is ever deleted', l);
    if (MUTATE.test(l) && !/kubectl\s+(create|delete)\s+(ns|namespaces?)\s+practice\b/.test(l)) {
      ok(/(-n|--namespace)[ =]practice\b/.test(l) || /-f\s+-\s*$/.test(l) && /kubectl\s+apply\s+-f\s+-/.test(l), w + 'mutating command names -n practice', l);
    }
  });
  /* the apply -f - lines are fed by commands that set the namespace */
  all.forEach((l, i) => { if (/\|\s*kubectl\s+apply\s+-f\s+-/.test(l)) ok(/-n practice|namespace practice/.test(l), w + 'piped apply is scoped to practice', l); });
});

/* ── path and mock resolve ─────────────────────────────────────── */
const RES = { lesson: lIds, question: qIds, lab: labIds, design: dIds, script: sIds, real: rIds, story: stIds, mock: mockIds, hands: hIds };
const fun = (D.onsitePath || {}).fundamentals || [];
ok(fun.length >= 6, 'path fundamentals: has sessions', fun.length);
ok(hIds.every(id => fun.some(x => x.items.some(it => it.kind === 'hands' && it.id === id))), 'path fundamentals: includes every hands-on scenario');
ok(fun.every(x => x.items.some(it => it.kind === 'hands' || it.kind === 'mock')), 'path fundamentals: every session has real-cluster or timed practice');
['fundamentals', 'essential', 'deep'].forEach(k => {
  const sess = (D.onsitePath || {})[k] || [];
  ok(sess.length >= (k === 'deep' ? 10 : 4), 'path ' + k + ': has sessions', sess.length);
  const seen = [];
  sess.forEach(x => {
    x.prereqs.forEach(p => ok(seen.indexOf(p) !== -1, k + '/' + x.id + ': prerequisite ' + p + ' comes earlier'));
    seen.push(x.id);
    x.items.forEach(it => ok((RES[it.kind] || []).indexOf(it.id) !== -1, k + '/' + x.id + ': ' + it.kind + ' ' + it.id + ' resolves'));
  });
});
const pathQ = new Set(); ((D.onsitePath || {}).deep || []).forEach(x => x.items.forEach(it => { if (it.kind === 'question') pathQ.add(it.id); }));
ok(pathQ.size >= 55, 'path deep: covers nearly every question', pathQ.size);
(D.onsiteMock || []).forEach(m => m.slots.forEach(sl => sl.pool.forEach(id => ok((RES[sl.kind] || []).indexOf(id) !== -1, m.id + ': ' + sl.kind + ' ' + id + ' resolves'))));
ok(['mock-15', 'mock-30', 'mock-45', 'mock-60'].every(id => mockIds.indexOf(id) !== -1), 'mock: 15/30/45/60 minute presets');
ok((D.onsiteFeedback || []).map(f => f.id).join() === 'terminology,mechanism,evidence,unsafe,verification,sound,alternative', 'feedback categories as specified');
ok(D.drills.filter(d => d.track === 'onsite').length === Q.length, 'every question is also a drill');

/* ── accuracy lint ─────────────────────────────────────────────── */
const all = [];
/* fields whose job is to state a wrong belief (to correct it), or to ask */
const STATES_WRONG = ['misconceptions', 'weak', 'redFlags', 'q', 'pitfalls'];
function collect(x, where, key) {
  if (STATES_WRONG.indexOf(key) !== -1) return;
  if (typeof x === 'string') { all.push([where + (key ? '.' + key : ''), x]); return; }
  if (Array.isArray(x)) { x.forEach(y => collect(y, where, key)); return; }
  if (x && typeof x === 'object') Object.keys(x).forEach(k => { if (k !== 'done' && k !== 'diagram') collect(x[k], where, k); });
}
Q.forEach(q => collect(q, q.id)); L.forEach(l => collect(l, l.id)); design.forEach(d => collect(d, d.id));
stories.forEach(s => collect(s, s.id)); LABS.forEach(m => collect({ t: m.title, b: m.brief, o: m.onsite, obj: m.objectives.map(o => [o.text, o.hint, o.hint2]) }, m.id));
real.forEach(r => collect(r, r.id));
const NEG = /(\b(not|n't|never|no|nor|without|isn't|doesn't|don't|won't|cannot|can't|neither|myth|misconception|wrong|false|mistake|assum\w*|believ\w*|think\w*|claim\w*|says?|saying|stat\w*|calls?)\b|["“'‘])[^.]{0,60}$/i;
const LINT = [
  [/readiness (probe )?(failure|failing|fails)[^.]{0,20}\brestart(s|ed)? the container/i, 'readiness failure restarts the container'],
  [/\bRunning (means|implies|=) (it'?s )?Ready\b/i, 'Running implies Ready'],
  [/CrashLoopBackOff is the (root )?cause/i, 'CrashLoopBackOff is the cause'],
  [/(exit code )?137 (always |proves |means (it was )?|is always )(an? )?OOM/i, '137 proves OOM'],
  [/namespaces? (isolate|isolates|separate) (network )?traffic/i, 'namespaces isolate traffic'],
  [/base64[^.]{0,20}\b(encrypt(s|ed|ion)?|secure[sd]?)\b/i, 'base64 is encryption'],
  [/Secrets are encrypted (by default|at rest by default)/i, 'Secrets encrypted by default'],
  [/(creating a |every |a )Service (automatically )?(provisions|creates|gives you) an? (external )?load balancer/i, 'Service provisions an LB'],
  [/operator is (just|simply) (another word for |a )Deployment/i, 'operator = Deployment'],
  [/GitOps[^.]{0,40}pulls? (all |everything|images)/i, 'GitOps pulls images'],
  [/(successful|completed) rollout (proves|means|guarantees) (the )?(app|application|release) (is |works)/i, 'rollout proves correctness'],
  [/(hash|SHA-256|checksum)[^.]{0,30}\b(authenticates|proves who|proves the publisher)/i, 'hash authenticates publisher'],
  [/Kubernetes (and|is) (equivalent|the same as) (to )?ECS/i, 'K8s = ECS'],
  [/Gallatin (asks|will ask|uses|runs|interview questions? (is|are))/i, 'claims knowledge of Gallatin']
];
let lintHits = 0;
all.forEach(([where, text]) => {
  LINT.forEach(([re, name]) => {
    const g = new RegExp(re.source, re.flags.indexOf('g') === -1 ? re.flags + 'g' : re.flags);
    let m;
    while ((m = g.exec(text))) {
      const before = text.slice(Math.max(0, m.index - 90), m.index + m[0].length);
      const sentenceStart = text.lastIndexOf('.', m.index) + 1;
      const pre = text.slice(Math.max(sentenceStart, m.index - 90), m.index);
      if (NEG.test(pre + ' ') || /\b(not|n't|never|doesn't|does not|is not)\b/i.test(m[0])) continue;
      lintHits++;
      ok(false, 'accuracy lint [' + name + '] in ' + where, before);
    }
  });
});
ok(lintHits === 0, 'accuracy lint clean');

console.log((fails ? fails + ' failed, ' : '') + passes + ' onsite content checks passed');
process.exit(fails ? 1 : 0);
