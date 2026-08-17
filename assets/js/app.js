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
    if (window.LXReview) window.LXReview.syncSaved(id, isSaved(id));
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
    if (window.LXQuiz) window.LXQuiz.renderStats();
    if (window.LXReview) window.LXReview.render();
  }
  function renderLabs() {
    if (window.LXLab) window.LXLab.renderList(state.q);
    if (window.LXSandbox) window.LXSandbox.renderList(state.q);
  }
  function renderAll() {
    renderCommands(); renderScenarios(); renderDrills(); renderLabs();
    renderSaved(); renderStats();
  }

  /* ── View switching ───────────────────────────────────────── */
  function setView(v) {
    if (!document.getElementById('view-' + v)) v = 'commands';
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

  /* ── Boot ─────────────────────────────────────────────────── */
  document.documentElement.dataset.theme = LS.get('lx.theme', 'dark');

  var cats = usedCats(LX.commands.concat(LX.quiz, LX.scenarios, LX.drills));
  ['#quizCat', '#seedCat'].forEach(function (selId) {
    var el = $(selId);
    if (!el) return;
    cats.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c; o.textContent = catName(c);
      el.appendChild(o);
    });
  });

  renderAll();
  setView(state.view);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }
})();
