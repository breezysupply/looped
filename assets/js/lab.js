/* Interactive lab engine: simulated terminal, multiple-choice commands, debrief.
   Loaded before app.js; uses window.LXUtil (defined by app.js) lazily at call time. */
(function () {
  'use strict';

  var run = null;   // { lab, i, tried:[], missteps:0, firstTry:0, log:[] }

  function U() { return window.LXUtil; }
  var $ = function (s) { return document.querySelector(s); };

  function LS(k, d) { return U().LS.get(k, d); }
  function save(k, v) { U().LS.set(k, v); }

  /* ── Lab list ─────────────────────────────────────────────── */
  function progressOf(lab) {
    var done = LS('lx.labs', {});
    return done[lab.id] || null;
  }

  function labText(l) {
    return [l.title, l.brief, l.cat,
      l.steps.map(function (s) {
        return s.ask + ' ' + s.opts.map(function (o) { return (o.c || o.t) + ' ' + (o.fb || ''); }).join(' ');
      }).join(' ')].join(' ').toLowerCase();
  }

  function renderList(q) {
    var el = $('#labList');
    if (!el) return;
    var esc = U().esc;
    var query = (q || '').toLowerCase();
    var labs = LX.labs.filter(function (l) { return !query || labText(l).indexOf(query) !== -1; });

    if (!labs.length) { el.innerHTML = '<p class="empty">No lab matches that search.</p>'; return; }

    el.innerHTML = labs.map(function (l) {
      var p = progressOf(l);
      var badge = p
        ? '<span class="badge done">✓ best ' + p.best + '/' + l.steps.length + ' first try</span>'
        : '<span class="badge">not attempted</span>';
      return '<article class="card lab-card" data-lab="' + esc(l.id) + '">' +
        '<div class="card-head">' +
          '<div class="card-main">' +
            '<p class="card-title plain">' + esc(l.title) + '</p>' +
            '<p class="card-sum">' + esc(l.brief) + '</p>' +
            '<div class="card-meta">' +
              '<span class="badge">' + esc(U().catName(l.cat)) + '</span>' +
              '<span class="badge ' + l.level + '">' + l.level + '</span>' +
              '<span class="badge">~' + l.mins + ' min</span>' + badge +
            '</div>' +
          '</div>' +
          '<span class="lab-go">▶</span>' +
        '</div></article>';
    }).join('');
  }

  /* ── Terminal ─────────────────────────────────────────────── */
  function prompt() {
    return '[' + run.lab.user + '@' + run.lab.host + ' ~]$ ';
  }
  function paintTerm() {
    var esc = U().esc;
    var html = '<div class="term-line term-meta">Connected to ' + esc(run.lab.host) + '</div>' +
      run.log.map(function (e) {
        if (e.kind === 'note') return '<div class="term-line term-meta">' + esc(e.text) + '</div>';
        return '<div class="term-line"><span class="term-prompt">' + esc(e.prompt) + '</span>' +
          '<span class="term-cmd">' + esc(e.cmd) + '</span></div>' +
          (e.out ? '<div class="term-out">' + esc(e.out) + '</div>' : '');
      }).join('');
    var t = $('#labTerm');
    t.innerHTML = html;
    t.scrollTop = t.scrollHeight;
  }

  /* ── Step rendering ───────────────────────────────────────── */
  function paintStep() {
    var esc = U().esc, fmt = U().fmt;
    var lab = run.lab, step = lab.steps[run.i];

    $('#labTitle').textContent = lab.title;
    $('#labStepNo').textContent = 'Step ' + (run.i + 1) + ' of ' + lab.steps.length;
    $('#labBar').style.width = (run.i / lab.steps.length * 100) + '%';
    $('#labAsk').innerHTML = fmt(step.ask);
    $('#labKind').textContent = step.kind === 'think' ? 'Interpret' : 'Choose a command';
    $('#labKind').className = 'step-kind ' + (step.kind === 'think' ? 'think' : 'cmd');

    $('#labOpts').innerHTML = step.opts.map(function (o, idx) {
      var label = step.kind === 'think'
        ? esc(o.t)
        : '<span class="opt-dollar">$</span> ' + esc(o.c);
      return '<button class="lab-opt' + (step.kind === 'think' ? ' think' : '') +
        '" data-opt="' + idx + '">' + label + '</button>';
    }).join('');

    $('#labFb').innerHTML = '';
    $('#labFb').hidden = true;
    $('#labHintBtn').hidden = !step.hint;
    $('#labHint').hidden = true;
    $('#labHint').textContent = step.hint || '';
  }

  function partsBlock(o) {
    if (!o.parts || !o.parts.length) return '';
    var esc = U().esc;
    return '<details class="breakdown"><summary>Command breakdown</summary><div class="rows">' +
      o.parts.map(function (p) {
        return '<div class="row"><code>' + esc(p[0]) + '</code><span>' + esc(p[1]) + '</span></div>';
      }).join('') + '</div></details>';
  }

  function choose(idx) {
    var step = run.lab.steps[run.i];
    var o = step.opts[idx];
    if (run.tried.indexOf(idx) !== -1) return;
    run.tried.push(idx);

    if (step.kind === 'cmd') {
      run.log.push({ prompt: prompt(), cmd: o.c, out: o.out || '' });
      paintTerm();
    }

    var esc = U().esc, fmt = U().fmt;
    var ok = !!o.ok;
    if (ok && run.tried.length === 1) run.firstTry++;
    if (!ok) {
      run.missteps++;
      if (window.LXReview) {
        var right = step.opts.filter(function (x) { return x.ok; })[0];
        if (right) {
          window.LXReview.addLabMiss(run.lab.title, step.ask,
            (right.c ? '$ ' + right.c : right.t), right.fb, run.lab.cat);
        }
      }
    }

    var btns = document.querySelectorAll('#labOpts .lab-opt');
    Array.prototype.forEach.call(btns, function (b, i) {
      if (i === idx) b.classList.add(ok ? 'right' : 'wrong');
      if (ok) b.disabled = true;
      else if (i === idx) b.disabled = true;
    });

    var last = run.i === run.lab.steps.length - 1;
    $('#labFb').hidden = false;
    $('#labFb').className = 'lab-fb ' + (ok ? 'good' : 'bad');
    $('#labFb').innerHTML =
      '<p class="fb-text">' + (ok ? '✓ ' : '✗ ') + fmt(o.fb) + '</p>' +
      partsBlock(o) +
      (ok ? '<button class="btn primary" id="labNext">' +
        (last ? 'Finish — see the debrief' : 'Next step') + '</button>'
          : '<p class="fb-retry">Pick another approach.</p>');

    $('#labFb').scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    if (ok) {
      $('#labNext').addEventListener('click', function () {
        if (last) finish();
        else { run.i++; run.tried = []; paintStep(); window.scrollTo(0, 0); }
      });
    }
  }

  /* ── Debrief ──────────────────────────────────────────────── */
  function finish() {
    var esc = U().esc, fmt = U().fmt, lab = run.lab;
    var total = lab.steps.length;

    var store = LS('lx.labs', {});
    var prev = store[lab.id];
    store[lab.id] = {
      best: prev ? Math.max(prev.best, run.firstTry) : run.firstTry,
      runs: (prev ? prev.runs : 0) + 1
    };
    save('lx.labs', store);
    if (window.LXReview) {
      window.LXReview.noteStudy(0, 0);
      window.LXReview.render();
    }

    var pct = Math.round(run.firstTry / total * 100);
    $('#labScore').textContent = run.firstTry + ' of ' + total + ' steps solved first try';
    $('#labVerdict').textContent = pct >= 90 ? 'You could walk an interviewer through this cold.'
      : pct >= 60 ? 'Solid. Read the breakdown below, then run it again and aim for a clean pass.'
      : 'Worth a second run — the wrong turns are where the learning is, and the debrief explains each one.';

    /* every correct command in this lab, in order, with its argument breakdown */
    var used = [];
    lab.steps.forEach(function (s) {
      s.opts.forEach(function (o) {
        if (o.ok && o.c && o.parts) used.push(o);
      });
    });

    $('#labDebrief').innerHTML =
      '<p class="section-label">What you did, and why it works</p>' +
      '<ol class="steps-why">' + lab.debrief.why.map(function (w) {
        return '<li>' + fmt(w) + '</li>';
      }).join('') + '</ol>' +

      '<p class="section-label">How to answer this in an interview</p>' +
      '<div class="tip interview-answer">' + fmt(lab.debrief.interview) + '</div>' +

      '<p class="section-label">Command reference — tap to expand</p>' +
      used.map(function (o) {
        return '<details class="breakdown"><summary><code>' + esc(o.c) + '</code></summary>' +
          '<div class="rows">' + o.parts.map(function (p) {
            return '<div class="row"><code>' + esc(p[0]) + '</code><span>' + esc(p[1]) + '</span></div>';
          }).join('') + '</div>' +
          '<p class="ex-desc">' + fmt(o.fb) + '</p></details>';
      }).join('') +

      '<p class="section-label">What prevents it next time</p>' +
      '<ul class="bullets">' + lab.debrief.prevent.map(function (p) {
        return '<li>' + fmt(p) + '</li>';
      }).join('') + '</ul>' +

      '<p class="section-label">Full transcript</p>' +
      '<div class="term term-static">' + run.log.map(function (e) {
        return '<div class="term-line"><span class="term-prompt">' + esc(e.prompt) + '</span>' +
          '<span class="term-cmd">' + esc(e.cmd) + '</span></div>' +
          (e.out ? '<div class="term-out">' + esc(e.out) + '</div>' : '');
      }).join('') + '</div>';

    $('#labRun').hidden = true;
    $('#labDone').hidden = false;
    window.scrollTo(0, 0);
    renderList('');
  }

  /* ── Lifecycle ────────────────────────────────────────────── */
  function open(id) {
    var lab = LX.labs.filter(function (l) { return l.id === id; })[0];
    if (!lab) return;
    run = { lab: lab, i: 0, tried: [], missteps: 0, firstTry: 0, log: [] };
    $('#labList').hidden = true;
    $('#labIntro').hidden = true;
    $('#labDone').hidden = true;
    $('#labRun').hidden = false;
    $('#labBrief').textContent = lab.brief;
    $('#labBriefWrap').open = true;
    paintTerm();
    paintStep();
    window.scrollTo(0, 0);
  }

  function exit() {
    run = null;
    $('#labRun').hidden = true;
    $('#labDone').hidden = true;
    $('#labList').hidden = false;
    $('#labIntro').hidden = false;
    renderList('');
    window.scrollTo(0, 0);
  }

  /* ── Events ───────────────────────────────────────────────── */
  document.addEventListener('click', function (e) {
    var card = e.target.closest('[data-lab]');
    if (card) { open(card.dataset.lab); return; }

    var opt = e.target.closest('[data-opt]');
    if (opt && run && !opt.disabled) { choose(Number(opt.dataset.opt)); return; }

    if (e.target.closest('#labExit')) { exit(); return; }
    if (e.target.closest('#labBack')) { exit(); return; }
    if (e.target.closest('#labRetry')) { open(run ? run.lab.id : null); return; }
    if (e.target.closest('#labHintBtn')) {
      var h = $('#labHint');
      h.hidden = !h.hidden;
      return;
    }
  });

  window.LXLab = { renderList: renderList, open: open, exit: exit };
})();
