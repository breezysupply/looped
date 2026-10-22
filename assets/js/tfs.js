/* Course hub for "Terraform + AWS: From Guided Builds to Live Tech Screen"
   (window.LXTfs, track tfaws, course id terraform-aws-tech-screen).

   Sections: Overview (paths, next action, resume), Modules, Schedule,
   Mocks, Review (rubric history, mistake log, 10-minute review queue),
   Readiness (Module 8), About (modes, versions, sources).

   Detail views: lesson (Learn → Predict → Build → Check → Explain →
   Rebuild), diagnostic, knowledge checks, oral prompts, build workspace
   (four assistance levels, simulated terminal, local export, optional AWS
   steps, review with side-by-side solution), NAT fault drills, bug tickets,
   synthetic plan reading, mock screen, rehearsal.

   Honesty rules enforced here: hints and solutions mark an attempt
   assisted; interview and mock modes hide help until submit; paused timed
   attempts are untimed practice; practice checks are labelled as such and
   unassessable items show as manual review; simulated, local and AWS
   evidence are labelled separately; unassessed rubric points are never
   counted. State: one localStorage key, lx.tfaws. */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function U() { return window.LXUtil; }
  function esc(x) { return U().esc(x == null ? '' : x); }
  var KEY = 'lx.tfaws';
  var BUCKETS = ['ui', 'lessons', 'quiz', 'done', 'attempts', 'work', 'sims', 'tickets', 'plans', 'faults', 'readiness', 'local', 'aws', 'oral'];

  /* ── storage ─────────────────────────────────────────────────── */
  function st() {
    var s = U().LS.get(KEY, {}) || {};
    if (!s.v) s.v = 1;
    BUCKETS.forEach(function (k) { if (!s[k] || typeof s[k] !== 'object' || Array.isArray(s[k])) s[k] = {}; });
    if (!Array.isArray(s.mistakes)) s.mistakes = [];
    if (!s.diag || typeof s.diag !== 'object') s.diag = {};
    return s;
  }
  function save(s) { U().LS.set(KEY, s); }
  function now() { return new Date().toISOString(); }
  function uid(p) { return p + '-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36); }
  function ymdNY(d) {
    try { var p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d || new Date()); return p; }
    catch (e) { d = d || new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  }
  function dayDiff(a, b) { return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5); }
  function addDays(day, n) { var d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function mmss(sec) { sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ':' + ('0' + sec % 60).slice(-2); }
  function fmtDay(day) { try { return new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }); } catch (e) { return day; } }

  /* ── content ─────────────────────────────────────────────────── */
  function T() { return LX.tfs || {}; }
  function list(k) { return (window.LX && LX[k]) || []; }
  function byId(k, id) { return list(k).filter(function (x) { return x.id === id; })[0] || null; }
  function lesson(id) { return byId('tfsLessons', id); }
  function lab(id) { return byId('tfsLabs', id); }
  function mockDef(id) { return byId('tfsMocks', id); }
  function moduleOf(id) { return (T().modules || []).filter(function (m) { return m.id === id; })[0] || null; }
  function src(key) { var f = (LX.tfsSrc || {})[key]; if (!f) return null; var o = {}; Object.keys(f).forEach(function (k) { o[k] = f[k]; }); return o; }
  function source(id) { return (T().sources || []).filter(function (x) { return x.id === id; })[0] || null; }

  /* ── markdown-lite ───────────────────────────────────────────── */
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
      if (/^```/.test(lines[0])) { out.push('<pre class="term term-static tfs-code">' + esc(lines.slice(1, /^```/.test(lines[lines.length - 1]) && lines.length > 1 ? -1 : undefined).join('\n')) + '</pre>'); return; }
      if (lines.every(function (l) { return /^\s*- /.test(l); })) { out.push('<ul class="bullets">' + lines.map(function (l) { return '<li>' + inline(l.replace(/^\s*- /, '')) + '</li>'; }).join('') + '</ul>'); return; }
      if (lines.every(function (l) { return /^\s*\d+\. /.test(l); })) { out.push('<ol class="steps-why">' + lines.map(function (l) { return '<li>' + inline(l.replace(/^\s*\d+\. /, '')) + '</li>'; }).join('') + '</ol>'); return; }
      out.push('<p>' + lines.map(inline).join('<br>') + '</p>');
    });
    return out.join('');
  }
  function ul(items, fn) { if (!items || !items.length) return ''; return '<ul class="bullets">' + items.map(function (x) { return '<li>' + (fn ? fn(x) : inline(x)) + '</li>'; }).join('') + '</ul>'; }
  function label(t) { return '<p class="section-label">' + esc(t) + '</p>'; }
  function badge(t, cls) { return '<span class="badge' + (cls ? ' ' + cls : '') + '">' + esc(t) + '</span>'; }
  function pre(text, cls) { return '<pre class="term term-static tfs-code' + (cls ? ' ' + cls : '') + '">' + esc(text) + '</pre>'; }
  function copyPre(text, lbl) { return '<div class="cmd-block"><pre class="term term-static">' + esc(text) + '</pre><button class="btn ghost small copy-btn" data-tfs-copy="' + esc(text) + '" aria-label="Copy ' + esc(lbl || 'commands') + '">Copy</button></div>'; }
  function srcLink(id) { var s = source(id); if (!s) return esc(id); return '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + '</a> <span class="muted small">(' + esc(s.status) + ', accessed ' + esc(s.accessed) + ')</span>'; }
  function refs(ids) { return ids && ids.length ? label('Official documentation') + ul(ids, srcLink) : ''; }
  function back() { return '<button class="btn ghost small prep-back" data-tfs-back>← Back</button>'; }
  function seg(name, options, cur, attr) {
    return '<div class="seg-row" role="group" aria-label="' + esc(name) + '">' + options.map(function (o) { var on = o[0] === cur; return '<button class="seg' + (on ? ' active' : '') + '" ' + attr + '="' + esc(o[0]) + '" aria-pressed="' + on + '"' + (o[2] ? ' disabled title="' + esc(o[2]) + '"' : '') + '>' + esc(o[1]) + '</button>'; }).join('') + '</div>';
  }
  function modeBadge(m) { var M = T().modes[m]; return '<span class="badge tfs-mode tfs-mode-' + m + '">' + esc(M.label) + '</span>'; }
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; } return h; }
  function shuffled(n, seed) { var a = []; for (var i = 0; i < n; i++) a.push(i); var h = hash(seed); for (var j = n - 1; j > 0; j--) { h = (h * 1103515245 + 12345) >>> 0; var k = h % (j + 1); var t = a[j]; a[j] = a[k]; a[k] = t; } if (n > 1 && a.every(function (x, q) { return x === q; })) a.push(a.shift()); return a; }

  var SECTIONS = [['overview', 'Overview'], ['modules', 'Modules'], ['schedule', 'Schedule'], ['mocks', 'Mocks'], ['review', 'Review'], ['ready', 'Readiness'], ['about', 'About']];
  var LEVELS = [['guided', 'Guided'], ['scaffolded', 'Scaffolded'], ['requirements', 'Requirements only'], ['interview', 'Interview']];
  var ui = { section: null, detail: null, stack: [], tab: {}, grade: null, diffFile: {} };
  var WHY = {
    routing: 'Without the right route and association, traffic silently never arrives or never leaves — the most common failure that validate cannot see.',
    security: 'Security groups and public addresses decide who can reach an instance and whether it can bootstrap; mistakes here are exposure or outages.',
    references: 'References carry both the value and the ordering; a wrong or quoted one breaks the plan or the dependency graph.',
    hcl: 'Typed, pinned, readable HCL is what a reviewer reads first and what catches mistakes before AWS does.',
    state: 'State ties code to real objects; careless renames or edits destroy or orphan infrastructure.',
    verification: 'Knowing what each check proves is how you avoid shipping something that validates but does not work.',
    communication: 'The screen scores how you clarify, narrate and collaborate, not only the final code.'
  };

  /* ══ attempts and timing ═════════════════════════════════════════ */
  function activeSec(a, at) {
    var t = 0, start = null;
    (a.events || []).forEach(function (e) {
      if (e.type === 'start' || e.type === 'resume') start = Date.parse(e.t);
      else if ((e.type === 'pause' || e.type === 'submit') && start != null) { t += (Date.parse(e.t) - start) / 1000; start = null; }
    });
    if (start != null) t += ((at || Date.now()) - start) / 1000;
    return Math.max(0, t);
  }
  function isRunning(a) { var e = a.events || []; var l = e[e.length - 1]; return !!l && (l.type === 'start' || l.type === 'resume'); }
  function newAttempt(kind, o) {
    var s = st(), a = { id: uid(kind), kind: kind, contentVersion: T().version, files: o.files || {}, startedAt: now(), events: [{ t: now(), type: 'start' }], hints: [], solutionViewed: false, paused: false };
    Object.keys(o).forEach(function (k) { if (k !== 'files') a[k] = o[k]; });
    s.attempts[a.id] = a; save(s); return a;
  }
  function attempt(id) { return st().attempts[id] || null; }
  function putAttempt(a) { var s = st(); s.attempts[a.id] = a; save(s); }
  function attemptsOf(pred) { var s = st(); return Object.keys(s.attempts).map(function (k) { return s.attempts[k]; }).filter(pred).sort(function (x, y) { return x.startedAt < y.startedAt ? -1 : 1; }); }
  function classify(a) {
    if (!a.submittedAt) return a.abandoned ? 'abandoned' : 'in progress';
    if (a.solutionViewed || (a.hints || []).length || a.level === 'guided' || a.level === 'scaffolded') return 'assisted';
    if (a.timed && a.paused) return 'untimed practice';
    return 'independent';
  }
  var CLASS_NOTE = { assisted: 'assisted — hints, a solution or a scaffold were used', independent: 'independent', 'untimed practice': 'untimed practice — the timer was paused', 'in progress': 'in progress', abandoned: 'abandoned' };

  /* ── workspace key per lab + level + variant ─────────────────── */
  function wkey(labId, level, variant) { return labId + ':' + level + ':' + (variant || 'base'); }
  function startFiles(L, level) {
    var lv = L.levels[level] || {}, files = {};
    L.files.forEach(function (f) { files[f] = ''; });
    if (lv.src) { var s = src(lv.src) || {}; L.files.forEach(function (f) { files[f] = s[f] || ''; }); }
    return files;
  }
  function currentLabAttempt(L, level, variant) { var s = st(), id = s.work[wkey(L.id, level, variant)]; return id && s.attempts[id] ? s.attempts[id] : null; }
  /* the workspace's current attempt (submitted ones stay current so their
     review shows) or a fresh one from the level's starting files */
  function ensureLabAttempt(L, level, variant) {
    var a = currentLabAttempt(L, level, variant);
    if (a && !a.abandoned) return a;
    a = newAttempt('lab', { labId: L.id, level: level, variant: variant || 'base', files: startFiles(L, level), timed: level === 'interview' || !!L.independent, limit: (L.levels[level] && L.levels[level].mins ? L.levels[level].mins : L.mins) * 60 });
    var s = st(); s.work[wkey(L.id, level, variant)] = a.id; s.ui.last = { kind: 'lab', id: L.id, level: level, variant: variant }; save(s);
    return a;
  }
  function restartLab(L, level, variant) {
    var s = st(), old = s.attempts[s.work[wkey(L.id, level, variant)]];
    if (old && !old.submittedAt && !old.abandoned) { old.abandoned = true; old.events.push({ t: now(), type: 'pause' }); s.attempts[old.id] = old; }
    delete s.work[wkey(L.id, level, variant)]; save(s);
    return ensureLabAttempt(L, level, variant);
  }
  function edited(a, L) { var base = startFiles(L, a.level); return Object.keys(a.files).some(function (f) { return (a.files[f] || '') !== (base[f] || ''); }); }

  /* ── grading ─────────────────────────────────────────────────── */
  function variantOf(L, v) { return L.variants[v] || L.variants.base || L.variants[Object.keys(L.variants)[0]]; }
  function gradeFiles(files, checks, opts) { return window.LXHcl.grade(files, checks, opts); }
  function logMistakes(res, source) {
    if (!res || !res.results) return;
    var s = st();
    res.results.filter(function (r) { return !r.ok && !r.na && r.sev !== 'advice'; }).forEach(function (r) {
      s.mistakes.push({ at: now(), cat: r.cat || 'hcl', label: r.label, why: r.why, lesson: r.lesson || null, source: source, critical: r.sev === 'critical' });
    });
    if (s.mistakes.length > 300) s.mistakes = s.mistakes.slice(-300);
    save(s);
  }

  /* ══ path items and progress ══════════════════════════════════ */
  function itemKey(m, it) { return m.id + ':' + it.kind + ':' + it.id; }
  function itemDone(m, it) {
    var s = st();
    switch (it.kind) {
      case 'lesson': var l = s.lessons[it.id]; return !!(l && l.completedAt);
      case 'diag': return !!s.diag.completedAt;
      case 'lab': return attemptsOf(function (a) { return a.kind === 'lab' && a.labId === it.id && a.submittedAt; }).length > 0;
      case 'mock': return attemptsOf(function (a) { return a.kind === 'mock' && a.mockId === it.id && a.submittedAt; }).length > 0;
      case 'mockreview': return attemptsOf(function (a) { return a.kind === 'mock' && a.mockId === it.id && a.reviewedAt; }).length > 0;
      default: return !!s.done[itemKey(m, it)];
    }
  }
  function itemTitle(it) {
    switch (it.kind) {
      case 'lesson': var l = lesson(it.id); return l ? l.title : it.id;
      case 'diag': return 'Baseline diagnostic (ungraded)';
      case 'lab': var L = lab(it.id); return L ? L.title + (it.level ? ' — ' + it.level : '') : it.id;
      case 'quiz': return 'Knowledge checks';
      case 'oral': return 'Explain it aloud: interview prompts';
      case 'faults': return 'Injected faults: five broken NAT builds';
      case 'plan': return 'Exercise 5.3: read a synthetic plan';
      case 'tickets': return it.id === 'essentials' ? 'Bug tickets: essentials (references, routing, validate vs connectivity)' : 'Bug tickets: more (types, keys, security, count, associations)';
      case 'mock': var M = mockDef(it.id); return M ? M.title : it.id;
      case 'mockreview': return 'Review Mock ' + it.id + ' (rubric, follow-ups, remediation)';
      case 'readiness': return 'Opening story, your questions, day-of checklist';
      default: return it.id;
    }
  }
  var KIND = { lesson: 'lesson', diag: 'diagnostic', lab: 'build', quiz: 'quiz', oral: 'oral', faults: 'faults', plan: 'plan', tickets: 'tickets', mock: 'mock', mockreview: 'review', readiness: 'readiness' };
  function itemButton(m, it, meta) {
    var done = itemDone(m, it);
    return '<li><button class="path-item' + (done ? ' done' : '') + '" data-tfs-item="' + esc(JSON.stringify({ m: m.id, it: it })) + '"><span class="pi-tick" aria-hidden="true">' + (done ? '✓' : '○') + '</span><span class="pi-kind">' + esc(KIND[it.kind] || it.kind) + ' · ' + it.mins + ' min' + (it.min ? ' · minimum path' : '') + (meta ? ' · ' + esc(meta) : '') + '</span><span class="pi-title">' + esc(itemTitle(it)) + '</span><span class="sr-only">' + (done ? ' — done' : ' — not done') + '</span></button></li>';
  }
  function pathItems(path) {
    var out = [];
    (T().modules || []).forEach(function (m) {
      if (path === 'minimum' && T().paths.minimum.modules.indexOf(m.id) === -1) return;
      m.items.forEach(function (it) {
        if (path === 'minimum' && m.id === 'm5' && !it.min) return;
        if (path === 'minimum' && m.id === 'm7' && T().paths.minimum.m7Only.indexOf(it.kind + ':' + it.id) === -1) return;
        out.push({ m: m, it: it });
      });
    });
    return out;
  }
  function pathMins(path) { return pathItems(path).reduce(function (n, x) { return n + x.it.mins; }, 0); }
  function nextItem(path) { var all = pathItems(path === 'self' ? 'full' : path); for (var i = 0; i < all.length; i++) if (!itemDone(all[i].m, all[i].it)) return all[i]; return null; }
  function moduleProgress(m) { var d = m.items.filter(function (it) { return itemDone(m, it); }).length; return { done: d, total: m.items.length }; }
  function openItem(mId, it) {
    var s = st(); s.ui.last = { kind: 'item', m: mId, it: it }; save(s);
    switch (it.kind) {
      case 'lesson': return detail({ kind: 'lesson', id: it.id, m: mId });
      case 'diag': return detail({ kind: 'diag' });
      case 'lab': return detail({ kind: 'lab', id: it.id, level: it.level || 'guided', variant: it.variant || 'base' });
      case 'quiz': return detail({ kind: 'quiz', id: it.id, m: mId });
      case 'oral': return detail({ kind: 'oral', id: it.id, m: mId });
      case 'faults': return detail({ kind: 'faults', id: it.id, m: mId });
      case 'plan': return detail({ kind: 'plan', id: it.id, m: mId });
      case 'tickets': return detail({ kind: 'tickets', id: it.id, m: mId });
      case 'mock': return detail({ kind: 'mock', id: it.id, variant: it.variant || null });
      case 'mockreview': var a = latestMock(it.id, true); return a ? detail({ kind: 'mock', id: it.id, attempt: a.id }) : detail({ kind: 'mock', id: it.id });
      case 'readiness': return go('ready');
    }
  }
  function markDone(mId, kind, id) { var s = st(); s.done[mId + ':' + kind + ':' + id] = now(); save(s); }

  /* ══ rendering frame ═══════════════════════════════════════════ */
  function root() { return document.getElementById('view-tfs'); }
  function render() {
    var el = root(); if (!el || !window.LX || !LX.tfs) return;
    var s = st();
    if (!ui.section) ui.section = s.ui.section || 'overview';
    var nav = '<div class="chips prep-nav" role="group" aria-label="Course sections">' + SECTIONS.map(function (x) {
      var on = !ui.detail && ui.section === x[0];
      return '<button class="chip' + (on ? ' active' : '') + '" data-tfs-section="' + x[0] + '" aria-pressed="' + on + '">' + esc(x[1]) + '</button>';
    }).join('') + '</div>';
    var body;
    try { body = ui.detail ? DETAIL[ui.detail.kind]() : RENDER[ui.section](); }
    catch (e) { body = '<p class="empty">This view could not render: ' + esc(e.message) + '</p>'; if (window.console) console.error(e); }
    el.innerHTML = '<div class="prep-body tfs">' + nav + body + '</div>';
    tick();
  }
  function go(section) { ui.section = section; ui.detail = null; ui.stack = []; ui.grade = null; var s = st(); s.ui.section = section; save(s); render(); window.scrollTo(0, 0); }
  function detail(d) { if (ui.detail) ui.stack.push(ui.detail); ui.detail = d; ui.grade = null; render(); window.scrollTo(0, 0); }
  function goBack() { ui.detail = ui.stack.pop() || null; ui.grade = null; render(); window.scrollTo(0, 0); }

  /* ── Overview ────────────────────────────────────────────────── */
  function renderOverview() {
    var t = T(), s = st(), path = s.ui.path || 'full', n = nextItem(path), I = t.interview;
    var html = '<article class="card path-card tfs-course-card"><div class="card-main"><p class="muted small time-slot">Course · ' + esc(t.id) + '</p><h2 class="card-title plain">' + esc(t.title) + '</h2>' +
      '<p class="small">' + esc(t.outcome) + '</p><p class="muted small">' + esc(t.learnerNote) + '</p>' +
      (s.enrolledAt ? '<p class="small">Enrolled ' + esc(s.enrolledAt.slice(0, 10)) + ' · ' + badge(t.paths[path].label) + '</p>' : '<div class="done-btns"><button class="btn primary small" data-tfs-enroll>Start this course</button></div>') +
      '</div></article>';
    if (s.enrolledAt) {
      html += '<article class="card path-card next"><div class="card-main">';
      if (n) {
        html += '<p class="muted small time-slot">Next · Module ' + n.m.n + ' · ' + esc(n.m.title) + '</p><p class="card-title plain">' + esc(itemTitle(n.it)) + '</p><p class="small">' + n.it.mins + ' min · ' + esc(n.m.outcome) + '</p>' +
          '<div class="done-btns"><button class="btn primary small" data-tfs-item="' + esc(JSON.stringify({ m: n.m.id, it: n.it })) + '">Start</button>' + (s.ui.last ? '<button class="btn small" data-tfs-resume>Resume where you left off</button>' : '') + '</div>';
      } else html += '<p class="card-title plain">Every item on this path is done.</p><p class="small">Repeat a mock with a new variant, or try the stretch lab.</p>';
      html += '</div></article>';
    }
    html += label('Paths') + seg('Path', [['full', 'Recommended · 7 h 15 min'], ['minimum', 'Minimum · 5 h 5 min'], ['self', 'Self-paced']], path, 'data-tfs-path') +
      '<p class="small">' + esc(t.paths[path].note) + '</p>' +
      (path === 'minimum' ? '<p class="tip small">Recommended follow-up outside the minimum path: ' + esc(pathItems('full').filter(function (x) { return !pathItems('minimum').some(function (y) { return y.it === x.it; }); }).map(function (x) { return itemTitle(x.it); }).join(' · ')) + '.</p>' : '') +
      '<p class="muted small">Work: ' + pathMins(path === 'self' ? 'full' : path) + ' min required on this path · ' + pathItems(path === 'self' ? 'full' : path).filter(function (x) { return itemDone(x.m, x.it); }).length + ' of ' + pathItems(path === 'self' ? 'full' : path).length + ' items done. ' + esc(t.budget) + '</p>';
    html += label('Modules') + '<div class="table-wrap"><table class="tiers small"><caption class="sr-only">Modules</caption><thead><tr><th scope="col">Module</th><th scope="col">Core time</th><th scope="col">Outcome</th><th scope="col">Done</th></tr></thead><tbody>' +
      t.modules.map(function (m) { var p = moduleProgress(m); return '<tr><th scope="row"><button class="linkish" data-tfs-module="' + m.id + '">' + m.n + '. ' + esc(m.title) + '</button></th><td>' + m.mins + ' min</td><td>' + esc(m.outcome) + '</td><td>' + p.done + '/' + p.total + '</td></tr>'; }).join('') +
      '<tr><th scope="row">Recommended total</th><td><b>' + t.modules.reduce(function (a, m) { return a + m.mins; }, 0) + ' min</b></td><td>7 h 15 min</td><td></td></tr></tbody></table></div>';
    html += label('The interview (from the supplied prep guide)') + '<p class="small"><b>' + esc(fmtDay(I.date)) + ', ' + I.start + '–' + I.end + ' ' + esc(I.tz) + '</b> · ' + esc(I.role) + '</p>' + ul(I.format) +
      '<p class="small">Evaluated on: ' + esc(I.evaluation.join(', ')) + '.</p><p class="small">' + esc(I.rules) + ' Mock mode is labelled: <i>' + esc(I.docsLabel) + '</i></p><p class="muted small">' + esc(I.disclaimer) + '</p>';
    html += label('Three ways to run your code') + ul(['sim', 'local', 'aws'], function (k) { return modeBadge(k) + ' ' + inline(t.modes[k].text); });
    return html;
  }

  /* ── Modules ─────────────────────────────────────────────────── */
  function renderModules() {
    var s = st(), path = s.ui.path || 'full', minSet = pathItems('minimum');
    var html = '<p class="blurb">Learn → Predict → Build → Check → Explain → Rebuild, in every module. Items marked "minimum path" are the 305-minute route.</p>';
    T().modules.forEach(function (m) {
      var p = moduleProgress(m), open = ui.openModule === m.id || (!ui.openModule && nextItem(path) && nextItem(path).m === m);
      html += '<details class="brief-wrap week' + (open ? ' now' : '') + '" id="tfs-' + m.id + '"' + (open ? ' open' : '') + '><summary>Module ' + m.n + ' · ' + esc(m.title) + ' <span class="muted small">' + m.mins + ' min · ' + p.done + '/' + p.total + '</span></summary><div class="situation"><p class="muted small">Outcome: ' + esc(m.outcome) + '</p><ul class="path-items">' +
        m.items.map(function (it) { var inMin = minSet.some(function (x) { return x.it === it; }); return itemButton(m, it, inMin && m.id !== 'm5' ? null : null); }).join('') + '</ul></div></details>';
    });
    html += label('Optional (outside the 435 minutes)') + '<ul class="path-items">' + T().optional.map(function (o) {
      return '<li><button class="path-item" data-tfs-opt="' + esc(JSON.stringify(o)) + '"><span class="pi-tick" aria-hidden="true">+</span><span class="pi-kind">optional · ' + o.mins + ' min</span><span class="pi-title">' + esc(o.why) + '</span></button></li>';
    }).join('') + '</ul>';
    return html;
  }

  /* ── Schedule ────────────────────────────────────────────────── */
  function scheduleDays() {
    var s = st(), t = T(), start = s.ui.schedStart || t.schedule[0].date, shift = dayDiff(t.schedule[0].date, start);
    return t.schedule.map(function (d, i) { return { n: i + 1, date: addDays(d.date, shift), mins: d.mins, label: d.label, note: d.note, items: d.items }; });
  }
  function dayItems(d) {
    var out = [];
    d.items.forEach(function (ref) {
      var p = ref.split(':'), m = moduleOf(p[0]); if (!m) return;
      m.items.forEach(function (it) { if (p[1] === '*' || (p[1] === it.kind && p[2] === it.id)) if (!out.some(function (x) { return x.it === it; })) out.push({ m: m, it: it }); });
    });
    return out;
  }
  function renderSchedule() {
    var s = st(), today = ymdNY(), days = scheduleDays(), t = T(), interview = t.interview.date;
    var self = s.ui.path === 'self';
    var html = '<p class="blurb">Nine days, ' + days.reduce(function (n, d) { return n + d.mins; }, 0) + ' minutes, America/New_York dates. This sprint asks for more than your usual 3–4 hours a week. Dates never lock anything: if you fall behind, shift the plan or switch to the minimum path.</p>';
    if (self) html += '<p class="tip small">Self-paced mode: dates are hidden; work module by module.</p>';
    var behind = days.filter(function (d) { return d.date < today && dayItems(d).some(function (x) { return !itemDone(x.m, x.it); }); });
    if (!self && behind.length) html += '<div class="tip small"><b>Behind by ' + behind.length + ' day' + (behind.length === 1 ? '' : 's') + '.</b> Options: <button class="linkish" data-tfs-resched>start the remaining plan from today</button> (keeps all progress), or switch to the minimum path. If time is short, defer in this order: ' + esc(t.deferOrder.join('; ')) + '.</div>';
    if (today > interview) html += '<p class="muted small">The interview date (' + esc(fmtDay(interview)) + ') has passed; everything stays available.</p>';
    days.forEach(function (d) {
      var items = dayItems(d), done = items.filter(function (x) { return itemDone(x.m, x.it); }).length, isToday = d.date === today;
      html += '<details class="brief-wrap week' + (isToday ? ' now' : '') + '"' + (isToday ? ' open' : '') + '><summary>' + (self ? 'Day ' + d.n : esc(fmtDay(d.date))) + ' · ' + esc(d.label) + ' <span class="muted small">' + d.mins + ' min · ' + done + '/' + items.length + (isToday ? ' · today' : '') + '</span></summary><div class="situation">' + (d.note ? '<p class="muted small">' + esc(d.note) + '</p>' : '') + '<ul class="path-items">' + items.map(function (x) { return itemButton(x.m, x.it); }).join('') + '</ul></div></details>';
    });
    html += '<p class="small"><b>' + (self ? 'Interview day' : esc(fmtDay(t.warmup.date))) + ':</b> ' + esc(t.warmup.text) + '</p>';
    html += '<div class="done-btns"><button class="btn small ghost" data-tfs-resched>Start the plan from today</button>' + (s.ui.schedStart ? '<button class="btn small ghost" data-tfs-reschedreset>Back to the original dates</button>' : '') + '</div>';
    return html;
  }

  /* ── Mocks list ──────────────────────────────────────────────── */
  function mockAttempts(id) { return attemptsOf(function (a) { return a.kind === 'mock' && (!id || a.mockId === id); }); }
  function latestMock(id, submitted) { var a = mockAttempts(id).filter(function (x) { return !submitted || x.submittedAt; }); return a.length ? a[a.length - 1] : null; }
  function readiness() {
    var good = mockAttempts().filter(function (a) { var sc = a.score; return a.submittedAt && classify(a) === 'independent' && sc && sc.complete && sc.total >= 80 && sc.coreOk && !(sc.critical || []).length; });
    var ids = {}; good.forEach(function (a) { ids[a.mockId + a.variant] = 1; });
    return { count: good.length, distinct: Object.keys(ids).length, attempts: good };
  }
  function renderMocks() {
    var R = readiness();
    var html = '<p class="blurb">Two 45-minute screens with a 10-minute review each. Code assistance is off in mock mode; ' + esc(T().interview.docsLabel.toLowerCase()) + '</p>' +
      '<div class="tip small"><b>Practice target:</b> ' + esc(T().rubric.readiness) + ' <br><b>Status:</b> ' + (R.count >= 2 ? 'two or more independent timed mocks at 80+ with the core satisfied.' : R.count === 1 ? 'one independent mock completed at 80+ — not interview-ready by assumption.' : 'no qualifying mock yet.') + '</div>';
    list('tfsMocks').forEach(function (M) {
      var at = mockAttempts(M.id);
      html += '<article class="card path-card"><div class="card-main"><p class="card-title plain">' + esc(M.title) + ' <span class="muted small">' + M.mins + ' + ' + M.review + ' min</span></p>' + md(M.brief.split('\n\n')[0]) +
        '<div class="done-btns"><button class="btn small primary" data-tfs-mock="' + M.id + '">Open</button></div>' +
        (at.length ? '<div class="table-wrap"><table class="tiers small"><caption class="sr-only">Attempts</caption><thead><tr><th scope="col">Started</th><th scope="col">Variant</th><th scope="col">Status</th><th scope="col">Time</th><th scope="col">Score</th></tr></thead><tbody>' + at.map(function (a) {
          return '<tr><td><button class="linkish" data-tfs-mockattempt="' + esc(M.id + ':' + a.id) + '">' + esc(a.startedAt.slice(0, 16).replace('T', ' ')) + '</button></td><td>' + esc(a.variant) + '</td><td>' + esc(classify(a)) + '</td><td>' + mmss(activeSec(a)) + '</td><td>' + (a.score ? (a.score.complete ? a.score.total + '/100' : a.score.autoEarned + '/' + a.score.autoMax + ' auto · manual not assessed') : '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '') + '</div></article>';
    });
    var R60 = LX.tfsRehearsal;
    html += label('Optional: full 60-minute rehearsal') + '<p class="small">' + esc(R60.note) + '</p>' + ul(R60.parts, function (p) { return '<b>' + p.mins + ' min · ' + esc(p.title) + '</b> — ' + esc(p.text); }) + '<button class="btn small" data-tfs-rehearsal>Open the rehearsal</button>';
    return html;
  }

  /* ── Review ──────────────────────────────────────────────────── */
  function reviewQueue() {
    var s = st(), cats = {}, recent = s.mistakes.slice(-40);
    recent.forEach(function (m) { cats[m.cat] = (cats[m.cat] || 0) + 1; });
    var missed = Object.keys(s.quiz).filter(function (id) { var h = s.quiz[id].history || []; return h.length && !h[h.length - 1].ok; });
    var items = list('tfsQuiz').filter(function (q) { return missed.indexOf(q.id) !== -1; });
    list('tfsQuiz').forEach(function (q) { if (items.length < 6 && cats[q.cat] && items.indexOf(q) === -1) items.push(q); });
    var lessons = {}; recent.forEach(function (m) { if (m.lesson) lessons[m.lesson] = 1; });
    return { quiz: items.slice(0, 6), lessons: Object.keys(lessons).slice(0, 2), cats: cats };
  }
  function renderReview() {
    var s = st(), Q = reviewQueue(), html = '';
    html += label('10-minute review queue') + (Q.quiz.length || Q.lessons.length ? '<p class="small">' + Q.quiz.length + ' knowledge check' + (Q.quiz.length === 1 ? '' : 's') + ' from missed concepts' + (Q.lessons.length ? ' and ' + Q.lessons.length + ' retrieval task' + (Q.lessons.length === 1 ? '' : 's') : '') + '.</p><div class="done-btns">' + (Q.quiz.length ? '<button class="btn small primary" data-tfs-queue>Start the review</button>' : '') + Q.lessons.map(function (id) { var l = lesson(id); return l ? '<button class="btn small" data-tfs-retr="' + esc(id) + '">Rebuild: ' + esc(l.title) + '</button>' : ''; }).join('') + '</div>' : '<p class="empty">Nothing queued yet — misses from checks, builds and mocks land here.</p>');
    var cats = T().mistakeCats;
    html += label('Mistake log (' + s.mistakes.length + ')') + (s.mistakes.length ? '<div class="chips">' + Object.keys(cats).map(function (k) { var n = s.mistakes.filter(function (m) { return m.cat === k; }).length; return n ? badge(cats[k] + ': ' + n) : ''; }).join(' ') + '</div>' +
      ul(s.mistakes.slice(-20).reverse(), function (m) { var l = m.lesson && lesson(m.lesson); return (m.critical ? '⚠ ' : '') + '<b>' + esc(m.label) + '</b> — ' + esc(m.why) + ' <span class="muted small">(' + esc(cats[m.cat] || m.cat) + ' · ' + esc(m.source || '') + ' · ' + esc((m.at || '').slice(0, 10)) + ')</span>' + (l ? ' <button class="linkish" data-tfs-lesson="' + esc(l.id) + '">Review: ' + esc(l.title) + '</button>' : ''); }) : '<p class="empty">No mistakes logged yet.</p>');
    var all = attemptsOf(function (a) { return a.submittedAt || a.abandoned; }).reverse();
    html += label('Attempts') + (all.length ? '<div class="table-wrap"><table class="tiers small"><caption class="sr-only">Attempts</caption><thead><tr><th scope="col">When</th><th scope="col">What</th><th scope="col">Level</th><th scope="col">Result</th><th scope="col">Class</th></tr></thead><tbody>' + all.slice(0, 50).map(function (a) {
      var what = a.kind === 'mock' ? 'Mock ' + a.mockId + ' ' + a.variant : (lab(a.labId) || {}).title || a.labId;
      var res = a.kind === 'mock' ? (a.score ? (a.score.complete ? a.score.total + '/100' : 'manual not assessed') : '—') : a.grade ? (a.grade.passed ? 'practice checks pass' : 'practice checks: ' + a.grade.results.filter(function (r) { return !r.ok && !r.na && r.sev !== 'advice'; }).length + ' to fix') : a.abandoned ? 'reset' : '—';
      return '<tr><td>' + esc((a.submittedAt || a.startedAt).slice(0, 16).replace('T', ' ')) + '</td><td><button class="linkish" data-tfs-att="' + esc(a.id) + '">' + esc(what) + '</button></td><td>' + esc(a.level || 'interview') + '</td><td>' + esc(res) + '</td><td>' + esc(classify(a)) + '</td></tr>';
    }).join('') + '</tbody></table></div>' : '<p class="empty">No submitted attempts yet.</p>');
    html += label('Your data') + '<p class="muted small">Stored in this browser under ' + KEY + '. Content version ' + esc(T().version) + '; attempts keep the version they were made with.</p><button class="btn small" data-tfs-export>Export JSON</button><textarea id="tfsExport" class="notes-input" rows="6" hidden aria-label="Exported progress"></textarea>';
    return html;
  }

  /* ── Readiness (Module 8) ────────────────────────────────────── */
  function renderReady() {
    var R = LX.tfsReadiness, s = st(), W = s.readiness.worksheet || {}, C = s.readiness.checklist || {};
    var html = '<p class="blurb">Module 8 · 10 minutes. Prepare the first five minutes and the last ten, and settle the logistics.</p>' +
      label('Opening story worksheet') + '<p class="muted small">' + esc(R.noFabrication) + '</p>' + R.worksheet.map(function (w) { return '<label class="prep-label" for="tfs' + w.id + '">' + esc(w.label) + '</label><p class="muted small">' + esc(w.hint) + '</p><textarea id="tfs' + w.id + '" class="notes-input" rows="3" data-tfs-ws="' + w.id + '">' + esc(W[w.id] || '') + '</textarea>'; }).join('') +
      label('Three questions to ask') + '<ol class="steps-why">' + R.questions.map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('') + '</ol>' +
      label('Day-of checklist') + '<div class="checklist">' + R.checklist.map(function (c, i) { return '<label><input type="checkbox" data-tfs-cl="' + i + '"' + (C[i] ? ' checked' : '') + '> ' + esc(c) + '</label>'; }).join('') + '</div>' +
      '<div class="done-btns"><button class="btn small" data-tfs-readydone>' + (s.done['m8:readiness:ready'] ? 'Done ✓' : 'Mark Module 8 done') + '</button></div>' +
      '<details class="brief-wrap"><summary>' + esc(R.backup.title) + '</summary><div class="situation"><p class="muted small">' + esc(R.backup.note) + '</p>' + R.backup.sections.map(function (sec) { return '<p class="small"><b>' + esc(sec.h) + '</b></p>' + ul(sec.items); }).join('') + '</div></details>' +
      label('Optional 60-minute rehearsal') + '<button class="btn small" data-tfs-rehearsal>Open the rehearsal</button>';
    return html;
  }

  /* ── About ───────────────────────────────────────────────────── */
  function renderAbout() {
    var t = T();
    return label('Execution modes') + ul(['sim', 'local', 'aws'], function (k) { return modeBadge(k) + ' ' + inline(t.modes[k].text); }) +
      label('Assistance levels') + ul(['**Guided** — most code supplied with notes; a few gaps.', '**Scaffolded** — files and resource outline with TODOs; about half the work is yours.', '**Requirements only** — blank files and the brief.', '**Interview** — blank files, a timer, documentation links; hints and solutions hidden until you submit; no AI.', 'Guided and scaffolded completions count as assisted. Viewing a solution or any hint makes an attempt assisted. A paused timed attempt is untimed practice.']) +
      label('Versions') + ul([t.versions.terraform, t.versions.aws, t.versions.checked]) +
      label('Practice checks') + '<p class="small">The in-app checks parse your HCL and model the relationships between resources (which table a subnet uses, which group an instance has, what a rule allows). They accept any names, file layout and formatting. They are not terraform validate: they do not load provider schemas, so a misspelled AWS argument can pass them. Items they cannot evaluate are shown as manual review, never as passed.</p>' +
      label('Install Terraform locally (optional, free)') + copyPre('brew tap hashicorp/tap && brew install hashicorp/tap/terraform\nterraform version\ncd labs/terraform-aws-tech-screen && ./validate-all.sh   # real fmt/init/validate on every reference', 'install commands') +
      label('Sources (accessed ' + esc(t.sourcesAccessed) + ')') + '<p class="muted small">' + esc(t.sourcesNote) + '</p>' + ul(t.sources.map(function (x) { return x.id; }), srcLink);
  }
  var RENDER = { overview: renderOverview, modules: renderModules, schedule: renderSchedule, mocks: renderMocks, review: renderReview, ready: renderReady, about: renderAbout };

  /* ══ detail: lesson ═════════════════════════════════════════════ */
  function oralBox(key, prompts) {
    var s = st(), O = s.oral[key] || {};
    return label('Explain it aloud (30–60 s each, no notes)') + '<div class="checklist">' + prompts.map(function (p, i) { return '<label><input type="checkbox" data-tfs-oralck="' + esc(key + ':' + i) + '"' + (O[i] ? ' checked' : '') + '> ' + inline(p) + '</label>'; }).join('') + '</div>' +
      '<div class="done-btns"><button class="btn small ghost" data-tfs-timer="60">60 s timer</button> <span class="mock-timer" id="tfsOralTimer" aria-live="polite"></span></div>';
  }
  /* the build and mock pages have one editor (#tfsEditor); lessons and
     tickets can have several, so theirs are keyed */
  function edId(key) { return /^(LAB|MOCK):/.test(key) ? 'tfsEditor' : 'tfsEd-' + key.replace(/[^A-Za-z0-9]/g, '-'); }
  function editor(key, files, cur, ro) {
    var names = Object.keys(files);
    return (names.length > 1 ? '<div class="seg-row" role="tablist" aria-label="Files">' + names.map(function (f) { var on = f === cur; return '<button class="seg' + (on ? ' active' : '') + '" role="tab" aria-selected="' + on + '" data-tfs-file="' + esc(key + '|' + f) + '">' + esc(f) + ((files[f] || '').trim() ? '' : ' (empty)') + '</button>'; }).join('') + '</div>' : '') +
      '<label class="sr-only" for="' + edId(key) + '">' + esc(cur) + '</label><textarea id="' + edId(key) + '" class="notes-input ar1-editor tfs-editor" rows="' + (names.length > 1 ? 22 : 12) + '" wrap="off" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" data-tfs-edit="' + esc(key + '|' + cur) + '"' + (ro ? ' readonly' : '') + '>' + esc(files[cur] || '') + '</textarea>' +
      '<p class="muted small">Desktop keyboard recommended. Saved as you type. Tab moves focus out of the editor; indent with spaces.</p>';
  }
  function checkView(res, opts) {
    opts = opts || {};
    if (!res) return '';
    if (!res.parsed) return '<div class="tip small"><b>Could not read the HCL:</b> ' + res.errors.map(function (e) { return esc(e.file + ' line ' + e.line + ': ' + e.message); }).join('<br>') + '</div>';
    var req = res.results.filter(function (r) { return r.sev !== 'advice'; }), adv = res.results.filter(function (r) { return r.sev === 'advice'; });
    var bad = req.filter(function (r) { return !r.ok && !r.na; }).length;
    return '<div class="tfs-checks"><p class="small">' + badge('practice checks', 'sim') + ' ' + (bad ? bad + ' to fix' : 'all required practice checks pass') + (res.na && res.na.length ? ' · ' + res.na.length + ' need manual review' : '') + '</p>' +
      '<ul class="bullets">' + req.map(function (r) { return '<li>' + (r.ok ? '✓ ' : r.na ? '? ' : r.sev === 'critical' ? '⚠ ' : '✗ ') + esc(r.label) + (r.ok ? '' : ' — <span class="' + (r.na ? 'muted' : 'feedback bad') + '">' + esc(r.why) + '</span>') + (!r.ok && !r.na && opts.remedy ? remedy(r) : '') + '</li>'; }).join('') + '</ul>' +
      (adv.length ? '<p class="muted small">Advice (never blocks):</p><ul class="bullets">' + adv.map(function (r) { return '<li>' + (r.ok ? '✓ ' : '· ') + esc(r.label) + (r.ok ? '' : ' — ' + esc(r.why)) + '</li>'; }).join('') + '</ul>' : '') +
      '<p class="muted small">Practice checks read your files with a local parser and model resource relationships. They are not terraform validate, run no Terraform, and prove nothing about AWS.</p></div>';
  }
  function remedy(r) {
    var l = r.lesson && lesson(r.lesson);
    return '<div class="muted small tfs-remedy">Why it matters: ' + esc(WHY[r.cat] || '') + (l ? ' · Review: <button class="linkish" data-tfs-lesson="' + esc(l.id) + '">' + esc(l.title) + '</button>' + (l.retrieval ? ' · Retry: <button class="linkish" data-tfs-retr="' + esc(l.id) + '">redo its retrieval task</button>' : '') : '') + '</div>';
  }
  function renderLesson() {
    var l = lesson(ui.detail.id), s = st(), S = s.lessons[l.id] || {};
    var html = back() + '<h3 class="prep-h3">' + esc(l.title) + '</h3><p class="muted small">' + l.mins + ' min</p>' +
      '<p class="small"><b>Objective:</b> ' + inline(l.objective) + '</p>' + (l.prereqs && l.prereqs.length ? '<p class="muted small">Before this: ' + l.prereqs.map(function (p) { var x = lesson(p); return x ? '<button class="linkish" data-tfs-lesson="' + esc(p) + '">' + esc(x.title) + '</button>' : esc(p); }).join(', ') + '</p>' : '') +
      label('Learn') + md(l.body);
    if (l.example) html += label('Annotated example') + pre(l.example.code) + ul(l.example.notes);
    if (l.predict) {
      var pk = S.predict;
      html += label('Predict before you look') + '<p class="small">' + md(l.predict.q) + '</p><div class="choices">' + l.predict.choices.map(function (ch, i) {
        var cls = pk != null ? (i === l.predict.a ? ' right' : pk === i ? ' wrong' : '') : '';
        return '<button class="choice' + cls + '" data-tfs-predict="' + esc(l.id + ':' + i) + '"' + (pk != null ? ' disabled' : '') + '>' + inline(ch) + '</button>';
      }).join('') + '</div>' + (pk != null ? '<p class="feedback ' + (pk === l.predict.a ? 'ok' : 'bad') + '">' + inline(l.predict.why) + '</p>' : '');
    }
    if (l.task) html += lessonTask(l, S);
    if (l.oral) html += oralBox('L:' + l.id, l.oral);
    if (l.retrieval) html += label('Rebuild (retrieval — do it without copying, ideally tomorrow)') + retrievalView(l, S);
    html += '<div class="done-btns"><button class="btn small primary" data-tfs-lessondone="' + esc(l.id) + '">' + (S.completedAt ? 'Completed ✓' : 'Mark lesson complete') + '</button></div><p class="muted small">Completing needs a prediction and, where there is one, a submitted task. Opening or reading a lesson is not completion.</p>' + refs(l.refs);
    return html;
  }
  function lessonTask(l, S) {
    var t = l.task, T2 = S.task || {}, key = 'LT:' + l.id, files = { 'main.tf': T2.file != null ? T2.file : (t.start || '') };
    var sub = !!T2.submittedAt, showSol = sub || T2.solutionViewed;
    var html = label('Build') + '<p class="small">' + inline(t.prompt) + '</p>' + label('Success criteria') + ul(t.success) + editor(key, files, 'main.tf', false) +
      '<div class="done-btns"><button class="btn small" data-tfs-ltcheck="' + esc(l.id) + '">Check</button><button class="btn small primary" data-tfs-ltsubmit="' + esc(l.id) + '">Submit</button><button class="btn small ghost" data-tfs-ltsim="' + esc(l.id) + '">Open in the simulated terminal</button></div>';
    if (ui.grade && ui.grade.key === key) html += checkView(ui.grade.res, { remedy: true });
    else if (T2.grade) html += checkView(T2.grade, { remedy: true });
    html += label('Hints (each one is recorded)') + t.hints.map(function (h, i) {
      var open = (T2.hints || []).indexOf(i + 1) !== -1;
      return open ? '<div class="tip small"><b>' + ['Concept', 'Structure', 'Code fragment'][i] + ':</b> ' + md(h.indexOf('\n') !== -1 && i > 0 ? '```\n' + h + '\n```' : h) + '</div>' : '<button class="btn small ghost" data-tfs-lthint="' + esc(l.id + ':' + (i + 1)) + '">' + (i + 1) + ' · ' + ['Concept hint', 'Structural hint', 'Targeted code fragment'][i] + '</button>';
    }).join(' ') +
      (showSol ? label('Reference solution') + pre(t.solution) + '<p class="small"><b>Why it works:</b> ' + inline(t.why) + '</p>' + label('Common mistakes') + ul(t.mistakes) + (t.alternative ? '<p class="small"><b>Valid alternative:</b> ' + inline(t.alternative) + '</p>' : '') : '<div class="done-btns"><button class="btn small ghost" data-tfs-ltsol="' + esc(l.id) + '">Show the solution (marks the task assisted)</button></div>') +
      (sub ? '<p class="muted small">Submitted ' + esc(T2.submittedAt.slice(0, 16).replace('T', ' ')) + ' · ' + (T2.grade && T2.grade.passed ? 'practice checks pass' : 'practice checks not all passing') + ' · ' + ((T2.hints || []).length || T2.solutionViewed ? 'assisted' : 'independent') + '</p>' : '');
    return html;
  }
  function retrievalView(l, S) {
    var r = l.retrieval, R = S.retrieval || {};
    if (r.type === 'order') {
      var ord = shuffled(r.steps.length, l.id + 'r'), picked = R.order || [];
      var shown = !!R.checkedAt;
      return '<p class="small">' + inline(r.prompt) + '</p><div class="choices">' + ord.map(function (si) {
        var at = picked.indexOf(si), cls = shown ? (picked[at] === at ? ' right' : ' wrong') : (at !== -1 ? ' used' : '');
        return '<button class="choice' + cls + '" data-tfs-rord="' + esc(l.id + ':' + si) + '"' + (shown ? ' disabled' : '') + ' aria-pressed="' + (at !== -1) + '">' + (at !== -1 ? '<b>' + (at + 1) + '.</b> ' : '') + inline(r.steps[si]) + '</button>';
      }).join('') + '</div>' + (shown ? ul(r.steps.map(function (x, i) { return (i + 1) + '. ' + x; })) + '<div class="done-btns"><button class="btn small ghost" data-tfs-rreset="' + esc(l.id) + '">Try again</button></div>' : '<button class="btn small" data-tfs-rcheck="' + esc(l.id) + '"' + (picked.length === r.steps.length ? '' : ' disabled') + '>Check order</button>');
    }
    if (r.type === 'self') {
      return '<p class="small">' + inline(r.prompt) + '</p><textarea class="notes-input" rows="4" data-tfs-rtext="' + esc(l.id) + '" aria-label="Your answer">' + esc(R.text || '') + '</textarea>' +
        (R.shown ? '<div class="tip small"><b>Model answer:</b> ' + inline(r.answer) + '</div>' + ul(r.points) : '<button class="btn small" data-tfs-rshow="' + esc(l.id) + '">Compare with a model answer</button>');
    }
    var key = 'LR:' + l.id, files = { 'main.tf': R.file != null ? R.file : (r.start || '') };
    return '<p class="small">' + inline(r.prompt) + '</p>' + editor(key, files, 'main.tf', false) + '<div class="done-btns"><button class="btn small" data-tfs-rcheckcode="' + esc(l.id) + '">Check</button></div>' + (ui.grade && ui.grade.key === key ? checkView(ui.grade.res) : R.grade ? checkView(R.grade) : '');
  }

  /* ══ detail: diagnostic, quiz, oral ═════════════════════════════ */
  function renderDiag() {
    var D = LX.tfsDiag, s = st(), A = s.diag.answers || {};
    var html = back() + '<h3 class="prep-h3">Baseline diagnostic</h3><p class="small">' + esc(D.note) + '</p>';
    D.items.forEach(function (q, n) {
      var a = A[q.id];
      html += '<article class="card"><div class="card-main"><p class="small"><b>' + (n + 1) + '.</b> ' + inline(q.q) + '</p>';
      if (q.order) {
        var ord = shuffled(q.steps.length, q.id), picked = Array.isArray(a) ? a : [];
        html += '<div class="choices">' + ord.map(function (si) { var at = picked.indexOf(si); return '<button class="choice' + (at !== -1 ? ' used' : '') + '" data-tfs-dord="' + esc(q.id + ':' + si) + '" aria-pressed="' + (at !== -1) + '">' + (at !== -1 ? '<b>' + (at + 1) + '.</b> ' : '') + inline(q.steps[si]) + '</button>'; }).join('') + '</div>';
      } else {
        var multi = !!q.multi, cur = multi ? (Array.isArray(a) ? a : []) : a;
        html += '<div class="choices">' + q.choices.map(function (c, i) { var on = multi ? cur.indexOf(i) !== -1 : cur === i; return '<button class="choice' + (on ? ' picked' : '') + '" data-tfs-diag="' + esc(q.id + ':' + i) + '" aria-pressed="' + on + '">' + inline(c) + '</button>'; }).join('') + '</div>';
      }
      html += '<button class="btn small ghost" data-tfs-diag="' + esc(q.id) + ':unsure">Not sure yet</button>' + (a === 'unsure' ? ' <span class="muted small">noted</span>' : '') + '</div></article>';
    });
    html += '<div class="done-btns"><button class="btn primary small" data-tfs-diagsubmit>See suggestions</button></div>';
    if (s.diag.completedAt) {
      var miss = D.items.filter(function (q) { return !diagRight(q, A[q.id]); });
      html += label('Suggestions (ungraded)') + (miss.length ? ul(miss, function (q) { var l = lesson(q.lesson); return esc(q.topic) + ' — review <button class="linkish" data-tfs-lesson="' + esc(q.lesson) + '">' + esc(l ? l.title : q.lesson) + '</button> with extra care'; }) : '<p class="small">A solid start: keep the order of the course; it will move quickly for you.</p>');
    }
    return html;
  }
  function diagRight(q, a) {
    if (a == null || a === 'unsure') return false;
    if (q.order) return Array.isArray(a) && a.length === q.steps.length && a.every(function (x, i) { return x === i; });
    if (q.multi) return Array.isArray(a) && a.slice().sort().join() === q.a.slice().sort().join();
    return a === q.a;
  }
  function renderQuiz() {
    var d = ui.detail, items = d.ids ? d.ids.map(function (id) { return byId('tfsQuiz', id); }) : list('tfsQuiz').filter(function (q) { return q.module === d.id; });
    var s = st(), html = back() + '<h3 class="prep-h3">' + (d.ids ? '10-minute review' : 'Knowledge checks · Module ' + esc(d.id.slice(1))) + '</h3>';
    items.forEach(function (q, n) {
      var H = (s.quiz[q.id] || {}), cur = (d.answers || {})[q.id];
      html += '<article class="card"><div class="card-main"><p class="small"><b>' + (n + 1) + '.</b> <span class="muted small">' + esc(q.type) + '</span></p>' + md(q.q);
      if (q.choices) {
        html += '<div class="choices">' + q.choices.map(function (c, i) { var cls = cur != null ? (i === q.a ? ' right' : cur === i ? ' wrong' : '') : ''; return '<button class="choice' + cls + '" data-tfs-q="' + esc(q.id + ':' + i) + '"' + (cur != null ? ' disabled' : '') + '>' + inline(c) + '</button>'; }).join('') + '</div>';
        if (cur != null) html += '<p class="feedback ' + (cur === q.a ? 'ok' : 'bad') + '">' + inline(q.why) + '</p>' + ul(q.choices.map(function (c, i) { return i === q.a ? null : { c: c, w: q.whyNot[i] }; }).filter(Boolean), function (x) { return '<span class="muted small">' + inline(x.c) + ' — ' + inline(x.w) + '</span>'; });
      } else {
        html += '<textarea class="notes-input" rows="3" data-tfs-qtext="' + esc(q.id) + '" aria-label="Your answer">' + esc((d.texts || {})[q.id] || '') + '</textarea>' +
          (cur != null ? '<div class="tip small"><b>Model answer:</b> ' + inline(q.a) + '</div>' + ul(q.points) + '<p class="muted small">Self-assessed: ' + (cur === 1 ? 'got it' : 'not yet') + '</p>' : '<div class="done-btns"><button class="btn small" data-tfs-qself="' + esc(q.id + ':1') + '">I covered the points</button><button class="btn small ghost" data-tfs-qself="' + esc(q.id + ':0') + '">Not yet — show me</button></div>');
      }
      if (H.history && H.history.length) html += '<p class="muted small">Past attempts: ' + H.history.map(function (h) { return h.ok ? '✓' : '✗'; }).join(' ') + '</p>';
      html += '</div></article>';
    });
    if (!d.ids) html += '<div class="done-btns"><button class="btn small primary" data-tfs-quizdone="' + esc(d.m + ':' + d.id) + '">' + (st().done[d.m + ':quiz:' + d.id] ? 'Done ✓' : 'Finish') + '</button></div>';
    return html;
  }
  function renderOral() {
    var d = ui.detail, items = list('tfsOral').filter(function (o) { return o.module === d.id; }), s = st(), O = s.oral['O:' + d.id] || {};
    var html = back() + '<h3 class="prep-h3">Explain it aloud · Module ' + esc(d.id.slice(1)) + '</h3><p class="small">Answer each out loud first (30–60 seconds; record yourself if you can), then compare with the outline. Self-assessed.</p>';
    items.forEach(function (o) {
      var shown = O[o.id];
      html += '<article class="card"><div class="card-main"><p class="small"><b>' + inline(o.q) + '</b></p>' + (shown ? label('A strong answer covers') + ul(o.strong) + label('Weak answers') + ul(o.weak) : '<button class="btn small" data-tfs-oralshow="' + esc(d.id + ':' + o.id) + '">I answered aloud — show the outline</button>') + '</div></article>';
    });
    html += '<div class="done-btns"><button class="btn small ghost" data-tfs-timer="60">60 s timer</button> <span class="mock-timer" id="tfsOralTimer" aria-live="polite"></span><button class="btn small primary" data-tfs-oraldone="' + esc(d.m + ':' + d.id) + '">' + (s.done[d.m + ':oral:' + d.id] ? 'Done ✓' : 'Finish') + '</button></div>';
    return html;
  }

  /* ══ detail: build workspace ════════════════════════════════════ */
  function simPanel(simKey, files, kindLabel) {
    var s = st(), sim = s.sims[simKey] || window.LXTfSim.create(), log = sim.log || [];
    return '<div class="tfs-sim" role="region" aria-label="Simulated terminal">' + '<p class="small">' + modeBadge('sim') + ' Simulated terminal' + (kindLabel ? ' · ' + esc(kindLabel) : '') + ' — reads your files; runs no Terraform; touches no AWS.</p>' +
      '<div class="term term-static tfs-term" id="tfsTerm" tabindex="0" aria-live="polite">' + (log.length ? log.slice(-30).map(function (e) { return '<div class="term-line"><span class="term-prompt">$ </span><span class="term-cmd">' + esc(e.cmd) + '</span></div><pre class="term-out' + (e.code ? ' term-err' : '') + '">' + esc(e.out) + '</pre>'; }).join('') : '<div class="term-line muted">Type a command, e.g. terraform init, then terraform plan. Type help for the list.</div>') + '</div>' +
      '<div class="sb-inputrow"><label class="sr-only" for="tfsSimIn">Command</label><input id="tfsSimIn" class="notes-input" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="' + (sim.pending ? 'type yes to confirm' : 'terraform init') + '" data-tfs-simkey="' + esc(simKey) + '"><button class="btn small" data-tfs-simrun="' + esc(simKey) + '">Run</button><button class="btn small ghost" data-tfs-simreset="' + esc(simKey) + '">Reset simulator</button></div>' +
      '<div class="chips">' + ['terraform init', 'terraform validate', 'terraform plan', 'terraform apply', 'terraform output', 'terraform state list', 'terraform destroy'].map(function (c) { return '<button class="chip" data-tfs-simcmd="' + esc(simKey + '|' + c) + '">' + esc(c) + '</button>'; }).join('') + '</div></div>';
  }
  function exportScript(dirName, files) {
    return '# Recreates this workspace as a folder. Paste into a terminal on your Mac.\nmkdir -p ' + dirName + ' && cd ' + dirName + '\n' +
      Object.keys(files).map(function (f) { return "cat > " + f + " <<'TF_EOF'\n" + (files[f] || '').replace(/\n?$/, '\n') + 'TF_EOF\n'; }).join('') + 'ls\n';
  }
  function localPanel(L, a) {
    var s = st(), recs = s.local[a.id] || [];
    var dir = 'tfs-' + L.id + '-' + a.level;
    return '<details class="brief-wrap"><summary>' + modeBadge('local') + ' Run it with real Terraform on your Mac</summary><div class="situation">' +
      '<p class="small">' + esc(L.local.note) + '</p>' + '<div class="done-btns"><button class="btn small" data-tfs-copyall="' + esc(a.id) + '">Copy all files as a shell script</button><button class="btn small" data-tfs-download="' + esc(a.id) + '">Download the script</button></div>' +
      '<p class="muted small">The script creates ' + esc(dir) + '/ with your current files. Then:</p>' + copyPre(L.local.cmds, 'local commands') +
      '<label class="prep-label" for="tfsLocalOut">Paste what the real CLI printed (optional)</label><textarea id="tfsLocalOut" class="notes-input" rows="4" aria-label="Terraform output you ran locally"></textarea><div class="done-btns"><button class="btn small ghost" data-tfs-localsave="' + esc(a.id) + '">Save as learner-supplied evidence</button></div>' +
      (recs.length ? ul(recs, function (r) { return badge('learner-supplied', 'local') + ' ' + esc(r.at.slice(0, 16).replace('T', ' ')) + ' — ' + esc(r.summary); }) : '') +
      '<p class="muted small">Saved output is labelled learner-supplied: this app did not run it and does not treat it as verified.</p></div></details>';
  }
  function awsPanel(L) {
    if (!L.aws) return '';
    var s = st(), A = s.aws[L.id] || {};
    var html = '<details class="brief-wrap"><summary>' + modeBadge('aws') + ' Optional: deploy to a sandbox AWS account</summary><div class="situation">';
    if (!A.optIn) {
      html += '<p class="small">Not needed for the course. Deploying creates billable resources:</p>' + ul(L.aws.billable) + '<p class="muted small">This course does not quote prices or promise free-tier eligibility: check current pricing for your Region (see Amazon VPC pricing in About).</p>' +
        '<div class="checklist"><label><input type="checkbox" id="tfsAwsAck"> I will use a sandbox account I control, configure credentials only in my shell, apply by hand, and destroy what I create today.</label></div><button class="btn small" data-tfs-awsoptin="' + esc(L.id) + '">Show the deployment steps</button>';
    } else {
      html += '<p class="small"><b>Billable here:</b> ' + esc(L.aws.billable.join(', ')) + '.</p><ol class="steps-why">' + L.aws.steps.map(function (x) { return '<li>' + inline(x) + '</li>'; }).join('') + '</ol>' + label('Cleanup') + ul(L.aws.cleanup) + label('Confirm nothing is left') + copyPre(L.aws.gone, 'verification commands') + '<p class="muted small">Nothing here runs from the browser. The app never applies or destroys anything.</p><button class="btn small ghost" data-tfs-awsoptout="' + esc(L.id) + '">Hide</button>';
    }
    return html + '</div></details>';
  }
  function renderLab() {
    var d = ui.detail, L = lab(d.id); if (!L) return back() + '<p class="empty">Unknown build.</p>';
    var levels = Object.keys(L.levels); if (levels.indexOf(d.level) === -1) d.level = levels[0];
    var V = variantOf(L, d.variant); d.variant = L.variants[d.variant] ? d.variant : Object.keys(L.variants)[0];
    var a = d.attempt ? attempt(d.attempt) : ensureLabAttempt(L, d.level, d.variant);
    var interview = d.level === 'interview', sub = !!a.submittedAt, key = 'LAB:' + a.id, cur = ui.tab[key] || L.files[0];
    var html = back() + '<h3 class="prep-h3">' + esc(L.title) + '</h3><p class="muted small">' + L.mins + ' min' + (L.optional ? ' · optional stretch' : '') + ' · attempt ' + esc(classify(a)) + '</p>' +
      seg('Assistance level', LEVELS.map(function (x) { return [x[0], x[1], L.levels[x[0]] ? '' : 'Not offered for this build']; }), d.level, 'data-tfs-level') +
      (L.levels[d.level] && L.levels[d.level].note ? '<p class="muted small">' + esc(L.levels[d.level].note) + '</p>' : '') +
      (Object.keys(L.variants).length > 1 ? seg('Variant', Object.keys(L.variants).map(function (k) { return [k, L.variants[k].label]; }), d.variant, 'data-tfs-variant') : '');
    html += label('Requirements') + md(V.brief || L.brief) + (V.brief ? '<details class="brief-wrap"><summary>Base requirements</summary><div class="situation">' + md(L.brief) + '</div></details>' : '') + label('Success criteria') + ul(L.success);
    if (L.parts && !interview) html += '<p class="muted small">Parts: ' + esc(L.parts.join(' · ')) + '</p>';
    if (L.budget) html += '<p class="small">Time budget: ' + L.budget.map(function (b) { return esc(b[0]) + ' ' + b[1] + ' min'; }).join(' · ') + (interview ? '' : ' (advisory in learning mode)') + '</p>';
    if (L.design && d.level === 'guided') html += label('Guided design') + '<ol class="steps-why">' + L.design.map(function (x) { return '<li>' + inline(x) + '</li>'; }).join('') + '</ol>';
    if (L.predictions && !sub) html += label('Predict first') + L.predictions.map(function (p, i) { var S = (st().lessons['B:' + L.id] || {}).pred || {}; return '<p class="small">' + inline(p.q) + '</p><textarea class="notes-input" rows="2" data-tfs-bpred="' + esc(L.id + ':' + i) + '" aria-label="Your prediction">' + esc(S[i] || '') + '</textarea>' + (S['shown' + i] ? '<div class="tip small">' + inline(p.a) + '</div>' : '<button class="btn small ghost" data-tfs-bpredshow="' + esc(L.id + ':' + i) + '">Compare</button>'); }).join('');
    if (a.timed || interview) html += timerBar(a, interview);
    if (L.change && (interview ? activeSec(a) >= a.limit / 2 : true)) html += '<div class="tip small"><b>Change request' + (L.change.at === 'halfway' ? ' (halfway)' : '') + ':</b> ' + inline(L.change.prompt) + '</div>';
    if (interview && !sub) html += '<p class="small">' + badge('interview mode', 'sim') + ' Hints, solutions and practice checks are hidden until you submit. ' + esc(T().interview.docsLabel) + '</p>' + ul(['REG-AWS', 'TF-LANG', 'AWS-RT'], srcLink);
    html += editor(key, a.files, cur, sub);
    if (!sub) {
      html += '<div class="done-btns">' + (interview ? '' : '<button class="btn small" data-tfs-labcheck="' + esc(a.id) + '">Run practice checks</button>') + '<button class="btn small primary" data-tfs-labsubmit="' + esc(a.id) + '">Submit</button><button class="btn small ghost" data-tfs-labreset="' + esc(a.id) + '">Start a new attempt</button></div>';
      if (!interview && ui.grade && ui.grade.key === key) html += checkView(ui.grade.res, { remedy: true });
      if (!interview) html += label('Hints (each one is recorded)') + L.hints.map(function (h, i) {
        var open = (a.hints || []).indexOf(i + 1) !== -1;
        return open ? '<div class="tip small"><b>' + ['Concept', 'Structure', 'Code fragment'][i] + ':</b> ' + (i ? pre(h) : inline(h)) + '</div>' : '<button class="btn small ghost" data-tfs-labhint="' + esc(a.id + ':' + (i + 1)) + '">' + (i + 1) + ' · ' + ['Concept hint', 'Structural guidance', 'Targeted code fragment'][i] + '</button>';
      }).join(' ') + '<div class="done-btns"><button class="btn small ghost" data-tfs-labsol="' + esc(a.id) + '">Show the reference solution (marks this attempt assisted)</button></div>' + (a.solutionViewed ? solutionBlock(L, V, a) : '');
      if (!interview) html += simPanel('lab:' + a.id, a.files);
    } else html += reviewBlock(L, V, a);
    html += localPanel(L, a) + awsPanel(L) + refs(L.refs);
    return html;
  }
  function timerBar(a, strict) {
    var running = isRunning(a) && !a.submittedAt;
    return '<div class="mock-head tfs-timer"><span class="mock-timer" id="tfsClock" data-tfs-att="' + esc(a.id) + '" aria-live="off">' + mmss(Math.max(0, a.limit - activeSec(a))) + '</span> <span class="muted small">' + (strict ? 'remaining' : 'advisory') + (a.paused ? ' · paused once: untimed practice' : '') + '</span>' +
      (a.submittedAt ? '' : running ? '<button class="btn small ghost" data-tfs-pause="' + esc(a.id) + '">Pause</button>' : '<button class="btn small" data-tfs-resumet="' + esc(a.id) + '">Resume timer</button>') + '</div>' +
      '<p class="muted small">At 0:00 nothing is deleted or submitted for you; keep going or submit when ready. Pausing makes a timed attempt untimed practice.</p>';
  }
  function solutionBlock(L, V, a) {
    var ref = src(V.solution) || {}, f = ui.diffFile[a.id] || L.files[0];
    return label('Your files beside the reference') + '<div class="seg-row" role="tablist" aria-label="Compare file">' + Object.keys(ref).filter(function (x) { return /\.tf$/.test(x); }).map(function (x) { var on = x === f; return '<button class="seg' + (on ? ' active' : '') + '" data-tfs-diff="' + esc(a.id + '|' + x) + '" aria-pressed="' + on + '">' + esc(x) + '</button>'; }).join('') + '</div>' + sideBySide(a.files[f] || '', ref[f] || '') +
      (V.alternatives || []).map(function (alt) { return alt.src ? '<details class="brief-wrap"><summary>Valid alternative: ' + esc(alt.why) + '</summary><div class="situation">' + Object.keys(src(alt.src) || {}).filter(function (x) { return /\.tf$/.test(x); }).map(function (x) { return '<p class="small"><b>' + esc(x) + '</b></p>' + pre(src(alt.src)[x]); }).join('') + '</div></details>' : '<p class="small"><b>Alternative:</b> ' + inline(alt.text) + '</p>'; }).join('') +
      '<p class="small"><b>Why it works:</b> ' + inline(L.why) + '</p>' + label('Common mistakes') + ul(L.mistakes);
  }
  function lineDiff(a, b) {
    var A = a.split('\n'), B = b.split('\n'), n = A.length, m = B.length, dp = [];
    if (n * m > 250000) return A.map(function (x) { return [x, null]; }).concat(B.map(function (x) { return [null, x]; }));
    for (var i = 0; i <= n; i++) { dp.push(new Array(m + 1).fill(0)); }
    for (var i2 = n - 1; i2 >= 0; i2--) for (var j = m - 1; j >= 0; j--) dp[i2][j] = A[i2].trim() === B[j].trim() ? dp[i2 + 1][j + 1] + 1 : Math.max(dp[i2 + 1][j], dp[i2][j + 1]);
    var out = [], x = 0, y = 0;
    while (x < n && y < m) { if (A[x].trim() === B[y].trim()) { out.push([A[x], B[y], true]); x++; y++; } else if (dp[x + 1][y] >= dp[x][y + 1]) { out.push([A[x], null]); x++; } else { out.push([null, B[y]]); y++; } }
    while (x < n) out.push([A[x++], null]); while (y < m) out.push([null, B[y++]]);
    return out;
  }
  function sideBySide(mine, ref) {
    var rows = lineDiff(mine, ref);
    return '<div class="table-wrap tfs-diff" tabindex="0" role="group" aria-label="Side-by-side comparison: your file and the reference"><table class="tiers small"><thead><tr><th scope="col">Yours</th><th scope="col">Reference</th></tr></thead><tbody>' + rows.map(function (r) {
      return '<tr' + (r[2] ? '' : ' class="tfs-chg"') + '><td><code>' + (r[0] == null ? '' : esc(r[0])) + '</code></td><td><code>' + (r[1] == null ? '' : esc(r[1])) + '</code></td></tr>';
    }).join('') + '</tbody></table></div><p class="muted small">Lines that differ are highlighted. Different names or order are fine when the practice checks pass.</p>';
  }
  function reviewBlock(L, V, a) {
    var cls = classify(a);
    var html = label('Review') + '<p class="small">Submitted ' + esc(a.submittedAt.slice(0, 16).replace('T', ' ')) + ' · ' + mmss(activeSec(a)) + ' active · <b>' + esc(CLASS_NOTE[cls]) + '</b>' + (a.hints.length ? ' · hints ' + a.hints.join(', ') : '') + (a.solutionViewed ? ' · solution viewed' : '') + '</p>' +
      checkView(a.grade, { remedy: true });
    if (L.change && a.change) html += label('Change request (graded separately)') + checkView(a.change);
    html += solutionBlock(L, V, a) + oralBox('B:' + L.id, L.oral) +
      '<div class="done-btns"><button class="btn small primary" data-tfs-retry="' + esc(a.id) + '">Retry' + (Object.keys(L.variants).length > 1 ? ' with another variant' : '') + '</button>' + (L.levels.requirements && a.level !== 'requirements' ? '<button class="btn small" data-tfs-retrylevel="' + esc(a.id + ':requirements') + '">Rebuild from blank files</button>' : '') + '</div>';
    return html;
  }

  /* ══ detail: faults, tickets, plan ══════════════════════════════ */
  function renderFaults() {
    var L = lab('b3'), s = st(), F = s.faults || {};
    var html = back() + '<h3 class="prep-h3">Injected faults: five broken NAT builds</h3><p class="small">Each fault is one small change to the Build 3 reference. Every one passes <code>terraform validate</code>. Read the symptom, write your diagnosis, then compare.</p>';
    L.faults.forEach(function (f) {
      var S = F[f.id] || {}, ref = src(L.variants.base.solution), files = {}; Object.keys(ref).forEach(function (k) { if (/\.tf$/.test(k)) files[k] = ref[k]; });
      f.edits.forEach(function (e) { files['main.tf'] = files['main.tf'].split(e[0]).join(e[1]); });
      var changed = f.edits.map(function (e) { return e[1].trim() || '(block removed: ' + e[0].trim().split('\n')[0] + ' …)'; }).join('\n…\n');
      html += '<article class="card"><div class="card-main"><p class="card-title plain">' + esc(f.id + ' · ' + f.title) + '</p><p class="small"><b>Symptom:</b> ' + inline(f.symptom) + '</p><p class="muted small">The changed lines:</p>' + pre(changed) +
        '<label class="prep-label" for="tfsF' + f.id + '">Your diagnosis</label><textarea id="tfsF' + f.id + '" class="notes-input" rows="2" data-tfs-ftext="' + esc(f.id) + '">' + esc(S.text || '') + '</textarea>' +
        (S.shown ? (function () { var r = gradeFiles(files, L.variants.base.checks()); var hit = r.results.filter(function (x) { return x.id === f.expect; })[0]; return '<div class="tip small"><p><b>Diagnosis:</b> ' + inline(f.diagnosis) + '</p><p><b>Correction:</b></p>' + pre(f.fix) + '<p>' + inline(f.explain) + '</p><p class="muted">Practice check that flags it: ' + esc(hit ? hit.label + ' — ' + hit.why : f.expect) + '</p></div>'; })() : '<button class="btn small" data-tfs-fshow="' + esc(f.id) + '">Compare</button>') + '</div></article>';
    });
    html += '<div class="done-btns"><button class="btn small primary" data-tfs-faultsdone>' + (s.done['m4:faults:b3'] ? 'Done ✓' : 'Finish') + '</button></div>';
    return html;
  }
  function renderTickets() {
    var d = ui.detail, s = st(), items = list('tfsTickets').filter(function (t) { return t.set === d.id; });
    var html = back() + '<h3 class="prep-h3">' + esc(itemTitle({ kind: 'tickets', id: d.id })) + '</h3><p class="small">For each: read the code and the error or symptom, choose the diagnosis, then fix it in the editor. Errors marked recorded came from the real Terraform CLI; tickets without an error are valid configurations that misbehave.</p>';
    items.forEach(function (t) {
      var S = s.tickets[t.id] || {}, pick = S.pick, key = 'TK:' + t.id, files = { 'main.tf': S.file != null ? S.file : t.files };
      html += '<article class="card"><div class="card-main"><p class="card-title plain">' + esc(t.id + ' · ' + t.title) + ' ' + badge(T().mistakeCats[t.cat] || t.cat) + ' ' + badge(t.kind === 'schema' ? 'validate fails' : t.kind === 'plan' ? 'plan fails' : 'validate passes') + '</p>' +
        (t.error ? '<p class="small">' + esc(t.provenance || 'Recorded output') + ':</p>' + pre(t.error, 'term-err') : '<p class="small"><b>Symptom:</b> ' + inline(t.symptom) + '</p>') +
        '<p class="small"><b>' + inline(t.question) + '</b></p><div class="choices">' + t.choices.map(function (c, i) { var cls = pick != null ? (i === t.a ? ' right' : pick === i ? ' wrong' : '') : ''; return '<button class="choice' + cls + '" data-tfs-tk="' + esc(t.id + ':' + i) + '"' + (pick != null ? ' disabled' : '') + '>' + inline(c) + '</button>'; }).join('') + '</div>' +
        (pick != null ? '<p class="feedback ' + (pick === t.a ? 'ok' : 'bad') + '">' + inline(t.feedback) + '</p>' : '') +
        (t.fixCheck ? editor(key, files, 'main.tf', false) + '<div class="done-btns"><button class="btn small" data-tfs-tkcheck="' + esc(t.id) + '">Check my fix</button>' + (S.fixShown ? '' : '<button class="btn small ghost" data-tfs-tkfix="' + esc(t.id) + '">Show the fix</button>') + '</div>' + (ui.grade && ui.grade.key === key ? checkView(ui.grade.res) : '') : (S.fixShown || pick != null ? '' : '<button class="btn small ghost" data-tfs-tkfix="' + esc(t.id) + '">Show the fix</button>')) +
        (S.fixShown || (pick != null && !t.fixCheck) ? '<p class="small"><b>Fix:</b></p>' + pre(t.fix) : '') + '</div></article>';
    });
    html += '<div class="done-btns"><button class="btn small primary" data-tfs-tkdone="' + esc(d.m + ':' + d.id) + '">' + (s.done[d.m + ':tickets:' + d.id] ? 'Done ✓' : 'Finish') + '</button></div>';
    return html;
  }
  function renderPlan() {
    var P = list('tfsPlans')[0], s = st(), A = (s.plans[P.id] || {}).answers || {};
    var html = back() + '<h3 class="prep-h3">' + esc(P.title) + '</h3>' + badge('synthetic plan', 'sim') + md(P.context) + pre(P.text);
    P.questions.forEach(function (q, i) {
      var pk = A[i];
      html += '<article class="card"><div class="card-main"><p class="small"><b>' + (i + 1) + '.</b> ' + inline(q.q) + '</p><div class="choices">' + q.choices.map(function (c, j) { var cls = pk != null ? (j === q.a ? ' right' : pk === j ? ' wrong' : '') : ''; return '<button class="choice' + cls + '" data-tfs-plan="' + esc(i + ':' + j) + '"' + (pk != null ? ' disabled' : '') + '>' + inline(c) + '</button>'; }).join('') + '</div>' + (pk != null ? '<p class="feedback ' + (pk === q.a ? 'ok' : 'bad') + '">' + inline(q.why) + '</p>' : '') + '</div></article>';
    });
    html += '<div class="done-btns"><button class="btn small primary" data-tfs-plandone="' + esc(ui.detail.m + ':' + P.id) + '">' + (s.done[ui.detail.m + ':plan:' + P.id] ? 'Done ✓' : 'Finish') + '</button></div>' + refs(P.refs);
    return html;
  }

  /* ══ detail: mock screen ════════════════════════════════════════ */
  function pickVariant(M) {
    var used = mockAttempts(M.id).map(function (a) { return a.variant; }), keys = Object.keys(M.variants);
    return keys.filter(function (k) { return used.indexOf(k) === -1; })[0] || keys[mockAttempts(M.id).length % keys.length];
  }
  function renderMock() {
    var d = ui.detail, M = mockDef(d.id), a = d.attempt ? attempt(d.attempt) : mockAttempts(M.id).filter(function (x) { return !x.submittedAt && !x.abandoned; })[0];
    var html = back() + '<h3 class="prep-h3">' + esc(M.title) + '</h3><p class="muted small">' + esc(T().interview.disclaimer) + '</p>';
    if (!a) {
      var v = d.variant || pickVariant(M), V = M.variants[v];
      html += seg('Variant', Object.keys(M.variants).map(function (k) { return [k, M.variants[k].label]; }), v, 'data-tfs-mockvar') +
        label('Brief') + md(M.brief) + '<p class="small"><b>This variant:</b> ' + inline(V.seed) + '</p>' + label('Assumptions') + ul(M.assumptions) + '<p class="small"><b>Allowed:</b> ' + esc(M.allowed) + '</p>' +
        label('Timeline') + ul(TIMELINE_LIST(M)) + '<p class="small">Mock mode: no hints, no solutions, no practice checks and no simulated terminal until you submit. The timer can be paused, but a paused attempt counts as untimed practice. Nothing is deleted at 0:00.</p>' +
        '<div class="done-btns"><button class="btn primary small" data-tfs-mockstart="' + esc(M.id + ':' + v) + '">Start the 45-minute screen</button></div>';
      return html;
    }
    var V2 = M.variants[a.variant];
    if (!a.submittedAt) return html + mockRunning(M, V2, a);
    return html + mockReview(M, V2, a);
  }
  function TIMELINE_LIST(M) { return LX.tfsMockTimeline.map(function (t) { return t.at + ' min · <b>' + esc(t.label) + '</b> — ' + esc(t.text); }); }
  function mockRunning(M, V, a) {
    var el = activeSec(a), key = 'MOCK:' + a.id, cur = ui.tab[key] || 'main.tf', cue = LX.tfsMockTimeline.filter(function (t) { return el >= t.at * 60; }).pop();
    var html = timerBar(a, true) + '<p class="small">' + badge('mock mode', 'sim') + ' Now: <b>' + esc(cue.label) + '</b> — ' + esc(cue.text) + '</p>' +
      '<details class="brief-wrap" open><summary>Brief · ' + esc(V.label) + '</summary><div class="situation">' + md(M.brief) + '<p class="small"><b>This variant:</b> ' + inline(V.seed) + '</p></div></details>';
    if (el >= M.extension.at * 60) html += '<div class="tip small"><b>Minute ' + M.extension.at + ' — optional change request:</b> ' + inline(M.extension.prompt) + '</div>';
    html += label('Ask the interviewer (practice answers)') + '<div class="chip-links">' + M.clarify.map(function (c, i) { var asked = (a.asked || []).indexOf(i) !== -1; return asked ? '' : '<button class="chip" data-tfs-ask="' + esc(a.id + ':' + i) + '">' + esc(c.q) + '</button>'; }).join('') + '</div>' +
      ((a.asked || []).length ? ul(a.asked, function (i) { var c = M.clarify[i]; return '<b>' + esc(c.q) + '</b> ' + esc(c.a); }) : '') +
      '<label class="prep-label" for="tfsMockNotes">Your outline and notes</label><textarea id="tfsMockNotes" class="notes-input" rows="3" data-tfs-mocknotes="' + esc(a.id) + '">' + esc(a.notes || '') + '</textarea>' +
      editor(key, a.files, cur, false) +
      '<div class="done-btns"><button class="btn small primary" data-tfs-mocksubmit="' + esc(a.id) + '">Submit</button><button class="btn small ghost" data-tfs-mockabandon="' + esc(a.id) + '">Abandon</button></div>' +
      label('Documentation (' + T().interview.docsLabel + ')') + ul(['REG-AWS', 'REG-SGIN', 'REG-NAT', 'TF-LANG', 'AWS-RT'], srcLink);
    return html;
  }
  function scoreMock(M, V, a) {
    var auto = V.auto(), res = gradeFiles(a.files, auto.map(function (x) { return x.check; }), { noRefs: true });
    var dims = {}; T().rubric.dims.forEach(function (d) { dims[d.id] = { auto: 0, autoMax: 0, manual: 0, manualMax: 0, unassessed: 0 }; });
    var autoEarned = 0, autoMax = 0, naPts = 0;
    if (res.parsed) auto.forEach(function (x, i) { var r = res.results[i]; dims[x.dim].autoMax += x.pts; autoMax += x.pts; if (r && r.na) { dims[x.dim].unassessed += x.pts; naPts += x.pts; } else if (r && r.ok) { dims[x.dim].auto += x.pts; autoEarned += x.pts; } });
    else auto.forEach(function (x) { dims[x.dim].autoMax += x.pts; autoMax += x.pts; });
    var man = a.manual || {}, manualEarned = 0, unassessed = 0;
    M.manual.forEach(function (m) { dims[m.dim].manualMax += m.pts; var v = man[m.id]; if (v == null) { dims[m.dim].unassessed += m.pts; unassessed += m.pts; } else { var p = v === 'full' ? m.pts : v === 'half' ? Math.floor(m.pts / 2) : 0; dims[m.dim].manual += p; manualEarned += p; } });
    var critical = (res.critical || []).map(function (r) { return r.critical || r.label; });
    M.manual.forEach(function (m) { if (m.critical && man[m.id] === '0') critical.push(m.critical); });
    var coreOk = res.parsed && auto.filter(function (x) { return x.dim === 'core'; }).every(function (x, i) { var r = res.results[auto.indexOf(x)]; return r && (r.ok || r.na); });
    return { res: res, dims: dims, autoEarned: autoEarned, autoMax: autoMax, manualEarned: manualEarned, unassessed: unassessed + naPts, complete: unassessed + naPts === 0, total: unassessed + naPts === 0 ? autoEarned + manualEarned : null, critical: critical, coreOk: coreOk };
  }
  function mockReview(M, V, a) {
    var sc = a.score || scoreMock(M, V, a), cls = classify(a);
    var html = '<p class="small">Submitted after ' + mmss(activeSec(a)) + ' active · ' + esc(V.label) + ' · <b>' + esc(CLASS_NOTE[cls]) + '</b>' + ((a.asked || []).length ? ' · ' + a.asked.length + ' clarifying question' + (a.asked.length === 1 ? '' : 's') + ' asked (that is good practice, not assistance)' : '') + '</p>';
    html += label('Score') + (sc.complete ? '<p class="small"><b>' + sc.total + ' / 100</b> practice score · ' + (sc.coreOk ? 'core requirements satisfied' : 'core requirements not all satisfied') + '</p>' : '<p class="small"><b>Not complete:</b> ' + sc.autoEarned + ' of ' + sc.autoMax + ' automatically checked points earned; ' + sc.unassessed + ' points not assessed yet. No total is shown until every item is assessed.</p>') +
      (sc.critical.length ? '<div class="tip small"><b>Critical issues:</b> ' + esc(sc.critical.join('; ')) + '</div>' : '') +
      '<div class="table-wrap"><table class="tiers small"><caption class="sr-only">Rubric by dimension</caption><thead><tr><th scope="col">Dimension</th><th scope="col">Auto-checked</th><th scope="col">Self-assessed</th><th scope="col">Not assessed</th></tr></thead><tbody>' +
      T().rubric.dims.map(function (d) { var x = sc.dims[d.id]; return '<tr><th scope="row">' + esc(d.label) + ' (' + d.pts + ')</th><td>' + (x.autoMax ? x.auto + '/' + x.autoMax : '—') + '</td><td>' + (x.manualMax ? x.manual + '/' + x.manualMax : '—') + '</td><td>' + (x.unassessed ? x.unassessed : '') + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      '<p class="muted small">Practice score, not an employer passing score. Communication is never scored from time or clicks — only from your own assessment below.</p>';
    html += label('Automatically checked (practice checks)') + checkView(sc.res, { remedy: true });
    html += label('Self-assessed items') + M.manual.map(function (m) { var v = (a.manual || {})[m.id]; return '<div class="rubric"><span>' + esc(m.label) + ' <span class="muted small">(' + m.pts + ')</span></span>' + [['0', 'not shown'], ['half', 'partly'], ['full', 'clearly']].map(function (o) { var on = v === o[0]; return '<button class="chip' + (on ? ' active' : '') + '" data-tfs-manual="' + esc(a.id + ':' + m.id + ':' + o[0]) + '" aria-pressed="' + on + '">' + esc(o[1]) + '</button>'; }).join('') + (v == null ? ' <span class="muted small">not assessed</span>' : '') + '</div>'; }).join('');
    var ext = M.extension;
    html += label('Minute-25 extension (graded separately)') + '<p class="small">' + inline(ext.prompt) + '</p>' + (ext.checks ? checkView(gradeFiles(a.files, ext.checks(), { noRefs: true })) : ul(ext.points) + '<div class="rubric"><span>My explanation covered these</span>' + [['0', 'no'], ['half', 'partly'], ['full', 'yes']].map(function (o) { var on = (a.ext || null) === o[0]; return '<button class="chip' + (on ? ' active' : '') + '" data-tfs-ext="' + esc(a.id + ':' + o[0]) + '" aria-pressed="' + on + '">' + esc(o[1]) + '</button>'; }).join('') + '</div>');
    html += label('Follow-up questions (answer aloud, then score yourself)') + M.followups.map(function (f, i) { var v = (a.follow || {})[i]; return '<article class="card"><div class="card-main"><p class="small"><b>' + esc(f.topic) + ':</b> ' + inline(f.q) + '</p>' + (v != null ? '<div class="tip small"><b>Strong answer:</b> ' + inline(f.strong) + '<br><span class="muted">' + esc(f.scoring) + '</span></div>' : '') + '<div class="rubric"><span>Your answer</span>' + [0, 1, 2].map(function (n) { var on = v === n; return '<button class="chip' + (on ? ' active' : '') + '" data-tfs-follow="' + esc(a.id + ':' + i + ':' + n) + '" aria-pressed="' + on + '">' + n + '</button>'; }).join('') + '</div></div></article>'; }).join('');
    html += label('Reference implementation and review') + '<p class="small">' + inline(M.reviewText) + '</p>';
    var ref = src(V.solution) || {}, f = ui.diffFile[a.id] || 'main.tf';
    html += '<div class="seg-row" role="tablist" aria-label="Compare file">' + Object.keys(ref).filter(function (x) { return /\.tf$/.test(x); }).map(function (x) { var on = x === f; return '<button class="seg' + (on ? ' active' : '') + '" data-tfs-diff="' + esc(a.id + '|' + x) + '" aria-pressed="' + on + '">' + esc(x) + '</button>'; }).join('') + '</div>' + sideBySide(a.files[f] || '', ref[f] || '');
    html += '<label class="prep-label" for="tfsMockReviewNotes">Review notes: what to drill next</label><textarea id="tfsMockReviewNotes" class="notes-input" rows="3" data-tfs-reviewnotes="' + esc(a.id) + '">' + esc(a.reviewNotes || '') + '</textarea>' +
      '<div class="done-btns"><button class="btn small primary" data-tfs-mockreviewed="' + esc(a.id) + '">' + (a.reviewedAt ? 'Review saved ✓' : 'Save review') + '</button><button class="btn small" data-tfs-mocknew="' + esc(M.id) + '">New attempt (another variant)</button></div>';
    return html;
  }
  function renderRehearsal() {
    var R = LX.tfsRehearsal, s = st(), W = s.readiness.worksheet || {};
    return back() + '<h3 class="prep-h3">60-minute rehearsal</h3><p class="small">' + esc(R.note) + '</p>' +
      R.parts.map(function (p, i) { return '<article class="card"><div class="card-main"><p class="card-title plain">' + p.mins + ' min · ' + esc(p.title) + '</p><p class="small">' + esc(p.text) + '</p>' + (i === 0 ? (W.w1 ? '<p class="muted small">Your notes: ' + esc([W.w1, W.w2, W.w3].filter(Boolean).join(' · ').slice(0, 400)) + '</p>' : '') + '<button class="btn small ghost" data-tfs-timer="300">5-minute timer</button>' : i === 1 ? '<button class="btn small" data-tfs-mock="A">Mock A</button> <button class="btn small" data-tfs-mock="B">Mock B</button>' : ul(LX.tfsReadiness.questions) + '<button class="btn small ghost" data-tfs-timer="600">10-minute timer</button>') + '</div></article>'; }).join('') +
      '<span class="mock-timer" id="tfsOralTimer" aria-live="polite"></span>';
  }
  var DETAIL = { lesson: renderLesson, diag: renderDiag, quiz: renderQuiz, oral: renderOral, lab: renderLab, faults: renderFaults, tickets: renderTickets, plan: renderPlan, mock: renderMock, rehearsal: renderRehearsal };

  /* ══ timers ══════════════════════════════════════════════════════ */
  var clock = null, oralT = null;
  function tick() {
    clearInterval(clock);
    if (!document.getElementById('tfsClock')) return;
    function upd() {
      var e = document.getElementById('tfsClock'); if (!e) { clearInterval(clock); return; }
      var a = attempt(e.dataset.tfsAtt); if (!a) return;
      var left = a.limit - activeSec(a);
      e.textContent = left > 0 ? mmss(left) : 'time — ' + mmss(-left) + ' over';
      e.classList.toggle('over', left <= 0);
      /* the extension appears at its minute without a click */
      if (ui.detail && ui.detail.kind === 'mock' && !a.extSeen && a.kind === 'mock') { var M = mockDef(a.mockId); if (M && activeSec(a) >= M.extension.at * 60) { a.extSeen = true; putAttempt(a); render(); } }
    }
    upd(); clock = setInterval(upd, 1000);
  }

  /* ══ events ══════════════════════════════════════════════════════ */
  function parse(j) { try { return JSON.parse(j); } catch (e) { return null; } }
  function onTrack() { return U().track() === 'tfaws'; }
  function show(d) { if (!onTrack()) U().setTrack('tfaws'); U().go('tfs'); ui.stack = []; ui.detail = d; render(); window.scrollTo(0, 0); }
  var draftT = null;
  function saveEditor(t) {
    var p = t.dataset.tfsEdit.split('|'), key = p[0], f = p[1], s = st(), k = key.split(':'), kind = k[0], id = k.slice(1).join(':');
    if (kind === 'LAB' || kind === 'MOCK') { var a = s.attempts[id]; if (a && !a.submittedAt) { a.files[f] = t.value; a.updatedAt = now(); } }
    else if (kind === 'LT') { var L = s.lessons[id] = s.lessons[id] || {}; L.task = L.task || {}; L.task.file = t.value; }
    else if (kind === 'LR') { var L2 = s.lessons[id] = s.lessons[id] || {}; L2.retrieval = L2.retrieval || {}; L2.retrieval.file = t.value; }
    else if (kind === 'TK') { var tk = s.tickets[id] = s.tickets[id] || {}; tk.file = t.value; }
    save(s);
  }
  function flushEditor() { $$('[data-tfs-edit]').forEach(function (t) { if (!t.readOnly) saveEditor(t); }); }
  function lessonFiles(id, which) { var s = st(), l = lesson(id), L = s.lessons[id] || {}; if (which === 'task') return { 'main.tf': (L.task && L.task.file != null) ? L.task.file : (l.task.start || '') }; return { 'main.tf': (L.retrieval && L.retrieval.file != null) ? L.retrieval.file : (l.retrieval.start || '') }; }
  function simRun(simKey, cmd) {
    var s = st(), sim = s.sims[simKey] || window.LXTfSim.create(), files;
    var k = simKey.split(':');
    if (k[0] === 'lab') files = (s.attempts[k[1]] || {}).files || {};
    else if (k[0] === 'lt') files = lessonFiles(k[1], 'task');
    var r = window.LXTfSim.run(sim, files, cmd);
    sim.log = (sim.log || []).concat([{ cmd: cmd, out: r.out, code: r.code }]).slice(-40);
    s = st(); s.sims[simKey] = sim; save(s);
  }
  document.addEventListener('input', function (e) {
    var t = e.target; if (!t || !t.dataset) return;
    if (t.dataset.tfsEdit) { clearTimeout(draftT); draftT = setTimeout(function () { saveEditor(t); }, 250); return; }
    var s;
    if (t.dataset.tfsMocknotes) { s = st(); var a = s.attempts[t.dataset.tfsMocknotes]; if (a) { a.notes = t.value; save(s); } return; }
    if (t.dataset.tfsReviewnotes) { s = st(); var a2 = s.attempts[t.dataset.tfsReviewnotes]; if (a2) { a2.reviewNotes = t.value; save(s); } return; }
    if (t.dataset.tfsWs) { s = st(); s.readiness.worksheet = s.readiness.worksheet || {}; s.readiness.worksheet[t.dataset.tfsWs] = t.value; save(s); return; }
    if (t.dataset.tfsFtext) { s = st(); var F = s.faults[t.dataset.tfsFtext] = s.faults[t.dataset.tfsFtext] || {}; F.text = t.value; save(s); return; }
    if (t.dataset.tfsRtext) { s = st(); var L = s.lessons[t.dataset.tfsRtext] = s.lessons[t.dataset.tfsRtext] || {}; L.retrieval = L.retrieval || {}; L.retrieval.text = t.value; save(s); return; }
    if (t.dataset.tfsBpred) { var p = t.dataset.tfsBpred.split(':'); s = st(); var B = s.lessons['B:' + p[0]] = s.lessons['B:' + p[0]] || {}; B.pred = B.pred || {}; B.pred[p[1]] = t.value; save(s); return; }
    if (t.dataset.tfsQtext) { if (ui.detail) { ui.detail.texts = ui.detail.texts || {}; ui.detail.texts[t.dataset.tfsQtext] = t.value; } return; }
  });
  window.addEventListener('beforeunload', flushEditor);
  document.addEventListener('change', function (e) {
    var t = e.target; if (!t || !t.dataset) return; var s;
    if (t.dataset.tfsOralck) { var p = t.dataset.tfsOralck.split(':'); s = st(); var k = p.slice(0, -1).join(':'); var O = s.oral[k] = s.oral[k] || {}; O[p[p.length - 1]] = t.checked; save(s); return; }
    if (t.dataset.tfsCl) { s = st(); s.readiness.checklist = s.readiness.checklist || {}; s.readiness.checklist[t.dataset.tfsCl] = t.checked; save(s); return; }
  });
  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (t && t.id === 'tfsSimIn' && e.key === 'Enter') { e.preventDefault(); var v = t.value.trim(); if (!v) return; flushEditor(); simRun(t.dataset.tfsSimkey, v); render(); var n = $('#tfsSimIn'); if (n) n.focus(); var term = $('#tfsTerm'); if (term) term.scrollTop = term.scrollHeight; return; }
    if (e.key !== 'Escape' || !ui.detail || !root() || !root().contains(t)) return;
    if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT') { t.blur(); return; }
    goBack();
  });
  document.addEventListener('click', function (e) {
    var t = e.target, el, p, s, a;
    if (!t.closest) return;
    el = t.closest('[data-tfs-copy]'); if (el) { copyText(el.dataset.tfsCopy); return; }
    if (!t.closest('#view-tfs')) return;
    if (t.closest('[data-tfs-file],[data-tfs-section],[data-tfs-back],[data-tfs-item],[data-tfs-level],[data-tfs-variant],[data-tfs-labsubmit],[data-tfs-labcheck],[data-tfs-mocksubmit],[data-tfs-simrun],[data-tfs-simcmd],[data-tfs-ltcheck],[data-tfs-ltsubmit],[data-tfs-copyall],[data-tfs-download],[data-tfs-rcheckcode],[data-tfs-tkcheck]')) flushEditor();
    el = t.closest('[data-tfs-section]'); if (el) { go(el.dataset.tfsSection); return; }
    el = t.closest('[data-tfs-back]'); if (el) { goBack(); return; }
    el = t.closest('[data-tfs-enroll]'); if (el) { s = st(); s.enrolledAt = now(); s.ui.path = s.ui.path || 'full'; save(s); render(); return; }
    el = t.closest('[data-tfs-path]'); if (el) { s = st(); s.ui.path = el.dataset.tfsPath; save(s); render(); return; }
    el = t.closest('[data-tfs-resume]'); if (el) { s = st(); var last = s.ui.last; if (last && last.kind === 'item') openItem(last.m, last.it); else if (last && last.kind === 'lab') detail({ kind: 'lab', id: last.id, level: last.level, variant: last.variant }); return; }
    el = t.closest('[data-tfs-item]'); if (el) { var x = parse(el.dataset.tfsItem); if (x) openItem(x.m, x.it); return; }
    el = t.closest('[data-tfs-module]'); if (el) { ui.openModule = el.dataset.tfsModule; go('modules'); var m = document.getElementById('tfs-' + el.dataset.tfsModule); if (m) m.scrollIntoView(); return; }
    el = t.closest('[data-tfs-opt]'); if (el) { var o = parse(el.dataset.tfsOpt); if (!o) return; if (o.kind === 'lab') detail({ kind: 'lab', id: o.id, level: o.level, variant: o.variant || 'base' }); else if (o.kind === 'mock') detail({ kind: 'mock', id: o.id, variant: o.variant }); else if (o.kind === 'rehearsal') detail({ kind: 'rehearsal' }); else if (o.kind === 'readmore') { U().toast('Modules and remote state: see the Terraform language docs (About → Sources)'); go('about'); } return; }
    el = t.closest('[data-tfs-resched]'); if (el) { s = st(); var today = ymdNY(), days = scheduleDays(), firstOpen = days.filter(function (d) { return dayItems(d).some(function (x) { return !itemDone(x.m, x.it); }); })[0]; if (firstOpen) { var shiftBy = dayDiff(firstOpen.date, today); s.ui.schedStart = addDays(s.ui.schedStart || T().schedule[0].date, shiftBy); save(s); U().toast('Plan now continues from today'); } render(); return; }
    el = t.closest('[data-tfs-reschedreset]'); if (el) { s = st(); delete s.ui.schedStart; save(s); render(); return; }
    el = t.closest('[data-tfs-lesson]'); if (el) { detail({ kind: 'lesson', id: el.dataset.tfsLesson }); return; }
    el = t.closest('[data-tfs-retr]'); if (el) { detail({ kind: 'lesson', id: el.dataset.tfsRetr }); setTimeout(function () { var r = $$('.section-label').filter(function (x) { return /Rebuild/.test(x.textContent); })[0]; if (r) r.scrollIntoView(); }, 0); return; }
    el = t.closest('[data-tfs-export]'); if (el) { var ta = $('#tfsExport'); ta.hidden = false; ta.value = JSON.stringify({ key: KEY, course: T().id, version: T().version, exported: now(), data: st() }, null, 2); ta.focus(); ta.select(); return; }
    el = t.closest('[data-tfs-timer]'); if (el) { var secs = Number(el.dataset.tfsTimer), end = Date.now() + secs * 1000; clearInterval(oralT); oralT = setInterval(function () { var left = Math.max(0, Math.round((end - Date.now()) / 1000)), x2 = $('#tfsOralTimer'); if (!x2) { clearInterval(oralT); return; } x2.textContent = left ? mmss(left) : 'time'; if (!left) clearInterval(oralT); }, 250); return; }
    el = t.closest('[data-tfs-file]'); if (el) { p = el.dataset.tfsFile.split('|'); ui.tab[p[0]] = p[1]; render(); var ed = document.getElementById(edId(p[0])); if (ed) ed.focus(); return; }
    /* lessons */
    el = t.closest('[data-tfs-predict]'); if (el) { p = el.dataset.tfsPredict.split(':'); s = st(); var L = s.lessons[p[0]] = s.lessons[p[0]] || {}; L.predict = Number(p[1]); L.predictAt = now(); save(s); render(); return; }
    el = t.closest('[data-tfs-ltcheck]'); if (el) { var l1 = lesson(el.dataset.tfsLtcheck); ui.grade = { key: 'LT:' + l1.id, res: gradeFiles(lessonFiles(l1.id, 'task'), l1.task.checks()) }; render(); return; }
    el = t.closest('[data-tfs-ltsubmit]'); if (el) { var l2 = lesson(el.dataset.tfsLtsubmit), res = gradeFiles(lessonFiles(l2.id, 'task'), l2.task.checks()); s = st(); var L2 = s.lessons[l2.id] = s.lessons[l2.id] || {}; L2.task = L2.task || {}; L2.task.submittedAt = now(); L2.task.grade = res; save(s); logMistakes(res, 'lesson ' + l2.id); ui.grade = null; render(); return; }
    el = t.closest('[data-tfs-lthint]'); if (el) { p = el.dataset.tfsLthint.split(':'); s = st(); var L3 = s.lessons[p[0]] = s.lessons[p[0]] || {}; L3.task = L3.task || {}; L3.task.hints = L3.task.hints || []; if (L3.task.hints.indexOf(Number(p[1])) === -1) L3.task.hints.push(Number(p[1])); save(s); render(); return; }
    el = t.closest('[data-tfs-ltsol]'); if (el) { if (!window.confirm('Show the solution? The task will count as assisted.')) return; s = st(); var L4 = s.lessons[el.dataset.tfsLtsol] = s.lessons[el.dataset.tfsLtsol] || {}; L4.task = L4.task || {}; L4.task.solutionViewed = true; save(s); render(); return; }
    el = t.closest('[data-tfs-ltsim]'); if (el) { var l3 = lesson(el.dataset.tfsLtsim); detail({ kind: 'lessonsim', id: l3.id }); return; }
    el = t.closest('[data-tfs-lessondone]'); if (el) { var l4 = lesson(el.dataset.tfsLessondone); s = st(); var L5 = s.lessons[l4.id] = s.lessons[l4.id] || {}; if (l4.predict && L5.predict == null) { U().toast('Make your prediction first'); return; } if (l4.task && !(L5.task && L5.task.submittedAt)) { U().toast('Submit the build task first (it can be assisted)'); return; } L5.completedAt = L5.completedAt || now(); save(s); render(); return; }
    el = t.closest('[data-tfs-rord]'); if (el) { p = el.dataset.tfsRord.split(':'); s = st(); var L6 = s.lessons[p[0]] = s.lessons[p[0]] || {}; L6.retrieval = L6.retrieval || {}; var arr = L6.retrieval.order = L6.retrieval.order || [], si = Number(p[1]), at = arr.indexOf(si); if (at === -1) arr.push(si); else arr.splice(at, 1); save(s); render(); return; }
    el = t.closest('[data-tfs-rcheck]'); if (el) { s = st(); var L7 = s.lessons[el.dataset.tfsRcheck]; L7.retrieval.checkedAt = now(); L7.retrieval.ok = L7.retrieval.order.every(function (x, i) { return x === i; }); save(s); render(); return; }
    el = t.closest('[data-tfs-rreset]'); if (el) { s = st(); s.lessons[el.dataset.tfsRreset].retrieval = {}; save(s); render(); return; }
    el = t.closest('[data-tfs-rshow]'); if (el) { s = st(); var L8 = s.lessons[el.dataset.tfsRshow] = s.lessons[el.dataset.tfsRshow] || {}; L8.retrieval = L8.retrieval || {}; if ((L8.retrieval.text || '').trim().length < 15) { U().toast('Answer first, without notes'); return; } L8.retrieval.shown = now(); save(s); render(); return; }
    el = t.closest('[data-tfs-rcheckcode]'); if (el) { var l5 = lesson(el.dataset.tfsRcheckcode), r = gradeFiles(lessonFiles(l5.id, 'retrieval'), l5.retrieval.checks()); s = st(); var L9 = s.lessons[l5.id] = s.lessons[l5.id] || {}; L9.retrieval = L9.retrieval || {}; L9.retrieval.grade = r; L9.retrieval.at = now(); save(s); ui.grade = { key: 'LR:' + l5.id, res: r }; render(); return; }
    /* diagnostic, quiz, oral */
    el = t.closest('[data-tfs-diag]'); if (el) { p = el.dataset.tfsDiag.split(':'); s = st(); s.diag.answers = s.diag.answers || {}; var q = byId_('diag', p[0]); if (p[1] === 'unsure') s.diag.answers[p[0]] = 'unsure'; else if (q.multi) { var cur = Array.isArray(s.diag.answers[p[0]]) ? s.diag.answers[p[0]] : []; var n = Number(p[1]), ix = cur.indexOf(n); if (ix === -1) cur.push(n); else cur.splice(ix, 1); s.diag.answers[p[0]] = cur; } else s.diag.answers[p[0]] = Number(p[1]); save(s); render(); return; }
    el = t.closest('[data-tfs-dord]'); if (el) { p = el.dataset.tfsDord.split(':'); s = st(); s.diag.answers = s.diag.answers || {}; var c2 = Array.isArray(s.diag.answers[p[0]]) ? s.diag.answers[p[0]] : []; var n2 = Number(p[1]), i2 = c2.indexOf(n2); if (i2 === -1) c2.push(n2); else c2.splice(i2, 1); s.diag.answers[p[0]] = c2; save(s); render(); return; }
    el = t.closest('[data-tfs-diagsubmit]'); if (el) { s = st(); s.diag.completedAt = now(); save(s); render(); return; }
    el = t.closest('[data-tfs-q]'); if (el) { p = el.dataset.tfsQ.split(':'); var qq = byId('tfsQuiz', p[0]), pick = Number(p[1]); ui.detail.answers = ui.detail.answers || {}; ui.detail.answers[qq.id] = pick; recordQuiz(qq, pick === qq.a); render(); return; }
    el = t.closest('[data-tfs-qself]'); if (el) { p = el.dataset.tfsQself.split(':'); var q2 = byId('tfsQuiz', p[0]); if (((ui.detail.texts || {})[q2.id] || '').trim().length < 10) { U().toast('Write your answer first'); return; } ui.detail.answers = ui.detail.answers || {}; ui.detail.answers[q2.id] = Number(p[1]); recordQuiz(q2, p[1] === '1'); render(); return; }
    el = t.closest('[data-tfs-quizdone]'); if (el) { p = el.dataset.tfsQuizdone.split(':'); markDone(p[0], 'quiz', p[1]); render(); return; }
    el = t.closest('[data-tfs-queue]'); if (el) { detail({ kind: 'quiz', ids: reviewQueue().quiz.map(function (x) { return x.id; }) }); return; }
    el = t.closest('[data-tfs-oralshow]'); if (el) { p = el.dataset.tfsOralshow.split(':'); s = st(); var O = s.oral['O:' + p[0]] = s.oral['O:' + p[0]] || {}; O[p[1]] = now(); save(s); render(); return; }
    el = t.closest('[data-tfs-oraldone]'); if (el) { p = el.dataset.tfsOraldone.split(':'); markDone(p[0], 'oral', p[1]); render(); return; }
    /* builds */
    el = t.closest('[data-tfs-level]'); if (el) { ui.detail.level = el.dataset.tfsLevel; ui.detail.attempt = null; ui.grade = null; render(); return; }
    el = t.closest('[data-tfs-variant]'); if (el) { ui.detail.variant = el.dataset.tfsVariant; ui.detail.attempt = null; ui.grade = null; render(); return; }
    el = t.closest('[data-tfs-labcheck]'); if (el) { a = attempt(el.dataset.tfsLabcheck); var L10 = lab(a.labId); var res2 = gradeFiles(a.files, variantOf(L10, a.variant).checks()); a.checks = (a.checks || 0) + 1; putAttempt(a); ui.grade = { key: 'LAB:' + a.id, res: res2 }; render(); return; }
    el = t.closest('[data-tfs-labhint]'); if (el) { p = el.dataset.tfsLabhint.split(':'); a = attempt(p[0]); if (a.hints.indexOf(Number(p[1])) === -1) a.hints.push(Number(p[1])); putAttempt(a); render(); return; }
    el = t.closest('[data-tfs-labsol]'); if (el) { if (!window.confirm('Show the reference solution? This attempt will count as assisted. You can retry later with a fresh attempt.')) return; a = attempt(el.dataset.tfsLabsol); a.solutionViewed = true; putAttempt(a); render(); return; }
    el = t.closest('[data-tfs-labsubmit]'); if (el) {
      a = attempt(el.dataset.tfsLabsubmit); var L11 = lab(a.labId), V = variantOf(L11, a.variant);
      if (a.level === 'interview' && !window.confirm('Submit? Hints, checks and the solution will be shown.')) return;
      a.grade = gradeFiles(a.files, V.checks()); if (L11.change) a.change = gradeFiles(a.files, L11.change.checks());
      a.events.push({ t: now(), type: 'submit' }); a.submittedAt = now(); a.activeSec = activeSec(a); putAttempt(a);
      logMistakes(a.grade, L11.title + ' (' + a.level + ')'); ui.grade = null; render(); window.scrollTo(0, 0); return;
    }
    el = t.closest('[data-tfs-labreset]'); if (el) {
      a = attempt(el.dataset.tfsLabreset); var L12 = lab(a.labId);
      if (edited(a, L12) && !window.confirm('Start a new attempt? This workspace\'s edits stay in your history as an unfinished attempt; the new one starts from the level\'s starting files.')) return;
      var na = restartLab(L12, a.level, a.variant); ui.detail.attempt = null; ui.grade = null; void na; render(); return;
    }
    el = t.closest('[data-tfs-retry]'); if (el) { a = attempt(el.dataset.tfsRetry); var L13 = lab(a.labId), keys = Object.keys(L13.variants); var nv = keys.length > 1 ? keys[(keys.indexOf(a.variant) + 1) % keys.length] : a.variant; s = st(); delete s.work[wkey(L13.id, a.level, nv)]; save(s); detail({ kind: 'lab', id: L13.id, level: a.level, variant: nv }); return; }
    el = t.closest('[data-tfs-retrylevel]'); if (el) { p = el.dataset.tfsRetrylevel.split(':'); a = attempt(p[0]); s = st(); delete s.work[wkey(a.labId, p[1], a.variant)]; save(s); detail({ kind: 'lab', id: a.labId, level: p[1], variant: a.variant }); return; }
    el = t.closest('[data-tfs-att]'); if (el) { a = attempt(el.dataset.tfsAtt); if (!a) return; if (a.kind === 'mock') detail({ kind: 'mock', id: a.mockId, attempt: a.id }); else detail({ kind: 'lab', id: a.labId, level: a.level, variant: a.variant, attempt: a.id }); return; }
    el = t.closest('[data-tfs-diff]'); if (el) { p = el.dataset.tfsDiff.split('|'); ui.diffFile[p[0]] = p[1]; render(); return; }
    el = t.closest('[data-tfs-bpredshow]'); if (el) { p = el.dataset.tfsBpredshow.split(':'); s = st(); var B = s.lessons['B:' + p[0]] = s.lessons['B:' + p[0]] || {}; B.pred = B.pred || {}; if (!(B.pred[p[1]] || '').trim()) { U().toast('Write your prediction first'); return; } B.pred['shown' + p[1]] = now(); save(s); render(); return; }
    el = t.closest('[data-tfs-pause]'); if (el) { a = attempt(el.dataset.tfsPause); a.events.push({ t: now(), type: 'pause' }); a.paused = true; putAttempt(a); render(); return; }
    el = t.closest('[data-tfs-resumet]'); if (el) { a = attempt(el.dataset.tfsResumet); a.events.push({ t: now(), type: 'resume' }); putAttempt(a); render(); return; }
    /* simulator */
    el = t.closest('[data-tfs-simrun]'); if (el) { var inp = $('#tfsSimIn'); if (inp && inp.value.trim()) { simRun(el.dataset.tfsSimrun, inp.value.trim()); render(); } return; }
    el = t.closest('[data-tfs-simcmd]'); if (el) { p = el.dataset.tfsSimcmd.split('|'); simRun(p[0], p[1]); render(); var term = $('#tfsTerm'); if (term) term.scrollTop = term.scrollHeight; return; }
    el = t.closest('[data-tfs-simreset]'); if (el) { s = st(); delete s.sims[el.dataset.tfsSimreset]; save(s); render(); return; }
    /* local and AWS */
    el = t.closest('[data-tfs-copyall]'); if (el) { a = attempt(el.dataset.tfsCopyall); copyText(exportScript('tfs-' + a.labId + '-' + a.level, a.files)); return; }
    el = t.closest('[data-tfs-download]'); if (el) { a = attempt(el.dataset.tfsDownload); var blob = new Blob([exportScript('tfs-' + a.labId + '-' + a.level, a.files)], { type: 'text/x-shellscript' }); var url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = 'tfs-' + a.labId + '-' + a.level + '.sh'; document.body.appendChild(link); link.click(); setTimeout(function () { URL.revokeObjectURL(url); link.remove(); }, 0); return; }
    el = t.closest('[data-tfs-localsave]'); if (el) { var txt = ($('#tfsLocalOut') || {}).value || ''; if (!txt.trim()) { U().toast('Paste the output first'); return; } s = st(); var sum = /Success! The configuration is valid/.test(txt) ? 'validate reported success' : /Error:/.test(txt) ? 'contains errors: ' + (txt.match(/Error: [^\n]+/) || [''])[0] : /Plan: \d+ to add/.test(txt) ? (txt.match(/Plan: [^\n]+/) || [''])[0] : 'output saved'; s.local[el.dataset.tfsLocalsave] = (s.local[el.dataset.tfsLocalsave] || []).concat([{ at: now(), text: txt.slice(0, 20000), summary: sum, provenance: 'learner-supplied' }]); save(s); U().toast('Saved as learner-supplied'); render(); return; }
    el = t.closest('[data-tfs-awsoptin]'); if (el) { if (!($('#tfsAwsAck') || {}).checked) { U().toast('Tick the sandbox statement first'); return; } s = st(); s.aws[el.dataset.tfsAwsoptin] = { optIn: true, at: now() }; save(s); render(); return; }
    el = t.closest('[data-tfs-awsoptout]'); if (el) { s = st(); delete s.aws[el.dataset.tfsAwsoptout]; save(s); render(); return; }
    /* faults, tickets, plan */
    el = t.closest('[data-tfs-fshow]'); if (el) { s = st(); var F = s.faults[el.dataset.tfsFshow] = s.faults[el.dataset.tfsFshow] || {}; if ((F.text || '').trim().length < 10) { U().toast('Write your diagnosis first'); return; } F.shown = now(); save(s); render(); return; }
    el = t.closest('[data-tfs-faultsdone]'); if (el) { markDone('m4', 'faults', 'b3'); render(); return; }
    el = t.closest('[data-tfs-tk]'); if (el) { p = el.dataset.tfsTk.split(':'); s = st(); var tk = s.tickets[p[0]] = s.tickets[p[0]] || {}; tk.pick = Number(p[1]); tk.at = now(); save(s); var T1 = byId('tfsTickets', p[0]); if (tk.pick !== T1.a) logMistakes({ results: [{ ok: false, sev: 'required', label: T1.title, why: 'diagnosis chosen: ' + T1.choices[tk.pick], cat: T1.cat, lesson: 'l5d' }] }, 'bug ticket ' + T1.id); render(); return; }
    el = t.closest('[data-tfs-tkcheck]'); if (el) { var T2 = byId('tfsTickets', el.dataset.tfsTkcheck), sv = (st().tickets[T2.id] || {}).file, fl = { 'main.tf': sv != null ? sv : T2.files }; ui.grade = { key: 'TK:' + T2.id, res: gradeFiles(fl, T2.fixCheck(), { noRefs: true }) }; s = st(); var tk2 = s.tickets[T2.id] = s.tickets[T2.id] || {}; tk2.fixed = ui.grade.res.passed; save(s); render(); return; }
    el = t.closest('[data-tfs-tkfix]'); if (el) { s = st(); var tk3 = s.tickets[el.dataset.tfsTkfix] = s.tickets[el.dataset.tfsTkfix] || {}; tk3.fixShown = now(); save(s); render(); return; }
    el = t.closest('[data-tfs-tkdone]'); if (el) { p = el.dataset.tfsTkdone.split(':'); markDone(p[0], 'tickets', p[1]); render(); return; }
    el = t.closest('[data-tfs-plan]'); if (el) { p = el.dataset.tfsPlan.split(':'); s = st(); var P = s.plans.plan1 = s.plans.plan1 || { answers: {} }; P.answers[p[0]] = Number(p[1]); var PQ = list('tfsPlans')[0].questions[Number(p[0])]; if (Number(p[1]) !== PQ.a) logMistakes({ results: [{ ok: false, sev: 'required', label: 'Plan reading: ' + PQ.q.slice(0, 60), why: PQ.why, cat: 'state', lesson: 'l5c' }] }, 'exercise 5.3'); save(s); render(); return; }
    el = t.closest('[data-tfs-plandone]'); if (el) { p = el.dataset.tfsPlandone.split(':'); markDone(p[0], 'plan', p[1]); render(); return; }
    /* mocks */
    el = t.closest('[data-tfs-mock]'); if (el) { detail({ kind: 'mock', id: el.dataset.tfsMock }); return; }
    el = t.closest('[data-tfs-mockattempt]'); if (el) { p = el.dataset.tfsMockattempt.split(':'); detail({ kind: 'mock', id: p[0], attempt: p[1] }); return; }
    el = t.closest('[data-tfs-mockvar]'); if (el) { ui.detail.variant = el.dataset.tfsMockvar; render(); return; }
    el = t.closest('[data-tfs-mockstart]'); if (el) { p = el.dataset.tfsMockstart.split(':'); var na2 = newAttempt('mock', { mockId: p[0], variant: p[1], files: { 'main.tf': '', 'variables.tf': '', 'outputs.tf': '' }, timed: true, limit: 45 * 60, level: 'interview', asked: [] }); ui.detail.attempt = na2.id; s = st(); s.ui.last = { kind: 'item', m: 'm7', it: { kind: 'mock', id: p[0], mins: 45 } }; save(s); render(); window.scrollTo(0, 0); return; }
    el = t.closest('[data-tfs-ask]'); if (el) { p = el.dataset.tfsAsk.split(':'); a = attempt(p[0]); a.asked = a.asked || []; if (a.asked.indexOf(Number(p[1])) === -1) a.asked.push(Number(p[1])); putAttempt(a); render(); return; }
    el = t.closest('[data-tfs-mocksubmit]'); if (el) { if (!window.confirm('Submit the screen? Feedback, the rubric and the reference will be shown.')) return; a = attempt(el.dataset.tfsMocksubmit); a.events.push({ t: now(), type: 'submit' }); a.submittedAt = now(); a.activeSec = activeSec(a); var M2 = mockDef(a.mockId); a.score = scoreMock(M2, M2.variants[a.variant], a); putAttempt(a); logMistakes(a.score.res, 'Mock ' + a.mockId + ' ' + a.variant); ui.detail.attempt = a.id; render(); window.scrollTo(0, 0); return; }
    el = t.closest('[data-tfs-mockabandon]'); if (el) { if (!window.confirm('Abandon this attempt? It stays in your history as abandoned.')) return; a = attempt(el.dataset.tfsMockabandon); a.abandoned = true; a.events.push({ t: now(), type: 'pause' }); putAttempt(a); ui.detail.attempt = null; render(); return; }
    el = t.closest('[data-tfs-manual]'); if (el) { p = el.dataset.tfsManual.split(':'); a = attempt(p[0]); a.manual = a.manual || {}; a.manual[p[1]] = p[2]; var M3 = mockDef(a.mockId); a.score = scoreMock(M3, M3.variants[a.variant], a); if (p[2] === '0') logMistakes({ results: [{ ok: false, sev: 'required', label: M3.manual.filter(function (m) { return m.id === p[1]; })[0].label, why: 'self-assessed: not shown', cat: /^m-com/.test(p[1]) ? 'communication' : /^m-ver/.test(p[1]) ? 'verification' : 'routing', lesson: /^m-ver/.test(p[1]) ? 'l5d' : 'l3d' }] }, 'Mock ' + a.mockId + ' self-assessment'); putAttempt(a); render(); return; }
    el = t.closest('[data-tfs-ext]'); if (el) { p = el.dataset.tfsExt.split(':'); a = attempt(p[0]); a.ext = p[1]; putAttempt(a); render(); return; }
    el = t.closest('[data-tfs-follow]'); if (el) { p = el.dataset.tfsFollow.split(':'); a = attempt(p[0]); a.follow = a.follow || {}; a.follow[p[1]] = Number(p[2]); putAttempt(a); render(); return; }
    el = t.closest('[data-tfs-mockreviewed]'); if (el) { a = attempt(el.dataset.tfsMockreviewed); a.reviewedAt = now(); putAttempt(a); U().toast('Review saved'); render(); return; }
    el = t.closest('[data-tfs-mocknew]'); if (el) { ui.detail = { kind: 'mock', id: el.dataset.tfsMocknew }; render(); return; }
    el = t.closest('[data-tfs-rehearsal]'); if (el) { detail({ kind: 'rehearsal' }); return; }
    /* readiness */
    el = t.closest('[data-tfs-readydone]'); if (el) { markDone('m8', 'readiness', 'ready'); render(); return; }
  });
  function byId_(kind, id) { return LX.tfsDiag.items.filter(function (x) { return x.id === id; })[0]; }
  function recordQuiz(q, ok) {
    var s = st(), H = s.quiz[q.id] = s.quiz[q.id] || { history: [] };
    H.history.push({ at: now(), ok: !!ok }); save(s);
    if (!ok) logMistakes({ results: [{ ok: false, sev: 'required', label: q.q.split('\n')[0].replace(/[`*]/g, '').slice(0, 90), why: q.why || 'see the model answer', cat: q.cat, lesson: q.lesson }] }, 'knowledge check ' + q.id);
  }
  function copyText(txt) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(function () { U().toast('Copied'); }, function () { U().toast('Copy failed — select the text instead'); });
    else U().toast('Clipboard unavailable — select the text instead');
  }

  /* a lesson task opened in the simulated terminal */
  DETAIL.lessonsim = function () {
    var l = lesson(ui.detail.id);
    return back() + '<h3 class="prep-h3">Simulated terminal: ' + esc(l.title) + '</h3><p class="small">Your current task file is loaded read-only below. Edit it on the lesson page.</p>' + pre(lessonFiles(l.id, 'task')['main.tf']) + simPanel('lt:' + l.id, lessonFiles(l.id, 'task'), 'lesson task');
  };

  window.LXTfs = {
    render: render, go: go, open: show, state: st, activeSec: activeSec, classify: classify, scoreMock: scoreMock,
    pathMins: pathMins, pathItems: pathItems, nextItem: nextItem, readiness: readiness, exportScript: exportScript, lineDiff: lineDiff, _ui: ui
  };
})();
