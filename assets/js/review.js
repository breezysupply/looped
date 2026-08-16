/* Review: spaced-repetition deck, self-graded flashcards, streak, mastery stats.
   Scheduling is SM-2 lite: Again / Hard / Good / Easy adjust ease and interval. */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  function U() { return window.LXUtil; }
  function get(k, d) { return U().LS.get(k, d); }
  function set(k, v) { U().LS.set(k, v); }

  function today() { return new Date().toISOString().slice(0, 10); }
  function addDays(days) {
    var d = new Date();
    d.setDate(d.getDate() + Math.round(days));
    return d.toISOString().slice(0, 10);
  }
  function daysBetween(a, b) {
    return Math.round((new Date(b) - new Date(a)) / 86400000);
  }

  var session = null;   // { queue:[ids], i, graded, again }

  /* ── Deck ─────────────────────────────────────────────────── */
  function cards() { return get('lx.cards', {}); }
  function saveCards(c) { set('lx.cards', c); }

  function addCard(id, front, back, cat) {
    var c = cards();
    if (c[id]) return false;
    c[id] = { front: front, back: back, cat: cat || 'files',
              ivl: 0, ease: 2.5, due: today(), reps: 0, lapses: 0 };
    saveCards(c);
    return true;
  }
  function removeCard(id) {
    var c = cards();
    if (!c[id]) return;
    delete c[id];
    saveCards(c);
  }
  function dueCards() {
    var c = cards(), t = today();
    return Object.keys(c).filter(function (id) { return c[id].due <= t; });
  }

  function grade(id, g) {
    var c = cards(), card = c[id];
    if (!card) return;
    if (g === 'again') {
      card.ease = Math.max(1.3, card.ease - 0.2);
      card.ivl = 0; card.lapses++; card.due = today();
    } else if (g === 'hard') {
      card.ease = Math.max(1.3, card.ease - 0.15);
      card.ivl = card.reps === 0 ? 1 : Math.max(1, card.ivl * 1.2);
      card.due = addDays(card.ivl);
    } else if (g === 'good') {
      card.ivl = card.reps === 0 ? 1 : Math.max(1, card.ivl * card.ease);
      card.due = addDays(card.ivl);
    } else {
      card.ease = card.ease + 0.15;
      card.ivl = card.reps === 0 ? 3 : Math.max(1, card.ivl * card.ease * 1.3);
      card.due = addDays(card.ivl);
    }
    card.reps++;
    saveCards(c);
  }

  /* ── Card builders for each source ────────────────────────── */
  function cardFromCommand(name) {
    var c = LX.commands.filter(function (x) { return x.name === name; })[0];
    if (!c) return false;
    return addCard('c:' + c.name,
      'What does `' + c.name + '` do — and what is the trap?',
      c.sum + (c.tip ? '\n\nTrap: ' + c.tip : ''), c.cat);
  }
  function cardFromDrill(qtext) {
    var d = LX.drills.filter(function (x) { return x.q === qtext; })[0];
    if (!d) return false;
    return addCard('d:' + d.q, d.q,
      d.a + (d.points ? '\n\n• ' + d.points.join('\n• ') : ''), d.cat);
  }
  function cardFromScenario(title) {
    var s = LX.scenarios.filter(function (x) { return x.title === title; })[0];
    if (!s) return false;
    return addCard('s:' + s.title,
      s.title + '\n\n' + s.situation + '\n\nWhat do you run, in what order, and why?',
      s.steps.map(function (t) { return '$ ' + t[0] + '\n   ' + t[1]; }).join('\n') +
      '\n\nWhat they are scoring: ' + s.key, s.cat);
  }

  /* called by app.js when something is starred / unstarred */
  function syncSaved(id, isSaved) {
    if (!isSaved) { removeCard(id); return; }
    var key = id.slice(2);
    if (id[0] === 'c') cardFromCommand(key);
    else if (id[0] === 'd') cardFromDrill(key);
    else if (id[0] === 's') cardFromScenario(key);
    render();
  }

  /* ── Recording study activity ─────────────────────────────── */
  function recordAnswer(item, right) {
    var t = get('lx.topic', {});
    var c = item.cat || 'files';
    t[c] = t[c] || { seen: 0, ok: 0 };
    t[c].seen++;
    if (right) t[c].ok++;
    set('lx.topic', t);
  }

  function addMiss(item) {
    var right = item.type === 'build' ? item.answer.join(' ')
      : item.type === 'order' ? item.items.map(function (s) { return s.c; }).join(' → ')
      : item.choices[item.a];

    var weak = get('lx.weak', []);
    weak = weak.filter(function (w) { return w.q !== item.q; });
    weak.unshift({ q: item.q, cat: item.cat, level: item.level || 'intermediate',
                   right: right, why: item.why, type: item.type,
                   choices: item.choices || null, at: today() });
    set('lx.weak', weak.slice(0, 40));

    addCard('m:' + item.q, item.q, right + '\n\n' + item.why, item.cat);
  }

  function addLabMiss(labTitle, ask, rightText, fb, cat) {
    addCard('l:' + labTitle + '|' + ask,
      labTitle + '\n\n' + ask,
      rightText + '\n\n' + fb, cat);
  }

  function noteStudy(answered, correct) {
    var s = get('lx.stats', { taken: 0, correct: 0 });
    s.taken += answered || 0;
    s.correct += correct || 0;
    set('lx.stats', s);
    touchStreak();
  }

  function touchStreak() {
    var st = get('lx.streak', { last: null, days: 0 });
    var t = today();
    if (st.last === t) return;
    st.days = (st.last && daysBetween(st.last, t) === 1) ? st.days + 1 : 1;
    st.last = t;
    set('lx.streak', st);
  }

  /* weak spots replayed as quiz questions */
  function weakQuestions() {
    return get('lx.weak', []).filter(function (w) {
      return w.choices && w.choices.length > 1;
    }).map(function (w) {
      var choices = w.choices.slice();
      return { type: w.type === 'output' ? 'mcq' : (w.type || 'mcq'),
               cat: w.cat, level: w.level, q: w.q,
               choices: choices, a: choices.indexOf(w.right), why: w.why };
    }).filter(function (x) { return x.a >= 0; });
  }

  /* ── Flashcard session ────────────────────────────────────── */
  function startSession() {
    var due = dueCards();
    if (!due.length) { U().toast('Nothing due — add cards below'); return; }
    session = { queue: due.slice(0, 20), i: 0, graded: 0, again: 0 };
    $('#revHome').hidden = true;
    $('#revDone').hidden = true;
    $('#revCard').hidden = false;
    paintCard();
    window.scrollTo(0, 0);
  }

  function paintCard() {
    var esc = U().esc;
    var c = cards()[session.queue[session.i]];
    if (!c) { session.queue.splice(session.i, 1); if (session.queue.length) return paintCard(); return endSession(); }
    $('#revProgress').textContent = 'Card ' + (session.i + 1) + ' of ' + session.queue.length;
    $('#revBar').style.width = (session.i / session.queue.length * 100) + '%';
    $('#revFront').innerHTML = esc(c.front).replace(/\n/g, '<br>').replace(/`([^`]+)`/g, '<code>$1</code>');
    $('#revBack').innerHTML = esc(c.back).replace(/\n/g, '<br>').replace(/`([^`]+)`/g, '<code>$1</code>');
    $('#revBack').hidden = true;
    $('#revGrades').hidden = true;
    $('#revShow').hidden = false;
    $('#revMeta').textContent = c.reps ? 'seen ' + c.reps + '× · interval ' + Math.round(c.ivl) + 'd' : 'new card';
  }

  function gradeCurrent(g) {
    var id = session.queue[session.i];
    grade(id, g);
    session.graded++;
    if (g === 'again') { session.again++; session.queue.push(id); }
    session.i++;
    touchStreak();
    if (session.i >= session.queue.length) endSession();
    else { paintCard(); window.scrollTo(0, 0); }
  }

  function endSession() {
    $('#revCard').hidden = true;
    $('#revDone').hidden = false;
    $('#revDoneMsg').textContent = session.graded + ' cards reviewed' +
      (session.again ? ', ' + session.again + ' marked Again and requeued' : '') + '.';
    var due = dueCards().length;
    $('#revDoneNext').textContent = due
      ? due + ' still due today.'
      : 'Deck clear for today. Next cards are scheduled for future days.';
    session = null;
    render();
    window.scrollTo(0, 0);
  }

  /* ── Home view ────────────────────────────────────────────── */
  function render() {
    if (!$('#revHome')) return;
    var esc = U().esc;
    var all = cards(), ids = Object.keys(all);
    var due = dueCards();
    var st = get('lx.streak', { last: null, days: 0 });
    var stats = get('lx.stats', { taken: 0, correct: 0 });
    var labs = get('lx.labs', {});

    var studiedToday = st.last === today();
    $('#revStreak').innerHTML =
      '<div class="stat-tile"><span class="stat-n">' + (st.days || 0) + '</span><span class="stat-l">day streak' +
        (studiedToday ? '' : ' · not yet today') + '</span></div>' +
      '<div class="stat-tile"><span class="stat-n">' + due.length + '</span><span class="stat-l">cards due</span></div>' +
      '<div class="stat-tile"><span class="stat-n">' + ids.length + '</span><span class="stat-l">in deck</span></div>' +
      '<div class="stat-tile"><span class="stat-n">' +
        (stats.taken ? Math.round(stats.correct / stats.taken * 100) + '%' : '—') +
        '</span><span class="stat-l">quiz accuracy</span></div>';

    $('#revStartBtn').textContent = due.length ? 'Review ' + Math.min(due.length, 20) + ' cards' : 'Nothing due today';
    $('#revStartBtn').disabled = !due.length;

    /* mastery per topic */
    var topic = get('lx.topic', {});
    var rows = Object.keys(topic).map(function (c) {
      var t = topic[c], pct = t.seen ? Math.round(t.ok / t.seen * 100) : 0;
      return { cat: c, pct: pct, seen: t.seen };
    }).filter(function (r) { return r.seen >= 3; }).sort(function (a, b) { return a.pct - b.pct; });

    $('#revMastery').innerHTML = rows.length
      ? rows.map(function (r) {
          var tone = r.pct >= 80 ? 'good' : r.pct >= 55 ? 'mid' : 'low';
          return '<div class="mastery"><div class="mastery-top"><span>' + esc(U().catName(r.cat)) +
            '</span><span class="muted">' + r.pct + '% of ' + r.seen + '</span></div>' +
            '<div class="meter"><div class="meter-fill ' + tone + '" style="width:' + r.pct + '%"></div></div></div>';
        }).join('')
      : '<p class="muted">Answer a few quiz questions and your per-topic accuracy shows up here, weakest first.</p>';

    /* labs progress */
    var doneLabs = Object.keys(labs).length;
    $('#revLabs').textContent = (LX.labs || []).length
      ? doneLabs + ' of ' + LX.labs.length + ' labs attempted'
      : '';

    /* weak spots */
    var weak = get('lx.weak', []);
    $('#revWeak').innerHTML = weak.length
      ? weak.slice(0, 8).map(function (w) {
          return '<div class="review-item miss"><div class="rq">' + esc(w.q) + '</div>' +
            '<div class="ra">→ ' + esc(w.right) + '</div></div>';
        }).join('') +
        (weak.length > 8 ? '<p class="muted">…and ' + (weak.length - 8) + ' more in the deck.</p>' : '')
      : '<p class="muted">Nothing missed yet. Misses from quizzes and labs land here and become review cards automatically.</p>';
  }

  /* ── Seeding ──────────────────────────────────────────────── */
  function seed() {
    var cat = $('#seedCat').value;
    var pool = LX.commands.filter(function (c) { return cat === 'all' || c.cat === cat; });
    var added = 0;
    for (var i = 0; i < pool.length && added < 15; i++) {
      if (cardFromCommand(pool[i].name)) added++;
    }
    var drills = LX.drills.filter(function (d) { return cat === 'all' || d.cat === cat; });
    for (var j = 0; j < drills.length && added < 20; j++) {
      if (cardFromDrill(drills[j].q)) added++;
    }
    U().toast(added ? added + ' cards added' : 'Those are already in your deck');
    render();
  }

  function resetDeck() {
    if (!window.confirm('Remove every card from your review deck? Stats and streak are kept.')) return;
    saveCards({});
    render();
  }

  /* ── Events ───────────────────────────────────────────────── */
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t.closest('#revStartBtn')) { startSession(); return; }
    if (t.closest('#revShow')) {
      $('#revBack').hidden = false;
      $('#revGrades').hidden = false;
      $('#revShow').hidden = true;
      $('#revGrades').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }
    var g = t.closest('[data-grade]');
    if (g && session) { gradeCurrent(g.dataset.grade); return; }
    if (t.closest('#revQuit')) {
      session = null;
      $('#revCard').hidden = true; $('#revDone').hidden = true; $('#revHome').hidden = false;
      render(); return;
    }
    if (t.closest('#revDoneBack')) {
      $('#revDone').hidden = true; $('#revHome').hidden = false; render(); return;
    }
    if (t.closest('#seedBtn')) { seed(); return; }
    if (t.closest('#deckReset')) { resetDeck(); return; }
  });

  window.LXReview = {
    render: render, recordAnswer: recordAnswer, addMiss: addMiss, addLabMiss: addLabMiss,
    noteStudy: noteStudy, touchStreak: touchStreak, weakQuestions: weakQuestions,
    syncSaved: syncSaved, dueCount: function () { return dueCards().length; }
  };
})();
