/* Sandbox UI: typed terminal against LXShell, objective tracking, debrief. */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  function U() { return window.LXUtil; }

  var run = null;  // { mission, w, ran:[], last:{}, met:{}, revealed:0, hist:[], histIdx }

  /* ── List ─────────────────────────────────────────────────── */
  function progress() { return U().LS.get('lx.sandbox', {}); }

  function renderList(q) {
    var el = $('#sbList');
    if (!el) return;
    var esc = U().esc, done = progress();
    var query = (q || '').toLowerCase();
    var list = (LX.missions || []).filter(function (m) {
      return !query || (m.title + ' ' + m.brief + ' ' + m.cat).toLowerCase().indexOf(query) !== -1;
    });
    if (!list.length) { el.innerHTML = '<p class="empty">No mission matches that search.</p>'; return; }

    el.innerHTML = list.map(function (m) {
      var p = done[m.id];
      var kind = m.kind === 'incident' ? 'incident' : m.kind === 'drill' ? 'drill' : 'free play';
      var badge = p ? '<span class="badge done">✓ solved' + (p.clean ? ' unaided' : '') + '</span>'
                    : (m.objectives.length ? '<span class="badge">' + m.objectives.length + ' objectives</span>'
                                           : '<span class="badge">open ended</span>');
      return '<article class="card lab-card" data-mission="' + esc(m.id) + '">' +
        '<div class="card-head"><div class="card-main">' +
          '<p class="card-title plain">' + esc(m.title) + '</p>' +
          '<p class="card-sum">' + esc(m.brief) + '</p>' +
          '<div class="card-meta">' +
            '<span class="badge">' + esc(U().catName(m.cat)) + '</span>' +
            '<span class="badge ' + m.level + '">' + m.level + '</span>' +
            '<span class="badge">' + kind + '</span>' + badge +
          '</div></div><span class="lab-go">▶</span></div></article>';
    }).join('');
  }

  /* ── Terminal ─────────────────────────────────────────────── */
  function print(html, cls) {
    var div = document.createElement('div');
    div.className = cls || 'term-out';
    div.innerHTML = html;
    $('#sbTerm').appendChild(div);
    $('#sbTerm').scrollTop = $('#sbTerm').scrollHeight;
  }
  function prompt() {
    return '[' + run.w.user + '@' + run.w.host + ' ' +
      (run.w.cwd === '/home/' + run.w.user ? '~' : run.w.cwd.replace('/home/' + run.w.user, '~')) + ']$ ';
  }

  function submit(line) {
    var esc = U().esc;
    if (!run) return;
    line = line.trim();
    print('<span class="term-prompt">' + esc(prompt()) + '</span><span class="term-cmd">' + esc(line) + '</span>', 'term-line');
    if (!line) return;

    run.hist.push(line);
    run.histIdx = run.hist.length;

    var res;
    try { res = LXShell.run(run.w, line); }
    catch (e) { res = { out:'', err:'sandbox: ' + e.message, code:1 }; }

    if (res.clear) { $('#sbTerm').innerHTML = ''; }
    if (res.out) print(esc(res.out.replace(/\n$/, '')));
    if (res.err) print(esc(res.err.replace(/\n$/, '')), 'term-out term-err');

    run.ran.push(line);
    run.last = { cmd: line, out: (res.out || '') + (res.err || '') };
    checkObjectives();
  }

  /* ── Objectives ───────────────────────────────────────────── */
  function ctx() { return { w: run.w, ran: run.ran, last: run.last }; }

  function checkObjectives() {
    var m = run.mission;
    if (!m.objectives.length) return;
    var changed = false;
    m.objectives.forEach(function (o) {
      if (run.met[o.id]) return;
      var pass = false;
      try { pass = !!o.done(ctx()); } catch (e) { pass = false; }
      if (pass) { run.met[o.id] = true; changed = true; }
    });
    if (changed) {
      paintObjectives();
      var all = m.objectives.every(function (o) { return run.met[o.id]; });
      if (all) {
        saveProgress();
        /* remember which run this belongs to — the user may exit before it fires */
        var owner = run;
        run.finishTimer = setTimeout(function () {
          if (run === owner) finish();
        }, 500);
      } else U().toast('Objective complete');
    }
  }

  function paintObjectives() {
    var m = run.mission, esc = U().esc;
    if (!m.objectives.length) {
      $('#sbObjectives').innerHTML = '<p class="muted">Free play — no objectives. Type <code>help</code> to see what is implemented.</p>';
      return;
    }
    var doneCount = m.objectives.filter(function (o) { return run.met[o.id]; }).length;
    $('#sbObjCount').textContent = doneCount + ' / ' + m.objectives.length;
    $('#sbBar').style.width = (doneCount / m.objectives.length * 100) + '%';
    $('#sbObjectives').innerHTML = m.objectives.map(function (o) {
      return '<div class="obj' + (run.met[o.id] ? ' met' : '') + '">' +
        '<span class="obj-tick">' + (run.met[o.id] ? '✓' : '○') + '</span>' +
        '<span>' + esc(o.text) + '</span></div>';
    }).join('');
  }

  function nextUnmet() {
    return run.mission.objectives.filter(function (o) { return !run.met[o.id]; })[0];
  }

  /* ── Input helpers ────────────────────────────────────────── */
  function insert(text) {
    var input = $('#sbInput');
    var v = input.value;
    var needsSpace = v && !/\s$/.test(v) && !/^[|>&]/.test(text);
    input.value = v + (needsSpace ? ' ' : '') + text + (/[|>]$/.test(text) ? ' ' : '');
    input.focus();
  }

  function complete() {
    var input = $('#sbInput'), v = input.value;
    var m = v.match(/(\S*)$/), frag = m[1];
    if (!frag) return;
    var cands = [];
    if (/^[.~/]/.test(frag) || v.trim().indexOf(' ') !== -1) {
      var dir = frag.indexOf('/') === -1 ? run.w.cwd
        : LXShell.resolve(run.w, frag.slice(0, frag.lastIndexOf('/')) || '/');
      var base = frag.slice(frag.lastIndexOf('/') + 1);
      cands = LXShell.children(run.w, dir)
        .filter(function (p) { return p.slice(p.lastIndexOf('/') + 1).indexOf(base) === 0; })
        .map(function (p) {
          var name = p.slice(p.lastIndexOf('/') + 1);
          return frag.indexOf('/') === -1 ? name : frag.slice(0, frag.lastIndexOf('/') + 1) + name;
        });
    } else {
      cands = LXShell.commands().filter(function (c) { return c.indexOf(frag) === 0; });
    }
    if (!cands.length) return;
    if (cands.length === 1) {
      input.value = v.slice(0, v.length - frag.length) + cands[0] + ' ';
    } else {
      /* longest common prefix, then show the options */
      var pre = cands[0];
      cands.forEach(function (c) {
        while (c.indexOf(pre) !== 0 && pre.length) pre = pre.slice(0, -1);
      });
      if (pre.length > frag.length) input.value = v.slice(0, v.length - frag.length) + pre;
      print(U().esc(cands.slice(0, 24).join('  ')), 'term-out term-meta');
    }
    input.focus();
  }

  function historyStep(dir) {
    if (!run.hist.length) return;
    run.histIdx = Math.max(0, Math.min(run.hist.length, run.histIdx + dir));
    $('#sbInput').value = run.hist[run.histIdx] || '';
    $('#sbInput').focus();
  }

  /* ── Lifecycle ────────────────────────────────────────────── */
  function open(id) {
    var m = (LX.missions || []).filter(function (x) { return x.id === id; })[0];
    if (!m) return;
    if (run && run.finishTimer) clearTimeout(run.finishTimer);
    run = { mission: m, w: LXShell.createWorld(m.world), ran: [], last: null,
            met: {}, revealed: 0, hist: [], histIdx: 0 };

    $('#sbList').hidden = true;
    $('#sbIntro').hidden = true;
    $('#sbDone').hidden = true;
    $('#sbRun').hidden = false;
    $('#sbTitle').textContent = m.title;
    $('#sbBrief').textContent = m.brief;
    $('#sbBriefWrap').open = true;
    $('#sbTerm').innerHTML = '';
    $('#sbObjCount').textContent = m.objectives.length ? '0 / ' + m.objectives.length : 'free play';
    if ($('#sbObjWrap')) $('#sbObjWrap').open = m.objectives.length > 0;
    $('#sbBar').style.width = '0%';
    print('Connected to ' + U().esc(m.world.host || 'sandbox') +
      '  ·  type <code>help</code> for supported commands', 'term-out term-meta');
    paintObjectives();

    $('#sbKeys').innerHTML = (m.keys || []).map(function (k) {
      return '<button class="key" data-key="' + U().esc(k) + '">' + U().esc(k) + '</button>';
    }).join('');
    $('#sbInput').value = '';
    window.scrollTo(0, 0);
  }

  function saveProgress() {
    if (!run) return;
    var store = progress(), m = run.mission;
    var clean = run.revealed === 0;
    store[m.id] = { done: true, clean: (store[m.id] && store[m.id].clean) || clean,
                    cmds: run.ran.length };
    U().LS.set('lx.sandbox', store);
    if (window.LXReview) { window.LXReview.noteStudy(0, 0); window.LXReview.render(); }
  }

  function finish() {
    var m = run.mission, fmt = U().fmt, esc = U().esc;
    saveProgress();

    var lab = m.labId ? (LX.labs || []).filter(function (l) { return l.id === m.labId; })[0] : null;
    var d = m.debrief || (lab && lab.debrief);

    $('#sbScore').textContent = 'Solved in ' + run.ran.length + ' commands' +
      (run.revealed ? ' · ' + run.revealed + ' revealed' : ' · nothing revealed');
    $('#sbVerdict').textContent = run.revealed === 0
      ? 'Every objective from memory. That is the level you want to be at walking into the interview.'
      : 'Solved. Run it again later and aim to finish without revealing anything.';

    $('#sbDebrief').innerHTML = (d ? (
      '<p class="section-label">What you did, and why it works</p>' +
      '<ol class="steps-why">' + d.why.map(function (x) { return '<li>' + fmt(x) + '</li>'; }).join('') + '</ol>' +
      '<p class="section-label">How to answer this in an interview</p>' +
      '<div class="tip interview-answer">' + fmt(d.interview) + '</div>' +
      '<p class="section-label">What prevents it next time</p>' +
      '<ul class="bullets">' + d.prevent.map(function (x) { return '<li>' + fmt(x) + '</li>'; }).join('') + '</ul>'
    ) : '') +
      '<p class="section-label">Your session</p>' +
      '<div class="term term-static">' + run.ran.map(function (cmd) {
        return '<div class="term-line"><span class="term-prompt">$ </span><span class="term-cmd">' +
          esc(cmd) + '</span></div>';
      }).join('') + '</div>';

    $('#sbRun').hidden = true;
    $('#sbDone').hidden = false;
    renderList('');
    window.scrollTo(0, 0);
  }

  function exit() {
    if (run && run.finishTimer) clearTimeout(run.finishTimer);
    run = null;
    $('#sbRun').hidden = true;
    $('#sbDone').hidden = true;
    $('#sbList').hidden = false;
    $('#sbIntro').hidden = false;
    renderList('');
    window.scrollTo(0, 0);
  }

  /* ── Events ───────────────────────────────────────────────── */
  document.addEventListener('click', function (e) {
    var t = e.target;
    var card = t.closest('[data-mission]');
    if (card) { open(card.dataset.mission); return; }
    if (!run && !t.closest('#sbBack')) return;

    if (t.closest('#sbExit') || t.closest('#sbBack')) { exit(); return; }
    if (t.closest('#sbRetry')) { open(run.mission.id); return; }
    if (t.closest('#sbRunBtn')) { var i = $('#sbInput'); var v = i.value; i.value = ''; submit(v); i.focus(); return; }
    if (t.closest('#sbTab')) { complete(); return; }
    if (t.closest('#sbUp')) { historyStep(-1); return; }
    if (t.closest('#sbDown')) { historyStep(1); return; }
    if (t.closest('#sbReset')) {
      run.w = LXShell.createWorld(run.mission.world);
      run.met = {}; run.ran = []; run.last = null;
      $('#sbTerm').innerHTML = '';
      print('Box reset to its starting state.', 'term-out term-meta');
      paintObjectives();
      return;
    }
    if (t.closest('#sbHint')) {
      var o = nextUnmet();
      if (!o) { U().toast('All objectives met'); return; }
      print('hint: ' + U().esc(o.hint || o.text), 'term-out term-hint');
      return;
    }
    if (t.closest('#sbReveal')) {
      var o2 = nextUnmet();
      if (!o2) { U().toast('All objectives met'); return; }
      run.revealed++;
      print('one way to do it: <span class="term-cmd">' + U().esc(o2.reveal || '') + '</span>', 'term-out term-hint');
      $('#sbInput').value = o2.reveal || '';
      $('#sbInput').focus();
      return;
    }
    var key = t.closest('[data-key]');
    if (key) { insert(key.dataset.key); return; }
  });

  document.addEventListener('keydown', function (e) {
    if (!run || document.activeElement !== $('#sbInput')) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      var v = $('#sbInput').value; $('#sbInput').value = ''; submit(v);
    } else if (e.key === 'Tab') { e.preventDefault(); complete(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); historyStep(-1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); historyStep(1); }
  });

  window.LXSandbox = { renderList: renderList, open: open, exit: exit };
})();
