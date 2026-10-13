/* Course hub for the SRE & Cloud Deployment Foundations track.

   Sections: Path (current module/week, next session, reviews due, evidence
   remaining), Map, Diagnostic, Modules (lessons → recall → lab → scenario →
   gate → debrief), Labs (local lab specs + evidence import), Designs,
   Reviews (1/7/21/45-day queue), Evidence (tiers, objectives, role coverage),
   Branches (optional roles and cloud opt-in), Setup.

   Grading: deterministic for selected-response, prediction, ordering and
   imported lab checks; rubric self-review for explanations and designs, and
   labelled as self-reviewed everywhere it is shown. No AI anywhere in the
   pass rules. State: one localStorage key, lx.sre (in LXStore.KEYS), kept
   separate from content; content edits never overwrite an attempt. */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function U() { return window.LXUtil; }
  function esc(x) { return U().esc(x == null ? '' : x); }
  var KEY = 'lx.sre';
  var SCHEMA = 1;

  /* ── storage ─────────────────────────────────────────────────── */
  function st() {
    var s = U().LS.get(KEY, {}) || {};
    if (!s.v) s.v = SCHEMA;
    ['attempts', 'lessons', 'gates', 'reviews', 'designs', 'debriefs', 'diagnostic', 'cloud', 'ui', 'branches', 'reports', 'flags'].forEach(function (k) {
      if (!s[k] || typeof s[k] !== 'object') s[k] = {};
    });
    return s;
  }
  function save(s) { U().LS.set(KEY, s); }
  function now() { return new Date().toISOString(); }
  function ymd(d) { d = d || new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function addDays(n, from) { var d = from ? new Date(from + 'T12:00:00') : new Date(); d.setDate(d.getDate() + n); return ymd(d); }
  function uid(prefix) { return prefix + '-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36); }

  /* ── content access ──────────────────────────────────────────── */
  function list(k) { return (window.LX && LX[k]) || []; }
  function byId(k, id) { return list(k).filter(function (x) { return x.id === id; })[0] || null; }
  function track() { return LX.sreTrack || {}; }
  function mod(id) { return byId('sreModules', id); }
  function lesson(id) { return byId('sreLessons', id); }
  function lab(id) { return byId('sreLabs', id); }
  function design(id) { return byId('sreDesigns', id); }
  function objective(id) { return byId('sreObjectives', id); }
  function scenarioMission(sid) { return list('missions').filter(function (m) { return m.sre && m.sre.scenarioId === sid; })[0] || null; }
  function questionsFor(moduleId, pool) { return list('sreQuestions').filter(function (q) { return q.moduleId === moduleId && (!pool || q.pool === pool); }); }
  function weeksOf(moduleId) { return list('sreWeeks').filter(function (w) { return w.moduleId === moduleId; }); }
  function version() { return track().version || '1.0'; }

  /* ── markdown-lite ───────────────────────────────────────────── */
  function inline(s) {
    return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  }
  function md(text) {
    return String(text || '').split(/\n{2,}/).map(function (block) {
      var lines = block.split('\n');
      if (lines.every(function (l) { return /^\s*- /.test(l); })) return '<ul class="bullets">' + lines.map(function (l) { return '<li>' + inline(l.replace(/^\s*- /, '')) + '</li>'; }).join('') + '</ul>';
      if (lines.every(function (l) { return /^\s*\d+\. /.test(l); })) return '<ol class="steps-why">' + lines.map(function (l) { return '<li>' + inline(l.replace(/^\s*\d+\. /, '')) + '</li>'; }).join('') + '</ol>';
      if (/^```/.test(lines[0])) return '<pre class="term term-static">' + esc(lines.slice(1, lines[lines.length - 1] === '```' ? -1 : undefined).join('\n')) + '</pre>';
      if (/^### /.test(lines[0])) return '<h4 class="prep-h4">' + inline(lines[0].slice(4)) + '</h4>' + (lines.length > 1 ? '<p>' + lines.slice(1).map(inline).join('<br>') + '</p>' : '');
      return '<p>' + lines.map(inline).join('<br>') + '</p>';
    }).join('');
  }
  function ul(items, fn) { if (!items || !items.length) return ''; return '<ul class="bullets">' + items.map(function (x) { return '<li>' + (fn ? fn(x) : inline(x)) + '</li>'; }).join('') + '</ul>'; }
  function label(t) { return '<p class="section-label">' + esc(t) + '</p>'; }
  function badge(t, cls) { return '<span class="badge' + (cls ? ' ' + cls : '') + '">' + esc(t) + '</span>'; }
  function back(section) { return '<button class="btn ghost small prep-back" data-sre-go="' + esc(section || ui.section) + '">← Back</button>'; }
  function copyPre(text, lbl) {
    return '<div class="cmd-block"><pre class="term term-static">' + esc(text) + '</pre><button class="btn ghost small copy-btn" data-prep-copy="' + esc(text) + '" aria-label="Copy ' + esc(lbl || 'commands') + '">Copy</button></div>';
  }
  function sourceLink(id) {
    var s = byId('sreSources', id);
    if (!s) return esc(id);
    return '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + '</a> <span class="muted small">(' + esc(s.status) + ')</span>';
  }
  function scrollWrap(svg) { return '<div class="diagram-scroll" tabindex="0" role="group" aria-label="Diagram (scrolls sideways on small screens)">' + svg + '</div>'; }

  var SECTIONS = [['path', 'Path'], ['map', 'Map'], ['diagnostic', 'Baseline'], ['modules', 'Modules'], ['labs', 'Labs'],
    ['designs', 'Designs'], ['reviews', 'Reviews'], ['evidence', 'Evidence'], ['branches', 'Branches'], ['setup', 'Setup']];
  var ui = { section: null, detail: null, sub: null, gate: null, diag: null, review: null, labTab: {}, hints: {}, solution: {} };

  /* ══ evidence model ═══════════════════════════════════════════════
     An attempt (curriculum §5): { id, activityId, contentVersion, seed, mode,
     assistance, startedAt, completedAt, hintsUsed, events, checks,
     explanation, reviewer, evidenceRefs, cleanupStatus, outcome, critical }.
     Content edits never overwrite one; a newer content version marks older
     attempts revalidationNeeded rather than deleting them. */
  function attemptsFor(activityId) {
    var s = st();
    return Object.keys(s.attempts).map(function (k) { return s.attempts[k]; })
      .filter(function (a) { return a.activityId === activityId; })
      .sort(function (a, b) { return (a.completedAt || a.startedAt) < (b.completedAt || b.startedAt) ? -1 : 1; });
  }
  function addAttempt(a) {
    var s = st();
    a.id = a.id || uid('att');
    a.contentVersion = a.contentVersion || version();
    a.recordedAt = now();
    s.attempts[a.id] = a;
    save(s);
    noteEvidence(a);
    return a;
  }
  function passed(a) { return !!a && a.outcome === 'passed' && !(a.critical && a.critical.length); }
  function independentPass(a) { return passed(a) && a.assistance === 'independent'; }
  function latest(arr) { return arr.length ? arr[arr.length - 1] : null; }
  function stale(a) { return !!a && !!a.contentVersion && a.contentVersion !== version(); }

  /* first evidence for an objective schedules its reviews */
  function objectivesOfActivity(activityId) {
    var out = [];
    list('sreObjectives').forEach(function (o) {
      (o.evidenceRequired || []).forEach(function (e) { if (e.split(':')[1] === activityId && out.indexOf(o.id) === -1) out.push(o.id); });
    });
    return out;
  }
  function noteEvidence(a) {
    if (!passed(a)) return;
    var s = st(), ids = objectivesOfActivity(a.activityId);
    ids.forEach(function (oid) {
      var r = s.reviews[oid] = s.reviews[oid] || { stage: 0, history: [] };
      r.lastDemonstratedAt = now();
      if (!r.due) r.due = addDays(track().reviewDays[0]);
    });
    save(s);
  }

  /* ── seeds (scenarios) ───────────────────────────────────────── */
  function firstSeed(m, mode) {
    var vars = (m.sre && m.sre.variants) || ['a'];
    var used = attemptsFor(m.sre.scenarioId).map(function (a) { return a.seed; });
    var fresh = vars.filter(function (v) { return used.indexOf(m.sre.scenarioId + '-variant-' + v) === -1; });
    var v = mode === 'independent' ? (fresh[0] || vars[used.length % vars.length]) : vars[0];
    return m.sre.scenarioId + '-variant-' + v;
  }
  function nextSeed(m, prev) {
    var vars = (m.sre && m.sre.variants) || ['a'];
    var cur = String(prev || '').replace(/^.*-variant-/, '');
    var i = vars.indexOf(cur);
    return m.sre.scenarioId + '-variant-' + vars[(i + 1) % vars.length];
  }
  function recordScenario(run, info) {
    var m = run.mission, o = m.sre;
    var rung34 = (run.hintLog || []).some(function (h) { return h.level >= 3; }) || run.revealed > 0;
    var a = {
      id: run.attemptId || uid('att'), activityId: o.scenarioId, moduleId: o.moduleId, kind: 'scenario', seed: run.seed,
      mode: 'simulation', uiMode: run.mode,
      assistance: run.mode === 'guided' ? 'guided' : (rung34 ? 'assisted' : 'independent'),
      startedAt: new Date(run.startedAt || Date.now()).toISOString(), completedAt: now(),
      hintsUsed: (run.hintLog || []).map(function (h) { return h.level; }),
      events: run.ran.slice(0, 400),
      checks: m.objectives.map(function (ob) { return { id: ob.id, passed: !!run.met[ob.id], observed: run.met[ob.id] ? 'met at command ' + run.metAt[ob.id] : 'not met' }; }),
      critical: (run.critical || []).map(function (u) { return u.label; }),
      reviewer: 'deterministic', evidenceRefs: [], cleanupStatus: 'not-applicable',
      outcome: info && info.outcome ? info.outcome : 'passed'
    };
    run.attemptId = a.id;
    addAttempt(a);
    return a;
  }

  /* ══ pass rules per module (curriculum §4) ═══════════════════════ */
  function gateBest(moduleId) {
    var s = st(), arr = s.gates[moduleId] || [];
    return arr.reduce(function (best, g) { return !best || g.pct > best.pct ? g : best; }, null);
  }
  function labStatus(labId) {
    var all = attemptsFor(labId), last = latest(all);
    var ok = all.some(passed), indep = all.some(independentPass);
    var variant = all.some(function (a) { return passed(a) && a.variant; });
    return { attempts: all, last: last, passed: ok, independent: indep, variant: variant, stale: all.some(stale) && !all.some(function (a) { return passed(a) && !stale(a); }) };
  }
  function scenarioStatus(sid) {
    var all = attemptsFor(sid);
    var guided = all.some(function (a) { return passed(a) && a.uiMode === 'guided'; });
    var indep = all.some(function (a) { return passed(a) && a.uiMode === 'independent'; });
    var indepClean = all.some(function (a) { return passed(a) && a.uiMode === 'independent' && a.assistance === 'independent'; });
    return { attempts: all, guided: guided, independent: indep, independentClean: indepClean, any: all.some(passed), critical: all.some(function (a) { return a.critical && a.critical.length; }) };
  }
  function moduleStatus(M) {
    var s = st(), g = gateBest(M.id), tr = track().pass;
    var conds = [];
    conds.push({ id: 'knowledge', label: 'Knowledge gate ≥ ' + tr.knowledgePct + '%', ok: !!(g && g.pct >= tr.knowledgePct), detail: g ? 'best ' + g.pct + '% (' + g.correct + '/' + g.total + ')' : 'not attempted', fix: { section: 'modules', detail: M.id, sub: 'gate' } });
    var labsOk = M.labs.map(function (id) { var ls = labStatus(id); return { id: id, ok: ls.passed, stale: ls.stale }; });
    conds.push({ id: 'practical', label: 'Required practical checks pass (' + M.labs.join(', ') + ')', ok: labsOk.every(function (x) { return x.ok; }), detail: labsOk.map(function (x) { return x.id + ': ' + (x.ok ? 'passed' : 'missing') + (x.stale ? ' (revalidation needed)' : ''); }).join(' · '), fix: { section: 'labs', detail: (labsOk.filter(function (x) { return !x.ok; })[0] || labsOk[0] || {}).id } });
    var scen = M.scenarios.map(function (id) { return { id: id, s: scenarioStatus(id) }; });
    var crit = scen.filter(function (x) { return x.s.critical && !x.s.any; }).concat(M.labs.filter(function (id) { var l = latest(attemptsFor(id)); return l && l.critical && l.critical.length; }).map(function (id) { return { id: id }; }));
    conds.push({ id: 'critical', label: 'No critical safety/data condition failed on the latest attempts', ok: crit.length === 0, detail: crit.length ? crit.map(function (x) { return x.id; }).join(', ') + ' have a failed critical check with no later pass' : 'clean', fix: { section: 'modules', detail: M.id, sub: 'practice' } });
    var db = s.debriefs[M.id];
    var explain = db && db.rubric && db.rubric.explain != null ? Number(db.rubric.explain) : null;
    conds.push({ id: 'explanation', label: 'Debrief explanation rubric ≥ ' + tr.explanationMin + '/4 (self-reviewed)', ok: explain != null && explain >= tr.explanationMin, detail: db ? (explain == null ? 'debrief saved, rubric not rated' : 'rated ' + explain + '/4' + (db.reviewer ? ' · ' + db.reviewer : '')) : 'no debrief yet', fix: { section: 'modules', detail: M.id, sub: 'debrief' } });
    var indep = scen.some(function (x) { return x.s.independentClean; }) || M.labs.some(function (id) { return labStatus(id).variant; });
    conds.push({ id: 'independent', label: 'A changed independent variant passed without solution-revealing hints', ok: indep, detail: scen.map(function (x) { return x.id + ': ' + (x.s.independentClean ? 'independent ✓' : x.s.independent ? 'independent (with rung 3–4 hints)' : x.s.guided ? 'guided only' : 'none'); }).join(' · '), fix: { section: 'modules', detail: M.id, sub: 'practice' } });
    var all = scen.every(function (x) { return x.s.any; });
    conds.push({ id: 'scenarios', label: 'Every scenario completed at least once (' + M.scenarios.join(', ') + ')', ok: all, detail: scen.map(function (x) { return x.id + (x.s.any ? ' ✓' : ' –'); }).join(' · '), fix: { section: 'modules', detail: M.id, sub: 'practice' } });
    if (M.designs.length) {
      var dOk = M.designs.every(function (id) { var d = s.designs[id]; return d && d.submitted; });
      conds.push({ id: 'designs', label: 'Design worksheet submitted (' + M.designs.join(', ') + ')', ok: dOk, detail: M.designs.map(function (id) { var d = s.designs[id]; return id + (d && d.submitted ? ' ✓' : ' –'); }).join(' · '), fix: { section: 'designs', detail: M.designs[0] } });
    }
    return { conds: conds, passed: conds.every(function (c) { return c.ok; }), started: conds.some(function (c) { return c.ok; }) || M.lessons.some(function (id) { return s.lessons[id] && s.lessons[id].studied; }) };
  }
  function prereqsMet(M) { return (M.prereqs || []).every(function (p) { var pm = mod(p); return !pm || moduleStatus(pm).passed; }); }

  /* item-level completion, for the path */
  function itemDone(it) {
    var s = st();
    switch (it.kind) {
      case 'lesson': return !!(s.lessons[it.id] && s.lessons[it.id].studied);
      case 'lab': { var ls = labStatus(it.id); if (it.variant) return ls.variant; if (it.checkpoint) { var l = latest(ls.attempts); return ls.passed || !!(l && l.checkpoints && l.checkpoints[it.checkpoint]); } return ls.passed; }
      case 'scenario': { var ss = scenarioStatus(it.id); return it.mode === 'independent' ? ss.independent : ss.any; }
      case 'gate': return !!(gateBest(it.id) && gateBest(it.id).pct >= track().pass.knowledgePct);
      case 'debrief': return !!(s.debriefs[it.id] && s.debriefs[it.id].saved);
      case 'teachback': return !!(s.debriefs[it.id] && s.debriefs[it.id].teachback);
      case 'design': return !!(s.designs[it.id] && s.designs[it.id].submitted);
      case 'diagnostic': return !!s.diagnostic.completedAt;
      case 'review': return it.id === 'final' ? !!s.flags.finalRecall : dueReviews().length === 0;
      case 'setup': return !!(s.flags.setup && s.flags.setup[it.id]);
      case 'recall': return true;
    }
    return false;
  }
  function itemTitle(it) {
    switch (it.kind) {
      case 'lesson': { var l = lesson(it.id); return l ? l.title : it.id; }
      case 'lab': { var L = lab(it.id); return it.id + (L ? ' · ' + L.title : '') + (it.checkpoint ? ' (checkpoint ' + it.checkpoint.replace('c', '') + ')' : '') + (it.variant ? ' · independent variant' : ''); }
      case 'scenario': { var m = scenarioMission(it.id); return it.id + (m ? ' · ' + m.sre.neutralTitle : '') + (it.mode ? ' · ' + it.mode : ''); }
      case 'gate': return 'Knowledge gate ' + it.id;
      case 'debrief': return 'Five-part debrief ' + it.id;
      case 'teachback': return '60–90 s teach-back ' + it.id;
      case 'design': { var d = design(it.id); return it.id + (d ? ' · ' + d.title : ''); }
      case 'diagnostic': return 'Baseline diagnostic (24 questions, 2 investigations, 1 Python attempt)';
      case 'review': return it.id === 'final' ? 'Delayed recall (final)' : 'Due reviews';
      case 'setup': return 'Environment setup: ' + it.id;
    }
    return it.kind + ' ' + it.id;
  }
  function itemMins(it) {
    switch (it.kind) {
      case 'lesson': return (lesson(it.id) || {}).mins || 12;
      case 'lab': { var L = lab(it.id); var n = (L && L.checkpoints && L.checkpoints.length) || 1; return it.variant ? 40 : Math.round(((L && L.estimatedMinutes) || 60) / n); }
      case 'scenario': return (scenarioMission(it.id) || {}).mins || 25;
      case 'gate': return 20; case 'debrief': return 15; case 'teachback': return 5; case 'design': return 40;
      case 'diagnostic': return 60; case 'review': return 15; case 'setup': return 20; case 'recall': return 10;
    }
    return 10;
  }
  function openItem(it) {
    if (it.kind === 'lesson') return go('modules', it.id);
    if (it.kind === 'lab') return go('labs', it.id);
    if (it.kind === 'scenario') { var m = scenarioMission(it.id); if (!m) { U().toast(it.id + ' is not implemented in this build'); return; } U().go('sandbox'); if (window.LXSandbox) window.LXSandbox.open(m.id, it.mode ? { mode: it.mode } : null); return; }
    if (it.kind === 'gate') { ui.sub = 'gate'; return go('modules', it.id); }
    if (it.kind === 'debrief' || it.kind === 'teachback') { ui.sub = 'debrief'; return go('modules', it.id); }
    if (it.kind === 'design') return go('designs', it.id);
    if (it.kind === 'diagnostic') return go('diagnostic');
    if (it.kind === 'review') return go('reviews');
    if (it.kind === 'setup') return go('setup', it.id);
  }

  /* where the learner is: the first week with something incomplete */
  function position() {
    var weeks = list('sreWeeks');
    for (var i = 0; i < weeks.length; i++) {
      var w = weeks[i];
      for (var j = 0; j < w.sessions.length; j++) {
        var sess = w.sessions[j];
        var open = sess.items.filter(function (it) { return !itemDone(it); });
        if (open.length) return { week: w, session: sess, sessionIndex: j, open: open, done: false };
      }
    }
    return { week: weeks[weeks.length - 1], session: null, sessionIndex: 0, open: [], done: true };
  }

  /* ══ shell ═══════════════════════════════════════════════════════ */
  function root() { return document.getElementById('view-sre'); }
  function render() {
    var el = root();
    if (!el) return;
    if (!list('sreModules').length) { el.innerHTML = '<p class="blurb">Loading the course…</p>'; return; }
    if (!ui.section) { var saved = st().ui || {}; ui.section = saved.section || 'path'; ui.detail = saved.detail || null; }
    if (!SECTIONS.some(function (x) { return x[0] === ui.section; })) ui.section = 'path';
    var due = dueReviews().length;
    var nav = '<div class="chips prep-nav" role="group" aria-label="Course sections">' + SECTIONS.map(function (x) {
      var on = x[0] === ui.section, extra = x[0] === 'reviews' && due ? ' (' + due + ')' : '';
      return '<button class="chip' + (on ? ' active' : '') + '" data-sre-section="' + x[0] + '" aria-pressed="' + on + '">' + esc(x[1] + extra) + '</button>';
    }).join('') + '</div>';
    var body = '';
    try { body = RENDER[ui.section](); } catch (e) { body = '<p class="empty">This section could not render: ' + esc(e.message) + '</p>'; if (window.console) console.error(e); }
    el.innerHTML = nav + '<div class="prep-body" id="sreBody">' + body + '</div>';
  }
  function go(section, detail, sub) {
    ui.section = section; ui.detail = detail || null; if (sub !== undefined) ui.sub = sub;
    var s = st(); s.ui = { section: section, detail: ui.detail }; save(s);
    render();
    window.scrollTo(0, 0);
  }

  /* ══ Path ════════════════════════════════════════════════════════ */
  function itemButton(it) {
    var done = itemDone(it);
    return '<li><button class="path-item' + (done ? ' done' : '') + '" data-sre-item="' + esc(JSON.stringify(it)) + '"><span class="pi-tick" aria-hidden="true">' + (done ? '✓' : '○') + '</span><span class="pi-kind">' + esc(it.kind) + (it.mode ? ' · ' + esc(it.mode) : '') + ' · ' + itemMins(it) + ' min</span><span class="pi-title">' + esc(itemTitle(it)) + '</span><span class="sr-only">' + (done ? ' — has evidence' : ' — not yet') + '</span></button></li>';
  }
  function renderPath() {
    var T = track(), pos = position(), s = st(), due = dueReviews();
    var M = mod(pos.week.moduleId);
    var pre = (M.prereqs || []).map(function (p) { var pm = mod(p); return { id: p, title: pm.title, ok: moduleStatus(pm).passed }; });
    var remaining = moduleStatus(M).conds.filter(function (c) { return !c.ok; });
    var nextItems = pos.session ? pos.session.items : [];
    var sessMins = nextItems.reduce(function (a, it) { return a + itemMins(it); }, 0);
    var html = '<p class="blurb"><b>' + esc(T.title) + '</b> · ' + T.weeks + ' learning weeks · ' + T.hours + ' hours at about 3.5 h/week (roughly 56 weeks at 3 h, 42 at 4 h). Learning-week numbers, not dates; no streaks, no penalties. Optional cloud work and branches are separate and labelled.</p>';
    if (!s.diagnostic.completedAt) html += '<p class="verify-note">Start with the <button class="linkish" data-sre-go="diagnostic">baseline</button> (weeks 1–2). It measures each domain and suggests where to place effort; it never awards mastery.</p>';
    html += '<article class="card path-card next"><div class="card-main">' +
      '<p class="muted small time-slot">Now · learning week ' + pos.week.n + ' of ' + T.weeks + ' · ' + esc(M.id + ' ' + M.title) + '</p>' +
      '<p class="card-title plain">' + (pos.done ? 'Every scheduled item has evidence.' : 'Next session: ' + esc(pos.session.title) + ' (' + sessMins + ' min, session ' + (pos.sessionIndex + 1) + ' of ' + pos.week.sessions.length + ')') + '</p>' +
      '<div class="card-meta">' + badge('~' + sessMins + ' min') + badge(due.length ? due.length + ' review' + (due.length === 1 ? '' : 's') + ' due' : 'no reviews due', due.length ? 'next' : '') + badge(remaining.length + ' pass condition' + (remaining.length === 1 ? '' : 's') + ' remaining for ' + M.id) + '</div>' +
      (nextItems.length ? '<ul class="path-items">' + nextItems.map(itemButton).join('') + '</ul>' : '') +
      label('Prerequisite concepts for ' + M.id) + (pre.length ? ul(pre, function (p) { return '<button class="linkish" data-sre-module="' + esc(p.id) + '">' + esc(p.id + ' ' + p.title) + '</button> ' + (p.ok ? badge('passed', 'done') : badge('recommended first — still browseable')); }) : '<p class="muted small">None — this is where the course starts.</p>') +
      '<p class="muted small">Concepts in play: ' + esc((M.concepts || []).join(' · ')) + '</p>' +
      label('Evidence remaining for ' + M.id) + (remaining.length ? ul(remaining, function (c) { return '<button class="linkish" data-sre-fix="' + esc(JSON.stringify(c.fix)) + '">' + esc(c.label) + '</button> <span class="muted small">' + esc(c.detail) + '</span>'; }) : '<p class="muted small">All pass conditions met for this module.</p>') +
      '</div></article>';
    html += label('Week shape (210 minutes, split into three 70-minute sessions)') +
      '<p class="muted small">Retrieval ' + T.weekShape.retrieval + ' · concepts ' + T.weekShape.concepts + ' · local lab ' + T.weekShape.lab + ' · simulated incident ' + T.weekShape.scenario + ' · tests, explanation and evidence ' + T.weekShape.assess + ' · debugging buffer ' + T.weekShape.buffer + '. A capstone or design week rebalances the same total. No mandatory session exceeds 90 minutes.</p>';
    html += label('The 48 weeks') + '<p class="muted small">Any later lesson can be opened at any time; prerequisites are a recommendation shown on each module, not a lock.</p>';
    var curMod = null;
    list('sreWeeks').forEach(function (w) {
      if (w.moduleId !== curMod) { curMod = w.moduleId; var mm = mod(curMod), ms = moduleStatus(mm); html += '<h3 class="prep-h3"><button class="linkish" data-sre-module="' + esc(mm.id) + '">' + esc(mm.id + ' · ' + mm.title) + '</button> <span class="muted small">weeks ' + mm.weeks[0] + '–' + mm.weeks[mm.weeks.length - 1] + ' · ' + mm.hours + ' h</span> ' + (ms.passed ? badge('passed', 'done') : ms.started ? badge('in progress') : '') + '</h3>'; }
      var all = w.sessions.reduce(function (a, se) { return a.concat(se.items); }, []);
      var done = all.filter(itemDone).length;
      var isNow = w.n === pos.week.n;
      html += '<details class="brief-wrap week' + (isNow ? ' now' : '') + '"' + (isNow ? ' open' : '') + '><summary>Week ' + w.n + ' · ' + esc(w.title) + ' <span class="muted small">' + done + '/' + all.length + '</span></summary><div class="situation">' +
        '<p class="muted small">' + esc(w.main) + '<br><b>Save as evidence:</b> ' + esc(w.evidence) + '</p>' +
        w.sessions.map(function (se, i) { return '<p class="small"><b>Session ' + (i + 1) + ' · ' + esc(se.title) + '</b></p><ul class="path-items">' + se.items.map(itemButton).join('') + '</ul>'; }).join('') + '</div></details>';
    });
    return html;
  }

  /* ══ Map ═════════════════════════════════════════════════════════ */
  function renderMap() {
    var T = track(), total = list('sreModules').reduce(function (a, m) { return a + m.hours; }, 0);
    return '<p class="blurb">A compact map of the core path. Hours sum to ' + total + ' (' + T.hours + ' planned); optional branches and cloud extensions are excluded from the total.</p>' +
      '<div class="table-wrap"><table class="tiers"><caption class="sr-only">Curriculum map</caption><thead><tr><th scope="col">Module</th><th scope="col">Weeks</th><th scope="col">Hours</th><th scope="col">Exercises</th><th scope="col">Needs</th><th scope="col">Status</th></tr></thead><tbody>' +
      list('sreModules').map(function (m) {
        var ms = moduleStatus(m);
        return '<tr><th scope="row"><button class="linkish" data-sre-module="' + esc(m.id) + '">' + esc(m.id + ' ' + m.title) + '</button></th><td>' + m.weeks[0] + '–' + m.weeks[m.weeks.length - 1] + '</td><td>' + m.hours + '</td><td class="small">' + esc(m.labs.join(', ') + ' · ' + m.scenarios.join(', ') + (m.designs.length ? ' · ' + m.designs.join(', ') : '')) + '</td><td class="small">' + esc((m.prereqs || []).join(', ') || '—') + '</td><td>' + (ms.passed ? badge('passed', 'done') : ms.started ? badge('in progress') : badge('not started')) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      label('Progression') + '<p class="muted small">Explain → predict → guided build → break/fix → independent variant → teach back → delayed recall, for every skill. Simulated execution (sandbox), real local work (your machine, evidence imported) and optional cloud work (opt-in, off by default) are always labelled apart.</p>' +
      label('Optional branches and cloud extensions') + ul(list('sreBranches').map(function (b) { return b.id + ' ' + b.title + ' (' + b.hours[0] + '–' + b.hours[1] + ' h)'; }).concat(list('sreCloud').map(function (c) { return c.id + ' ' + c.title + ' (' + c.hours + ', cloud, opt-in)'; }))) +
      '<p class="muted small">Branches replace optional review time or follow the core; they never add to the 168 hours silently.</p>';
  }

  /* ══ Diagnostic ══════════════════════════════════════════════════ */
  function domainName(id) { var D = LX.sreDiagnostic; var d = D && D.domains.filter(function (x) { return x.id === id; })[0]; return d ? d.label : id; }
  function renderDiagnostic() {
    var D = LX.sreDiagnostic, s = st(), d = s.diagnostic;
    if (!D) return '<p class="empty">The diagnostic has not shipped in this build.</p>';
    if (d.completedAt && ui.diag !== 'review') return diagnosticReport(D, d);
    var ans = d.answers || {};
    var html = (d.completedAt ? '<button class="btn ghost small prep-back" data-sre-go="diagnostic">← Back to the report</button>' : '') + '<p class="blurb">' + inline(D.intro) + '</p><p class="verify-note">Skip anything unfamiliar — "I don\'t know yet" is a valid and useful answer. Nothing here requires installing the later stack. Scores are per domain, never one label, and a high score suggests placement; it does not award a module. Challenging out of a module always requires an unseen practical variant and an explanation.</p>';
    html += label('Part 1 · 24 short questions') + D.questions.map(function (q, i) {
      var a = ans[q.id];
      return '<article class="card"><div class="card-main"><p class="card-sum"><b>' + (i + 1) + '.</b> ' + badge(domainName(q.domain)) + ' ' + inline(q.q) + '</p>' +
        (q.context ? '<pre class="term term-static">' + esc(q.context) + '</pre>' : '') +
        '<div class="choices" role="group" aria-label="Answers for question ' + (i + 1) + '">' + q.choices.map(function (c, ci) {
          return '<button class="choice' + (a === ci ? ' picked' : '') + '" data-sre-diag="' + esc(q.id) + ':' + ci + '" aria-pressed="' + (a === ci) + '">' + inline(c) + '</button>';
        }).join('') + '<button class="choice' + (a === 'skip' ? ' picked' : '') + '" data-sre-diag="' + esc(q.id) + ':skip" aria-pressed="' + (a === 'skip') + '">I don\'t know yet</button></div></div></article>';
    }).join('');
    html += label('Part 2 · two short investigations') + D.practicals.map(function (p) {
      var r = ans[p.id] || {};
      return '<article class="card"><div class="card-main"><p class="card-title plain">' + esc(p.title) + ' ' + badge(domainName(p.domain)) + '</p>' + md(p.brief) +
        (p.evidence ? '<pre class="term term-static">' + esc(p.evidence) + '</pre>' : '') +
        '<label class="prep-label" for="diag-' + esc(p.id) + '">What do you conclude, and what single check would confirm it?</label>' +
        '<textarea id="diag-' + esc(p.id) + '" class="notes-input" rows="4" data-sre-diagtext="' + esc(p.id) + '">' + esc(r.text || '') + '</textarea>' +
        '<p class="muted small">After writing, compare with the checklist and tick what you covered (self-assessed):</p><div class="checklist">' + p.checklist.map(function (c, ci) {
          return '<label><input type="checkbox" data-sre-diagcheck="' + esc(p.id) + ':' + ci + '"' + ((r.checks || [])[ci] ? ' checked' : '') + '> ' + inline(c) + '</label>';
        }).join('') + '</div></div></article>';
    }).join('');
    var py = ans.python || {};
    html += label('Part 3 · a 20-minute Python attempt (on your machine)') + '<article class="card"><div class="card-main">' + md(D.python.brief) +
      copyPre(D.python.starter, 'starter') + '<p class="muted small">' + inline(D.python.run) + '</p>' +
      '<div class="chips" role="group" aria-label="Python result">' + [['passed', 'All tests passed'], ['partial', 'Some tests passed'], ['none', 'Could not finish'], ['skip', 'Skipped for now']].map(function (o) {
        return '<button class="chip' + (py.result === o[0] ? ' active' : '') + '" data-sre-diagpy="' + o[0] + '" aria-pressed="' + (py.result === o[0]) + '">' + esc(o[1]) + '</button>'; }).join('') + '</div>' +
      '<p class="muted small">Self-reported: the app cannot run your Python. The result only shifts the Python placement suggestion.</p></div></article>';
    html += '<div class="done-btns"><button class="btn primary" data-sre-diagsubmit>Score the baseline</button><span class="muted small">Answers are saved as you go.</span></div>';
    return html;
  }
  function diagnosticScore(D, ans) {
    return D.domains.map(function (dom) {
      var qs = D.questions.filter(function (q) { return q.domain === dom.id; });
      var right = qs.filter(function (q) { return ans[q.id] === q.a; }).length;
      var skipped = qs.filter(function (q) { return ans[q.id] == null || ans[q.id] === 'skip'; }).length;
      var pr = D.practicals.filter(function (p) { return p.domain === dom.id; });
      var prScore = pr.length ? pr.reduce(function (a, p) { var r = ans[p.id] || {}; var c = (r.checks || []).filter(Boolean).length; return a + c / p.checklist.length; }, 0) / pr.length : null;
      var py = dom.id === 'python' ? (ans.python || {}).result : null;
      var pct = qs.length ? Math.round(right / qs.length * 100) : 0;
      var level = pct >= 75 && skipped === 0 && (prScore == null || prScore >= 0.6) && (py == null || py === 'passed') ? 'strong' : pct >= 50 ? 'some' : 'start-here';
      return { id: dom.id, label: dom.label, right: right, total: qs.length, skipped: skipped, pct: pct, practical: prScore, python: py, level: level, modules: dom.moduleIds };
    });
  }
  function diagnosticReport(D, d) {
    var sc = diagnosticScore(D, d.answers || {});
    return '<p class="blurb">Baseline scored on ' + esc(String(d.completedAt).slice(0, 10)) + '. Per domain, never one global label. "Strong" means the course may be able to move faster there — but challenging out of a module still requires that module\'s unseen practical variant and explanation, never a quiz score alone.</p>' +
      '<div class="table-wrap"><table class="tiers"><thead><tr><th scope="col">Domain</th><th scope="col">Questions</th><th scope="col">Skipped</th><th scope="col">Investigation</th><th scope="col">Suggestion</th></tr></thead><tbody>' +
      sc.map(function (x) {
        var sug = x.level === 'strong' ? 'Keep normal pace or attempt the module\'s independent variant early to challenge out' : x.level === 'some' ? 'Normal pace; expect to lean on the guided mode first' : 'Start here with full lessons and guided practice';
        return '<tr><th scope="row">' + esc(x.label) + '</th><td>' + x.right + '/' + x.total + '</td><td>' + x.skipped + '</td><td>' + (x.practical == null ? (x.python ? esc('python: ' + x.python) : '—') : Math.round(x.practical * 100) + '% of checklist') + '</td><td class="small">' + esc(sug) + ' <span class="muted">(' + esc(x.modules.join(', ')) + ')</span></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="done-btns"><button class="btn ghost small" data-sre-diagreview>Review my answers</button><button class="btn ghost small" data-sre-diagretake>Retake (keeps this result in history)</button></div>' +
      label('Answer key and rationale') + D.questions.map(function (q, i) {
        var a = (d.answers || {})[q.id];
        return '<details class="brief-wrap"><summary>' + (i + 1) + '. ' + inline(q.q) + ' ' + (a === q.a ? badge('correct', 'done') : a == null || a === 'skip' ? badge('skipped') : badge('missed')) + '</summary><div class="situation"><p><b>Answer:</b> ' + inline(q.choices[q.a]) + '</p><p>' + inline(q.why) + '</p></div></details>';
      }).join('');
  }

  /* ══ Modules ═════════════════════════════════════════════════════ */
  function renderModules() {
    if (ui.detail && lesson(ui.detail)) return renderLesson(lesson(ui.detail));
    if (ui.detail && mod(ui.detail)) return renderModule(mod(ui.detail));
    return '<p class="blurb">Sixteen modules. Each: why it matters, four to six short lessons with a mental model, a worked example, misconceptions and a recall exercise, then a guided local lab, a related simulated incident, an independent variant, a debrief and delayed reviews. A read lesson is exposure, not mastery.</p><div class="list">' +
      list('sreModules').map(function (m) {
        var ms = moduleStatus(m), s = st(), read = m.lessons.filter(function (id) { return s.lessons[id] && s.lessons[id].studied; }).length;
        return '<article class="card lab-card"><div class="card-head"><div class="card-main"><p class="card-title plain">' + esc(m.id + ' · ' + m.title) + '</p><p class="card-sum">' + esc(m.outcomes[0]) + '</p>' +
          '<div class="card-meta">' + badge('weeks ' + m.weeks[0] + '–' + m.weeks[m.weeks.length - 1]) + badge(m.hours + ' h') + badge(read + '/' + m.lessons.length + ' lessons read') + (ms.passed ? badge('passed', 'done') : badge(ms.conds.filter(function (c) { return c.ok; }).length + '/' + ms.conds.length + ' pass conditions')) + (!prereqsMet(m) && m.prereqs.length ? badge('recommended after ' + m.prereqs.join(', ')) : '') + '</div></div>' +
          '<button class="lab-go" data-sre-module="' + esc(m.id) + '" aria-label="Open ' + esc(m.id) + '">▶</button></div></article>';
      }).join('') + '</div>';
  }
  function renderModule(M) {
    var s = st(), ms = moduleStatus(M), sub = ui.sub || 'overview';
    var tabs = [['overview', 'Overview'], ['lessons', 'Lessons'], ['practice', 'Lab & incidents'], ['gate', 'Gate'], ['debrief', 'Debrief'], ['evidence', 'Evidence']];
    var html = back('modules') + '<p class="muted small">Module ' + M.n + ' of 16 · weeks ' + M.weeks.join(', ') + ' · ' + M.hours + ' hours · ' + esc(LX.track.catName(M.cat, 'sre')) + '</p>' +
      '<h2 class="prep-h">' + esc(M.id + ' · ' + M.title) + '</h2>' +
      '<div class="card-meta">' + (ms.passed ? badge('passed', 'done') : badge(ms.conds.filter(function (c) { return c.ok; }).length + '/' + ms.conds.length + ' pass conditions')) + (M.prereqs.length ? badge((prereqsMet(M) ? '' : 'recommended after ') + M.prereqs.join(', ')) : badge('no prerequisites')) + '</div>' +
      '<div class="chips" role="group" aria-label="Module sections">' + tabs.map(function (t) { return '<button class="chip' + (sub === t[0] ? ' active' : '') + '" data-sre-sub="' + t[0] + '" aria-pressed="' + (sub === t[0]) + '">' + esc(t[1]) + '</button>'; }).join('') + '</div>';
    if (sub === 'overview') {
      html += label('Why this matters') + md(M.why) + label('Measurable outcomes') + ul(M.outcomes) + label('Concepts') + '<p class="muted small">' + esc(M.concepts.join(' · ')) + '</p>' +
        label('Skill objectives') + ul(M.objectives.map(objective).filter(Boolean), function (o) { return '<b>' + esc(o.title) + '</b> — ' + inline(o.observableOutcome) + ' <span class="muted small">evidence: ' + esc((o.evidenceRequired || []).join(', ')) + '</span>'; }) +
        label('Schedule') + ul(weeksOf(M.id), function (w) { return '<b>Week ' + w.n + '</b> · ' + esc(w.title) + ' — ' + esc(w.main); }) +
        label('Sources') + ul(M.sources || [], sourceLink);
    } else if (sub === 'lessons') {
      html += '<p class="muted small">Each lesson: objective, prerequisites, reading time, mental model, worked example, misconception, a short recall/prediction exercise before any commands, and a reference. Mark one studied only after the recall exercise.</p><div class="list">' +
        M.lessons.map(function (id, i) {
          var l = lesson(id); if (!l) return '<article class="card"><div class="card-main"><p class="empty">' + esc(id) + ' not authored yet</p></div></article>';
          var r = s.lessons[id] || {};
          return '<article class="card lab-card"><div class="card-head"><div class="card-main"><p class="card-title plain">' + (i + 1) + '. ' + esc(l.title) + '</p><p class="card-sum">' + inline(l.objective) + '</p><div class="card-meta">' + badge('~' + l.mins + ' min read') + (r.studied ? badge('✓ studied', 'done') : '') + (r.recall ? badge('recall ' + Object.keys(r.recall).filter(function (k) { return r.recall[k]; }).length + '/' + (l.recall || []).length) : '') + '</div></div><button class="lab-go" data-sre-lesson="' + esc(id) + '" aria-label="Open lesson">▶</button></div></article>';
        }).join('') + '</div>';
    } else if (sub === 'practice') {
      html += label('Local labs (real work on your machine; evidence imported)') + '<div class="list">' + M.labs.map(function (id) {
        var L = lab(id), ls = labStatus(id);
        return '<article class="card lab-card"><div class="card-head"><div class="card-main"><p class="card-title plain">' + esc(id) + (L ? ' · ' + esc(L.title) : '') + '</p>' + (L ? '<p class="card-sum">' + inline(L.learnerBrief.split('\n')[0]) + '</p>' : '') + '<div class="card-meta">' + badge('local', 'sim') + (L ? badge('~' + L.estimatedMinutes + ' min') + badge(L.environmentProfile) + badge(L.status) : '') + (ls.passed ? badge('✓ passed', 'done') : '') + (ls.variant ? badge('✓ independent variant', 'done') : '') + '</div></div><button class="lab-go" data-sre-lab="' + esc(id) + '" aria-label="Open lab">▶</button></div></article>';
      }).join('') + '</div>' +
        label('Simulated incidents (bounded model in the sandbox)') + '<div class="list">' + M.scenarios.map(function (sid) {
          var m = scenarioMission(sid), ss = scenarioStatus(sid);
          if (!m) return '<article class="card"><div class="card-main"><p class="empty">' + esc(sid) + ' not implemented yet</p></div></article>';
          return '<article class="card lab-card"><div class="card-head"><div class="card-main"><p class="card-title plain">' + esc(sid + ' · ' + m.sre.neutralTitle) + '</p><p class="card-sum">' + esc(m.sre.impact) + '</p><div class="card-meta">' + badge('simulation', 'sim') + badge('~' + m.mins + ' min') + badge((m.sre.variants || []).length + ' variants') + (ss.guided ? badge('✓ guided', 'done') : '') + (ss.independentClean ? badge('✓ independent · no rung 3–4 hints', 'done') : ss.independent ? badge('✓ independent · with hints', 'done') : '') + (ss.critical && !ss.any ? badge('failed a critical check') : '') + '</div></div><button class="lab-go" data-sre-scenario="' + esc(sid) + '" aria-label="Open scenario">▶</button></div></article>';
        }).join('') + '</div>' +
        (M.designs.length ? label('Design workshop') + '<div class="list">' + M.designs.map(function (id) { var d = design(id), r = s.designs[id] || {}; return '<article class="card lab-card"><div class="card-head"><div class="card-main"><p class="card-title plain">' + esc(id) + (d ? ' · ' + esc(d.title) : '') + '</p><div class="card-meta">' + badge('design') + (d ? badge('~' + d.timeboxMins + ' min first draft') : '') + (r.submitted ? badge('✓ submitted', 'done') : '') + '</div></div><button class="lab-go" data-sre-design="' + esc(id) + '" aria-label="Open design">▶</button></div></article>'; }).join('') + '</div>' : '') +
        '<p class="muted small">Modes are never mixed: a simulation shows reasoning in a model; a local lab is real work the app cannot see, so its result is imported evidence; optional cloud work is separate and off by default.</p>';
    } else if (sub === 'gate') {
      html += renderGate(M);
    } else if (sub === 'debrief') {
      html += renderDebrief(M);
    } else {
      html += label('Pass conditions for ' + M.id) + '<div class="table-wrap"><table class="tiers"><thead><tr><th scope="col">Condition</th><th scope="col">State</th><th scope="col">Detail</th></tr></thead><tbody>' +
        ms.conds.map(function (c) { return '<tr><th scope="row">' + esc(c.label) + '</th><td>' + (c.ok ? badge('met', 'done') : badge('not yet')) + '</td><td class="small">' + esc(c.detail) + (c.ok ? '' : ' · <button class="linkish" data-sre-fix="' + esc(JSON.stringify(c.fix)) + '">go</button>') + '</td></tr>'; }).join('') + '</tbody></table></div>' +
        label('Objectives') + '<div class="table-wrap"><table class="tiers"><thead><tr><th scope="col">Objective</th><th scope="col">Exposure</th><th scope="col">Guided</th><th scope="col">Independent</th><th scope="col">Review</th></tr></thead><tbody>' +
        M.objectives.map(function (oid) { var o = objective(oid); if (!o) return ''; var t = objectiveTiers(o); return '<tr><th scope="row">' + esc(o.title) + '</th><td>' + (t.exposure ? '✓' : '–') + '</td><td>' + (t.guided ? '✓' : '–') + '</td><td>' + (t.independent ? '✓' : '–') + '</td><td class="small">' + esc(t.review) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
        '<p class="muted small">Exposure = lessons studied. Guided = a guided scenario or assisted lab attempt. Independent = an independent scenario without rung 3–4 hints, or an imported lab result marked independent. Review = next delayed-recall date.</p>';
    }
    return html;
  }
  function objectiveTiers(o) {
    var s = st();
    var lessons = list('sreLessons').filter(function (l) { return (l.objectiveIds || []).indexOf(o.id) !== -1; });
    var exposure = lessons.length > 0 && lessons.every(function (l) { return s.lessons[l.id] && s.lessons[l.id].studied; });
    var guided = false, independent = false;
    (o.evidenceRequired || []).forEach(function (e) {
      var p = e.split(':'), kind = p[0], id = p[1];
      if (kind === 'scenario') { var ss = scenarioStatus(id); guided = guided || ss.any; independent = independent || ss.independentClean; }
      if (kind === 'lab') { var ls = labStatus(id); guided = guided || ls.passed || !!ls.last; independent = independent || ls.independent; }
      if (kind === 'gate') { var g = gateBest(id); guided = guided || !!g; independent = independent || !!(g && g.pct >= track().pass.knowledgePct); }
      if (kind === 'design') { var d = s.designs[id]; guided = guided || !!(d && d.saved); independent = independent || !!(d && d.submitted); }
    });
    var r = s.reviews[o.id];
    return { exposure: exposure, guided: guided, independent: independent, review: r ? (r.due <= ymd() ? 'due' : 'due ' + r.due) + ' · stage ' + r.stage : 'no evidence yet' };
  }

  /* ── Lesson ──────────────────────────────────────────────────── */
  function renderLesson(l) {
    var s = st(), r = s.lessons[l.id] || {}, M = mod(l.moduleId);
    var pre = (l.prereqs || []).map(lesson).filter(Boolean);
    return '<button class="btn ghost small prep-back" data-sre-module="' + esc(l.moduleId) + '" data-sre-subgo="lessons">← ' + esc(l.moduleId) + ' lessons</button>' +
      '<p class="muted small">' + esc(M.id + ' · ' + M.title) + ' · ~' + l.mins + ' min</p><h2 class="prep-h">' + esc(l.title) + '</h2>' +
      '<p class="lead"><b>Objective.</b> ' + inline(l.objective) + '</p>' +
      (pre.length ? '<p class="muted small">Builds on: ' + pre.map(function (p) { return '<button class="linkish" data-sre-lesson="' + esc(p.id) + '">' + esc(p.title) + '</button>'; }).join(', ') + '</p>' : '') +
      label('Mental model') + '<div class="tip">' + md(l.model) + '</div>' +
      (l.diagram ? '<figure class="diagram">' + scrollWrap(l.diagram) + (l.diagramCaption ? '<figcaption>' + inline(l.diagramCaption) + '</figcaption>' : '') + '</figure>' : '') +
      l.sections.map(function (sec) { return '<h3 class="prep-h3">' + esc(sec.h) + '</h3>' + md(sec.body); }).join('') +
      label('Worked example') + '<h3 class="prep-h3">' + esc(l.example.h) + '</h3>' + md(l.example.body) +
      label('Common misconceptions') + ul(l.misconceptions, function (m) { return '<b>' + inline(m.wrong) + '</b> → ' + inline(m.right); }) +
      label('Recall and prediction (answer before you look)') + '<ol class="steps-why">' + (l.recall || []).map(function (q, i) {
        var shown = !!(r.recallShown && r.recallShown[i]);
        return '<li>' + inline(q.q) + (shown ? '<div class="tip"><b>Answer.</b> ' + inline(q.a) + '</div><label class="small"><input type="checkbox" data-sre-recall="' + esc(l.id) + ':' + i + '"' + (r.recall && r.recall[i] ? ' checked' : '') + '> I had this right (self-assessed)</label>' : ' <button class="btn ghost small" data-sre-recallshow="' + esc(l.id) + ':' + i + '">Show answer</button>') + '</li>';
      }).join('') + '</ol>' +
      label('References') + ul(l.refs || [], sourceLink) +
      '<div class="done-btns"><button class="btn' + (r.studied ? ' ghost' : ' primary') + '" data-sre-studied="' + esc(l.id) + '" aria-pressed="' + !!r.studied + '">' + (r.studied ? '✓ Studied (click to unmark)' : 'Mark studied') + '</button><span class="muted small">Studied is exposure, not mastery.</span></div>';
  }

  /* ── Gate ────────────────────────────────────────────────────── */
  function shuffleWith(seed, arr) {
    var a = arr.slice(), x = window.LXSim ? LXSim.fnv(seed) : seed.length * 7919;
    for (var i = a.length - 1; i > 0; i--) { x = (x * 1103515245 + 12345) >>> 0; var j = x % (i + 1); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function renderGate(M) {
    var s = st(), hist = s.gates[M.id] || [], bank = questionsFor(M.id, 'bank'), gatePool = questionsFor(M.id, 'gate');
    if (!ui.gate || ui.gate.moduleId !== M.id) {
      return '<p class="blurb">The knowledge gate for ' + esc(M.id) + ': ' + M.gate.questions + ' questions drawn from a bank of ' + bank.length + ' items plus ' + gatePool.length + ' unseen gate variants (repeat attempts draw the variants, not the items you have seen). Pass mark ' + M.gate.passPct + '%. Mixed styles: diagnosis, predict the output, order the steps, short explanation (rubric, self-reviewed) and selected response. Every answer shows a rationale and misconception feedback.</p>' +
        (hist.length ? label('Attempts') + ul(hist, function (g) { return esc(g.at.slice(0, 10)) + ' · ' + g.correct + '/' + g.total + ' (' + g.pct + '%) ' + (g.pct >= M.gate.passPct ? badge('pass', 'done') : badge('below ' + M.gate.passPct + '%')) + (g.failedObjectives && g.failedObjectives.length ? ' · remediation: ' + g.failedObjectives.map(function (o) { return esc((objective(o) || {}).title || o); }).join(', ') : ''); }) : '') +
        '<div class="done-btns"><button class="btn primary" data-sre-gatestart="' + esc(M.id) + '">' + (hist.length ? 'Attempt again (unseen variants first)' : 'Start the gate') + '</button></div>' +
        (bank.length < 8 ? '<p class="verify-note">Bank incomplete in this build (' + bank.length + ' of 8 minimum).</p>' : '');
    }
    var g = ui.gate, q = g.items[g.i];
    if (!q) return gateSummary(M, g);
    var html = '<p class="muted small">Question ' + (g.i + 1) + ' of ' + g.items.length + ' · ' + esc(q.type) + ' · difficulty ' + q.difficulty + '/3</p><div class="progress"><div class="progress-fill" style="width:' + Math.round(g.i / g.items.length * 100) + '%"></div></div>';
    html += '<p class="quiz-q">' + inline(q.q) + '</p>' + (q.context ? '<pre class="term term-static">' + esc(q.context) + '</pre>' : '');
    var ans = g.answers[q.id];
    if (q.type === 'order') {
      var order = g.shuffled[q.id] || (g.shuffled[q.id] = shuffleWith(g.seed + q.id, q.steps.map(function (_, i) { return i; })));
      var picks = ans ? ans.order : (g.pickOrder || []);
      html += '<p class="muted small">Tap the steps in the order you would do them. Tap a chosen step to remove it.</p><div class="order-slots">' + picks.map(function (i, n) { return '<button class="slot' + (ans ? (i === n ? ' right' : ' wrong') : '') + '" data-sre-orderpick="' + i + '"' + (ans ? ' disabled' : '') + '>' + (n + 1) + '. ' + inline(q.steps[i]) + '</button>'; }).join('') + '</div><div class="choices">' + order.filter(function (i) { return picks.indexOf(i) === -1; }).map(function (i) { return '<button class="choice" data-sre-orderpick="' + i + '"' + (ans ? ' disabled' : '') + '>' + inline(q.steps[i]) + '</button>'; }).join('') + '</div>' +
        (!ans && picks.length === q.steps.length ? '<button class="btn primary" data-sre-ordersubmit>Check order</button>' : '');
    } else if (q.type === 'explain') {
      html += '<label class="prep-label" for="gateExplain">Your answer (2–5 sentences)</label><textarea id="gateExplain" class="notes-input" rows="5"' + (ans ? ' disabled' : '') + '>' + esc(ans ? ans.text : (g.draft[q.id] || '')) + '</textarea>' +
        (!ans ? '<button class="btn primary" data-sre-explainsubmit>Compare with the rubric</button>' : '');
    } else {
      var order2 = g.shuffled[q.id] || (g.shuffled[q.id] = shuffleWith(g.seed + q.id, q.choices.map(function (_, i) { return i; })));
      html += '<div class="choices">' + order2.map(function (i) { return '<button class="choice' + (ans && ans.pick === i ? (i === q.a ? ' right' : ' wrong') : '') + (ans && i === q.a ? ' right' : '') + '" data-sre-gatepick="' + i + '"' + (ans ? ' disabled' : '') + '>' + inline(q.choices[i]) + '</button>'; }).join('') + '</div>';
    }
    if (ans) {
      if (q.type === 'explain') {
        html += '<div class="tip"><b>Rubric.</b>' + ul(q.rubric) + (q.answer ? '<p><b>Model answer.</b> ' + inline(q.answer) + '</p>' : '') + '</div>' +
          '<p class="muted small">Rate your answer against the rubric (self-reviewed; this counts toward the gate only as you rate it):</p><div class="chips" role="group" aria-label="Self rating">' + [0, 1, 2, 3, 4].map(function (n) { return '<button class="chip' + (ans.rating === n ? ' active' : '') + '" data-sre-explainrate="' + n + '" aria-pressed="' + (ans.rating === n) + '">' + n + '</button>'; }).join('') + '</div><p class="muted small">' + esc(track().rubricLevels.join(' · ')) + '</p>';
      } else {
        html += '<p class="feedback ' + (ans.ok ? 'ok' : 'bad') + '"><b>' + (ans.ok ? 'Correct.' : 'Not quite.') + '</b> ' + inline(q.rationale) + '</p>' + (!ans.ok && q.misconception ? '<p class="muted small"><b>Likely misconception:</b> ' + inline(q.misconception) + '</p>' : '');
      }
      html += '<p class="muted small">Objective: ' + esc(q.objectiveIds.map(function (o) { return (objective(o) || {}).title || o; }).join(', ')) + ' · remediation: <button class="linkish" data-sre-lesson="' + esc(q.remediation) + '">' + esc((lesson(q.remediation) || {}).title || q.remediation) + '</button></p>' +
        '<button class="btn primary" data-sre-gatenext>' + (g.i + 1 < g.items.length ? 'Next' : 'Finish') + '</button>';
    }
    html += '<p class="muted small"><button class="linkish" data-sre-gatequit>Quit without saving</button></p>';
    return html;
  }
  function startGate(M) {
    var s = st(), hist = s.gates[M.id] || [];
    var seen = {}; hist.forEach(function (g) { (g.items || []).forEach(function (it) { seen[it.id] = 1; }); });
    var bank = questionsFor(M.id, 'bank'), gatePool = questionsFor(M.id, 'gate');
    var seed = M.id + ':' + hist.length + ':' + ymd();
    /* first attempt: bank items; later attempts: unseen gate variants first, then unseen bank, then anything */
    var pool = hist.length ? gatePool.filter(function (q) { return !seen[q.id]; }).concat(bank.filter(function (q) { return !seen[q.id]; }), gatePool, bank) : bank.concat(gatePool);
    var uniq = [], ids = {};
    (hist.length ? pool : shuffleWith(seed, pool)).forEach(function (q) { if (!ids[q.id]) { ids[q.id] = 1; uniq.push(q); } });
    var items = uniq.slice(0, M.gate.questions);
    ui.gate = { moduleId: M.id, items: items, i: 0, answers: {}, shuffled: {}, draft: {}, seed: seed, pickOrder: [], startedAt: now() };
  }
  function gateSummary(M, g) {
    var items = g.items, correct = 0, failedObj = {}, rows = [];
    items.forEach(function (q) {
      var a = g.answers[q.id] || {}, ok = q.type === 'explain' ? (a.rating != null && a.rating >= 3) : !!a.ok;
      if (ok) correct++; else q.objectiveIds.forEach(function (o) { failedObj[o] = 1; });
      rows.push({ q: q, ok: ok, a: a });
    });
    var pct = items.length ? Math.round(correct / items.length * 100) : 0, passedGate = pct >= M.gate.passPct;
    if (!g.saved) {
      var s = st(); s.gates[M.id] = s.gates[M.id] || [];
      s.gates[M.id].push({ at: now(), correct: correct, total: items.length, pct: pct, passed: passedGate, seed: g.seed, items: rows.map(function (r) { return { id: r.q.id, ok: r.ok, type: r.q.type, rating: r.a.rating }; }), failedObjectives: Object.keys(failedObj), contentVersion: version() });
      save(s); g.saved = true;
      if (passedGate) noteEvidence({ activityId: M.id, outcome: 'passed' });
    }
    return '<h3 class="prep-h3">' + correct + ' / ' + items.length + ' (' + pct + '%) · ' + (passedGate ? 'pass' : 'below ' + M.gate.passPct + '%') + '</h3>' +
      (Object.keys(failedObj).length ? label('Exactly which objectives need work') + ul(Object.keys(failedObj), function (o) { var ob = objective(o); var ls = list('sreLessons').filter(function (l) { return (l.objectiveIds || []).indexOf(o) !== -1; }); return '<b>' + esc(ob ? ob.title : o) + '</b> → ' + ls.map(function (l) { return '<button class="linkish" data-sre-lesson="' + esc(l.id) + '">' + esc(l.title) + '</button>'; }).join(', ') + (ob ? ' · then an easier guided run of ' + esc((ob.evidenceRequired || []).filter(function (e) { return /^scenario/.test(e); }).map(function (e) { return e.split(':')[1]; }).join(', ') || 'the module scenario') + ', then a changed variant' : ''); }) : '<p class="muted">Every objective in this attempt answered correctly.</p>') +
      '<p class="muted small">Explanation items count as correct at a self-rating of 3/4 or more; they are labelled self-reviewed in your evidence.</p>' +
      '<div class="done-btns"><button class="btn primary" data-sre-gatequit>Back to the module</button></div>';
  }

  /* ── Debrief (five-part template + teach-back + rubric) ───────── */
  function renderDebrief(M) {
    var s = st(), d = s.debriefs[M.id] || { parts: {}, rubric: {} }, T = track();
    return '<p class="blurb">' + inline(M.debriefPrompt) + '</p><p class="muted small">The five-part debrief is the habit this course cares most about: explaining what you did instead of rushing to a fix and forgetting it. Write it from your own lab/scenario notes; then do the teach-back out loud.</p>' +
      T.debrief.map(function (p) { return '<label class="prep-label" for="db-' + p.id + '">' + esc(p.label) + '</label><p class="muted small">' + esc(p.prompt) + '</p><textarea id="db-' + p.id + '" class="notes-input" rows="3" data-sre-debrief="' + esc(M.id) + ':' + p.id + '">' + esc((d.parts || {})[p.id] || '') + '</textarea>'; }).join('') +
      label('Teach-back (' + T.teachBack.seconds[0] + '–' + T.teachBack.seconds[1] + ' seconds, out loud)') + '<p>' + esc(T.teachBack.prompt) + '</p>' +
      '<div class="done-btns"><button class="btn small" data-sre-timer="' + T.teachBack.seconds[1] + '">Start ' + T.teachBack.seconds[1] + ' s timer</button><span id="sreTimer" class="mock-timer" aria-live="polite"></span>' +
      '<label class="small"><input type="checkbox" data-sre-teachback="' + esc(M.id) + '"' + (d.teachback ? ' checked' : '') + '> I did the teach-back</label></div>' +
      label('Rubric (0–4, self-reviewed)') + '<p class="muted small">' + esc(T.rubricLevels.join(' · ')) + '</p>' +
      T.rubric.map(function (r) { return '<div class="rubric"><span>' + esc(r.label) + '</span><div class="chips" role="group" aria-label="' + esc(r.label) + '">' + [0, 1, 2, 3, 4].map(function (n) { var on = (d.rubric || {})[r.id] != null && Number(d.rubric[r.id]) === n; return '<button class="chip' + (on ? ' active' : '') + '" data-sre-rubric="' + esc(M.id) + ':' + r.id + ':' + n + '" aria-pressed="' + on + '">' + n + '</button>'; }).join('') + '</div></div>'; }).join('') +
      '<p class="muted small">Reviewer: <b>' + esc(d.reviewer || 'self') + '</b>. No mentor or AI review is available in this build, so the rubric is a structured self-review and is labelled that way wherever it counts. The pass rule needs "Explanation and tradeoffs" ≥ ' + T.pass.explanationMin + '.</p>' +
      '<div class="done-btns"><button class="btn primary" data-sre-debriefsave="' + esc(M.id) + '">Save debrief</button>' + (d.saved ? badge('saved ' + String(d.at || '').slice(0, 10), 'done') : '') + '</div>';
  }

  /* ══ Labs ════════════════════════════════════════════════════════ */
  function renderLabs() {
    if (ui.detail && lab(ui.detail)) return renderLab(lab(ui.detail));
    return '<p class="blurb">Thirty-two local labs under <code>labs/sre-cloud-foundations/</code>. These run on <b>your machine</b> (Apple Silicon Mac with an ARM64 Linux VM, a container engine and kind); the app never runs them and never pretends to. Each lab has setup, fault injection where relevant, a validator that queries real state and writes an evidence JSON, reset, teardown, checkpoints for pause/resume, staged hints and a worked solution. Import the evidence here.</p>' +
      '<p class="verify-note">Imported reports are inspectable learner evidence, not attested execution. Validation scripts exit non-zero when a required check fails, and an unmodified broken lab must fail them.</p><div class="list">' +
      list('sreLabs').map(function (L) {
        var ls = labStatus(L.id);
        return '<article class="card lab-card"><div class="card-head"><div class="card-main"><p class="card-title plain">' + esc(L.id + ' · ' + L.title) + '</p><p class="card-sum">' + esc(L.moduleId) + ' · ' + inline(L.learnerBrief.split('\n')[0]) + '</p><div class="card-meta">' + badge(L.executionMode === 'cloud' ? 'cloud (opt-in)' : 'local', 'sim') + badge('~' + L.estimatedMinutes + ' min') + badge(L.environmentProfile) + badge(L.status) + (ls.passed ? badge('✓ passed', 'done') : ls.last ? badge('attempted') : '') + (ls.stale ? badge('revalidation needed') : '') + '</div></div><button class="lab-go" data-sre-lab="' + esc(L.id) + '" aria-label="Open ' + esc(L.id) + '">▶</button></div></article>';
      }).join('') + '</div>';
  }
  function renderLab(L) {
    var ls = labStatus(L.id), tab = ui.labTab[L.id] || 'brief', last = ls.last;
    var tabs = [['brief', 'Brief'], ['run', 'Run'], ['hints', 'Hints'], ['evidence', 'Evidence'], ['solution', 'Solution']];
    var dir = 'labs/sre-cloud-foundations/' + L.id;
    var html = back('labs') + '<p class="muted small">' + esc(L.moduleId) + ' · ' + esc(L.executionMode) + ' · ' + esc(L.environmentProfile) + ' · ~' + L.estimatedMinutes + ' min · v' + esc(L.version) + ' · ' + esc(L.status) + '</p><h2 class="prep-h">' + esc(L.id + ' · ' + L.title) + '</h2>' +
      '<div class="card-meta">' + (ls.passed ? badge('✓ passed', 'done') : '') + (ls.variant ? badge('✓ independent variant', 'done') : '') + (ls.stale ? badge('content changed since your last pass — revalidation needed') : '') + '</div>' +
      '<div class="chips" role="group" aria-label="Lab sections">' + tabs.map(function (t) { return '<button class="chip' + (tab === t[0] ? ' active' : '') + '" data-sre-labtab="' + esc(L.id) + ':' + t[0] + '" aria-pressed="' + (tab === t[0]) + '">' + esc(t[1]) + '</button>'; }).join('') + '</div>';
    if (tab === 'brief') {
      html += md(L.learnerBrief) + label('Objectives') + ul(L.objectiveIds.map(objective).filter(Boolean), function (o) { return '<b>' + esc(o.title) + '</b> — ' + inline(o.observableOutcome); }) +
        (L.prerequisites.length ? label('Prerequisites') + ul(L.prerequisites, function (p) { var pl = lab(p); return pl ? '<button class="linkish" data-sre-lab="' + esc(p) + '">' + esc(p + ' · ' + pl.title) + '</button>' + (labStatus(p).passed ? ' ' + badge('passed', 'done') : '') : esc(p); }) : '') +
        label('What this lab proves, and what it does not') + ul(L.limits || []) +
        label('Checkpoints (pause and resume)') + ul(L.checkpoints, function (c) { return '<b>' + esc(c.id) + ' · ' + esc(c.title) + '</b> — ' + inline(c.resumeInstructions); }) +
        label('Files') + '<p class="muted small"><code>' + esc(dir) + '/</code>: ' + esc((L.assetPaths || []).join(', ')) + '</p>' +
        label('Sources') + ul(L.sourceIds || [], sourceLink);
    } else if (tab === 'run') {
      var section = function (title, cmds, note) { return cmds && cmds.length ? label(title) + (note ? '<p class="muted small">' + inline(note) + '</p>' : '') + copyPre(cmds.join('\n'), title) : ''; };
      html += '<p class="verify-note">Run from the repository root on your machine. Every script scopes itself to <code>looped-*</code> names and refuses other contexts; nothing deletes outside the lab. Copy, paste, read the output.</p>' +
        section('Setup', L.setup) + section('Fault injection', L.faultInjection, 'Fixture-controlled faults are labelled in the README; they are not real infrastructure failures.') +
        label('Tasks') + '<ol class="steps-why">' + L.tasks.map(function (t) { return '<li>' + inline(t) + '</li>'; }).join('') + '</ol>' +
        label('Validation (queries real state; non-zero exit on failure)') + ul(L.validation, function (v) { return '<code>' + esc(v.id) + '</code> — ' + inline(v.description) + (v.critical ? ' ' + badge('critical') : ''); }) +
        copyPre('python3 ' + dir + '/validate.py --out ' + dir + '/evidence/latest.json', 'validate') +
        section('Reset (this lab\'s disposable state only)', L.reset) + section('Teardown', L.teardown) +
        label('Independent variant') + md(L.variant && L.variant.brief ? L.variant.brief : 'See VARIANT.md in the lab directory.') + (L.variant && L.variant.command ? copyPre(L.variant.command, 'variant') : '');
    } else if (tab === 'hints') {
      var shown = ui.hints[L.id] || 0;
      html += '<p class="muted small">Four rungs: boundary → evidence source → discriminating command → root cause and fix. Rungs 3–4 end independent credit for the attempt you import next; say so in the report (assistance: assisted).</p>' +
        '<ol class="steps-why">' + L.hints.slice(0, shown).map(function (h) { return '<li><b>Rung ' + h.level + '.</b> ' + inline(h.text) + '</li>'; }).join('') + '</ol>' +
        (shown < L.hints.length ? '<button class="btn small" data-sre-labhint="' + esc(L.id) + '">Show rung ' + (shown + 1) + ' of ' + L.hints.length + '</button>' : '<p class="muted small">All rungs shown.</p>');
    } else if (tab === 'evidence') {
      html += label('How to submit') + ul(L.evidenceInstructions) +
        '<p class="muted small">Evidence contract: lab id, content version, environment and tool versions, variant seed, start/end time, checks with observations, assistance, explanation, cleanup status. Sanitised excerpts only — never tokens, credentials or real customer logs. The importer validates field sizes and types and renders everything as text.</p>' +
        '<label class="prep-label" for="evJson">Paste the evidence JSON written by validate.py</label><textarea id="evJson" class="data-box" rows="8" spellcheck="false" data-sre-evjson="' + esc(L.id) + '"></textarea>' +
        '<div class="done-btns"><button class="btn primary" data-sre-evimport="' + esc(L.id) + '">Import evidence</button></div><p id="evMsg" class="count" hidden></p>' +
        label('Or report without a JSON (self-reported)') +
        '<div class="chips" role="group" aria-label="Self report">' + [['guided', 'Completed with the solution open'], ['assisted', 'Completed with hints'], ['independent', 'Completed independently']].map(function (o) { return '<button class="chip" data-sre-evself="' + esc(L.id) + ':' + o[0] + '">' + esc(o[1]) + '</button>'; }).join('') + '</div>' +
        '<p class="muted small">A self-report records an attempt with <b>no checks</b> and reviewer "self"; it shows in your evidence as self-reported and does not satisfy the practical pass condition on its own.</p>' +
        label('Attempts for ' + L.id) + (ls.attempts.length ? '<div class="table-wrap"><table class="tiers"><thead><tr><th scope="col">When</th><th scope="col">Outcome</th><th scope="col">Assistance</th><th scope="col">Seed</th><th scope="col">Checks</th><th scope="col">Cleanup</th><th scope="col">Version</th></tr></thead><tbody>' + ls.attempts.map(function (a) {
          return '<tr><td class="small">' + esc(String(a.completedAt || a.startedAt || '').slice(0, 16).replace('T', ' ')) + '</td><td>' + (passed(a) ? badge('passed', 'done') : badge(a.outcome || 'recorded')) + (a.variant ? badge('variant') : '') + '</td><td class="small">' + esc(a.assistance) + ' · ' + esc(a.reviewer) + '</td><td class="small">' + esc(a.seed || '—') + '</td><td class="small">' + (a.checks || []).map(function (c) { return (c.passed ? '✓ ' : '✗ ') + esc(c.id) + (c.observed ? ' <span class="muted">(' + esc(String(c.observed).slice(0, 80)) + ')</span>' : ''); }).join('<br>') + '</td><td class="small">' + esc(a.cleanupStatus || '—') + '</td><td class="small">' + esc(a.contentVersion) + (stale(a) ? ' · revalidate' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="muted small">None yet.</p>') +
        (last && last.explanation ? label('Latest explanation') + '<p>' + esc(last.explanation) + '</p>' : '');
    } else {
      var open = !!ui.solution[L.id];
      html += '<p class="muted small">The worked solution lives at <code>' + esc(dir) + '/' + esc(L.solutionRef) + '</code>. Opening it here marks your next imported attempt as assisted unless you say otherwise in the report. A client-only app cannot keep downloaded files secret; the point is learning integrity, not a proctored exam.</p>' +
        (open ? '<div class="tip">' + md(L.solution || 'Read ' + L.solutionRef + ' in the lab directory.') + '</div>' : '<button class="btn small" data-sre-solution="' + esc(L.id) + '">Show the worked solution</button>');
    }
    return html;
  }
  /* evidence import: schema and size validation, text-only rendering */
  function importEvidence(L, text) {
    var p;
    try { p = JSON.parse(text); } catch (e) { return { ok: false, err: 'Not valid JSON.' }; }
    if (!p || typeof p !== 'object' || Array.isArray(p)) return { ok: false, err: 'Not an evidence object.' };
    var errs = [];
    var str = function (k, max, req) { var v = p[k]; if (v == null) { if (req) errs.push(k + ' is required'); return; } if (typeof v !== 'string') errs.push(k + ' must be a string'); else if (v.length > max) errs.push(k + ' is longer than ' + max + ' characters'); };
    str('schemaVersion', 10, true); str('trackId', 40, true); str('activityId', 10, true); str('contentVersion', 20, true);
    str('executionMode', 20, true); str('assistance', 20, true); str('seed', 80); str('explanation', 4000); str('cleanupStatus', 20); str('startedAt', 40); str('completedAt', 40);
    if (p.trackId && p.trackId !== track().id) errs.push('trackId is "' + p.trackId + '", expected "' + track().id + '"');
    if (p.activityId && p.activityId !== L.id) errs.push('activityId is "' + p.activityId + '", this is ' + L.id);
    if (['local', 'cloud', 'simulation'].indexOf(p.executionMode) === -1) errs.push('executionMode must be local, cloud or simulation');
    if (['guided', 'assisted', 'independent', 'self-reported'].indexOf(p.assistance) === -1) errs.push('assistance must be guided, assisted, independent or self-reported');
    if (p.cleanupStatus != null && ['verified', 'reported', 'pending', 'not-applicable'].indexOf(p.cleanupStatus) === -1) errs.push('cleanupStatus must be verified, reported, pending or not-applicable');
    if (!Array.isArray(p.checks)) errs.push('checks must be an array');
    else if (p.checks.length > 64) errs.push('too many checks');
    else p.checks.forEach(function (c, i) { if (!c || typeof c.id !== 'string' || c.id.length > 60 || typeof c.passed !== 'boolean') errs.push('checks[' + i + '] needs a string id and boolean passed'); if (c && c.observed != null && (typeof c.observed !== 'string' || c.observed.length > 600)) errs.push('checks[' + i + '].observed must be a string under 600 characters'); });
    if (p.environment != null && (typeof p.environment !== 'object' || JSON.stringify(p.environment).length > 2000)) errs.push('environment must be a small object');
    if (/(AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer [A-Za-z0-9._-]{20,})/.test(text)) errs.push('the report appears to contain a credential; sanitise it before importing');
    /* the evidence-example.json shipped with each lab documents the schema; it is never a result */
    if (typeof p.note === 'string' && /example|schema/i.test(p.note)) errs.push('this is the lab\'s example file (its note says so), not a report from validate.py; run the validator and import its output');
    if (errs.length) return { ok: false, err: errs.join('; ') };
    var required = L.validation.map(function (v) { return v.id; });
    var byId_ = {}; p.checks.forEach(function (c) { byId_[c.id] = c; });
    var missing = required.filter(function (id) { return !byId_[id]; });
    var failedCritical = L.validation.filter(function (v) { return v.critical && byId_[v.id] && !byId_[v.id].passed; }).map(function (v) { return v.id; });
    var failedAny = p.checks.filter(function (c) { return !c.passed; }).map(function (c) { return c.id; });
    var outcome = missing.length || failedAny.length ? 'failed' : 'passed';
    var a = addAttempt({
      activityId: L.id, moduleId: L.moduleId, kind: 'lab', contentVersion: p.contentVersion, seed: p.seed || null,
      mode: p.executionMode, assistance: p.assistance, startedAt: p.startedAt || now(), completedAt: p.completedAt || now(),
      hintsUsed: Array.isArray(p.hintsUsed) ? p.hintsUsed.slice(0, 10).map(Number) : [], events: [],
      checks: p.checks.map(function (c) { return { id: c.id, passed: c.passed, observed: c.observed ? String(c.observed).slice(0, 600) : '' }; }),
      explanation: p.explanation ? String(p.explanation).slice(0, 4000) : '', reviewer: 'deterministic', evidenceRefs: Array.isArray(p.evidenceRefs) ? p.evidenceRefs.slice(0, 20).map(function (x) { return String(x).slice(0, 200); }) : [],
      cleanupStatus: p.cleanupStatus || 'pending', environment: p.environment || null, outcome: outcome, critical: failedCritical,
      variant: !!(p.seed && /variant/i.test(p.seed) && !/variant-a$|default/i.test(p.seed)),
      importedAt: now(), note: missing.length ? 'missing required checks: ' + missing.join(', ') : ''
    });
    return { ok: true, outcome: outcome, missing: missing, failed: failedAny, critical: failedCritical, stale: p.contentVersion !== version(), id: a.id };
  }

  /* ══ Designs ═════════════════════════════════════════════════════ */
  function renderDesigns() {
    if (ui.detail && design(ui.detail)) return renderDesign(design(ui.detail));
    var s = st();
    return '<p class="blurb">Six system-design workshops on one-page worksheets: requirements and unknowns; load and data estimates with units; request and data flow; trust and failure boundaries; choices and rejected alternatives; observability; deployment and rollback; recovery; cost; open risks. Timebox the first draft to 30–45 minutes, revisit after the paired lab. Evaluation tests reasoning, not matching one diagram.</p><div class="list">' +
      list('sreDesigns').map(function (d) { var r = s.designs[d.id] || {}; return '<article class="card lab-card"><div class="card-head"><div class="card-main"><p class="card-title plain">' + esc(d.id + ' · ' + d.title) + '</p><p class="card-sum">' + esc(d.moduleId) + ' · ' + inline(d.brief.split('\n')[0]) + '</p><div class="card-meta">' + badge('~' + d.timeboxMins + ' min draft') + (r.saved ? badge('draft saved') : '') + (r.submitted ? badge('✓ submitted · rubric self-reviewed', 'done') : '') + '</div></div><button class="lab-go" data-sre-design="' + esc(d.id) + '" aria-label="Open ' + esc(d.id) + '">▶</button></div></article>'; }).join('') + '</div>';
  }
  function renderDesign(d) {
    var s = st(), r = s.designs[d.id] || { fields: {}, rubric: {}, must: {} }, T = track();
    return back('designs') + '<p class="muted small">' + esc(d.moduleId) + ' · design workshop · ~' + d.timeboxMins + ' min first draft</p><h2 class="prep-h">' + esc(d.id + ' · ' + d.title) + '</h2>' +
      label('Brief') + md(d.brief) + label('Required tradeoffs and evidence') + ul(d.mustAddress) +
      (d.estimates ? label('Numbers you are given') + ul(d.estimates) : '') +
      label('Worksheet') + d.worksheet.map(function (f) { return '<label class="prep-label" for="dw-' + esc(f.id) + '">' + esc(f.label) + '</label><p class="muted small">' + inline(f.prompt) + '</p><textarea id="dw-' + esc(f.id) + '" class="notes-input" rows="3" data-sre-dfield="' + esc(d.id) + ':' + esc(f.id) + '">' + esc((r.fields || {})[f.id] || '') + '</textarea>'; }).join('') +
      label('Did you address each required tradeoff? (self-checked)') + '<div class="checklist">' + d.mustAddress.map(function (m, i) { return '<label><input type="checkbox" data-sre-dmust="' + esc(d.id) + ':' + i + '"' + ((r.must || {})[i] ? ' checked' : '') + '> ' + inline(m) + '</label>'; }).join('') + '</div>' +
      '<div class="done-btns"><button class="btn" data-sre-dsave="' + esc(d.id) + '">Save draft</button>' + (r.saved ? badge('draft saved', 'done') : '') + '</div>' +
      (r.saved ? label('Reference discussion (one strong answer, not the only one)') + '<details class="brief-wrap"><summary>Show after your draft is saved</summary><div class="situation">' + md(d.reference) + (d.diagram ? '<figure class="diagram">' + scrollWrap(d.diagram) + '</figure>' : '') + '</div></details>' +
        label('Rubric (0–4, self-reviewed)') + d.rubric.map(function (rb) { return '<div class="rubric"><span>' + esc(rb.label) + '</span><div class="chips" role="group" aria-label="' + esc(rb.label) + '">' + [0, 1, 2, 3, 4].map(function (n) { var on = (r.rubric || {})[rb.id] === n; return '<button class="chip' + (on ? ' active' : '') + '" data-sre-drubric="' + esc(d.id) + ':' + esc(rb.id) + ':' + n + '" aria-pressed="' + on + '">' + n + '</button>'; }).join('') + '</div><p class="muted small">' + esc(rb.levels ? rb.levels.join(' · ') : T.rubricLevels.join(' · ')) + '</p></div>'; }).join('') +
        '<div class="done-btns"><button class="btn primary" data-sre-dsubmit="' + esc(d.id) + '">Submit worksheet</button>' + (r.submitted ? badge('submitted ' + String(r.at || '').slice(0, 10), 'done') : '') + '<span class="muted small">Self-reviewed; no AI or mentor grading in this build.</span></div>' : '');
  }

  /* ══ Reviews (1 / 7 / 21 / 45 days) ══════════════════════════════ */
  var SESSION_CAP = 8;
  function dueReviews() {
    var s = st(), t = ymd();
    return Object.keys(s.reviews).filter(function (oid) { return s.reviews[oid].due && s.reviews[oid].due <= t && objective(oid); })
      .sort(function (a, b) { return s.reviews[a].due < s.reviews[b].due ? -1 : 1; });
  }
  function reviewItemFor(oid, stage) {
    var items = list('sreReviews').filter(function (r) { return (r.objectiveIds || []).indexOf(oid) !== -1; });
    if (items.length) return items[stage % items.length];
    var ls = list('sreLessons').filter(function (l) { return (l.objectiveIds || []).indexOf(oid) !== -1 && (l.recall || []).length; });
    if (ls.length) { var l = ls[stage % ls.length], q = l.recall[stage % l.recall.length]; return { id: 'recall:' + l.id, kind: 'recall', prompt: q.q, answer: q.a, objectiveIds: [oid] }; }
    var o = objective(oid);
    return { id: 'obj:' + oid, kind: 'recall', prompt: 'Explain, in two sentences, how you would demonstrate: ' + o.observableOutcome, answer: o.title, objectiveIds: [oid] };
  }
  function renderReviews() {
    var s = st(), due = dueReviews(), T = track();
    if (ui.review) return renderReviewSession();
    var upcoming = Object.keys(s.reviews).filter(function (oid) { return s.reviews[oid].due && s.reviews[oid].due > ymd() && objective(oid); }).sort(function (a, b) { return s.reviews[a].due < s.reviews[b].due ? -1 : 1; }).slice(0, 10);
    return '<p class="blurb">Delayed reviews at ' + T.reviewDays.join(', ') + ' days after an objective first has evidence. Overdue items stay available without penalty; a session takes at most ' + SESSION_CAP + ' so reviews never eat the week\'s new learning. A review is a changed symptom or a short recall task, not the same multiple-choice question.</p>' +
      '<div class="stat-row"><div class="stat-tile"><span class="stat-n">' + due.length + '</span><span class="stat-l">due now</span></div><div class="stat-tile"><span class="stat-n">' + Object.keys(s.reviews).length + '</span><span class="stat-l">objectives with evidence</span></div><div class="stat-tile"><span class="stat-n">' + Object.keys(s.reviews).filter(function (k) { return s.reviews[k].stage >= T.reviewDays.length; }).length + '</span><span class="stat-l">completed the 45-day cycle</span></div></div>' +
      (due.length ? '<div class="done-btns"><button class="btn primary" data-sre-reviewstart>Review ' + Math.min(SESSION_CAP, due.length) + ' now</button></div>' : '<p class="muted">Nothing due. Conceptual familiarity and practical evidence are shown separately under Evidence.</p>') +
      (upcoming.length ? label('Coming up') + ul(upcoming, function (oid) { var r = s.reviews[oid]; return esc(r.due) + ' · ' + esc(objective(oid).title) + ' <span class="muted small">(stage ' + r.stage + ', last demonstrated ' + esc(String(r.lastDemonstratedAt || '').slice(0, 10)) + ')</span>'; }) : '') +
      label('History') + '<p class="muted small">Rescheduling never deletes history; each grade is appended.</p>' + ul(Object.keys(s.reviews).filter(function (k) { return (s.reviews[k].history || []).length; }).slice(0, 12), function (oid) { var r = s.reviews[oid]; return esc(objective(oid).title) + ': ' + r.history.map(function (h) { return esc(h.at.slice(0, 10) + ' ' + h.grade); }).join(', '); });
  }
  function startReviews() {
    var due = dueReviews().slice(0, SESSION_CAP), s = st();
    ui.review = { queue: due.map(function (oid) { return { oid: oid, item: reviewItemFor(oid, (s.reviews[oid].stage || 0) + (s.reviews[oid].history || []).length) }; }), i: 0, shown: false, done: 0 };
  }
  function renderReviewSession() {
    var r = ui.review, cur = r.queue[r.i];
    if (!cur) { var n = r.done; ui.review = null; return '<h3 class="prep-h3">Session complete · ' + n + ' reviewed</h3>' + '<div class="done-btns"><button class="btn primary" data-sre-go="reviews">Back</button></div>'; }
    var o = objective(cur.oid), it = cur.item;
    return '<p class="muted small">Review ' + (r.i + 1) + ' of ' + r.queue.length + ' · ' + esc(o.title) + ' · ' + esc(it.kind === 'changed-symptom' ? 'changed symptom' : 'recall') + '</p>' +
      '<div class="flash-front"><p>' + inline(it.prompt) + '</p>' + (it.context ? '<pre class="term term-static">' + esc(it.context) + '</pre>' : '') + '</div>' +
      (r.shown ? '<div class="flash-back"><p><b>Answer.</b> ' + inline(it.answer) + '</p></div><div class="grades"><button class="grade again" data-sre-grade="again">Again<span>tomorrow</span></button><button class="grade good" data-sre-grade="good">Good<span>next stage</span></button></div>' : '<button class="btn primary" data-sre-reviewshow>Show answer</button>') +
      '<p class="muted small"><button class="linkish" data-sre-reviewquit>Stop for now (progress kept)</button></p>';
  }
  function gradeReview(grade) {
    var r = ui.review, cur = r.queue[r.i], s = st(), T = track(), rec = s.reviews[cur.oid];
    rec.history = rec.history || []; rec.history.push({ at: now(), grade: grade, item: cur.item.id });
    if (grade === 'good') { rec.stage = Math.min((rec.stage || 0) + 1, T.reviewDays.length); rec.lastDemonstratedAt = now(); rec.due = rec.stage >= T.reviewDays.length ? addDays(T.reviewDays[T.reviewDays.length - 1]) : addDays(T.reviewDays[rec.stage]); }
    else { rec.due = addDays(1); rec.lapses = (rec.lapses || 0) + 1; }
    save(s);
    r.i++; r.shown = false; r.done++;
  }

  /* ══ Evidence ════════════════════════════════════════════════════ */
  function renderEvidence() {
    var T = track();
    var objs = list('sreObjectives'), tiers = objs.map(objectiveTiers);
    var n = function (k) { return tiers.filter(function (t) { return t[k]; }).length; };
    var labsP = list('sreLabs').filter(function (L) { return labStatus(L.id).passed; }).length;
    var scenG = list('missions').filter(function (m) { return m.sre && scenarioStatus(m.sre.scenarioId).guided; }).length;
    var scenI = list('missions').filter(function (m) { return m.sre && scenarioStatus(m.sre.scenarioId).independentClean; }).length;
    return '<p class="blurb">Evidence in separate tiers, labelled for what it is. No readiness score and no hiring probability: role coverage below shows which objectives a posting touches and what evidence you have, nothing more.</p>' +
      '<div class="table-wrap"><table class="tiers"><thead><tr><th scope="col">Tier</th><th scope="col">Count</th><th scope="col">What it means</th></tr></thead><tbody>' +
      '<tr><th scope="row">Exposure</th><td>' + n('exposure') + ' / ' + objs.length + '</td><td class="small">Every lesson for the objective marked studied. Self-marked.</td></tr>' +
      '<tr><th scope="row">Guided practice</th><td>' + n('guided') + ' / ' + objs.length + '</td><td class="small">A guided scenario, a gate attempt, or a lab attempt with any assistance.</td></tr>' +
      '<tr><th scope="row">Independent evidence</th><td>' + n('independent') + ' / ' + objs.length + '</td><td class="small">An independent scenario without rung 3–4 hints, a passing gate, an imported lab result marked independent, or a submitted design.</td></tr>' +
      '<tr><th scope="row">Labs passed (imported)</th><td>' + labsP + ' / ' + list('sreLabs').length + '</td><td class="small">Validator JSON imported with every required check passing. Learner-imported, not attested.</td></tr>' +
      '<tr><th scope="row">Scenarios guided / independent</th><td>' + scenG + ' / ' + scenI + '</td><td class="small">Simulation evidence. Mechanism reasoning in a bounded model.</td></tr>' +
      '<tr><th scope="row">Reviews due</th><td>' + dueReviews().length + '</td><td class="small">Delayed recall waiting.</td></tr>' +
      '</tbody></table></div>' +
      label('Modules') + '<div class="table-wrap"><table class="tiers"><thead><tr><th scope="col">Module</th><th scope="col">Gate</th><th scope="col">Labs</th><th scope="col">Scenarios</th><th scope="col">Debrief</th><th scope="col">Pass</th></tr></thead><tbody>' +
      list('sreModules').map(function (M) { var ms = moduleStatus(M), g = gateBest(M.id); var c = function (id) { return ms.conds.filter(function (x) { return x.id === id; })[0]; }; return '<tr><th scope="row"><button class="linkish" data-sre-module="' + esc(M.id) + '">' + esc(M.id) + '</button></th><td>' + (g ? g.pct + '%' : '–') + '</td><td>' + (c('practical').ok ? '✓' : '–') + '</td><td>' + (c('independent').ok ? '✓ indep' : c('scenarios').ok ? 'all once' : '–') + '</td><td>' + (c('explanation').ok ? '✓' : '–') + '</td><td>' + (ms.passed ? badge('passed', 'done') : '–') + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      label('Role coverage (coverage aid, not a probability)') + list('sreRoles').map(function (r) {
        var ids = r.objectiveIds || [], have = ids.filter(function (id) { var o = objective(id); return o && objectiveTiers(o).independent; }).length;
        return '<details class="brief-wrap"><summary>' + esc(r.id + ' · ' + r.title) + ' <span class="muted small">' + (ids.length ? have + '/' + ids.length + ' objectives with independent evidence' : 'unmapped') + ' · evidence: ' + esc(r.evidence) + '</span></summary><div class="situation">' +
          (ids.length ? ul(ids, function (id) { var o = objective(id); if (!o) return esc(id); var t = objectiveTiers(o); return esc(o.title) + ' — ' + (t.independent ? badge('independent', 'done') : t.guided ? badge('guided') : t.exposure ? badge('exposure') : badge('none')); }) : '<p class="muted small">No requirements were recovered for this role, so nothing is mapped. Blank stays blank.</p>') +
          (r.gaps && r.gaps.length ? '<p class="muted small"><b>Not supplied by this course:</b> ' + esc(r.gaps.join('; ')) + '</p>' : '') + '</div></details>';
      }).join('') +
      label('Honesty') + ul(T.honesty) +
      label('Your course data') + '<p class="muted small">Attempts live in <code>lx.sre</code>, separate from content; Review → Your progress → Export includes them. A content version change marks older attempts "revalidation needed" instead of deleting them.</p>' +
      '<div class="done-btns"><button class="btn small ghost" data-sre-export>Show course evidence JSON</button><button class="btn small ghost" data-sre-rollback>Roll back the last storage migration</button></div><textarea id="sreExport" class="data-box" rows="6" hidden aria-label="Course evidence export"></textarea><p id="sreExportMsg" class="count" hidden></p>';
  }

  /* ══ Branches and cloud opt-in ═══════════════════════════════════ */
  function renderBranches() {
    var s = st();
    if (ui.detail && byId('sreBranches', ui.detail)) return renderBranch(byId('sreBranches', ui.detail));
    if (ui.detail && byId('sreCloud', ui.detail)) return renderCloud(byId('sreCloud', ui.detail));
    return '<p class="blurb">Optional role branches follow the core or replace optional review time; they never add to the 168 hours silently. Each has objectives, a sequence, exercises, prerequisites and time estimates — enough to begin. Their status is shown honestly: authored specification, implemented, or runtime-validated.</p><div class="list">' +
      list('sreBranches').map(function (b) { return '<article class="card lab-card"><div class="card-head"><div class="card-main"><p class="card-title plain">' + esc(b.id + ' · ' + b.title) + '</p><p class="card-sum">' + inline(b.audience) + '</p><div class="card-meta">' + badge(b.hours[0] + '–' + b.hours[1] + ' h') + badge('after ' + b.prereqs.join(', ')) + badge(b.status) + (s.branches[b.id] && s.branches[b.id].started ? badge('started') : '') + '</div></div><button class="lab-go" data-sre-branch="' + esc(b.id) + '" aria-label="Open ' + esc(b.id) + '">▶</button></div></article>'; }).join('') + '</div>' +
      label('Cloud extensions (opt-in, disabled by default)') + '<p class="verify-note">No budget was provided, so cloud execution is <b>off</b>. Each extension shows a current estimate and a cleanup inventory before anything runs, and requires you to name the sandbox account/project and a spending limit yourself. Budget alerts are notifications, not caps. No managed Kubernetes, NAT gateway or paid API subscription is ever provisioned automatically.</p><div class="list">' +
      list('sreCloud').map(function (c) { var r = s.cloud[c.id] || {}; return '<article class="card lab-card"><div class="card-head"><div class="card-main"><p class="card-title plain">' + esc(c.id + ' · ' + c.title) + '</p><p class="card-sum">' + inline(c.summary) + '</p><div class="card-meta">' + badge('cloud', 'sim') + badge(c.hours) + badge('after ' + c.prereqs.join(', ')) + badge(r.enabled ? 'enabled by you' : 'disabled') + '</div></div><button class="lab-go" data-sre-cloud="' + esc(c.id) + '" aria-label="Open ' + esc(c.id) + '">▶</button></div></article>'; }).join('') + '</div>';
  }
  function renderBranch(b) {
    var s = st(), r = s.branches[b.id] || {};
    return back('branches') + '<p class="muted small">Optional branch · ' + b.hours[0] + '–' + b.hours[1] + ' h · after ' + esc(b.prereqs.join(', ')) + ' · status: ' + esc(b.status) + '</p><h2 class="prep-h">' + esc(b.id + ' · ' + b.title) + '</h2>' +
      '<p class="lead">' + inline(b.audience) + '</p>' + (b.caveat ? '<p class="verify-note">' + inline(b.caveat) + '</p>' : '') +
      label('Objectives') + ul(b.objectives) + label('Sequence') + '<ol class="steps-why">' + b.sequence.map(function (x) { return '<li>' + inline(x) + '</li>'; }).join('') + '</ol>' +
      label('Exercises') + b.exercises.map(function (e) { return '<details class="brief-wrap"><summary>' + esc(e.id + ' · ' + e.title) + ' <span class="muted small">~' + e.mins + ' min · ' + esc(e.status || b.status) + '</span></summary><div class="situation">' + md(e.brief) + label('Steps') + '<ol class="steps-why">' + e.steps.map(function (x) { return '<li>' + inline(x) + '</li>'; }).join('') + '</ol>' + label('Pass criteria') + ul(e.pass) + (e.dir ? '<p class="muted small">Starter: <code>' + esc(e.dir) + '</code></p>' : '') + '</div></details>'; }).join('') +
      '<div class="done-btns"><button class="btn small" data-sre-branchstart="' + esc(b.id) + '">' + (r.started ? '✓ Started' : 'Mark started') + '</button></div>';
  }
  function renderCloud(c) {
    var s = st(), r = s.cloud[c.id] || {};
    return back('branches') + '<p class="muted small">Cloud extension · ' + esc(c.hours) + ' · after ' + esc(c.prereqs.join(', ')) + ' · ' + esc(c.status) + '</p><h2 class="prep-h">' + esc(c.id + ' · ' + c.title) + '</h2>' +
      '<p class="lead">' + inline(c.summary) + '</p>' +
      label('Current estimate (your region may differ; check the provider calculator before you start)') + ul(c.estimate) +
      label('Allowed resources') + ul(c.allowedResources) + label('Cleanup inventory (verify each after teardown)') + ul(c.cleanup) +
      label('Pass criteria') + ul(c.pass) +
      label('Opt in') + '<p class="verify-note">Nothing runs from this app. Opting in only unlocks the lab\'s commands below and records that you chose a sandbox and a limit. Stopping a VM does not remove disks, public IPs, load balancers, logs or snapshots; the cleanup inventory is the checklist.</p>' +
      '<label class="prep-label" for="cloudAcct">Sandbox account / project id (never a production account)</label><input id="cloudAcct" class="notes-input" data-sre-cloudfield="' + esc(c.id) + ':account" value="' + esc(r.account || '') + '">' +
      '<label class="prep-label" for="cloudLimit">Spending limit you set (text, e.g. "USD 15, alert at 10")</label><input id="cloudLimit" class="notes-input" data-sre-cloudfield="' + esc(c.id) + ':limit" value="' + esc(r.limit || '') + '">' +
      '<label class="prep-label" for="cloudExp">Expiry (date by which everything is deleted)</label><input id="cloudExp" class="notes-input" data-sre-cloudfield="' + esc(c.id) + ':expires" value="' + esc(r.expires || '') + '">' +
      '<label class="small"><input type="checkbox" data-sre-cloudack="' + esc(c.id) + '"' + (r.ack ? ' checked' : '') + '> I confirm this is a disposable sandbox, I have read the estimate and cleanup inventory, and I accept that alerts are not caps.</label>' +
      '<div class="done-btns"><button class="btn' + (r.enabled ? ' ghost' : ' primary') + '" data-sre-cloudtoggle="' + esc(c.id) + '">' + (r.enabled ? 'Disable' : 'Enable this extension') + '</button></div>' +
      (r.enabled ? label('Lab') + md(c.brief) + copyPre(c.commands.join('\n'), 'cloud lab commands') + '<p class="muted small">Tag/label every resource <code>' + esc(c.tag) + '</code>. Record the post-cleanup inventory check in your evidence.</p>' : '<p class="muted small">Commands appear once enabled.</p>');
  }

  /* ══ Setup ═══════════════════════════════════════════════════════ */
  function renderSetup() {
    var s = st(), flags = s.flags.setup || {};
    var profiles = [
      ['linux-arm64', 'ARM64 Linux VM (Lima or UTM on Apple Silicon)', 'labs/sre-cloud-foundations/profiles/linux-arm64/README.md', 'Needed from week 1 (L01–L06). Real systemd, filesystems and network namespaces; macOS is not a Linux host.'],
      ['compose', 'Container engine + Compose', 'labs/sre-cloud-foundations/profiles/compose/README.md', 'Needed from week 17 (L12) and week 19 (L13–L14). Also runs PostgreSQL and Redis for L23–L24.'],
      ['kind-basic', 'kind cluster looped-foundations', 'labs/sre-cloud-foundations/profiles/kind-basic/README.md', 'Needed from week 22 (L15–L17, L19–L21, L31–L32). Lightweight; no network policy enforcement.'],
      ['kind-policy', 'kind cluster looped-policy with an enforcing CNI', 'labs/sre-cloud-foundations/profiles/kind-policy/README.md', 'Needed for L18 only. Separate, explicitly named; proves deny and allow.'],
      ['observability', 'Prometheus + Grafana + OTel collector (compose profile)', 'labs/sre-cloud-foundations/profiles/observability/README.md', 'Needed for L21–L22, L27. Do not run alongside the VM and both clusters.']
    ];
    return '<p class="blurb">Default workstation: Apple Silicon macOS. Start with about 4–6 CPUs and 8–12 GiB for the active lab environment, measure, then shrink. Do not run the Linux VM, two clusters and the observability stack at once. Versions are pinned in the version matrix; prefer the compatible stable set over the newest.</p>' +
      '<p class="muted small">Documents: <code>docs/sre-cloud-foundations/setup.md</code>, <code>troubleshooting.md</code>, <code>version-matrix.md</code>, <code>implementation-status.md</code> (what was executed where).</p>' +
      '<div class="list">' + profiles.map(function (p) { var on = !!flags[p[0]]; return '<article class="card"><div class="card-main"><p class="card-title plain">' + esc(p[1]) + '</p><p class="card-sum">' + esc(p[3]) + '</p><p class="muted small"><code>' + esc(p[2]) + '</code></p><div class="done-btns"><button class="btn small' + (on ? ' ghost' : '') + '" data-sre-setup="' + p[0] + '" aria-pressed="' + on + '">' + (on ? '✓ Set up (self-reported)' : 'Mark set up') + '</button></div></div></article>'; }).join('') + '</div>' +
      label('What the local environment does not prove') + ul(['Local kind does not emulate cloud identity, VPC routing, load balancers, managed control-plane behaviour or an accreditation boundary.', 'Local persistent volumes do not prove multi-zone durability.', 'NetworkPolicy needs a supporting CNI and a real negative connectivity test; a manifest being accepted is not enforcement.', 'HPA needs metrics-server; it is installed only for the resource-metric labs.', 'A local LoadBalancer needs an implementation; the labs use documented port-forwarding.']) +
      label('Honesty') + ul(track().honesty);
  }

  var RENDER = { path: renderPath, map: renderMap, diagnostic: renderDiagnostic, modules: renderModules, labs: renderLabs, designs: renderDesigns, reviews: renderReviews, evidence: renderEvidence, branches: renderBranches, setup: renderSetup };

  /* ══ scenario debrief (rendered inside the sandbox) ══════════════ */
  function scenarioDebrief(run, extra) {
    var m = run.mission, o = m.sre, T = track(), s = st(), saved = s.debriefs['S:' + o.scenarioId + ':' + run.seed] || { parts: {}, rubric: {} };
    var M = mod(o.moduleId);
    return '<p class="section-label">How you worked (qualitative — no score)</p><dl class="scorecard">' + (extra.scorecard || []).map(function (x) { return '<div><dt>' + esc(x.k) + '</dt><dd><b>' + esc(x.v) + '</b> · ' + esc(x.why) + '</dd></div>'; }).join('') + '</dl>' +
      (run.critical && run.critical.length ? '<p class="section-label">Critical checks failed</p><ul class="bullets">' + run.critical.map(function (u) { return '<li><b>' + esc(u.label) + '</b> — ' + inline(u.why) + '</li>'; }).join('') + '</ul>' : '') +
      ((extra.risky || []).length ? '<p class="section-label">Actions worth a second look</p><ul class="bullets">' + extra.risky.map(function (r) { return '<li><code>' + esc(r.cmd) + '</code> — ' + esc(r.why) + '</li>'; }).join('') + '</ul>' : '') +
      '<p class="section-label">The mechanism</p><div class="tip">' + md(o.mechanism) + '</div>' +
      '<p class="section-label">Alternative hypotheses and how the evidence rules them out</p>' + ul(o.alternatives, function (a) { return '<b>' + esc(a.h) + '</b> — ' + inline(a.out); }) +
      (o.clues && o.clues.length ? '<p class="section-label">Clues that were not the cause</p>' + ul(o.clues) : '') +
      '<p class="section-label">Five-part debrief (write it now, in your own words)</p>' + T.debrief.map(function (p) { return '<label class="prep-label" for="sdb-' + p.id + '">' + esc(p.label) + '</label><p class="muted small">' + esc(p.prompt) + '</p><textarea id="sdb-' + p.id + '" class="notes-input" rows="2" data-sre-sdebrief="' + esc(p.id) + '">' + esc((saved.parts || {})[p.id] || '') + '</textarea>'; }).join('') +
      '<p class="section-label">Explanation rubric (0–4, self-reviewed)</p><div class="chips" role="group" aria-label="Explanation rating">' + [0, 1, 2, 3, 4].map(function (n) { var on = saved.rubric && saved.rubric.explain === n; return '<button class="chip' + (on ? ' active' : '') + '" data-sre-srubric="' + n + '" aria-pressed="' + on + '">' + n + '</button>'; }).join('') + '</div><p class="muted small">' + esc(T.rubricLevels.join(' · ')) + '</p>' +
      '<div class="done-btns"><button class="btn small" id="sreSdbSave" data-sre-sdbsave="' + esc(o.scenarioId) + ':' + esc(run.seed) + '">Save debrief</button><span class="muted small">Teach it back out loud for ' + T.teachBack.seconds[0] + '–' + T.teachBack.seconds[1] + ' seconds before you move on.</span></div>' +
      '<p class="section-label">Study next</p><div class="chip-links">' + (o.prereqs || []).map(function (id) { var l = lesson(id); return l ? '<button class="chip" data-sre-open="lesson:' + esc(id) + '">' + esc(l.title) + '</button>' : ''; }).join('') + (o.lab ? '<button class="chip" data-sre-open="lab:' + esc(o.lab) + '">Local lab ' + esc(o.lab) + '</button>' : '') + (M ? '<button class="chip" data-sre-open="module:' + esc(M.id) + '">' + esc(M.id + ' ' + M.title) + '</button>' : '') + '</div>' +
      '<p class="section-label">Try the independent variant</p><p class="muted small">Type <code>/variant</code> in the terminal on your next run, or <button class="linkish" data-sre-open="scenario:' + esc(o.scenarioId) + ':independent">start one now</button>. The previous attempt stays in your evidence.</p>' +
      (o.refs && o.refs.length ? '<p class="section-label">References</p>' + ul(o.refs, function (r) { return typeof r === 'string' ? sourceLink(r) : '<a href="' + esc(r.u) + '" target="_blank" rel="noopener">' + esc(r.t) + '</a>'; }) : '');
  }

  /* ══ events ══════════════════════════════════════════════════════ */
  function parseItem(json) { try { return JSON.parse(json); } catch (e) { return null; } }
  function onTrack() { return U().track() === 'sre'; }
  function openRef(ref) {
    var p = ref.split(':'), kind = p[0], id = p[1];
    if (kind === 'scenario') { var m = scenarioMission(id); if (!m) return; U().go('sandbox'); if (window.LXSandbox) window.LXSandbox.open(m.id, p[2] ? { mode: p[2] } : null); return; }
    if (!onTrack()) U().setTrack('sre');
    U().go('sre');
    if (kind === 'lesson') go('modules', id); else if (kind === 'lab') go('labs', id); else if (kind === 'module') go('modules', id, 'overview'); else if (kind === 'design') go('designs', id);
  }
  function keepText() {
    /* textareas and inputs are saved on every change event; this catches
       anything typed since the last change event before a re-render */
    var s = st(), dirty = false;
    $$('[data-sre-debrief]').forEach(function (t) { var p = t.dataset.sreDebrief.split(':'); var d = s.debriefs[p[0]] = s.debriefs[p[0]] || { parts: {}, rubric: {} }; d.parts = d.parts || {}; if (d.parts[p[1]] !== t.value) { d.parts[p[1]] = t.value; dirty = true; } });
    $$('[data-sre-dfield]').forEach(function (t) { var p = t.dataset.sreDfield.split(':'); var d = s.designs[p[0]] = s.designs[p[0]] || { fields: {}, rubric: {}, must: {} }; d.fields = d.fields || {}; if (d.fields[p[1]] !== t.value) { d.fields[p[1]] = t.value; dirty = true; } });
    $$('[data-sre-diagtext]').forEach(function (t) { var id = t.dataset.sreDiagtext; s.diagnostic.answers = s.diagnostic.answers || {}; var r = s.diagnostic.answers[id] = s.diagnostic.answers[id] || {}; if (r.text !== t.value) { r.text = t.value; dirty = true; } });
    $$('[data-sre-cloudfield]').forEach(function (t) { var p = t.dataset.sreCloudfield.split(':'); var c = s.cloud[p[0]] = s.cloud[p[0]] || {}; if (c[p[1]] !== t.value) { c[p[1]] = t.value; dirty = true; } });
    if (dirty) save(s);
  }
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (!t || !t.dataset) return;
    if (t.closest('#view-sre')) keepText();
    if (t.dataset.sreRecall) { var p = t.dataset.sreRecall.split(':'), s = st(); var l = s.lessons[p[0]] = s.lessons[p[0]] || {}; l.recall = l.recall || {}; l.recall[p[1]] = t.checked; save(s); return; }
    if (t.dataset.sreDiagcheck) { var q = t.dataset.sreDiagcheck.split(':'), s2 = st(); s2.diagnostic.answers = s2.diagnostic.answers || {}; var r = s2.diagnostic.answers[q[0]] = s2.diagnostic.answers[q[0]] || {}; r.checks = r.checks || []; r.checks[Number(q[1])] = t.checked; save(s2); return; }
    if (t.dataset.sreDmust) { var d = t.dataset.sreDmust.split(':'), s3 = st(); var dd = s3.designs[d[0]] = s3.designs[d[0]] || { fields: {}, rubric: {}, must: {} }; dd.must = dd.must || {}; dd.must[d[1]] = t.checked; save(s3); return; }
    if (t.dataset.sreTeachback) { var s4 = st(); var db = s4.debriefs[t.dataset.sreTeachback] = s4.debriefs[t.dataset.sreTeachback] || { parts: {}, rubric: {} }; db.teachback = t.checked; save(s4); return; }
    if (t.dataset.sreCloudack) { var s5 = st(); var c = s5.cloud[t.dataset.sreCloudack] = s5.cloud[t.dataset.sreCloudack] || {}; c.ack = t.checked; save(s5); return; }
  });
  var timer = null;
  document.addEventListener('click', function (e) {
    var t = e.target, el, p, s;
    el = t.closest('[data-sre-open]'); if (el) { openRef(el.dataset.sreOpen); return; }
    /* sandbox-hosted debrief controls */
    el = t.closest('[data-sre-srubric]'); if (el) { var box = el.closest('#sbDebrief'); if (box) { $$('[data-sre-srubric]', box).forEach(function (b) { b.classList.toggle('active', b === el); b.setAttribute('aria-pressed', String(b === el)); }); box.dataset.srubric = el.dataset.sreSrubric; } return; }
    el = t.closest('[data-sre-sdbsave]'); if (el) {
      var box2 = el.closest('#sbDebrief'), parts = {}; $$('[data-sre-sdebrief]', box2).forEach(function (ta) { parts[ta.dataset.sreSdebrief] = ta.value; });
      s = st(); var key = 'S:' + el.dataset.sreSdbsave; var rating = box2.dataset.srubric != null ? Number(box2.dataset.srubric) : (s.debriefs[key] && s.debriefs[key].rubric ? s.debriefs[key].rubric.explain : undefined);
      s.debriefs[key] = { parts: parts, rubric: { explain: rating }, saved: true, at: now(), reviewer: 'self' };
      var run = window.LXSandbox && LXSandbox.current && LXSandbox.current();
      if (run && run.attemptId && s.attempts[run.attemptId]) { s.attempts[run.attemptId].explanation = Object.keys(parts).map(function (k) { return k + ': ' + parts[k]; }).join('\n').slice(0, 4000); s.attempts[run.attemptId].explanationRating = rating; s.attempts[run.attemptId].reviewer = 'self+deterministic'; }
      var sid = el.dataset.sreSdbsave.split(':')[0], mm = scenarioMission(sid);
      if (mm && rating != null) { var mdb = s.debriefs[mm.sre.moduleId] = s.debriefs[mm.sre.moduleId] || { parts: {}, rubric: {} }; if (mdb.rubric.explain == null || rating > mdb.rubric.explain) { mdb.rubric.explain = rating; mdb.reviewer = 'self (scenario debrief)'; } }
      save(s); U().toast('Debrief saved'); return;
    }
    if (!t.closest('#view-sre')) return;
    keepText();
    el = t.closest('[data-sre-section]'); if (el) { ui.detail = null; ui.sub = null; go(el.dataset.sreSection); return; }
    el = t.closest('[data-sre-go]'); if (el) { ui.detail = null; ui.sub = null; ui.gate = null; ui.review = null; ui.diag = null; go(el.dataset.sreGo); return; }
    el = t.closest('[data-sre-module]'); if (el) { ui.sub = el.dataset.sreSubgo || (ui.detail === el.dataset.sreModule ? ui.sub : 'overview'); go('modules', el.dataset.sreModule); return; }
    el = t.closest('[data-sre-sub]'); if (el) { ui.sub = el.dataset.sreSub; render(); return; }
    el = t.closest('[data-sre-lesson]'); if (el) { go('modules', el.dataset.sreLesson); return; }
    el = t.closest('[data-sre-lab]'); if (el) { go('labs', el.dataset.sreLab); return; }
    el = t.closest('[data-sre-design]'); if (el) { go('designs', el.dataset.sreDesign); return; }
    el = t.closest('[data-sre-branch]'); if (el) { go('branches', el.dataset.sreBranch); return; }
    el = t.closest('[data-sre-cloud]'); if (el) { go('branches', el.dataset.sreCloud); return; }
    el = t.closest('[data-sre-scenario]'); if (el) { openItem({ kind: 'scenario', id: el.dataset.sreScenario }); return; }
    el = t.closest('[data-sre-item]'); if (el) { var it = parseItem(el.dataset.sreItem); if (it) openItem(it); return; }
    el = t.closest('[data-sre-fix]'); if (el) { var fx = parseItem(el.dataset.sreFix); if (fx) { ui.sub = fx.sub || null; go(fx.section, fx.detail); } return; }
    el = t.closest('[data-sre-studied]'); if (el) { s = st(); var L = s.lessons[el.dataset.sreStudied] = s.lessons[el.dataset.sreStudied] || {}; L.studied = !L.studied; L.at = now(); save(s); render(); return; }
    el = t.closest('[data-sre-recallshow]'); if (el) { p = el.dataset.sreRecallshow.split(':'); s = st(); var L2 = s.lessons[p[0]] = s.lessons[p[0]] || {}; L2.recallShown = L2.recallShown || {}; L2.recallShown[p[1]] = true; save(s); render(); return; }
    /* gate */
    el = t.closest('[data-sre-gatestart]'); if (el) { startGate(mod(el.dataset.sreGatestart)); render(); return; }
    el = t.closest('[data-sre-gatequit]'); if (el) { ui.gate = null; ui.sub = 'gate'; render(); return; }
    el = t.closest('[data-sre-gatenext]'); if (el) { ui.gate.i++; ui.gate.pickOrder = []; render(); return; }
    el = t.closest('[data-sre-gatepick]'); if (el && ui.gate) { var q = ui.gate.items[ui.gate.i], pick = Number(el.dataset.sreGatepick); ui.gate.answers[q.id] = { pick: pick, ok: pick === q.a }; render(); return; }
    el = t.closest('[data-sre-orderpick]'); if (el && ui.gate) { var i = Number(el.dataset.sreOrderpick), po = ui.gate.pickOrder; var at = po.indexOf(i); if (at === -1) po.push(i); else po.splice(at, 1); render(); return; }
    el = t.closest('[data-sre-ordersubmit]'); if (el && ui.gate) { var q2 = ui.gate.items[ui.gate.i], order = ui.gate.pickOrder.slice(); ui.gate.answers[q2.id] = { order: order, ok: order.every(function (x, n) { return x === n; }) }; render(); return; }
    el = t.closest('[data-sre-explainsubmit]'); if (el && ui.gate) { var q3 = ui.gate.items[ui.gate.i], txt = ($('#gateExplain') || {}).value || ''; if (txt.trim().length < 20) { U().toast('Write at least a couple of sentences first'); return; } ui.gate.answers[q3.id] = { text: txt, rating: null }; render(); return; }
    el = t.closest('[data-sre-explainrate]'); if (el && ui.gate) { var q4 = ui.gate.items[ui.gate.i]; ui.gate.answers[q4.id].rating = Number(el.dataset.sreExplainrate); render(); return; }
    /* debrief */
    el = t.closest('[data-sre-rubric]'); if (el) { p = el.dataset.sreRubric.split(':'); s = st(); var dbr = s.debriefs[p[0]] = s.debriefs[p[0]] || { parts: {}, rubric: {} }; dbr.rubric = dbr.rubric || {}; dbr.rubric[p[1]] = Number(p[2]); dbr.reviewer = 'self'; save(s); render(); return; }
    el = t.closest('[data-sre-debriefsave]'); if (el) { s = st(); var dbs = s.debriefs[el.dataset.sreDebriefsave] = s.debriefs[el.dataset.sreDebriefsave] || { parts: {}, rubric: {} }; dbs.saved = true; dbs.at = now(); dbs.reviewer = dbs.reviewer || 'self'; save(s); U().toast('Debrief saved'); render(); return; }
    el = t.closest('[data-sre-timer]'); if (el) { var secs = Number(el.dataset.sreTimer), end = Date.now() + secs * 1000; clearInterval(timer); timer = setInterval(function () { var left = Math.max(0, Math.round((end - Date.now()) / 1000)); var tEl = $('#sreTimer'); if (!tEl) { clearInterval(timer); return; } tEl.textContent = left ? left + ' s' : 'time'; if (!left) clearInterval(timer); }, 250); return; }
    /* labs */
    el = t.closest('[data-sre-labtab]'); if (el) { p = el.dataset.sreLabtab.split(':'); ui.labTab[p[0]] = p[1]; render(); return; }
    el = t.closest('[data-sre-labhint]'); if (el) { ui.hints[el.dataset.sreLabhint] = (ui.hints[el.dataset.sreLabhint] || 0) + 1; s = st(); s.flags.labHints = s.flags.labHints || {}; s.flags.labHints[el.dataset.sreLabhint] = Math.max(s.flags.labHints[el.dataset.sreLabhint] || 0, ui.hints[el.dataset.sreLabhint]); save(s); render(); return; }
    el = t.closest('[data-sre-solution]'); if (el) { ui.solution[el.dataset.sreSolution] = true; s = st(); s.flags.solutions = s.flags.solutions || {}; s.flags.solutions[el.dataset.sreSolution] = now(); save(s); render(); return; }
    el = t.closest('[data-sre-evimport]'); if (el) {
      var L3 = lab(el.dataset.sreEvimport), box3 = $('#evJson'), msg = $('#evMsg');
      var r = importEvidence(L3, (box3 && box3.value) || '');
      if (!r.ok) { msg.hidden = false; msg.style.color = 'var(--red)'; msg.textContent = 'Not imported: ' + r.err; return; }
      U().toast(r.outcome === 'passed' ? 'Evidence imported: passed' : 'Evidence imported: failed checks');
      render(); var m2 = $('#evMsg'); if (m2) { m2.hidden = false; m2.style.color = ''; m2.textContent = 'Imported as ' + r.outcome + (r.failed.length ? ' (failed: ' + r.failed.join(', ') + ')' : '') + (r.missing.length ? ' (missing: ' + r.missing.join(', ') + ')' : '') + (r.stale ? ' · report is for a content version other than ' + version() + ': revalidation needed' : ''); }
      return;
    }
    el = t.closest('[data-sre-evself]'); if (el) { p = el.dataset.sreEvself.split(':'); var L4 = lab(p[0]); addAttempt({ activityId: L4.id, moduleId: L4.moduleId, kind: 'lab', mode: 'local', assistance: 'self-reported', selfAssistance: p[1], startedAt: now(), completedAt: now(), hintsUsed: [], events: [], checks: [], explanation: '', reviewer: 'self', evidenceRefs: [], cleanupStatus: 'reported', outcome: 'self-reported' }); U().toast('Self-report recorded'); render(); return; }
    /* designs */
    el = t.closest('[data-sre-dsave]'); if (el) { s = st(); var dd2 = s.designs[el.dataset.sreDsave] = s.designs[el.dataset.sreDsave] || { fields: {}, rubric: {}, must: {} }; dd2.saved = true; dd2.at = now(); save(s); U().toast('Draft saved'); render(); return; }
    el = t.closest('[data-sre-drubric]'); if (el) { p = el.dataset.sreDrubric.split(':'); s = st(); var dd3 = s.designs[p[0]] = s.designs[p[0]] || { fields: {}, rubric: {}, must: {} }; dd3.rubric = dd3.rubric || {}; dd3.rubric[p[1]] = Number(p[2]); save(s); render(); return; }
    el = t.closest('[data-sre-dsubmit]'); if (el) { s = st(); var dd4 = s.designs[el.dataset.sreDsubmit] || { fields: {}, rubric: {} }; var d0 = design(el.dataset.sreDsubmit); var filled = d0.worksheet.filter(function (f) { return ((dd4.fields || {})[f.id] || '').trim().length >= 10; }).length; if (filled < Math.ceil(d0.worksheet.length * 0.7)) { U().toast('Fill at least ' + Math.ceil(d0.worksheet.length * 0.7) + ' worksheet fields first'); return; } if (Object.keys(dd4.rubric || {}).length < d0.rubric.length) { U().toast('Rate every rubric row first'); return; } dd4.submitted = true; dd4.at = now(); dd4.reviewer = 'self'; s.designs[d0.id] = dd4; save(s); noteEvidence({ activityId: d0.id, outcome: 'passed' }); U().toast('Worksheet submitted'); render(); return; }
    /* diagnostic */
    el = t.closest('[data-sre-diag]'); if (el) { p = el.dataset.sreDiag.split(':'); s = st(); s.diagnostic.answers = s.diagnostic.answers || {}; s.diagnostic.answers[p[0]] = p[1] === 'skip' ? 'skip' : Number(p[1]); save(s); render(); return; }
    el = t.closest('[data-sre-diagpy]'); if (el) { s = st(); s.diagnostic.answers = s.diagnostic.answers || {}; s.diagnostic.answers.python = { result: el.dataset.sreDiagpy, at: now() }; save(s); render(); return; }
    el = t.closest('[data-sre-diagsubmit]'); if (el) { s = st(); s.diagnostic.history = s.diagnostic.history || []; if (s.diagnostic.completedAt) s.diagnostic.history.push({ at: s.diagnostic.completedAt, answers: s.diagnostic.answers }); s.diagnostic.completedAt = now(); s.diagnostic.scores = diagnosticScore(LX.sreDiagnostic, s.diagnostic.answers || {}); save(s); ui.diag = null; render(); return; }
    el = t.closest('[data-sre-diagreview]'); if (el) { ui.diag = 'review'; render(); return; }
    el = t.closest('[data-sre-diagretake]'); if (el) { s = st(); s.diagnostic.history = s.diagnostic.history || []; s.diagnostic.history.push({ at: s.diagnostic.completedAt, answers: s.diagnostic.answers, scores: s.diagnostic.scores }); s.diagnostic.completedAt = null; s.diagnostic.answers = {}; save(s); ui.diag = null; render(); return; }
    /* reviews */
    el = t.closest('[data-sre-reviewstart]'); if (el) { startReviews(); render(); return; }
    el = t.closest('[data-sre-reviewshow]'); if (el) { ui.review.shown = true; render(); return; }
    el = t.closest('[data-sre-grade]'); if (el) { gradeReview(el.dataset.sreGrade); render(); return; }
    el = t.closest('[data-sre-reviewquit]'); if (el) { ui.review = null; render(); return; }
    /* evidence */
    el = t.closest('[data-sre-export]'); if (el) { var ta = $('#sreExport'); ta.hidden = false; ta.value = JSON.stringify({ key: KEY, exported: now(), data: st() }, null, 2); ta.focus(); ta.select(); return; }
    el = t.closest('[data-sre-rollback]'); if (el) { if (!window.confirm('Roll back to the snapshot taken before the last storage migration? Progress made since then (in every track) is replaced by the snapshot.')) return; var rb = LXStore.rollback(); var mEl = $('#sreExportMsg'); mEl.hidden = false; mEl.textContent = rb.ok ? 'Rolled back to schema ' + rb.schema + ' (' + rb.keys + ' keys). Reloading…' : rb.err; if (rb.ok) setTimeout(function () { location.reload(); }, 800); return; }
    /* branches / cloud / setup */
    el = t.closest('[data-sre-branchstart]'); if (el) { s = st(); var br = s.branches[el.dataset.sreBranchstart] = s.branches[el.dataset.sreBranchstart] || {}; br.started = true; br.at = now(); save(s); render(); return; }
    el = t.closest('[data-sre-cloudtoggle]'); if (el) { s = st(); var cl = s.cloud[el.dataset.sreCloudtoggle] = s.cloud[el.dataset.sreCloudtoggle] || {}; if (!cl.enabled) { if (!cl.ack || !(cl.account || '').trim() || !(cl.limit || '').trim()) { U().toast('Name the sandbox account, a spending limit, and tick the confirmation first'); return; } cl.enabled = true; cl.enabledAt = now(); } else cl.enabled = false; save(s); render(); return; }
    el = t.closest('[data-sre-setup]'); if (el) { s = st(); s.flags.setup = s.flags.setup || {}; s.flags.setup[el.dataset.sreSetup] = !s.flags.setup[el.dataset.sreSetup]; save(s); render(); return; }
  });

  window.LXSre = {
    render: render, go: go, open: openRef,
    firstSeed: firstSeed, nextSeed: nextSeed, recordScenario: recordScenario, scenarioDebrief: scenarioDebrief,
    moduleStatus: moduleStatus, labStatus: labStatus, scenarioStatus: scenarioStatus, importEvidence: importEvidence,
    addAttempt: addAttempt, attemptsFor: attemptsFor, dueReviews: dueReviews, position: position, state: st,
    diagnosticScore: diagnosticScore, startGate: startGate, _ui: ui
  };
})();
