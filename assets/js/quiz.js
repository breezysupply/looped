/* Quiz engine: five question styles, three modes.
   Styles — mcq (recall), output (read the terminal), danger (safe or not),
            order (sequence the steps), build (assemble the command).      */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  function U() { return window.LXUtil; }

  var TYPES = ['mcq', 'output', 'danger', 'order', 'build'];
  var sel = { types: TYPES.slice(), mode: 'standard' };
  var q = null;   // { list, i, correct, misses, mode, endsAt, timer }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function pick(arr, n) { return shuffle(arr.slice()).slice(0, n); }
  function inScope(x, cat, level) {
    return (cat === 'all' || x.cat === cat) && (level === 'all' || x.level === level);
  }

  /* ── Question generators ──────────────────────────────────── */

  function mcqPool(cat, level) {
    var out = LX.quiz.filter(function (x) { return inScope(x, cat, level); })
      .map(function (x) {
        return { type:'mcq', cat:x.cat, level:x.level, q:x.q, choices:x.choices.slice(), a:x.a, why:x.why };
      });

    var cmds = LX.commands.filter(function (c) { return inScope(c, cat, level); });
    if (cmds.length >= 4) {
      cmds.forEach(function (c) {
        var others = cmds.filter(function (x) { return x !== c; });
        out.push({ type:'mcq', cat:c.cat, level:c.level,
          q:'What does `' + c.name + '` do?',
          choices:[c.sum].concat(pick(others, 3).map(function (x) { return x.sum; })),
          a:0, why:c.tip || c.sum });
        out.push({ type:'mcq', cat:c.cat, level:c.level,
          q:'Which command: ' + c.sum,
          choices:[c.name].concat(pick(others, 3).map(function (x) { return x.name; })),
          a:0, why:c.name + ' — ' + (c.tip || c.sum) });
        if (c.flags && c.flags.length > 3) {
          var f = pick(c.flags, 1)[0];
          var wrong = pick(c.flags.filter(function (x) { return x !== f; }), 3)
            .map(function (x) { return x[1]; });
          if (wrong.length === 3) {
            out.push({ type:'mcq', cat:c.cat, level:c.level,
              q:'In `' + c.name + '`, what does `' + f[0] + '` do?',
              choices:[f[1]].concat(wrong), a:0, why:c.name + ' ' + f[0] + ': ' + f[1] });
          }
        }
      });
    }
    return out;
  }

  function outputPool(cat, level) {
    var out = (LX.outputQs || []).filter(function (x) { return inScope(x, cat, level); })
      .map(function (x) {
        return { type:'output', cat:x.cat, level:x.level, cmd:x.cmd, out:x.out,
                 q:x.q, choices:x.choices.slice(), a:x.a, why:x.why };
      });

    /* every interpretation step in a lab is an output-reading question already */
    (LX.labs || []).forEach(function (lab) {
      if (!inScope(lab, cat, level)) return;
      lab.steps.forEach(function (s, i) {
        if (s.kind !== 'think') return;
        var prev = null;
        for (var k = i - 1; k >= 0; k--) {
          if (lab.steps[k].kind === 'cmd') {
            prev = lab.steps[k].opts.filter(function (o) { return o.ok; })[0];
            break;
          }
        }
        if (!prev || !prev.out) return;
        var right = s.opts.filter(function (o) { return o.ok; })[0];
        var wrong = s.opts.filter(function (o) { return !o.ok; });
        if (!right || wrong.length < 2) return;
        out.push({ type:'output', cat:lab.cat, level:lab.level, cmd:prev.c, out:prev.out,
          q:s.ask, choices:[right.t].concat(pick(wrong, 3).map(function (o) { return o.t; })),
          a:0, why:right.fb });
      });
    });
    return out;
  }

  function dangerPool(cat, level) {
    return (LX.dangerQs || []).filter(function (x) { return inScope(x, cat, level); })
      .map(function (x) {
        return { type:'danger', cat:x.cat, level:x.level, q:x.q,
                 choices:x.choices.slice(), a:x.a, why:x.why };
      });
  }

  /* sequence 4 consecutive steps from a scenario or lab */
  function orderPool(cat, level) {
    var out = [];
    LX.scenarios.filter(function (s) { return inScope(s, cat, level); }).forEach(function (s) {
      if (s.steps.length < 4) return;
      var start = Math.max(0, Math.min(s.steps.length - 4, Math.floor(Math.random() * 3)));
      var slice = s.steps.slice(start, start + 4);
      out.push({ type:'order', cat:s.cat, level:s.level,
        q:'“' + s.title + '” — put these in the order you would run them.',
        items: slice.map(function (t) { return { c:t[0], why:t[1] }; }),
        why:s.key });
    });
    (LX.labs || []).forEach(function (lab) {
      if (!inScope(lab, cat, level)) return;
      var cmdSteps = lab.steps.filter(function (s) { return s.kind === 'cmd'; })
        .map(function (s) {
          var right = s.opts.filter(function (o) { return o.ok; })[0];
          return right ? { c:right.c, why:right.fb } : null;
        }).filter(Boolean);
      if (cmdSteps.length < 4) return;
      out.push({ type:'order', cat:lab.cat, level:lab.level,
        q:'“' + lab.title + '” — put the first four moves in order.',
        items: cmdSteps.slice(0, 4), why:lab.debrief.interview });
    });
    return out;
  }

  /* assemble a command from shuffled tokens */
  function buildPool(cat, level) {
    var out = [];
    LX.commands.filter(function (c) { return inScope(c, cat, level); }).forEach(function (c) {
      (c.ex || []).forEach(function (e) {
        var cmd = e[0];
        if (/[|<>$(){}"']/.test(cmd)) return;          // keep it tappable, no pipelines or quoting
        var toks = cmd.split(/\s+/);
        if (toks.length < 2 || toks.length > 5) return;
        var seen = {};
        var distract = (c.flags || []).map(function (f) { return f[0].split(/[\s|\/]+/)[0]; })
          .filter(function (f) {
            if (!/^-{1,2}[A-Za-z0-9]+$/.test(f) || toks.indexOf(f) !== -1 || seen[f]) return false;
            seen[f] = 1; return true;
          });
        var tokens = toks.concat(pick(distract, Math.min(2, distract.length)));
        out.push({ type:'build', cat:c.cat, level:c.level,
          q:e[1] + ' — build the command.',
          tokens: shuffle(tokens.slice()), answer: toks, cmdName: c.name,
          why: c.name + ' — ' + (c.tip || c.sum) });
      });
    });
    return out;
  }

  function buildList() {
    var cat = $('#quizCat').value, level = $('#quizLevel').value;
    var gen = { mcq: mcqPool, output: outputPool, danger: dangerPool, order: orderPool, build: buildPool };
    var types = sel.types.length ? sel.types : TYPES;

    if (sel.mode === 'weak') {
      var weak = (window.LXReview ? window.LXReview.weakQuestions() : []);
      return shuffle(weak).slice(0, 10);
    }

    /* even-ish spread across the selected styles */
    var want = sel.mode === 'speed' ? 30 : 10;
    var per = Math.ceil(want / types.length);
    var list = [];
    types.forEach(function (t) {
      var pool = gen[t](cat, level);
      list = list.concat(pick(pool, per));
    });
    list = shuffle(list).slice(0, want);

    /* randomise answer position for choice-based questions */
    return list.map(function (item) {
      if (!item.choices) return item;
      var right = item.choices[item.a];
      var c = shuffle(item.choices.slice());
      return Object.assign({}, item, { choices: c, a: c.indexOf(right) });
    });
  }

  /* ── Rendering ────────────────────────────────────────────── */
  var LABEL = { mcq:'Recall', output:'Read the output', danger:'Safe or not',
                order:'Order the steps', build:'Build the command' };

  function paint() {
    var esc = U().esc, fmt = U().fmt;
    var item = q.list[q.i];

    $('#quizProgress').textContent = q.mode === 'speed'
      ? 'Answered ' + q.i + ' · ' + q.correct + ' correct'
      : 'Question ' + (q.i + 1) + ' of ' + q.list.length;
    $('#quizBar').style.width = (q.i / q.list.length * 100) + '%';
    $('#quizType').textContent = LABEL[item.type];
    $('#quizType').className = 'step-kind ' + item.type;
    $('#quizQ').innerHTML = fmt(item.q);
    $('#quizFeedback').hidden = true;
    $('#quizNext').hidden = true;

    var stage = $('#quizStage');

    if (item.type === 'output') {
      stage.innerHTML =
        '<div class="term term-static"><div class="term-line">' +
          '<span class="term-prompt">$ </span><span class="term-cmd">' + esc(item.cmd) + '</span></div>' +
          '<div class="term-out">' + esc(item.out) + '</div></div>' +
        '<div class="choices">' + item.choices.map(function (c, i) {
          return '<button class="choice" data-pick="' + i + '">' + esc(c) + '</button>';
        }).join('') + '</div>';

    } else if (item.type === 'order') {
      item._picked = [];
      stage.innerHTML =
        '<div id="orderSlots" class="order-slots"></div>' +
        '<div class="choices">' + shuffle(item.items.map(function (s, i) { return [s, i]; }))
          .map(function (pair) {
            return '<button class="choice mono" data-ord="' + pair[1] + '">' +
              '<span class="opt-dollar">$</span> ' + esc(pair[0].c) + '</button>';
          }).join('') + '</div>' +
        '<button class="btn small ghost" id="orderUndo">Undo</button>';

    } else if (item.type === 'build') {
      item._picked = [];
      stage.innerHTML =
        '<div class="build-line"><span class="term-prompt">$ </span><span id="buildOut"></span><span class="caret">▌</span></div>' +
        '<div class="tokens">' + item.tokens.map(function (t, i) {
          return '<button class="token" data-tok="' + i + '">' + esc(t) + '</button>';
        }).join('') + '</div>' +
        '<div class="build-btns"><button class="btn small ghost" id="buildUndo">Undo</button>' +
        '<button class="btn small primary" id="buildRun">Run it</button></div>';

    } else {
      stage.innerHTML = '<div class="choices">' + item.choices.map(function (c, i) {
        return '<button class="choice" data-pick="' + i + '">' + esc(c) + '</button>';
      }).join('') + '</div>';
    }
  }

  function paintOrderSlots() {
    var item = q.list[q.i], esc = U().esc;
    $('#orderSlots').innerHTML = item._picked.map(function (idx, n) {
      return '<div class="slot"><span class="slot-n">' + (n + 1) + '</span><code>' +
        esc(item.items[idx].c) + '</code></div>';
    }).join('') || '<p class="muted slot-empty">Tap the commands below in the order you would run them.</p>';
  }

  function paintBuild() {
    var item = q.list[q.i], esc = U().esc;
    $('#buildOut').textContent = item._picked.map(function (i) { return item.tokens[i]; }).join(' ');
    $$('.token').forEach(function (b, i) {
      b.classList.toggle('used', item._picked.indexOf(i) !== -1);
    });
  }

  /* ── Grading ──────────────────────────────────────────────── */
  function finishItem(right, detailHtml, item) {
    var fmt = U().fmt;
    if (right) q.correct++;
    else q.misses.push(item);

    if (window.LXReview) {
      window.LXReview.recordAnswer(item, right);
      if (!right) window.LXReview.addMiss(item);
    }

    var fb = $('#quizFeedback');
    fb.className = 'feedback' + (right ? '' : ' bad');
    fb.innerHTML = '<p class="fb-text">' + (right ? '✓ Correct. ' : '✗ ') + fmt(detailHtml) + '</p>';
    fb.hidden = false;

    var last = q.i === q.list.length - 1;
    $('#quizNext').hidden = false;
    $('#quizNext').textContent = (q.mode === 'speed' && !last) ? 'Next' : (last ? 'See results' : 'Next');
    $('#quizFeedback').scrollIntoView({ block:'nearest', behavior:'smooth' });
  }

  function answerChoice(picked) {
    var item = q.list[q.i];
    var right = picked === item.a;
    $$('#quizStage .choice').forEach(function (b, i) {
      b.disabled = true;
      if (i === item.a) b.classList.add('correct');
      else if (i === picked) b.classList.add('wrong');
    });
    finishItem(right, (right ? '' : item.choices[item.a] + '. ') + item.why, item);
  }

  function checkOrder() {
    var item = q.list[q.i];
    var right = item._picked.every(function (v, i) { return v === i; }) &&
                item._picked.length === item.items.length;
    var esc = U().esc;
    var detail = item.items.map(function (s, i) {
      return (i + 1) + '. ' + s.c + ' — ' + s.why;
    }).join('  ');
    $('#quizStage').innerHTML =
      '<div class="order-review">' + item.items.map(function (s, i) {
        var yours = item._picked.indexOf(i);
        return '<div class="slot ' + (yours === i ? 'ok' : 'no') + '">' +
          '<span class="slot-n">' + (i + 1) + '</span><div><code>' + esc(s.c) + '</code>' +
          '<p class="ex-desc">' + esc(s.why) + '</p></div></div>';
      }).join('') + '</div>';
    finishItem(right, right ? item.why : 'The correct order is shown above. ' + item.why, item);
  }

  function checkBuild() {
    var item = q.list[q.i];
    var got = item._picked.map(function (i) { return item.tokens[i]; });
    var right = got.length === item.answer.length &&
                got.every(function (t, i) { return t === item.answer[i]; });
    $('#quizStage').innerHTML =
      '<div class="build-line done"><span class="term-prompt">$ </span>' +
      U().esc(got.join(' ') || '(nothing)') + '</div>' +
      (right ? '' : '<div class="build-line answer"><span class="term-prompt">$ </span>' +
        U().esc(item.answer.join(' ')) + '</div>');
    finishItem(right, right ? item.why : 'The command is `' + item.answer.join(' ') + '`. ' + item.why, item);
  }

  /* ── Session lifecycle ────────────────────────────────────── */
  function tick() {
    if (!q || q.mode !== 'speed') return;
    var left = Math.max(0, Math.round((q.endsAt - Date.now()) / 1000));
    $('#quizTimer').textContent = left + 's';
    if (left <= 0) { done(); return; }
    q.timer = setTimeout(tick, 250);
  }

  function start() {
    var list = buildList();
    if (!list.length) {
      U().toast(sel.mode === 'weak' ? 'No weak spots yet — take a quiz first' : 'No questions match those filters');
      return;
    }
    q = { list: list, i: 0, correct: 0, misses: [], mode: sel.mode };
    $('#quizStart').hidden = true;
    $('#quizDone').hidden = true;
    $('#quizRun').hidden = false;
    $('#quizTimer').hidden = sel.mode !== 'speed';
    if (sel.mode === 'speed') { q.endsAt = Date.now() + 60000; tick(); }
    paint();
    window.scrollTo(0, 0);
  }

  function next() {
    if (q.i === q.list.length - 1) { done(); return; }
    q.i++;
    paint();
    window.scrollTo(0, 0);
  }

  function done() {
    if (q.timer) clearTimeout(q.timer);
    var esc = U().esc, fmt = U().fmt;
    var answered = q.mode === 'speed' ? q.i + (q.list[q.i] && $('#quizFeedback') && !$('#quizFeedback').hidden ? 1 : 0) : q.list.length;
    answered = Math.max(answered, q.correct);
    var pct = answered ? Math.round(q.correct / answered * 100) : 0;

    if (window.LXReview) window.LXReview.noteStudy(answered, q.correct);

    $('#quizScore').textContent = q.mode === 'speed'
      ? q.correct + ' correct in 60 seconds'
      : q.correct + ' / ' + answered + '  (' + pct + '%)';
    $('#quizVerdict').textContent = pct >= 90 ? 'Interview-ready on this material.'
      : pct >= 70 ? 'Solid. Review the misses, then go again.'
      : 'Worth another pass — every miss below is now in your review deck.';

    $('#quizReview').innerHTML = q.misses.length
      ? '<p class="section-label">Review your misses</p>' + q.misses.map(function (m) {
          var right = m.type === 'build' ? m.answer.join(' ')
            : m.type === 'order' ? m.items.map(function (s) { return s.c; }).join(' → ')
            : m.choices[m.a];
          return '<div class="review-item miss"><div class="rq">' + fmt(m.q) + '</div>' +
            '<div class="ra">→ ' + esc(right) + '</div>' +
            '<div class="ra" style="margin-top:4px">' + fmt(m.why) + '</div></div>';
        }).join('')
      : '<div class="review-item">Clean sweep — nothing missed.</div>';

    $('#quizRun').hidden = true;
    $('#quizDone').hidden = false;
    renderStats();
    if (window.LXReview) window.LXReview.render();
    window.scrollTo(0, 0);
  }

  function reset() {
    if (q && q.timer) clearTimeout(q.timer);
    q = null;
    $('#quizRun').hidden = true;
    $('#quizDone').hidden = true;
    $('#quizStart').hidden = false;
    renderStats();
  }

  function renderStats() {
    var s = U().LS.get('lx.stats', { taken: 0, correct: 0 });
    $('#quizStats').textContent = s.taken
      ? 'Lifetime: ' + s.correct + '/' + s.taken + ' correct (' + Math.round(s.correct / s.taken * 100) + '%)'
      : '';
  }

  /* ── Events ───────────────────────────────────────────────── */
  document.addEventListener('click', function (e) {
    var t = e.target;

    var typeChip = t.closest('[data-type]');
    if (typeChip) {
      var ty = typeChip.dataset.type, at = sel.types.indexOf(ty);
      if (at === -1) sel.types.push(ty);
      else if (sel.types.length > 1) sel.types.splice(at, 1);
      typeChip.classList.toggle('active', sel.types.indexOf(ty) !== -1);
      return;
    }
    var modeChip = t.closest('[data-mode]');
    if (modeChip) {
      sel.mode = modeChip.dataset.mode;
      $$('#modeChips .chip').forEach(function (c) {
        c.classList.toggle('active', c.dataset.mode === sel.mode);
      });
      return;
    }
    if (t.closest('#quizStartBtn')) { start(); return; }
    if (t.closest('#quizAgain') || t.closest('#quizQuit')) { reset(); return; }
    if (t.closest('#quizNext')) { next(); return; }

    if (!q) return;
    var item = q.list[q.i];

    var pickBtn = t.closest('[data-pick]');
    if (pickBtn && !pickBtn.disabled) { answerChoice(Number(pickBtn.dataset.pick)); return; }

    var ord = t.closest('[data-ord]');
    if (ord && !ord.disabled) {
      var oi = Number(ord.dataset.ord);
      if (item._picked.indexOf(oi) === -1) {
        item._picked.push(oi);
        ord.disabled = true;
        ord.classList.add('used');
        paintOrderSlots();
        if (item._picked.length === item.items.length) checkOrder();
      }
      return;
    }
    if (t.closest('#orderUndo')) {
      var last = item._picked.pop();
      if (last !== undefined) {
        var b = document.querySelector('[data-ord="' + last + '"]');
        if (b) { b.disabled = false; b.classList.remove('used'); }
        paintOrderSlots();
      }
      return;
    }

    var tok = t.closest('[data-tok]');
    if (tok && item.type === 'build') {
      var ti = Number(tok.dataset.tok);
      if (item._picked.indexOf(ti) === -1) { item._picked.push(ti); paintBuild(); }
      return;
    }
    if (t.closest('#buildUndo')) { item._picked.pop(); paintBuild(); return; }
    if (t.closest('#buildRun')) { checkBuild(); return; }
  });

  window.LXQuiz = { renderStats: renderStats, reset: reset };

  /* topic dropdown is populated by app.js after data loads */
})();
