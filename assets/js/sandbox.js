/* Sandbox UI: typed terminal against LXShell, objective tracking, debrief. */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  function U() { return window.LXUtil; }

  var run = null;  // { mission, w, ran:[], last:{}, met:{}, revealed:0, hist:[], histIdx }

  /* man / apropos / guide read the same library the rest of the app uses */
  if (window.LXShell && window.LX) LXShell.setLibrary(window.LX);

  var STOP = ('the a an of to in on for and or with that this it is are was do does how what which ' +
    'you your run using use make get set find out why here there without into from at as be').split(' ');
  function keywordOf(text) {
    var words = String(text || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)
      .filter(function (x) { return x.length > 3 && STOP.indexOf(x) === -1; });
    words.sort(function (a, b) { return b.length - a.length; });
    return words[0] || 'linux';
  }

  /* which real commands appear in a reveal — used to build the middle hint */
  function toolsIn(cmdStr) {
    var impl = LXShell.commands();
    var names = (LX.commands || []).map(function (c) { return c.name; });
    var seen = {}, out = [];
    String(cmdStr || '').split(/[|;&()]+|\s+/).forEach(function (t) {
      if (!t || t === 'sudo' || seen[t]) return;
      if (!/^[a-z][a-z0-9._-]*$/.test(t)) return;
      if (impl.indexOf(t) !== -1 || names.indexOf(t) !== -1) { seen[t] = 1; out.push(t); }
    });
    return out;
  }

  /* ── List ─────────────────────────────────────────────────── */
  function progress() { return U().LS.get('lx.sandbox', {}); }

  function renderList(q) {
    var el = $('#sbList');
    if (!el) return;
    var esc = U().esc, done = progress();
    var query = (q || '').toLowerCase();
    var tr = (U() && U().track) ? U().track() : 'all';
    var list = (LX.missions || []).filter(function (m) {
      if (!LX.track.inTrack(m, tr)) return false;
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
            '<span class="badge ' + esc(m.level) + '">' + esc(m.level) + '</span>' +
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

    /* a bare /word is a sandbox command, not a path — /var/log and friends
       still have a second slash, so they go through to the shell untouched */
    var sc = line.match(/^\/([a-z?]+)$/i);
    if (sc && SLASH[sc[1].toLowerCase()]) { SLASH[sc[1].toLowerCase()](); return; }

    var res;
    try { res = LXShell.run(run.w, line); }
    catch (e) { res = { out:'', err:'sandbox: ' + e.message, code:1 }; }

    if (res.clear) { $('#sbTerm').innerHTML = ''; }
    if (res.out) print(esc(res.out.replace(/\n$/, '')));
    if (res.err) print(esc(res.err.replace(/\n$/, '')), 'term-out term-err');

    run.ran.push(line);
    run.out.push((res.out || '') + (res.err || ''));
    run.code.push(res.code || 0);
    run.last = { cmd: line, out: (res.out || '') + (res.err || '') };
    checkObjectives();
  }

  /* ── Objectives ───────────────────────────────────────────── */
  /* out[i] and code[i] belong to ran[i] — objectives check the evidence a
     command produced, not merely that its name was typed */
  function ctx() {
    return { w: run.w, ran: run.ran, out: run.out, code: run.code, last: run.last };
  }

  /* A bubble: announced, auto-dismissed, and never focusable — the point is
     that finishing an objective does not interrupt whatever you are typing. */
  function bubble(html, cls) {
    var host = $('#sbBubbles');
    if (!host) return;
    while (host.children.length >= 3) host.removeChild(host.firstChild);
    var b = document.createElement('div');
    b.className = 'bubble' + (cls ? ' ' + cls : '');
    b.innerHTML = html;
    host.appendChild(b);
    requestAnimationFrame(function () { b.classList.add('in'); });
    setTimeout(function () {
      b.classList.remove('in');
      setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 300);
    }, cls === 'all' ? 2000 : 2800);
  }

  function metCount() {
    return run.mission.objectives.filter(function (o) { return run.met[o.id]; }).length;
  }

  function checkObjectives() {
    var m = run.mission, esc = U().esc;
    if (!m.objectives.length) return;
    var just = [];
    m.objectives.forEach(function (o) {
      if (run.met[o.id]) return;
      var pass = false;
      try { pass = !!o.done(ctx()); } catch (e) { pass = false; }
      if (pass) { run.met[o.id] = true; just.push(o); }
    });
    if (!just.length) return;

    $('#sbHint').textContent = 'Hint';   /* fresh objective, fresh ladder */
    paintObjectives();
    var total = m.objectives.length, done = metCount(), before = done - just.length;

    just.forEach(function (o) {
      print('✓ objective complete · ' + esc(o.text), 'term-out term-done');
    });

    if (done === total) {
      bubble('<b>All objectives complete!</b>' +
        '<span class="bubble-sub">' + total + ' of ' + total + ' — opening your debrief</span>', 'all');
      saveProgress();
      /* remember which run this belongs to — the user may exit before it fires */
      var owner = run;
      run.finishTimer = setTimeout(function () {
        if (run === owner) finish();
      }, 1100);
      return;
    }

    just.forEach(function (o, i) {
      bubble('<b>Objective complete!</b>' +
        '<span class="bubble-sub">' + esc(o.text) + '</span>' +
        '<span class="bubble-count">' + (before + i + 1) + ' / ' + total +
        ' · keep going</span>');
    });
  }

  function paintObjectives() {
    var m = run.mission, esc = U().esc;
    if (!m.objectives.length) {
      $('#sbObjectives').innerHTML = '<p class="muted">Free play — no objectives. Type <code>help</code> to see what is implemented.</p>';
      $('#sbNow').textContent = '';
      return;
    }
    var doneCount = m.objectives.filter(function (o) { return run.met[o.id]; }).length;
    $('#sbObjCount').textContent = doneCount + ' / ' + m.objectives.length;
    $('#sbBar').style.width = (doneCount / m.objectives.length * 100) + '%';
    /* the objective you are on stays visible in the header, so the full
       checklist can stay collapsed and the terminal keeps the screen */
    var now = nextUnmet();
    $('#sbNow').innerHTML = now
      ? '<span class="sb-now-label">Now</span> ' + esc(now.text)
      : '<span class="sb-now-label done">Done</span> every objective met';
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

  /* ── Hints, reveals, and the /slash commands ──────────────── */
  function resetBox() {
    run.w = LXShell.createWorld(run.mission.world);
    run.met = {}; run.ran = []; run.out = []; run.code = []; run.last = null;
    $('#sbTerm').innerHTML = '';
    print('Box reset to its starting state.', 'term-out term-meta');
    paintObjectives();
  }

  function showHint() {
    var o = nextUnmet();
    if (!o) { U().toast('All objectives met'); return; }
    run.hintLevel = run.hintLevel || {};
    var level = run.hintLevel[o.id] || 0;

    print('working on: ' + U().esc(o.text), 'term-out term-meta');
    if (level === 0) {
      print('hint 1/3 · ' + U().esc(o.hint || o.text), 'term-out term-hint');
    } else if (level === 1) {
      var tools = o.hint2 ? [] : toolsIn(o.reveal);
      if (o.hint2) {
        print('hint 2/3 · ' + U().esc(o.hint2), 'term-out term-hint');
      } else if (tools.length) {
        print('hint 2/3 · the tool' + (tools.length > 1 ? 's' : '') + ' you want: ' +
          tools.map(function (x) { return '<span class="term-cmd">' + U().esc(x) + '</span>'; }).join(', ') +
          '<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;read the page here: <span class="term-cmd">man ' +
          U().esc(tools[0]) + '</span>', 'term-out term-hint');
      } else {
        print('hint 2/3 · search the guide: <span class="term-cmd">guide ' +
          U().esc(keywordOf(o.text)) + '</span>', 'term-out term-hint');
      }
    } else {
      print('hint 3/3 · type <span class="term-cmd">/reveal</span> for the exact command — ' +
        'that marks the run as aided.' +
        '<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;or keep digging: <span class="term-cmd">guide ' +
        U().esc(keywordOf(o.text)) + '</span>', 'term-out term-hint');
    }
    run.hintLevel[o.id] = Math.min(2, level + 1);
    $('#sbHint').textContent = 'Hint ' + (run.hintLevel[o.id] + 1) + '/3';
  }

  function revealOne() {
    var o = nextUnmet();
    if (!o) { U().toast('All objectives met'); return; }
    run.revealed++;
    print('one way to do it: <span class="term-cmd">' + U().esc(o.reveal || '') + '</span>', 'term-out term-hint');
    $('#sbInput').value = o.reveal || '';
    $('#sbInput').focus();
  }

  function printObjectives() {
    var m = run.mission, esc = U().esc;
    if (!m.objectives.length) { print('free play — no objectives here.', 'term-out term-meta'); return; }
    print(m.objectives.map(function (o) {
      return (run.met[o.id] ? '<span class="term-done">  ✓ </span>' : '  ○ ') + esc(o.text);
    }).join('<br>') + '<br><span class="term-meta">  ' + metCount() + ' / ' + m.objectives.length +
      ' complete</span>', 'term-out');
  }

  function slashHelp() {
    print('sandbox commands (they are not shell — they never touch the box):<br>' +
      '  <span class="term-cmd">/hint</span>       next hint for the objective you are on (three levels, then /reveal)<br>' +
      '  <span class="term-cmd">/reveal</span>     the exact command, prefilled — marks the run as aided<br>' +
      '  <span class="term-cmd">/objectives</span> the checklist and where you are in it<br>' +
      '  <span class="term-cmd">/reset</span>      put the box back to its starting state<br>' +
      '  <span class="term-cmd">/quit</span>       leave without finishing<br>' +
      'for the box itself: <span class="term-cmd">help</span>, <span class="term-cmd">man &lt;cmd&gt;</span>, ' +
      '<span class="term-cmd">man -k &lt;what it does&gt;</span>, <span class="term-cmd">guide &lt;topic&gt;</span>',
      'term-out term-meta');
  }

  var SLASH = {
    hint: showHint, h: showHint,
    reveal: revealOne, show: revealOne, r: revealOne,
    objectives: printObjectives, obj: printObjectives, o: printObjectives,
    reset: resetBox,
    quit: function () { exit(); }, exit: function () { exit(); }, q: function () { exit(); },
    help: slashHelp, '?': slashHelp, commands: slashHelp
  };

  /* ── Lifecycle ────────────────────────────────────────────── */
  function open(id) {
    var m = (LX.missions || []).filter(function (x) { return x.id === id; })[0];
    if (!m) return;
    if (run && run.finishTimer) clearTimeout(run.finishTimer);
    run = { mission: m, w: LXShell.createWorld(m.world), ran: [], out: [], code: [],
            last: null, met: {}, revealed: 0, hist: [], histIdx: 0, hintLevel: {} };
    if (window.LXShell && window.LX) LXShell.setLibrary(window.LX);

    $('#sbList').hidden = true;
    $('#sbIntro').hidden = true;
    $('#sbDone').hidden = true;
    $('#sbRun').hidden = false;
    $('#sbTitle').textContent = m.title;
    $('#sbBrief').textContent = m.brief;
    $('#sbBriefWrap').open = true;
    $('#sbTerm').innerHTML = '';
    if ($('#sbBubbles')) $('#sbBubbles').innerHTML = '';
    $('#sbObjCount').textContent = m.objectives.length ? '0 / ' + m.objectives.length : 'free play';
    if ($('#sbObjWrap')) $('#sbObjWrap').open = false;
    $('#sbNow').textContent = '';
    $('#sbBar').style.width = '0%';
    print('Connected to ' + U().esc(m.world.host || 'sandbox'), 'term-out term-meta');
    print('stuck? type <span class="term-cmd">/hint</span> — three levels, then ' +
      '<span class="term-cmd">/reveal</span> for the answer. <span class="term-cmd">/help</span> lists the rest.',
      'term-out term-meta');
    print('reading up: <span class="term-cmd">man &lt;cmd&gt;</span> for the full page · ' +
      '<span class="term-cmd">man -k &lt;what it does&gt;</span> to find one · ' +
      '<span class="term-cmd">guide &lt;topic&gt;</span> to search everything · ' +
      '<span class="term-cmd">help</span>', 'term-out term-meta');
    paintObjectives();

    $('#sbKeys').innerHTML = (m.keys || []).map(function (k) {
      return '<button class="key" data-key="' + U().esc(k) + '">' + U().esc(k) + '</button>';
    }).join('');
    $('#sbInput').value = '';
    $('#sbHint').textContent = 'Hint';
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
    if ($('#sbBubbles')) $('#sbBubbles').innerHTML = '';
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
    if (t.closest('#sbReset')) { resetBox(); return; }
    if (t.closest('#sbHint')) { showHint(); return; }
    if (t.closest('#sbReveal')) { revealOne(); return; }
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
