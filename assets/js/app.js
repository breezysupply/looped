/* Linux Pocket Guide — rendering, filtering, quiz engine, persistence */
(function () {
  'use strict';

  /* Categories come from the track registry (data/tracks.js), not a literal
     here — a track can introduce its own without being silently dropped. */
  var catName = function (c) { return LX.track.catName(c, state ? state.track : null); };
  var trackCats = function () { return LX.track.cats(state.track); };
  var inTrack = function (x) { return LX.track.inTrack(x, state.track); };

  /* Four bottom tabs; groups with more than one page get a segmented sub-nav. */
  var GROUPS = [
    { id: 'learn',    label: 'Learn',    views: [
      { v: 'commands',  label: 'Commands'  },
      { v: 'playbooks', label: 'Playbooks' },
      { v: 'drills',    label: 'Drills'    }
    ] },
    { id: 'practice', label: 'Practice', views: [
      { v: 'labs',    label: 'Labs'    },
      { v: 'sandbox', label: 'Sandbox' }
    ] },
    { id: 'quiz',     label: 'Quiz',     views: [ { v: 'quiz',   label: 'Quiz'   } ] },
    { id: 'review',   label: 'Review',   views: [ { v: 'review', label: 'Review' } ] }
  ];
  function groupOf(v) {
    for (var i = 0; i < GROUPS.length; i++) {
      for (var j = 0; j < GROUPS[i].views.length; j++) {
        if (GROUPS[i].views[j].v === v) return GROUPS[i];
      }
    }
    return GROUPS[0];
  }

  var LS = {
    get: function (k, d) {
      try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }
      catch (e) { return d; }
    },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  var state = {
    track: LS.get('lx.track', 'linux'),
    view: LS.get('lx.view', 'commands'),
    lastInGroup: LS.get('lx.groupview', {}),
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
                    toast: function (m) { toast(m); },
                    go: function (v) { setView(v); },
                    track: function () { return state.track; },
                    findById: findById, idOf: idOf };

  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove('show'); }, 1400);
  }

  /* Stable ids. A star and its review card are the same id, so rewording a
     drill can no longer orphan the card and leave a duplicate beside it.
     Computed from content but not *of* content — see assets/js/store.js. */
  var TEXT_OF = {
    c: function (x) { return x.name; },
    s: function (x) { return x.title; },
    d: function (x) { return x.q; }
  };
  var POOL_OF = {
    c: function () { return LX.commands; },
    s: function () { return LX.scenarios; },
    d: function () { return LX.drills; }
  };
  var idCache = {};
  function idOf(kind, x) {
    var text = TEXT_OF[kind](x);
    var ck = kind + '\u0000' + text;
    if (!idCache[ck]) idCache[ck] = LXStore.idFor(kind, text);
    return idCache[ck];
  }
  function findById(id) {
    var kind = id.charAt(0);
    if (!POOL_OF[kind]) return null;
    var pool = POOL_OF[kind]();
    for (var i = 0; i < pool.length; i++) if (idOf(kind, pool[i]) === id) return pool[i];
    return null;
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
      if (!inTrack(c)) return false;
      if (state.cat !== 'all' && c.cat !== state.cat) return false;
      if (state.level !== 'all' && c.level !== state.level) return false;
      return !q || cmdText(c).indexOf(q) !== -1;
    });
  }
  function filteredScenarios() {
    var q = state.q.toLowerCase();
    return LX.scenarios.filter(function (s) {
      if (!inTrack(s)) return false;
      if (state.scenCat !== 'all' && s.cat !== state.scenCat) return false;
      return !q || scenText(s).indexOf(q) !== -1;
    });
  }
  function filteredDrills() {
    var q = state.q.toLowerCase();
    return LX.drills.filter(function (d) {
      if (!inTrack(d)) return false;
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
    var id = idOf('c', c);
    var badges = '<span class="badge">' + catName(c.cat) + '</span>' +
      '<span class="badge ' + esc(c.level) + '">' + esc(c.level) + '</span>';
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
    var id = idOf('s', s);
    var badges = '<span class="badge">' + catName(s.cat) + '</span>' +
      '<span class="badge ' + esc(s.level) + '">' + esc(s.level) + '</span>' +
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
    var id = idOf('d', d);
    var badges = '<span class="badge">' + catName(d.cat) + '</span>' +
      '<span class="badge ' + esc(d.level) + '">' + esc(d.level) + '</span>' +
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
    var x = findById(id);
    if (!x) return '';
    return id.charAt(0) === 'c' ? commandCard(x)
         : id.charAt(0) === 's' ? scenarioCard(x)
         : drillCard(x);
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
    var known = trackCats();
    var ordered = Object.keys(known).filter(function (c) { return seen.indexOf(c) !== -1; });
    /* anything a track forgot to register still shows, rather than vanishing */
    seen.forEach(function (c) { if (c && ordered.indexOf(c) === -1) ordered.push(c); });
    return ordered;
  }

  /* ── Renderers ────────────────────────────────────────────── */
  function otherHits() {
    var bits = [];
    if (state.q) {
      var c = filteredCommands().length, s = filteredScenarios().length, d = filteredDrills().length;
      if (state.view !== 'commands' && c) bits.push(c + ' in Commands');
      if (state.view !== 'playbooks' && s) bits.push(s + ' in Playbooks');
      if (state.view !== 'drills' && d) bits.push(d + ' in Drills');
    }
    return bits.length ? '<p class="empty">No match here. ' + bits.join(' · ') + '.</p>' : '<p class="empty">Nothing matches.</p>';
  }

  function renderCommands() {
    buildChips($('#catChips'), usedCats(LX.commands.filter(inTrack)), state.cat, 'data-cat');
    $$('#levelChips .chip').forEach(function (b) {
      b.classList.toggle('active', b.dataset.level === state.level);
    });
    var list = filteredCommands();
    var pool = LX.commands.filter(inTrack).length;
    $('#cmdCount').textContent = list.length + ' of ' + pool + ' commands';
    $('#cmdList').innerHTML = list.length ? list.map(commandCard).join('') : otherHits();
  }
  function renderScenarios() {
    /* scenarios are rendered by the playbook walker now */
    if (window.LXPlaybook) window.LXPlaybook.renderList(state.q);
  }
  function renderDrills() {
    buildChips($('#drillChips'), usedCats(LX.drills.filter(inTrack)), state.drillCat, 'data-dcat');
    var list = filteredDrills();
    var dpool = LX.drills.filter(inTrack).length;
    $('#drillCount').textContent = list.length + ' of ' + dpool + ' drills';
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

  /* the quiz and seed dropdowns list the active track's categories */
  function rebuildCatSelects() {
    var pool = LX.commands.concat(LX.quiz, LX.scenarios, LX.drills).filter(inTrack);
    var cats = usedCats(pool);
    ['#quizCat', '#seedCat'].forEach(function (selId) {
      var el = $(selId);
      if (!el) return;
      var keep = el.value;
      el.innerHTML = '<option value="all">All topics</option>';
      cats.forEach(function (c) {
        var o = document.createElement('option');
        o.value = c; o.textContent = catName(c);
        el.appendChild(o);
      });
      if (keep && el.querySelector('option[value="' + keep + '"]')) el.value = keep;
    });
  }

  /* ── Tracks ───────────────────────────────────────────────── */
  function trackLabel(id) {
    if (id === 'all') return 'All tracks';
    var t = LX.track.byId(id);
    return t ? t.short || t.name : id;
  }

  /* A track that has not been loaded yet has no records in the pools, so a live
     count would read 0 for exactly the tracks the picker is asking you to choose
     between. Fall back to the tally tools/build.js generates into the registry. */
  function countsFor(id) {
    if (id === 'all') {
      return LX.track.ids().reduce(function (a, t) { return a + countsFor(t); }, 0);
    }
    if (!LX.track.isLoaded(id)) return (LX.trackCounts || {})[id] || 0;
    function n(arr) {
      return (arr || []).filter(function (x) { return LX.track.of(x) === id; }).length;
    }
    return n(LX.commands) + n(LX.playbooks) + n(LX.drills) + n(LX.labs) + n(LX.scenarios);
  }

  function renderTrackSheet() {
    var el = $('#trackList');
    if (!el) return;
    var rows = LX.tracks.map(function (t) {
      return { id: t.id, name: t.name, ico: t.ico || '•', blurb: t.blurb || '' };
    });
    if (LX.tracks.length > 1) {
      rows.push({ id: 'all', name: 'All tracks', ico: '∗',
                  blurb: 'Everything at once — a mixed quiz and one combined review deck.' });
    }
    el.innerHTML = rows.map(function (r) {
      var on = r.id === state.track;
      return '<button class="track-row' + (on ? ' active' : '') + '" data-track="' + esc(r.id) + '"' +
        (on ? ' aria-current="true"' : '') + '>' +
        '<span class="track-ico">' + esc(r.ico) + '</span>' +
        '<span class="track-main"><span class="track-nm">' + esc(r.name) + '</span>' +
        (r.blurb ? '<span class="track-blurb">' + esc(r.blurb) + '</span>' : '') + '</span>' +
        '<span class="track-count">' + countsFor(r.id) + '</span></button>';
    }).join('');
  }

  function openTrackSheet(open) {
    var sheet = $('#trackSheet');
    if (!sheet) return;
    if (open) renderTrackSheet();
    sheet.hidden = !open;
    $('#trackBtn').setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) { var f = sheet.querySelector('.track-row'); if (f) f.focus(); }
    else $('#trackBtn').focus();
  }

  function setTrack(id) {
    if (id !== 'all' && !LX.track.byId(id)) id = LX.tracks[0].id;
    state.track = id;
    LS.set('lx.track', id);
    /* category filters belong to the track you left, so reset them */
    state.cat = 'all'; state.scenCat = 'all'; state.drillCat = 'all';
    $('#trackName').textContent = trackLabel(id);
    openTrackSheet(false);

    /* Only the default track ships in index.html; the rest arrive on first
       switch. Already loaded is the common case and stays synchronous. */
    if (LX.track.isLoaded(id)) { rebuildCatSelects(); renderAll(); return; }
    document.body.classList.add('loading-track');
    LX.track.load(id, function () {
      document.body.classList.remove('loading-track');
      rebuildCatSelects();
      renderAll();
    });
  }

  /* ── View switching ───────────────────────────────────────── */
  function renderSubnav(g, v) {
    var el = $('#subnav');
    if (!el) return;
    if (g.views.length < 2) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.setAttribute('role', 'tablist');
    el.innerHTML = g.views.map(function (x) {
      var on = x.v === v;
      return '<button class="seg' + (on ? ' active' : '') + '" role="tab" data-view="' +
        esc(x.v) + '" aria-selected="' + (on ? 'true' : 'false') + '" tabindex="' +
        (on ? '0' : '-1') + '" aria-controls="view-' + esc(x.v) + '">' + esc(x.label) + '</button>';
    }).join('');
  }

  function setView(v) {
    if (!document.getElementById('view-' + v)) v = 'commands';
    var g = groupOf(v);
    state.view = v;
    state.lastInGroup[g.id] = v;
    LS.set('lx.view', v);
    LS.set('lx.groupview', state.lastInGroup);
    $$('.view').forEach(function (s) { s.classList.toggle('active', s.id === 'view-' + v); });
    $$('.tab').forEach(function (t) {
      var on = t.dataset.group === g.id;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      /* roving tabindex: one stop for the whole bar, arrows move within it */
      t.setAttribute('tabindex', on ? '0' : '-1');
    });
    renderSubnav(g, v);
    var panel = document.getElementById('view-' + v);
    if (panel) {
      panel.setAttribute('aria-label', g.views.length > 1 ? g.label + ': ' + v : g.label);
    }
    /* Focus deliberately stays on the tab. Moving it into the panel broke
       arrow navigation — the next arrow key had no tab to move from — and
       aria-controls already tells a screen reader what the tab governs. */
    window.scrollTo(0, 0);
  }

  /* the group tab reopens whichever page you last had open in that group */
  function setGroup(id) {
    var g = groupOf(null);
    GROUPS.forEach(function (x) { if (x.id === id) g = x; });
    var last = state.lastInGroup[g.id];
    var ok = g.views.some(function (x) { return x.v === last; });
    setView(ok ? last : g.views[0].v);
  }

  /* ── Events ───────────────────────────────────────────────── */
  document.addEventListener('click', function (e) {
    var t = e.target;

    if (t.closest('#trackBtn')) { openTrackSheet($('#trackSheet').hidden); return; }
    if (t.closest('#trackClose') || t === $('#trackSheet')) { openTrackSheet(false); return; }
    /* must be .track-row: <html> also carries data-track, so a bare
       [data-track] selector matches every click in the document */
    var trow = t.closest('.track-row');
    if (trow) { setTrack(trow.dataset.track); return; }

    var tab = t.closest('.tab');
    if (tab) { setGroup(tab.dataset.group); return; }

    /* must be [data-view]: .seg is also the styling class for the playbook
       mode toggle, and matching it bare navigated away from the playbook */
    var seg = t.closest('.seg[data-view]');
    if (seg) { setView(seg.dataset.view); return; }

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

  /* Arrow keys move along the tab bar and the sub-nav, which is what
     role="tab" promises and nothing implemented. */
  function arrowNav(e, sel, activate) {
    var items = $$(sel);
    var i = items.indexOf(document.activeElement);
    if (i === -1) return false;
    var next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % items.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next === null) return false;
    e.preventDefault();
    activate(items[next]);
    items[next].focus();   /* after activate: it re-renders the sub-nav */
    return true;
  }

  document.addEventListener('keydown', function (e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (document.activeElement && document.activeElement.closest('.tabbar')) {
      arrowNav(e, '.tabbar .tab', function (el) { setGroup(el.dataset.group); });
      return;
    }
    if (document.activeElement && document.activeElement.closest('#subnav')) {
      arrowNav(e, '#subnav .seg', function (el) { setView(el.dataset.view); });
      return;
    }
    if (e.key === 'Escape' && !$('#trackSheet').hidden) { openTrackSheet(false); }
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

  /* ── Progress export / import ─────────────────────────────────
     A textarea rather than a file download: the app is often running as an
     installed PWA on a phone, where a download is awkward and a select-all
     copy is not. */
  function dataMsg(text, ok) {
    var el = $('#dataMsg');
    el.hidden = !text;
    el.textContent = text || '';
    el.style.color = ok === false ? 'var(--red)' : '';
  }
  document.addEventListener('click', function (e) {
    if (e.target.closest('#dataExport')) {
      var box = $('#dataBox');
      box.hidden = false;
      box.value = LXStore.exportAll();
      box.focus(); box.select();
      dataMsg('Copy this somewhere safe. Paste it into Import on the new device.');
      return;
    }
    if (e.target.closest('#dataImport')) {
      var b = $('#dataBox');
      if (b.hidden || !b.value.trim()) {
        b.hidden = false; b.value = ''; b.focus();
        dataMsg('Paste an export here, then press Import again.');
        return;
      }
      var r = LXStore.importAll(b.value);
      if (!r.ok) { dataMsg(r.err, false); return; }
      dataMsg('Restored ' + r.keys + ' keys. Reloading…');
      setTimeout(function () { location.reload(); }, 700);
      return;
    }
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

  if (state.track !== 'all' && !LX.track.byId(state.track)) state.track = LX.tracks[0].id;
  $('#trackName').textContent = trackLabel(state.track);
  $('#trackBtn').hidden = LX.tracks.length < 2;

  /* The default track is already here from index.html. Any other saved track
     has to arrive before the first render, or the app opens empty. */
  LX.tracks.forEach(function (t) { if (t['default']) LX.track.loaded[t.id] = true; });
  setView(state.view);
  if (LX.track.isLoaded(state.track)) {
    rebuildCatSelects();
    renderAll();
  } else {
    document.body.classList.add('loading-track');
    renderAll();                       /* paint the shell so it is not blank */
    LX.track.load(state.track, function () {
      document.body.classList.remove('loading-track');
      rebuildCatSelects();
      renderAll();
    });
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }
})();
