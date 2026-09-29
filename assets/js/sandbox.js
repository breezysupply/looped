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
    var intro = $('#sbIntro');
    if (intro) {
      if (!intro.dataset.base) intro.dataset.base = intro.innerHTML;
      intro.innerHTML = tr === 'onsite'
        ? 'Incident labs on a <b>simulated</b> Kubernetes namespace with a bounded kubectl command set — nothing here touches a real cluster. Each lab runs in <b>Guided</b> or <b>Independent</b> mode; objectives are met by evidence and repaired state, never by typing the expected text. Stuck? Type <code>/hint</code>.'
        : intro.dataset.base;
    }
    var list = (LX.missions || []).filter(function (m) {
      if (!LX.track.inTrack(m, tr)) return false;
      return !query || (m.title + ' ' + m.brief + ' ' + m.cat).toLowerCase().indexOf(query) !== -1;
    });
    if (!list.length) { el.innerHTML = '<p class="empty">No mission matches that search.</p>'; return; }

    el.innerHTML = list.map(function (m) {
      var p = done[m.id];
      if (m.onsite) return onsiteCard(m, p);
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

  /* Onsite labs list under their neutral title: the guided title names the
     cause, and the list is seen before a mode is chosen. */
  function onsiteCard(m, p) {
    var esc = U().esc, modes = (p && p.modes) || {};
    var tiers = [];
    if (modes.guided) tiers.push('<span class="badge done">✓ guided sim</span>');
    if (modes.independent) tiers.push('<span class="badge done">✓ independent sim' + (modes.independent.unaided ? ' · no hints' : '') + '</span>');
    return '<article class="card lab-card" data-mission="' + esc(m.id) + '">' +
      '<div class="card-head"><div class="card-main">' +
        '<p class="card-title plain">' + esc(m.onsite.neutralTitle) + '</p>' +
        '<p class="card-sum">' + esc(m.onsite.impact) + '</p>' +
        '<div class="card-meta"><span class="badge sim">simulation</span>' +
          '<span class="badge ' + esc(m.level) + '">' + esc(m.level) + '</span>' +
          '<span class="badge">~' + esc(m.mins) + ' min</span>' + tiers.join('') +
        '</div></div><span class="lab-go">▶</span></div></article>';
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

    /* objectives read commands as kubectl; `k` is the same command */
    run.ran.push(line.replace(/^\s*k(\s)/, 'kubectl$1'));
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
      if (pass) { run.met[o.id] = true; run.metAt[o.id] = run.ran.length; just.push(o); }
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
    if (now && hidden(now)) $('#sbNow').innerHTML = '<span class="sb-now-label">Next</span> ' + esc(stageWord(now)) + ' — hidden in independent mode';
    $('#sbObjectives').innerHTML = m.objectives.map(function (o) {
      return '<div class="obj' + (run.met[o.id] ? ' met' : '') + '">' +
        '<span class="obj-tick">' + (run.met[o.id] ? '✓' : '○') + '</span>' +
        '<span>' + (hidden(o) ? '<i>' + esc(stageWord(o)) + ' — hidden until met</i>' : esc(o.text)) + '</span></div>';
    }).join('');
  }

  /* ── onsite labs: modes, labelled hints, honest scorecard ─────
     Only missions carrying an `onsite` block get any of this; every other
     mission behaves exactly as before. */
  function isOnsite() { return !!(run && run.mission.onsite); }
  function hidden(o) { return isOnsite() && run.mode === 'independent' && !run.met[o.id]; }
  function stageWord(o) {
    return { evidence: 'Evidence', fix: 'Remediation', verify: 'Verification' }[o.stage] || 'Objective';
  }
  var MUTATING = /\bkubectl\b.*\b(delete|patch|set|scale|label|apply|create|annotate|cordon|uncordon|drain)\b|\bkubectl\b.*\brollout\s+(undo|restart)\b|\blab-registry\s+import\b|\bsed\s+-i\b/;
  function revealOf(o) { return typeof o.reveal === 'function' ? o.reveal(ctx()) : (o.reveal || ''); }

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
    run.met = {}; run.metAt = {}; run.ran = []; run.out = []; run.code = []; run.last = null;
    $('#sbTerm').innerHTML = '';
    print('Box reset to its starting state.', 'term-out term-meta');
    paintObjectives();
  }

  function showHint() {
    var o = nextUnmet();
    if (!o) { U().toast('All objectives met'); return; }
    run.hintLevel = run.hintLevel || {};
    var level = run.hintLevel[o.id] || 0;

    if (isOnsite()) { onsiteHint(o, level); return; }
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

  function onsiteHint(o, level) {
    var esc = U().esc;
    run.hintsUsed++;
    print('working on: ' + esc(hidden(o) ? stageWord(o) + ' (hidden objective)' : o.text), 'term-out term-meta');
    if (level === 0) print('hint 1/3 · conceptual · ' + esc(o.hint || 'Think about which object owns the behaviour you are seeing.'), 'term-out term-hint');
    else if (level === 1) print('hint 2/3 · diagnostic · ' + esc(o.hint2 || o.hint || 'Which read-only command would show the evidence?'), 'term-out term-hint');
    else { revealOne(); return; }
    run.hintLevel[o.id] = Math.min(2, level + 1);
    $('#sbHint').textContent = 'Hint ' + (run.hintLevel[o.id] + 1) + '/3';
  }

  function revealOne() {
    var o = nextUnmet();
    if (!o) { U().toast('All objectives met'); return; }
    run.revealed++;
    var cmd = revealOf(o);
    print((isOnsite() ? 'hint 3/3 · explicit · ' : '') + 'one way to do it: <span class="term-cmd">' + U().esc(cmd) + '</span>' +
      (isOnsite() ? '<br>&nbsp;&nbsp;other approaches can be just as valid — the lab checks the state and evidence, not this exact command' : ''),
      'term-out term-hint');
    $('#sbInput').value = cmd;
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
  function pickMode(m) {
    var esc = U().esc, p = progress()[m.id] || {}, modes = p.modes || {};
    $('#sbList').hidden = true; $('#sbIntro').hidden = true; $('#sbDone').hidden = true; $('#sbRun').hidden = true;
    $('#sbModePick').hidden = false;
    $('#sbModePick').dataset.mission = m.id;
    $('#sbModeTitle').textContent = 'Incident lab ' + m.id.replace(/\D+/g, '').replace(/^0/, '');
    $('#sbModeText').textContent = 'Guided shows the ticket as written and every objective. Independent shows a neutral ticket and hides the objectives, so the title cannot give the cause away.';
    var hist = [];
    if (modes.guided) hist.push('guided simulation completed');
    if (modes.independent) hist.push('independent simulation completed' + (modes.independent.unaided ? ' without hints' : ' with hints'));
    $('#sbModeHistory').textContent = hist.length ? 'Your record: ' + hist.join(' · ') + '.' : '';
    window.scrollTo(0, 0);
    var first = $('#sbModePick [data-sb-mode="guided"]');
    if (first) first.focus();
  }

  function open(id, opts) {
    var m = (LX.missions || []).filter(function (x) { return x.id === id; })[0];
    if (!m) return;
    opts = opts || {};
    if (run && run.finishTimer) clearTimeout(run.finishTimer);
    if (m.onsite && !opts.mode) { run = null; pickMode(m); return; }
    if ($('#sbModePick')) $('#sbModePick').hidden = true;
    run = { mission: m, w: LXShell.createWorld(m.world), ran: [], out: [], code: [],
            last: null, met: {}, metAt: {}, revealed: 0, hintsUsed: 0, hist: [], histIdx: 0, hintLevel: {},
            mode: m.onsite ? opts.mode : null };
    if (window.LXShell && window.LX) LXShell.setLibrary(window.LX);

    $('#sbList').hidden = true;
    $('#sbIntro').hidden = true;
    $('#sbDone').hidden = true;
    $('#sbRun').hidden = false;
    var indep = run.mode === 'independent';
    $('#sbTitle').textContent = indep ? m.onsite.neutralTitle : m.title;
    $('#sbBrief').textContent = indep ? m.onsite.neutralBrief : m.brief;
    if ($('#sbSimBanner')) {
      $('#sbSimBanner').hidden = !m.onsite;
      $('#sbSimWrap').hidden = !m.onsite;
      if (m.onsite) {
        $('#sbModeLabel').textContent = indep ? 'independent mode' : 'guided mode';
        var spoil = (m.onsite.spoilers || []).map(function (x) { return x.toLowerCase(); });
        var assume = (m.onsite.assumptions || []).filter(function (a) {
          return !indep || !spoil.some(function (w) { return a.toLowerCase().indexOf(w) !== -1; });
        });
        $('#sbSim').innerHTML =
          (assume.length ? '<p class="section-label">Assumptions for this lab</p><ul class="bullets">' +
            assume.map(function (a) { return '<li>' + U().fmt(a) + '</li>'; }).join('') + '</ul>' : '') +
          '<p class="section-label">What the simulation simplifies</p><ul class="bullets">' +
          (m.onsite.simplified || []).map(function (a) { return '<li>' + U().fmt(a) + '</li>'; }).join('') + '</ul>' +
          '<p class="muted small">Completing this shows you can reason through the mechanism in a model. It is not evidence of production experience.</p>';
        $('#sbSimWrap').open = false;
      }
    }
    $('#sbBriefWrap').open = true;
    $('#sbTerm').innerHTML = '';
    if ($('#sbBubbles')) $('#sbBubbles').innerHTML = '';
    $('#sbObjCount').textContent = m.objectives.length ? '0 / ' + m.objectives.length : 'free play';
    if ($('#sbObjWrap')) $('#sbObjWrap').open = false;
    $('#sbNow').textContent = '';
    $('#sbBar').style.width = '0%';
    if (m.onsite) print('SIMULATION — a modelled cluster (context ' + U().esc(run.w.k8sModel.context) + ', namespace ' +
      U().esc(run.w.k8sModel.ns) + '). Only the documented kubectl subset works; anything else says so. Each command advances the clock 10s.', 'term-out term-meta');
    print('Connected to ' + U().esc(m.world.host || 'sandbox'), 'term-out term-meta');
    print('stuck? type <span class="term-cmd">/hint</span> — three levels, then ' +
      '<span class="term-cmd">/reveal</span> for the answer. <span class="term-cmd">/help</span> lists the rest.',
      'term-out term-meta');
    print('reading up: <span class="term-cmd">man &lt;cmd&gt;</span> for the full page · ' +
      '<span class="term-cmd">man -k &lt;what it does&gt;</span> to find one · ' +
      '<span class="term-cmd">guide &lt;topic&gt;</span> to search everything · ' +
      '<span class="term-cmd">help</span>', 'term-out term-meta');
    paintObjectives();

    $('#sbKeys').innerHTML = ((m.onsite && indep ? m.onsite.palette : m.keys) || []).map(function (k) {
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
    var prev = store[m.id] || {};
    store[m.id] = { done: true, clean: prev.clean || clean, cmds: run.ran.length };
    if (m.onsite) {
      /* guided and independent are separate evidence tiers; "unaided" means
         no hints and no reveals at all, and it is never downgraded once earned */
      var modes = prev.modes || {}, mine = modes[run.mode] || {};
      modes[run.mode] = { done: true, at: Date.now(), runs: (mine.runs || 0) + 1,
                          unaided: mine.unaided || (run.revealed === 0 && run.hintsUsed === 0),
                          risky: run.w.k8sModel ? run.w.k8sModel.risky.length : 0 };
      store[m.id].modes = modes;
      store[m.id].clean = prev.clean || (run.revealed === 0 && run.hintsUsed === 0);
    }
    U().LS.set('lx.sandbox', store);
    if (window.LXReview) { window.LXReview.noteStudy(0, 0); window.LXReview.render(); }
  }

  function finish() {
    var m = run.mission, fmt = U().fmt, esc = U().esc;
    saveProgress();

    var lab = m.labId ? (LX.labs || []).filter(function (l) { return l.id === m.labId; })[0] : null;
    var d = m.debrief || (lab && lab.debrief);

    if (m.onsite) { onsiteDebrief(); return; }
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

  /* Qualitative, never a number: each line is backed by what the session
     actually did, and risky actions come from the model's own log. */
  function scorecard() {
    var m = run.mission, firstChange = -1;
    run.ran.forEach(function (c, i) { if (firstChange < 0 && MUTATING.test(c)) firstChange = i + 1; });
    var ev = m.objectives.filter(function (o) { return o.stage === 'evidence'; });
    var before = ev.filter(function (o) { return run.metAt[o.id] && (firstChange < 0 || run.metAt[o.id] <= firstChange); }).length;
    var changes = run.ran.filter(function (c) { return MUTATING.test(c); }).length;
    var risky = (run.w.k8sModel && run.w.k8sModel.risky) || [];
    var fixes = m.objectives.filter(function (o) { return o.stage === 'fix'; });
    var lastFix = Math.max.apply(null, fixes.map(function (o) { return run.metAt[o.id] || 0; }));
    var verified = m.objectives.filter(function (o) { return o.stage === 'verify'; }).every(function (o) { return (run.metAt[o.id] || 0) >= lastFix; });
    return [
      { k: 'Evidence before change', v: before === ev.length ? 'Strong' : before ? 'Partial' : 'Missing',
        why: before + ' of ' + ev.length + ' evidence objectives were established before your first change' + (firstChange < 0 ? ' (you made no changes before them)' : '') + '.' },
      { k: 'Blast radius', v: risky.length ? 'Review' : 'Contained',
        why: risky.length ? risky.length + ' action' + (risky.length > 1 ? 's' : '') + ' flagged below.' : 'No risky actions were logged.' },
      { k: 'Remediation', v: changes <= fixes.length + 2 ? 'Targeted' : 'Broad',
        why: changes + ' state-changing command' + (changes === 1 ? '' : 's') + ' for ' + fixes.length + ' repair objective' + (fixes.length > 1 ? 's' : '') + '.' },
      { k: 'Verification', v: verified ? 'After the fix' : 'Incomplete',
        why: verified ? 'Verified with a check run after the state was repaired.' : 'A verification ran before the final repair.' }
    ];
  }

  function onsiteDebrief() {
    var m = run.mission, o = m.onsite, fmt = U().fmt, esc = U().esc;
    var aided = run.revealed > 0 || run.hintsUsed > 0;
    $('#sbScore').textContent = (run.mode === 'independent' ? 'Independent' : 'Guided') + ' simulation complete';
    $('#sbVerdict').textContent = (aided ? 'Completed with ' + run.hintsUsed + ' hint' + (run.hintsUsed === 1 ? '' : 's') +
      (run.revealed ? ' and ' + run.revealed + ' explicit reveal' + (run.revealed === 1 ? '' : 's') : '') + '. ' : 'Completed without hints. ') +
      'This is simulation evidence: it shows you can reason through the mechanism, not that you have done it on a production cluster.';
    var risky = (run.w.k8sModel && run.w.k8sModel.risky) || [];
    var saved = (U().LS.get('lx.onsite', {}).summaries || {})[m.id] || {};
    $('#sbDebrief').innerHTML =
      '<p class="section-label">How you worked (qualitative — no score)</p>' +
      '<dl class="scorecard">' + scorecard().map(function (x) {
        return '<div><dt>' + esc(x.k) + '</dt><dd><b>' + esc(x.v) + '</b> · ' + esc(x.why) + '</dd></div>'; }).join('') + '</dl>' +
      (risky.length ? '<p class="section-label">Actions worth a second look</p><ul class="bullets">' + risky.map(function (r) {
        return '<li><code>' + esc(r.cmd) + '</code> — ' + esc(r.why) + '</li>'; }).join('') + '</ul>' : '') +
      '<p class="section-label">The mechanism</p><div class="tip">' + fmt(o.mechanism) + '</div>' +
      '<p class="section-label">Alternative hypotheses and how the evidence rules them out</p><ul class="bullets">' +
        o.alternatives.map(function (a) { return '<li><b>' + esc(a.h) + '</b> — ' + fmt(a.out) + '</li>'; }).join('') + '</ul>' +
      '<p class="section-label">Clues that were not the cause</p><ul class="bullets">' +
        o.clues.map(function (x) { return '<li>' + fmt(x) + '</li>'; }).join('') + '</ul>' +
      '<p class="section-label">Say it out loud: incident summary</p>' +
      '<p>' + esc(o.summaryPrompt) + '</p>' +
      '<label class="sr-only" for="sbSummary">Your incident summary</label>' +
      '<textarea id="sbSummary" class="notes-input" rows="5" placeholder="Write it in your own words, then check it against the list.">' + esc(saved.text || '') + '</textarea>' +
      '<div class="checklist" id="sbSummaryChecks">' + o.summaryChecklist.map(function (x, i) {
        return '<label><input type="checkbox" data-sum-check="' + i + '"' + ((saved.checks || [])[i] ? ' checked' : '') + '> ' + esc(x) + '</label>'; }).join('') + '</div>' +
      '<button class="btn small" id="sbSummarySave">Save summary</button> <span class="muted small">Self-assessed — nothing grades this text.</span>' +
      '<p class="section-label">Study next</p><div class="chip-links">' +
        o.prereqs.map(function (id) { var l = (LX.onsiteLessons || []).filter(function (x) { return x.id === id; })[0];
          return '<button class="chip" data-prep-open="lesson:' + esc(id) + '">' + esc(l ? l.title : id) + '</button>'; }).join('') +
        o.questions.map(function (id) { var q = (LX.onsiteQ || []).filter(function (x) { return x.id === id; })[0];
          return q ? '<button class="chip" data-prep-open="question:' + esc(id) + '">' + esc(q.q.length > 60 ? q.q.slice(0, 57) + '…' : q.q) + '</button>' : ''; }).join('') + '</div>' +
      '<p class="section-label">References</p><ul class="bullets">' + o.refs.map(function (r) {
        return '<li><a href="' + esc(r.u) + '" target="_blank" rel="noopener">' + esc(r.t) + '</a></li>'; }).join('') + '</ul>' +
      '<p class="section-label">Your session</p>' +
      '<div class="term term-static">' + run.ran.map(function (cmd) {
        return '<div class="term-line"><span class="term-prompt">$ </span><span class="term-cmd">' + esc(cmd) + '</span></div>'; }).join('') + '</div>';
    $('#sbRun').hidden = true;
    $('#sbDone').hidden = false;
    renderList('');
    window.scrollTo(0, 0);
  }

  function saveSummary() {
    if (!run) return;
    var st = U().LS.get('lx.onsite', {});
    st.summaries = st.summaries || {};
    st.summaries[run.mission.id] = { text: ($('#sbSummary') || {}).value || '', at: Date.now(),
      checks: $$('#sbSummaryChecks [data-sum-check]').map(function (b) { return b.checked; }) };
    U().LS.set('lx.onsite', st);
    U().toast('Summary saved');
  }

  function exit() {
    if (run && run.finishTimer) clearTimeout(run.finishTimer);
    if ($('#sbBubbles')) $('#sbBubbles').innerHTML = '';
    run = null;
    $('#sbRun').hidden = true;
    $('#sbDone').hidden = true;
    if ($('#sbModePick')) $('#sbModePick').hidden = true;
    $('#sbList').hidden = false;
    $('#sbIntro').hidden = false;
    renderList('');
    window.scrollTo(0, 0);
  }

  /* ── Events ───────────────────────────────────────────────── */
  document.addEventListener('click', function (e) {
    var t = e.target;
    var card = t.closest('[data-mission]');
    if (card && !t.closest('#sbModePick')) { open(card.dataset.mission); return; }
    var mode = t.closest('[data-sb-mode]');
    if (mode) { open($('#sbModePick').dataset.mission, { mode: mode.dataset.sbMode }); return; }
    if (t.closest('#sbModeBack')) { exit(); return; }
    if (t.closest('#sbSummarySave')) { saveSummary(); return; }
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
