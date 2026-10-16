/* Simulator engine for the SRE & Cloud Deployment Foundations scenarios that
   are not Kubernetes-only (those run on k8s-model.js).

   What this is: deterministic, seeded state per scenario, a logical clock, and
   bounded command models (dig, openssl, curl, git, terraform, docker, aws,
   helm, flux, psql, promtool, cosign, beaconctl, python3 over fixture
   scripts…) whose output is derived from that state and whose writes mutate
   it. Anything outside the documented subset answers with an honest
   "not supported in this simulation" line naming what is, never a fake success.

   What this is not: a shell, an interpreter or proof of real execution. The
   Python verbs recognise specific, documented edits to fixture scripts; the
   local labs run real Python. No Math.random, no Date: a seed always
   reproduces the same world, which is what makes /reset exact and the tests
   replayable.

   Scenario worlds are built by a function of the seed (see sre-scenarios-*.js):
   it returns an LXShell world seed carrying `sre` (the state) and `extra`
   (verbs bound to that state). Loaded as a plain script (window.LXSim) or
   required from node. */
(function (root) {
  'use strict';

  var PER_COMMAND = 10;   /* logical seconds each scenario verb costs */

  /* ── deterministic randomness ───────────────────────────────── */
  function fnv(str) {
    var h = 0x811c9dc5;
    str = String(str);
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }
  function rng(seed) {
    var a = fnv(seed) || 1;
    var next = function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
      next: next,
      int: function (lo, hi) { return lo + Math.floor(next() * (hi - lo + 1)); },
      pick: function (arr) { return arr[Math.floor(next() * arr.length)]; },
      id: function (n) { var s = '', A = 'bcdfghjklmnpqrstvwxz2456789'; for (var i = 0; i < (n || 5); i++) s += A.charAt(Math.floor(next() * A.length)); return s; }
    };
  }
  /* which variant a seed selects: "selector-variant-b" → "b", "a7x" → hashed */
  function variantOf(seed, variants) {
    var m = /variant-([a-z0-9]+)$/.exec(String(seed));
    if (m && variants.indexOf(m[1]) !== -1) return m[1];
    return variants[fnv(seed) % variants.length];
  }
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }

  /* ── result helpers ─────────────────────────────────────────── */
  function ok(out) { return { out: out == null ? '' : (String(out).replace(/\n?$/, '\n')), code: 0 }; }
  function err(msg, code) { return { out: '', err: String(msg).replace(/\n?$/, '\n'), code: code == null ? 1 : code }; }
  function unsupported(tool, what, supported) {
    return err(tool + ': "' + what + '" is not supported in this simulation.\nSupported here: ' + supported.join(', ') +
      '.\nThe real tool does more; the matching local lab is where to use it.', 2);
  }
  function flags(args, valued) {
    var f = {}, pos = [], after = [];
    valued = valued || [];
    var stop = args.indexOf('--');
    var head = stop === -1 ? args : args.slice(0, stop);
    after = stop === -1 ? [] : args.slice(stop + 1);
    for (var i = 0; i < head.length; i++) {
      var t = head[i];
      if (/^--[a-z][a-z0-9-]*=/.test(t)) { var k = t.slice(2, t.indexOf('=')); f[k] = t.slice(t.indexOf('=') + 1); continue; }
      if (t.indexOf('--') === 0 && t.length > 2) {
        var key = t.slice(2);
        if (valued.indexOf(key) !== -1 && i + 1 < head.length) { f[key] = head[++i]; } else f[key] = true;
        continue;
      }
      if (t.charAt(0) === '-' && t.length > 1 && !/^-\d/.test(t)) {
        var k1 = t.slice(1);
        if (valued.indexOf(k1) !== -1 && i + 1 < head.length) { f[k1] = head[++i]; continue; }
        if (k1.length > 1 && valued.indexOf(k1.charAt(0)) !== -1) { f[k1.charAt(0)] = k1.slice(1); continue; }
        for (var j = 0; j < k1.length; j++) f[k1.charAt(j)] = true;
        continue;
      }
      pos.push(t);
    }
    return { f: f, pos: pos, after: after };
  }
  function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
  function table(head, rows) {
    var w = head.map(function (h, i) { return rows.reduce(function (a, r) { return Math.max(a, String(r[i]).length); }, h.length); });
    var line = function (r) { return r.map(function (c, i) { return i === r.length - 1 ? String(c) : pad(c, w[i] + 3); }).join('').replace(/\s+$/, ''); };
    return [line(head)].concat(rows.map(line)).join('\n') + '\n';
  }
  function hms(sec) { sec = Math.max(0, Math.floor(sec)); var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s; }
  /* a fixed wall-clock origin so timestamps are deterministic and plausible */
  function stamp(st) { return '2026-10-13T' + hms(32400 + (st.clock || 0)) + 'Z'; }

  /* every scenario verb goes through here: it costs logical time and lets the
     scenario's own tick hook run (reconcilers, probes, recurrence timers).
     NOTE for authors: LXShell.run ALSO calls st.hooks before and after every
     command line (built-ins included) without advancing the clock, so a hook
     runs up to three times per command. Hooks must be idempotent for a given
     st.clock: derive state from files, or step a model only when the clock
     has moved since the hook's last run (keep st._lastTick). */
  function wrap(st, fn) {
    return function (w, a, stdin) {
      st.clock = (st.clock || 0) + PER_COMMAND;
      (st.hooks || []).forEach(function (h) { try { h(st, w); } catch (e) {} });
      var r;
      try { r = fn(w, a, stdin); } catch (e) { r = err('simulator: ' + e.message); }
      return r;
    };
  }
  function bind(st, verbs) {
    var out = {};
    Object.keys(verbs).forEach(function (k) { out[k] = wrap(st, verbs[k]); });
    return out;
  }
  function risky(st, cmd, why) { st.risky = st.risky || []; st.risky.push({ cmd: cmd, why: why, at: st.clock || 0 }); }

  /* ── tiny structured-text helpers (YAML/INI/HCL subsets) ────────
     Enough to validate and edit the fixture files the scenarios ship, with
     the limits stated in each verb's help. */
  function yamlCheck(text) {
    /* indentation consistency, tabs, duplicate keys at one level, unclosed quotes, conflict markers */
    var problems = [], lines = String(text).split('\n'), stack = [{ indent: -1, keys: {} }];
    lines.forEach(function (ln, i) {
      var n = i + 1;
      if (/^(<{7}|={7}|>{7})/.test(ln)) { problems.push(n + ': unresolved merge conflict marker "' + ln.slice(0, 7) + '"'); return; }
      if (/\t/.test(ln.replace(/^[^#]*#.*$/, ''))) problems.push(n + ': tab character used for indentation (YAML requires spaces)');
      if (!ln.trim() || /^\s*#/.test(ln)) return;
      var indent = ln.match(/^ */)[0].length;
      if (indent % 2 !== 0) problems.push(n + ': indentation of ' + indent + ' is not a multiple of 2');
      while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
      var km = /^\s*(?:- )?([A-Za-z0-9_.-]+)\s*:(\s|$)/.exec(ln);
      if (km) {
        var top = stack[stack.length - 1];
        if (!/^\s*- /.test(ln) && top.keys[km[1]]) problems.push(n + ': duplicate key "' + km[1] + '" at this level (first at line ' + top.keys[km[1]] + ')');
        top.keys[km[1]] = n;
        if (/:\s*$/.test(ln)) stack.push({ indent: indent, keys: {} });
      }
      var q = (ln.match(/"/g) || []).length;
      if (q % 2 === 1) problems.push(n + ': unbalanced double quote');
    });
    return problems;
  }
  /* key: value lookups on a YAML subset, by dotted path over 2-space indentation */
  function yamlGet(text, path) {
    var parts = path.split('.'), lines = String(text).split('\n'), depth = 0, i = 0;
    for (var p = 0; p < parts.length; p++) {
      var found = false;
      for (; i < lines.length; i++) {
        var ln = lines[i];
        if (!ln.trim() || /^\s*#/.test(ln)) continue;
        var ind = ln.match(/^ */)[0].length;
        if (ind < depth) return undefined;
        if (ind !== depth) continue;
        var m = /^\s*(?:- )?([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(ln);
        if (m && m[1] === parts[p]) {
          if (p === parts.length - 1) return m[2].replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '');
          depth += 2; i++; found = true; break;
        }
      }
      if (!found) return undefined;
    }
    return undefined;
  }
  function yamlSet(text, path, value) {
    var parts = path.split('.'), lines = String(text).split('\n'), depth = 0, i = 0;
    for (var p = 0; p < parts.length; p++) {
      var found = false;
      for (; i < lines.length; i++) {
        var ln = lines[i];
        if (!ln.trim() || /^\s*#/.test(ln)) continue;
        var ind = ln.match(/^ */)[0].length;
        if (ind < depth) return null;
        if (ind !== depth) continue;
        var m = /^(\s*(?:- )?)([A-Za-z0-9_.-]+)(\s*:\s*)(.*)$/.exec(ln);
        if (m && m[2] === parts[p]) {
          if (p === parts.length - 1) { lines[i] = m[1] + m[2] + m[3] + value; return lines.join('\n'); }
          depth += 2; i++; found = true; break;
        }
      }
      if (!found) return null;
    }
    return null;
  }
  /* INI/env style: KEY=value or Key = value */
  function kvGet(text, key) {
    var re = new RegExp('^\\s*' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=\\s*(.*)$', 'm');
    var m = re.exec(String(text));
    return m ? m[1].replace(/^["']|["']$/g, '').trim() : undefined;
  }
  function kvSet(text, key, value) {
    var re = new RegExp('^([ \\t]*' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[ \\t]*=[ \\t]*)(.*)$', 'm');   /* [ \\t], not \\s: an empty value must not swallow the next line */
    if (!re.test(String(text))) return null;
    return String(text).replace(re, '$1' + value);
  }

  /* ── file helpers over the LXShell VFS ──────────────────────── */
  function fileOf(w, p) { var n = root.LXShell && root.LXShell.node(w, p); return n && n.t === 'f' ? n : null; }
  function readFile(w, p) { var n = fileOf(w, p); return n ? (n.content || '') : null; }
  function writeFile(w, p, content) {
    var n = fileOf(w, p);
    if (n) { n.content = content; n.size = undefined; return true; }
    if (root.LXShell && root.LXShell.util) { root.LXShell.util.mkfile(w, p, content); return true; }
    return false;
  }

  /* `edit FILE KEY VALUE`: a documented lab convenience for phones — sets a
     YAML (dotted path), INI/env (KEY=) or HCL (key = ) value in place.
     Clearly not a real tool; sed -i and echo > work too. */
  function editVerb() {
    return function (w, a) {
      if (a.length < 3 || a[0] === '--help') {
        return ok('edit is a SIMULATION convenience, not a real tool.\nUsage: edit FILE KEY VALUE\n  YAML: dotted path (edit app.yaml server.port 8080)\n  INI/env/HCL: key name (edit beacon.env LISTEN_ADDR 0.0.0.0)\n  directives: first word (edit /etc/resolv.conf nameserver 10.0.0.53)\nsed -i and echo > FILE also work.');
      }
      var file = a[0], key = a[1], value = a.slice(2).join(' ');
      var text = readFile(w, file);
      if (text == null) return err('edit: ' + file + ': No such file');
      var next = yamlSet(text, key, value);
      if (next == null) next = kvSet(text, key, value);
      if (next == null) {
        var re = new RegExp('^(\\s*' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=\\s*)(.*)$', 'm');
        if (re.test(text)) next = text.replace(re, '$1' + value);
      }
      if (next == null) {   /* space-separated directives: resolv.conf, sshd_config, nginx */
        var re2 = new RegExp('^(\\s*' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+)([^;\\n]*)', 'm');
        if (re2.test(text)) next = text.replace(re2, '$1' + value);
      }
      if (next == null) return err('edit: key "' + key + '" not found in ' + file + ' (dotted YAML path, or KEY for = files)');
      writeFile(w, file, next);
      return ok('');
    };
  }

  /* ═══ DNS model ════════════════════════════════════════════════
     st.dns = { zones: { 'corp.lab': { ns: ['10.0.0.10'], soa, records: { 'api.corp.lab': { A: ['10.0.5.20'], TTL } },
                                       delegations: { 'eu.corp.lab': ['10.0.0.11'] } } },
                servers: { '10.0.0.10': { zones: ['corp.lab'] }, '10.0.0.53': { recursive: true, cache: {} } },
                defaultServer: '10.0.0.53' }
     Negative answers are cached at the recursive server for `negTtl` seconds
     of logical time; a repaired delegation does not take effect for a cached
     name until the entry expires or is flushed. */
  function dnsAuthoritative(st, server, name, type) {
    var srv = st.dns.servers[server];
    if (!srv) return { status: 'unreachable' };
    if (srv.recursive) return null;
    var zones = srv.zones.slice().sort(function (a, b) { return b.length - a.length; });
    for (var i = 0; i < zones.length; i++) {
      var zn = zones[i], z = st.dns.zones[zn];
      if (!z || !(name === zn || name.slice(-zn.length - 1) === '.' + zn)) continue;
      var dels = Object.keys(z.delegations || {}).sort(function (a, b) { return b.length - a.length; });
      for (var d = 0; d < dels.length; d++) {
        var dz = dels[d];
        if (name === dz || name.slice(-dz.length - 1) === '.' + dz) {
          return { status: 'REFERRAL', zone: dz, ns: z.delegations[dz], aa: true };
        }
      }
      var rec = (z.records || {})[name];
      if (rec && rec[type]) return { status: 'NOERROR', aa: true, zone: zn, answers: rec[type].slice(), ttl: rec.ttl || z.ttl || 300 };
      if (rec && type !== 'ANY') return { status: 'NOERROR', aa: true, zone: zn, answers: [], ttl: z.negTtl || 60, nodata: true };
      return { status: 'NXDOMAIN', aa: true, zone: zn, ttl: z.negTtl || 60 };
    }
    return { status: 'REFUSED' };
  }
  function dnsRecurse(st, server, name, type) {
    var srv = st.dns.servers[server];
    if (!srv) return { status: 'unreachable' };
    if (!srv.recursive) return dnsAuthoritative(st, server, name, type);
    srv.cache = srv.cache || {};
    var key = name + '/' + type, c = srv.cache[key];
    if (c && c.expires > (st.clock || 0)) return Object.assign({ cached: true, ttlLeft: c.expires - (st.clock || 0) }, c.res);
    /* walk from the root hint down through delegations */
    var cur = srv.rootHint || st.dns.root, hops = 0, res = null;
    while (hops++ < 8) {
      res = dnsAuthoritative(st, cur, name, type);
      if (!res) { res = { status: 'SERVFAIL' }; break; }
      /* an authority that refuses (e.g. a deleted zone's old servers) is a lame delegation: resolvers answer SERVFAIL */
      if (res.status === 'REFUSED') { res = { status: 'SERVFAIL', why: 'the delegated server ' + cur + ' refused the query (lame delegation)' }; break; }
      if (res.status === 'REFERRAL') {
        var nsList = res.ns.filter(function (x) { return st.dns.servers[x]; });
        if (!nsList.length) { res = { status: 'SERVFAIL', why: 'delegation to ' + res.ns.join(',') + ' points at nothing that answers' }; break; }
        cur = nsList[0]; continue;
      }
      break;
    }
    var ttl = res.ttl == null ? 60 : res.ttl;
    srv.cache[key] = { res: res, expires: (st.clock || 0) + ttl };
    return Object.assign({ cached: false, ttlLeft: ttl }, res);
  }
  function digVerb(st) {
    return function (w, a) {
      var server = null, name = null, type = 'A', short = false, norec = false, trace = false, help = false;
      a.forEach(function (t) {
        if (t.charAt(0) === '@') server = t.slice(1);
        else if (t === '+short') short = true;
        else if (t === '+norecurse' || t === '+norec') norec = true;
        else if (t === '+trace') trace = true;
        else if (/^\+/.test(t)) { /* other options accepted and ignored */ }
        else if (/^(A|AAAA|NS|SOA|CNAME|TXT|ANY)$/i.test(t) && name) type = t.toUpperCase();
        else if (t === '-h' || t === '--help') help = true;
        else if (!name) name = t.replace(/\.$/, '');
      });
      if (help || !name) return ok('dig (simulation): dig [@server] NAME [A|NS|SOA|CNAME|TXT] [+short] [+norecurse] [+trace]\nServers: ' + Object.keys(st.dns.servers).join(', '));
      server = server || st.dns.defaultServer;
      if (st.dns.servers[server] && st.dns.servers[server].names) server = st.dns.servers[server].names[name] || server;
      var res = norec ? (dnsAuthoritative(st, server, name, type) || { status: 'REFUSED' }) : dnsRecurse(st, server, name, type);
      if (res.status === 'unreachable') return err(';; communications error to ' + server + '#53: connection refused\n;; no servers could be reached', 9);
      if (trace) {
        var lines = [';; TRACE (simulated): walking delegations from the root hint ' + (st.dns.root || '?')];
        var cur = st.dns.root, hops = 0;
        while (hops++ < 8) {
          var r2 = dnsAuthoritative(st, cur, name, type);
          if (!r2) break;
          if (r2.status === 'REFERRAL') { lines.push(name + '. referral to zone ' + r2.zone + ' NS ' + r2.ns.join(' ') + ' ;; from ' + cur); var nx = r2.ns.filter(function (x) { return st.dns.servers[x]; })[0]; if (!nx) { lines.push(';; none of ' + r2.ns.join(',') + ' answers — delegation is broken'); break; } cur = nx; continue; }
          lines.push(';; ' + r2.status + ' from ' + cur + (r2.answers && r2.answers.length ? ': ' + r2.answers.join(' ') : '')); break;
        }
        return ok(lines.join('\n'));
      }
      if (short) {
        if (res.status === 'NOERROR' && res.answers && res.answers.length) return ok(res.answers.join('\n'));
        return { out: '', code: 0 };
      }
      var flagsStr = 'qr' + (res.aa ? ' aa' : '') + (norec ? '' : ' rd ra');
      var out = '; <<>> DiG 9.18 (simulated) <<>> ' + (a.join(' ')) + '\n;; ->>HEADER<<- opcode: QUERY, status: ' + res.status + ', id: ' + (fnv(name + st.clock) % 65535) + '\n;; flags: ' + flagsStr + '; QUERY: 1, ANSWER: ' + ((res.answers || []).length) + '\n\n;; QUESTION SECTION:\n;' + name + '.\t\t\tIN\t' + type + '\n';
      if (res.status === 'NOERROR' && res.answers && res.answers.length) {
        out += '\n;; ANSWER SECTION:\n' + res.answers.map(function (x) { return name + '.\t\t' + (res.ttlLeft == null ? res.ttl : res.ttlLeft) + '\tIN\t' + type + '\t' + x; }).join('\n') + '\n';
      } else if (res.status === 'REFERRAL') {
        out += '\n;; AUTHORITY SECTION:\n' + res.ns.map(function (x) { return res.zone + '.\t\t300\tIN\tNS\t' + x; }).join('\n') + '\n';
      } else if (res.status === 'NXDOMAIN' || res.nodata) {
        out += '\n;; AUTHORITY SECTION:\n' + (res.zone || name) + '.\t\t' + (res.ttlLeft == null ? res.ttl : res.ttlLeft) + '\tIN\tSOA\tns1.' + (res.zone || name) + '. hostmaster.' + (res.zone || name) + '. 2026101301 3600 600 86400 ' + (res.ttl || 60) + '\n';
      } else if (res.status === 'SERVFAIL' && res.why) out += ';; ' + res.why + '\n';
      out += '\n;; Query time: ' + (res.cached ? 0 : 12) + ' msec\n;; SERVER: ' + server + '#53(' + server + ')' + (res.cached ? '  ;; (answer served from cache, ' + res.ttlLeft + 's left)' : '') + '\n';
      return ok(out);
    };
  }
  /* `resolvectl`/`rndc`-like cache control, kept to one honest verb */
  function dnsCacheVerb(st) {
    return function (w, a) {
      var server = a[0] === 'flush' ? (a[1] || st.dns.defaultServer) : null;
      if (a[0] === 'flush') {
        var srv = st.dns.servers[server];
        if (!srv || !srv.recursive) return err('dnscache: ' + server + ' is not a recursive resolver here');
        var n = Object.keys(srv.cache || {}).length; srv.cache = {};
        return ok('flushed ' + n + ' cached entries on ' + server);
      }
      if (a[0] === 'show') {
        var s2 = st.dns.servers[a[1] || st.dns.defaultServer];
        if (!s2 || !s2.recursive) return err('dnscache: not a recursive resolver');
        var keys = Object.keys(s2.cache || {});
        if (!keys.length) return ok('(cache empty)');
        return ok(keys.map(function (k) { var c = s2.cache[k]; return pad(k, 28) + pad(c.res.status, 10) + 'expires in ' + Math.max(0, c.expires - st.clock) + 's'; }).join('\n'));
      }
      return ok('dnscache is a SIMULATION stand-in for your resolver\'s cache controls (rndc flush, resolvectl flush-caches).\nUsage: dnscache show [SERVER] | dnscache flush [SERVER]');
    };
  }
  /* zone editing: `zonectl add ZONE NAME TYPE VALUE`, `zonectl delegate ZONE SUB NS`, `zonectl show ZONE` */
  function zoneVerb(st) {
    return function (w, a) {
      var op = a[0];
      if (op === 'show') {
        var z = st.dns.zones[a[1]];
        if (!z) return err('zonectl: zone ' + a[1] + ' not served here');
        var lines = ['$ORIGIN ' + a[1] + '.', '@ IN SOA ns1.' + a[1] + '. hostmaster.' + a[1] + '. (2026101301 3600 600 86400 ' + (z.negTtl || 60) + ')'];
        var dels = Object.keys(z.delegations || {});
        lines.push('; (zonectl) subzones delegated from this zone: ' + (dels.length ? dels.map(function (d) { return d + ' -> ' + z.delegations[d].join(' '); }).join(', ') : 'none'));
        lines.push('@ IN NS ' + (z.ns || []).join(' '));
        dels.forEach(function (d) { z.delegations[d].forEach(function (ns) { lines.push(d + '. IN NS ' + ns); }); });
        Object.keys(z.records || {}).forEach(function (n) { Object.keys(z.records[n]).forEach(function (t) { if (t === 'ttl') return; z.records[n][t].forEach(function (v) { lines.push(n + '. ' + (z.records[n].ttl || z.ttl || 300) + ' IN ' + t + ' ' + v); }); }); });
        return ok(lines.join('\n'));
      }
      if (op === 'delegate' && a.length >= 4) {
        var pz = st.dns.zones[a[1]];
        if (!pz) return err('zonectl: zone ' + a[1] + ' not served here');
        pz.delegations = pz.delegations || {}; pz.delegations[a[2]] = a.slice(3);
        pz.serial = (pz.serial || 2026101301) + 1;
        return ok('zone ' + a[1] + ': delegation ' + a[2] + ' -> ' + a.slice(3).join(' ') + ' (serial ' + pz.serial + ')');
      }
      if (op === 'add' && a.length >= 5) {
        var az = st.dns.zones[a[1]];
        if (!az) return err('zonectl: zone ' + a[1] + ' not served here');
        az.records = az.records || {}; az.records[a[2]] = az.records[a[2]] || {};
        az.records[a[2]][a[3].toUpperCase()] = [a[4]];
        return ok('zone ' + a[1] + ': ' + a[2] + ' ' + a[3].toUpperCase() + ' ' + a[4]);
      }
      return ok('zonectl is a SIMULATION stand-in for editing an authoritative zone and reloading it.\nUsage: zonectl show ZONE | zonectl delegate ZONE SUBZONE NS... | zonectl add ZONE NAME TYPE VALUE');
    };
  }

  /* ═══ HTTP / TLS model ═════════════════════════════════════════
     st.net = { hosts: { 'beacon.corp.lab': '10.0.5.20' },
                listeners: [{ addr: '0.0.0.0'|'127.0.0.1', port: 8443, host: '10.0.5.20', app: 'proxy', tls: 'cert-proxy' }],
                apps: { proxy: { upstream: { host, port }, hostHeader }, beacon: { routes: { '/healthz': {code, body} }, version } },
                certs: { 'cert-proxy': { cn, sans: [], issuer, ca: 'lab-ca', notAfter } }, cas: { 'lab-ca': { trusted: true } },
                from: '10.0.5.9' (where curl runs) } */
  function listenerFor(st, hostIp, port) {
    return (st.net.listeners || []).filter(function (l) { return String(l.port) === String(port) && (l.host === hostIp || l.host === '*'); })[0] || null;
  }
  function resolveHost(st, host) {
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return host;
    if (host === 'localhost') return '127.0.0.1';
    if (st.net.hosts && st.net.hosts[host]) return st.net.hosts[host];
    if (st.dns) { var r = dnsRecurse(st, st.dns.defaultServer, host, 'A'); if (r.status === 'NOERROR' && r.answers && r.answers.length) return r.answers[0]; }
    return null;
  }
  function appRespond(st, appId, req) {
    var app = st.net.apps[appId];
    if (!app) return { code: 502, body: 'Bad Gateway' };
    if (typeof app.handle === 'function') return app.handle(req, st);
    if (app.upstream) {
      var up = app.upstream, l = listenerFor(st, up.host, up.port);
      if (!l || (l.addr === '127.0.0.1' && up.host !== '127.0.0.1')) return { code: 502, body: 'Bad Gateway: upstream ' + up.host + ':' + up.port + ' connection refused', headers: { 'X-Upstream': up.host + ':' + up.port } };
      var r = appRespond(st, l.app, Object.assign({}, req, { host: app.hostHeader || req.host }));
      r.headers = Object.assign({ 'X-Upstream': up.host + ':' + up.port }, r.headers || {});
      return r;
    }
    var routes = app.routes || {};
    var hit = routes[req.path] || routes[req.path.replace(/\?.*$/, '')];
    if (!hit) return { code: 404, body: 'not found: ' + req.path, headers: { 'X-Beacon-Version': app.version || '' } };
    var resp = typeof hit === 'function' ? hit(req, st) : clone(hit);
    resp.headers = Object.assign({ 'X-Beacon-Version': app.version || '' }, resp.headers || {});
    return resp;
  }
  function tlsCheck(st, listener, servername, opts) {
    var cert = st.net.certs[listener.tls];
    if (!cert) return { ok: false, why: 'no certificate' };
    var ca = st.net.cas[cert.ca];
    var trusted = (ca && ca.trusted) || (opts.cacert && opts.cacert === cert.ca) || opts.insecure;
    if (!trusted) return { ok: false, why: 'unable to verify the first certificate (issuer "' + cert.issuer + '" is not in the trust store' + (opts.cacert ? '; --cacert names ' + opts.cacert : '') + ')', code: 60 };
    var names = [cert.cn].concat(cert.sans || []);
    var match = names.some(function (n) { return n === servername || (n.indexOf('*.') === 0 && servername.indexOf('.') > 0 && servername.slice(servername.indexOf('.') + 1) === n.slice(2)); });
    if (!match && !opts.insecure) return { ok: false, why: 'SSL: no alternative certificate subject name matches target host name \'' + servername + '\' (certificate names: ' + names.join(', ') + ')', code: 60 };
    if (cert.expired && !opts.insecure) return { ok: false, why: 'SSL certificate problem: certificate has expired', code: 60 };
    return { ok: true, cert: cert };
  }
  function curlVerb(st) {
    return function (w, a) {
      var f = flags(a, ['H', 'X', 'd', 'o', 'w', 'cacert', 'resolve', 'connect-timeout', 'max-time', 'data', 'header', 'request', 'output', 'user', 'u']);
      var url = f.pos.filter(function (x) { return /^https?:\/\//.test(x) || /^[a-z0-9.-]+(:\d+)?(\/|$)/i.test(x); }).pop();
      if (!url) return err('curl: no URL specified!');
      var m = /^(https?):\/\/([^/:]+)(?::(\d+))?(\/.*)?$/.exec(/^https?:\/\//.test(url) ? url : 'http://' + url);
      if (!m) return err('curl: (3) URL rejected: Malformed input to a URL function', 3);
      var scheme = m[1], host = m[2], port = m[3] ? Number(m[3]) : (scheme === 'https' ? 443 : 80), path = m[4] || '/';
      var headers = {};
      [].concat(f.f.H || [], f.f.header || []).forEach(function (h) { if (typeof h === 'string') { var i = h.indexOf(':'); if (i > 0) headers[h.slice(0, i).trim().toLowerCase()] = h.slice(i + 1).trim(); } });
      var insecure = !!(f.f.k || f.f.insecure), verbose = !!(f.f.v || f.f.verbose), head = !!(f.f.I || f.f.head), include = !!(f.f.i || f.f.include);
      if (insecure) risky(st, 'curl ' + a.join(' '), 'curl -k skips certificate verification: fine for a probe, never the fix');
      var ip = null;
      if (f.f.resolve && typeof f.f.resolve === 'string') { var rp = f.f.resolve.split(':'); if (rp[0] === host && String(rp[1]) === String(port)) ip = rp[2]; }
      ip = ip || resolveHost(st, host);
      if (!ip) return err('curl: (6) Could not resolve host: ' + host, 6);
      var l = listenerFor(st, ip, port);
      var fromLocal = ip === '127.0.0.1' || st.net.from === ip;
      if (!l || (l.addr === '127.0.0.1' && !fromLocal)) return err('curl: (7) Failed to connect to ' + host + ' port ' + port + ' after 2 ms: Connection refused', 7);
      if (l.filtered && !fromLocal) return err('curl: (28) Connection timed out after ' + (f.f['connect-timeout'] ? f.f['connect-timeout'] * 1000 : 30001) + ' milliseconds', 28);
      var vlines = [];
      if (verbose) vlines.push('* Connected to ' + host + ' (' + ip + ') port ' + port);
      if (scheme === 'https') {
        if (!l.tls) return err('curl: (35) error:0A00010B:SSL routines::wrong version number (the server on port ' + port + ' is not speaking TLS)', 35);
        var t = tlsCheck(st, l, host, { cacert: f.f.cacert ? ((st.net.cafiles || {})[f.f.cacert] || f.f.cacert) : null, insecure: insecure });
        if (!t.ok) return err((verbose ? vlines.join('\n') + '\n' : '') + 'curl: (' + (t.code || 35) + ') ' + t.why, t.code || 35);
        if (verbose) { vlines.push('* SSL connection using TLSv1.3 / TLS_AES_256_GCM_SHA384'); vlines.push('* Server certificate:'); vlines.push('*  subject: CN=' + t.cert.cn); vlines.push('*  subjectAltName: ' + (t.cert.sans || []).map(function (x) { return 'host "' + x + '"'; }).join(', ')); vlines.push('*  issuer: ' + t.cert.issuer); vlines.push('*  SSL certificate verify ok.'); }
      } else if (l.tls) return err('curl: (1) Received HTTP/0.9 when not allowed (the server on port ' + port + ' expects TLS)', 1);
      var req = { method: f.f.X || f.f.request || (head ? 'HEAD' : (f.f.d || f.f.data ? 'POST' : 'GET')), path: path, host: headers.host || host, headers: headers, body: f.f.d || f.f.data || '', from: st.net.from, port: port, clock: st.clock };
      var resp = appRespond(st, l.app, req);
      if (resp.delayMs && f.f['max-time'] && resp.delayMs > Number(f.f['max-time']) * 1000) return err('curl: (28) Operation timed out after ' + (Number(f.f['max-time']) * 1000) + ' milliseconds with 0 bytes received', 28);
      st.net.requests = st.net.requests || []; st.net.requests.push({ at: st.clock, path: path, code: resp.code, host: req.host, port: port, via: l.app });
      var out = '';
      if (verbose) out += vlines.join('\n') + '\n> ' + req.method + ' ' + path + ' HTTP/1.1\n> Host: ' + req.host + '\n';
      if (f.f.w && typeof f.f.w === 'string' && f.f.w.indexOf('%{http_code}') !== -1) return ok(String(resp.code));
      if (head || include || verbose) {
        out += 'HTTP/1.1 ' + resp.code + ' ' + ({ 200: 'OK', 201: 'Created', 204: 'No Content', 301: 'Moved Permanently', 302: 'Found', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout' }[resp.code] || '') + '\n';
        Object.keys(resp.headers || {}).forEach(function (k) { if (resp.headers[k] !== '') out += k + ': ' + resp.headers[k] + '\n'; });
        out += 'Content-Type: ' + (resp.type || (typeof resp.body === 'object' ? 'application/json' : 'text/plain')) + '\n\n';
      }
      if (!head) out += typeof resp.body === 'object' ? JSON.stringify(resp.body) : (resp.body || '');
      if (f.f.o === '/dev/null') out = (head || include || verbose) ? out : '';
      return { out: out.replace(/\n?$/, '\n'), code: 0 };
    };
  }
  function opensslVerb(st) {
    return function (w, a) {
      var sub = a[0];
      if (sub === 's_client') {
        var f = flags(a.slice(1), ['connect', 'servername', 'CAfile']);
        var cp = String(f.f.connect || '').split(':'), host = cp[0], port = Number(cp[1] || 443);
        if (!host) return err('openssl s_client: -connect host:port is required');
        var ip = resolveHost(st, host);
        if (!ip) return err('openssl: could not resolve ' + host);
        var l = listenerFor(st, ip, port);
        if (!l || (l.addr === '127.0.0.1' && ip !== '127.0.0.1')) return err('connect:errno=111 (Connection refused)');
        if (!l.tls) return err('error:0A00010B:SSL routines::wrong version number (no TLS on ' + host + ':' + port + ')');
        var cert = st.net.certs[l.tls], sni = f.f.servername || host;
        var t = tlsCheck(st, l, sni, { cacert: f.f.CAfile ? ((st.net.cafiles || {})[f.f.CAfile] || f.f.CAfile) : null });
        var out = 'CONNECTED(00000003)\n' + (t.ok ? 'depth=1 CN = ' + cert.issuer + '\nverify return:1\ndepth=0 CN = ' + cert.cn + '\nverify return:1\n' : 'depth=0 CN = ' + cert.cn + '\nverify error:num=' + (/(hostname|host name)/i.test(t.why) ? '62:hostname mismatch' : cert.expired ? '10:certificate has expired' : '20:unable to get local issuer certificate') + '\n') +
          '---\nCertificate chain\n 0 s:CN = ' + cert.cn + '\n   i:CN = ' + cert.issuer + '\n---\nServer certificate\nsubject=CN = ' + cert.cn + '\nissuer=CN = ' + cert.issuer + '\nX509v3 Subject Alternative Name: ' + (cert.sans || []).map(function (x) { return 'DNS:' + x; }).join(', ') + '\nNot After : ' + (cert.notAfter || 'Oct 13 09:00:00 2027 GMT') + '\n---\nSSL handshake has read 1424 bytes and written 393 bytes\nVerification' + (t.ok ? ': OK' : ' error: ' + t.why) + '\n---\nNew, TLSv1.3, Cipher is TLS_AES_256_GCM_SHA384\n';
        return { out: out, code: 0 };
      }
      if (sub === 'x509') {
        var f2 = flags(a.slice(1), ['in']);
        var text = f2.f['in'] ? readFile(w, f2.f['in']) : null;
        if (text == null) return err('openssl x509: cannot read ' + (f2.f['in'] || 'stdin'));
        var id = (/# cert:\s*(\S+)/.exec(text) || [])[1], c = id && st.net.certs[id];
        if (!c) return err('openssl x509: unable to load certificate (not a PEM certificate this simulation knows)');
        var lines = [];
        if (f2.f.subject) lines.push('subject=CN = ' + c.cn);
        if (f2.f.issuer) lines.push('issuer=CN = ' + c.issuer);
        if (f2.f.dates) lines.push('notBefore=Oct 13 09:00:00 2026 GMT\nnotAfter=' + (c.notAfter || 'Oct 13 09:00:00 2027 GMT'));
        if (f2.f.ext === 'subjectAltName' || f2.f.ext === true || f2.f.text) lines.push('X509v3 Subject Alternative Name: \n    ' + (c.sans || []).map(function (x) { return 'DNS:' + x; }).join(', '));
        if (!lines.length) lines.push('subject=CN = ' + c.cn + '\nissuer=CN = ' + c.issuer + '\nX509v3 Subject Alternative Name: ' + (c.sans || []).map(function (x) { return 'DNS:' + x; }).join(', '));
        return ok(lines.join('\n'));
      }
      if (sub === 'verify') {
        var f3 = flags(a.slice(1), ['CAfile']);
        var file = f3.pos[0], txt = file ? readFile(w, file) : null;
        if (txt == null) return err('openssl verify: cannot read ' + file);
        var cid = (/# cert:\s*(\S+)/.exec(txt) || [])[1], cc = cid && st.net.certs[cid];
        if (!cc) return err('openssl verify: not a certificate this simulation knows');
        var caName = f3.f.CAfile ? ((st.net.cafiles || {})[f3.f.CAfile] || f3.f.CAfile) : null;
        var okv = (st.net.cas[cc.ca] && st.net.cas[cc.ca].trusted) || caName === cc.ca;
        return okv ? ok(file + ': OK') : err('CN = ' + cc.cn + '\nerror 20 at 0 depth lookup: unable to get local issuer certificate\nerror ' + file + ': verification failed', 2);
      }
      return unsupported('openssl', sub || '', ['s_client -connect host:port [-servername x] [-CAfile f]', 'x509 -in f -noout -subject -issuer -dates -ext subjectAltName', 'verify -CAfile f cert.pem']);
    };
  }

  /* ═══ Git model ════════════════════════════════════════════════
     st.git = { branch, head, log: [{sha, msg}], staged: [], modified: [], conflicts: ['deploy/beacon.yaml'],
                remote: 'origin', files: { path: tracked content at HEAD }, merging: 'feature/x' }
     Content lives in the VFS; git compares VFS text to st.git.files. */
  function gitVerb(st) {
    function tracked(w) { return Object.keys(st.git.files); }
    function status(w) {
      var mod = [], del = [];
      tracked(w).forEach(function (p) { var t = readFile(w, p); if (t == null) del.push(p); else if (t !== st.git.files[p]) mod.push(p); });
      return { modified: mod, deleted: del, conflicts: (st.git.conflicts || []).filter(function (p) { var t = readFile(w, p) || ''; return /^(<{7}|={7}|>{7})/m.test(t); }) };
    }
    function diffLines(a, b) {
      var al = String(a).split('\n'), bl = String(b).split('\n'), out = [], i = 0, j = 0;
      while (i < al.length || j < bl.length) {
        if (i < al.length && j < bl.length && al[i] === bl[j]) { out.push(' ' + al[i]); i++; j++; continue; }
        var k = bl.indexOf(al[i], j), l = al.indexOf(bl[j], i);
        if (i < al.length && (k === -1 || (l !== -1 && l - i <= k - j))) { out.push('-' + al[i]); i++; }
        else if (j < bl.length) { out.push('+' + bl[j]); j++; }
      }
      return out;
    }
    return function (w, a) {
      var sub = a[0];
      if (!sub || sub === '--help') return ok('git (simulation): status, diff [--staged] [FILE], log [--oneline], add FILE, commit -m MSG, checkout -- FILE | checkout --ours|--theirs FILE | checkout BRANCH, revert HEAD, merge BRANCH, merge --abort, push, branch, show HEAD:FILE');
      var s = status(w);
      if (sub === 'status') {
        var lines = ['On branch ' + st.git.branch];
        if (st.git.merging) lines.push('You have unmerged paths.\n  (fix conflicts and run "git commit")\n  (use "git merge --abort" to abort the merge)');
        if (s.conflicts.length) lines.push('\nUnmerged paths:\n  (use "git add <file>..." to mark resolution)\n' + s.conflicts.map(function (p) { return '\tboth modified:   ' + p; }).join('\n'));
        var st2 = (st.git.staged || []);
        if (st2.length) lines.push('\nChanges to be committed:\n' + st2.map(function (p) { return '\tmodified:   ' + p; }).join('\n'));
        var un = s.modified.filter(function (p) { return st2.indexOf(p) === -1 && s.conflicts.indexOf(p) === -1; });
        if (un.length) lines.push('\nChanges not staged for commit:\n  (use "git add <file>..." to update what will be committed)\n' + un.map(function (p) { return '\tmodified:   ' + p; }).join('\n'));
        if (!s.conflicts.length && !un.length && !st2.length) lines.push('nothing to commit, working tree clean');
        return ok(lines.join('\n'));
      }
      if (sub === 'diff') {
        var staged = a.indexOf('--staged') !== -1 || a.indexOf('--cached') !== -1;
        var files = a.slice(1).filter(function (x) { return x.charAt(0) !== '-'; });
        if (!files.length) files = s.modified.concat(s.conflicts.filter(function (p) { return s.modified.indexOf(p) === -1; }));
        var out = [];
        files.forEach(function (p) {
          var base = staged ? st.git.files[p] : (st.git.staged || []).indexOf(p) !== -1 ? (st.git.stagedContent || {})[p] : st.git.files[p];
          var cur = staged ? ((st.git.stagedContent || {})[p] != null ? st.git.stagedContent[p] : readFile(w, p)) : readFile(w, p);
          if (base == null || cur == null || base === cur) return;
          out.push('diff --git a/' + p + ' b/' + p + '\n--- a/' + p + '\n+++ b/' + p + '\n@@ @@\n' + diffLines(base, cur).join('\n'));
        });
        return ok(out.join('\n') || '');
      }
      if (sub === 'log') {
        var one = a.indexOf('--oneline') !== -1;
        return ok(st.git.log.map(function (c) { return one ? c.sha.slice(0, 7) + ' ' + c.msg : 'commit ' + c.sha + '\nAuthor: ' + (c.author || 'brett <brett@corp.lab>') + '\n\n    ' + c.msg + '\n'; }).join('\n'));
      }
      if (sub === 'show') {
        var ref = a[1] || '';
        var sp = ref.split(':');
        if (sp.length === 2) { var content = (sp[0] === 'HEAD' || sp[0] === st.git.branch) ? st.git.files[sp[1]] : (st.git.branches || {})[sp[0]] && st.git.branches[sp[0]][sp[1]]; if (content == null) return err('fatal: path \'' + sp[1] + '\' does not exist in \'' + sp[0] + '\''); return ok(content); }
        return ok('commit ' + st.git.log[0].sha + '\n\n    ' + st.git.log[0].msg);
      }
      if (sub === 'add') {
        var p = a[1]; if (!p) return err('Nothing specified, nothing added.');
        if (p === '.' || p === '-A') { s.modified.concat(s.conflicts).forEach(function (x) { stage(x); }); return ok(''); }
        if (readFile(w, p) == null) return err('fatal: pathspec \'' + p + '\' did not match any files', 128);
        if (/^(<{7}|={7}|>{7})/m.test(readFile(w, p))) return err('error: \'' + p + '\' still has conflict markers; resolve them before adding (git add will not accept an unresolved file in this simulation)');
        stage(p); return ok('');
      }
      if (sub === 'commit') {
        var mi = a.indexOf('-m'), msg = mi !== -1 ? a.slice(mi + 1).join(' ').replace(/^["']|["']$/g, '') : '';
        if (!msg) return err('Aborting commit due to empty commit message.');
        var staged2 = st.git.staged || [];
        if (s.conflicts.length) return err('error: Committing is not possible because you have unmerged files.\nhint: Fix them up in the work tree, and then use \'git add <file>\'');
        if (!staged2.length && !st.git.merging) return err('nothing to commit, working tree clean');
        staged2.forEach(function (p2) { st.git.files[p2] = st.git.stagedContent[p2]; });
        var sha = fnv(msg + st.clock).toString(16) + fnv('x' + msg).toString(16);
        while (sha.length < 40) sha += fnv(sha).toString(16);   /* full-length, deterministic */
        sha = sha.slice(0, 40);
        st.git.log.unshift({ sha: sha, msg: msg, files: staged2.slice() });
        st.git.staged = []; st.git.stagedContent = {};
        if (st.git.merging) { st.git.log[0].merge = st.git.merging; st.git.merging = null; st.git.conflicts = []; }
        st.git.ahead = (st.git.ahead || 0) + 1;
        return ok('[' + st.git.branch + ' ' + sha.slice(0, 7) + '] ' + msg);
      }
      if (sub === 'checkout') {
        if ((a[1] === '--ours' || a[1] === '--theirs') && a[a.length - 1] && a[a.length - 1] !== a[1]) {
          var fp = a[a.length - 1];
          if (!st.git.merging || (st.git.conflicts || []).indexOf(fp) === -1) return err('error: path \'' + fp + '\' does not have ' + (a[1] === '--ours' ? 'our' : 'their') + ' version');
          var side = a[1] === '--ours' ? st.git.files[fp] : ((st.git.branches || {})[st.git.merging] || {})[fp];
          writeFile(w, fp, side); return ok('Updated 1 path from the index');
        }
        if (a[1] === '--' && a[2]) { if (st.git.files[a[2]] == null) return err('error: pathspec \'' + a[2] + '\' did not match any file(s) known to git'); writeFile(w, a[2], st.git.files[a[2]]); return ok(''); }
        if (a[1] === '-b' && a[2]) { st.git.branch = a[2]; return ok('Switched to a new branch \'' + a[2] + '\''); }
        if (a[1] && (st.git.branches || {})[a[1]]) { st.git.branch = a[1]; return ok('Switched to branch \'' + a[1] + '\''); }
        return err('error: pathspec \'' + (a[1] || '') + '\' did not match any file(s) known to git');
      }
      if (sub === 'revert') {
        var target = st.git.log[0];
        if (a[1] && a[1] !== 'HEAD' && target.sha.indexOf(a[1]) !== 0) { target = st.git.log.filter(function (c) { return c.sha.indexOf(a[1]) === 0; })[0]; }
        if (!target || !target.before) return err('error: this simulation can only revert commits whose parent content it holds (HEAD' + (target && !target.before ? ', which has no recorded parent content' : '') + ')');
        Object.keys(target.before).forEach(function (p3) { st.git.files[p3] = target.before[p3]; writeFile(w, p3, target.before[p3]); });
        st.git.log.unshift({ sha: (function (x) { while (x.length < 40) x += fnv(x).toString(16); return x.slice(0, 40); })(fnv('revert' + target.sha).toString(16)), msg: 'Revert "' + target.msg + '"', reverts: target.sha });
        st.git.ahead = (st.git.ahead || 0) + 1;
        return ok('[' + st.git.branch + ' ' + st.git.log[0].sha.slice(0, 7) + '] Revert "' + target.msg + '"');
      }
      if (sub === 'merge') {
        if (a[1] === '--abort') { if (!st.git.merging) return err('fatal: There is no merge to abort (MERGE_HEAD missing).'); Object.keys(st.git.files).forEach(function (p4) { writeFile(w, p4, st.git.files[p4]); }); st.git.merging = null; st.git.conflicts = []; return ok(''); }
        var br = a[1];
        if (!br || !(st.git.branches || {})[br]) return err('merge: ' + (br || '') + ' - not something we can merge');
        if (st.git.mergeResult && st.git.mergeResult[br]) {
          var mr = st.git.mergeResult[br];
          Object.keys(mr.files).forEach(function (p5) { writeFile(w, p5, mr.files[p5]); });
          st.git.merging = br; st.git.conflicts = mr.conflicts.slice();
          return err('Auto-merging ' + mr.conflicts.join(', ') + '\nCONFLICT (content): Merge conflict in ' + mr.conflicts.join(', ') + '\nAutomatic merge failed; fix conflicts and then commit the result.');
        }
        return ok('Already up to date.');
      }
      if (sub === 'push') { var n = st.git.ahead || 0; st.git.pushed = (st.git.pushed || 0) + n; st.git.ahead = 0; return ok(n ? 'To ' + (st.git.remote || 'origin') + '\n   ' + st.git.branch + ' -> ' + st.git.branch + ' (' + n + ' commit' + (n === 1 ? '' : 's') + ')' : 'Everything up-to-date'); }
      if (sub === 'branch') return ok('* ' + st.git.branch + '\n' + Object.keys(st.git.branches || {}).filter(function (b) { return b !== st.git.branch; }).map(function (b) { return '  ' + b; }).join('\n'));
      return unsupported('git', sub, ['status', 'diff', 'log', 'show', 'add', 'commit -m', 'checkout', 'revert', 'merge', 'push', 'branch']);
      function stage(p) { st.git.staged = st.git.staged || []; st.git.stagedContent = st.git.stagedContent || {}; if (st.git.staged.indexOf(p) === -1) st.git.staged.push(p); st.git.stagedContent[p] = readFile(w, p); if (st.git.conflicts) st.git.conflicts = st.git.conflicts.filter(function (x) { return x !== p; }); }
    };
  }

  /* ═══ Python fixture scripts ═══════════════════════════════════
     The simulator cannot run Python. A fixture script declares, in its header
     comment, which behaviours are decided by which recognisable lines, e.g.
       # sim: silent-skip = /except Exception:\s*\n\s*(pass|continue)/
       # sim: exit-code = /sys\.exit\(1 if errors else 0\)|sys\.exit\(bool\(errors\)\)/
     `python3 script.py` evaluates those probes against the current file text
     and renders output from a behaviour function the scenario supplies. The
     scenario help says so plainly; the local lab runs real Python. */
  function probes(text) {
    var out = {};
    String(text).split('\n').forEach(function (ln) {
      var m = /^#\s*sim:\s*([a-z0-9-]+)\s*=\s*\/(.+)\/([a-z]*)\s*$/.exec(ln);
      if (!m) return;
      try { out[m[1]] = new RegExp(m[2], m[3]); } catch (e) {}
    });
    return out;
  }
  /* ── evidence helpers for objective checks ──────────────────────
     A command counts only where it starts a list/pipeline segment (split on
     ; && || | outside quotes), so `echo "dig x"` or `# kubectl get` is not
     evidence; output is matched against THAT command's own output. */
  function segs(line) {
    var out = [], cur = '', q = null, L = String(line);
    for (var i = 0; i < L.length; i++) {
      var ch = L.charAt(i);
      if (q) { cur += ch; if (ch === '\\' && q === '"') { cur += L.charAt(++i); } else if (ch === q) q = null; continue; }
      if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
      if (ch === ';' || ch === '|' || (ch === '&' && L.charAt(i + 1) === '&')) { out.push(cur.trim()); cur = ''; if (L.charAt(i + 1) === ch) i++; continue; }
      cur += ch;
    }
    out.push(cur.trim());
    return out.filter(Boolean);
  }
  function cmdIs(line, re) { return segs(line).some(function (x) { var m = re.exec(x); return !!m && m.index === 0; }); }
  function ranCmd(c, re) { return c.ran.some(function (x) { return cmdIs(x, re); }); }
  function saw(c, re, outRe) { return c.ran.some(function (x, i) { return cmdIs(x, re) && outRe.test(c.out[i] || ''); }); }
  function lastIs(c, cmdRe, outRe) {
    var i = c.ran.length - 1;
    if (i < 0 || !cmdIs(c.ran[i], cmdRe)) return false;
    return !outRe || outRe.test(c.out[i] || '');
  }
  function lastCode(c) { return c.code[c.ran.length - 1] || 0; }

  /* probes are evaluated against the code only: the "# sim:" lines carry the
     patterns themselves and must never satisfy them */
  function stripSim(text) { return String(text).split('\n').filter(function (l) { return !/^#\s*sim:/.test(l); }).join('\n'); }
  function probeState(text) {
    var pr = probes(text), body = stripSim(text), out = {};
    Object.keys(pr).forEach(function (k) { out[k] = pr[k].test(body); });
    return out;
  }
  function pythonVerb(st) {
    return function (w, a, stdin) {
      var f = flags(a, ['m', 'c']);
      if (f.f.m) {
        var runner = (st.py && st.py.modules || {})[f.f.m];
        if (!runner) return unsupported('python3 -m', f.f.m, Object.keys((st.py && st.py.modules) || {}).map(function (x) { return '-m ' + x; }));
        return runner(w, f, stdin);
      }
      if (f.f.c) return err('python3 -c is not supported in this simulation (no interpreter). Fixture scripts: ' + Object.keys((st.py && st.py.scripts) || {}).join(', '));
      var script = f.pos[0];
      if (!script) return ok('Python 3.12 (simulation): only the fixture scripts listed below run here, and their behaviour is decided by the documented "# sim:" probes in each file.\n' + Object.keys((st.py && st.py.scripts) || {}).join('\n'));
      var key = script.replace(/^\.\//, ''), impl = (st.py && st.py.scripts || {})[key];
      if (!impl) return err('python3: can\'t open file \'' + script + '\': [Errno 2] No such file or directory (this simulation runs only: ' + Object.keys((st.py && st.py.scripts) || {}).join(', ') + ')', 2);
      var text = readFile(w, key);
      if (text == null) return err('python3: can\'t open file \'' + script + '\': [Errno 2] No such file or directory', 2);
      var state = probeState(text);
      if (/^\s*def \w+\([^)]*\)\s*:\s*$/m.test(text) === false && !/import/.test(text)) return err('  File "' + key + '", line 1\nSyntaxError: invalid syntax', 1);
      return impl(w, { args: f.pos.slice(1), flags: f.f, probes: state, text: text, stdin: stdin });
    };
  }

  /* ═══ Beacon service model (process level) ═════════════════════
     Used by the Linux/host scenarios: a unit whose validate hook reads the
     config and environment the way the real starter does. */
  function beaconConfigProblem(w, opts) {
    var cfgPath = opts.configPath, text = readFile(w, cfgPath);
    var node = fileOf(w, cfgPath);
    if (!node) return { ok: false, log: 'FATAL config: open ' + cfgPath + ': no such file or directory', why: 'missing-config' };
    var owner = node.owner, mode = String(node.mode || '644');
    var user = opts.user || 'beacon';
    var readable = owner === user ? mode.charAt(0) >= '4' : (node.group === user ? mode.charAt(1) >= '4' : mode.charAt(2) >= '4');
    if (!readable && user !== 'root') return { ok: false, log: 'FATAL config: open ' + cfgPath + ': permission denied (running as ' + user + ')', why: 'permission' };
    if (mode === '777' || mode === '666') return { ok: true, warn: 'config is world-writable', why: 'world-writable' };
    var problems = yamlCheck(text);
    if (problems.length) return { ok: false, log: 'FATAL config: ' + cfgPath + ':' + problems[0], why: 'yaml' };
    return { ok: true, text: text };
  }

  /* ═══ public api ══════════════════════════════════════════════ */
  var api = {
    PER_COMMAND: PER_COMMAND, fnv: fnv, rng: rng, variantOf: variantOf, clone: clone,
    ok: ok, err: err, unsupported: unsupported, flags: flags, pad: pad, table: table, stamp: stamp, hms: hms,
    wrap: wrap, bind: bind, risky: risky,
    yamlCheck: yamlCheck, yamlGet: yamlGet, yamlSet: yamlSet, kvGet: kvGet, kvSet: kvSet,
    readFile: readFile, writeFile: writeFile, fileOf: fileOf, probes: probes, probeState: probeState, stripSim: stripSim,
    segs: segs, cmdIs: cmdIs, ran: ranCmd, saw: saw, lastIs: lastIs, lastCode: lastCode,
    verbs: { edit: editVerb, dig: digVerb, dnscache: dnsCacheVerb, zonectl: zoneVerb, curl: curlVerb, openssl: opensslVerb, git: gitVerb, python3: pythonVerb },
    dns: { authoritative: dnsAuthoritative, recurse: dnsRecurse },
    net: { listenerFor: listenerFor, resolveHost: resolveHost, respond: appRespond, tlsCheck: tlsCheck },
    beaconConfigProblem: beaconConfigProblem
  };
  root.LXSim = Object.assign(root.LXSim || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = root.LXSim;
})(typeof window !== 'undefined' ? window : globalThis);
