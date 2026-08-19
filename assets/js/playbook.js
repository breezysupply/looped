/* Playbook walker: reveal one step at a time, tap a step for the how and why,
   follow branches to other trees, or expand everything as a reference sheet. */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  function U() { return window.LXUtil; }

  var view = null;   // { pb, shown, open:{}, all:false, trail:[] }

  /* existing scenarios render through the same walker */
  function asPlaybook(s) {
    return {
      id: 'sc:' + s.title, title: s.title, cat: s.cat, level: s.level,
      prompt: s.situation, say: null, kind: 'scenario',
      steps: s.steps.map(function (t) { return { check: null, cmd: t[0], decide: t[1], why: null }; }),
      probes: (s.followups || []).map(function (f) {
        var i = f.indexOf('→');
        return i === -1 ? [f, ''] : [f.slice(0, i).trim(), f.slice(i + 1).trim()];
      }),
      trap: null, remember: s.key
    };
  }
  function all() {
    return (LX.playbooks || []).map(function (p) {
      return Object.assign({ kind: 'playbook' }, p);
    }).concat((LX.scenarios || []).map(asPlaybook));
  }
  function byId(id) { return all().filter(function (p) { return p.id === id; })[0]; }

  function progress() { return U().LS.get('lx.playbooks', {}); }

  /* ── List ─────────────────────────────────────────────────── */
  var filter = 'playbook';

  function pbText(p) {
    return [p.title, p.prompt, p.say, p.remember, p.trap,
      p.steps.map(function (s) { return [s.check, s.cmd, s.decide, s.why].join(' '); }).join(' ')]
      .join(' ').toLowerCase();
  }

  function renderList(q) {
    var el = $('#pbList');
    if (!el) return;
    var esc = U().esc, done = progress();
    var query = (q || '').toLowerCase();
    var list = all().filter(function (p) {
      if (filter !== 'all' && p.kind !== filter) return false;
      return !query || pbText(p).indexOf(query) !== -1;
    });

    $$('#pbFilter .chip').forEach(function (c) {
      c.classList.toggle('active', c.dataset.pbfilter === filter);
    });
    $('#pbCount').textContent = list.length + (filter === 'scenario' ? ' scenarios' : ' playbooks');

    if (!list.length) { el.innerHTML = '<p class="empty">Nothing matches that search.</p>'; return; }

    el.innerHTML = list.map(function (p) {
      var seen = done[p.id];
      return '<article class="card lab-card" data-pb="' + esc(p.id) + '">' +
        '<div class="card-head"><div class="card-main">' +
          '<p class="card-title plain">' + esc(p.title) + '</p>' +
          '<p class="card-sum">' + esc(p.prompt || '') + '</p>' +
          '<div class="card-meta">' +
            '<span class="badge">' + esc(U().catName(p.cat)) + '</span>' +
            '<span class="badge ' + p.level + '">' + p.level + '</span>' +
            '<span class="badge">' + p.steps.length + ' steps</span>' +
            (p.steps.some(function (s) { return s.branches; }) ? '<span class="badge branchy">branches</span>' : '') +
            (seen ? '<span class="badge done">✓ walked</span>' : '') +
          '</div></div><span class="lab-go">▶</span></div></article>';
    }).join('');
  }

  /* ── Flow mode ────────────────────────────────────────────────
     The same tree drawn as the chain you would sketch on a whiteboard:
     question, arrow, command. Tapping a command opens what it is and why
     it is the move here — nothing else on screen. */

  /* the command a step is really about, for the library lookup:
     first word of the first alternative, minus sudo and pipes */
  function baseCmd(cmdStr) {
    var first = String(cmdStr || '').split('·')[0];
    var tok = first.trim().split(/[\s|;&]+/).filter(Boolean);
    var i = 0;
    while (tok[i] === 'sudo' || /^[A-Z_]+=/.test(tok[i] || '')) i++;
    return (tok[i] || '').replace(/^\W+|\W+$/g, '');
  }
  function libEntry(name) {
    return ((window.LX && LX.commands) || []).filter(function (c) { return c.name === name; })[0] || null;
  }
  /* Some steps are talk tracks or checklists rather than commands — the
     talk-track tree is entirely quoted sentences. Anything the library and
     the shell both fail to recognise is rendered as prose, not as code with
     a copy button. */
  function isProse(cmdStr) {
    var t = String(cmdStr || '').trim();
    if (/^["'\u201c]/.test(t)) return true;
    var name = baseCmd(cmdStr);
    if (!name) return true;
    if (libEntry(name)) return false;
    return !(window.LXShell && LXShell.commands().indexOf(name) !== -1);
  }

  /* Sample output for a step, with the lines that matter marked.
     Keyed by playbook id and step index in LX.pbOut, so the tree data stays
     the shape it was. */
  function sampleFor(pbId, i) {
    var t = (window.LX && LX.pbOut && LX.pbOut[pbId]) || null;
    return (t && t[i]) || null;
  }
  function sampleHtml(sample, label) {
    if (!sample || !sample.out) return '';
    var esc = U().esc;
    var body = esc(sample.out);
    var marks = (sample.mark || []).slice().sort(function (a, b) { return b.length - a.length; });
    if (marks.length) {
      /* one pass over an alternation, longest first, so a mark can never be
         re-matched inside another mark's markup; the trailing guard stops
         `rows=5` highlighting half of `rows=50000` */
      var alt = marks.map(function (m) {
        return esc(m).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }).join('|');
      var rx = new RegExp('(' + alt + ')(?!\\w)', 'gm');
      body = body.replace(rx, function (hit) { return '<mark>' + hit + '</mark>'; });
    }
    return '<p class="' + (label === 'flow' ? 'flow-label' : 'section-label') + '">What you should see</p>' +
      '<div class="term term-static pb-sample">' + body + '</div>' +
      (sample.note ? '<p class="pb-sample-note">' + U().fmt(sample.note) + '</p>' : '');
  }

  function flowNode(s, i) {
    var esc = U().esc, fmt = U().fmt;
    var open = view.all || view.open[i];
    var name = baseCmd(s.cmd);
    var lib = libEntry(name);
    var prose = isProse(s.cmd);
    var alts = String(s.cmd).split('·').map(function (x) { return x.trim(); }).filter(Boolean);

    return (s.check ? '<p class="flow-q">' + esc(s.check) + '</p>' : '') +
      '<div class="flow-arrow" aria-hidden="true"><span class="flow-line"></span><span class="flow-tip">▼</span></div>' +
      '<div class="flow-item' + (open ? ' open' : '') + (prose ? ' prose' : '') + '" data-step="' + i + '">' +
        '<button class="flow-node" aria-expanded="' + (open ? 'true' : 'false') + '">' +
          (prose ? '<span class="flow-say">' + esc(alts.join('  ·  ')) + '</span>'
                 : '<code>' + esc(alts[0]) + '</code>') +
          '<span class="flow-caret">' + (open ? '▾' : '▸') + '</span>' +
        '</button>' +
        '<div class="flow-callout">' +
          (lib ? '<p class="flow-label">What it is</p>' +
                 '<p class="flow-text">' + fmt(lib.sum) + '</p>' +
                 '<div class="syntax">' + esc(lib.syntax) + '</div>'
               : '') +
          (s.decide ? '<p class="flow-label">Why you would run it here</p>' +
                      '<p class="flow-text">' + fmt(s.decide) + '</p>' : '') +
          sampleHtml(sampleFor(view.pb.id, i), 'flow') +
          (s.why ? '<details class="flow-more"><summary>The longer version</summary>' +
                   '<p class="flow-text dim">' + fmt(s.why) + '</p></details>' : '') +
          (!prose && alts.length > 1 ? '<p class="flow-label">Same job, other tools</p>' +
            alts.slice(1).map(function (x) {
              return '<div class="flow-alt"><code>' + esc(x) + '</code>' +
                '<button class="copy" data-copy="' + esc(x) + '" aria-label="Copy">⧉</button></div>';
            }).join('') : '') +
          (s.branches ? '<p class="flow-label">Then it forks</p>' +
            s.branches.map(function (b) {
              return '<div class="flow-fork">' +
                '<span class="flow-when">' + esc(b.when) + '</span>' +
                '<span class="flow-then">' + fmt(b.then) + '</span>' +
                (b.goto ? ' <button class="btn small ghost pb-goto" data-goto-pb="' + esc(b.goto) +
                  '">that tree →</button>' : '') +
              '</div>';
            }).join('') : '') +
          (prose ? '' :
            '<div class="flow-links">' +
              '<button class="copy-wide" data-copy="' + esc(alts[0]) + '">⧉ Copy</button>' +
              (lib ? '<button class="copy-wide" data-goto="' + esc(name) + '">Full page for ' +
                     esc(name) + ' →</button>' : '') +
            '</div>') +
        '</div>' +
      '</div>';
  }

  function flowHtml(p) {
    var esc = U().esc;
    return '<div class="flow">' +
      '<div class="flow-start">' + esc(p.title) + '</div>' +
      p.steps.map(flowNode).join('') +
      '</div>';
  }

  /* ── Walker ───────────────────────────────────────────────── */
  function stepHtml(s, i) {
    var esc = U().esc, fmt = U().fmt;
    var open = view.all || view.open[i];
    return '<div class="pb-step' + (open ? ' open' : '') + '" data-step="' + i + '">' +
      '<div class="pb-step-head">' +
        '<span class="pb-n">' + (i + 1) + '</span>' +
        '<div class="pb-head-main">' +
          (s.check ? '<p class="pb-check">' + esc(s.check) + '</p>' : '') +
          '<code class="pb-cmd">' + esc(s.cmd) + '</code>' +
        '</div>' +
        '<span class="pb-caret">' + (open ? '▾' : '▸') + '</span>' +
      '</div>' +
      '<div class="pb-step-body">' +
        (s.decide ? '<p class="pb-decide"><b>What it settles.</b> ' + fmt(s.decide) + '</p>' : '') +
        sampleHtml(sampleFor(view.pb.id, i), 'walk') +
        (s.why ? '<p class="pb-why">' + fmt(s.why) + '</p>' : '') +
        (s.branches ? '<p class="section-label">Then branch on what you see</p>' +
          s.branches.map(function (b) {
            return '<div class="pb-branch">' +
              '<p class="pb-when">' + esc(b.when) + '</p>' +
              '<p class="pb-then">' + fmt(b.then) + '</p>' +
              (b.goto ? '<button class="btn small ghost pb-goto" data-goto-pb="' + esc(b.goto) + '">' +
                'Open that tree →</button>' : '') +
            '</div>';
          }).join('') : '') +
      '</div></div>';
  }

  function paint() {
    var esc = U().esc, fmt = U().fmt, p = view.pb;
    var flow = view.mode === 'flow';
    /* flow mode is a reference sheet: the whole chain is the point of it */
    var shown = (flow || view.all) ? p.steps.length : view.shown;

    $('#pbTitle').textContent = p.title;
    $('#pbStepNo').textContent = flow
      ? p.steps.length + ' steps · tap a command'
      : shown + ' / ' + p.steps.length + ' steps';
    $('#pbBar').style.width = (shown / p.steps.length * 100) + '%';
    $('#pbPrompt').textContent = p.prompt || '';
    $('#pbSayWrap').hidden = !p.say;
    $('#pbSay').textContent = p.say || '';
    $('#pbAllBtn').textContent = view.all ? 'Collapse all' : 'Expand all';
    $$('#pbMode .seg').forEach(function (b) {
      var on = b.dataset.pbmode === view.mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    $('#pbSteps').innerHTML = flow
      ? flowHtml(p)
      : p.steps.slice(0, shown).map(stepHtml).join('');

    var last = shown >= p.steps.length;
    $('#pbNext').hidden = flow || view.all || last;
    $('#pbNext').textContent = 'Next step  ↓';
    $('#pbEnd').hidden = !(last || view.all);

    if (last || view.all) {
      $('#pbEnd').innerHTML =
        (p.trap ? '<p class="section-label">Common trap</p><div class="key">' + fmt(p.trap) + '</div>' : '') +
        (p.remember ? '<p class="section-label">Remember</p><div class="tip">' + fmt(p.remember) + '</div>' : '') +
        (p.probes && p.probes.length ? '<p class="section-label">Likely follow-up probes</p>' +
          p.probes.map(function (pr) {
            return '<details class="breakdown"><summary>' + esc(pr[0]) + '</summary>' +
              '<p class="ex-desc">' + fmt(pr[1]) + '</p></details>';
          }).join('') : '') +
        (p.mission ? '<button class="btn primary pb-practise" data-practise="' + esc(p.mission) +
          '">Practise this in the Sandbox →</button>' : '');
      var store = progress();
      if (!store[p.id]) { store[p.id] = { walked: true }; U().LS.set('lx.playbooks', store); }
    }
  }

  function open(id) {
    var pb = byId(id);
    if (!pb) return;
    var mode = U().LS.get('lx.pbmode', 'flow') === 'walk' ? 'walk' : 'flow';
    /* walk mode opens step 1 to start you off; flow mode is a reference
       sheet, so the chain stays clean until you tap something */
    view = { pb: pb, shown: 1, open: mode === 'walk' ? { 0: true } : {}, all: false, mode: mode };
    $('#pbList').hidden = true;
    $('#pbIntro').hidden = true;
    $('#pbFilter').hidden = true;
    $('#pbCount').hidden = true;
    $('#pbRun').hidden = false;
    $('#pbPromptWrap').open = true;
    paint();
    window.scrollTo(0, 0);
  }

  function exit() {
    view = null;
    $('#pbRun').hidden = true;
    $('#pbList').hidden = false;
    $('#pbIntro').hidden = false;
    $('#pbFilter').hidden = false;
    $('#pbCount').hidden = false;
    renderList('');
    window.scrollTo(0, 0);
  }

  /* ── Events ───────────────────────────────────────────────── */
  document.addEventListener('click', function (e) {
    var t = e.target;

    var card = t.closest('[data-pb]');
    if (card) { open(card.dataset.pb); return; }

    var chip = t.closest('[data-pbfilter]');
    if (chip) { filter = chip.dataset.pbfilter; renderList($('#search') ? $('#search').value.trim() : ''); return; }

    if (!view) return;

    if (t.closest('#pbExit')) { exit(); return; }

    var mode = t.closest('[data-pbmode]');
    if (mode) {
      view.mode = mode.dataset.pbmode;
      U().LS.set('lx.pbmode', view.mode);
      if (view.mode === 'walk') {
        if (!view.all) view.shown = Math.max(view.shown, 1);
        /* arriving in walk mode with everything shut is a dead end — open
           the step you are on, the way opening the playbook directly does */
        var anyOpen = view.pb.steps.some(function (_, k) { return view.open[k]; });
        if (!anyOpen) view.open[view.shown - 1] = true;
      }
      paint();
      return;
    }

    var node = t.closest('.flow-node');
    if (node) {
      var fi = Number(node.parentNode.dataset.step);
      if (view.all) {   /* leaving expand-all keeps what is on screen */
        view.all = false;
        view.pb.steps.forEach(function (_, k) { view.open[k] = true; });
      }
      view.open[fi] = !view.open[fi];
      paint();
      return;
    }

    if (t.closest('#pbAllBtn')) {
      view.all = !view.all;
      if (!view.all) { view.shown = Math.max(view.shown, 1); }
      paint();
      return;
    }

    if (t.closest('#pbNext')) {
      view.shown = Math.min(view.pb.steps.length, view.shown + 1);
      view.open[view.shown - 1] = true;
      paint();
      var els = $$('#pbSteps .pb-step');
      if (els.length) els[els.length - 1].scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }

    var goto = t.closest('[data-goto-pb]');
    if (goto) { open(goto.dataset.gotoPb); return; }

    var practise = t.closest('[data-practise]');
    if (practise) {
      var mid = practise.dataset.practise;
      if (U() && U().go) U().go('sandbox');
      if (window.LXSandbox) window.LXSandbox.open(mid);
      return;
    }

    var head = t.closest('.pb-step-head');
    if (head) {
      var i = Number(head.parentNode.dataset.step);
      view.open[i] = !view.open[i];
      if (view.all) {                       /* leaving expand-all keeps what you see */
        view.all = false;
        view.shown = view.pb.steps.length;
        Object.keys(view.pb.steps).forEach(function (k) { view.open[k] = true; });
        view.open[i] = false;
      }
      paint();
      return;
    }
  });

  window.LXPlaybook = { renderList: renderList, open: open, exit: exit };
})();
