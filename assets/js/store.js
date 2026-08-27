/* Storage schema and migrations.

   Fourteen lx.* keys accumulated with no version and no way to change any of
   them. The worst of it: review cards were keyed by the content itself —
   'd:' + drill.q, 's:' + scenario.title — so rewording a drill orphaned that
   card and silently created a duplicate next to it. Content is going to be
   edited constantly from here on, so keys have to be stable slugs.

   This file runs before the engines and leaves localStorage in the current
   shape, whatever shape it was in. Loaded early; owns nothing at runtime. */
(function () {
  'use strict';

  var SCHEMA = 2;

  function get(k, d) {
    try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }
    catch (e) { return d; }
  }
  function set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function del(k) { try { localStorage.removeItem(k); } catch (e) {} }

  /* A stable id for a piece of content: lowercase, alphanumerics and dashes,
     capped so a long drill question does not become a 200-character key. The
     hash suffix keeps two similar questions apart. */
  function slug(text) {
    var s = String(text || '').toLowerCase()
      .replace(/`[^`]*`/g, ' ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return s.slice(0, 48).replace(/-+$/, '');
  }
  function hash(text) {
    var h = 5381, s = String(text || '');
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36).slice(0, 6);
  }
  /* kind is one character so keys stay short and readable in devtools */
  function idFor(kind, text) {
    return kind + ':' + (slug(text) || 'x') + '~' + hash(text);
  }

  var KEYS = ['lx.cards', 'lx.saved', 'lx.stats', 'lx.streak', 'lx.topic', 'lx.weak',
              'lx.labs', 'lx.sandbox', 'lx.playbooks', 'lx.view', 'lx.groupview',
              'lx.theme', 'lx.track', 'lx.pbmode', 'lx.schema'];

  /* ── migrations ─────────────────────────────────────────────────────
     Each takes localStorage from version n-1 to n. They must be safe to run
     on a fresh install (no keys at all) and safe to run twice. */
  var MIGRATIONS = {
    /* 1 -> 2: content-keyed cards and starred ids become stable slugs. The old
       key held the content text after the prefix, which is exactly what we need
       to build the new one, so nothing is lost and nothing needs the library
       to be loaded. */
    2: function () {
      var map = {};
      var cards = get('lx.cards', {});
      var next = {};
      Object.keys(cards).forEach(function (old) {
        var kind = old.charAt(0);
        if (old.indexOf(':') !== 1 || 'cds'.indexOf(kind) === -1) { next[old] = cards[old]; return; }
        var text = old.slice(2);
        var id = idFor(kind, text);
        map[old] = id;
        next[id] = cards[old];
        /* remember what it was, so a card whose content later changes can still
           be traced rather than silently reappearing as a duplicate */
        next[id].src = text;
      });
      set('lx.cards', next);

      var saved = get('lx.saved', []);
      if (Object.prototype.toString.call(saved) === '[object Array]') {
        set('lx.saved', saved.map(function (s) { return map[s] || s; }));
      }
    }
  };

  function migrate() {
    var from = get('lx.schema', null);
    if (from == null) {
      /* fresh install, or one that predates versioning — tell them apart by
         whether anything is stored at all */
      var used = KEYS.some(function (k) { return localStorage.getItem(k) != null; });
      from = used ? 1 : SCHEMA;
    }
    if (from >= SCHEMA) { set('lx.schema', SCHEMA); return { from: from, to: SCHEMA, ran: [] }; }
    var ran = [];
    for (var v = from + 1; v <= SCHEMA; v++) {
      if (MIGRATIONS[v]) { try { MIGRATIONS[v](); ran.push(v); } catch (e) {} }
    }
    set('lx.schema', SCHEMA);
    return { from: from, to: SCHEMA, ran: ran };
  }

  /* ── export / import ────────────────────────────────────────────────
     Progress lives on one device and there is no account. This is the only
     way it survives a new phone. */
  function exportAll() {
    var out = { schema: SCHEMA, exported: new Date().toISOString(), data: {} };
    KEYS.forEach(function (k) {
      var v = localStorage.getItem(k);
      if (v != null) out.data[k] = v;
    });
    return JSON.stringify(out, null, 2);
  }

  function importAll(text) {
    var parsed;
    try { parsed = JSON.parse(text); } catch (e) { return { ok: false, err: 'Not valid JSON.' }; }
    if (!parsed || !parsed.data || typeof parsed.data !== 'object') {
      return { ok: false, err: 'That file is not a looped export.' };
    }
    var n = 0;
    Object.keys(parsed.data).forEach(function (k) {
      if (KEYS.indexOf(k) === -1) return;      /* never write a key we do not own */
      try { localStorage.setItem(k, parsed.data[k]); n++; } catch (e) {}
    });
    /* an older export gets brought forward by the same migrations */
    if (parsed.schema != null) set('lx.schema', parsed.schema);
    var m = migrate();
    return { ok: true, keys: n, migrated: m.ran };
  }

  function reset() { KEYS.forEach(del); }

  window.LXStore = {
    SCHEMA: SCHEMA, KEYS: KEYS,
    slug: slug, hash: hash, idFor: idFor,
    migrate: migrate, exportAll: exportAll, importAll: importAll, reset: reset
  };

  /* run before anything reads storage */
  window.LXStore.migrated = migrate();
})();
