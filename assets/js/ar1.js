/* Prep hub for "Anduril Round 1: Networking + AWS Terraform" (window.LXAr1).

   Sections: Today (next useful action, target date, domain progress),
   Sprint (the 360-minute core sprint or the 180-minute triage route), Extra
   practice (outside both totals), Mocks, Review (due recall), Progress,
   About (facts vs invented practice, sources, setup).

   Detail views: lesson, retrieval set, diagnostic, traffic-path exercise,
   scenario launcher (the VPC scenarios run in the Sandbox view through the
   sre.hub routing), evidence card, Terraform lab (learn / practice /
   interview), Bash exercise, mock interview, remediation, transfer.

   Honesty rules this file enforces: opening a lesson or viewing a solution
   never counts as independent completion; hints are recorded per rung;
   mock mode hides hints, reference answers and structural feedback until
   submit or deliberate abandon; Terraform feedback is labelled "structural
   checks"; simulated evidence is labelled as simulation; no pass
   probability anywhere. State: one localStorage key, lx.anduril. */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function U() { return window.LXUtil; }
  function esc(x) { return U().esc(x == null ? '' : x); }
  var KEY = 'lx.anduril';
  var SCHEMA = 1;

  /* ── storage ─────────────────────────────────────────────────── */
  var BUCKETS = ['lessons', 'items', 'reviews', 'sets', 'ex', 'attempts', 'drafts', 'hints', 'solutions', 'runs', 'bash', 'cards', 'mocks', 'done', 'explains', 'local', 'debriefs', 'ui'];
  function st() {
    var s = U().LS.get(KEY, {}) || {};
    if (!s.v) s.v = SCHEMA;
    BUCKETS.forEach(function (k) { if (!s[k] || typeof s[k] !== 'object') s[k] = {}; });
    if (!s.diag || typeof s.diag !== 'object') s.diag = {};
    return s;
  }
  function save(s) { U().LS.set(KEY, s); }
  function now() { return new Date().toISOString(); }
  function ymd(d) { d = d || new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function addDays(n, from) { var d = from ? new Date(from + 'T12:00:00') : new Date(); d.setDate(d.getDate() + n); return ymd(d); }
  function daysUntil(day) { if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return null; return Math.round((new Date(day + 'T12:00:00') - new Date(ymd() + 'T12:00:00')) / 864e5); }
  function uid(p) { return p + '-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36); }
  function mmss(sec) { sec = Math.max(0, Math.round(sec)); var m = Math.floor(sec / 60), x = sec % 60; return m + ':' + ('0' + x).slice(-2); }

  /* ── content ─────────────────────────────────────────────────── */
  function P() { return LX.ar1 || {}; }
  function list(k) { return (window.LX && LX[k]) || []; }
  function byId(k, id) { return list(k).filter(function (x) { return x.id === id; })[0] || null; }
  function lesson(id) { return byId('ar1Lessons', id); }
  function item(id) { return byId('ar1Items', id); }
  function tfLab(id) { return byId('ar1Tf', id); }
  function bashEx(id) { return byId('ar1Bash', id); }
  function mockDef(id) { return byId('ar1Mocks', id); }
  function card(id) { return byId('ar1Cards', id); }
  function exercise(id) { return byId('ar1Exercises', id); }
  function mission(sid) { return list('missions').filter(function (m) { return m.track === 'anduril' && m.sre && m.sre.scenarioId === sid; })[0] || null; }
  function source(id) { return (P().sources || []).filter(function (s) { return s.id === id; })[0] || null; }
  function tfSrc(key) { return (LX.ar1TfSrc || {})[key] || null; }
  function version() { return P().version || '1.0'; }

  /* ── markdown-lite (same dialect as the content files) ───────── */
  function inline(s) { return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>'); }
  function md(text) {
    var out = [], blocks = [], cur = [], inCode = false;
    String(text || '').split('\n').forEach(function (l) {
      if (/^```/.test(l)) { if (inCode) { cur.push(l); blocks.push(cur); cur = []; inCode = false; return; } if (cur.length) blocks.push(cur); cur = [l]; inCode = true; return; }
      if (!inCode && !l.trim()) { if (cur.length) blocks.push(cur); cur = []; return; }
      cur.push(l);
    });
    if (cur.length) blocks.push(cur);
    blocks.forEach(function (lines) {
      if (/^```/.test(lines[0])) { out.push('<pre class="term term-static">' + esc(lines.slice(1, /^```/.test(lines[lines.length - 1]) && lines.length > 1 ? -1 : undefined).join('\n')) + '</pre>'); return; }
      if (lines.every(function (l) { return /^\s*- /.test(l); })) { out.push('<ul class="bullets">' + lines.map(function (l) { return '<li>' + inline(l.replace(/^\s*- /, '')) + '</li>'; }).join('') + '</ul>'); return; }
      if (lines.every(function (l) { return /^\s*\d+\. /.test(l); })) { out.push('<ol class="steps-why">' + lines.map(function (l) { return '<li>' + inline(l.replace(/^\s*\d+\. /, '')) + '</li>'; }).join('') + '</ol>'); return; }
      out.push('<p>' + lines.map(inline).join('<br>') + '</p>');
    });
    return out.join('');
  }
  function ul(items, fn) { if (!items || !items.length) return ''; return '<ul class="bullets">' + items.map(function (x) { return '<li>' + (fn ? fn(x) : inline(x)) + '</li>'; }).join('') + '</ul>'; }
  function label(t) { return '<p class="section-label">' + esc(t) + '</p>'; }
  function badge(t, cls) { return '<span class="badge' + (cls ? ' ' + cls : '') + '">' + esc(t) + '</span>'; }
  function copyPre(text, lbl) { return '<div class="cmd-block"><pre class="term term-static">' + esc(text) + '</pre><button class="btn ghost small copy-btn" data-ar1-copy="' + esc(text) + '" aria-label="Copy ' + esc(lbl || 'commands') + '">Copy</button></div>'; }
  function srcLink(id) {
    var s = source(id);
    if (!s) return esc(id);
    return '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + '</a> <span class="muted small">(' + esc(s.status) + ', accessed ' + esc(s.accessed) + ')</span>';
  }
  function refs(ids) { return ids && ids.length ? label('Sources') + ul(ids, srcLink) : ''; }
  function scrollWrap(svg, aria) { return '<div class="diagram"><div class="diagram-scroll" tabindex="0" role="group" aria-label="' + esc(aria || 'Diagram (scrolls sideways on small screens)') + '">' + svg + '</div></div>'; }
  function back() { return '<button class="btn ghost small prep-back" data-ar1-back>← Back</button>'; }
  function seg(name, options, cur, attr) {
    return '<div class="seg-row" role="group" aria-label="' + esc(name) + '">' + options.map(function (o) { var on = o[0] === cur; return '<button class="seg' + (on ? ' active' : '') + '" ' + attr + '="' + esc(o[0]) + '" aria-pressed="' + on + '">' + esc(o[1]) + '</button>'; }).join('') + '</div>';
  }
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; } return h; }
  /* deterministic shuffle that never returns the original order (n > 1) */
  function shuffled(n, seed) {
    var a = []; for (var i = 0; i < n; i++) a.push(i);
    var h = hash(seed);
    for (var j = n - 1; j > 0; j--) { h = (h * 1103515245 + 12345) >>> 0; var k = h % (j + 1); var t = a[j]; a[j] = a[k]; a[k] = t; }
    if (n > 1 && a.every(function (x, q) { return x === q; })) a.push(a.shift());
    return a;
  }

  var SECTIONS = [['today', 'Today'], ['sprint', 'Sprint'], ['extra', 'Extra practice'], ['mocks', 'Mocks'], ['review', 'Review'], ['progress', 'Progress'], ['about', 'About']];
  var ui = { section: null, detail: null, run: null, tab: {}, explain: null, stack: [] };
  var DOMAINS = [['net', 'Networking'], ['tf', 'Terraform'], ['bash', 'Bash']];

  /* ══ evidence ════════════════════════════════════════════════════
     attempt: { id, kind, activityId, variant, mode, assistance
     ('independent' | 'hinted' | 'assisted' | 'guided' | 'self-reported'),
     hints: [rungs], solutionViewed, startedAt, completedAt, outcome
     ('passed' | 'failed' | 'abandoned' | 'self-reported'), checks, critical,
     explanation, contentVersion } — attempts are never overwritten. */
  function attemptsFor(activityId, kind) {
    var s = st();
    return Object.keys(s.attempts).map(function (k) { return s.attempts[k]; })
      .filter(function (a) { return a.activityId === activityId && (!kind || a.kind === kind); })
      .sort(function (a, b) { return (a.completedAt || a.startedAt) < (b.completedAt || b.startedAt) ? -1 : 1; });
  }
  function addAttempt(a) {
    var s = st();
    a.id = a.id || uid('att'); a.contentVersion = version(); a.recordedAt = now();
    s.attempts[a.id] = a; save(s); return a;
  }
  function passed(a) { return !!a && a.outcome === 'passed' && !(a.critical && a.critical.length); }
  function independent(a) { return passed(a) && a.assistance === 'independent'; }
  function anyPassed(id, kind) { return attemptsFor(id, kind).some(passed); }
  function anyIndependent(id, kind) { return attemptsFor(id, kind).some(independent); }
  function assistanceOf(hints, solution) {
    if (solution) return 'assisted';
    if (!hints || !hints.length) return 'independent';
    return hints.some(function (r) { return r >= 3; }) ? 'assisted' : 'hinted';
  }
  var ASSIST_LABEL = { independent: 'independent', hinted: 'with conceptual/evidence hints', assisted: 'assisted (structure or solution shown)', guided: 'guided mode', 'self-reported': 'self-reported' };

  /* ── retrieval items and spaced review ───────────────────────── */
  function itemHistory(id) { var h = st().items[id]; return (h && h.history) || []; }
  function recordItem(id, ok, ctx) {
    var s = st(), h = s.items[id] = s.items[id] || { history: [] };
    h.history.push({ at: now(), ok: !!ok, ctx: ctx || '' });
    var r = s.reviews['I:' + id];
    if (!ok) s.reviews['I:' + id] = { due: addDays(1), stage: 0, why: 'missed' };
    else if (r) { r.stage = (r.stage || 0) + 1; r.due = r.stage >= 3 ? null : addDays([1, 3, 7][r.stage] || 7); if (!r.due) delete s.reviews['I:' + id]; }
    save(s);
  }
  function reviewLater(key, why) { var s = st(); s.reviews[key] = { due: addDays(1), stage: 0, why: why || 'asked' }; save(s); U().toast('Queued for tomorrow'); }
  function dueReviews() {
    var s = st(), today = ymd();
    return Object.keys(s.reviews).filter(function (k) { var r = s.reviews[k]; return r && r.due && r.due <= today; }).sort();
  }
  function reviewTitle(k) {
    var p = k.split(':'), kind = p[0], id = p.slice(1).join(':');
    if (kind === 'I') { var it = item(id); return it ? it.q.split('\n')[0].replace(/[`*]/g, '').slice(0, 90) : id; }
    if (kind === 'L') { var l = lesson(id); return l ? 'Lesson recall: ' + l.title : id; }
    if (kind === 'S') { var m = mission(id); return m ? 'Scenario: ' + m.sre.neutralTitle : id; }
    if (kind === 'T') { var t = tfLab(id); return t ? 'Terraform: ' + t.title : id; }
    if (kind === 'B') { var b = bashEx(id); return b ? 'Bash: ' + b.title : id; }
    if (kind === 'C') { var c = card(id); return c ? 'Evidence card: ' + c.title : id; }
    if (kind === 'X') { var x = exercise(id); return x ? x.title : id; }
    return k;
  }
  function pickRecall(key) {
    var def = (LX.ar1Recall || {})[key]; if (!def) return [];
    var pool = list('ar1Items').filter(function (q) { return def.modules.indexOf(q.module) !== -1; });
    var due = dueReviews();
    function score(q) {
      var h = itemHistory(q.id), last = h[h.length - 1];
      if (due.indexOf('I:' + q.id) !== -1) return 0;
      if (last && !last.ok) return 1;
      if (!h.length) return 2;
      return 3;
    }
    return pool.slice().sort(function (a, b) { var d = score(a) - score(b); if (d) return d; var ha = itemHistory(a.id), hb = itemHistory(b.id); var ta = ha.length ? ha[ha.length - 1].at : '', tb = hb.length ? hb[hb.length - 1].at : ''; return ta < tb ? -1 : ta > tb ? 1 : (a.id < b.id ? -1 : 1); }).slice(0, def.n).map(function (q) { return q.id; });
  }

  /* ══ path items ══════════════════════════════════════════════════ */
  function sessionsList() { return P().sessions || []; }
  function routeItems(route) {
    if (route === 'triage') return [].concat.apply([], (P().triage.blocks || []).map(function (b) { return b.items; }));
    return [].concat.apply([], sessionsList().map(function (s) { return s.items; }));
  }
  function latestMock(id) { var a = attemptsFor(id, 'mock'); return a.length ? a[a.length - 1] : null; }
  function itemDone(it) {
    var s = st();
    switch (it.kind) {
      case 'diag': return !!s.diag.completedAt;
      case 'lesson': var L = s.lessons[it.id]; return !!(L && L.recallShown);
      case 'exercise': case 'transfer': var exId = it.kind === 'transfer' ? 'X2' : it.id; return !!(s.ex[exId] && s.ex[exId].submittedAt);
      case 'review':
        if (it.id === 'mock-review') { var m = latestMock('MA'); return !!(m && m.reviewedAt); }
        return !!(s.sets[it.id] && s.sets[it.id].completedAt);
      case 'scenario': return anyPassed(it.id, 'scenario');
      case 'card': return !!(s.cards[it.id] && s.cards[it.id].revealedAt);
      case 'tf': return attemptsFor(it.id, 'tf').some(function (a) { return a.outcome === 'passed' && (!it.variant || a.variant === it.variant) && (it.mode !== 'interview' || a.mode === 'interview'); });
      case 'bash': return attemptsFor(it.id, 'bash').some(function (a) { return a.allPassed; });
      case 'mock': return attemptsFor(it.id, 'mock').some(function (a) { return a.status === 'submitted'; });
      case 'remediate': return !!s.done.remediate;
      default: return false;
    }
  }
  function itemTitle(it) {
    switch (it.kind) {
      case 'diag': return 'Diagnostic (12 questions, skips allowed)';
      case 'lesson': var l = lesson(it.id); return l ? l.title : it.id;
      case 'exercise': case 'transfer': var x = exercise(it.kind === 'transfer' ? 'X2' : it.id); return x ? x.title : it.id;
      case 'review': if (it.id === 'mock-review') return 'Review your Mock A attempt'; var r = (LX.ar1Recall || {})[it.id]; return r ? r.title : it.id;
      case 'scenario': var m = mission(it.id); return m ? it.id + ' · ' + m.sre.neutralTitle : it.id;
      case 'card': var c = card(it.id); return c ? it.id + ' · ' + c.title : it.id;
      case 'tf': var t = tfLab(it.id); return t ? it.id + ' · ' + t.title + (it.variant ? ' (variant ' + it.variant.toUpperCase() + ')' : '') : it.id;
      case 'bash': var b = bashEx(it.id); return b ? it.id + ' · ' + b.title : it.id;
      case 'mock': var mk = mockDef(it.id); return mk ? mk.title : it.id;
      case 'remediate': return 'Remediate your weakest mock dimension';
      default: return it.id;
    }
  }
  var KIND_LABEL = { diag: 'diagnostic', lesson: 'lesson', exercise: 'exercise', transfer: 'transfer', review: 'recall', scenario: 'scenario', card: 'evidence card', tf: 'terraform', bash: 'bash', mock: 'mock', remediate: 'remediation' };
  function openItem(it) {
    switch (it.kind) {
      case 'diag': return detail({ kind: 'diag' });
      case 'lesson': return detail({ kind: 'lesson', id: it.id });
      case 'exercise': return detail({ kind: 'ex', id: it.id });
      case 'transfer': return detail({ kind: 'transfer' });
      case 'review': if (it.id === 'mock-review') { var m = latestMock('MA'); return m ? detail({ kind: 'mock', id: 'MA', attempt: m.id }) : detail({ kind: 'mock', id: 'MA' }); } return startSet(it.id, pickRecall(it.id));
      case 'scenario': return detail({ kind: 'scenario', id: it.id });
      case 'card': return detail({ kind: 'card', id: it.id });
      case 'tf': return detail({ kind: 'tf', id: it.id, mode: it.mode || 'practice', variant: it.variant || null });
      case 'bash': return detail({ kind: 'bash', id: it.id });
      case 'mock': return detail({ kind: 'mock', id: it.id });
      case 'remediate': return detail({ kind: 'remediate' });
    }
  }
  function itemButton(it, extraMeta) {
    var done = itemDone(it);
    return '<li><button class="path-item' + (done ? ' done' : '') + '" data-ar1-item="' + esc(JSON.stringify(it)) + '"><span class="pi-tick" aria-hidden="true">' + (done ? '✓' : '○') + '</span><span class="pi-kind">' + esc(KIND_LABEL[it.kind] || it.kind) + (it.mode ? ' · ' + esc(it.mode) : '') + ' · ' + it.mins + ' min' + (extraMeta ? ' · ' + esc(extraMeta) : '') + '</span><span class="pi-title">' + esc(itemTitle(it)) + '</span><span class="sr-only">' + (done ? ' — done' : ' — not done yet') + '</span></button></li>';
  }
  function route() { return st().ui.route === 'triage' ? 'triage' : 'core'; }
  function nextAction() {
    var due = dueReviews();
    var r = route();
    if (r === 'core') {
      var ss = sessionsList();
      for (var i = 0; i < ss.length; i++) {
        var todo = ss[i].items.filter(function (x) { return !itemDone(x); });
        if (todo.length) {
          var left = todo.reduce(function (n, x) { return n + x.mins; }, 0);
          return { session: ss[i], item: todo[0], left: left, why: ss[i].why, due: due.length, title: 'Session ' + ss[i].n + ' · ' + ss[i].title };
        }
      }
    } else {
      var bl = P().triage.blocks;
      for (var j = 0; j < bl.length; j++) {
        var td = bl[j].items.filter(function (x) { return !itemDone(x); });
        if (td.length) return { block: bl[j], item: td[0], left: td.reduce(function (n, x) { return n + x.mins; }, 0), why: 'Triage route — reduced coverage. ' + bl[j].title + '.', due: due.length, title: 'Triage block ' + (j + 1) + ' · ' + bl[j].title };
      }
    }
    return { done: true, due: due.length };
  }
  function remainingMins(r) { return routeItems(r).filter(function (x) { return !itemDone(x); }).reduce(function (n, x) { return n + x.mins; }, 0); }

  /* ── domain progress (core evidence, honest about assistance) ─── */
  function itemsCorrect(mods) {
    var pool = list('ar1Items').filter(function (q) { return mods.indexOf(q.module) !== -1; });
    var seen = 0, right = 0;
    pool.forEach(function (q) { var h = itemHistory(q.id); if (h.length) { seen++; if (h[h.length - 1].ok) right++; } });
    return { total: pool.length, seen: seen, right: right };
  }
  function mockRating(dim) { var best = null; ['MA', 'MB', 'MS'].forEach(function (id) { attemptsFor(id, 'mock').forEach(function (a) { if (a.review && a.review.ratings && a.review.ratings[dim] != null) best = Math.max(best == null ? -1 : best, a.review.ratings[dim]); }); }); return best; }
  function evidence(domain) {
    var s = st(), out = [];
    function add(lbl, done, indep, open) { out.push({ label: lbl, done: !!done, indep: !!indep, open: open }); }
    if (domain === 'net') {
      var ia = itemsCorrect(['A', 'B']);
      add('Retrieval: modules A–B (' + ia.right + ' of ' + ia.total + ' right on latest try)', ia.right >= Math.ceil(ia.total * 0.8), false, { kind: 'set', id: 'mod-A' });
      add('X1 traffic path, incl. return path', s.ex.X1 && s.ex.X1.submittedAt, s.ex.X1 && s.ex.X1.score && s.ex.X1.score.right === s.ex.X1.score.total, { kind: 'ex', id: 'X1' });
      ['N1', 'N2'].forEach(function (id) { add(id + ' investigation', anyPassed(id, 'scenario'), anyIndependent(id, 'scenario'), { kind: 'scenario', id: id }); });
      add('X2 transfer (unseen direction)', s.ex.X2 && s.ex.X2.submittedAt, s.ex.X2 && s.ex.X2.score && s.ex.X2.score.right === s.ex.X2.score.total, { kind: 'transfer' });
      var mr = mockRating('net'); add('Mock: networking reasoning ≥ 3/4', mr != null && mr >= 3, false, { kind: 'mock', id: 'MA' });
    } else if (domain === 'tf') {
      var ic = itemsCorrect(['C']);
      add('Retrieval: module C (' + ic.right + ' of ' + ic.total + ')', ic.right >= Math.ceil(ic.total * 0.8), false, { kind: 'set', id: 'mod-C' });
      add('T1 guided build', anyPassed('T1', 'tf'), anyIndependent('T1', 'tf'), { kind: 'tf', id: 'T1', mode: 'practice' });
      var t2 = attemptsFor('T2', 'tf'), indepVariants = {};
      t2.forEach(function (a) { if (independent(a)) indepVariants[a.variant] = 1; });
      add('T2 blank-editor build', t2.some(passed), Object.keys(indepVariants).length > 0, { kind: 'tf', id: 'T2', mode: 'practice' });
      add('T2 independent on two different variants (' + Object.keys(indepVariants).length + '/2)', Object.keys(indepVariants).length >= 2, Object.keys(indepVariants).length >= 2, { kind: 'tf', id: 'T2', mode: 'interview' });
      add('T3 repair and explain', anyPassed('T3', 'tf'), anyIndependent('T3', 'tf'), { kind: 'tf', id: 'T3', mode: 'practice' });
      var mt = mockRating('tf'); add('Mock: Terraform ≥ 3/4', mt != null && mt >= 3, false, { kind: 'mock', id: 'MA' });
    } else {
      var id2 = itemsCorrect(['D']);
      add('Retrieval: module D (' + id2.right + ' of ' + id2.total + ')', id2.right >= Math.ceil(id2.total * 0.8), false, { kind: 'set', id: 'mod-D' });
      add('B1 log counts: all tests pass', itemDone({ kind: 'bash', id: 'B1' }), attemptsFor('B1', 'bash').some(function (a) { return a.allPassed && a.assistance === 'independent'; }), { kind: 'bash', id: 'B1' });
    }
    return out;
  }

  /* ══ rendering ═══════════════════════════════════════════════════ */
  function root() { return document.getElementById('view-ar1'); }
  function render() {
    var el = root(); if (!el || !window.LX || !LX.ar1) return;
    var s = st();
    if (!ui.section) ui.section = s.ui.section || 'today';
    var nav = '<div class="chips prep-nav" role="group" aria-label="Prep sections">' + SECTIONS.map(function (x) {
      var on = !ui.detail && ui.section === x[0], extra = x[0] === 'review' && dueReviews().length ? ' (' + dueReviews().length + ')' : '';
      return '<button class="chip' + (on ? ' active' : '') + '" data-ar1-section="' + x[0] + '" aria-pressed="' + on + '">' + esc(x[1] + extra) + '</button>';
    }).join('') + '</div>';
    var body;
    try { body = ui.detail ? DETAIL[ui.detail.kind]() : RENDER[ui.section](); }
    catch (e) { body = '<p class="empty">This view could not render: ' + esc(e.message) + '</p>'; if (window.console) console.error(e); }
    el.innerHTML = '<div class="prep-body ar1">' + nav + body + '</div>';
    tick();
  }
  function go(section) { ui.section = section; ui.detail = null; ui.run = null; ui.stack = []; var s = st(); s.ui.section = section; save(s); render(); window.scrollTo(0, 0); }
  function detail(d) { if (ui.detail) ui.stack.push(ui.detail); ui.detail = d; ui.run = d.kind === 'set' ? ui.run : null; render(); window.scrollTo(0, 0); }
  function goBack() { ui.detail = ui.stack.pop() || null; ui.run = null; render(); window.scrollTo(0, 0); }

  /* ── Today ───────────────────────────────────────────────────── */
  function renderToday() {
    var p = P(), s = st(), target = s.ui.target || p.defaultTarget, days = daysUntil(target), n = nextAction(), r = route();
    var rem = remainingMins(r);
    var html = '<p class="blurb"><b>' + esc(p.title) + '</b> · for ' + esc(p.learner) + ' · ' + badge('invented practice — not real Anduril questions', 'sim') + '</p>';
    html += '<article class="card path-card next"><div class="card-main">';
    if (n.done) html += '<p class="card-title plain">Every item on the ' + (r === 'core' ? 'core sprint' : 'triage route') + ' is done.</p><p class="muted small">Keep the edge with Review, a second mock, or a fresh T2 variant in interview mode.</p>';
    else {
      html += '<p class="muted small time-slot">Next useful action · ' + esc(n.title) + '</p>' +
        '<p class="card-title plain">' + esc(itemTitle(n.item)) + '</p>' +
        '<p class="small">' + n.item.mins + ' min now · ' + n.left + ' min left in this ' + (r === 'core' ? 'session' : 'block') + '</p>' +
        '<p class="muted small"><b>Why it matters:</b> ' + esc(n.why) + '</p>' +
        '<div class="done-btns"><button class="btn primary small" data-ar1-item="' + esc(JSON.stringify(n.item)) + '">Start</button>' + (n.due ? '<button class="btn small" data-ar1-section="review">' + n.due + ' review' + (n.due === 1 ? '' : 's') + ' due first (about ' + Math.max(2, n.due) + ' min)</button>' : '') + '</div>';
    }
    html += '</div></article>';
    /* target date + schedule */
    var sessionsLeft = r === 'core' ? sessionsList().filter(function (x) { return x.items.some(function (i) { return !itemDone(i); }); }).length : P().triage.blocks.filter(function (b) { return b.items.some(function (i) { return !itemDone(i); }); }).length;
    html += label('Target date') + '<div class="row"><label class="prep-label" for="ar1Target">Round 1 (tentative)</label> <input id="ar1Target" type="date" class="notes-input" style="max-width:12em" value="' + esc(target) + '" data-ar1-target></div>' +
      '<p class="muted small">' + esc(p.targetNote) + '</p>' +
      (days == null ? '' : '<p class="small">' + (days > 0 ? days + ' day' + (days === 1 ? '' : 's') + ' to go' : days === 0 ? 'That is today.' : 'That date has passed — edit it if the round moved.') + ' · ' + rem + ' min of ' + (r === 'core' ? 'core sprint' : 'triage') + ' work left in ' + sessionsLeft + ' ' + (r === 'core' ? 'session' : 'block') + (sessionsLeft === 1 ? '' : 's') +
        (days > 0 && rem ? ' · about ' + Math.ceil(rem / days) + ' min a day' : '') + '</p>') +
      (r === 'core' && days != null && days >= 0 && rem > Math.max(days, 1) * 120 ? '<p class="tip small">At more than two hours a day this will not fit. The triage route covers the essentials in 180 minutes — your progress carries over either way.</p>' : '');
    html += label('Route') + seg('Route', [['core', 'Core sprint · 6 h'], ['triage', 'Triage · 3 h (reduced coverage)']], r, 'data-ar1-route') +
      '<p class="muted small">Switching routes never loses progress: the routes share activities.</p>';
    /* domain progress */
    html += label('Progress by domain (core evidence)') + '<div class="stat-row">' + DOMAINS.map(function (d) {
      var ev = evidence(d[0]), done = ev.filter(function (x) { return x.done; }).length, ind = ev.filter(function (x) { return x.indep; }).length;
      var pct = Math.round(done / ev.length * 100), nx = ev.filter(function (x) { return !x.done; })[0];
      return '<div class="stat-tile"><p class="stat-n">' + done + '/' + ev.length + '</p><p class="stat-l">' + esc(d[1]) + ' · ' + (P().weights[d[0]]) + '% of prep</p>' +
        '<div class="meter" role="img" aria-label="' + pct + '% of core evidence"><div class="meter-fill ' + (pct >= 80 ? 'good' : pct >= 40 ? 'mid' : 'low') + '" style="width:' + pct + '%"></div></div>' +
        '<p class="muted small">' + ind + ' independent</p>' + (nx ? '<p class="small">Next: <button class="linkish" data-ar1-open="' + esc(JSON.stringify(nx.open)) + '">' + esc(nx.label) + '</button></p>' : '') + '</div>';
    }).join('') + '</div><p class="muted small">Opening a lesson or viewing a solution never counts here. "Independent" means no hints at the structure/solution level and no solution viewed.</p>';
    html += label('What is known') + ul(p.confirmed) + '<p class="muted small">Unknown: ' + esc(p.unknown.join(' ')) + '</p>';
    return html;
  }

  /* ── Sprint ──────────────────────────────────────────────────── */
  function renderSprint() {
    var r = route(), html = seg('Route', [['core', 'Core sprint · 6 h'], ['triage', 'Triage · 3 h']], r, 'data-ar1-route');
    if (r === 'core') {
      var total = sessionsList().reduce(function (n, x) { return n + x.mins; }, 0);
      html += '<p class="blurb">Seven sessions, ' + total + ' minutes of required work. Every session ends with something you explain aloud. Optional work is under Extra practice and never counts toward this total.</p>';
      var nx = nextAction();
      sessionsList().forEach(function (se) {
        var done = se.items.filter(itemDone).length, isNow = nx.session === se;
        html += '<details class="brief-wrap week' + (isNow ? ' now' : '') + '"' + (isNow ? ' open' : '') + '><summary>Session ' + se.n + ' · ' + esc(se.title) + ' <span class="muted small">' + se.mins + ' min · ' + done + '/' + se.items.length + '</span></summary><div class="situation"><p class="muted small">' + esc(se.why) + '</p><ul class="path-items">' + se.items.map(function (x) { return itemButton(x); }).join('') + '</ul></div></details>';
      });
    } else {
      var T = P().triage;
      html += '<p class="blurb"><b>' + esc(T.label) + '.</b> ' + T.mins + ' minutes for when time runs out. It keeps the diagnostic, one investigation, one Terraform build, a little Bash and the mock; it is not equivalent readiness.</p>';
      T.blocks.forEach(function (b, i) {
        html += '<article class="card path-card"><div class="card-main"><p class="card-title plain">Block ' + (i + 1) + ' · ' + esc(b.title) + ' <span class="muted small">' + b.mins + ' min</span></p><ul class="path-items">' + b.items.map(function (x) { return itemButton(x); }).join('') + '</ul></div></article>';
      });
      html += label('What the triage route skips (known gaps)') + ul(T.skipped);
    }
    return html;
  }

  function renderExtra() {
    return '<p class="blurb">Deeper and alternative practice. None of this counts toward the 6-hour sprint or the 3-hour triage total.</p><ul class="path-items">' +
      (P().extra || []).map(function (x) { return itemButton(x, 'optional'); }).join('') + '</ul>' +
      label('Practice a whole module') + '<div class="chip-links">' + [['A', 'Network fundamentals'], ['B', 'AWS networking'], ['C', 'Terraform'], ['D', 'Bash']].map(function (m) { return '<button class="chip" data-ar1-set="mod-' + m[0] + '">Module ' + m[0] + ' · ' + esc(m[1]) + '</button>'; }).join('') + '</div>' +
      label('Lessons') + ul(list('ar1Lessons'), function (l) { return '<button class="linkish" data-ar1-lesson="' + esc(l.id) + '">' + esc(l.title) + '</button> <span class="muted small">' + l.mins + ' min' + (l.optional ? ' · optional' : '') + (st().lessons[l.id] && st().lessons[l.id].recallShown ? ' · studied' : '') + '</span>'; });
  }

  /* ── Mocks list ──────────────────────────────────────────────── */
  function renderMocks() {
    var K = LX.ar1MockKit;
    var html = '<p class="blurb">Timed rehearsals with this app\'s help switched off. Documentation is allowed. Bands describe this attempt on this exercise — never a prediction of the real round.</p>';
    list('ar1Mocks').forEach(function (m) {
      var at = attemptsFor(m.id, 'mock'), live = at.filter(function (a) { return a.status === 'running'; })[0];
      html += '<article class="card path-card' + (m.core ? ' next' : '') + '"><div class="card-main"><p class="card-title plain">' + esc(m.title) + ' <span class="muted small">' + m.mins + ' min · ' + (m.core ? 'core (session 6)' : 'optional') + '</span></p><p class="small">' + esc(m.intro) + '</p>' +
        '<p class="muted small">' + m.phases.map(function (ph) { return ph.mins + ' min ' + ph.title.toLowerCase(); }).join(' · ') + '</p>' +
        '<div class="done-btns"><button class="btn small primary" data-ar1-mock="' + m.id + '">' + (live ? 'Resume running attempt' : 'Open') + '</button></div>' +
        (at.length ? '<div class="table-wrap"><table class="tiers small"><caption class="sr-only">Attempts</caption><thead><tr><th scope="col">Started</th><th scope="col">Status</th><th scope="col">Time</th><th scope="col">Independent</th><th scope="col">Result</th></tr></thead><tbody>' + at.map(function (a) {
          return '<tr><td>' + esc((a.startedAt || '').slice(0, 16).replace('T', ' ')) + '</td><td><button class="linkish" data-ar1-mockattempt="' + esc(m.id + ':' + a.id) + '">' + esc(a.status) + '</button></td><td>' + (a.elapsedSec != null ? mmss(a.elapsedSec) : '—') + '</td><td>' + (a.attested ? 'attested' : 'not attested') + '</td><td>' + (a.review && a.review.band ? esc(bandLabel(a.review.band)) + ' · ' + a.review.pct + '%' : a.status === 'submitted' ? 'review pending' : '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '') + '</div></article>';
    });
    html += label('Bands') + ul(K.bands, function (b) { return '<b>' + esc(b.label) + '</b> — ' + esc(b.test); });
    return html;
  }
  function bandLabel(id) { var b = LX.ar1MockKit.bands.filter(function (x) { return x.id === id; })[0]; return b ? b.label : id; }

  /* ── Review ──────────────────────────────────────────────────── */
  function renderReview() {
    var due = dueReviews(), s = st();
    var html = '<p class="blurb">Spaced recall. Missed items come back tomorrow; anything can be queued with "Review this tomorrow". Correct answers push the next review out (1 → 3 → 7 days).</p>';
    if (due.length) {
      var itemKeys = due.filter(function (k) { return k.indexOf('I:') === 0; }).map(function (k) { return k.slice(2); });
      html += '<article class="card path-card next"><div class="card-main"><p class="card-title plain">' + due.length + ' due today</p>' +
        (itemKeys.length ? '<button class="btn small primary" data-ar1-setdue>Practise ' + itemKeys.length + ' due question' + (itemKeys.length === 1 ? '' : 's') + '</button>' : '') +
        ul(due.filter(function (k) { return k.indexOf('I:') !== 0; }), function (k) { return '<button class="linkish" data-ar1-revopen="' + esc(k) + '">' + esc(reviewTitle(k)) + '</button>'; }) + '</div></article>';
    } else html += '<p class="empty">Nothing due today.</p>';
    var later = Object.keys(s.reviews).filter(function (k) { return s.reviews[k] && s.reviews[k].due && s.reviews[k].due > ymd(); }).sort(function (a, b) { return s.reviews[a].due < s.reviews[b].due ? -1 : 1; });
    if (later.length) html += label('Coming up') + ul(later, function (k) { return esc(reviewTitle(k)) + ' <span class="muted small">' + esc(s.reviews[k].due) + '</span>'; });
    html += label('Practise a module now') + '<div class="chip-links">' + ['A', 'B', 'C', 'D'].map(function (m) { var c = itemsCorrect([m]); return '<button class="chip" data-ar1-set="mod-' + m + '">Module ' + m + ' · ' + c.right + '/' + c.total + '</button>'; }).join('') + '</div>';
    return html;
  }

  /* ── Progress ────────────────────────────────────────────────── */
  function renderProgress() {
    var s = st(), html = '';
    DOMAINS.forEach(function (d) {
      html += label(d[1]) + ul(evidence(d[0]), function (x) { return (x.done ? '✓ ' : '○ ') + '<button class="linkish" data-ar1-open="' + esc(JSON.stringify(x.open)) + '">' + esc(x.label) + '</button>' + (x.indep ? ' ' + badge('independent', 'done') : x.done ? ' ' + badge('done') : ''); });
    });
    html += label('Training target (not Anduril\'s bar)') + '<p class="small">' + esc(P().target) + '</p>';
    var all = Object.keys(s.attempts).map(function (k) { return s.attempts[k]; }).sort(function (a, b) { return (a.completedAt || a.startedAt) < (b.completedAt || b.startedAt) ? 1 : -1; });
    html += label('Attempts (' + all.length + ')') + (all.length ? '<div class="table-wrap"><table class="tiers small"><caption class="sr-only">All attempts</caption><thead><tr><th scope="col">When</th><th scope="col">Activity</th><th scope="col">Outcome</th><th scope="col">Assistance</th><th scope="col">Hints</th></tr></thead><tbody>' + all.slice(0, 60).map(function (a) {
      return '<tr><td>' + esc((a.completedAt || a.startedAt || '').slice(0, 16).replace('T', ' ')) + '</td><td>' + esc(a.activityId + (a.variant ? '/' + a.variant : '') + (a.mode ? ' · ' + a.mode : '')) + '</td><td>' + esc(a.outcome || a.status || '') + (a.critical && a.critical.length ? ' (critical)' : '') + '</td><td>' + esc(ASSIST_LABEL[a.assistance] || a.assistance || '') + '</td><td>' + esc((a.hints || []).join(',') || '—') + (a.solutionViewed ? ' · solution' : '') + '</td></tr>';
    }).join('') + '</tbody></table></div>' : '<p class="empty">No attempts yet.</p>');
    html += label('Your data') + '<p class="muted small">Everything is stored in this browser under one key (' + KEY + '). Export it before clearing site data.</p><button class="btn small" data-ar1-export>Export JSON</button><textarea id="ar1Export" class="notes-input" rows="6" hidden aria-label="Exported progress"></textarea>';
    return html;
  }

  /* ── About ───────────────────────────────────────────────────── */
  function renderAbout() {
    var p = P();
    return label('Recruiter-confirmed') + ul(p.confirmed) + label('Unknown') + ul(p.unknown) +
      label('Invented practice') + '<p class="small">' + esc(p.invented) + '</p>' +
      label('Weighting') + '<p class="small">Networking ' + p.weights.net + '% · AWS Terraform ' + p.weights.tf + '% · Bash ' + p.weights.bash + '%. Kubernetes, Helm, CloudWatch, Puppet and Ansible are context only (<button class="linkish" data-ar1-lesson="ar1-x-01">optional glossary</button>).</p>' +
      label('How practice works') + ul([
        '**Learn**: explanation, worked example, hints and solutions freely available.',
        '**Practice**: attempt first; then graduated hints — conceptual, evidence, partial structure, full solution. Each rung is recorded; a solution makes the attempt "assisted". Retake with a different variant for an independent result.',
        '**Interview mode**: blank editor, timer, documentation links; no hints, reference answers or structural feedback until you submit or deliberately abandon.',
        'VPC investigations run in the Sandbox on a **simulated** network. Their evidence (CLI output, flow logs) is generated from a model — no AWS API is called and no packets are captured.',
        'Terraform feedback in the app is a **structural check** from a local parser. Real checks — `terraform fmt`, `init`, `validate`, and optionally `plan` with your own credentials — run on your Mac; the app never applies anything.',
        'Bash exercises run on your Mac against local fixtures; this app never executes shell code.'
      ]) +
      label('Set up your Mac (optional, free)') + copyPre('brew install terraform jq     # or: brew tap hashicorp/tap && brew install hashicorp/tap/terraform\n/bin/bash --version          # 3.2.57 on macOS; the Bash labs target it\ncd labs/anduril-round1/terraform && ./validate-all.sh   # real fmt/init/validate on every reference', 'setup commands') +
      '<p class="muted small">No AWS account is needed. If you choose to deploy (T2/T4 optional), use a sandbox account with a least-privilege role, check current pricing for EC2, Elastic IPs and NAT gateways in your Region, and destroy afterwards. No free-tier or cost figure is promised here.</p>' +
      label('Sources (accessed ' + esc(p.sourcesAccessed) + ')') + '<p class="muted small">' + esc(p.sourcesNote) + '</p>' + ul((p.sources || []).map(function (x) { return x.id; }), srcLink);
  }

  var RENDER = { today: renderToday, sprint: renderSprint, extra: renderExtra, mocks: renderMocks, review: renderReview, progress: renderProgress, about: renderAbout };

  /* ══ detail: lesson ═════════════════════════════════════════════ */
  function explainBox(key, prompt) {
    var s = st(), e = s.explains[key];
    return '<div class="tip"><p class="small"><b>Explain it aloud (30–60 s, no notes):</b> ' + inline(prompt) + '</p>' +
      '<div class="done-btns"><button class="btn small" data-ar1-timer="60">Start 60 s timer</button> <span class="mock-timer" id="ar1ExplainTimer" aria-live="polite"></span>' +
      '<button class="btn small ghost" data-ar1-explained="' + esc(key) + '">I explained it' + (e ? ' (' + e.length + '×)' : '') + '</button></div></div>';
  }
  function laterBtn(key) { return '<button class="btn small ghost" data-ar1-later="' + esc(key) + '">Review this tomorrow</button>'; }
  function renderLesson() {
    var l = lesson(ui.detail.id), s = st(), L = s.lessons[l.id] || {};
    var html = back() + '<h3 class="prep-h3">' + esc(l.title) + '</h3><p class="muted small">Module ' + esc(l.module) + ' · ' + l.mins + ' min' + (l.optional ? ' · optional, context only' : '') + '</p>' +
      label('You will be able to') + ul(l.objectives) +
      label('In plain terms') + md(l.plain) + label('Precisely') + md(l.precise) +
      (l.example ? label('Example') + md(l.example) : '') +
      (l.diagram ? scrollWrap(l.diagram, l.diagramCaption) + '<p class="muted small">' + esc(l.diagramCaption || '') + '</p>' : '') +
      (l.misconception ? label('Common misconception') + '<p class="small"><b>Wrong:</b> ' + inline(l.misconception.wrong) + '</p><p class="small"><b>Right:</b> ' + inline(l.misconception.right) + '</p>' : '');
    (l.recall || []).forEach(function (r, i) {
      var key = 'r' + i, shown = L.recallShown && L.recallShown[key];
      html += label('Recall without looking up') + '<p class="small">' + inline(r.q) + '</p><textarea class="notes-input" rows="3" data-ar1-ltext="' + esc(l.id + ':' + key) + '" aria-label="Your recall answer">' + esc((L.text || {})[key] || '') + '</textarea>' +
        (shown ? '<div class="tip small"><b>Model answer:</b> ' + inline(r.a) + '</div>' : '<div class="done-btns"><button class="btn small" data-ar1-recall="' + esc(l.id + ':' + key) + '">Check my answer</button><button class="btn small ghost" data-ar1-recall="' + esc(l.id + ':' + key + ':blank') + '">I can\'t recall — show me</button></div>');
    });
    if (l.apply) {
      var ash = L.applyShown;
      html += label('Apply it') + '<p class="small">' + inline(l.apply.task) + '</p><textarea class="notes-input" rows="3" data-ar1-ltext="' + esc(l.id + ':apply') + '" aria-label="Your answer to the task">' + esc((L.text || {}).apply || '') + '</textarea>' +
        (ash ? '<div class="tip small"><b>One good answer:</b> ' + inline(l.apply.answer) + '</div>' : '<button class="btn small" data-ar1-apply="' + esc(l.id) + '">Compare with an answer</button>');
    }
    html += explainBox('L:' + l.id, l.explainAloud);
    html += label('Self-check') + '<div class="checklist">' + (l.checklist || []).map(function (c, i) { var on = L.checks && L.checks[i]; return '<label><input type="checkbox" data-ar1-lcheck="' + esc(l.id + ':' + i) + '"' + (on ? ' checked' : '') + '> ' + inline(c) + '</label>'; }).join('') + '</div>' +
      '<div class="done-btns">' + laterBtn('L:' + l.id) + '</div>' + refs(l.refs);
    return html;
  }

  /* ══ detail: retrieval set runner ══════════════════════════════ */
  function startSet(key, ids) {
    if (!ids.length) { U().toast('Nothing to practise here yet'); return; }
    ui.stack = ui.detail ? ui.stack.concat([ui.detail]) : ui.stack;
    ui.detail = { kind: 'set', id: key };
    ui.run = { key: key, ids: ids, i: 0, ans: {}, order: {} };
    render(); window.scrollTo(0, 0);
  }
  function setTitle(key) { var r = (LX.ar1Recall || {})[key]; if (r) return r.title; if (key === 'due') return 'Due reviews'; var m = /^mod-([A-D])$/.exec(key); return m ? 'Module ' + m[1] + ' practice' : key; }
  function renderItemBody(q, a, prefix) {
    var html = '<p class="small">' + md(q.q) + '</p>';
    if (q.type === 'mcq') {
      html += '<div class="choices">' + q.choices.map(function (c, i) {
        var cls = a ? (i === q.a ? ' right' : a.pick === i ? ' wrong' : '') : '';
        return '<button class="choice' + cls + '" data-ar1-pick="' + esc(prefix + ':' + i) + '"' + (a ? ' disabled' : '') + '>' + inline(c) + '</button>';
      }).join('') + '</div>';
    } else if (q.type === 'num' || q.type === 'text') {
      html += '<div class="row"><input class="notes-input" style="max-width:20em" id="ar1Ans" ' + (q.type === 'num' ? 'inputmode="numeric"' : 'autocapitalize="off" spellcheck="false"') + ' aria-label="Your answer" value="' + esc(a ? a.text : '') + '"' + (a ? ' disabled' : '') + '> ' + (a ? '' : '<button class="btn small" data-ar1-typed="' + esc(prefix) + '">Check</button>') + '</div>';
    } else if (q.type === 'order') {
      var ord = shuffled(q.steps.length, q.id), picked = (a && a.order) || (ui.run && ui.run.order[q.id]) || [];
      html += '<p class="muted small">Tap the steps in order. Tap a chosen step again to remove it.</p><div class="choices">' + ord.map(function (si) {
        var at = picked.indexOf(si), cls = a ? (a.order[at] === at ? ' right' : ' wrong') : (at !== -1 ? ' used' : '');
        return '<button class="choice' + cls + '" data-ar1-ord="' + esc(prefix + ':' + si) + '"' + (a ? ' disabled' : '') + ' aria-pressed="' + (at !== -1) + '">' + (at !== -1 ? '<b>' + (at + 1) + '.</b> ' : '') + inline(q.steps[si]) + '</button>';
      }).join('') + '</div>' + (a ? '<ol class="steps-why">' + q.steps.map(function (x) { return '<li>' + inline(x) + '</li>'; }).join('') + '</ol>' : '<button class="btn small" data-ar1-ordsubmit="' + esc(prefix) + '"' + (picked.length === q.steps.length ? '' : ' disabled') + '>Check order</button>');
    } else if (q.type === 'self') {
      html += '<textarea class="notes-input" rows="4" id="ar1Self" aria-label="Your answer"' + (a ? ' disabled' : '') + '>' + esc(a ? a.text : '') + '</textarea>' +
        (a ? '<div class="tip small"><b>Model answer:</b> ' + inline(q.a) + '</div><p class="muted small">Tick what your answer covered (self-reviewed):</p><div class="checklist">' + q.points.map(function (pt, i) { return '<label><input type="checkbox" data-ar1-pt="' + esc(prefix + ':' + i) + '"' + (a.points && a.points[i] ? ' checked' : '') + '> ' + inline(pt) + '</label>'; }).join('') + '</div>' +
          (a.rated == null ? '<div class="done-btns">' + [['2', 'Got it'], ['1', 'Partly'], ['0', 'Missed it']].map(function (r) { return '<button class="btn small" data-ar1-rate="' + esc(prefix + ':' + r[0]) + '">' + r[1] + '</button>'; }).join('') + '</div>' : '')
          : '<button class="btn small" data-ar1-selfshow="' + esc(prefix) + '">Show the model answer</button>');
    }
    if (a && q.why && (q.type !== 'self')) html += '<p class="feedback ' + (a.ok ? 'ok' : 'bad') + '">' + (a.ok ? 'Correct. ' : 'Not quite. ') + (q.type === 'text' && !a.ok ? 'Expected: ' + inline(q.a) + '. ' : q.type === 'num' && !a.ok ? 'Expected: ' + esc(q.a) + '. ' : '') + inline(q.why) + '</p>';
    return html;
  }
  function renderSet() {
    var R = ui.run; if (!R) { ui.detail = null; return renderToday(); }
    if (R.i >= R.ids.length) {
      var right = R.ids.filter(function (id) { return R.ans[id] && R.ans[id].ok; }).length;
      return back() + '<h3 class="prep-h3">' + esc(setTitle(R.key)) + ' — done</h3><p class="small">' + right + ' of ' + R.ids.length + ' right. Missed items are queued for tomorrow.</p>' +
        ul(R.ids, function (id) { var q = item(id), a = R.ans[id]; return (a && a.ok ? '✓ ' : '✗ ') + esc(q.q.split('\n')[0].replace(/[`*]/g, '').slice(0, 100)); }) +
        '<div class="done-btns"><button class="btn small primary" data-ar1-back>Back</button></div>';
    }
    var q = item(R.ids[R.i]), a = R.ans[q.id];
    var html = back() + '<h3 class="prep-h3">' + esc(setTitle(R.key)) + '</h3><p class="muted small">Question ' + (R.i + 1) + ' of ' + R.ids.length + ' · ' + esc(q.kind) + ' · module ' + esc(q.module) + '</p>' +
      '<article class="card"><div class="card-main">' + renderItemBody(q, a, 'set:' + q.id) + '</div></article>';
    if (a && (q.type !== 'self' || a.rated != null)) html += '<div class="done-btns"><button class="btn small primary" data-ar1-next>' + (R.i + 1 < R.ids.length ? 'Next' : 'Finish') + '</button>' + laterBtn('I:' + q.id) + (q.lesson ? '<button class="btn small ghost" data-ar1-lesson="' + esc(q.lesson) + '">Open the lesson</button>' : '') + '</div>';
    return html;
  }
  function gradeTyped(q, text) {
    var t = String(text || '').trim();
    if (q.type === 'num') return Number(t.replace(/[^\d.-]/g, '')) === Number(q.a);
    return (q.accept || []).some(function (re) { return new RegExp(re, 'i').test(t); });
  }
  function finishSetIfDone() {
    var R = ui.run; if (!R || R.i < R.ids.length) return;
    var s = st(), right = R.ids.filter(function (id) { return R.ans[id] && R.ans[id].ok; }).length;
    s.sets[R.key] = { completedAt: now(), right: right, total: R.ids.length, ids: R.ids.slice() };
    save(s);
  }

  /* ══ detail: diagnostic ═════════════════════════════════════════ */
  function renderDiag() {
    var D = LX.ar1Diag, s = st(), A = s.diag.answers || {};
    var html = back() + '<h3 class="prep-h3">Diagnostic</h3><p class="small">' + esc(D.note) + '</p>';
    if (s.diag.completedAt && !ui.detail.retake) {
      var sc = s.diag.scores || {};
      html += label('Your baseline (' + esc(s.diag.completedAt.slice(0, 10)) + ')') + ul(D.domains, function (d) { var x = sc[d.id] || { right: 0, total: 0, skipped: 0 }; return '<b>' + esc(d.label) + '</b>: ' + x.right + '/' + x.total + (x.skipped ? ' · ' + x.skipped + ' "don\'t know yet"' : ''); });
      var weakest = D.domains.slice().sort(function (a, b) { var x = sc[a.id] || {}, y = sc[b.id] || {}; return (x.right / (x.total || 1)) - (y.right / (y.total || 1)); })[0];
      html += '<p class="tip small">Lowest: <b>' + esc(weakest.label) + '</b>. The sprint already gives networking and Terraform 45% each; use the lessons for your lowest domain before its practice session, and use Learn mode for T1 if Terraform scored lowest.</p>' +
        label('Answers') + ul(D.items, function (q) { var a = A[q.id]; return esc(q.q) + ' — ' + (a === 'skip' ? 'skipped' : a === q.a ? '✓' : '✗') + ' <span class="muted small">(' + esc(q.choices[q.a]) + ')</span>'; }) +
        '<div class="done-btns"><button class="btn small" data-ar1-diagretake>Retake later</button></div>';
      return html;
    }
    D.items.forEach(function (q, n) {
      var a = A[q.id];
      html += '<article class="card"><div class="card-main"><p class="small"><b>' + (n + 1) + '.</b> ' + inline(q.q) + ' <span class="muted small">(' + esc(q.domain) + ')</span></p><div class="choices">' + q.choices.map(function (c, i) {
        return '<button class="choice' + (a === i ? ' picked' : '') + '" data-ar1-diag="' + esc(q.id + ':' + i) + '" aria-pressed="' + (a === i) + '">' + inline(c) + '</button>';
      }).join('') + '<button class="choice' + (a === 'skip' ? ' picked' : '') + '" data-ar1-diag="' + esc(q.id) + ':skip" aria-pressed="' + (a === 'skip') + '">I don\'t know yet</button></div></div></article>';
    });
    var answered = D.items.filter(function (q) { return A[q.id] != null; }).length;
    html += '<div class="done-btns"><button class="btn primary small" data-ar1-diagsubmit' + (answered === D.items.length ? '' : ' disabled') + '>See my baseline (' + answered + '/' + D.items.length + ')</button></div>';
    return html;
  }
  function diagScores(A) {
    var out = {};
    LX.ar1Diag.items.forEach(function (q) { var d = out[q.domain] = out[q.domain] || { right: 0, total: 0, skipped: 0 }; d.total++; if (A[q.id] === 'skip') d.skipped++; else if (A[q.id] === q.a) d.right++; });
    return out;
  }

  /* ══ diagrams: packet paths ═════════════════════════════════════ */
  function box(x, y, w, h, title, sub, cls) {
    return '<g><rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="8" fill="none" stroke="currentColor" stroke-opacity="' + (cls === 'zone' ? '.35' : '.8') + '"' + (cls === 'zone' ? ' stroke-dasharray="4 3"' : '') + '/>' +
      '<text x="' + (x + 8) + '" y="' + (y + 18) + '" font-size="12" font-weight="600" fill="currentColor">' + esc(title) + '</text>' +
      (sub ? '<text x="' + (x + 8) + '" y="' + (y + 34) + '" font-size="11" fill="currentColor" fill-opacity=".75">' + esc(sub) + '</text>' : '') + '</g>';
  }
  function arrow(x1, y1, x2, y2, txt, color) {
    var mid = (x1 + x2) / 2;
    return '<g><line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + color + '" stroke-width="2" marker-end="url(#ar1ah' + (color === 'var(--blue)' ? 'b' : 'g') + ')"/>' +
      (txt ? '<text x="' + mid + '" y="' + (y1 - 6) + '" font-size="10" text-anchor="middle" fill="currentColor">' + esc(txt) + '</text>' : '') + '</g>';
  }
  function pathDiagram(kind, withPackets) {
    var defs = '<defs><marker id="ar1ahg" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--accent)"/></marker><marker id="ar1ahb" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--blue)"/></marker></defs>';
    var g = '', aria, text;
    if (kind === 'path-nat') {
      g += box(10, 30, 330, 150, 'VPC 10.20.0.0/16', '', 'zone');
      g += box(20, 70, 140, 100, 'app-a 10.20.11.25', 'private subnet .11.0/24');
      g += box(190, 70, 140, 100, 'NAT gateway', 'EIP 203.0.113.40');
      g += box(370, 70, 90, 100, 'Internet GW', 'igw-0b5e');
      g += box(490, 70, 150, 100, 'api.vendor.example', '192.0.2.80:443');
      g += '<text x="24" y="130" font-size="10" fill="currentColor">SG (stateful) + NACL</text><text x="24" y="144" font-size="10" fill="currentColor">RT: 0.0.0.0/0 → nat</text>';
      g += '<text x="194" y="130" font-size="10" fill="currentColor">public subnet NACL</text><text x="194" y="144" font-size="10" fill="currentColor">RT: 0.0.0.0/0 → igw</text>';
      if (withPackets) {
        g += arrow(160, 95, 190, 95, '', 'var(--accent)') + arrow(330, 95, 370, 95, '', 'var(--accent)') + arrow(460, 95, 490, 95, '', 'var(--accent)');
        g += arrow(490, 160, 460, 160, '', 'var(--blue)') + arrow(370, 160, 330, 160, '', 'var(--blue)') + arrow(190, 160, 160, 160, '', 'var(--blue)');
        g += '<text x="20" y="205" font-size="11" fill="var(--accent)">→ out: 10.20.11.25:41322 → 192.0.2.80:443</text><text x="20" y="221" font-size="11" fill="var(--accent)">   after NAT: 203.0.113.40:5xxxx → 192.0.2.80:443</text>';
        g += '<text x="20" y="241" font-size="11" fill="var(--blue)">← back: 192.0.2.80:443 → 203.0.113.40:5xxxx</text><text x="20" y="257" font-size="11" fill="var(--blue)">   NAT rewrites to → 10.20.11.25:41322 (private NACL must allow 32768–60999 in)</text>';
      }
      aria = 'Packet path from app-a in a private subnet through the NAT gateway in the public subnet and the internet gateway to api.vendor.example, and back.';
      text = ['app-a (10.20.11.25, private subnet, security group and NACL) → private route table default route → NAT gateway (public subnet, Elastic IP 203.0.113.40) → public route table default route → internet gateway → 192.0.2.80:443.', 'Return: 192.0.2.80:443 → 203.0.113.40:<NAT port> → NAT gateway rewrites destination to 10.20.11.25:<ephemeral> → private subnet NACL inbound (ephemeral range) → security group allows the tracked reply.'];
    } else {
      g += box(10, 30, 330, 150, 'VPC 10.20.0.0/16', '', 'zone');
      g += box(500, 70, 140, 100, 'Your Mac', '198.51.100.45 (macOS)');
      g += box(370, 70, 100, 100, 'Internet GW', '203.0.113.30 ↔ .1.30');
      g += box(20, 70, 300, 100, 'web-a 10.20.1.30 (public IP 203.0.113.30)', 'public subnet 10.20.1.0/24');
      g += '<text x="24" y="130" font-size="10" fill="currentColor">SG: 443 from 0.0.0.0/0 (stateful)</text><text x="24" y="144" font-size="10" fill="currentColor">custom NACL (stateless) · RT 0.0.0.0/0 → igw</text>';
      if (withPackets) {
        g += arrow(500, 95, 470, 95, '', 'var(--accent)') + arrow(370, 95, 320, 95, '', 'var(--accent)');
        g += arrow(320, 160, 370, 160, '', 'var(--blue)') + arrow(470, 160, 500, 160, '', 'var(--blue)');
        g += '<text x="20" y="205" font-size="11" fill="var(--accent)">→ in: 198.51.100.45:52011 → 203.0.113.30:443</text><text x="20" y="221" font-size="11" fill="var(--accent)">   IGW translates the destination to → 10.20.1.30:443</text>';
        g += '<text x="20" y="241" font-size="11" fill="var(--blue)">← reply: 10.20.1.30:443 → 198.51.100.45:52011 (NACL outbound must allow 49152–65535)</text><text x="20" y="257" font-size="11" fill="var(--blue)">   IGW rewrites the source to 203.0.113.30</text>';
      }
      aria = 'Packet path from your Mac through the internet gateway to web-a in a public subnet, and the reply back.';
      text = ['Your Mac 198.51.100.45:<ephemeral> → 203.0.113.30:443 → internet gateway translates to 10.20.1.30:443 → public subnet NACL inbound → security group → web-a.', 'Reply: 10.20.1.30:443 → 198.51.100.45:<ephemeral> → security group (tracked) → NACL outbound (ephemeral range) → route table default → internet gateway rewrites the source to 203.0.113.30.'];
    }
    var svg = '<svg viewBox="0 0 660 ' + (withPackets ? 270 : 190) + '" width="100%" role="img" aria-label="' + esc(aria) + '" style="color:var(--text)">' + defs + g + '</svg>';
    return scrollWrap(svg, aria) + (withPackets ? '<details class="brief-wrap"><summary>Text version of the diagram</summary><div class="situation">' + ul(text) + '</div></details>' : '');
  }

  /* ══ detail: traffic-path exercise (X1, X2) ═════════════════════ */
  function renderEx(id) {
    var X = exercise(id), s = st(), E = s.ex[id] || {}, A = E.answers || {}, sub = !!E.submittedAt;
    var html = (id === 'X2' && ui.detail.kind === 'transfer' ? '' : back()) + '<h3 class="prep-h3">' + esc(X.title) + '</h3><p class="muted small">' + X.mins + ' min · ' + (X.transfer ? 'transfer: same reasoning, a direction you have not practised' : 'required exercise') + ' · invented topology</p>' +
      md(X.setup) + label(sub ? 'Packet path (with addresses)' : 'Topology') + pathDiagram(X.diagram, sub);
    X.parts.forEach(function (p, n) {
      var a = A[p.id];
      html += '<article class="card"><div class="card-main"><p class="small"><b>Part ' + (n + 1) + '.</b></p>';
      if (p.type === 'classify') {
        html += '<p class="small">' + inline(p.q) + '</p>' + p.items.map(function (it, i) {
          var v = a && a[i], ok = sub && v === it.cat;
          return '<div class="row"><p class="small" style="margin:6px 0 2px">' + inline(it.text) + '</p><label class="sr-only" for="ar1c' + p.id + i + '">Layer</label><select id="ar1c' + p.id + i + '" class="notes-input" style="max-width:12em" data-ar1-cls="' + esc(id + ':' + p.id + ':' + i) + '"' + (sub ? ' disabled' : '') + '><option value="">choose…</option>' + p.cats.map(function (c) { return '<option' + (v === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' + (sub ? ' <span class="feedback ' + (ok ? 'ok' : 'bad') + '">' + (ok ? '✓' : '✗ ' + esc(it.cat)) + '</span>' : '') + '</div>';
        }).join('') + (sub ? '<p class="muted small">' + inline(p.why) + '</p>' : '');
      } else if (p.type === 'self') {
        html += '<p class="small">' + inline(p.q) + '</p><textarea class="notes-input" rows="3" data-ar1-extext="' + esc(id + ':' + p.id) + '" aria-label="Your answer"' + (sub ? ' disabled' : '') + '>' + esc(a || '') + '</textarea>' +
          (sub ? '<div class="tip small"><b>Model answer:</b> ' + inline(p.a) + '</div><div class="checklist">' + p.points.map(function (pt, i) { return '<label><input type="checkbox" data-ar1-expt="' + esc(id + ':' + p.id + ':' + i) + '"' + (E.points && E.points[p.id + ':' + i] ? ' checked' : '') + '> ' + inline(pt) + '</label>'; }).join('') + '</div>' : '');
      } else {
        var q = { id: id + '-' + p.id, type: p.type, q: p.q, choices: p.choices, a: p.a, steps: p.steps, why: p.why };
        var shown = sub ? (p.type === 'mcq' ? { pick: a, ok: a === p.a } : { order: a || [], ok: (a || []).every(function (x, k) { return x === k; }) && (a || []).length === p.steps.length }) : null;
        if (!sub && p.type === 'order') { ui.exOrder = ui.exOrder || {}; ui.exOrder[q.id] = A[p.id] || []; }
        html += renderExPart(q, shown, id + ':' + p.id, a);
      }
      html += '</div></article>';
    });
    if (!sub) html += '<div class="done-btns"><button class="btn primary small" data-ar1-exsubmit="' + esc(id) + '">Submit and see the full path</button></div>';
    else html += '<p class="small"><b>' + E.score.right + ' of ' + E.score.total + '</b> deterministic parts right (explanations are self-reviewed).</p><div class="done-btns">' + laterBtn('X:' + id) + (id === 'X1' ? '<button class="btn small ghost" data-ar1-exredo="' + esc(id) + '">Try again from blank</button>' : '') + '</div>';
    html += explainBox('X:' + id, X.explainAloud) + refs(X.refs);
    return html;
  }
  function renderExPart(q, shown, key, cur) {
    if (q.type === 'mcq') {
      return '<p class="small">' + inline(q.q) + '</p><div class="choices">' + q.choices.map(function (c, i) {
        var cls = shown ? (i === q.a ? ' right' : shown.pick === i ? ' wrong' : '') : (cur === i ? ' picked' : '');
        return '<button class="choice' + cls + '" data-ar1-expick="' + esc(key + ':' + i) + '"' + (shown ? ' disabled' : '') + ' aria-pressed="' + (cur === i) + '">' + inline(c) + '</button>';
      }).join('') + '</div>' + (shown ? '<p class="feedback ' + (shown.ok ? 'ok' : 'bad') + '">' + inline(q.why) + '</p>' : '');
    }
    var ord = shuffled(q.steps.length, q.id), picked = cur || [];
    return '<p class="small">' + inline(q.q) + '</p>' + (shown ? '' : '<p class="muted small">Tap in order; tap again to remove.</p>') + '<div class="choices">' + ord.map(function (si) {
      var at = picked.indexOf(si), cls = shown ? (picked[at] === at ? ' right' : ' wrong') : (at !== -1 ? ' used' : '');
      return '<button class="choice' + cls + '" data-ar1-exord="' + esc(key + ':' + si) + '"' + (shown ? ' disabled' : '') + ' aria-pressed="' + (at !== -1) + '">' + (at !== -1 ? '<b>' + (at + 1) + '.</b> ' : '') + inline(q.steps[si]) + '</button>';
    }).join('') + '</div>' + (shown ? '<p class="muted small">Correct order:</p><ol class="steps-why">' + q.steps.map(function (x) { return '<li>' + inline(x) + '</li>'; }).join('') + '</ol><p class="feedback ' + (shown.ok ? 'ok' : 'bad') + '">' + inline(q.why) + '</p>' : '');
  }
  function submitEx(id) {
    var X = exercise(id), s = st(), E = s.ex[id] = s.ex[id] || {}, A = E.answers = E.answers || {};
    var missing = X.parts.filter(function (p) { var a = A[p.id]; if (p.type === 'classify') return !a || p.items.some(function (x, i) { return !a[i]; }); if (p.type === 'order') return !a || a.length !== p.steps.length; if (p.type === 'self') return !a || String(a).trim().length < 15; return a == null; });
    if (missing.length) { U().toast('Answer every part first (' + missing.length + ' left)'); return; }
    var right = 0, total = 0;
    X.parts.forEach(function (p) {
      var a = A[p.id];
      if (p.type === 'mcq') { total++; if (a === p.a) right++; }
      else if (p.type === 'order') { total++; if (a.every(function (x, k) { return x === k; })) right++; }
      else if (p.type === 'classify') { p.items.forEach(function (it, i) { total++; if (a[i] === it.cat) right++; }); }
    });
    E.submittedAt = now(); E.score = { right: right, total: total }; E.history = (E.history || []).concat([{ at: E.submittedAt, right: right, total: total }]);
    save(s);
    addAttempt({ kind: 'exercise', activityId: id, assistance: 'independent', startedAt: E.startedAt || E.submittedAt, completedAt: E.submittedAt, outcome: right === total ? 'passed' : 'failed', checks: [{ id: 'deterministic', passed: right === total, observed: right + '/' + total }] });
  }

  /* ══ detail: scenario launcher ══════════════════════════════════ */
  function renderScenario() {
    var sid = ui.detail.id, m = mission(sid), o = m.sre, at = attemptsFor(sid, 'scenario');
    var used = at.map(function (a) { return String(a.seed || '').replace(/^.*-variant-/, ''); });
    var fresh = o.variants.filter(function (v) { return used.indexOf(v) === -1; });
    return back() + '<h3 class="prep-h3">' + esc(sid + ' · ' + o.neutralTitle) + '</h3>' + badge('simulation', 'sim') +
      '<p class="small">' + inline(o.neutralBrief) + '</p>' +
      '<p class="muted small">Runs in the Sandbox terminal on a simulated VPC. Work it as hypothesis → evidence → interpretation → minimal fix → verification; write `note hypothesis: …` as you go. Commands you can use are listed there. No AWS API is called.</p>' +
      '<div class="done-btns"><button class="btn small primary" data-ar1-scen="' + esc(sid) + ':guided">Practice (hints available)</button><button class="btn small" data-ar1-scen="' + esc(sid) + ':independent">Independent' + (fresh.length ? ' (unseen variant)' : ' (new variant)') + '</button></div>' +
      (at.length ? label('Your attempts') + ul(at, function (a) { return esc((a.completedAt || '').slice(0, 16).replace('T', ' ')) + ' · variant ' + esc(String(a.seed).replace(/^.*-variant-/, '')) + ' · ' + esc(a.outcome) + ' · ' + esc(ASSIST_LABEL[a.assistance] || a.assistance) + (a.hints && a.hints.length ? ' · hints ' + a.hints.join(',') : ''); }) : '') +
      explainBox('S:' + sid, 'Without notes, explain how you would investigate "' + o.symptom + '" — what you suspect first, what evidence separates the candidates, and how you would verify a fix.') +
      label('Study first') + '<div class="chip-links">' + (o.prereqs || []).map(function (id) { var l = lesson(id); return l ? '<button class="chip" data-ar1-lesson="' + esc(id) + '">' + esc(l.title) + '</button>' : ''; }).join('') + '</div>' +
      '<div class="done-btns">' + laterBtn('S:' + sid) + '</div>' + refs(o.refs);
  }
  function launchScenario(sid, mode) {
    var m = mission(sid); if (!m) return;
    U().go('sandbox');
    if (window.LXSandbox) window.LXSandbox.open(m.id, { mode: mode });
  }

  /* ══ detail: evidence cards (N5, N6) ════════════════════════════ */
  function renderCard() {
    var c = card(ui.detail.id), s = st(), C = s.cards[c.id] || {};
    var html = back() + '<h3 class="prep-h3">' + esc(c.id + ' · ' + c.title) + '</h3>' + badge('evidence card · simulated output', 'sim') + '<p class="small">' + inline(c.brief) + '</p>';
    if (c.variants) {
      var vid = C.variant || c.variants[0].id, V = c.variants.filter(function (v) { return v.id === vid; })[0], rev = C.revealed && C.revealed[vid];
      html += seg('Variant', c.variants.map(function (v) { return [v.id, v.label]; }), vid, 'data-ar1-cardvar') +
        label('Evidence') + V.evidence.map(function (e) { return '<div class="term term-static"><div class="term-line"><span class="term-prompt">$ </span><span class="term-cmd">' + esc(e.cmd) + '</span></div><div class="term-out">' + esc(e.out).replace(/\n/g, '<br>') + '</div></div>'; }).join('');
      var W = (C.write || {})[vid] || {};
      html += label('Your reading') + [['layer', 'Which layer is failing, and what evidence proves the layers below it work?'], ['fix', 'Smallest correct fix (and who owns it)'], ['verify', 'How you verify the fix']].map(function (f) {
        return '<label class="prep-label" for="ar1cw' + f[0] + '">' + esc(f[1]) + '</label><textarea id="ar1cw' + f[0] + '" class="notes-input" rows="2" data-ar1-cardw="' + esc(c.id + ':' + vid + ':' + f[0]) + '"' + (rev ? ' disabled' : '') + '>' + esc(W[f[0]] || '') + '</textarea>';
      }).join('');
      html += (c.questions || []).map(function (q, i) {
        var pk = (C.picks || {})[vid + ':' + i];
        return '<article class="card"><div class="card-main">' + renderExPart({ id: c.id + vid + i, type: 'mcq', q: q.q, choices: q.choices, a: q.a, why: q.why }, rev ? { pick: pk, ok: pk === q.a } : null, 'card:' + c.id + ':' + vid + ':' + i, pk).replace(/data-ar1-expick/g, 'data-ar1-cardpick') + '</div></article>';
      }).join('');
      html += rev ? '<div class="tip small"><p><b>Layer:</b> ' + inline(V.layer) + '</p><p><b>Fix:</b> ' + inline(V.fix) + '</p><p><b>Verify:</b> ' + inline(V.verify) + '</p></div>' + label('Not a fix') + ul(c.unsafe) +
        '<div class="done-btns"><button class="btn small" data-ar1-cardnext="' + esc(c.id) + '">Try a new variant</button>' + laterBtn('C:' + c.id) + '</div>'
        : '<div class="done-btns"><button class="btn small primary" data-ar1-cardreveal="' + esc(c.id + ':' + vid) + '">Check my reasoning</button></div>';
    } else {
      var pick = C.pick, rv = C.revealedAt;
      html += label('Options') + '<div class="choices">' + c.options.map(function (o) {
        return '<button class="choice' + (pick === o.id ? ' picked' : '') + '" data-ar1-cardopt="' + esc(c.id + ':' + o.id) + '"' + (rv ? ' disabled' : '') + ' aria-pressed="' + (pick === o.id) + '">' + inline(o.label) + (rv ? ' — <b>' + esc(o.verdict) + '</b>' : '') + '</button>';
      }).join('') + '</div><label class="prep-label" for="ar1cj">Your justification (route tables, policies, DNS, cost)</label><textarea id="ar1cj" class="notes-input" rows="4" data-ar1-cardw="' + esc(c.id + ':_:why') + '"' + (rv ? ' disabled' : '') + '>' + esc(((C.write || {})._ || {}).why || '') + '</textarea>';
      html += rv ? label('How each option holds up') + ul(c.options, function (o) { return '<b>' + esc(o.label) + '</b> (' + esc(o.verdict) + ') — ' + inline(o.why); }) + label('Considerations') + ul(c.considerations) +
        label('Rubric (self-reviewed)') + '<div class="checklist">' + c.rubric.map(function (r, i) { return '<label><input type="checkbox" data-ar1-cardrub="' + esc(c.id + ':' + i) + '"' + (C.rubric && C.rubric[i] ? ' checked' : '') + '> ' + inline(r) + '</label>'; }).join('') + '</div><p class="muted small">More than one design can be defensible; the point is stating the requirements and the trade-offs.</p><div class="done-btns">' + laterBtn('C:' + c.id) + '</div>'
        : '<div class="done-btns"><button class="btn small primary" data-ar1-cardreveal="' + esc(c.id) + ':_">Compare with the analysis</button></div>';
    }
    return html + explainBox('C:' + c.id, 'Explain your conclusion for this card in under a minute, including what you would not do and why.') + refs(c.refs);
  }

  /* ══ detail: Terraform lab ══════════════════════════════════════ */
  function tfKey(d) { return 'tf:' + d.id + ':' + (d.variant || '-') + ':' + d.mode; }
  function tfVariant(L, d) { if (!L.variants) return null; if (d.variant && L.variants[d.variant]) return d.variant; var used = {}; attemptsFor(L.id, 'tf').forEach(function (a) { if (independent(a)) used[a.variant] = 1; }); var keys = Object.keys(L.variants).filter(function (v) { return !L.variants[v].transfer; }); return keys.filter(function (v) { return !used[v]; })[0] || keys[0]; }
  function tfStartFiles(L) {
    var files = {}; L.files.forEach(function (f) { files[f] = ''; });
    if (L.start) { var src = tfSrc(L.start) || {}; L.files.forEach(function (f) { files[f] = src[f] || ''; }); }
    return files;
  }
  function tfDraft(d, L) { var s = st(), k = tfKey(d); return (s.drafts[k] && s.drafts[k].files) || tfStartFiles(L); }
  function tfChecks(L, v) { return v ? L.variants[v].checks() : L.checks(); }
  function tfSolutionKey(L, v) { return v ? L.variants[v].solution : L.solution; }
  function fileTabs(key, files, cur, disabled) {
    var names = Object.keys(files);
    return '<div class="seg-row" role="tablist" aria-label="Files">' + names.map(function (f) { var on = f === cur; return '<button class="seg' + (on ? ' active' : '') + '" role="tab" aria-selected="' + on + '" data-ar1-file="' + esc(key + '|' + f) + '">' + esc(f) + (files[f] && files[f].trim() ? '' : ' (empty)') + '</button>'; }).join('') + '</div>' +
      '<label class="sr-only" for="ar1Editor">' + esc(cur) + '</label><textarea id="ar1Editor" class="notes-input ar1-editor" rows="22" wrap="off" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" data-ar1-edit="' + esc(key + '|' + cur) + '"' + (disabled ? ' readonly' : '') + '>' + esc(files[cur] || '') + '</textarea>' +
      '<p class="muted small">Best on a desktop keyboard. Drafts save as you type. Tab moves focus out of the editor; indent with spaces.</p>';
  }
  function gradeView(res) {
    if (!res) return '';
    if (!res.parsed) return '<div class="tip small"><b>Could not parse:</b> ' + res.errors.map(function (e) { return esc(e.file + ' line ' + e.line + ': ' + e.message); }).join('<br>') + '<br><span class="muted">Fix the syntax first (terraform fmt on your Mac will also point at it).</span></div>';
    var req = res.results.filter(function (r) { return r.sev !== 'advice'; }), adv = res.results.filter(function (r) { return r.sev === 'advice'; });
    return '<p class="small"><b>' + esc(res.label) + '</b> — ' + (res.passed ? 'all required checks pass.' : req.filter(function (r) { return !r.ok; }).length + ' to fix.') + '</p>' +
      '<ul class="bullets">' + req.map(function (r) { return '<li>' + (r.ok ? '✓ ' : r.sev === 'critical' ? '⚠ ' : '✗ ') + esc(r.label) + (r.ok ? '' : ' — <span class="feedback bad">' + esc(r.why) + '</span>') + '</li>'; }).join('') + '</ul>' +
      (adv.length ? '<p class="muted small">Advice (never blocks):</p><ul class="bullets">' + adv.map(function (r) { return '<li>' + (r.ok ? '✓ ' : '· ') + esc(r.label) + (r.ok ? '' : ' — ' + esc(r.why)) + '</li>'; }).join('') + '</ul>' : '') +
      '<p class="muted small">Structural checks read your files with a local HCL parser and model the AWS relationships. They are not terraform validate and say nothing about whether AWS would accept the values.</p>';
  }
  function solutionView(key, extraAlts) {
    var src = tfSrc(key) || {};
    return Object.keys(src).map(function (f) { return '<p class="small"><b>' + esc(f) + '</b></p>' + copyPre(src[f], f); }).join('') +
      (extraAlts && extraAlts.length ? label('Other valid approaches') + extraAlts.map(function (a) { return a.src ? '<details class="brief-wrap"><summary>' + esc(a.why) + '</summary><div class="situation">' + Object.keys(tfSrc(a.src) || {}).map(function (f) { return '<p class="small"><b>' + esc(f) + '</b></p>' + copyPre(tfSrc(a.src)[f], f); }).join('') + '</div></details>' : '<p class="small">' + inline(a.text) + '</p>'; }).join('') : '');
  }
  function renderTf() {
    var d = ui.detail, L = tfLab(d.id), s = st();
    if (L.modes.indexOf(d.mode) === -1) d.mode = L.modes[0];
    var v = tfVariant(L, d); d.variant = v;
    var key = tfKey(d), files = tfDraft(d, L), cur = ui.tab[key] || L.files[0], hints = s.hints[key] || [], solShown = !!s.solutions[key];
    var run = s.runs[key], interview = d.mode === 'interview', V = v ? L.variants[v] : null;
    var html = back() + '<h3 class="prep-h3">' + esc(L.id + ' · ' + L.title) + '</h3><p class="muted small">' + L.mins + ' min' + (L.optional ? ' · optional' : '') + '</p>' +
      seg('Mode', L.modes.map(function (m) { return [m, { learn: 'Learn', practice: 'Practice', interview: 'Interview mode' }[m]]; }), d.mode, 'data-ar1-tfmode') +
      (L.variants ? seg('Variant', Object.keys(L.variants).map(function (k) { return [k, L.variants[k].title]; }), v, 'data-ar1-tfvar') : '');
    var prompt = V ? V.prompt : L.prompt;
    /* interview mode: start screen, then blank editor + timer, no help */
    if (interview && (!run || run.status !== 'running') && !(run && run.status === 'submitted' && ui.tfShowResult === key)) {
      html += label('Interview mode') + ul(['Blank files (or the given broken files), a ' + L.mins + '-minute timer, documentation links.', 'No hints, reference answers or structural feedback until you submit or abandon.', 'Use only documentation — no AI, no notes.']) +
        label('Documentation you may use') + ul(LX.ar1MockKit.docs.slice(0, 3), function (x) { return '<a href="' + esc(x.u) + '" target="_blank" rel="noopener">' + esc(x.t) + '</a>'; }) +
        '<div class="done-btns"><button class="btn primary small" data-ar1-tfstart="' + esc(key) + '">Start the ' + L.mins + '-minute attempt</button></div>' +
        (run && run.status === 'submitted' ? '<p class="small">Last attempt submitted ' + esc(run.completedAt.slice(0, 16).replace('T', ' ')) + '. <button class="linkish" data-ar1-tfshow="' + esc(key) + '">See its result</button></p>' : '');
      return html;
    }
    html += label('Requirements') + md(prompt);
    if (L.guide && d.mode !== 'interview') {
      html += label(d.mode === 'learn' ? 'Step by step' : 'Guidance (fades as you go)') + '<ol class="steps-why">' + L.guide.map(function (g) {
        var lvl = d.mode === 'learn' ? 'full' : g.level;
        return '<li><b>' + esc(g.step) + '</b>' + (lvl === 'none' ? ' <span class="muted small">— on your own</span>' : ' — ' + inline(g.text)) + '</li>';
      }).join('') + '</ol>';
    }
    if (interview && run && run.status === 'running') {
      html += '<div class="mock-head"><span class="mock-timer" id="ar1Clock" data-ar1-clock="' + esc(run.startedAt) + '" data-ar1-limit="' + (L.mins * 60) + '" aria-live="off">' + mmss(L.mins * 60 - (Date.now() - Date.parse(run.startedAt)) / 1000) + '</span> <span class="muted small">remaining · documentation only</span></div>';
    }
    var locked = run && run.status === 'submitted' && interview;
    html += fileTabs(key, files, cur, locked);
    if (interview) {
      if (run && run.status === 'running') html += '<div class="done-btns"><button class="btn primary small" data-ar1-tfsubmit="' + esc(key) + '">Submit</button><button class="btn small ghost" data-ar1-tfabandon="' + esc(key) + '">Abandon (shows the solution)</button></div>';
      else html += tfResult(L, v, key, d);
    } else {
      html += '<div class="done-btns"><button class="btn small" data-ar1-tfcheck="' + esc(key) + '">Run structural checks</button><button class="btn small primary" data-ar1-tfsubmit="' + esc(key) + '">Submit attempt</button><button class="btn small ghost" data-ar1-tfreset="' + esc(key) + '">Reset files</button></div>' +
        (ui.tfGrade && ui.tfGrade.key === key ? gradeView(ui.tfGrade.res) : '');
      html += label('Hints (each rung is recorded)') + L.hints.map(function (h, i) {
        var r = i + 1, open = hints.indexOf(r) !== -1 || (r === 4 && solShown);
        if (r === 4) return open ? '<div class="tip small"><b>Full worked solution</b> — this attempt now counts as assisted.' + solutionView(tfSolutionKey(L, v), V ? V.alternatives : L.alternatives) + '</div>' : '<button class="btn small ghost" data-ar1-tfhint="' + esc(key + '|4') + '">4 · Show the full solution</button>';
        return open ? '<div class="tip small"><b>' + r + ' · ' + ['Conceptual', 'Evidence', 'Partial structure'][i] + ':</b> ' + md(h.replace(/^[A-Za-z ]+:\s*/, '')) + (r === 2 && ui.tfGrade && ui.tfGrade.key === key && ui.tfGrade.res.parsed ? firstFailHint(ui.tfGrade.res) : '') + '</div>' : '<button class="btn small ghost" data-ar1-tfhint="' + esc(key + '|' + r) + '">' + r + ' · ' + ['Conceptual hint', 'Evidence hint', 'Partial structure'][i] + '</button>';
      }).join(' ') + tfResult(L, v, key, d, true);
    }
    html += label('Check it for real on your Mac') + L.verify.map(function (x) { return '<p class="small"><b>' + esc(x.title) + '</b></p>' + copyPre(x.cmds, x.title) + '<p class="muted small">' + esc(x.note) + '</p>'; }).join('') +
      '<p class="small">Ran it locally? Record what the real CLI said (self-reported, kept separate from the structural checks):</p><div class="done-btns">' + [['validate-ok', 'validate: Success'], ['validate-err', 'validate: errors'], ['plan-ok', 'plan ran']].map(function (x) { return '<button class="btn small ghost" data-ar1-local="' + esc(key + '|' + x[0]) + '">' + esc(x[1]) + '</button>'; }).join('') + '</div>' +
      ((s.local[key] || []).length ? '<p class="muted small">Recorded: ' + s.local[key].map(function (x) { return esc(x.result + ' ' + x.at.slice(0, 10)); }).join(', ') + '</p>' : '');
    html += label('Common mistakes') + ul(L.mistakes) + refs(L.refs);
    return html;
  }
  function firstFailHint(res) { var f = res.results.filter(function (r) { return !r.ok && r.sev !== 'advice'; })[0]; return f ? '<p>First failing check: <b>' + esc(f.label) + '</b>. Look at that relationship.</p>' : '<p>Every required check passes.</p>'; }
  function tfResult(L, v, key, d, practice) {
    var at = attemptsFor(L.id, 'tf').filter(function (a) { return a.key === key; }), last = at[at.length - 1];
    if (!last) return '';
    var html = label('Last submitted attempt (' + esc(last.completedAt.slice(0, 16).replace('T', ' ')) + ')') +
      '<p class="small">' + esc(last.outcome === 'abandoned' ? 'Abandoned' : last.outcome === 'passed' ? 'Structural checks passed' : 'Structural checks failed') + ' · ' + esc(ASSIST_LABEL[last.assistance]) + (last.elapsedSec != null ? ' · ' + mmss(last.elapsedSec) : '') + '</p>' + gradeView(last.grade);
    if (L.defects && last.grade && last.grade.parsed) {
      html += label('Defects, graded independently') + ul(L.defects, function (df) { var r = last.grade.results.filter(function (x) { return x.id === df.check; })[0]; return (r && r.ok ? '✓ fixed — ' : '✗ not fixed — ') + '<b>' + esc(df.id + ' (' + df.kind + ')') + '</b>' + (r && r.ok ? ': ' + esc(df.title) : '') ; });
      if (last.outcome !== 'abandoned') html += label('Explain each defect (symptom, evidence, fix)') + L.defects.map(function (df) { return '<label class="prep-label" for="ar1d' + df.id + '">' + esc(df.id) + '</label><textarea id="ar1d' + df.id + '" class="notes-input" rows="2" data-ar1-tfexp="' + esc(last.id + ':' + df.id) + '">' + esc(((last.explain || {})[df.id]) || '') + '</textarea>'; }).join('') +
        '<details class="brief-wrap"><summary>Compare with the reference explanation</summary><div class="situation">' + ul(L.defects, function (df) { return '<b>' + esc(df.id + ' · ' + df.title) + '</b> — ' + inline(df.symptom) + ' Evidence: ' + inline(df.evidence); }) + '</div></details>';
    }
    if (!practice || last.solutionViewed || last.outcome === 'passed') html += '<details class="brief-wrap"' + (d.mode === 'interview' ? ' open' : '') + '><summary>Reference solution and alternatives</summary><div class="situation">' + solutionView(tfSolutionKey(L, v), v ? L.variants[v].alternatives : L.alternatives) + '</div></details>';
    html += label('Explanation rubric (self-reviewed, 0–2 each)') + L.rubric.map(function (r, i) { var val = (last.rubric || {})[i]; return '<div class="rubric"><span>' + inline(r) + '</span>' + [0, 1, 2].map(function (n) { return '<button class="chip' + (val === n ? ' active' : '') + '" data-ar1-tfrub="' + esc(last.id + ':' + i + ':' + n) + '" aria-pressed="' + (val === n) + '">' + n + '</button>'; }).join('') + '</div>'; }).join('') +
      explainBox('T:' + L.id, L.explainAloud) +
      '<div class="done-btns">' + (L.variants ? '<button class="btn small" data-ar1-tfnewvar="' + esc(L.id) + '">Try a new variant (unassisted)</button>' : '') + laterBtn('T:' + L.id) + '</div>';
    return html;
  }
  function tfFiles(key) { var s = st(); return (s.drafts[key] && s.drafts[key].files) || null; }
  function tfGrade(d) { var L = tfLab(d.id), files = tfDraft(d, L); return window.LXHcl.grade(files, tfChecks(L, d.variant)); }
  function submitTf(key, abandoned) {
    var d = ui.detail, L = tfLab(d.id), s = st(), run = s.runs[key], hints = s.hints[key] || [], sol = !!s.solutions[key];
    var res = tfGrade(d), started = run && run.startedAt ? run.startedAt : (s.drafts[key] && s.drafts[key].startedAt) || now();
    var a = addAttempt({ kind: 'tf', key: key, activityId: L.id, variant: d.variant, mode: d.mode, hints: hints.slice(), solutionViewed: sol || !!abandoned,
      assistance: d.mode === 'learn' ? 'guided' : abandoned ? 'assisted' : assistanceOf(hints, sol),
      startedAt: started, completedAt: now(), elapsedSec: Math.round((Date.now() - Date.parse(started)) / 1000),
      outcome: abandoned ? 'abandoned' : res.passed ? 'passed' : 'failed', grade: res,
      checks: res.results ? res.results.map(function (r) { return { id: r.id, passed: r.ok, sev: r.sev }; }) : [], critical: (res.critical || []).map(function (r) { return r.label; }) });
    s = st();
    if (s.runs[key]) { s.runs[key].status = 'submitted'; s.runs[key].completedAt = a.completedAt; }
    /* a fresh start next time: interview attempts begin from the starting files again */
    if (d.mode === 'interview') delete s.drafts[key];
    s.hints[key] = []; delete s.solutions[key];
    save(s);
    ui.tfShowResult = key; ui.tfGrade = null;
    if (!res.passed && !abandoned) s.reviews['T:' + L.id] = { due: addDays(1), stage: 0, why: 'failed' };
    save(s);
    return a;
  }

  /* ══ detail: Bash exercise ══════════════════════════════════════ */
  function renderBash() {
    var B = bashEx(ui.detail.id), s = st(), key = 'bash:' + B.id, hints = s.hints[key] || [], R = LX.ar1BashRun;
    var html = back() + '<h3 class="prep-h3">' + esc(B.id + ' · ' + B.title) + '</h3><p class="muted small">' + B.mins + ' min' + (B.optional ? ' · optional' : '') + ' · runs on your Mac; this app never executes shell code</p>' +
      label('Task') + md(B.prompt) + label('Rules') + ul(B.rules) +
      label('Exit status') + ul(B.exits, function (e) { return '<code>' + esc(e[0]) + '</code> — ' + esc(e[1]); }) +
      label('The tests cover') + '<p class="small">' + esc(B.cases.join(' · ')) + '</p>' +
      label('Run it') + copyPre(R.setup, 'setup') + copyPre(R.test(B.id), 'test commands') + '<p class="muted small">' + esc(R.note) + ' Full spec: <code>labs/anduril-round1/bash/' + esc(B.dir) + '/README.md</code>.</p>' +
      label('Draft pad (optional — run it in Terminal)') + '<textarea class="notes-input ar1-editor" rows="12" wrap="off" spellcheck="false" autocapitalize="off" data-ar1-bashdraft="' + esc(B.id) + '" aria-label="Script draft">' + esc((s.drafts[key] && s.drafts[key].text) || '') + '</textarea>' +
      label('Hints (each rung is recorded)') + B.hints.map(function (h, i) { var r = i + 1, open = hints.indexOf(r) !== -1; return open ? '<div class="tip small"><b>' + r + '.</b> ' + md(h) + '</div>' : '<button class="btn small ghost" data-ar1-bashhint="' + esc(B.id + '|' + r) + '">' + r + ' · ' + ['Conceptual', 'Evidence', 'Partial structure', 'Where the solution is'][i] + '</button>'; }).join(' ');
    var at = attemptsFor(B.id, 'bash'), last = at[at.length - 1];
    html += label('Record your result') + '<div class="row"><label class="small" for="ar1bp">Tests passed</label> <input id="ar1bp" class="notes-input" style="max-width:5em" inputmode="numeric" value="' + esc(last ? last.passedN : '') + '"> <label class="small" for="ar1bt">of</label> <input id="ar1bt" class="notes-input" style="max-width:5em" inputmode="numeric" value="' + esc(last ? last.totalN : '') + '"></div>' +
      '<div class="done-btns"><button class="btn small primary" data-ar1-bashrec="' + esc(B.id) + '">Record</button></div>' +
      '<p class="muted small">Assistance is taken from the hints you opened here (' + (hints.length ? 'rungs ' + hints.join(', ') : 'none') + '). If you also used other help, say so: <label><input type="checkbox" id="ar1bo"> I used outside help (AI, a solution file, notes)</label></p>' +
      (at.length ? ul(at, function (a) { return esc(a.completedAt.slice(0, 16).replace('T', ' ')) + ' · ' + a.passedN + '/' + a.totalN + ' tests · ' + esc(ASSIST_LABEL[a.assistance]); }) : '') +
      label('Explain it aloud') + '<div class="checklist">' + B.explain.map(function (q, i) { return '<label><input type="checkbox" data-ar1-bashexp="' + esc(B.id + ':' + i) + '"' + ((s.bash[B.id] || {})['e' + i] ? ' checked' : '') + '> ' + inline(q) + '</label>'; }).join('') + '</div>' +
      explainBox('B:' + B.id, 'Walk through your script top to bottom: input checks, the main transformation, and why each exit code is what it is.') +
      '<div class="done-btns">' + laterBtn('B:' + B.id) + '</div>' + refs(B.refs);
    return html;
  }

  /* ══ detail: mock interview ═════════════════════════════════════ */
  function mockAttempt(id) { var a = st().attempts[id]; return a && a.kind === 'mock' ? a : null; }
  function liveMock(mid) { return attemptsFor(mid, 'mock').filter(function (a) { return a.status === 'running'; })[0] || null; }
  function renderMock() {
    var d = ui.detail, M = mockDef(d.id), K = LX.ar1MockKit, a = d.attempt ? mockAttempt(d.attempt) : liveMock(M.id);
    var html = back() + '<h3 class="prep-h3">' + esc(M.title) + '</h3>' + badge('invented practice', 'sim');
    if (!a) {
      html += '<p class="small">' + esc(M.intro) + '</p>' + label('Format') + ul(M.phases.map(function (p) { return p.mins + ' min — ' + p.title; })) +
        label('Rules') + ul(K.rules) + label('Documentation you may use') + ul(K.docs, function (x) { return '<a href="' + esc(x.u) + '" target="_blank" rel="noopener">' + esc(x.t) + '</a>'; }) +
        '<div class="checklist"><label><input type="checkbox" id="ar1Attest"> ' + esc(K.attest) + '</label></div><p class="muted small">The app cannot see other windows; this is your own record. You can start without ticking it — the attempt is then recorded as not attested.</p>' +
        '<div class="done-btns"><button class="btn primary small" data-ar1-mockstart="' + esc(M.id) + '">Start the ' + M.mins + '-minute mock</button></div>';
      return html;
    }
    if (a.status === 'running') return html + renderMockRunning(M, a);
    return html + renderMockReview(M, a);
  }
  function phaseEnds(M, i) { var t = 0; for (var k = 0; k <= i; k++) t += M.phases[k].mins; return t; }
  function renderMockRunning(M, a) {
    var i = a.phase || 0, ph = M.phases[i], elapsed = (Date.now() - Date.parse(a.startedAt)) / 1000;
    var html = '<div class="mock-head"><span class="mock-timer" id="ar1Clock" data-ar1-clock="' + esc(a.startedAt) + '" data-ar1-limit="' + (M.mins * 60) + '" aria-live="off">' + mmss(M.mins * 60 - elapsed) + '</span> <span class="muted small">remaining · phase ' + (i + 1) + ' of ' + M.phases.length + ' · aim to finish this phase by ' + phaseEnds(M, i) + ':00</span></div>' +
      '<p class="muted small">Mock mode: hints, solutions, reference answers and structural feedback are hidden. Documentation links are under the phase.</p>' +
      seg('Phases', M.phases.map(function (p, k) { return [String(k), (k + 1) + '. ' + p.title]; }), String(i), 'data-ar1-mockphase') +
      label(ph.title + ' · ' + ph.mins + ' min') + md(ph.prompt);
    var key = 'mock:' + a.id + ':' + ph.id;
    if (ph.kind === 'tf') {
      var s = st(), files = (s.drafts[key] && s.drafts[key].files) || (function () { var f = {}; ph.files.forEach(function (n) { f[n] = ''; }); return f; })();
      html += fileTabs(key, files, ui.tab[key] || ph.files[0], false) + '<p class="muted small">If you have Terraform on this machine, running <code>terraform init -backend=false && terraform validate</code> in a scratch folder is fair game — it is what you would do in the real round.</p>';
    } else if (ph.kind === 'net') {
      html += ph.questions.map(function (qi, n) { var q = LX.ar1MockKit.followups[qi]; return '<p class="small"><b>Q' + (n + 1) + '.</b> ' + inline(q.q) + '</p><textarea class="notes-input" rows="4" data-ar1-mocktext="' + esc(a.id + ':' + ph.id + ':' + n) + '" aria-label="Answer ' + (n + 1) + '">' + esc(((a.answers || {})[ph.id + ':' + n]) || '') + '</textarea>'; }).join('');
    } else if (ph.kind === 'bash') {
      html += '<p class="small">Work in your terminal. Paste your final script here when done (optional) and note the test result.</p><textarea class="notes-input ar1-editor" rows="10" wrap="off" spellcheck="false" data-ar1-mocktext="' + esc(a.id + ':' + ph.id + ':script') + '" aria-label="Your script">' + esc(((a.answers || {})[ph.id + ':script']) || '') + '</textarea>';
    } else {
      html += '<textarea class="notes-input" rows="6" data-ar1-mocktext="' + esc(a.id + ':' + ph.id + ':text') + '" aria-label="' + esc(ph.title) + '">' + esc(((a.answers || {})[ph.id + ':text']) || '') + '</textarea>';
    }
    html += '<div class="done-btns">' + (i + 1 < M.phases.length ? '<button class="btn small primary" data-ar1-mockphase="' + (i + 1) + '">Next phase →</button>' : '') +
      '<button class="btn small' + (i + 1 === M.phases.length ? ' primary' : '') + '" data-ar1-mocksubmit="' + esc(a.id) + '">Submit mock</button><button class="btn small ghost" data-ar1-mockabandon="' + esc(a.id) + '">Abandon</button></div>' +
      label('Documentation') + ul(LX.ar1MockKit.docs, function (x) { return '<a href="' + esc(x.u) + '" target="_blank" rel="noopener">' + esc(x.t) + '</a>'; });
    return html;
  }
  function weighted(M, ratings) { var tot = 0, got = 0; M.rubric.forEach(function (r) { tot += r.weight; if (ratings[r.id] != null) got += r.weight * ratings[r.id] / 4; }); return Math.round(got / tot * 100); }
  function bandFor(M, a, ratings) {
    var pct = weighted(M, ratings), crit = a.tfGrade && a.tfGrade.critical && a.tfGrade.critical.length;
    var tfOk = !a.tfGrade || a.tfGrade.passed, bashOk = a.bash == null || (a.bash.total > 0 && a.bash.passed === a.bash.total);
    if (crit || pct < 50) return 'guided';
    if (pct >= 80 && a.attested && a.status === 'submitted' && tfOk && bashOk) return 'independent';
    return 'refs';
  }
  function renderMockReview(M, a) {
    var K = LX.ar1MockKit, R = a.review || {}, ratings = R.ratings || {};
    var html = '<p class="small"><b>' + esc(a.status === 'abandoned' ? 'Abandoned' : 'Submitted') + '</b> after ' + mmss(a.elapsedSec || 0) + ' of ' + M.mins + ':00 · ' + (a.attested ? 'attested independent' : 'not attested') + ' · started ' + esc(a.startedAt.slice(0, 16).replace('T', ' ')) + '</p>';
    M.phases.forEach(function (ph) {
      html += '<details class="brief-wrap"' + (ph.kind === 'tf' || ph.kind === 'net' ? ' open' : '') + '><summary>' + esc(ph.title) + '</summary><div class="situation">';
      if (ph.kind === 'clarify') html += '<p class="small"><b>You asked:</b></p><pre class="term term-static">' + esc(((a.answers || {})['clarify:text']) || '(nothing written)') + '</pre>' + label('Questions a strong candidate asks') + ul(K.clarify);
      if (ph.kind === 'tf') html += gradeView(a.tfGrade) + '<details class="brief-wrap"><summary>Reference solution (one valid approach)</summary><div class="situation">' + solutionView(ph.solution) + '</div></details>';
      if (ph.kind === 'bash') {
        var ex = ph.exercise;
        html += '<p class="small">Run <code>./run-tests.sh starter ' + esc(ex) + '</code> in <code>labs/anduril-round1/bash</code> and record the result:</p><div class="row"><input class="notes-input" style="max-width:5em" inputmode="numeric" id="ar1mbp" value="' + esc(a.bash ? a.bash.passed : '') + '" aria-label="Tests passed"> <span class="small">of</span> <input class="notes-input" style="max-width:5em" inputmode="numeric" id="ar1mbt" value="' + esc(a.bash ? a.bash.total : '') + '" aria-label="Tests total"> <button class="btn small" data-ar1-mockbash="' + esc(a.id) + '">Save</button></div><p class="muted small">Reference solution: <code>labs/anduril-round1/bash/' + esc(ex) + '-*/solution/</code>.</p>';
      }
      if (ph.kind === 'net') html += ph.questions.map(function (qi, n) { var q = K.followups[qi], key = a.id + ':' + qi; return '<p class="small"><b>' + inline(q.q) + '</b></p><pre class="term term-static">' + esc(((a.answers || {})[ph.id + ':' + n]) || '(no answer)') + '</pre><div class="tip small"><b>A strong answer:</b> ' + inline(q.a) + '</div><div class="checklist">' + q.points.map(function (pt, i) { return '<label><input type="checkbox" data-ar1-mockpt="' + esc(key + ':' + i) + '"' + ((R.points || {})[qi + ':' + i] ? ' checked' : '') + '> ' + inline(pt) + '</label>'; }).join('') + '</div>'; }).join('');
      if (ph.kind === 'explain') html += '<pre class="term term-static">' + esc(((a.answers || {})['explain:text']) || '(nothing written)') + '</pre>';
      html += '</div></details>';
    });
    html += label('Score each dimension (self-reviewed, 0–4)') + '<p class="muted small">' + esc(K.levels.join(' · ')) + '</p>' + M.rubric.map(function (r) {
      return '<div class="rubric"><span>' + esc(r.label) + ' <span class="muted small">(' + r.weight + '%)</span></span>' + [0, 1, 2, 3, 4].map(function (n) { var on = ratings[r.id] === n; return '<button class="chip' + (on ? ' active' : '') + '" data-ar1-mockrate="' + esc(a.id + ':' + r.id + ':' + n) + '" aria-pressed="' + on + '">' + n + '</button>'; }).join('') + '</div>';
    }).join('');
    var all = M.rubric.every(function (r) { return ratings[r.id] != null; });
    if (all) { var band = bandFor(M, a, ratings); html += '<p class="small"><b>' + weighted(M, ratings) + '%</b> weighted · band: <b>' + esc(bandLabel(band)) + '</b></p><p class="muted small">A description of this attempt on this exercise, not a prediction of the real interview.</p>'; }
    html += '<label class="prep-label" for="ar1MockNotes">Review notes: what to fix first</label><textarea id="ar1MockNotes" class="notes-input" rows="3" data-ar1-mocknotes="' + esc(a.id) + '">' + esc(R.notes || '') + '</textarea>' +
      '<div class="done-btns"><button class="btn small primary" data-ar1-mockreview="' + esc(a.id) + '"' + (all ? '' : ' disabled') + '>Save review</button><button class="btn small" data-ar1-mockrestart="' + esc(M.id) + '">Start a new attempt</button>' + (R.band ? '<button class="btn small ghost" data-ar1-remediate>Remediate the weakest dimension</button>' : '') + '</div>';
    return html;
  }
  function mockStop(id, how) {
    var s = st(), a = s.attempts[id]; if (!a) return;
    var M = mockDef(a.activityId);
    a.status = how; a.completedAt = now(); a.elapsedSec = Math.round((Date.now() - Date.parse(a.startedAt)) / 1000);
    M.phases.forEach(function (ph) {
      if (ph.kind !== 'tf') return;
      var key = 'mock:' + a.id + ':' + ph.id, files = (s.drafts[key] && s.drafts[key].files) || {};
      a.tfFiles = files; a.tfGrade = window.LXHcl.grade(files, ph.checks());
    });
    a.outcome = how === 'abandoned' ? 'abandoned' : 'submitted';
    a.assistance = a.attested && how === 'submitted' ? 'independent' : 'self-reported';
    save(s);
  }

  /* ══ detail: remediation and transfer ═══════════════════════════ */
  function latestReviewed() { var best = null; ['MA', 'MB', 'MS'].forEach(function (id) { attemptsFor(id, 'mock').forEach(function (a) { if (a.reviewedAt && (!best || a.reviewedAt > best.reviewedAt)) best = a; }); }); return best; }
  var REMEDY = {
    net: { what: 'Scenario N3 (stateless return traffic), independent', open: { kind: 'scenario', id: 'N3' }, then: 'then the X2 transfer exercise' },
    tf: { what: 'T2 in interview mode on a variant you have not passed', open: { kind: 'tf', id: 'T2', mode: 'interview' }, then: 'then T3 if time remains' },
    bash: { what: 'B2 (jq over describe-instances)', open: { kind: 'bash', id: 'B2' }, then: 'then the Module D recall set' },
    verify: { what: 'Scenario N2, independent variant — verify from the instance', open: { kind: 'scenario', id: 'N2' }, then: 'then N5 (TCP vs TLS vs HTTP)' },
    comm: { what: 'Explain-aloud round: X1, T1 and N1 prompts, 60 s each, recorded', open: { kind: 'ex', id: 'X1' }, then: 'then re-answer two mock follow-ups out loud' },
    clarify: { what: 'Write the clarifying questions for T2 variant C before reading it', open: { kind: 'tf', id: 'T2', mode: 'practice', variant: 'c' }, then: 'compare with the mock\'s question list' }
  };
  function renderRemediate() {
    var a = latestReviewed(), s = st();
    var html = back() + '<h3 class="prep-h3">Remediate your weakest mock dimension</h3>';
    if (!a) return html + '<p class="small">Review a mock first — the remediation is chosen from your own ratings.</p><button class="btn small" data-ar1-mock="MA">Open Mock A</button>';
    var M = mockDef(a.activityId), r = a.review.ratings;
    var weakest = M.rubric.slice().sort(function (x, y) { return (r[x.id] - r[y.id]) || (y.weight - x.weight); })[0];
    var R = REMEDY[weakest.id];
    html += '<p class="small">From your ' + esc(M.title) + ' review: lowest was <b>' + esc(weakest.label) + '</b> (' + r[weakest.id] + '/4).</p>' +
      '<article class="card path-card next"><div class="card-main"><p class="card-title plain">' + esc(R.what) + '</p><p class="muted small">' + esc(R.then) + '</p><div class="done-btns"><button class="btn small primary" data-ar1-open="' + esc(JSON.stringify(R.open)) + '">Start</button><button class="btn small" data-ar1-remdone="' + esc(weakest.id) + '">' + (s.done.remediate ? 'Done ✓ (' + esc(s.done.remediate.dim) + ')' : 'Mark remediation done') + '</button></div></div></article>' +
      (a.review.notes ? label('Your review notes') + '<p class="small">' + esc(a.review.notes) + '</p>' : '');
    return html;
  }
  function renderTransfer() {
    return back() + '<p class="blurb">Transfer: the same reasoning on something you have not practised. Do it without notes first.</p>' + renderEx('X2') +
      label('If Terraform was your weakest mock dimension') + '<p class="small">Also do <button class="linkish" data-ar1-open="' + esc(JSON.stringify({ kind: 'tf', id: 'T2', mode: 'interview', variant: 'c' })) + '">T2 variant C in interview mode</button> (35 min, outside the sprint total).</p>';
  }

  var DETAIL = {
    lesson: renderLesson, set: renderSet, diag: renderDiag, ex: function () { return renderEx(ui.detail.id); }, transfer: renderTransfer,
    scenario: renderScenario, card: renderCard, tf: renderTf, bash: renderBash, mock: renderMock, remediate: renderRemediate
  };

  /* ══ sandbox hub API (scenarios route here via sre.hub = 'LXAr1') ═ */
  function firstSeed(m, mode) {
    var vars = (m.sre && m.sre.variants) || ['a'];
    var used = attemptsFor(m.sre.scenarioId, 'scenario').map(function (a) { return a.seed; });
    var fresh = vars.filter(function (v) { return used.indexOf(m.sre.scenarioId + '-variant-' + v) === -1; });
    var v = mode === 'independent' ? (fresh[0] || vars[used.length % vars.length]) : vars[0];
    return m.sre.scenarioId + '-variant-' + v;
  }
  function nextSeed(m, prev) {
    var vars = (m.sre && m.sre.variants) || ['a'], cur = String(prev || '').replace(/^.*-variant-/, ''), i = vars.indexOf(cur);
    return m.sre.scenarioId + '-variant-' + vars[(i + 1) % vars.length];
  }
  function recordScenario(run, info) {
    var m = run.mission, o = m.sre, rungs = (run.hintLog || []).map(function (h) { return h.level; });
    var assisted = rungs.some(function (r) { return r >= 3; }) || run.revealed > 0;
    var a = {
      id: run.attemptId || uid('att'), kind: 'scenario', activityId: o.scenarioId, seed: run.seed, mode: run.mode,
      assistance: run.mode === 'guided' && (rungs.length || run.revealed) ? (assisted ? 'assisted' : 'hinted') : assisted ? 'assisted' : rungs.length ? 'hinted' : 'independent',
      hints: rungs, startedAt: new Date(run.startedAt || Date.now()).toISOString(), completedAt: now(),
      events: run.ran.slice(0, 300), checks: m.objectives.map(function (ob) { return { id: ob.id, passed: !!run.met[ob.id] }; }),
      critical: (run.critical || []).map(function (u) { return u.label; }), outcome: info && info.outcome === 'passed' ? 'passed' : (info && info.outcome) || 'passed', simulated: true
    };
    run.attemptId = a.id;
    addAttempt(a);
    if (a.outcome !== 'passed' || a.assistance === 'assisted') { var s = st(); s.reviews['S:' + o.scenarioId] = { due: addDays(1), stage: 0, why: 'retake' }; save(s); }
    return a;
  }
  function scenarioDebrief(run, extra) {
    var m = run.mission, o = m.sre, s = st(), D = s.debriefs[o.scenarioId + ':' + run.seed] || {};
    return '<p class="section-label">How you worked (qualitative)</p><dl class="scorecard">' + (extra.scorecard || []).map(function (x) { return '<div><dt>' + esc(x.k) + '</dt><dd><b>' + esc(x.v) + '</b> · ' + esc(x.why) + '</dd></div>'; }).join('') + '</dl>' +
      (run.critical && run.critical.length ? label('Critical checks failed') + ul(run.critical, function (u) { return '<b>' + esc(u.label) + '</b> — ' + inline(u.why); }) : '') +
      ((extra.risky || []).length ? label('Actions worth a second look') + ul(extra.risky, function (r) { return '<code>' + esc(r.cmd) + '</code> — ' + esc(r.why); }) : '') +
      label('The mechanism') + '<div class="tip">' + md(o.mechanism) + '</div>' +
      label('Other hypotheses and the evidence that rules them out') + ul(o.alternatives, function (x) { return '<b>' + esc(x.h) + '</b> — ' + inline(x.out); }) +
      label('Write it up: hypothesis → evidence → interpretation → fix → verification') + [['hyp', 'Hypothesis'], ['ev', 'Evidence'], ['int', 'Interpretation'], ['fix', 'Minimal fix and verification']].map(function (p) {
        return '<label class="prep-label" for="ar1sd' + p[0] + '">' + esc(p[1]) + '</label><textarea id="ar1sd' + p[0] + '" class="notes-input" rows="2" data-ar1-sdpart="' + p[0] + '">' + esc((D.parts || {})[p[0]] || '') + '</textarea>';
      }).join('') +
      label('Self-check (rubric)') + '<div class="checklist">' + (o.passRubric || []).map(function (r, i) { return '<label><input type="checkbox" data-ar1-sdrub="' + i + '"' + (D.rubric && D.rubric[i] ? ' checked' : '') + '> ' + inline(r) + '</label>'; }).join('') + '</div>' +
      '<div class="done-btns"><button class="btn small" data-ar1-sdsave="' + esc(o.scenarioId + ':' + run.seed) + '">Save write-up</button><button class="btn small" data-ar1-scen="' + esc(o.scenarioId) + ':independent">Try a new variant</button>' + laterBtn('S:' + o.scenarioId) + '<button class="btn small ghost" data-ar1-home>Back to prep</button></div>' +
      label('Study next') + '<div class="chip-links">' + (o.prereqs || []).map(function (id) { var l = lesson(id); return l ? '<button class="chip" data-ar1-golesson="' + esc(id) + '">' + esc(l.title) + '</button>' : ''; }).join('') + '</div>' +
      refs(o.refs);
  }

  /* ══ timers ══════════════════════════════════════════════════════ */
  var clock = null, explainT = null;
  function tick() {
    clearInterval(clock);
    var el = document.getElementById('ar1Clock'); if (!el) return;
    function upd() {
      var e = document.getElementById('ar1Clock'); if (!e) { clearInterval(clock); return; }
      var left = Number(e.dataset.ar1Limit) - (Date.now() - Date.parse(e.dataset.ar1Clock)) / 1000;
      e.textContent = left > 0 ? mmss(left) : 'time — ' + mmss(-left) + ' over';
      e.classList.toggle('over', left <= 0);
    }
    upd(); clock = setInterval(upd, 1000);
  }

  /* ══ events ══════════════════════════════════════════════════════ */
  function parse(json) { try { return JSON.parse(json); } catch (e) { return null; } }
  function onTrack() { return U().track() === 'anduril'; }
  function show(d) { if (!onTrack()) U().setTrack('anduril'); U().go('ar1'); ui.stack = []; ui.detail = d; render(); window.scrollTo(0, 0); }
  function openRef(o) { if (!o) return; if (o.kind === 'set') { var m = /^mod-([A-D])$/.exec(o.id); return startSet(o.id, list('ar1Items').filter(function (q) { return q.module === m[1]; }).map(function (q) { return q.id; })); } detail(o); }
  var draftTimer = null;
  function saveDraftFrom(t) {
    var p = t.dataset.ar1Edit.split('|'), key = p[0], f = p[1], s = st();
    var dr = s.drafts[key] = s.drafts[key] || { files: null, startedAt: now() };
    if (!dr.files) { var d = ui.detail; dr.files = d && d.kind === 'tf' ? tfDraft(d, tfLab(d.id)) : {}; if (d && d.kind === 'mock') { var M = mockDef(d.id), ph = M.phases.filter(function (x) { return x.kind === 'tf'; })[0]; ph.files.forEach(function (n) { if (dr.files[n] == null) dr.files[n] = ''; }); } }
    dr.files[f] = t.value; dr.at = now(); save(s);
  }
  document.addEventListener('input', function (e) {
    var t = e.target; if (!t || !t.dataset) return;
    if (t.dataset.ar1Edit) { clearTimeout(draftTimer); draftTimer = setTimeout(function () { saveDraftFrom(t); }, 250); return; }
    if (t.dataset.ar1Mocktext) { var p = t.dataset.ar1Mocktext.split(':'), s = st(), a = s.attempts[p[0]]; if (a && a.status === 'running') { a.answers = a.answers || {}; a.answers[p[1] + ':' + p[2]] = t.value; save(s); } return; }
    if (t.dataset.ar1Bashdraft) { var s2 = st(), k = 'bash:' + t.dataset.ar1Bashdraft; s2.drafts[k] = { text: t.value, at: now() }; save(s2); return; }
    if (t.dataset.ar1Ltext) { var q = t.dataset.ar1Ltext.split(':'), s3 = st(), L = s3.lessons[q[0]] = s3.lessons[q[0]] || {}; L.text = L.text || {}; L.text[q[1]] = t.value; save(s3); return; }
    if (t.dataset.ar1Extext) { var x = t.dataset.ar1Extext.split(':'), s4 = st(), E = s4.ex[x[0]] = s4.ex[x[0]] || { startedAt: now() }; E.answers = E.answers || {}; E.answers[x[1]] = t.value; save(s4); return; }
    if (t.dataset.ar1Cardw) { var c = t.dataset.ar1Cardw.split(':'), s5 = st(), C = s5.cards[c[0]] = s5.cards[c[0]] || {}; C.write = C.write || {}; C.write[c[1]] = C.write[c[1]] || {}; C.write[c[1]][c[2]] = t.value; save(s5); return; }
    if (t.dataset.ar1Sdpart) return;
    if (t.dataset.ar1Tfexp) { var te = t.dataset.ar1Tfexp.split(':'), s6 = st(), at = s6.attempts[te[0]]; if (at) { at.explain = at.explain || {}; at.explain[te[1]] = t.value; save(s6); } return; }
    if (t.dataset.ar1Mocknotes) { var s7 = st(), am = s7.attempts[t.dataset.ar1Mocknotes]; if (am) { am.review = am.review || {}; am.review.notes = t.value; save(s7); } return; }
  });
  window.addEventListener('beforeunload', function () { var t = document.getElementById('ar1Editor'); if (t && t.dataset.ar1Edit) saveDraftFrom(t); });
  document.addEventListener('change', function (e) {
    var t = e.target; if (!t || !t.dataset) return;
    if (t.dataset.ar1Target != null && t.id === 'ar1Target') { var s = st(); s.ui.target = t.value || P().defaultTarget; save(s); render(); return; }
    if (t.dataset.ar1Lcheck) { var p = t.dataset.ar1Lcheck.split(':'), s1 = st(), L = s1.lessons[p[0]] = s1.lessons[p[0]] || {}; L.checks = L.checks || {}; L.checks[p[1]] = t.checked; save(s1); return; }
    if (t.dataset.ar1Cls) { var c = t.dataset.ar1Cls.split(':'), s2 = st(), E = s2.ex[c[0]] = s2.ex[c[0]] || { startedAt: now() }; E.answers = E.answers || {}; var arr = E.answers[c[1]] = E.answers[c[1]] || []; arr[Number(c[2])] = t.value; save(s2); return; }
    if (t.dataset.ar1Expt) { var x = t.dataset.ar1Expt.split(':'), s3 = st(), E2 = s3.ex[x[0]]; E2.points = E2.points || {}; E2.points[x[1] + ':' + x[2]] = t.checked; save(s3); return; }
    if (t.dataset.ar1Pt) { var y = t.dataset.ar1Pt.split(':'), a = ui.run && ui.run.ans[y[1]]; if (a) { a.points = a.points || {}; a.points[y[2]] = t.checked; } return; }
    if (t.dataset.ar1Cardrub) { var r = t.dataset.ar1Cardrub.split(':'), s4 = st(), C = s4.cards[r[0]] = s4.cards[r[0]] || {}; C.rubric = C.rubric || {}; C.rubric[r[1]] = t.checked; save(s4); return; }
    if (t.dataset.ar1Bashexp) { var b = t.dataset.ar1Bashexp.split(':'), s5 = st(), B = s5.bash[b[0]] = s5.bash[b[0]] || {}; B['e' + b[1]] = t.checked; save(s5); return; }
    if (t.dataset.ar1Mockpt) { var mp = t.dataset.ar1Mockpt.split(':'), s6 = st(), am = s6.attempts[mp[0]]; if (am) { am.review = am.review || {}; am.review.points = am.review.points || {}; am.review.points[mp[1] + ':' + mp[2]] = t.checked; save(s6); } return; }
  });
  document.addEventListener('click', function (e) {
    var t = e.target, el, p, s;
    el = t.closest('[data-ar1-copy]'); if (el) { var txt = el.dataset.ar1Copy; if (navigator.clipboard) navigator.clipboard.writeText(txt).then(function () { U().toast('Copied'); }, function () { U().toast('Copy failed — select the text instead'); }); return; }
    /* sandbox-hosted debrief controls */
    el = t.closest('[data-ar1-sdsave]'); if (el) {
      var box = el.closest('#sbDebrief') || document; var parts = {}, rub = {};
      $$('[data-ar1-sdpart]', box).forEach(function (ta) { parts[ta.dataset.ar1Sdpart] = ta.value; });
      $$('[data-ar1-sdrub]', box).forEach(function (cb) { rub[cb.dataset.ar1Sdrub] = cb.checked; });
      s = st(); s.debriefs[el.dataset.ar1Sdsave] = { parts: parts, rubric: rub, at: now(), reviewer: 'self' };
      var runNow = window.LXSandbox && LXSandbox.current && LXSandbox.current();
      if (runNow && runNow.attemptId && s.attempts[runNow.attemptId]) s.attempts[runNow.attemptId].explanation = parts;
      save(s); U().toast('Write-up saved'); return;
    }
    el = t.closest('[data-ar1-scen]'); if (el) { p = el.dataset.ar1Scen.split(':'); launchScenario(p[0], p[1]); return; }
    el = t.closest('[data-ar1-later]'); if (el) { reviewLater(el.dataset.ar1Later); return; }
    el = t.closest('[data-ar1-home]'); if (el) { if (!onTrack()) U().setTrack('anduril'); U().go('ar1'); return; }
    el = t.closest('[data-ar1-golesson]'); if (el) { show({ kind: 'lesson', id: el.dataset.ar1Golesson }); return; }
    if (!t.closest('#view-ar1')) return;
    el = t.closest('[data-ar1-section]'); if (el) { go(el.dataset.ar1Section); return; }
    el = t.closest('[data-ar1-back]'); if (el) { if (ui.detail && ui.detail.kind === 'set') finishSetIfDone(); goBack(); return; }
    el = t.closest('[data-ar1-item]'); if (el) { var it = parse(el.dataset.ar1Item); if (it) openItem(it); return; }
    el = t.closest('[data-ar1-open]'); if (el) { openRef(parse(el.dataset.ar1Open)); return; }
    el = t.closest('[data-ar1-route]'); if (el) { s = st(); s.ui.route = el.dataset.ar1Route; save(s); render(); return; }
    el = t.closest('[data-ar1-lesson]'); if (el) { detail({ kind: 'lesson', id: el.dataset.ar1Lesson }); return; }
    el = t.closest('[data-ar1-set]'); if (el) { openRef({ kind: 'set', id: el.dataset.ar1Set }); return; }
    el = t.closest('[data-ar1-setdue]'); if (el) { startSet('due', dueReviews().filter(function (k) { return k.indexOf('I:') === 0; }).map(function (k) { return k.slice(2); })); return; }
    el = t.closest('[data-ar1-revopen]'); if (el) { p = el.dataset.ar1Revopen.split(':'); var map = { L: { kind: 'lesson', id: p[1] }, S: { kind: 'scenario', id: p[1] }, T: { kind: 'tf', id: p[1], mode: 'practice' }, B: { kind: 'bash', id: p[1] }, C: { kind: 'card', id: p[1] }, X: { kind: 'ex', id: p[1] } }[p[0]]; s = st(); var rv = s.reviews[el.dataset.ar1Revopen]; if (rv) { rv.stage = (rv.stage || 0) + 1; rv.due = rv.stage >= 3 ? null : addDays([1, 3, 7][rv.stage] || 7); if (!rv.due) delete s.reviews[el.dataset.ar1Revopen]; save(s); } if (map) detail(map); return; }
    el = t.closest('[data-ar1-timer]'); if (el) { var secs = Number(el.dataset.ar1Timer), end = Date.now() + secs * 1000; clearInterval(explainT); explainT = setInterval(function () { var left = Math.max(0, Math.round((end - Date.now()) / 1000)), tEl = $('#ar1ExplainTimer'); if (!tEl) { clearInterval(explainT); return; } tEl.textContent = left ? left + ' s' : 'time'; if (!left) clearInterval(explainT); }, 250); return; }
    el = t.closest('[data-ar1-explained]'); if (el) { s = st(); var ek = el.dataset.ar1Explained; s.explains[ek] = (s.explains[ek] || []).concat([now()]); save(s); U().toast('Noted'); render(); return; }
    el = t.closest('[data-ar1-export]'); if (el) { var ta = $('#ar1Export'); ta.hidden = false; ta.value = JSON.stringify({ key: KEY, exported: now(), data: st() }, null, 2); ta.focus(); ta.select(); return; }
    /* lessons */
    el = t.closest('[data-ar1-recall]'); if (el) { p = el.dataset.ar1Recall.split(':'); s = st(); var L = s.lessons[p[0]] = s.lessons[p[0]] || {}; var typed = ((L.text || {})[p[1]] || '').trim(); if (!p[2] && typed.length < 10) { U().toast('Write your answer first, or choose "I can\'t recall"'); return; } L.recallShown = L.recallShown || {}; L.recallShown[p[1]] = p[2] ? 'blank' : 'attempted'; L.at = now(); if (p[2]) s.reviews['L:' + p[0]] = { due: addDays(1), stage: 0, why: 'could not recall' }; save(s); render(); return; }
    el = t.closest('[data-ar1-apply]'); if (el) { s = st(); var L2 = s.lessons[el.dataset.ar1Apply] = s.lessons[el.dataset.ar1Apply] || {}; if (((L2.text || {}).apply || '').trim().length < 10) { U().toast('Try the task first'); return; } L2.applyShown = true; save(s); render(); return; }
    /* retrieval set */
    if (ui.run) {
      el = t.closest('[data-ar1-pick]'); if (el) { p = el.dataset.ar1Pick.split(':'); var q = item(p[1]), pick = Number(p[2]); ui.run.ans[q.id] = { pick: pick, ok: pick === q.a }; recordItem(q.id, pick === q.a, ui.run.key); render(); return; }
      el = t.closest('[data-ar1-typed]'); if (el) { var q2 = item(el.dataset.ar1Typed.split(':')[1]), val = ($('#ar1Ans') || {}).value || ''; if (!val.trim()) { U().toast('Type an answer'); return; } var ok = gradeTyped(q2, val); ui.run.ans[q2.id] = { text: val, ok: ok }; recordItem(q2.id, ok, ui.run.key); render(); return; }
      el = t.closest('[data-ar1-ord]'); if (el) { p = el.dataset.ar1Ord.split(':'); var oid = p[1], si = Number(p[2]), po = ui.run.order[oid] = ui.run.order[oid] || [], at = po.indexOf(si); if (at === -1) po.push(si); else po.splice(at, 1); render(); return; }
      el = t.closest('[data-ar1-ordsubmit]'); if (el) { var q3 = item(el.dataset.ar1Ordsubmit.split(':')[1]), ord = ui.run.order[q3.id] || []; var ok3 = ord.every(function (x, k) { return x === k; }); ui.run.ans[q3.id] = { order: ord.slice(), ok: ok3 }; recordItem(q3.id, ok3, ui.run.key); render(); return; }
      el = t.closest('[data-ar1-selfshow]'); if (el) { var q4 = item(el.dataset.ar1Selfshow.split(':')[1]), txt2 = ($('#ar1Self') || {}).value || ''; if (txt2.trim().length < 10) { U().toast('Write your answer first'); return; } ui.run.ans[q4.id] = { text: txt2, ok: false, rated: null, points: {} }; render(); return; }
      el = t.closest('[data-ar1-rate]'); if (el) { p = el.dataset.ar1Rate.split(':'); var a5 = ui.run.ans[p[1]]; a5.rated = Number(p[2]); a5.ok = a5.rated === 2; recordItem(p[1], a5.ok, ui.run.key); render(); return; }
      el = t.closest('[data-ar1-next]'); if (el) { ui.run.i++; finishSetIfDone(); render(); return; }
    }
    /* diagnostic */
    el = t.closest('[data-ar1-diag]'); if (el) { p = el.dataset.ar1Diag.split(':'); s = st(); s.diag.answers = s.diag.answers || {}; s.diag.answers[p[0]] = p[1] === 'skip' ? 'skip' : Number(p[1]); save(s); render(); return; }
    el = t.closest('[data-ar1-diagsubmit]'); if (el) { s = st(); s.diag.history = s.diag.history || []; s.diag.completedAt = now(); s.diag.scores = diagScores(s.diag.answers || {}); s.diag.history.push({ at: s.diag.completedAt, scores: s.diag.scores }); save(s); ui.detail.retake = false; render(); return; }
    el = t.closest('[data-ar1-diagretake]'); if (el) { s = st(); s.diag.answers = {}; save(s); ui.detail.retake = true; render(); return; }
    /* exercises */
    el = t.closest('[data-ar1-expick]'); if (el) { p = el.dataset.ar1Expick.split(':'); s = st(); var E = s.ex[p[0]] = s.ex[p[0]] || { startedAt: now() }; E.answers = E.answers || {}; E.answers[p[1]] = Number(p[2]); save(s); render(); return; }
    el = t.closest('[data-ar1-exord]'); if (el) { p = el.dataset.ar1Exord.split(':'); s = st(); var E2 = s.ex[p[0]] = s.ex[p[0]] || { startedAt: now() }; E2.answers = E2.answers || {}; var arr = E2.answers[p[1]] = E2.answers[p[1]] || [], si2 = Number(p[2]), at2 = arr.indexOf(si2); if (at2 === -1) arr.push(si2); else arr.splice(at2, 1); save(s); render(); return; }
    el = t.closest('[data-ar1-exsubmit]'); if (el) { submitEx(el.dataset.ar1Exsubmit); render(); return; }
    el = t.closest('[data-ar1-exredo]'); if (el) { s = st(); var old = s.ex[el.dataset.ar1Exredo]; s.ex[el.dataset.ar1Exredo] = { startedAt: now(), history: (old && old.history) || [] }; save(s); render(); return; }
    /* scenarios */
    el = t.closest('[data-ar1-scenario]'); if (el) { detail({ kind: 'scenario', id: el.dataset.ar1Scenario }); return; }
    /* cards */
    el = t.closest('[data-ar1-cardvar]'); if (el) { s = st(); var C = s.cards[ui.detail.id] = s.cards[ui.detail.id] || {}; C.variant = el.dataset.ar1Cardvar; save(s); render(); return; }
    el = t.closest('[data-ar1-cardpick]'); if (el) { p = el.dataset.ar1Cardpick.split(':'); s = st(); var C2 = s.cards[p[1]] = s.cards[p[1]] || {}; C2.picks = C2.picks || {}; C2.picks[p[2] + ':' + p[3]] = Number(p[4]); save(s); render(); return; }
    el = t.closest('[data-ar1-cardopt]'); if (el) { p = el.dataset.ar1Cardopt.split(':'); s = st(); var C3 = s.cards[p[0]] = s.cards[p[0]] || {}; C3.pick = p[1]; save(s); render(); return; }
    el = t.closest('[data-ar1-cardreveal]'); if (el) {
      p = el.dataset.ar1Cardreveal.split(':'); s = st(); var C4 = s.cards[p[0]] = s.cards[p[0]] || {}, cd = card(p[0]), W = ((C4.write || {})[p[1]]) || {};
      if (cd.variants) { if (!W.layer || W.layer.trim().length < 5 || (cd.questions || []).some(function (q, i) { return (C4.picks || {})[p[1] + ':' + i] == null; })) { U().toast('Write your reading and answer the questions first'); return; } C4.revealed = C4.revealed || {}; C4.revealed[p[1]] = now(); }
      else { if (!C4.pick || !(W.why || '').trim()) { U().toast('Pick an option and justify it first'); return; } }
      C4.revealedAt = now(); save(s); render(); return;
    }
    el = t.closest('[data-ar1-cardnext]'); if (el) { s = st(); var cd2 = card(el.dataset.ar1Cardnext), C5 = s.cards[cd2.id], ids = cd2.variants.map(function (v) { return v.id; }); C5.variant = ids[(ids.indexOf(C5.variant || ids[0]) + 1) % ids.length]; if (C5.revealed) delete C5.revealed[C5.variant]; save(s); render(); return; }
    /* terraform */
    el = t.closest('[data-ar1-tfmode]'); if (el) { ui.detail.mode = el.dataset.ar1Tfmode; ui.tfGrade = null; ui.tfShowResult = null; render(); return; }
    el = t.closest('[data-ar1-tfvar]'); if (el) { ui.detail.variant = el.dataset.ar1Tfvar; ui.tfGrade = null; ui.tfShowResult = null; render(); return; }
    el = t.closest('[data-ar1-file]'); if (el) { var ed = $('#ar1Editor'); if (ed && ed.dataset.ar1Edit) saveDraftFrom(ed); p = el.dataset.ar1File.split('|'); ui.tab[p[0]] = p[1]; render(); var ed2 = $('#ar1Editor'); if (ed2) ed2.focus(); return; }
    el = t.closest('[data-ar1-tfcheck]'); if (el) { var ed3 = $('#ar1Editor'); if (ed3) saveDraftFrom(ed3); ui.tfGrade = { key: el.dataset.ar1Tfcheck, res: tfGrade(ui.detail) }; render(); return; }
    el = t.closest('[data-ar1-tfhint]'); if (el) {
      p = el.dataset.ar1Tfhint.split('|'); var rung = Number(p[1]);
      if (rung === 4 && !window.confirm('Show the full solution? This attempt will count as assisted; you can retake with another variant for an independent result.')) return;
      s = st(); var hs = s.hints[p[0]] = s.hints[p[0]] || []; if (hs.indexOf(rung) === -1) hs.push(rung); if (rung === 4) s.solutions[p[0]] = now(); save(s);
      if (rung === 2) { var ed4 = $('#ar1Editor'); if (ed4) saveDraftFrom(ed4); ui.tfGrade = { key: p[0], res: tfGrade(ui.detail) }; }
      render(); return;
    }
    el = t.closest('[data-ar1-tfreset]'); if (el) { if (!window.confirm('Reset these files to their starting state? Your draft is discarded (submitted attempts are kept).')) return; s = st(); delete s.drafts[el.dataset.ar1Tfreset]; save(s); ui.tfGrade = null; render(); return; }
    el = t.closest('[data-ar1-tfstart]'); if (el) { s = st(); s.runs[el.dataset.ar1Tfstart] = { status: 'running', startedAt: now(), id: uid('run') }; delete s.drafts[el.dataset.ar1Tfstart]; s.hints[el.dataset.ar1Tfstart] = []; save(s); ui.tfShowResult = null; render(); return; }
    el = t.closest('[data-ar1-tfshow]'); if (el) { ui.tfShowResult = el.dataset.ar1Tfshow; render(); return; }
    el = t.closest('[data-ar1-tfsubmit]'); if (el) { var ed5 = $('#ar1Editor'); if (ed5 && !ed5.readOnly) saveDraftFrom(ed5); var a = submitTf(el.dataset.ar1Tfsubmit, false); U().toast(a.outcome === 'passed' ? 'Submitted: structural checks pass' : 'Submitted: see what to fix'); render(); return; }
    el = t.closest('[data-ar1-tfabandon]'); if (el) { if (!window.confirm('Abandon this interview attempt? It is recorded as abandoned and the solution is shown.')) return; var ed6 = $('#ar1Editor'); if (ed6) saveDraftFrom(ed6); submitTf(el.dataset.ar1Tfabandon, true); render(); return; }
    el = t.closest('[data-ar1-tfrub]'); if (el) { p = el.dataset.ar1Tfrub.split(':'); s = st(); var at3 = s.attempts[p[0]]; if (at3) { at3.rubric = at3.rubric || {}; at3.rubric[p[1]] = Number(p[2]); save(s); } render(); return; }
    el = t.closest('[data-ar1-tfnewvar]'); if (el) { var Lx = tfLab(el.dataset.ar1Tfnewvar), cur = ui.detail.variant, keys = Object.keys(Lx.variants); var used = {}; attemptsFor(Lx.id, 'tf').forEach(function (x) { used[x.variant] = 1; }); var nv = keys.filter(function (k) { return k !== cur && !used[k]; })[0] || keys[(keys.indexOf(cur) + 1) % keys.length]; ui.detail.variant = nv; ui.detail.mode = Lx.modes.indexOf('interview') !== -1 ? 'interview' : 'practice'; ui.tfGrade = null; ui.tfShowResult = null; render(); window.scrollTo(0, 0); return; }
    el = t.closest('[data-ar1-local]'); if (el) { p = el.dataset.ar1Local.split('|'); s = st(); s.local[p[0]] = (s.local[p[0]] || []).concat([{ result: p[1], at: now(), reviewer: 'self (real CLI on your machine)' }]); save(s); U().toast('Recorded as self-reported local result'); render(); return; }
    /* bash */
    el = t.closest('[data-ar1-bashhint]'); if (el) { p = el.dataset.ar1Bashhint.split('|'); s = st(); var bh = s.hints['bash:' + p[0]] = s.hints['bash:' + p[0]] || []; if (bh.indexOf(Number(p[1])) === -1) bh.push(Number(p[1])); save(s); render(); return; }
    el = t.closest('[data-ar1-bashrec]'); if (el) {
      var pn = Number(($('#ar1bp') || {}).value), tn = Number(($('#ar1bt') || {}).value), other = ($('#ar1bo') || {}).checked;
      if (!(tn > 0) || !(pn >= 0) || pn > tn) { U().toast('Enter the passed and total counts from run-tests.sh'); return; }
      s = st(); var bk = 'bash:' + el.dataset.ar1Bashrec, hh = s.hints[bk] || [];
      addAttempt({ kind: 'bash', activityId: el.dataset.ar1Bashrec, passedN: pn, totalN: tn, allPassed: pn === tn, hints: hh.slice(), solutionViewed: hh.indexOf(4) !== -1 || other, assistance: other ? 'assisted' : assistanceOf(hh, hh.indexOf(4) !== -1), startedAt: now(), completedAt: now(), outcome: pn === tn ? 'passed' : 'failed', reviewer: 'self (local test run)' });
      s = st(); s.hints[bk] = []; save(s); U().toast('Recorded'); render(); return;
    }
    /* mocks */
    el = t.closest('[data-ar1-mock]'); if (el) { detail({ kind: 'mock', id: el.dataset.ar1Mock }); return; }
    el = t.closest('[data-ar1-mockattempt]'); if (el) { p = el.dataset.ar1Mockattempt.split(':'); detail({ kind: 'mock', id: p[0], attempt: p[1] }); return; }
    el = t.closest('[data-ar1-mockstart]'); if (el) { if (liveMock(el.dataset.ar1Mockstart)) { render(); return; } var att = addAttempt({ kind: 'mock', activityId: el.dataset.ar1Mockstart, status: 'running', phase: 0, startedAt: now(), attested: !!($('#ar1Attest') || {}).checked, answers: {}, hints: [] }); ui.detail.attempt = att.id; render(); window.scrollTo(0, 0); return; }
    el = t.closest('[data-ar1-mockphase]'); if (el) { var ed7 = $('#ar1Editor'); if (ed7) saveDraftFrom(ed7); s = st(); var live = s.attempts[ui.detail.attempt] || liveMock(ui.detail.id); if (live && live.status === 'running') { s.attempts[live.id].phase = Number(el.dataset.ar1Mockphase); save(s); } render(); window.scrollTo(0, 0); return; }
    el = t.closest('[data-ar1-mocksubmit]'); if (el) { var ed8 = $('#ar1Editor'); if (ed8) saveDraftFrom(ed8); if (!window.confirm('Submit the mock now? Hints, answers and structural feedback will be shown.')) return; mockStop(el.dataset.ar1Mocksubmit, 'submitted'); ui.detail.attempt = el.dataset.ar1Mocksubmit; render(); window.scrollTo(0, 0); return; }
    el = t.closest('[data-ar1-mockabandon]'); if (el) { if (!window.confirm('Abandon this mock? It is recorded as abandoned (not independent) and the answers are shown.')) return; var ed9 = $('#ar1Editor'); if (ed9) saveDraftFrom(ed9); mockStop(el.dataset.ar1Mockabandon, 'abandoned'); ui.detail.attempt = el.dataset.ar1Mockabandon; render(); return; }
    el = t.closest('[data-ar1-mockrestart]'); if (el) { if (!window.confirm('Start a new attempt? The previous one stays in your history; the new one starts from blank files and a fresh timer.')) return; ui.detail = { kind: 'mock', id: el.dataset.ar1Mockrestart }; render(); return; }
    el = t.closest('[data-ar1-mockrate]'); if (el) { p = el.dataset.ar1Mockrate.split(':'); s = st(); var am = s.attempts[p[0]]; am.review = am.review || {}; am.review.ratings = am.review.ratings || {}; am.review.ratings[p[1]] = Number(p[2]); save(s); render(); return; }
    el = t.closest('[data-ar1-mockbash]'); if (el) { s = st(); var ab = s.attempts[el.dataset.ar1Mockbash], bp = Number(($('#ar1mbp') || {}).value), bt = Number(($('#ar1mbt') || {}).value); if (!(bt > 0) || bp > bt) { U().toast('Enter passed and total'); return; } ab.bash = { passed: bp, total: bt }; save(s); render(); return; }
    el = t.closest('[data-ar1-mockreview]'); if (el) { s = st(); var ar = s.attempts[el.dataset.ar1Mockreview], Md = mockDef(ar.activityId); ar.review = ar.review || {}; ar.review.pct = weighted(Md, ar.review.ratings || {}); ar.review.band = bandFor(Md, ar, ar.review.ratings || {}); ar.reviewedAt = now(); save(s); U().toast('Review saved'); render(); return; }
    el = t.closest('[data-ar1-remediate]'); if (el) { detail({ kind: 'remediate' }); return; }
    el = t.closest('[data-ar1-remdone]'); if (el) { s = st(); s.done.remediate = { dim: el.dataset.ar1Remdone, at: now() }; save(s); render(); return; }
  });
  document.addEventListener('keydown', function (e) {
    /* Escape leaves a detail view, except inside editors where it may be typed habitually */
    if (e.key !== 'Escape' || !ui.detail || !root() || !root().contains(e.target)) return;
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') { e.target.blur(); return; }
    goBack();
  });

  window.LXAr1 = {
    render: render, go: go, open: show,
    firstSeed: firstSeed, nextSeed: nextSeed, recordScenario: recordScenario, scenarioDebrief: scenarioDebrief,
    state: st, nextAction: nextAction, itemDone: itemDone, evidence: evidence, attemptsFor: attemptsFor, dueReviews: dueReviews,
    pickRecall: pickRecall, routeItems: routeItems, _ui: ui
  };
})();
