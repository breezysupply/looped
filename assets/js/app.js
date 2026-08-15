/* Linux Pocket Guide — rendering, filtering, quiz engine, persistence */
(function () {
  'use strict';

  var CATS = {
    files:'Files & Nav', text:'Text', search:'Search', perms:'Permissions',
    procs:'Processes', disk:'Disk', users:'Users', net:'Networking',
    transfer:'SSH & Transfer', pkg:'Packages', sys:'System & systemd',
    shell:'Shell', cloud:'Cloud / EC2', ops:'On-call', behavioral:'Behavioral'
  };
  var catName = function (c) { return CATS[c] || c; };

  var LS = {
    get: function (k, d) {
      try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }
      catch (e) { return d; }
    },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  var state = {
    view: LS.get('lx.view', 'commands'),
    cat: 'all',
    level: 'all',
    scenCat: 'all',
    drillCat: 'all',
    q: '',
    saved: LS.get('lx.saved', []),
    stats: LS.get('lx.stats', { taken: 0, correct: 0 })
  };

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }
  /* escape, then render `backticks` as inline code */
  function fmt(s) {
    return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');
  }
  function hl(s) {
    var t = fmt(s);
    if (!state.q) return t;
    var rx = new RegExp('(' + state.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
    return t.replace(rx, '<mark>$1</mark>');
  }

  /* shared with lab.js */
  window.LXUtil = { esc: esc, fmt: fmt, LS: LS, catName: catName,
                    toast: function (m) { toast(m); } };

  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove('show'); }, 1400);
  }

  /* ── Saved items ──────────────────────────────────────────── */
  function isSaved(id) { return state.saved.indexOf(id) !== -1; }
  function toggleSaved(id) {
    var i = state.saved.indexOf(id);
    if (i === -1) { state.saved.push(id); toast('Saved'); }
    else { state.saved.splice(i, 1); toast('Removed'); }
    LS.set('lx.saved', state.saved);
    renderAll();
  }

  /* ── Matching / search ────────────────────────────────────── */
  function cmdText(c) {
    return [c.name, c.sum, c.syntax, c.tip, (c.related || []).join(' '),
      (c.flags || []).map(function (f) { return f.join(' '); }).join(' '),
      (c.ex || []).map(function (e) { return e.join(' '); }).join(' ')].join(' ').toLowerCase();
  }
  function scenText(s) {
    return [s.title, s.situation, s.key, (s.followups || []).join(' '),
      s.steps.map(function (t) { return t.join(' '); }).join(' ')].join(' ').toLowerCase();
  }
  function drillText(d) { return [d.q, d.a, (d.points || []).join(' ')].join(' ').toLowerCase(); }

  function filteredCommands() {
    var q = state.q.toLowerCase();
    return LX.commands.filter(function (c) {
      if (state.cat !== 'all' && c.cat !== state.cat) return false;
      if (state.level !== 'all' && c.level !== state.level) return false;
      return !q || cmdText(c).indexOf(q) !== -1;
    });
  }
  function filteredScenarios() {
    var q = state.q.toLowerCase();
    return LX.scenarios.filter(function (s) {
      if (state.scenCat !== 'all' && s.cat !== state.scenCat) return false;
      return !q || scenText(s).indexOf(q) !== -1;
    });
  }
  function filteredDrills() {
    var q = state.q.toLowerCase();
    return LX.drills.filter(function (d) {
      if (state.drillCat !== 'all' && d.cat !== state.drillCat) return false;
      return !q || drillText(d).indexOf(q) !== -1;
    });
  }

  /* ── Card builders ────────────────────────────────────────── */
  function head(id, title, sum, badges, mono) {
    return '<div class="card-head" data-toggle>' +
      '<div class="card-main">' +
        '<p class="card-title' + (mono ? '' : ' plain') + '">' + hl(title) + '</p>' +
        (sum ? '<p class="card-sum">' + hl(sum) + '</p>' : '') +
        '<div class="card-meta">' + badges + '</div>' +
      '</div>' +
      '<button class="star' + (isSaved(id) ? ' on' : '') + '" data-save="' + esc(id) +
        '" aria-label="Save">' + (isSaved(id) ? '★' : '☆') + '</button>' +
    '</div>';
  }

  function exBlock(list) {
    return list.map(function (e) {
      return '<div class="ex"><div class="ex-cmd"><code>' + esc(e[0]) + '</code>' +
        '<button class="copy" data-copy="' + esc(e[0]) + '" aria-label="Copy">⧉</button></div>' +
        '<p class="ex-desc">' + esc(e[1]) + '</p></div>';
    }).join('');
  }
  function rowBlock(list) {
    return '<div class="rows">' + list.map(function (r) {
      return '<div class="row"><code>' + esc(r[0]) + '</code><span>' + esc(r[1]) + '</span></div>';
    }).join('') + '</div>';
  }

  function commandCard(c) {
    var id = 'c:' + c.name;
    var badges = '<span class="badge">' + catName(c.cat) + '</span>' +
      '<span class="badge ' + c.level + '">' + c.level + '</span>';
    var body = '<div class="syntax">' + esc(c.syntax) + '</div>' +
      (c.flags ? '<p class="section-label">Key options</p>' + rowBlock(c.flags) : '') +
      '<p class="section-label">Examples</p>' + exBlock(c.ex) +
      (c.tip ? '<div class="tip"><b>Interview note.</b> ' + fmt(c.tip) + '</div>' : '') +
      (c.related ? '<div class="related">' + c.related.map(function (r) {
        return '<button class="rel-link" data-goto="' + esc(r) + '">' + esc(r) + '</button>';
      }).join('') + '</div>' : '');
    return '<article class="card" data-id="' + id + '">' +
      head(id, c.name, c.sum, badges, true) +
      '<div class="card-body">' + body + '</div></article>';
  }

  function scenarioCard(s) {
    var id = 's:' + s.title;
    var badges = '<span class="badge">' + catName(s.cat) + '</span>' +
      '<span class="badge ' + s.level + '">' + s.level + '</span>' +
      '<span class="badge">scenario</span>';
    var body = '<p class="situation">' + fmt(s.situation) + '</p>' +
      '<p class="section-label">Work through it</p>' + exBlock(s.steps) +
      (s.key ? '<div class="tip"><b>What they are scoring.</b> ' + fmt(s.key) + '</div>' : '') +
      (s.followups ? '<p class="section-label">Likely follow-ups</p><ul class="bullets">' +
        s.followups.map(function (f) { return '<li>' + fmt(f) + '</li>'; }).join('') + '</ul>' : '');
    return '<article class="card" data-id="' + id + '">' +
      head(id, s.title, s.situation, badges, false) +
      '<div class="card-body">' + body + '</div></article>';
  }

  function drillCard(d) {
    var id = 'd:' + d.q;
    var badges = '<span class="badge">' + catName(d.cat) + '</span>' +
      '<span class="badge ' + d.level + '">' + d.level + '</span>' +
      '<span class="badge">drill</span>';
    var body = '<p class="section-label">Model answer</p>' +
      '<p class="answer">' + fmt(d.a) + '</p>' +
      (d.points ? '<p class="section-label">Points to hit</p><ul class="bullets">' +
        d.points.map(function (p) { return '<li>' + fmt(p) + '</li>'; }).join('') + '</ul>' : '');
    return '<article class="card" data-id="' + id + '">' +
      head(id, d.q, '', badges, false) +
      '<div class="card-body">' + body + '</div></article>';
  }

  function cardFor(id) {
    var key = id.slice(2);
    if (id[0] === 'c') {
      var c = LX.commands.filter(function (x) { return x.name === key; })[0];
      return c ? commandCard(c) : '';
    }
    if (id[0] === 's') {
      var s = LX.scenarios.filter(function (x) { return x.title === key; })[0];
      return s ? scenarioCard(s) : '';
    }
    var d = LX.drills.filter(function (x) { return x.q === key; })[0];
    return d ? drillCard(d) : '';
  }

  /* ── Chips ────────────────────────────────────────────────── */
  function buildChips(el, items, current, attr) {
    el.innerHTML = ['all'].concat(items).map(function (c) {
      return '<button class="chip' + (c === current ? ' active' : '') + '" ' + attr + '="' + c + '">' +
        (c === 'all' ? 'All' : catName(c)) + '</button>';
    }).join('');
  }
  function usedCats(list) {
    var seen = [];
    list.forEach(function (x) { if (seen.indexOf(x.cat) === -1) seen.push(x.cat); });
    return Object.keys(CATS).filter(function (c) { return seen.indexOf(c) !== -1; });
  }

  /* ── Renderers ────────────────────────────────────────────── */
  function otherHits() {
    var bits = [];
    if (state.q) {
      var c = filteredCommands().length, s = filteredScenarios().length, d = filteredDrills().length;
      if (state.view !== 'commands' && c) bits.push(c + ' in Commands');
      if (state.view !== 'scenarios' && s) bits.push(s + ' in Scenarios');
      if (state.view !== 'drills' && d) bits.push(d + ' in Drills');
    }
    return bits.length ? '<p class="empty">No match here. ' + bits.join(' · ') + '.</p>' : '<p class="empty">Nothing matches.</p>';
  }

  function renderCommands() {
    buildChips($('#catChips'), usedCats(LX.commands), state.cat, 'data-cat');
    $$('#levelChips .chip').forEach(function (b) {
      b.classList.toggle('active', b.dataset.level === state.level);
    });
    var list = filteredCommands();
    $('#cmdCount').textContent = list.length + ' of ' + LX.commands.length + ' commands';
    $('#cmdList').innerHTML = list.length ? list.map(commandCard).join('') : otherHits();
  }
  function renderScenarios() {
    buildChips($('#scenChips'), usedCats(LX.scenarios), state.scenCat, 'data-scat');
    var list = filteredScenarios();
    $('#scenCount').textContent = list.length + ' of ' + LX.scenarios.length + ' scenarios';
    $('#scenList').innerHTML = list.length ? list.map(scenarioCard).join('') : otherHits();
  }
  function renderDrills() {
    buildChips($('#drillChips'), usedCats(LX.drills), state.drillCat, 'data-dcat');
    var list = filteredDrills();
    $('#drillCount').textContent = list.length + ' of ' + LX.drills.length + ' drills';
    $('#drillList').innerHTML = list.length ? list.map(drillCard).join('') : otherHits();
  }
  function renderSaved() {
    var html = state.saved.map(cardFor).filter(Boolean).join('');
    $('#savedCount').textContent = state.saved.length + ' saved';
    $('#savedList').innerHTML = html ||
      '<p class="empty">Tap ☆ on anything to keep it here — build your own revision list.</p>';
  }
  function renderStats() {
    var s = state.stats;
    $('#quizStats').textContent = s.taken
      ? 'Lifetime: ' + s.correct + '/' + s.taken + ' correct (' + Math.round(s.correct / s.taken * 100) + '%)'
      : '';
  }
  function renderLabs() {
    if (window.LXLab) window.LXLab.renderList(state.q);
  }
  function renderAll() {
    renderCommands(); renderScenarios(); renderDrills(); renderLabs();
    renderSaved(); renderStats();
  }

  /* ── View switching ───────────────────────────────────────── */
  function setView(v) {
    state.view = v;
    LS.set('lx.view', v);
    $$('.view').forEach(function (s) { s.classList.toggle('active', s.id === 'view-' + v); });
    $$('.tab').forEach(function (t) {
      var on = t.dataset.view === v;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    window.scrollTo(0, 0);
  }

  /* ── Quiz engine ──────────────────────────────────────────── */
  var quiz = { qs: [], i: 0, correct: 0, misses: [] };

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function sample(arr, n, exclude) {
    return shuffle(arr.filter(function (x) { return x !== exclude; })).slice(0, n);
  }

  function generatedQuestions(cat, level) {
    var pool = LX.commands.filter(function (c) {
      return (cat === 'all' || c.cat === cat) && (level === 'all' || c.level === level);
    });
    if (pool.length < 4) return [];
    var out = [];
    pool.forEach(function (c) {
      // name → purpose
      var wrongSums = sample(pool, 3, c).map(function (x) { return x.sum; });
      out.push({
        q: 'What does `' + c.name + '` do?',
        choices: [c.sum].concat(wrongSums), a: 0, cat: c.cat, level: c.level,
        why: c.tip || c.sum
      });
      // purpose → name
      var wrongNames = sample(pool, 3, c).map(function (x) { return x.name; });
      out.push({
        q: 'Which command: ' + c.sum,
        choices: [c.name].concat(wrongNames), a: 0, cat: c.cat, level: c.level,
        why: c.name + ' — ' + (c.tip || c.sum)
      });
      // flag meaning
      if (c.flags && c.flags.length > 3) {
        var f = c.flags[Math.floor(Math.random() * c.flags.length)];
        var others = sample(c.flags.filter(function (x) { return x !== f; }), 3)
          .map(function (x) { return x[1]; });
        if (others.length === 3) {
          out.push({
            q: 'In `' + c.name + '`, what does `' + f[0] + '` do?',
            choices: [f[1]].concat(others), a: 0, cat: c.cat, level: c.level,
            why: c.name + ' ' + f[0] + ': ' + f[1]
          });
        }
      }
    });
    return out;
  }

  function buildQuiz() {
    var cat = $('#quizCat').value, level = $('#quizLevel').value;
    var handwritten = LX.quiz.filter(function (q) {
      return (cat === 'all' || q.cat === cat) && (level === 'all' || q.level === level);
    });
    var pool = shuffle(handwritten.slice()).slice(0, 6)
      .concat(shuffle(generatedQuestions(cat, level)).slice(0, 10));
    pool = shuffle(pool).slice(0, 10);
    // randomise answer position per question
    quiz.qs = pool.map(function (q) {
      var right = q.choices[q.a];
      var choices = shuffle(q.choices.slice());
      return { q: q.q, choices: choices, a: choices.indexOf(right), why: q.why };
    });
    quiz.i = 0; quiz.correct = 0; quiz.misses = [];
  }

  function showQuestion() {
    var q = quiz.qs[quiz.i];
    $('#quizProgress').textContent = 'Question ' + (quiz.i + 1) + ' of ' + quiz.qs.length;
    $('#quizBar').style.width = (quiz.i / quiz.qs.length * 100) + '%';
    $('#quizQ').innerHTML = fmt(q.q);
    $('#quizChoices').innerHTML = q.choices.map(function (c, i) {
      return '<button class="choice" data-choice="' + i + '">' + esc(c) + '</button>';
    }).join('');
    $('#quizFeedback').hidden = true;
    $('#quizNext').hidden = true;
  }

  function answer(pick) {
    var q = quiz.qs[quiz.i];
    var right = pick === q.a;
    if (right) quiz.correct++;
    else quiz.misses.push({ q: q.q, correct: q.choices[q.a], why: q.why });

    $$('#quizChoices .choice').forEach(function (b, i) {
      b.disabled = true;
      if (i === q.a) b.classList.add('correct');
      else if (i === pick) b.classList.add('wrong');
    });
    var fb = $('#quizFeedback');
    fb.className = 'feedback' + (right ? '' : ' bad');
    fb.innerHTML = fmt((right ? '✓ Correct. ' : '✗ ' + q.choices[q.a] + '. ') + q.why);
    fb.hidden = false;
    $('#quizNext').hidden = false;
    $('#quizNext').textContent = quiz.i === quiz.qs.length - 1 ? 'See results' : 'Next';
  }

  function finishQuiz() {
    var total = quiz.qs.length;
    state.stats.taken += total;
    state.stats.correct += quiz.correct;
    LS.set('lx.stats', state.stats);
    renderStats();

    var pct = Math.round(quiz.correct / total * 100);
    $('#quizScore').textContent = quiz.correct + ' / ' + total + '  (' + pct + '%)';
    $('#quizVerdict').textContent = pct >= 90 ? 'Interview-ready on this material.'
      : pct >= 70 ? 'Solid. Review the misses below and go again.'
      : 'Worth another pass — read the misses, then retake.';
    $('#quizReview').innerHTML = quiz.misses.length
      ? '<p class="section-label">Review your misses</p>' + quiz.misses.map(function (m) {
          return '<div class="review-item miss"><div class="rq">' + fmt(m.q) + '</div>' +
            '<div class="ra">→ ' + esc(m.correct) + '</div>' +
            '<div class="ra" style="margin-top:4px">' + fmt(m.why) + '</div></div>';
        }).join('')
      : '<div class="review-item">Clean sweep — nothing missed.</div>';

    $('#quizRun').hidden = true;
    $('#quizDone').hidden = false;
  }

  function startQuiz() {
    buildQuiz();
    if (!quiz.qs.length) { toast('Not enough questions for that filter'); return; }
    $('#quizStart').hidden = true;
    $('#quizDone').hidden = true;
    $('#quizRun').hidden = false;
    showQuestion();
  }
  function resetQuiz() {
    $('#quizRun').hidden = true;
    $('#quizDone').hidden = true;
    $('#quizStart').hidden = false;
  }

  /* ── Events ───────────────────────────────────────────────── */
  document.addEventListener('click', function (e) {
    var t = e.target;

    var tab = t.closest('.tab');
    if (tab) { setView(tab.dataset.view); return; }

    var save = t.closest('[data-save]');
    if (save) { e.stopPropagation(); toggleSaved(save.dataset.save); return; }

    var copy = t.closest('[data-copy]');
    if (copy) {
      e.stopPropagation();
      var txt = copy.dataset.copy;
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(function () { toast('Copied'); });
      else {
        var ta = document.createElement('textarea');
        ta.value = txt; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); toast('Copied'); } catch (err) {}
        document.body.removeChild(ta);
      }
      return;
    }

    var go = t.closest('[data-goto]');
    if (go) {
      e.stopPropagation();
      state.q = go.dataset.goto;
      state.cat = 'all'; state.level = 'all';
      $('#search').value = state.q;
      $('#clearSearch').hidden = false;
      setView('commands');
      renderAll();
      return;
    }

    var toggle = t.closest('[data-toggle]');
    if (toggle) { toggle.closest('.card').classList.toggle('open'); return; }

    var chip = t.closest('.chip');
    if (chip) {
      if (chip.dataset.cat) { state.cat = chip.dataset.cat; renderCommands(); }
      else if (chip.dataset.level) { state.level = chip.dataset.level; renderCommands(); }
      else if (chip.dataset.scat) { state.scenCat = chip.dataset.scat; renderScenarios(); }
      else if (chip.dataset.dcat) { state.drillCat = chip.dataset.dcat; renderDrills(); }
      return;
    }

    var choice = t.closest('[data-choice]');
    if (choice && !choice.disabled) { answer(Number(choice.dataset.choice)); return; }
  });

  var searchEl = $('#search');
  searchEl.addEventListener('input', function () {
    state.q = searchEl.value.trim();
    $('#clearSearch').hidden = !state.q;
    renderCommands(); renderScenarios(); renderDrills(); renderLabs();
  });
  $('#clearSearch').addEventListener('click', function () {
    searchEl.value = ''; state.q = '';
    $('#clearSearch').hidden = true;
    renderCommands(); renderScenarios(); renderDrills(); renderLabs();
    searchEl.focus();
  });

  $('#themeBtn').addEventListener('click', function () {
    var next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    LS.set('lx.theme', next);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', next === 'dark' ? '#0d1117' : '#f6f8fa');
  });

  $('#quizStartBtn').addEventListener('click', startQuiz);
  $('#quizAgain').addEventListener('click', resetQuiz);
  $('#quizQuit').addEventListener('click', resetQuiz);
  $('#quizNext').addEventListener('click', function () {
    if (quiz.i === quiz.qs.length - 1) finishQuiz();
    else { quiz.i++; showQuestion(); }
  });

  /* ── Boot ─────────────────────────────────────────────────── */
  document.documentElement.dataset.theme = LS.get('lx.theme', 'dark');

  var quizCat = $('#quizCat');
  usedCats(LX.commands.concat(LX.quiz)).forEach(function (c) {
    var o = document.createElement('option');
    o.value = c; o.textContent = catName(c);
    quizCat.appendChild(o);
  });

  renderAll();
  setView(state.view);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }
})();
