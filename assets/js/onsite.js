/* Prep hub for the onsite track: study path, lessons, questions, labs, design,
   scripting, real labs, stories, mock interviews, progress and notes.

   Rendered only while the onsite track is active (app.js scopes the Prep view
   to it). Everything is deterministic content plus self-assessment — there is
   no AI grading, and the page says so wherever a rating is asked for.

   Evidence tiers are kept apart and labelled for what they are:
     studied (self-marked) · answered before revealing (self-assessed) ·
     guided simulation · simulation without hints · real lab reported ·
     real-lab verify script reported (still self-reported: the app cannot see
     your cluster). None of them is presented as production competence.

   State: one localStorage key, lx.onsite (included in Review › export). */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function U() { return window.LXUtil; }
  function esc(x) { return U().esc(x == null ? '' : x); }
  var KEY = 'lx.onsite';

  function st() {
    var s = U().LS.get(KEY, {}) || {};
    ['lessons', 'questions', 'design', 'scripting', 'real', 'stories', 'summaries', 'boosts', 'formats', 'hands', 'walks', 'cases'].forEach(function (k) {
      if (!s[k] || typeof s[k] !== 'object') s[k] = {};
    });
    if (!Array.isArray(s.mocks)) s.mocks = [];
    return s;
  }
  function save(s) { U().LS.set(KEY, s); }
  function sandbox() { return U().LS.get('lx.sandbox', {}) || {}; }

  var SECTIONS = [
    ['path', 'Path'], ['hands', 'Hands-on'], ['cases', 'Cases'], ['lessons', 'Lessons'], ['questions', 'Questions'], ['labs', 'Sim labs'],
    ['design', 'Design'], ['scripting', 'Scripting'], ['real', 'Real labs'], ['stories', 'Stories'],
    ['mock', 'Mock'], ['progress', 'Progress'], ['notes', 'Notes']
  ];
  var TOPICS = ['arch', 'net', 'trouble', 'config', 'delivery', 'design', 'behavior'];
  var ui = { section: null, detail: null, path: null, qTopic: 'all', qPri: 'all', mock: null, fu: {}, timer: null };

  /* ── data access ─────────────────────────────────────────────── */
  function list(k) { return (window.LX && LX[k]) || []; }
  function byId(k, id) { return list(k).filter(function (x) { return x.id === id; })[0] || null; }
  function lesson(id) { return byId('onsiteLessons', id); }
  function question(id) { return byId('onsiteQ', id); }
  function mission(id) { return (list('missions')).filter(function (m) { return m.id === id; })[0] || null; }
  function topicName(t) { return LX.track.catName(t, 'onsite'); }
  function feedback() { return list('onsiteFeedback'); }
  function qSorted() {
    return list('onsiteQ').slice().sort(function (a, b) {
      var ta = TOPICS.indexOf(a.topic), tb = TOPICS.indexOf(b.topic);
      return ta - tb || a.level - b.level || (a.id < b.id ? -1 : 1);
    });
  }

  /* A tiny, safe subset of markdown: paragraphs, "- " bullets, `code`, **bold**. */
  function inline(s) {
    return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  }
  function md(text) {
    return String(text || '').split(/\n{2,}/).map(function (block) {
      var lines = block.split('\n');
      if (lines.every(function (l) { return /^\s*- /.test(l); })) {
        return '<ul class="bullets">' + lines.map(function (l) { return '<li>' + inline(l.replace(/^\s*- /, '')) + '</li>'; }).join('') + '</ul>';
      }
      return '<p>' + lines.map(inline).join('<br>') + '</p>';
    }).join('');
  }
  function ul(items, fn) {
    if (!items || !items.length) return '';
    return '<ul class="bullets">' + items.map(function (x) { return '<li>' + (fn ? fn(x) : inline(x)) + '</li>'; }).join('') + '</ul>';
  }
  function label(t) { return '<p class="section-label">' + esc(t) + '</p>'; }
  function refs(r) {
    if (!r || !r.length) return '';
    return label('Official documentation') + ul(r, function (x) {
      return '<a href="' + esc(x.u) + '" target="_blank" rel="noopener">' + esc(x.t) + '</a>';
    });
  }
  function verifyNote(v) {
    return v ? '<p class="verify-note"><b>Check for your version:</b> ' + inline(v) + '</p>' : '';
  }
  /* focusable so a keyboard user can scroll a diagram wider than the screen */
  function scrollWrap(svg) {
    return '<div class="diagram-scroll" tabindex="0" role="group" aria-label="Diagram (scrolls sideways on small screens)">' + svg + '</div>';
  }
  function badge(t, cls) { return '<span class="badge' + (cls ? ' ' + cls : '') + '">' + esc(t) + '</span>'; }
  function back() { return '<button class="btn ghost small prep-back" data-prep-back>← Back</button>'; }

  /* ── evidence ────────────────────────────────────────────────── */
  function labModes(id) { var p = sandbox()[id]; return (p && p.modes) || {}; }
  function ev(kind, id, mode) {
    var s = st();
    switch (kind) {
      case 'lesson': return !!s.lessons[id];
      case 'question': var q = s.questions[id]; return !!(q && (q.answeredFirst || (q.ratings && q.ratings.length)));
      case 'lab':
        var m = labModes(id);
        return mode === 'independent' ? !!m.independent : !!(m.guided || m.independent);
      case 'design': return !!(s.design[id] && s.design[id].practiced);
      case 'script': return !!(s.scripting[id] && s.scripting[id].status === 'passing');
      case 'real': return !!s.real[id];
      case 'story': return !!(s.stories[id] && s.stories[id].reviewed);
      case 'mock': return s.mocks.some(function (x) { return x.preset === id; });
      case 'hands': return !!(s.hands[id] && s.hands[id].status);
      case 'walk': return !!(s.walks[id] && s.walks[id].reviewed);
      case 'case': return !!(s.cases[id] && s.cases[id].revealed);
    }
    return false;
  }
  function titleOf(kind, id) {
    var x;
    switch (kind) {
      case 'lesson': x = lesson(id); return x ? x.title : id;
      case 'question': x = question(id); return x ? x.q : id;
      case 'lab': x = mission(id); return x ? x.onsite.neutralTitle : id;
      case 'design': x = byId('onsiteDesign', id); return x ? x.title : id;
      case 'script': x = byId('onsiteScripting', id); return x ? x.title : id;
      case 'real': x = byId('onsiteReal', id); return x ? x.title : id;
      case 'story': x = byId('onsiteStories', id); return x ? x.title : id;
      case 'mock': x = byId('onsiteMock', id); return x ? x.title + ' (' + x.mins + ' min)' : id;
      case 'hands': x = byId('onsiteHands', id); return x ? x.title : id;
      case 'walk': x = byId('onsiteWalks', id); return x ? x.title : id;
      case 'case': x = byId('onsiteCases', id); return x ? x.title : id;
    }
    return id;
  }
  var KIND_WORD = { 'case': 'Case', walk: 'Walkthrough', hands: 'Hands-on', lesson: 'Lesson', question: 'Question', lab: 'Sim lab', design: 'Design', script: 'Python', real: 'Real lab', story: 'Story', mock: 'Mock' };

  /* ── priority from notes ─────────────────────────────────────── */
  var FORMAT_TOPICS = {
    design: ['design'], troubleshooting: ['trouble', 'net'], coding: ['design'],
    behavioral: ['behavior'], kubernetes: ['arch', 'net', 'trouble', 'config']
  };
  var FORMATS = [
    ['design', 'System design'], ['troubleshooting', 'Hands-on or verbal troubleshooting'],
    ['coding', 'Coding / scripting'], ['behavioral', 'Behavioral'], ['kubernetes', 'Kubernetes-specific deep dive']
  ];
  function boostOf(topic) {
    var s = st();
    if (s.boosts[topic] === 'up' || s.boosts[topic] === 'down') return s.boosts[topic];
    var up = false, down = false;
    Object.keys(FORMAT_TOPICS).forEach(function (f) {
      if (FORMAT_TOPICS[f].indexOf(topic) === -1) return;
      if (s.formats[f] === 'confirmed') up = true;
      if (s.formats[f] === 'excluded') down = true;
    });
    return up ? 'up' : down && !up ? 'down' : null;
  }

  /* ── shell ───────────────────────────────────────────────────── */
  function root() { return document.getElementById('view-prep'); }

  function render() {
    var el = root();
    if (!el) return;
    if (!list('onsiteQ').length) {
      el.innerHTML = '<p class="blurb">Loading the onsite track…</p>';
      return;
    }
    if (!ui.section) ui.section = (st().ui && st().ui.section) || 'path';
    /* a section whose content has not shipped yet is not shown at all */
    var sections = SECTIONS.filter(function (x) { return x[0] !== 'cases' || list('onsiteCases').length; });
    if (!sections.some(function (x) { return x[0] === ui.section; })) ui.section = 'path';
    var nav = '<div class="chips prep-nav" role="group" aria-label="Prep sections">' + sections.map(function (x) {
      var on = x[0] === ui.section;
      return '<button class="chip' + (on ? ' active' : '') + '" data-prep-section="' + x[0] + '" aria-pressed="' + on + '">' + esc(x[1]) + '</button>';
    }).join('') + '</div>';
    var body = '';
    try { body = SECTION_RENDER[ui.section](); }
    catch (e) { body = '<p class="empty">This section could not render: ' + esc(e.message) + '</p>'; }
    el.innerHTML = nav + '<div class="prep-body" id="prepBody">' + body + '</div>';
    if (ui.section === 'mock' && ui.mock && !ui.mock.done) startTimer(); else stopTimer();
  }

  function go(section, detail) {
    ui.section = section; ui.detail = detail || null;
    var s = st(); s.ui = { section: section }; save(s);
    render();
    var el = root();
    if (el) { window.scrollTo(0, 0); }
  }

  /* ── Path ────────────────────────────────────────────────────── */
  function dateLine() {
    var s = st();
    if (!s.date) return '<p class="muted">No interview date entered. Add it in <button class="linkish" data-prep-section="notes">Notes</button> when it is confirmed — nothing here is scheduled against a date you have not set.</p>';
    var d = new Date(s.date + 'T12:00:00'), now = new Date();
    var days = Math.round((d - new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12)) / 86400000);
    var when = days > 1 ? days + ' days until' : days === 1 ? '1 day until' : days === 0 ? 'Today is' : Math.abs(days) + ' days since';
    return '<p class="muted">' + esc(when) + ' the date you entered (' + esc(s.date) + (s.dateConfirmed ? ', confirmed' : ', not yet confirmed') + ').</p>';
  }
  /* optional items (e.g. Python, with no coding loop on the agenda) never
     hold a session open */
  function sessionState(sess) {
    var req = sess.items.filter(function (it) { return !it.optional; });
    var done = req.filter(function (it) { return ev(it.kind, it.id, it.mode); }).length;
    return { done: done, total: req.length, complete: done === req.length };
  }
  function suggested(sessions) {
    var byId_ = {}; sessions.forEach(function (x) { byId_[x.id] = x; });
    var ready = sessions.filter(function (x) {
      return !sessionState(x).complete && x.prereqs.every(function (p) { return sessionState(byId_[p]).complete; });
    });
    var rank = function (x) {
      var b = x.topics.map(boostOf);
      return (b.indexOf('up') !== -1 ? -1 : 0) + (b.every(function (y) { return y === 'down'; }) ? 1 : 0);
    };
    ready.sort(function (a, b) { return rank(a) - rank(b) || sessions.indexOf(a) - sessions.indexOf(b); });
    return ready[0] || sessions.filter(function (x) { return !sessionState(x).complete; })[0] || null;
  }
  function renderPath() {
    var P = LX.onsitePath || { essential: [], deep: [] };
    var which = ui.path || st().pathChoice || 'fundamentals';
    var sessions = P[which] || [];
    var next = suggested(sessions);
    var total = sessions.reduce(function (a, x) { return a + x.mins; }, 0);
    var dayNote = which === 'day' ? '<p class="verify-note">Your confirmed agenda, loop by loop. Times are as the invitation gave them (EDT) — confirm the local time with the recruiter. Each block gathers the practice for that conversation; work the troubleshooting and design blocks hardest.</p>' : '';
    return '<p class="blurb"><b>Onsite day</b> follows your confirmed agenda, one block per interview. <b>Fundamentals</b> follows the team\'s preparation note — navigating a cluster, deploying and running an app, exposing it, updating, configuring and troubleshooting — with hands-on practice on a real cluster. <b>Essential</b> and <b>Deep</b> are the broader routes. The exact onsite agenda is unknown — nothing here is an actual Gallatin question.</p>' +
      dateLine() +
      '<div class="seg-row" role="group" aria-label="Path">' +
        '<button class="chip' + (which === 'day' ? ' active' : '') + '" data-prep-path="day" aria-pressed="' + (which === 'day') + '">Onsite day · ' + (P.day || []).length + ' loops</button>' +
        '<button class="chip' + (which === 'fundamentals' ? ' active' : '') + '" data-prep-path="fundamentals" aria-pressed="' + (which === 'fundamentals') + '">Fundamentals · ' + (P.fundamentals || []).length + ' sessions</button>' +
        '<button class="chip' + (which === 'essential' ? ' active' : '') + '" data-prep-path="essential" aria-pressed="' + (which === 'essential') + '">Essential · ' + P.essential.length + ' sessions</button>' +
        '<button class="chip' + (which === 'deep' ? ' active' : '') + '" data-prep-path="deep" aria-pressed="' + (which === 'deep') + '">Deep · ' + P.deep.length + ' sessions</button>' +
      '</div>' +
      dayNote +
      '<p class="count">About ' + Math.round(total / 60) + ' hours in total. A session is complete when every item in it has evidence.</p>' +
      sessions.map(function (x, i) {
        var s = sessionState(x), isNext = next && next.id === x.id;
        var boosts = x.topics.map(boostOf);
        var pre = x.prereqs.map(function (p) {
          var ps = sessions.filter(function (y) { return y.id === p; })[0];
          return ps ? (sessions.indexOf(ps) + 1) : '';
        }).filter(Boolean);
        return '<article class="card path-card' + (isNext ? ' next' : '') + (s.complete ? ' complete' : '') + '">' +
          '<div class="card-main">' +
            (x.slot ? '<p class="muted small time-slot">' + esc(x.slot) + '</p>' : '') +
            '<p class="card-title plain">' + (x.slot ? '' : (i + 1) + '. ') + esc(x.title) + '</p>' +
            '<div class="card-meta">' + badge(x.priority) + badge('~' + x.mins + ' min' + (x.slot ? ' of prep' : '')) +
              badge(s.done + ' / ' + s.total + ' with evidence', s.complete ? 'done' : '') +
              (isNext ? badge('suggested next', 'next') : '') +
              (boosts.indexOf('up') !== -1 ? badge('raised by your notes', 'up') : '') +
              (boosts.length && boosts.every(function (b) { return b === 'down'; }) ? badge('lowered by your notes') : '') +
            '</div>' +
            '<p class="card-sum">' + esc(x.why) + (pre.length ? ' <span class="muted">Builds on session ' + pre.join(', ') + '.</span>' : '') + '</p>' +
            '<ul class="path-items">' + x.items.map(function (it) {
              var done = ev(it.kind, it.id, it.mode);
              return '<li><button class="path-item' + (done ? ' done' : '') + '" data-prep-open="' + it.kind + ':' + esc(it.id) + (it.mode ? ':' + it.mode : '') + '">' +
                '<span class="pi-tick" aria-hidden="true">' + (done ? '✓' : '○') + '</span>' +
                '<span class="pi-kind">' + esc(KIND_WORD[it.kind]) + (it.mode ? ' · ' + esc(it.mode) : '') + (it.optional ? ' · optional' : '') + '</span>' +
                '<span class="pi-title">' + esc(titleOf(it.kind, it.id)) + '</span>' +
                '<span class="sr-only">' + (done ? ' — has evidence' : ' — not yet') + '</span></button></li>';
            }).join('') + '</ul>' +
          '</div></article>';
      }).join('');
  }

  /* ── Hands-on (a real practice cluster) ──────────────────────── */
  function lines(x) { return Array.isArray(x) ? x.join('\n') : (x || ''); }
  function copyPre(text, labelTxt) {
    return '<div class="cmd-block"><pre class="term term-static">' + esc(text) + '</pre>' +
      '<button class="btn ghost small copy-btn" data-prep-copy="' + esc(text) + '" aria-label="Copy ' + esc(labelTxt || 'command') + '">Copy</button></div>';
  }
  function handsEnv() { return st().handsEnv || 'killercoda'; }
  function renderHandsList() {
    var s = st(), intro = LX.onsiteHandsIntro || {}, items = list('onsiteHands');
    return '<p class="blurb">Original scenarios for a <b>real</b> practice cluster, covering the fundamentals the team named: finding your way around, deploying, exposing, updating, configuring and fixing an app. Type the commands yourself; each task hides one way to do it until you ask.</p>' +
      '<p class="verify-note"><b>Safety:</b> ' + inline(intro.warning || '') + '</p>' +
      label('Where to run them') + ul(intro.envs || [], function (e) {
        return '<a href="' + esc(e.url) + '" target="_blank" rel="noopener">' + esc(e.name) + '</a> — ' + inline(e.note); }) +
      (intro.more ? '<p class="muted small">Extra reps: <a href="' + esc(intro.more.url) + '" target="_blank" rel="noopener">' + esc(intro.more.name) + '</a> — ' + inline(intro.more.note) + '</p>' : '') +
      '<p class="muted small">Looped cannot see your cluster, so "done" here is your own report. Each scenario ends with a copy-paste check that prints PASS or FAIL.</p>' +
      '<div class="list">' + items.map(function (h, i) {
        var r = s.hands[h.id] || {}, done = Object.keys(r.tasks || {}).filter(function (k) { return r.tasks[k]; }).length;
        return '<article class="card lab-card"><div class="card-head"><div class="card-main">' +
          '<p class="card-title plain">' + (i + 1) + '. ' + esc(h.title) + '</p><p class="card-sum">' + inline(h.goal) + '</p>' +
          '<div class="card-meta">' + badge('real cluster') + (h.beyond ? badge('beyond the team\'s focus') : '') + badge(h.priority) + badge('~' + h.mins + ' min') +
            badge(done + ' / ' + h.tasks.length + ' tasks') +
            (r.status === 'checked' ? badge('✓ PASS reported', 'done') : r.status === 'done' ? badge('✓ completed (reported)', 'done') : '') + '</div></div>' +
          '<button class="lab-go" data-prep-open="hands:' + esc(h.id) + '" aria-label="Open ' + esc(h.title) + '">▶</button></div></article>';
      }).join('') + '</div>';
  }
  function renderHands() {
    if (!ui.detail) return renderHandsList();
    var h = byId('onsiteHands', ui.detail);
    if (!h) return back() + '<p class="empty">Scenario not found.</p>';
    var s = st(), r = s.hands[h.id] || {}, env = handsEnv(), open_ = r.open || {}, hint = r.hint || {}, tasks = r.tasks || {};
    var envName = { killercoda: 'Killercoda', desktop: 'Docker Desktop' };
    return back() + '<p class="muted small">Hands-on · real cluster · practice scenario, not an actual interview task</p>' +
      '<h2 class="prep-h">' + esc(h.title) + '</h2>' +
      '<div class="card-meta">' + badge(h.priority) + badge('~' + h.mins + ' min') + badge(h.tasks.length + ' tasks') + '</div>' +
      '<p class="lead">' + inline(h.goal) + '</p>' +
      (h.beyond ? '<p class="verify-note">The team said not to worry about advanced topics such as etcd, so this scenario is not on the Fundamentals path. Do it after the fundamentals, if at all.</p>' : '') +
      '<div class="chips" role="group" aria-label="Your environment">' + ['killercoda', 'desktop'].map(function (e) {
        var on = env === e;
        return '<button class="chip' + (on ? ' active' : '') + '" data-prep-henv="' + e + '" aria-pressed="' + on + '">' + envName[e] + '</button>';
      }).join('') + '</div>' +
      '<p class="verify-note"><b>Before you start:</b> run <code>kubectl config current-context</code> and make sure it is your practice cluster. Every command below works in the <code>practice</code> namespace.</p>' +
      (h.setup && h.setup.length ? label('Start fresh (recreates what this scenario needs; safe to re-run)') + copyPre(h.setup.map(lines).join('\n'), 'setup commands') : '') +
      label('Tasks') + '<ol class="hands-tasks">' + h.tasks.map(function (t, i) {
        var shown = open_[i] || tasks[i], envNote = t.env && t.env[env];
        return '<li class="hands-task' + (tasks[i] ? ' done' : '') + '">' +
          '<p class="hands-do">' + inline(t.do) + '</p>' +
          (hint[i] ? '<p class="hint-line"><b>Hint:</b> ' + inline(t.hint) + '</p>' : '') +
          '<div class="hands-btns">' +
            (!hint[i] && !shown ? '<button class="btn ghost small" data-prep-hhint="' + esc(h.id) + ':' + i + '">Hint</button>' : '') +
            (!shown ? '<button class="btn ghost small" data-prep-hshow="' + esc(h.id) + ':' + i + '">Show a command</button>' : '') +
            '<button class="btn small' + (tasks[i] ? '' : ' primary') + '" data-prep-htask="' + esc(h.id) + ':' + i + '" aria-pressed="' + !!tasks[i] + '">' + (tasks[i] ? '✓ Done' : 'Mark done') + '</button>' +
          '</div>' +
          (shown ? copyPre(lines(t.cmd), 'command for task ' + (i + 1)) +
            '<p><b>You should see:</b> ' + inline(t.expect) + '</p>' +
            (envNote ? '<p class="muted small"><b>' + envName[env] + ':</b> ' + inline(envNote) + '</p>' : '') +
            '<p class="muted">' + inline(t.why) + '</p>' : '') +
          '</li>';
      }).join('') + '</ol>' +
      label('Check it (prints PASS or FAIL)') + copyPre(lines(h.check.cmd), 'check') +
      '<p class="muted small">Expected: <code>' + esc(h.check.expect) + '</code></p>' +
      label('Clean up') + copyPre(lines(h.cleanup), 'cleanup') +
      label('Say it in an interview') + '<div class="tip interview-answer">' + inline(h.talk) + '</div>' +
      '<div class="chip-links">' + (h.lessons || []).map(function (l) { return '<button class="chip small" data-prep-open="lesson:' + esc(l) + '">' + esc(titleOf('lesson', l)) + '</button>'; }).join('') +
        (h.sims || []).map(function (l) { return '<button class="chip small" data-prep-open="lab:' + esc(l) + '">Sim lab: ' + esc(titleOf('lab', l)) + '</button>'; }).join('') + '</div>' +
      related(h.questions) +
      label('Report (self-reported — Looped cannot see your cluster)') +
      '<div class="chips" role="group" aria-label="Report">' +
        [['done', 'I completed it'], ['checked', 'The check printed PASS']].map(function (o) {
          var on = r.status === o[0];
          return '<button class="chip' + (on ? ' active' : '') + '" data-prep-hstatus="' + esc(h.id) + ':' + o[0] + '" aria-pressed="' + on + '">' + esc(o[1]) + '</button>';
        }).join('') + '</div>';
  }

  /* ── Interviewer-led troubleshooting cases ────────────────────── */
  var TRACK_NAME = { linux: 'Linux', containers: 'Containers & Networking', aws: 'AWS' };
  function renderCasesList() {
    var s = st();
    return '<p class="blurb">Troubleshooting the way it often runs in an interview: the interviewer describes a symptom and holds the evidence; you ask for it one piece at a time. Choose what to ask for, say your hypothesis out loud, then reveal the cause and compare.</p>' +
      '<div class="verify-note"><b>With an interviewer on video:</b> narrate what you are checking and why before you ask; ask for evidence explicitly ("can you show me the pod events?"); summarise what you know every few minutes; say what would prove you wrong; keep fixes small and say how you would verify them.</div>' +
      '<p class="muted small">Evidence is example output written for practice — not an actual interview. Nothing is graded automatically.</p>' +
      '<div class="list">' + list('onsiteCases').map(function (c, i) {
        var r = s.cases[c.id] || {};
        return '<article class="card lab-card"><div class="card-head"><div class="card-main">' +
          '<p class="card-title plain">' + (i + 1) + '. ' + esc(c.title) + '</p><p class="card-sum">' + inline(c.opening) + '</p>' +
          '<div class="card-meta">' + badge(c.domain) + badge(['', 'foundation', 'working', 'advanced'][c.level] || '') + badge('~' + c.mins + ' min') +
            (r.revealed ? badge('✓ worked · ' + (r.asked || []).length + ' asks', 'done') : (r.asked && r.asked.length ? badge('in progress') : '')) + '</div></div>' +
          '<button class="lab-go" data-prep-open="case:' + esc(c.id) + '" aria-label="Open case">▶</button></div></article>';
      }).join('') + '</div>';
  }
  function renderCase(c) {
    var s = st(), r = s.cases[c.id] || {}, asked = r.asked || [], byAsk = {};
    c.asks.forEach(function (a) { byAsk[a.id] = a; });
    var groups = [];
    c.asks.forEach(function (a) { if (groups.indexOf(a.group) === -1) groups.push(a.group); });
    var h = back() + '<p class="muted small">Interviewer-led case · ' + esc(c.domain) + ' · practice, not an actual interview question</p>' +
      '<h2 class="prep-h">' + esc(c.title) + '</h2>' +
      '<div class="situation-box"><p><b>Interviewer:</b> ' + inline(c.opening) + '</p></div>' +
      (r.context ? '<p><b>The setup:</b> ' + inline(c.context) + '</p>' : '<button class="btn ghost small" data-prep-cctx="' + esc(c.id) + '">Ask about the setup</button>') +
      label('What you have asked for (' + asked.length + ')') +
      (asked.length ? asked.map(function (id, i) {
        var a = byAsk[id];
        return a ? '<div class="followup"><p><b>' + (i + 1) + '. You:</b> ' + inline(a.label) + '</p><pre class="term term-static evidence">' + esc(a.shows) + '</pre>' +
          (r.revealed ? '<p class="muted small">' + (a.key ? '<b>Key evidence.</b> ' : a.herring ? '<b>Plausible, but not the cause.</b> ' : '') + inline(a.reads) + '</p>' : '') + '</div>' : '';
      }).join('') : '<p class="muted">Nothing yet. Say what you would check first, and why — then ask.</p>');
    if (!r.revealed) {
      h += label('Ask the interviewer for…') + groups.map(function (g) {
        return '<p class="muted small case-group">' + esc(g) + '</p><div class="case-asks">' + c.asks.filter(function (a) { return a.group === g; }).map(function (a) {
          var used = asked.indexOf(a.id) !== -1;
          return '<button class="chip' + (used ? ' active' : '') + '" data-prep-cask="' + esc(c.id) + ':' + esc(a.id) + '"' + (used ? ' disabled aria-pressed="true"' : ' aria-pressed="false"') + '>' + esc(a.label) + '</button>';
        }).join('') + '</div>';
      }).join('') +
      '<label class="prep-label" for="caseHyp">Your hypothesis, what would disprove it, and — when you are ready — your fix and how you would verify it</label>' +
      '<textarea id="caseHyp" class="notes-input" rows="4" data-prep-chyp="' + esc(c.id) + '" placeholder="Say it out loud first. Not graded.">' + esc(r.hyp || '') + '</textarea>' +
      '<div class="done-btns"><button class="btn primary" data-prep-creveal="' + esc(c.id) + '">I have my answer — reveal the cause</button>' +
        (asked.length ? '<button class="btn ghost small" data-prep-creset="' + esc(c.id) + '">Start over</button>' : '') + '</div>';
      return h;
    }
    var keys = c.asks.filter(function (a) { return a.key; }), foundKeys = keys.filter(function (a) { return asked.indexOf(a.id) !== -1; });
    var herr = c.asks.filter(function (a) { return a.herring && asked.indexOf(a.id) !== -1; });
    h += label('The cause') + '<div class="tip">' + md(c.cause) + '</div>' +
      label('Why it happened') + md(c.mechanism) +
      label('A safe fix') + md(c.fix) + label('How to verify it') + md(c.verify) +
      label('How you worked (no score)') + '<dl class="scorecard">' +
        '<div><dt>Key evidence</dt><dd>You asked for ' + foundKeys.length + ' of ' + keys.length + ' pieces of key evidence, in ' + asked.length + ' asks.</dd></div>' +
        '<div><dt>Detours</dt><dd>' + (herr.length ? herr.length + ' plausible-but-irrelevant check' + (herr.length > 1 ? 's' : '') + ' — fine if brief and said out loud as ruling something out.' : 'None of the red herrings.') + '</dd></div>' +
      '</dl>' +
      '<p class="muted small">One efficient order (others are just as good): ' + c.efficient.map(function (id) { return byAsk[id] ? esc(byAsk[id].label) : id; }).join(' → ') + '</p>' +
      (r.hyp ? label('What you wrote') + '<div class="situation-box">' + md(r.hyp) + '</div>' : '') +
      label('Follow-ups the interviewer might add') + (c.followups || []).map(function (f) {
        return '<details class="brief-wrap"><summary>' + inline(f.q) + '</summary><div class="situation">' + md(f.guidance) + '</div></details>';
      }).join('') +
      label('Rubric') + '<div class="rubric"><p><b>Strong</b></p>' + ul(c.rubric.strong) + '<p><b>Also sound</b></p>' + ul(c.rubric.acceptable) + '<p><b>Red flags</b></p>' + ul(c.rubric.redFlags) + '</div>' +
      rateBlock('c', c.id, r.ratings || []) +
      ((c.alsoPractise || []).length ? label('Also practise in Looped') + (c.alsoPractise || []).map(function (x) {
        return '<p>' + inline(x.what) + ' <button class="btn ghost small" data-prep-track="' + esc(x.track) + '">Open the ' + esc(TRACK_NAME[x.track] || x.track) + ' track</button></p>';
      }).join('') : '') +
      '<div class="chip-links">' + (c.lessons || []).map(function (l) { return '<button class="chip small" data-prep-open="lesson:' + esc(l) + '">' + esc(titleOf('lesson', l)) + '</button>'; }).join('') + '</div>' +
      related(c.questions) + refs(c.refs) + verifyNote(c.verify_note) +
      '<div class="done-btns"><button class="btn" data-prep-creset="' + esc(c.id) + '">Work it again</button></div>';
    return h;
  }
  function renderCases() {
    if (ui.detail && byId('onsiteCases', ui.detail)) return renderCase(byId('onsiteCases', ui.detail));
    if (!list('onsiteCases').length) return '<p class="empty">The troubleshooting cases are not available in this build.</p>';
    return renderCasesList();
  }

  /* ── Lessons ─────────────────────────────────────────────────── */
  function renderLessons() {
    if (ui.detail) return renderLesson(lesson(ui.detail));
    var s = st();
    return '<p class="blurb">Foundations first. Each lesson explains the mechanism, how to observe it, and ends with a short self-check. Mark it studied when you can explain it without the page.</p>' +
      '<div class="list">' + list('onsiteLessons').map(function (l, i) {
        return '<article class="card lab-card" data-prep-open="lesson:' + esc(l.id) + '" tabindex="-1">' +
          '<div class="card-head"><div class="card-main"><p class="card-title plain">' + (i + 1) + '. ' + esc(l.title) + '</p>' +
          '<p class="card-sum">' + esc(l.summary) + '</p><div class="card-meta">' + badge(l.priority) + badge('~' + l.mins + ' min') +
          (l.diagram ? badge('diagram') : '') + (s.lessons[l.id] ? badge('✓ studied', 'done') : '') + '</div></div>' +
          '<button class="lab-go" data-prep-open="lesson:' + esc(l.id) + '" aria-label="Open ' + esc(l.title) + '">▶</button></div></article>';
      }).join('') + '</div>';
  }
  function renderLesson(l) {
    if (!l) return back() + '<p class="empty">Lesson not found.</p>';
    var s = st(), studied = !!s.lessons[l.id];
    return back() +
      '<h2 class="prep-h">' + esc(l.title) + '</h2>' +
      '<div class="card-meta">' + badge(l.priority) + badge('~' + l.mins + ' min') +
        (l.prereqs || []).map(function (p) { var x = lesson(p); return '<button class="chip small" data-prep-open="lesson:' + esc(p) + '">After: ' + esc(x ? x.title : p) + '</button>'; }).join('') + '</div>' +
      '<p class="lead">' + inline(l.summary) + '</p>' +
      (l.sections || []).map(function (sec, i) {
        return '<h3 class="prep-h3">' + esc(sec.h) + '</h3>' + md(sec.body) +
          (i === 0 && l.diagram ? '<figure class="diagram">' + scrollWrap(l.diagram) + (l.diagramCaption ? '<figcaption>' + inline(l.diagramCaption) + '</figcaption>' : '') + '</figure>' : '');
      }).join('') +
      label('Key points') + ul(l.keyPoints) +
      label('Common misconceptions') + ul(l.misconceptions) +
      (l.aws ? label('If you know AWS') + '<div class="tip"><p>' + inline(l.aws.analogy) + '</p><p><b>Where it breaks:</b> ' + inline(l.aws.breaks) + '</p></div>' : '') +
      label('Self-check') + (l.check || []).map(function (c) {
        return '<details class="brief-wrap"><summary>' + inline(c.q) + '</summary><div class="situation">' + md(c.a) + '</div></details>';
      }).join('') +
      related(l.questions, l.labs) + refs(l.refs) + verifyNote(l.verify) +
      '<div class="done-btns"><button class="btn' + (studied ? '' : ' primary') + '" data-prep-studied="' + esc(l.id) + '" aria-pressed="' + studied + '">' +
        (studied ? '✓ Studied — undo' : 'Mark studied') + '</button></div>' +
      '<p class="muted small">"Studied" is your own mark. It records that you read and could explain the lesson — the lowest evidence tier.</p>';
  }
  function related(qs, labs) {
    var out = '';
    if (qs && qs.length) out += label('Practise with') + '<div class="chip-links">' + qs.map(function (id) {
      var q = question(id); return q ? '<button class="chip" data-prep-open="question:' + esc(id) + '">' + esc(short(q.q)) + '</button>' : '';
    }).join('') + '</div>';
    if (labs && labs.length) out += '<div class="chip-links">' + labs.map(function (id) {
      var m = mission(id); return m ? '<button class="chip" data-prep-open="lab:' + esc(id) + '">Sim lab: ' + esc(m.onsite.neutralTitle) + '</button>' : '';
    }).join('') + '</div>';
    return out;
  }
  function short(t) { return t.length > 64 ? t.slice(0, 61) + '…' : t; }

  /* ── Questions ───────────────────────────────────────────────── */
  function renderQuestions() {
    if (ui.detail) return renderQuestion(question(ui.detail));
    var s = st();
    var qs = qSorted().filter(function (q) {
      return (ui.qTopic === 'all' || q.topic === ui.qTopic) && (ui.qPri === 'all' || q.priority === ui.qPri);
    });
    return '<p class="blurb">Answer in your own words first — out loud or in the box. Answers stay hidden until you ask. Nothing is auto-graded: compare with the rubric and rate yourself honestly.</p>' +
      '<div class="chips" role="group" aria-label="Filter by topic">' + ['all'].concat(TOPICS).map(function (t) {
        var on = ui.qTopic === t;
        return '<button class="chip' + (on ? ' active' : '') + '" data-prep-qtopic="' + t + '" aria-pressed="' + on + '">' + esc(t === 'all' ? 'All topics' : topicName(t)) + '</button>';
      }).join('') + '</div>' +
      '<div class="chips levels" role="group" aria-label="Filter by priority">' + ['all', 'P0', 'P1', 'P2', 'P3'].map(function (p) {
        var on = ui.qPri === p;
        return '<button class="chip' + (on ? ' active' : '') + '" data-prep-qpri="' + p + '" aria-pressed="' + on + '">' + (p === 'all' ? 'All priorities' : p) + '</button>';
      }).join('') + '</div>' +
      '<p class="count">' + qs.length + ' question' + (qs.length === 1 ? '' : 's') + '</p>' +
      '<div class="list">' + qs.map(function (q) {
        var r = s.questions[q.id] || {};
        return '<article class="card lab-card"><div class="card-head"><div class="card-main">' +
          '<p class="card-title plain">' + esc(q.q) + '</p>' +
          '<div class="card-meta">' + badge(q.priority) + badge(topicName(q.topic)) + badge(['', 'foundation', 'working', 'advanced'][q.level] || '') +
            badge('~' + q.mins + ' min') +
            (r.answeredFirst ? badge('✓ answered first', 'done') : r.revealed ? badge('revealed') : '') +
            (r.ratings && r.ratings.length ? badge('rated') : '') + '</div></div>' +
          '<button class="lab-go" data-prep-open="question:' + esc(q.id) + '" aria-label="Open question">▶</button></div></article>';
      }).join('') + '</div>';
  }
  function renderQuestion(q) {
    if (!q) return back() + '<p class="empty">Question not found.</p>';
    var s = st(), r = s.questions[q.id] || {}, shown = !!r.revealed;
    var fuIdx = ui.fu[q.id] || 0;
    var h = back() +
      '<p class="muted small">' + esc(q.id) + ' · practice question — not an actual interview question</p>' +
      '<h2 class="prep-h">' + esc(q.q) + '</h2>' +
      '<div class="card-meta">' + badge(q.priority) + badge(topicName(q.topic)) + badge(['', 'foundation', 'working', 'advanced'][q.level] || '') + badge('~' + q.mins + ' min to answer') + '</div>' +
      (q.prereqs && q.prereqs.length ? '<div class="chip-links">' + q.prereqs.map(function (p) {
        var kind = p.indexOf('les-') === 0 ? 'lesson' : 'question';
        return '<button class="chip small" data-prep-open="' + kind + ':' + esc(p) + '">Prerequisite: ' + esc(short(titleOf(kind, p))) + '</button>'; }).join('') + '</div>' : '') +
      (q.context ? '<div class="situation-box">' + md(q.context) + '</div>' : '') +
      '<label class="prep-label" for="prepOwn">Your answer, in your own words</label>' +
      '<textarea id="prepOwn" class="notes-input" rows="6" data-prep-own="' + esc(q.id) + '" placeholder="Say it out loud, then jot the outline here. Not graded.">' + esc(r.text || '') + '</textarea>' +
      '<div class="done-btns">' +
        (shown ? '' : '<button class="btn primary" data-prep-reveal="' + esc(q.id) + '">Reveal the model answer</button>') +
        '<button class="btn ghost small" data-prep-saveown="' + esc(q.id) + '">Save my answer</button></div>' +
      '<details class="brief-wrap"><summary>What the interviewer is evaluating</summary><div class="situation">' + ul(q.evaluates) + '</div></details>';
    if (!shown) return h + '<p class="muted small">The answer is hidden until you ask. Writing something first counts as "answered before revealing" in your progress.</p>';
    h += label('A concise spoken answer') + '<div class="tip interview-answer">' + md(q.spoken) + '</div>' +
      '<details class="brief-wrap"><summary>Deeper explanation</summary><div class="situation">' + md(q.deep) + '</div></details>' +
      label('Follow-ups (one at a time, as an interviewer would)') +
      (q.followups || []).slice(0, fuIdx + 1).map(function (f, i) {
        return '<div class="followup"><p><b>Follow-up ' + (i + 1) + ' of ' + q.followups.length + ':</b> ' + inline(f.q) + '</p>' +
          '<details class="brief-wrap"><summary>Guidance</summary><div class="situation">' + md(f.guidance) + '</div></details></div>';
      }).join('') +
      (fuIdx + 1 < (q.followups || []).length ? '<button class="btn small" data-prep-fu="' + esc(q.id) + '">Next follow-up</button>' : '') +
      label('Misconceptions') + ul(q.misconceptions) +
      label('Weak-answer patterns') + ul(q.weak) +
      (q.evidence ? label('Evidence you might show') + '<pre class="term term-static evidence">' + esc(q.evidence) + '</pre>' : '') +
      label('Rubric') + '<div class="rubric">' +
        '<p><b>A strong answer</b></p>' + ul((q.rubric || {}).strong) +
        '<p><b>Also sound — different approaches that should score well</b></p>' + ul((q.rubric || {}).acceptable) +
        '<p><b>Red flags</b></p>' + ul((q.rubric || {}).redFlags) + '</div>' +
      (q.aws ? label('From AWS') + '<div class="tip"><p>' + inline(q.aws.analogy) + '</p><p><b>Where it breaks:</b> ' + inline(q.aws.breaks) + '</p></div>' : '') +
      refs(q.refs) + verifyNote(q.verify) +
      related(null, q.labs) +
      rateBlock('q', q.id, r.ratings || []);
    return h;
  }
  function rateBlock(kind, id, current) {
    return label('Rate your answer against the rubric (self-assessed)') +
      '<div class="chips rate" role="group" aria-label="Self-assessment">' + feedback().map(function (f) {
        var on = current.indexOf(f.id) !== -1;
        return '<button class="chip' + (on ? ' active' : '') + (f.weak ? ' weak' : ' strong') + '" data-prep-rate="' + kind + ':' + esc(id) + ':' + f.id + '" aria-pressed="' + on + '" title="' + esc(f.tip) + '">' + esc(f.label) + '</button>';
      }).join('') + '</div>' +
      '<p class="muted small">Pick every one that applies. The first five mark something to revisit; the last two are strengths. Nothing checks your text automatically.</p>';
  }

  /* ── Sim labs ────────────────────────────────────────────────── */
  function renderLabs() {
    var labs = list('missions').filter(function (m) { return m.track === 'onsite'; });
    return '<p class="blurb">Ten incident labs on a <b>simulated</b> cluster with a bounded kubectl command set. <b>Guided</b> shows the ticket as written and every objective; <b>Independent</b> hides the cause and the objectives. Completion is simulation evidence — it shows reasoning, not production experience.</p>' +
      '<div class="list">' + labs.map(function (m, i) {
        var md_ = labModes(m.id);
        return '<article class="card lab-card"><div class="card-head"><div class="card-main">' +
          '<p class="card-title plain">' + (i + 1) + '. ' + esc(m.onsite.neutralTitle) + '</p>' +
          '<p class="card-sum">' + esc(m.onsite.impact) + '</p>' +
          '<div class="card-meta">' + badge('simulation', 'sim') + badge(m.level) + badge('~' + m.mins + ' min') +
            (md_.guided ? badge('✓ guided', 'done') : '') +
            (md_.independent ? badge('✓ independent' + (md_.independent.unaided ? ' · no hints' : ''), 'done') : '') +
            (byId('onsiteReal', m.id.replace('lab', 'real')) ? badge('has a real kind lab') : '') + '</div></div>' +
          '<button class="lab-go" data-prep-open="lab:' + esc(m.id) + '" aria-label="Open lab">▶</button></div></article>';
      }).join('') + '</div>';
  }

  /* ── Design ──────────────────────────────────────────────────── */
  function renderDesigns() {
    if (ui.detail && byId('onsiteWalks', ui.detail)) return renderWalk(byId('onsiteWalks', ui.detail));
    if (ui.detail) return renderDesign(byId('onsiteDesign', ui.detail));
    var s = st();
    return label('Your own architecture') +
      '<p class="muted">Design interviews often start with "walk me through something you built". These use only the facts you have given; you fill in the rest.</p>' +
      '<div class="list">' + list('onsiteWalks').map(function (w) {
        var r = s.walks[w.id] || {};
        return '<article class="card lab-card"><div class="card-head"><div class="card-main">' +
          '<p class="card-title plain">' + esc(w.title) + '</p><p class="card-sum">' + esc(w.prompt) + '</p>' +
          '<div class="card-meta">' + badge('walkthrough') + badge('~' + w.mins + ' min to tell') + (r.reviewed ? badge('✓ rehearsed', 'done') : '') + '</div></div>' +
          '<button class="lab-go" data-prep-open="walk:' + esc(w.id) + '" aria-label="Open walkthrough">▶</button></div></article>';
      }).join('') + '</div>' +
      label('Design problems') +
      '<p class="blurb">Interviewer-led design practice. Start with requirements and clarifying questions, then design, then handle the constraints the interviewer adds. The example is one strong answer, not the only one.</p>' +
      '<div class="list">' + list('onsiteDesign').map(function (d) {
        var r = s.design[d.id] || {};
        return '<article class="card lab-card"><div class="card-head"><div class="card-main">' +
          '<p class="card-title plain">' + esc(d.title) + '</p><p class="card-sum">' + esc(short(d.brief.replace(/\n/g, ' '))) + '</p>' +
          '<div class="card-meta">' + badge(d.priority) + badge('~' + d.mins + ' min') + (r.practiced ? badge('✓ practised', 'done') : '') + '</div></div>' +
          '<button class="lab-go" data-prep-open="design:' + esc(d.id) + '" aria-label="Open scenario">▶</button></div></article>';
      }).join('') + '</div>';
  }
  function renderDesign(d) {
    if (!d) return back() + '<p class="empty">Scenario not found.</p>';
    var s = st(), r = s.design[d.id] || {}, step = r.step || 0, rev = r.reveals || 0;
    function stepBtn(n, text) { return step < n ? '<button class="btn primary" data-prep-dstep="' + esc(d.id) + ':' + n + '">' + esc(text) + '</button>' : ''; }
    var h = back() + '<h2 class="prep-h">' + esc(d.title) + '</h2>' +
      '<div class="card-meta">' + badge(d.priority) + badge('~' + d.mins + ' min') + '</div>' +
      label('The brief') + '<div class="situation-box">' + md(d.brief) + '</div>' +
      label('Suggested pacing') +
      '<div class="chips" role="group" aria-label="Interview length">' + [['60', '60 minutes (your agenda)'], ['45', '45 minutes']].map(function (o) {
        var on = (s.designPace || '60') === o[0];
        return '<button class="chip' + (on ? ' active' : '') + '" data-prep-pace="' + o[0] + '" aria-pressed="' + on + '">' + o[1] + '</button>';
      }).join('') + '</div>' +
      '<ol class="steps-why">' + (((s.designPace || '60') === '60' && d.stages60) ? d.stages60 : d.stages).map(function (x) { return '<li>' + inline(x) + '</li>'; }).join('') + '</ol>' +
      '<label class="prep-label" for="prepDesignNotes">Your clarifying questions and design notes</label>' +
      '<textarea id="prepDesignNotes" class="notes-input" rows="6" data-prep-dnotes="' + esc(d.id) + '" placeholder="Requirements first: who, what, how many, what must never happen, what does done look like?">' + esc(r.notes || '') + '</textarea>' +
      '<div class="done-btns">' + stepBtn(1, 'Compare my clarifying questions') + '<button class="btn ghost small" data-prep-dsave="' + esc(d.id) + '">Save notes</button></div>';
    if (step >= 1) {
      h += label('Clarifying questions worth asking') + ul(d.clarify, function (c) { return '<b>' + inline(c.q) + '</b><br><span class="muted">' + inline(c.why) + '</span>'; }) +
        label('Assumptions for practice') + ul(d.assumptions) + label('Constraints') + ul(d.constraints) +
        '<div class="done-btns">' + stepBtn(2, 'I have sketched a design — show the interviewer\'s follow-ups') + '</div>';
    }
    if (step >= 2) {
      h += label('The interviewer adds constraints') + d.reveals.slice(0, rev + 1).map(function (x, i) {
        return '<div class="followup"><p class="muted small">' + esc(x.after) + '</p><p><b>Constraint ' + (i + 1) + ':</b> ' + inline(x.constraint) + '</p>' +
          '<details class="brief-wrap"><summary>What a strong response does</summary><div class="situation">' + md(x.guidance) + '</div></details></div>';
      }).join('') +
      (rev + 1 < d.reveals.length ? '<button class="btn small" data-prep-dreveal="' + esc(d.id) + '">Next constraint</button>' : '') +
      '<div class="done-btns">' + stepBtn(3, 'Show a reference architecture and tradeoffs') + '</div>';
    }
    if (step >= 3) {
      h += label('One reasonable architecture') + md(d.architecture.summary) +
        (d.architecture.diagram ? '<figure class="diagram">' + scrollWrap(d.architecture.diagram) + (d.architecture.caption ? '<figcaption>' + inline(d.architecture.caption) + '</figcaption>' : '') + '</figure>' : '') +
        ul(d.architecture.components, function (c) { return '<b>' + esc(c.name) + '</b> — ' + inline(c.resp); }) +
        label('Other reasonable approaches') + d.approaches.map(function (a) {
          return '<div class="followup"><p><b>' + esc(a.name) + '</b> — ' + inline(a.how) + '</p>' +
            '<p class="muted small">Pros</p>' + ul(a.pros) + '<p class="muted small">Cons</p>' + ul(a.cons) + '<p><i>' + inline(a.when) + '</i></p></div>';
        }).join('') +
        label('Failure modes') + ul(d.failureModes, function (f) { return '<b>' + inline(f.mode) + '</b><br>Detect: ' + inline(f.detect) + '<br>Mitigate: ' + inline(f.mitigate); }) +
        label('Identity and secrets') + ul(d.identity) + label('Observability') + ul(d.observability) +
        label('Deployment and rollback') + ul(d.deploy) + label('Recovery and data integrity') + ul(d.recovery) +
        label('Operational ownership') + ul(d.ownership) +
        label('Rubric') + '<div class="rubric"><p><b>Strong</b></p>' + ul(d.rubric.strong) + '<p><b>Also sound</b></p>' + ul(d.rubric.acceptable) + '<p><b>Red flags</b></p>' + ul(d.rubric.redFlags) + '</div>' +
        '<details class="brief-wrap"><summary>A strong example explanation (one of several good answers)</summary><div class="situation">' + md(d.example) + '</div></details>' +
        related(d.questions) + refs(d.refs) + verifyNote(d.verify) +
        rateBlock('d', d.id, r.ratings || []) +
        '<div class="done-btns"><button class="btn' + (r.practiced ? '' : ' primary') + '" data-prep-dpracticed="' + esc(d.id) + '" aria-pressed="' + !!r.practiced + '">' + (r.practiced ? '✓ Practised — undo' : 'Mark practised') + '</button></div>';
    }
    return h;
  }

  function renderWalk(w) {
    var r = st().walks[w.id] || {}, f = r.fields || {}, n = 0;
    function fieldsOf(sec, si) {
      return (sec.fields || []).map(function (lab, fi) {
        var key = si + '.' + fi, idn = 'walk-' + esc(w.id) + '-' + si + '-' + fi;
        return '<label class="prep-label" for="' + idn + '">' + inline(lab) + '</label>' +
          '<textarea id="' + idn + '" class="notes-input" rows="2" data-prep-walk="' + esc(w.id) + '|' + key + '">' + esc(f[key] || '') + '</textarea>';
      }).join('');
    }
    return back() + '<p class="muted small">Your own architecture · practise it out loud</p>' +
      '<h2 class="prep-h">' + esc(w.title) + '</h2>' +
      '<div class="situation-box"><p><b>The prompt:</b> "' + inline(w.prompt) + '"</p><p class="muted">' + inline(w.aim) + '</p></div>' +
      '<p class="muted small">Your notes are stored only in this browser (and in any export you make). Leave a blank rather than guess.</p>' +
      w.sections.map(function (sec, si) {
        return '<h3 class="prep-h3">' + esc(sec.h) + '</h3><p>' + inline(sec.guide) + '</p>' +
          (sec.layers ? '<ol class="steps-why">' + sec.layers.map(function (l) { return '<li><b>' + esc(l.name) + '</b> — ' + inline(l.say) + '</li>'; }).join('') + '</ol>' : '') +
          (sec.mapping ? ul(sec.mapping) : '') +
          (sec.stories ? '<div class="chip-links">' + sec.stories.map(function (id) { return '<button class="chip small" data-prep-open="story:' + esc(id) + '">Story: ' + esc(titleOf('story', id)) + '</button>'; }).join('') + '</div>' : '') +
          fieldsOf(sec, si);
      }).join('') +
      label('Questions the interviewer is likely to ask') + w.probes.map(function (p) {
        return '<details class="brief-wrap"><summary>' + inline(p.q) + '</summary><div class="situation">' + md(p.guidance) + '</div></details>';
      }).join('') +
      label('How this goes wrong') + ul(w.pitfalls) +
      '<div class="chip-links">' + (w.lessons || []).map(function (l) { return '<button class="chip small" data-prep-open="lesson:' + esc(l) + '">' + esc(titleOf('lesson', l)) + '</button>'; }).join('') + '</div>' +
      related(w.questions) +
      '<div class="done-btns"><button class="btn ghost small" data-prep-walksave="' + esc(w.id) + '">Save notes</button>' +
        '<button class="btn' + (r.reviewed ? '' : ' primary') + '" data-prep-walkrev="' + esc(w.id) + '" aria-pressed="' + !!r.reviewed + '">' + (r.reviewed ? '✓ Rehearsed — undo' : 'Mark rehearsed out loud') + '</button></div>';
  }

  /* ── Scripting ───────────────────────────────────────────────── */
  function renderScripting() {
    if (ui.detail) return renderScript(byId('onsiteScripting', ui.detail));
    var s = st();
    return '<p class="verify-note">Your agenda has no coding interview, so these are optional — do them only once the troubleshooting and design blocks feel solid.</p>' +
      '<p class="blurb">Three Python exercises from infrastructure work, with fixtures and tests in <code>labs/python/</code>. Run them on your machine; the app cannot run them, so "tests pass" is your report.</p>' +
      '<div class="list">' + list('onsiteScripting').map(function (x) {
        var r = s.scripting[x.id] || {};
        return '<article class="card lab-card"><div class="card-head"><div class="card-main">' +
          '<p class="card-title plain">' + esc(x.title) + '</p><p class="card-sum">' + esc(x.goal) + '</p>' +
          '<div class="card-meta">' + badge(x.priority) + badge('~' + x.mins + ' min') +
            (r.status === 'passing' ? badge('✓ tests pass (self-reported)', 'done') : r.status === 'started' ? badge('started') : '') + '</div></div>' +
          '<button class="lab-go" data-prep-open="script:' + esc(x.id) + '" aria-label="Open exercise">▶</button></div></article>';
      }).join('') + '</div>';
  }
  function renderScript(x) {
    if (!x) return back() + '<p class="empty">Exercise not found.</p>';
    var s = st(), r = s.scripting[x.id] || {}, hints = r.hints || 0;
    return back() + '<h2 class="prep-h">' + esc(x.title) + '</h2>' +
      '<div class="card-meta">' + badge(x.priority) + badge('~' + x.mins + ' min') + badge(x.dir) + '</div>' +
      md(x.statement) +
      label('Fixtures') + ul(x.fixtures) + label('Expected behaviour') + ul(x.expected) +
      label('Run the tests') + '<pre class="term term-static">' + esc(x.run.join('\n')) + '</pre>' +
      label('Hints') + x.hints.slice(0, hints).map(function (h, i) { return '<p class="hint-line"><b>Hint ' + (i + 1) + ':</b> ' + inline(h) + '</p>'; }).join('') +
      (hints < x.hints.length ? '<button class="btn small" data-prep-shint="' + esc(x.id) + '">Show hint ' + (hints + 1) + ' of ' + x.hints.length + '</button>' : '') +
      label('Reference solution') +
      (r.solution ? '<pre class="term term-static code">' + esc(x.solution) + '</pre>' + label('How it works') + md(x.explanation)
        : '<p class="muted">Hidden until you ask — try the exercise first.</p><button class="btn small" data-prep-ssol="' + esc(x.id) + '">Show the solution</button>') +
      (x.concepts && x.concepts.length ? '<div class="chip-links">' + x.concepts.map(function (c) { return '<button class="chip small" data-prep-open="lesson:' + esc(c) + '">' + esc(titleOf('lesson', c)) + '</button>'; }).join('') + '</div>' : '') +
      (x.note ? '<p class="muted">' + inline(x.note) + '</p>' : '') +
      label('Your status (self-reported)') + '<div class="chips" role="group" aria-label="Exercise status">' +
        [['started', 'Started'], ['passing', 'My tests pass locally']].map(function (o) {
          var on = r.status === o[0];
          return '<button class="chip' + (on ? ' active' : '') + '" data-prep-sstatus="' + esc(x.id) + ':' + o[0] + '" aria-pressed="' + on + '">' + esc(o[1]) + '</button>';
        }).join('') + '</div>';
  }

  /* ── Real labs ───────────────────────────────────────────────── */
  function renderReal() {
    if (ui.detail) return renderRealLab(byId('onsiteReal', ui.detail));
    var s = st(), items = list('onsiteReal');
    if (!items.length) return '<p class="empty">The real-lab index is not available in this build.</p>';
    return '<p class="blurb">Real Kubernetes on your Mac with <b>kind</b>: a dedicated cluster (<code>looped-onsite</code>), namespace (<code>looped-lab</code>) and context (<code>kind-looped-onsite</code>). Every script passes that context explicitly and refuses any other. Start with <code>labs/kind/README.md</code>.</p>' +
      '<p class="muted small">The app cannot see your cluster, so completion here is always <b>self-reported</b> — including when you report that a verify script passed. A local lab is practice, not production experience.</p>' +
      '<div class="list">' + items.map(function (x) {
        var r = s.real[x.id];
        return '<article class="card lab-card"><div class="card-head"><div class="card-main">' +
          '<p class="card-title plain">' + esc(x.title) + '</p><p class="card-sum">' + esc(x.objective) + '</p>' +
          '<div class="card-meta">' + badge('real kind lab') + badge('~' + x.mins + ' min') +
            badge(x.executed && x.executed.status === 'executed' ? 'executed in development (Linux)' : 'not executed in development') +
            (r ? badge(r.status === 'verified' ? '✓ verify PASS reported' : '✓ completed (reported)', 'done') : '') + '</div></div>' +
          '<button class="lab-go" data-prep-open="real:' + esc(x.id) + '" aria-label="Open real lab">▶</button></div></article>';
      }).join('') + '</div>';
  }
  function renderRealLab(x) {
    if (!x) return back() + '<p class="empty">Lab not found.</p>';
    var r = st().real[x.id] || {};
    return back() + '<h2 class="prep-h">' + esc(x.title) + '</h2>' +
      '<div class="card-meta">' + badge(x.priority) + badge('~' + x.mins + ' min') + badge(x.dir) + '</div>' +
      '<p class="lead">' + inline(x.objective) + '</p>' +
      (x.simulated ? '<p class="verify-note"><b>What this lab simulates:</b> ' + inline(x.simulated) + '</p>' : '') +
      label('Steps (run from the repository root)') + '<ol class="steps-why">' + x.steps.map(function (st_) {
        return '<li>' + inline(st_.t) + (st_.cmd ? '<pre class="term term-static">' + esc(st_.cmd) + '</pre>' : '') + '</li>';
      }).join('') + '</ol>' +
      label('What you should observe') + ul(x.expected) + label('Timing caveats') + ul(x.timing) +
      label('Independent check') + '<pre class="term term-static">' + esc(x.verify) + '</pre>' +
      label('Lab versus production') + md(x.production) +
      (x.executed ? '<p class="muted small">In development: ' + esc(x.executed.status === 'executed' ? 'executed' : 'not executed') + ' — ' + esc(x.executed.where || '') + '. ' + esc(x.executed.note || '') + '</p>' : '') +
      '<div class="chip-links">' + (x.sim ? '<button class="chip" data-prep-open="lab:' + esc(x.sim) + '">Simulated version</button>' : '') +
        (x.lessons || []).map(function (l) { return '<button class="chip small" data-prep-open="lesson:' + esc(l) + '">' + esc(titleOf('lesson', l)) + '</button>'; }).join('') + '</div>' +
      refs(x.refs) +
      label('Report (self-reported — the app cannot observe your cluster)') +
      '<div class="chips" role="group" aria-label="Report">' +
        [['done', 'I completed this lab'], ['verified', 'verify.sh printed PASS']].map(function (o) {
          var on = r.status === o[0];
          return '<button class="chip' + (on ? ' active' : '') + '" data-prep-real="' + esc(x.id) + ':' + o[0] + '" aria-pressed="' + on + '">' + esc(o[1]) + '</button>';
        }).join('') +
        (r.status ? '<button class="chip" data-prep-real="' + esc(x.id) + ':clear">Clear report</button>' : '') + '</div>';
  }

  /* ── Stories ─────────────────────────────────────────────────── */
  function renderStories() {
    if (ui.detail) return renderStory(byId('onsiteStories', ui.detail));
    var s = st();
    return '<p class="blurb">Your five experiences, bridged to Kubernetes. The facts are exactly the sanitised versions you provided; anything they do not say — your role, outcomes, numbers — is a blank for you to fill, stored only in this browser.</p>' +
      '<div class="list">' + list('onsiteStories').map(function (x) {
        var r = s.stories[x.id] || {}, filled = Object.keys(r.fields || {}).filter(function (k) { return (r.fields[k] || '').trim(); }).length;
        return '<article class="card lab-card"><div class="card-head"><div class="card-main">' +
          '<p class="card-title plain">' + esc(x.title) + '</p><p class="card-sum">' + esc(x.facts) + '</p>' +
          '<div class="card-meta">' + badge(filled + ' / ' + x.supply.length + ' details supplied') + (r.reviewed ? badge('✓ reviewed', 'done') : '') + '</div></div>' +
          '<button class="lab-go" data-prep-open="story:' + esc(x.id) + '" aria-label="Open story">▶</button></div></article>';
      }).join('') + '</div>';
  }
  function renderStory(x) {
    if (!x) return back() + '<p class="empty">Story not found.</p>';
    var r = st().stories[x.id] || {}, f = r.fields || {};
    return back() + '<h2 class="prep-h">' + esc(x.title) + '</h2>' +
      label('The facts (as you provided them)') + '<blockquote class="facts">' + esc(x.facts) + '</blockquote>' +
      label('Kubernetes concepts it connects to') + ul(x.concepts, function (c) { return '<b>' + inline(c.c) + '</b> — ' + inline(c.why); }) +
      label('What transfers directly') + ul(x.transfers) +
      label('What needs new Kubernetes-specific knowledge') + ul(x.newKnowledge) +
      label('A concise answer structure') + '<ol class="steps-why">' + x.structure.map(function (s_) { return '<li>' + inline(s_) + '</li>'; }).join('') + '</ol>' +
      label('Likely follow-ups') + (x.followups || []).map(function (fu) {
        return '<details class="brief-wrap"><summary>' + inline(fu.q) + '</summary><div class="situation">' + md(fu.guidance) + '</div></details>';
      }).join('') +
      label('How this could go wrong') + ul(x.pitfalls) +
      label('Details you must supply before claiming an outcome') +
      '<p class="muted small">Stored only in this browser (and in any export you make). Leave a blank rather than guess.</p>' +
      x.supply.map(function (sp, i) {
        return '<label class="prep-label" for="story-' + esc(x.id) + '-' + i + '">' + inline(sp) + '</label>' +
          '<textarea id="story-' + esc(x.id) + '-' + i + '" class="notes-input" rows="2" data-prep-story="' + esc(x.id) + ':' + i + '">' + esc(f[i] || '') + '</textarea>';
      }).join('') +
      '<div class="chip-links">' + (x.questions || []).map(function (q) { return '<button class="chip" data-prep-open="question:' + esc(q) + '">' + esc(short(titleOf('question', q))) + '</button>'; }).join('') + '</div>' +
      verifyNote(x.verify) +
      '<div class="done-btns"><button class="btn ghost small" data-prep-storysave="' + esc(x.id) + '">Save details</button>' +
        '<button class="btn' + (r.reviewed ? '' : ' primary') + '" data-prep-storyrev="' + esc(x.id) + '" aria-pressed="' + !!r.reviewed + '">' + (r.reviewed ? '✓ Reviewed — undo' : 'Mark reviewed') + '</button></div>';
  }

  /* ── Mock interview ──────────────────────────────────────────── */
  function pickItems(preset) {
    var seen = {};
    st().mocks.forEach(function (m) { (m.items || []).forEach(function (it) { seen[it.id] = (seen[it.id] || 0) + 1; }); });
    var used = {};
    return preset.slots.map(function (slot) {
      var pool = slot.pool.filter(function (id) { return !used[id]; });
      pool.sort(function (a, b) { return (seen[a] || 0) - (seen[b] || 0) || slot.pool.indexOf(a) - slot.pool.indexOf(b); });
      used[pool[0]] = true;
      return { kind: slot.kind, id: pool[0], ratings: [], fu: 0, shown: false, hint: false, note: '' };
    });
  }
  function renderMock() {
    var m = ui.mock;
    if (m && !m.done) return renderMockPrompt(m);
    if (m && m.done) return renderMockSummary(m);
    var hist = st().mocks.slice(-5).reverse();
    return '<p class="blurb">Practice sessions, one prompt at a time: answer out loud, ask for a follow-up or hint, reveal, then rate yourself. There is no automatic evaluation and no score — the value is saying it under time.</p>' +
      '<p class="muted small">These are practice shapes. The real onsite format is unknown; update Notes if the recruiter clarifies it.</p>' +
      '<div class="list">' + list('onsiteMock').map(function (p) {
        return '<article class="card"><div class="card-main"><p class="card-title plain">' + esc(p.title) + ' · ' + p.mins + ' min</p>' +
          '<p class="card-sum">' + esc(p.blurb) + '</p><div class="card-meta">' + badge(p.slots.length + ' prompts') + '</div>' +
          '<button class="btn primary small" data-prep-mockstart="' + esc(p.id) + '">Start</button></div></article>';
      }).join('') + '</div>' +
      (hist.length ? label('Recent sessions') + ul(hist, function (h) {
        var p = byId('onsiteMock', h.preset);
        var weak = {}; (h.items || []).forEach(function (it) { (it.ratings || []).forEach(function (r) { weak[r] = (weak[r] || 0) + 1; }); });
        var tags = feedback().filter(function (f) { return weak[f.id]; }).map(function (f) { return f.label + ' ×' + weak[f.id]; });
        return esc((p ? p.title : h.preset) + ' — ' + new Date(h.at).toLocaleDateString() + ' · ' + Math.round((h.elapsed || 0) / 60) + ' min') +
          (tags.length ? '<br><span class="muted small">' + esc(tags.join(' · ')) + '</span>' : '');
      }) : '');
  }
  function elapsed(m) { return Math.floor(((m.end || Date.now()) - m.start) / 1000); }
  function mmss(sec) { return Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2); }
  function renderMockPrompt(m) {
    var p = byId('onsiteMock', m.preset), it = m.items[m.idx], h = '';
    h += '<div class="mock-head"><p class="muted">' + esc(p.title) + ' · prompt ' + (m.idx + 1) + ' of ' + m.items.length + '</p>' +
      '<p class="mock-timer" aria-live="off"><span id="prepMockTimer">' + mmss(elapsed(m)) + '</span> / ' + p.mins + ':00</p></div>';
    if (it.kind === 'question') {
      var q = question(it.id);
      h += '<h2 class="prep-h">' + esc(q.q) + '</h2>' + (q.context ? '<div class="situation-box">' + md(q.context) + '</div>' : '') +
        '<textarea class="notes-input" rows="4" data-prep-mocknote="' + m.idx + '" aria-label="Notes for this prompt" placeholder="Answer out loud; jot the outline if it helps.">' + esc(it.note) + '</textarea>' +
        '<div class="done-btns">' +
          (it.fu < q.followups.length ? '<button class="btn small" data-prep-mockfu>Ask me a follow-up</button>' : '') +
          (!it.hint ? '<button class="btn small ghost" data-prep-mockhint>Hint</button>' : '') +
          (!it.shown ? '<button class="btn small" data-prep-mockshow>Reveal the answer</button>' : '') + '</div>' +
        (it.hint ? label('What the interviewer is listening for') + ul(q.evaluates) : '') +
        q.followups.slice(0, it.fu).map(function (f, i) {
          return '<div class="followup"><p><b>Follow-up ' + (i + 1) + ':</b> ' + inline(f.q) + '</p>' +
            (it.shown ? '<details class="brief-wrap"><summary>Guidance</summary><div class="situation">' + md(f.guidance) + '</div></details>' : '') + '</div>';
        }).join('') +
        (it.shown ? label('Model answer') + '<div class="tip interview-answer">' + md(q.spoken) + '</div>' +
          '<div class="rubric"><p><b>Strong</b></p>' + ul(q.rubric.strong) + '<p><b>Also sound</b></p>' + ul(q.rubric.acceptable) + '<p><b>Red flags</b></p>' + ul(q.rubric.redFlags) + '</div>' : '');
    } else if (it.kind === 'lab') {
      var lab = mission(it.id);
      h += '<h2 class="prep-h">' + esc(lab.onsite.neutralTitle) + '</h2><div class="situation-box"><p>' + inline(lab.onsite.neutralBrief) + '</p></div>' +
        '<p>Work it in the simulator in <b>independent</b> mode, narrating your reasoning as you go. Come back here when done.</p>' +
        '<div class="done-btns"><button class="btn primary small" data-prep-open="lab:' + esc(it.id) + ':independent">Open the lab</button></div>' +
        '<textarea class="notes-input" rows="3" data-prep-mocknote="' + m.idx + '" aria-label="Notes for this prompt" placeholder="What you checked, in order, and why.">' + esc(it.note) + '</textarea>';
    } else if (it.kind === 'case') {
      var cs = byId('onsiteCases', it.id);
      h += '<h2 class="prep-h">' + esc(cs.title) + '</h2><div class="situation-box"><p><b>Interviewer:</b> ' + inline(cs.opening) + '</p></div>' +
        '<p>Work it as an interviewer-led case, narrating as you go. Come back here when you have revealed the cause.</p>' +
        '<div class="done-btns"><button class="btn primary small" data-prep-open="case:' + esc(it.id) + '">Open the case</button></div>' +
        '<textarea class="notes-input" rows="3" data-prep-mocknote="' + m.idx + '" aria-label="Notes for this prompt" placeholder="What you asked for, in order, and why.">' + esc(it.note) + '</textarea>';
    } else if (it.kind === 'walk') {
      var wk = byId('onsiteWalks', it.id);
      h += '<h2 class="prep-h">"' + esc(wk.prompt) + '"</h2><p class="muted">' + inline(wk.aim) + ' Suggested: ' + esc(wk.title.toLowerCase()) + '.</p>' +
        '<textarea class="notes-input" rows="4" data-prep-mocknote="' + m.idx + '" aria-label="Walkthrough notes" placeholder="Frame it, requirements, the layers, decisions, where it broke, the Kubernetes mapping.">' + esc(it.note) + '</textarea>' +
        '<div class="done-btns">' + (it.fu < wk.probes.length ? '<button class="btn small" data-prep-mockfu>Interviewer probes</button>' : '') +
          (!it.hint ? '<button class="btn small ghost" data-prep-mockhint>Show the structure</button>' : '') +
          (!it.shown ? '<button class="btn small" data-prep-mockshow>Show the pitfalls</button>' : '') + '</div>' +
        (it.hint ? ul(wk.sections.map(function (x) { return x.h; })) : '') +
        wk.probes.slice(0, it.fu).map(function (x, i) { return '<div class="followup"><p><b>Probe ' + (i + 1) + ':</b> ' + inline(x.q) + '</p>' + (it.shown ? '<p class="muted">' + inline(x.guidance) + '</p>' : '') + '</div>'; }).join('') +
        (it.shown ? ul(wk.pitfalls) : '');
    } else if (it.kind === 'design') {
      var d = byId('onsiteDesign', it.id);
      h += '<h2 class="prep-h">' + esc(d.title) + '</h2><div class="situation-box">' + md(d.brief) + '</div>' +
        '<textarea class="notes-input" rows="5" data-prep-mocknote="' + m.idx + '" aria-label="Design notes" placeholder="Requirements and clarifying questions first.">' + esc(it.note) + '</textarea>' +
        '<div class="done-btns">' + (it.fu < d.reveals.length ? '<button class="btn small" data-prep-mockfu>Interviewer adds a constraint</button>' : '') +
          (!it.hint ? '<button class="btn small ghost" data-prep-mockhint>Clarifying questions to consider</button>' : '') +
          (!it.shown ? '<button class="btn small" data-prep-mockshow>Show the rubric</button>' : '') + '</div>' +
        (it.hint ? ul(d.clarify, function (c) { return inline(c.q); }) : '') +
        d.reveals.slice(0, it.fu).map(function (x, i) { return '<div class="followup"><p><b>Constraint ' + (i + 1) + ':</b> ' + inline(x.constraint) + '</p></div>'; }).join('') +
        (it.shown ? '<div class="rubric"><p><b>Strong</b></p>' + ul(d.rubric.strong) + '<p><b>Red flags</b></p>' + ul(d.rubric.redFlags) + '</div>' : '');
    }
    h += rateBlock('m', String(m.idx), it.ratings) +
      '<div class="done-btns">' + (m.idx > 0 ? '<button class="btn ghost small" data-prep-mockprev>Previous</button>' : '') +
      (m.idx + 1 < m.items.length ? '<button class="btn primary" data-prep-mocknext>Next prompt</button>' : '<button class="btn primary" data-prep-mockend>Finish session</button>') +
      '<button class="btn ghost small" data-prep-mockquit>Abandon</button></div>';
    return h;
  }
  function renderMockSummary(m) {
    var p = byId('onsiteMock', m.preset);
    var counts = {}; m.items.forEach(function (it) { it.ratings.forEach(function (r) { counts[r] = (counts[r] || 0) + 1; }); });
    return '<h2 class="prep-h">' + esc(p.title) + ' — done in ' + mmss(elapsed(m)) + '</h2>' +
      '<p class="muted">Self-assessed. This is not a score and does not predict an outcome.</p>' +
      label('Your ratings') + ul(m.items, function (it) {
        return esc(titleOf(it.kind, it.id)) + '<br><span class="muted small">' + esc(it.ratings.map(function (r) {
          var f = feedback().filter(function (x) { return x.id === r; })[0]; return f ? f.label : r; }).join(' · ') || 'not rated') + '</span>';
      }) +
      (Object.keys(counts).length ? label('Patterns') + ul(feedback().filter(function (f) { return counts[f.id]; }), function (f) {
        return '<b>' + esc(f.label) + '</b> ×' + counts[f.id] + ' — ' + esc(f.tip); }) : '') +
      '<label class="prep-label" for="prepMockReflect">Reflection: what would you do differently next time?</label>' +
      '<textarea id="prepMockReflect" class="notes-input" rows="4">' + esc(m.reflection || '') + '</textarea>' +
      '<div class="done-btns"><button class="btn primary" data-prep-mocksave>Save session</button><button class="btn ghost" data-prep-mockquit>Discard</button></div>';
  }
  function startTimer() {
    stopTimer();
    ui.timer = setInterval(function () {
      var t = document.getElementById('prepMockTimer');
      if (!t || !ui.mock || ui.mock.done) { stopTimer(); return; }
      t.textContent = mmss(elapsed(ui.mock));
    }, 1000);
  }
  function stopTimer() { if (ui.timer) { clearInterval(ui.timer); ui.timer = null; } }

  /* ── Progress ────────────────────────────────────────────────── */
  function tierCounts() {
    var s = st(), sb = sandbox(), labs = list('missions').filter(function (m) { return m.track === 'onsite'; });
    var modes = labs.map(function (m) { return (sb[m.id] && sb[m.id].modes) || {}; });
    var realVals = Object.keys(s.real).map(function (k) { return s.real[k].status; });
    return {
      studied: Object.keys(s.lessons).filter(function (k) { return lesson(k); }).length,
      answered: list('onsiteQ').filter(function (q) { var r = s.questions[q.id]; return r && r.answeredFirst; }).length,
      guided: modes.filter(function (m) { return m.guided; }).length,
      independent: modes.filter(function (m) { return m.independent; }).length,
      unaided: modes.filter(function (m) { return (m.independent && m.independent.unaided) || (m.guided && m.guided.unaided); }).length,
      realDone: realVals.length,
      casesDone: Object.keys(s.cases).filter(function (k) { return s.cases[k].revealed; }).length,
      handsDone: Object.keys(s.hands).filter(function (k) { return s.hands[k].status; }).length,
      handsChecked: Object.keys(s.hands).filter(function (k) { return s.hands[k].status === 'checked'; }).length,
      realVerified: realVals.filter(function (v) { return v === 'verified'; }).length,
      labs: labs.length
    };
  }
  function topicStats() {
    var s = st();
    return TOPICS.map(function (t) {
      var qs = list('onsiteQ').filter(function (q) { return q.topic === t; });
      var answered = qs.filter(function (q) { var r = s.questions[q.id]; return r && r.answeredFirst; }).length;
      var weak = 0, strong = 0, flags = {};
      qs.forEach(function (q) {
        ((s.questions[q.id] || {}).ratings || []).forEach(function (r) {
          var f = feedback().filter(function (x) { return x.id === r; })[0];
          if (!f) return;
          if (f.weak) { weak++; flags[f.label] = (flags[f.label] || 0) + 1; } else strong++;
        });
      });
      s.mocks.forEach(function (m) { (m.items || []).forEach(function (it) {
        var q = it.kind === 'question' ? question(it.id) : null;
        if (!q || q.topic !== t) return;
        (it.ratings || []).forEach(function (r) {
          var f = feedback().filter(function (x) { return x.id === r; })[0];
          if (f && f.weak) { weak++; flags[f.label] = (flags[f.label] || 0) + 1; } else if (f) strong++;
        });
      }); });
      var ls = list('onsiteLessons').filter(function (l) { return (l.questions || []).some(function (id) { var q = question(id); return q && q.topic === t; }); });
      return { t: t, total: qs.length, answered: answered, weak: weak, strong: strong, flags: flags,
               lessons: ls.filter(function (l) { return s.lessons[l.id]; }).length, lessonTotal: ls.length, boost: boostOf(t) };
    });
  }
  function renderProgress() {
    var c = tierCounts(), ts = topicStats();
    var PRI = { arch: 0, trouble: 0, net: 1, config: 1, delivery: 1, design: 2, behavior: 3 };
    var focus = ts.slice().sort(function (a, b) {
      var sa = (a.boost === 'up' ? -1 : a.boost === 'down' ? 1 : 0), sb_ = (b.boost === 'up' ? -1 : b.boost === 'down' ? 1 : 0);
      var ga = a.total ? a.answered / a.total : 1, gb = b.total ? b.answered / b.total : 1;
      return sa - sb_ || (b.weak - b.strong) - (a.weak - a.strong) || PRI[a.t] - PRI[b.t] || ga - gb;
    }).slice(0, 3);
    function row(labelTxt, n, of, note) {
      return '<tr><th scope="row">' + esc(labelTxt) + '</th><td>' + n + (of != null ? ' / ' + of : '') + '</td><td class="muted small">' + esc(note) + '</td></tr>';
    }
    return '<p class="blurb">Evidence, kept in separate tiers and labelled for what it is. There is no readiness score and nothing here predicts an interview outcome.</p>' +
      '<div class="table-wrap"><table class="tiers"><caption class="sr-only">Evidence tiers</caption><thead><tr><th scope="col">Tier</th><th scope="col">Count</th><th scope="col">What it means</th></tr></thead><tbody>' +
      row('Studied a concept', c.studied, list('onsiteLessons').length, 'Lessons you marked studied. Self-marked.') +
      row('Answered independently', c.answered, list('onsiteQ').length, 'You wrote an answer before revealing the model answer. Self-assessed, not graded.') +
      row('Completed a guided simulation', c.guided, c.labs, 'Browser simulation, guided mode.') +
      row('Completed an independent simulation', c.independent, c.labs, 'Browser simulation, neutral ticket, hidden objectives.') +
      row('Solved a simulation without hints', c.unaided, c.labs, 'No hints and no reveals in that run. Still a simulation.') +
      row('Worked an interviewer-led case', c.casesDone, list('onsiteCases').length, 'Evidence asked for and cause revealed in the app. Your answer is self-assessed.') +
      row('Reported a hands-on scenario', c.handsDone, list('onsiteHands').length, 'Real practice cluster (Killercoda or Docker Desktop). Self-reported.') +
      row('Reported a hands-on PASS check', c.handsChecked, list('onsiteHands').length, 'Self-reported: the app cannot observe your cluster.') +
      row('Reported completing a real local lab', c.realDone, list('onsiteReal').length || null, 'kind on your machine. Self-reported.') +
      row('Reported a real-lab verify script PASS', c.realVerified, list('onsiteReal').length || null, 'Self-reported: the app cannot observe your cluster.') +
      '<tr><th scope="row">Automatically verified real-lab check</th><td>—</td><td class="muted small">Not available. A static offline app cannot see a local cluster, so no real-lab result here is machine-verified.</td></tr>' +
      '</tbody></table></div>' +
      '<p class="muted small">None of these tiers is production experience. A local lab or a simulation shows you can reason through a mechanism.</p>' +
      label('By topic') +
      '<div class="table-wrap"><table class="tiers"><thead><tr><th scope="col">Topic</th><th scope="col">Answered</th><th scope="col">Lessons</th><th scope="col">Weak / strong flags</th></tr></thead><tbody>' +
      ts.map(function (x) {
        var flags = Object.keys(x.flags).map(function (k) { return k + ' ×' + x.flags[k]; }).join(', ');
        return '<tr><th scope="row">' + esc(topicName(x.t)) + (x.boost === 'up' ? ' <span class="badge up">raised</span>' : x.boost === 'down' ? ' <span class="badge">lowered</span>' : '') + '</th>' +
          '<td>' + x.answered + ' / ' + x.total + '</td><td>' + x.lessons + ' / ' + x.lessonTotal + '</td>' +
          '<td>' + x.weak + ' / ' + x.strong + (flags ? '<br><span class="muted small">' + esc(flags) + '</span>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      label('Where to focus next') + ul(focus, function (x) {
        var why = x.weak > x.strong ? 'more weakness flags than strengths' : x.answered < x.total ? (x.total - x.answered) + ' questions not yet answered first' : 'keep it fresh';
        return '<button class="linkish" data-prep-focus="' + x.t + '">' + esc(topicName(x.t)) + '</button> — ' + esc(why) + (x.boost === 'up' ? ' · raised by your notes' : '');
      }) +
      '<p class="muted small">Ordering uses your notes, your own flags, the topic priority (P0 first) and what is still unanswered. It is a suggestion, not a measurement.</p>';
  }

  /* ── Notes ───────────────────────────────────────────────────── */
  function renderNotes() {
    var s = st();
    return '<p class="blurb">Record what the recruiter tells you and adjust priorities. Stored only in this browser (and in any export you make).</p>' +
      '<div class="notes-grid">' +
        '<label class="prep-label" for="prepDate">Interview date (optional)</label>' +
        '<input id="prepDate" type="date" class="notes-date" data-prep-field="date" value="' + esc(s.date || '') + '">' +
        '<label class="check"><input type="checkbox" data-prep-field="dateConfirmed"' + (s.dateConfirmed ? ' checked' : '') + '> The date is confirmed</label>' +
      '</div>' +
      '<label class="prep-label" for="prepRecruiter">Recruiter clarifications</label>' +
      '<textarea id="prepRecruiter" class="notes-input" rows="6" data-prep-field="recruiter" placeholder="Format, interviewers, what to bring, anything they said to focus on.">' + esc(s.recruiter || '') + '</textarea>' +
      label('What the agenda includes (as far as you know)') +
      '<div class="table-wrap"><table class="tiers formats"><tbody>' + FORMATS.map(function (f) {
        var v = s.formats[f[0]] || 'unknown';
        return '<tr><th scope="row">' + esc(f[1]) + '</th><td><label class="sr-only" for="fmt-' + f[0] + '">' + esc(f[1]) + '</label>' +
          '<select id="fmt-' + f[0] + '" data-prep-format="' + f[0] + '">' +
          [['unknown', 'Unknown'], ['confirmed', 'Confirmed'], ['excluded', 'Not in the agenda']].map(function (o) {
            return '<option value="' + o[0] + '"' + (v === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
          }).join('') + '</select></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="muted small">A confirmed format raises its topics in the path and in Progress; one marked "not in the agenda" lowers them. Nothing is removed.</p>' +
      label('Topic priority overrides') +
      '<div class="table-wrap"><table class="tiers formats"><tbody>' + TOPICS.map(function (t) {
        var v = s.boosts[t] || 'default';
        return '<tr><th scope="row">' + esc(topicName(t)) + '</th><td><label class="sr-only" for="boost-' + t + '">' + esc(topicName(t)) + ' priority</label>' +
          '<select id="boost-' + t + '" data-prep-boost="' + t + '">' +
          [['default', 'Default'], ['up', 'Raise'], ['down', 'Lower']].map(function (o) {
            return '<option value="' + o[0] + '"' + (v === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
          }).join('') + '</select></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="done-btns"><button class="btn primary" data-prep-notessave>Save notes</button></div>';
  }

  var SECTION_RENDER = {
    path: renderPath, hands: renderHands, cases: renderCases, lessons: renderLessons, questions: renderQuestions, labs: renderLabs, design: renderDesigns,
    scripting: renderScripting, real: renderReal, stories: renderStories, mock: renderMock, progress: renderProgress, notes: renderNotes
  };

  /* ── opening things from anywhere ────────────────────────────── */
  function open(kind, id, mode) {
    if (kind === 'lab') {
      U().go('sandbox');
      if (window.LXSandbox) {
        window.LXSandbox.open(id, mode ? { mode: mode } : null);
      }
      return;
    }
    var section = { 'case': 'cases', walk: 'design', hands: 'hands', lesson: 'lessons', question: 'questions', design: 'design', script: 'scripting', real: 'real', story: 'stories', mock: 'mock' }[kind];
    if (!section) return;
    if (U().track() !== 'onsite') return;
    U().go('prep');
    if (kind === 'mock') { ui.section = 'mock'; startMock(id); return; }
    go(section, id);
  }

  function startMock(id) {
    var p = byId('onsiteMock', id);
    if (!p) return;
    ui.mock = { preset: id, items: pickItems(p), idx: 0, start: Date.now(), done: false };
    go('mock');
  }

  /* ── events ──────────────────────────────────────────────────── */
  function toggleRate(kind, id, fid) {
    var s = st(), arr;
    if (kind === 'q') {
      var r = s.questions[id] = s.questions[id] || {};
      arr = r.ratings = r.ratings || [];
      r.at = Date.now();
    } else if (kind === 'd') {
      var d = s.design[id] = s.design[id] || {};
      arr = d.ratings = d.ratings || [];
    } else if (kind === 'c') {
      var cr = s.cases[id] = s.cases[id] || {};
      arr = cr.ratings = cr.ratings || [];
    } else if (kind === 'm' && ui.mock) {
      arr = ui.mock.items[Number(id)].ratings;
    }
    if (!arr) return;
    var i = arr.indexOf(fid);
    if (i === -1) arr.push(fid); else arr.splice(i, 1);
    if (kind !== 'm') save(s);
    render();
  }
  function keepNote(s) {
    var own = $('[data-prep-own]', root());
    if (own) {
      var r = s.questions[own.dataset.prepOwn] = s.questions[own.dataset.prepOwn] || {};
      r.text = own.value;
    }
    var dn = $('[data-prep-dnotes]', root());
    if (dn) { var d = s.design[dn.dataset.prepDnotes] = s.design[dn.dataset.prepDnotes] || {}; d.notes = dn.value; }
    $$('[data-prep-story]', root()).forEach(function (t) {
      var parts = t.dataset.prepStory.split(':'), sr = s.stories[parts[0]] = s.stories[parts[0]] || {};
      sr.fields = sr.fields || {}; sr.fields[parts[1]] = t.value;
    });
    var hyp = $('[data-prep-chyp]', root());
    if (hyp) { var hr0 = s.cases[hyp.dataset.prepChyp] = s.cases[hyp.dataset.prepChyp] || {}; hr0.hyp = hyp.value; }
    $$('[data-prep-walk]', root()).forEach(function (t) {
      var parts = t.dataset.prepWalk.split('|'), wr = s.walks[parts[0]] = s.walks[parts[0]] || {};
      wr.fields = wr.fields || {}; wr.fields[parts[1]] = t.value;
    });
    $$('[data-prep-mocknote]', root()).forEach(function (t) { if (ui.mock) ui.mock.items[Number(t.dataset.prepMocknote)].note = t.value; });
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    var opener = t.closest('[data-prep-open]');
    if (opener) {
      var parts = opener.dataset.prepOpen.split(':');
      e.preventDefault();
      if (root() && root().contains(opener)) { var s0 = st(); keepNote(s0); save(s0); }
      open(parts[0], parts[1], parts[2]);
      return;
    }
    if (!root() || !root().contains(t)) return;
    var s = st();
    var b;
    if ((b = t.closest('[data-prep-section]'))) { keepNote(s); save(s); ui.mock = ui.mock && !ui.mock.done ? ui.mock : null; go(b.dataset.prepSection); return; }
    if (t.closest('[data-prep-back]')) { keepNote(s); save(s); go(ui.section); return; }
    if ((b = t.closest('[data-prep-path]'))) { ui.path = b.dataset.prepPath; s.pathChoice = ui.path; save(s); render(); return; }
    if ((b = t.closest('[data-prep-qtopic]'))) { ui.qTopic = b.dataset.prepQtopic; render(); return; }
    if ((b = t.closest('[data-prep-qpri]'))) { ui.qPri = b.dataset.prepQpri; render(); return; }
    if ((b = t.closest('[data-prep-focus]'))) { ui.qTopic = b.dataset.prepFocus; ui.qPri = 'all'; go('questions'); return; }
    if ((b = t.closest('[data-prep-studied]'))) {
      var lid = b.dataset.prepStudied;
      if (s.lessons[lid]) delete s.lessons[lid]; else s.lessons[lid] = Date.now();
      save(s); render(); U().toast(s.lessons[lid] ? 'Marked studied' : 'Unmarked'); return;
    }
    if ((b = t.closest('[data-prep-saveown]'))) { keepNote(s); save(s); U().toast('Saved'); return; }
    if ((b = t.closest('[data-prep-reveal]'))) {
      keepNote(s);
      var qid = b.dataset.prepReveal, r = s.questions[qid] = s.questions[qid] || {};
      if (!r.revealed) {
        r.revealed = Date.now();
        /* the tier: something written before the answer was shown */
        r.answeredFirst = !!(r.text && r.text.trim().length >= 20);
      }
      save(s); render(); return;
    }
    if ((b = t.closest('[data-prep-fu]'))) { ui.fu[b.dataset.prepFu] = (ui.fu[b.dataset.prepFu] || 0) + 1; keepNote(s); save(s); render(); return; }
    if ((b = t.closest('[data-prep-rate]'))) { keepNote(s); save(s); var rp = b.dataset.prepRate.split(':'); toggleRate(rp[0], rp[1], rp[2]); return; }
    if ((b = t.closest('[data-prep-dstep]'))) {
      keepNote(s); var dp = b.dataset.prepDstep.split(':'), dr = s.design[dp[0]] = s.design[dp[0]] || {};
      dr.step = Math.max(dr.step || 0, Number(dp[1])); save(s); render(); return;
    }
    if ((b = t.closest('[data-prep-dreveal]'))) { keepNote(s); var dr2 = s.design[b.dataset.prepDreveal] = s.design[b.dataset.prepDreveal] || {}; dr2.reveals = (dr2.reveals || 0) + 1; save(s); render(); return; }
    if ((b = t.closest('[data-prep-dsave]'))) { keepNote(s); save(s); U().toast('Saved'); return; }
    if ((b = t.closest('[data-prep-dpracticed]'))) { keepNote(s); var dr3 = s.design[b.dataset.prepDpracticed] = s.design[b.dataset.prepDpracticed] || {}; dr3.practiced = dr3.practiced ? 0 : Date.now(); save(s); render(); return; }
    if ((b = t.closest('[data-prep-shint]'))) { var sr = s.scripting[b.dataset.prepShint] = s.scripting[b.dataset.prepShint] || {}; sr.hints = (sr.hints || 0) + 1; save(s); render(); return; }
    if ((b = t.closest('[data-prep-ssol]'))) { var sr2 = s.scripting[b.dataset.prepSsol] = s.scripting[b.dataset.prepSsol] || {}; sr2.solution = Date.now(); save(s); render(); return; }
    if ((b = t.closest('[data-prep-sstatus]'))) {
      var sp = b.dataset.prepSstatus.split(':'), sr3 = s.scripting[sp[0]] = s.scripting[sp[0]] || {};
      sr3.status = sr3.status === sp[1] ? null : sp[1]; sr3.at = Date.now(); save(s); render(); return;
    }
    if ((b = t.closest('[data-prep-real]'))) {
      var rp2 = b.dataset.prepReal.split(':');
      if (rp2[1] === 'clear' || (s.real[rp2[0]] && s.real[rp2[0]].status === rp2[1])) delete s.real[rp2[0]];
      else s.real[rp2[0]] = { status: rp2[1], at: Date.now() };
      save(s); render(); return;
    }
    if ((b = t.closest('[data-prep-cctx]'))) { keepNote(s); var c0 = s.cases[b.dataset.prepCctx] = s.cases[b.dataset.prepCctx] || {}; c0.context = true; save(s); render(); return; }
    if ((b = t.closest('[data-prep-cask]'))) {
      keepNote(s); var cp = b.dataset.prepCask.split(':'), c1 = s.cases[cp[0]] = s.cases[cp[0]] || {};
      c1.asked = c1.asked || []; if (c1.asked.indexOf(cp[1]) === -1) c1.asked.push(cp[1]);
      save(s); render(); return;
    }
    if ((b = t.closest('[data-prep-creveal]'))) { keepNote(s); var c2 = s.cases[b.dataset.prepCreveal] = s.cases[b.dataset.prepCreveal] || {}; c2.revealed = Date.now(); c2.runs = (c2.runs || 0) + 1; save(s); render(); return; }
    if ((b = t.closest('[data-prep-creset]'))) { var c3 = s.cases[b.dataset.prepCreset] || {}; s.cases[b.dataset.prepCreset] = { runs: c3.runs || 0, ratings: c3.ratings || [] }; save(s); render(); return; }
    if ((b = t.closest('[data-prep-track]'))) { keepNote(s); save(s); U().setTrack(b.dataset.prepTrack); U().toast('Switched to the ' + (TRACK_NAME[b.dataset.prepTrack] || b.dataset.prepTrack) + ' track — use the pill to come back'); return; }
    if ((b = t.closest('[data-prep-pace]'))) { keepNote(s); s.designPace = b.dataset.prepPace; save(s); render(); return; }
    if ((b = t.closest('[data-prep-walksave]'))) { keepNote(s); save(s); U().toast('Saved in this browser'); return; }
    if ((b = t.closest('[data-prep-walkrev]'))) { keepNote(s); var wr2 = s.walks[b.dataset.prepWalkrev] = s.walks[b.dataset.prepWalkrev] || {}; wr2.reviewed = wr2.reviewed ? 0 : Date.now(); save(s); render(); return; }
    if ((b = t.closest('[data-prep-henv]'))) { s.handsEnv = b.dataset.prepHenv; save(s); render(); return; }
    if ((b = t.closest('[data-prep-hhint]')) || (b = t.closest('[data-prep-hshow]')) || (b = t.closest('[data-prep-htask]'))) {
      var hk = b.dataset.prepHhint ? 'hint' : b.dataset.prepHshow ? 'open' : 'tasks';
      var hp = (b.dataset.prepHhint || b.dataset.prepHshow || b.dataset.prepHtask).split(':');
      var hr = s.hands[hp[0]] = s.hands[hp[0]] || {};
      hr[hk] = hr[hk] || {};
      hr[hk][hp[1]] = hk === 'tasks' ? !hr[hk][hp[1]] : true;
      hr.at = Date.now(); save(s); render(); return;
    }
    if ((b = t.closest('[data-prep-hstatus]'))) {
      var hs = b.dataset.prepHstatus.split(':'), hr2 = s.hands[hs[0]] = s.hands[hs[0]] || {};
      hr2.status = hr2.status === hs[1] ? null : hs[1]; hr2.env = handsEnv(); hr2.at = Date.now(); save(s); render(); return;
    }
    if ((b = t.closest('[data-prep-copy]'))) {
      var txt = b.dataset.prepCopy;
      try {
        navigator.clipboard.writeText(txt).then(function () { U().toast('Copied'); }, function () { U().toast('Copy failed — select the text instead'); });
      } catch (err) { U().toast('Copy is not available here — select the text instead'); }
      return;
    }
    if ((b = t.closest('[data-prep-storysave]'))) { keepNote(s); save(s); U().toast('Saved in this browser'); return; }
    if ((b = t.closest('[data-prep-storyrev]'))) { keepNote(s); var so = s.stories[b.dataset.prepStoryrev] = s.stories[b.dataset.prepStoryrev] || {}; so.reviewed = so.reviewed ? 0 : Date.now(); save(s); render(); return; }
    if ((b = t.closest('[data-prep-mockstart]'))) { startMock(b.dataset.prepMockstart); return; }
    if (ui.mock) {
      var it = ui.mock.items[ui.mock.idx];
      if (t.closest('[data-prep-mockfu]')) { keepNote(s); it.fu++; render(); return; }
      if (t.closest('[data-prep-mockhint]')) { keepNote(s); it.hint = true; render(); return; }
      if (t.closest('[data-prep-mockshow]')) { keepNote(s); it.shown = true; render(); return; }
      if (t.closest('[data-prep-mocknext]')) { keepNote(s); ui.mock.idx++; render(); window.scrollTo(0, 0); return; }
      if (t.closest('[data-prep-mockprev]')) { keepNote(s); ui.mock.idx--; render(); window.scrollTo(0, 0); return; }
      if (t.closest('[data-prep-mockend]')) { keepNote(s); ui.mock.done = true; ui.mock.end = Date.now(); render(); window.scrollTo(0, 0); return; }
      if (t.closest('[data-prep-mockquit]')) { ui.mock = null; stopTimer(); render(); return; }
      if (t.closest('[data-prep-mocksave]')) {
        var m = ui.mock, refl = $('#prepMockReflect');
        s.mocks.push({ preset: m.preset, at: Date.now(), elapsed: elapsed(m), reflection: refl ? refl.value : '',
          items: m.items.map(function (x) { return { kind: x.kind, id: x.id, ratings: x.ratings.slice(), note: x.note }; }) });
        if (s.mocks.length > 50) s.mocks.shift();
        save(s); ui.mock = null; render(); U().toast('Session saved'); return;
      }
    }
    if (t.closest('[data-prep-notessave]')) { saveNotes(s); return; }
  });

  function saveNotes(s) {
    var el = root();
    s.date = ($('[data-prep-field="date"]', el) || {}).value || '';
    s.dateConfirmed = !!($('[data-prep-field="dateConfirmed"]', el) || {}).checked;
    s.recruiter = ($('[data-prep-field="recruiter"]', el) || {}).value || '';
    $$('[data-prep-format]', el).forEach(function (x) { s.formats[x.dataset.prepFormat] = x.value; });
    $$('[data-prep-boost]', el).forEach(function (x) { if (x.value === 'default') delete s.boosts[x.dataset.prepBoost]; else s.boosts[x.dataset.prepBoost] = x.value; });
    save(s);
    U().toast('Notes saved');
    render();
  }

  /* selects and the date save as soon as they change; text saves on the
     button or when you navigate away, never lost to a re-render */
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (!root() || !root().contains(t)) return;
    if (t.matches('[data-prep-format], [data-prep-boost], [data-prep-field="date"], [data-prep-field="dateConfirmed"]')) saveNotes(st());
  });

  window.LXOnsite = { render: render, open: open, state: st };
})();
