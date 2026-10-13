/* SRE & Cloud Deployment Foundations — simulated incidents S21–S24 (M11–M12).

   Same contract as sre-scenarios-1.js; played by tests/data/test-sre-scenarios.js.

   S21/S22 run on a small telemetry model defined in this file: a YAML subset
   parser, a bounded PromQL evaluator (selectors, rate/increase, sum/avg/min/
   max/count by|without, histogram_quantile, absent, vector, arithmetic,
   comparisons, and/or/unless with on/ignoring), Prometheus rule files with
   recording rules and `for:`, Alertmanager routing and silences, and a
   `promtool test rules` stand-in with the real input-series notation. Every
   series is derived from the world state (S21: traffic per backend over the
   logical clock; S22: per-minute fixtures), so a fix changes what the next
   query, dashboard render or replay prints.

   S23/S24 run on a small PostgreSQL model (second IIFE below): a bounded SQL
   subset over materialised tables and catalog views (pg_stat_activity,
   pg_locks, pg_settings, pg_indexes, pg_stat_user_tables), lock conflicts and
   pg_blocking_pids, EXPLAIN derived from the indexes that exist, and (S24) a
   queue + worker model with at-least-once delivery.

   Learner-visible text (title, briefs, objective text) never names the root
   cause; mechanism, alternatives and the worked fix live in the debrief. */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.missions = LX.missions || [];

/* ═════════════════════════ S21 · S22 — telemetry ═════════════════════════ */
(function () {
  function SIM() { return window.LXSim; }
  function st(c) { return c.w.sre; }
  function ran(c, re) { return SIM().ran(c, re); }
  function saw(c, re, outRe) { return SIM().saw(c, re, outRe); }
  function lastIs(c, cmdRe, outRe) { return SIM().lastIs(c, cmdRe, outRe); }
  function res(out, code, errText) {
    var r = { out: out == null ? '' : String(out), code: code || 0 };
    if (r.out && !/\n$/.test(r.out)) r.out += '\n';
    if (errText) r.err = String(errText).replace(/\n?$/, '\n');
    return r;
  }
  function fail(msg, code) { return { out: '', err: String(msg).replace(/\n?$/, '\n'), code: code == null ? 1 : code }; }

  /* ── time: seconds since 2026-10-13T00:00:00Z ─────────────────── */
  var DAY0 = 1791849600;
  function two(n) { return (n < 10 ? '0' : '') + n; }
  function iso(t) { t = Math.max(0, Math.floor(t)); var d = Math.floor(t / 86400), s = t - d * 86400; return '2026-10-' + two(13 + d) + 'T' + two(Math.floor(s / 3600)) + ':' + two(Math.floor(s % 3600 / 60)) + ':' + two(s % 60) + 'Z'; }
  function hm(t) { return iso(t).slice(11, 19); }
  function parseTime(s) {
    s = String(s || '').trim(); var m;
    if ((m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?Z?$/.exec(s))) return +m[1] * 3600 + +m[2] * 60 + +(m[3] || 0);
    if ((m = /^2026-10-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?Z$/.exec(s))) return (+m[1] - 13) * 86400 + +m[2] * 3600 + +m[3] * 60 + +(m[4] || 0);
    if (/^\d{10}(\.\d+)?$/.test(s)) return Math.floor(Number(s)) - DAY0;
    return null;
  }
  function durSec(n, u) { return Number(n) * ({ ms: 0.001, s: 1, m: 60, h: 3600, d: 86400, w: 604800 })[u]; }
  function parseDur(s) {
    s = String(s == null ? '' : s).trim();
    if (s === '0') return 0;
    var re = /(\d+(?:\.\d+)?)(ms|s|m|h|d|w)/g, m, tot = 0, used = '';
    while ((m = re.exec(s))) { tot += durSec(m[1], m[2]); used += m[0]; }
    return used && used === s ? tot : NaN;
  }
  function fmtDur(sec) {
    sec = Math.round(sec); if (!sec) return '0s';
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return (h ? h + 'h' : '') + (m ? m + 'm' : '') + (s ? s + 's' : '');
  }
  function fmtNum(v) {
    if (v !== v) return 'NaN';
    if (v === Infinity) return '+Inf';
    if (v === -Infinity) return '-Inf';
    return String(parseFloat(Number(v).toPrecision(6)));
  }

  /* ═══ YAML subset ═══════════════════════════════════════════════
     Block maps and sequences by indentation, `- key: v` items, block
     scalars (| and >), flow lists [a, b], {} and simple {k: v}, quoted
     strings, comments. Enough for rule files, promtool tests, Alertmanager
     config and dashboard files; anything else is a parse error with a line. */
  function yStrip(line) {
    var q = null, out = '';
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      if (q) { out += ch; if (ch === q) q = null; continue; }
      if (ch === '"' || ch === "'") { if (i === 0 || /[\s:\[{,-]/.test(line.charAt(i - 1))) q = ch; out += ch; continue; }
      if (ch === '#' && (i === 0 || /\s/.test(line.charAt(i - 1)))) break;
      out += ch;
    }
    return out.replace(/\s+$/, '');
  }
  function ySplitFlow(s) {
    var out = [], cur = '', q = null, depth = 0;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (q) { cur += ch; if (ch === q) q = null; continue; }
      if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
      if (ch === '{' || ch === '[') depth++;
      if (ch === '}' || ch === ']') depth--;
      if (ch === ',' && !depth) { out.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  function yScalar(v) {
    v = String(v).trim();
    if (/^\[.*\]$/.test(v)) return ySplitFlow(v.slice(1, -1)).map(yScalar);
    if (/^\{\s*\}$/.test(v)) return {};
    if (/^\{.*\}$/.test(v)) {
      var o = {};
      ySplitFlow(v.slice(1, -1)).forEach(function (pair) { var i = pair.indexOf(':'); if (i > 0) o[yScalar(pair.slice(0, i))] = yScalar(pair.slice(i + 1)); });
      return o;
    }
    if (/^"(?:[^"\\]|\\.)*"$/.test(v)) { try { return JSON.parse(v); } catch (e) { return v.slice(1, -1); } }
    if (/^'(?:[^']|'')*'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
    if (/^(true|false)$/.test(v)) return v === 'true';
    if (/^(null|~)$/.test(v)) return null;
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    return v;
  }
  var Y_KEY = /^("(?:[^"\\]|\\.)*"|'[^']*'|[^\s"'#:\-\[{][^:]*?|-[^\s:][^:]*?)\s*:(?:\s+(.*))?$/;
  function yIsItem(s) { return /^-( |$)/.test(s); }
  function yParse(text) {
    var raw = String(text == null ? '' : text).split('\n'), L = [];
    for (var i = 0; i < raw.length; i++) {
      var ln = raw[i];
      if (/^ *\t/.test(ln)) return { error: 'line ' + (i + 1) + ': found a tab character where an indentation space is expected' };
      if (/^(<{7}|={7}|>{7})/.test(ln)) return { error: 'line ' + (i + 1) + ': unresolved merge conflict marker' };
      var s = yStrip(ln);
      if (!s.trim()) continue;
      L.push({ n: i + 1, ind: s.match(/^ */)[0].length, s: s.trim() });
    }
    var p = 0;
    function E(line, msg) { var e = new Error(msg); e.yline = line ? line.n : raw.length; throw e; }
    function node(ind) { return yIsItem(L[p].s) ? seq(L[p].ind) : map(L[p].ind); }
    function seq(ind) {
      var out = [];
      while (p < L.length && L[p].ind === ind && yIsItem(L[p].s)) {
        var line = L[p], rest = line.s.replace(/^-\s*/, '');
        if (!rest) { p++; out.push(p < L.length && L[p].ind > ind ? node(L[p].ind) : null); continue; }
        if (Y_KEY.test(rest)) { L[p] = { n: line.n, ind: ind + (line.s.length - rest.length), s: rest }; out.push(map(L[p].ind)); }
        else { p++; out.push(yScalar(rest)); }
      }
      if (p < L.length && L[p].ind > ind) E(L[p], 'did not find expected \'-\' indicator (bad indentation)');
      return out;
    }
    function map(ind) {
      var out = {};
      while (p < L.length && L[p].ind === ind && !yIsItem(L[p].s)) {
        var line = L[p], m = Y_KEY.exec(line.s);
        if (!m) E(line, 'could not find expected \':\' (expected "key: value")');
        var key = String(yScalar(m[1])), val = m[2];
        if (Object.prototype.hasOwnProperty.call(out, key)) E(line, 'mapping key "' + key + '" already defined');
        p++;
        if (val == null || val === '') {
          if (p < L.length && L[p].ind > ind) out[key] = node(L[p].ind);
          else if (p < L.length && L[p].ind === ind && yIsItem(L[p].s)) out[key] = seq(ind);
          else out[key] = null;
        } else if (/^[|>][-+]?$/.test(val)) {
          var parts = [];
          while (p < L.length && L[p].ind > ind) { parts.push(L[p].s); p++; }
          out[key] = val.charAt(0) === '|' ? parts.join('\n') : parts.join(' ');
        } else out[key] = yScalar(val);
      }
      if (p < L.length && L[p].ind > ind) E(L[p], 'mapping values are not allowed in this context (bad indentation)');
      return out;
    }
    try {
      var v = L.length ? node(L[0].ind) : null;
      if (p < L.length) E(L[p], 'did not find expected key (bad indentation)');
      return { value: v };
    } catch (e) { return { error: 'line ' + (e.yline || '?') + ': ' + e.message }; }
  }

  /* ═══ PromQL subset ═════════════════════════════════════════════ */
  var AGG = ['sum', 'avg', 'min', 'max', 'count'];
  var FN = { rate: 1, increase: 1, absent: 1, histogram_quantile: 2, vector: 1, abs: 1, clamp_min: 2, clamp_max: 2, time: 0 };
  var PQ_OPS = ['==', '!=', '=~', '!~', '>=', '<=', '>', '<', '=', '+', '-', '*', '/', '%', '^', '(', ')', '{', '}', ','];
  function pqLex(src) {
    var s = String(src), i = 0, toks = [], m;
    while (i < s.length) {
      var rest = s.slice(i), ch = rest.charAt(0);
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === '[') {
        m = /^\[\s*((?:\d+(?:ms|s|m|h|d|w))+)\s*\]/.exec(rest);
        if (!m) throw new Error('parse error: bad range "' + rest.slice(0, 12) + '": use a duration such as [5m] (subqueries are not supported here)');
        toks.push({ t: 'range', v: parseDur(m[1]), raw: m[1] }); i += m[0].length; continue;
      }
      if ((m = /^(?:\d+\.?\d*(?:e[-+]?\d+)?|\.\d+)/i.exec(rest))) { toks.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue; }
      if ((m = /^[A-Za-z_:][A-Za-z0-9_:]*/.exec(rest))) { toks.push({ t: 'id', v: m[0] }); i += m[0].length; continue; }
      if (ch === '"' || ch === "'" || ch === '`') {
        var j = 1, out = '';
        while (j < rest.length && rest.charAt(j) !== ch) {
          if (rest.charAt(j) === '\\' && ch !== '`') { j++; var e = rest.charAt(j); out += e === 'n' ? '\n' : e === 't' ? '\t' : (e === '.' || e === '-' || e === '/' || e === 'd' || e === 'w' || e === 's' ? '\\' + e : e); }
          else out += rest.charAt(j);
          j++;
        }
        if (j >= rest.length) throw new Error('parse error: unterminated quoted string ' + rest.slice(0, 12));
        toks.push({ t: 'str', v: out }); i += j + 1; continue;
      }
      var op = null;
      for (var k = 0; k < PQ_OPS.length; k++) if (rest.indexOf(PQ_OPS[k]) === 0) { op = PQ_OPS[k]; break; }
      if (!op) throw new Error('parse error: unexpected character "' + ch + '"');
      toks.push({ t: 'op', v: op }); i += op.length;
    }
    return toks;
  }
  function pqParse(src) {
    var toks = pqLex(src), p = 0;
    if (!toks.length) throw new Error('parse error: no expression found in input');
    function peek(o) { return toks[p + (o || 0)]; }
    function isOp(v, o) { var t = peek(o); return !!t && t.t === 'op' && t.v === v; }
    function isKw(v) { var t = peek(); return !!t && t.t === 'id' && t.v.toLowerCase() === v; }
    function what(t) { return !t ? 'end of input' : t.t === 'str' ? 'string "' + t.v + '"' : t.t === 'range' ? '[' + t.raw + ']' : '"' + t.v + '"'; }
    function expect(v) { if (!isOp(v)) throw new Error('parse error: unexpected ' + what(peek()) + ', expected "' + v + '"'); p++; }
    function labelList() {
      expect('(');
      var out = [];
      while (!isOp(')')) {
        var t = peek();
        if (!t || t.t !== 'id') throw new Error('parse error: unexpected ' + what(t) + ' in grouping, expected label');
        out.push(t.v); p++;
        if (isOp(',')) p++; else break;
      }
      expect(')');
      return out;
    }
    var LV = [['or'], ['and', 'unless'], ['==', '!=', '>', '<', '>=', '<='], ['+', '-'], ['*', '/', '%'], ['^']];
    function bin(lv) {
      if (lv === LV.length) return unary();
      var left = bin(lv + 1);
      for (;;) {
        var t = peek(), op = null;
        if (!t) break;
        if (lv < 2 && t.t === 'id' && LV[lv].indexOf(t.v.toLowerCase()) !== -1) op = t.v.toLowerCase();
        if (lv >= 2 && t.t === 'op' && LV[lv].indexOf(t.v) !== -1) op = t.v;
        if (!op) break;
        p++;
        var mod = {};
        if (isKw('bool')) { if (lv !== 2) throw new Error('parse error: bool modifier can only be used on comparison operators'); mod.bool = true; p++; }
        if (isKw('on')) { p++; mod.on = labelList(); } else if (isKw('ignoring')) { p++; mod.ignoring = labelList(); }
        if (isKw('group_left') || isKw('group_right')) throw new Error('group_left/group_right (many-to-one matching) is not supported in this simulation');
        var right = lv === LV.length - 1 ? bin(lv) : bin(lv + 1);
        left = { k: 'bin', op: op, l: left, r: right, mod: mod };
      }
      return left;
    }
    function unary() {
      if (isOp('-')) { p++; return { k: 'neg', e: unary() }; }
      if (isOp('+')) { p++; return unary(); }
      var n = primary();
      if (peek() && peek().t === 'range') {
        if (n.k !== 'sel') throw new Error('parse error: ranges only allowed for vector selectors');
        n.range = peek().v; n.rangeRaw = peek().raw; p++;
      }
      if (isKw('offset') || isKw('@')) throw new Error('offset modifiers are not supported in this simulation');
      return n;
    }
    function selector(name) {
      var n = { k: 'sel', name: name, m: [] };
      if (name) p++;
      if (isOp('{')) {
        p++;
        while (!isOp('}')) {
          var l = peek();
          if (!l || l.t !== 'id') throw new Error('parse error: unexpected ' + what(l) + ' in label matching, expected label');
          p++;
          var o = peek();
          if (!o || o.t !== 'op' || ['=', '!=', '=~', '!~'].indexOf(o.v) === -1) throw new Error('parse error: unexpected ' + what(o) + ' in label matching, expected one of "=", "!=", "=~" or "!~"');
          p++;
          var v = peek();
          if (!v || v.t !== 'str') throw new Error('parse error: unexpected ' + what(v) + ' in label matching, expected string');
          p++;
          var mt = { l: l.v, op: o.v, v: v.v };
          if (o.v === '=~' || o.v === '!~') { try { mt.re = new RegExp('^(?:' + v.v + ')$'); } catch (e) { throw new Error('parse error: invalid regular expression "' + v.v + '"'); } }
          n.m.push(mt);
          if (isOp(',')) p++; else break;
        }
        expect('}');
      }
      if (!name) {
        var nm = n.m.filter(function (x) { return x.l === '__name__' && x.op === '='; })[0];
        if (nm) n.name = nm.v;
        if (!n.m.some(function (x) { return !(x.op === '=' && x.v === '') && !(x.re && x.re.test('')); })) throw new Error('parse error: vector selector must contain at least one non-empty matcher');
      }
      return n;
    }
    function primary() {
      var t = peek();
      if (!t) throw new Error('parse error: unexpected end of input');
      if (t.t === 'num') { p++; return { k: 'num', v: t.v }; }
      if (t.t === 'str') { p++; return { k: 'str', v: t.v }; }
      if (isOp('(')) { p++; var e = bin(0); expect(')'); return { k: 'paren', e: e }; }
      if (isOp('{')) return selector(null);
      if (t.t === 'id') {
        var name = t.v, low = name.toLowerCase();
        if (low === 'nan' || low === 'inf') { p++; return { k: 'num', v: low === 'nan' ? NaN : Infinity }; }
        if (AGG.indexOf(low) !== -1 && (isOp('(', 1) || (peek(1) && peek(1).t === 'id' && /^(by|without)$/i.test(peek(1).v)))) {
          p++;
          var g = { k: 'agg', op: low };
          if (isKw('by') || isKw('without')) { var kw = peek().v.toLowerCase(); p++; g[kw] = labelList(); }
          expect('('); g.e = bin(0); expect(')');
          if (isKw('by') || isKw('without')) { var kw2 = peek().v.toLowerCase(); p++; g[kw2] = labelList(); }
          return g;
        }
        if (isOp('(', 1)) {
          if (!Object.prototype.hasOwnProperty.call(FN, low)) throw new Error('function "' + name + '" is not supported in this simulation (supported: ' + Object.keys(FN).join(', ') + ', and the aggregations ' + AGG.join(', ') + ')');
          p += 2;
          var args = [];
          while (!isOp(')')) { args.push(bin(0)); if (isOp(',')) p++; else break; }
          expect(')');
          if (args.length !== FN[low]) throw new Error('parse error: expected ' + FN[low] + ' argument(s) in call to "' + low + '", got ' + args.length);
          return { k: 'fn', f: low, args: args };
        }
        if (/^(by|without|on|ignoring|bool|and|or|unless|offset)$/i.test(name)) throw new Error('parse error: unexpected keyword "' + name + '"');
        return selector(name);
      }
      throw new Error('parse error: unexpected ' + what(t));
    }
    var ast = bin(0);
    if (p < toks.length) throw new Error('parse error: unexpected ' + what(peek()));
    return ast;
  }
  function dropName(m) { var o = {}; Object.keys(m).forEach(function (k) { if (k !== '__name__') o[k] = m[k]; }); return o; }
  function lkey(m) { return Object.keys(m).filter(function (k) { return k !== '__name__'; }).sort().map(function (k) { return k + '=' + m[k]; }).join(','); }
  function fmtLabels(m) {
    var keys = Object.keys(m).filter(function (k) { return k !== '__name__'; }).sort();
    if (m.__name__ && !keys.length) return m.__name__;
    return (m.__name__ || '') + '{' + keys.map(function (k) { return k + '="' + m[k] + '"'; }).join(', ') + '}';
  }
  function mmatch(m, mt) {
    var val = m[mt.l] == null ? '' : String(m[mt.l]);
    if (mt.op === '=') return val === mt.v;
    if (mt.op === '!=') return val !== mt.v;
    if (mt.op === '=~') return mt.re.test(val);
    return !mt.re.test(val);
  }
  function sampleRate(s, t, w) {
    var v1 = s.at(t);
    if (v1 == null) return null;
    var step = s.step || 60, t0 = Math.max(t - w, s.start || 0), v0 = s.at(t0), guard = 0;
    while (v0 == null && t0 < t && guard++ < 2000) { t0 += step; v0 = s.at(t0); }
    if (v0 == null || t0 >= t) return null;
    var d = v1 - v0;
    if (d < 0) d = v1;
    return d / (t - t0);
  }
  function selEval(n, t, ctx) {
    var ms = n.m.slice();
    if (n.name) ms.push({ l: '__name__', op: '=', v: n.name });
    if (ctx.sels) ctx.sels.push(n);
    if (n.name && ctx.rec && ctx.rec[n.name]) {
      if (n.range) throw new Error('a range over the recording rule "' + n.name + '" needs stored history; this simulation evaluates recording rules on demand, so use them as instant vectors');
      ctx.depth = (ctx.depth || 0) + 1;
      if (ctx.depth > 8) throw new Error('recording rules refer to each other too deeply');
      var r = pqEval(ctx.rec[n.name], t, ctx);
      ctx.depth--;
      if (r.k === 's') r = { k: 'v', v: [{ m: {}, v: r.v }] };
      return { k: 'v', v: r.v.map(function (e) { var m = dropName(e.m); m.__name__ = n.name; return { m: m, v: e.v }; }).filter(function (e) { return ms.every(function (mt) { return mmatch(e.m, mt); }); }) };
    }
    var list = ctx.series.filter(function (s) { return ms.every(function (mt) { return mmatch(s.m, mt); }); });
    if (ctx.touched) list.forEach(function (s) { ctx.touched.push({ m: s.m, sel: n }); });
    if (n.range) return { k: 'm', v: list, range: n.range };
    var out = [];
    list.forEach(function (s) { var v = s.at(t); if (v != null) out.push({ m: s.m, v: v }); });
    return { k: 'v', v: out };
  }
  function fnEval(n, t, ctx) {
    var f = n.f;
    if (f === 'time') return { k: 's', v: DAY0 + t };
    if (f === 'vector') { var s = pqEval(n.args[0], t, ctx); if (s.k !== 's') throw new Error('expected type scalar in call to function "vector"'); return { k: 'v', v: [{ m: {}, v: s.v }] }; }
    if (f === 'rate' || f === 'increase') {
      var mx = pqEval(n.args[0], t, ctx);
      if (mx.k !== 'm') throw new Error('expected type range vector in call to function "' + f + '", got instant vector');
      var out = [];
      mx.v.forEach(function (s) { var r = sampleRate(s, t, mx.range); if (r != null) out.push({ m: dropName(s.m), v: f === 'rate' ? r : r * mx.range }); });
      return { k: 'v', v: out };
    }
    if (f === 'absent') {
      var a = pqEval(n.args[0], t, ctx);
      if (a.k !== 'v') throw new Error('expected type instant vector in call to function "absent" (absent_over_time is not modelled)');
      if (a.v.length) return { k: 'v', v: [] };
      var lab = {};
      if (n.args[0].k === 'sel') n.args[0].m.forEach(function (mt) { if (mt.op === '=' && mt.l !== '__name__') lab[mt.l] = mt.v; });
      return { k: 'v', v: [{ m: lab, v: 1 }] };
    }
    if (f === 'abs' || f === 'clamp_min' || f === 'clamp_max') {
      var x = pqEval(n.args[0], t, ctx), lim = n.args[1] ? pqEval(n.args[1], t, ctx) : null;
      if (x.k !== 'v') throw new Error('expected type instant vector in call to function "' + f + '"');
      return { k: 'v', v: x.v.map(function (e) { var v = f === 'abs' ? Math.abs(e.v) : f === 'clamp_min' ? Math.max(e.v, lim.v) : Math.min(e.v, lim.v); return { m: dropName(e.m), v: v }; }) };
    }
    if (f === 'histogram_quantile') {
      var q = pqEval(n.args[0], t, ctx), hv = pqEval(n.args[1], t, ctx);
      if (q.k !== 's' || hv.k !== 'v') throw new Error('histogram_quantile(scalar, instant vector of _bucket rates)');
      var groups = {};
      hv.v.forEach(function (e) {
        if (e.m.le == null) return;
        var lm = dropName(e.m); delete lm.le;
        var k = lkey(lm);
        (groups[k] = groups[k] || { m: lm, b: [] }).b.push({ le: e.m.le === '+Inf' ? Infinity : Number(e.m.le), c: e.v });
      });
      return { k: 'v', v: Object.keys(groups).map(function (k) {
        var g = groups[k], b = g.b.sort(function (x, y) { return x.le - y.le; });
        var total = b.length ? b[b.length - 1].c : 0, val = NaN;
        if (b.length && b[b.length - 1].le === Infinity && total > 0) {
          var rank = q.v * total;
          for (var i = 0; i < b.length; i++) {
            if (b[i].c >= rank) {
              if (b[i].le === Infinity) { val = i ? b[i - 1].le : NaN; break; }
              var lo = i ? b[i - 1].le : 0, cl = i ? b[i - 1].c : 0;
              val = lo + (b[i].le - lo) * ((rank - cl) / Math.max(1e-12, b[i].c - cl));
              break;
            }
          }
        }
        return { m: g.m, v: val };
      }) };
    }
    throw new Error('function "' + f + '" is not supported in this simulation');
  }
  function aggEval(n, t, ctx) {
    var x = pqEval(n.e, t, ctx);
    if (x.k !== 'v') throw new Error('expected type instant vector in aggregation expression, got ' + (x.k === 's' ? 'scalar' : 'range vector'));
    var groups = {}, order = [];
    x.v.forEach(function (e) {
      var m = {};
      if (n.by) n.by.forEach(function (l) { if (e.m[l] != null) m[l] = e.m[l]; });
      else if (n.without) { m = dropName(e.m); n.without.forEach(function (l) { delete m[l]; }); }
      var k = lkey(m);
      if (!groups[k]) { groups[k] = { m: m, vals: [] }; order.push(k); }
      groups[k].vals.push(e.v);
    });
    return { k: 'v', v: order.map(function (k) {
      var g = groups[k], vs = g.vals, v;
      if (n.op === 'sum') v = vs.reduce(function (a, b) { return a + b; }, 0);
      else if (n.op === 'avg') v = vs.reduce(function (a, b) { return a + b; }, 0) / vs.length;
      else if (n.op === 'min') v = Math.min.apply(null, vs);
      else if (n.op === 'max') v = Math.max.apply(null, vs);
      else v = vs.length;
      return { m: g.m, v: v };
    }) };
  }
  function arith(op, a, b) {
    switch (op) {
      case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return a / b;
      case '%': return a % b; case '^': return Math.pow(a, b);
      case '==': return a === b; case '!=': return a !== b; case '>': return a > b; case '<': return a < b; case '>=': return a >= b; case '<=': return a <= b;
    }
    return NaN;
  }
  function binEval(n, t, ctx) {
    var op = n.op, mod = n.mod || {};
    var isCmp = ['==', '!=', '>', '<', '>=', '<='].indexOf(op) !== -1, isSet = ['and', 'or', 'unless'].indexOf(op) !== -1;
    var L = pqEval(n.l, t, ctx), R = pqEval(n.r, t, ctx);
    if (L.k === 'm' || R.k === 'm') throw new Error('binary expression must contain only scalar and instant vector types (a range vector needs rate() or increase())');
    function sig(m) {
      if (mod.on) return mod.on.map(function (l) { return l + '=' + (m[l] == null ? '' : m[l]); }).join(',');
      var o = dropName(m);
      if (mod.ignoring) mod.ignoring.forEach(function (l) { delete o[l]; });
      return lkey(o);
    }
    if (isSet) {
      if (L.k !== 'v' || R.k !== 'v') throw new Error('set operator "' + op + '" not allowed in binary scalar expression');
      var rs = {}; R.v.forEach(function (e) { rs[sig(e.m)] = 1; });
      if (op === 'and') return { k: 'v', v: L.v.filter(function (e) { return rs[sig(e.m)]; }) };
      if (op === 'unless') return { k: 'v', v: L.v.filter(function (e) { return !rs[sig(e.m)]; }) };
      var ls = {}; L.v.forEach(function (e) { ls[sig(e.m)] = 1; });
      return { k: 'v', v: L.v.concat(R.v.filter(function (e) { return !ls[sig(e.m)]; })) };
    }
    if (L.k === 's' && R.k === 's') {
      if (isCmp && !mod.bool) throw new Error('parse error: comparisons between scalars must use BOOL modifier');
      var sv = arith(op, L.v, R.v);
      return { k: 's', v: typeof sv === 'boolean' ? (sv ? 1 : 0) : sv };
    }
    function resultMetric(m) {
      var o = (!isCmp || mod.bool) ? dropName(m) : Object.assign({}, m);
      if (mod.on) { var keep = {}; mod.on.forEach(function (l) { if (o[l] != null) keep[l] = o[l]; }); if (o.__name__ && isCmp && !mod.bool) keep.__name__ = o.__name__; o = keep; }
      else if (mod.ignoring) mod.ignoring.forEach(function (l) { delete o[l]; });
      return o;
    }
    if (L.k === 's' || R.k === 's') {
      var vec = L.k === 'v' ? L : R, sc = L.k === 's' ? L.v : R.v, out = [];
      vec.v.forEach(function (e) {
        var r = L.k === 'v' ? arith(op, e.v, sc) : arith(op, sc, e.v);
        if (isCmp) {
          if (mod.bool) out.push({ m: dropName(e.m), v: r ? 1 : 0 });
          else if (r) out.push({ m: e.m, v: e.v });
        } else out.push({ m: dropName(e.m), v: r });
      });
      return { k: 'v', v: out };
    }
    var right = {}, lseen = {};
    R.v.forEach(function (e) { var s = sig(e.m); if (right[s]) throw new Error('found duplicate series for the match group {' + s + '} on the right hand-side of the operation: many-to-many matching not allowed: matching labels must be unique on one side'); right[s] = e; });
    var res2 = [];
    L.v.forEach(function (e) {
      var s = sig(e.m), r = right[s];
      if (!r) return;
      if (lseen[s]) throw new Error('found duplicate series for the match group {' + s + '} on the left hand-side of the operation: many-to-many matching not allowed: matching labels must be unique on one side');
      lseen[s] = 1;
      var v = arith(op, e.v, r.v);
      if (isCmp) { if (mod.bool) res2.push({ m: resultMetric(e.m), v: v ? 1 : 0 }); else if (v) res2.push({ m: resultMetric(e.m), v: e.v }); }
      else res2.push({ m: resultMetric(e.m), v: v });
    });
    return { k: 'v', v: res2 };
  }
  function pqEval(n, t, ctx) {
    switch (n.k) {
      case 'num': return { k: 's', v: n.v };
      case 'str': throw new Error('string literals are only supported inside label matchers here');
      case 'paren': return pqEval(n.e, t, ctx);
      case 'neg': { var x = pqEval(n.e, t, ctx); if (x.k === 's') return { k: 's', v: -x.v }; if (x.k !== 'v') throw new Error('unary minus needs a scalar or instant vector'); return { k: 'v', v: x.v.map(function (e) { return { m: dropName(e.m), v: -e.v }; }) }; }
      case 'sel': return selEval(n, t, ctx);
      case 'fn': return fnEval(n, t, ctx);
      case 'agg': return aggEval(n, t, ctx);
      case 'bin': return binEval(n, t, ctx);
    }
    throw new Error('cannot evaluate node ' + n.k);
  }
  /* every selector name an expression reads, recording rules resolved */
  function namesOf(ast, rec, out, depth) {
    out = out || {}; depth = depth || 0;
    if (!ast || depth > 8) return out;
    if (ast.k === 'sel') { if (ast.name && rec && rec[ast.name]) namesOf(rec[ast.name], rec, out, depth + 1); else if (ast.name) out[ast.name] = 1; }
    ['e', 'l', 'r'].forEach(function (k) { if (ast[k]) namesOf(ast[k], rec, out, depth); });
    (ast.args || []).forEach(function (a) { namesOf(a, rec, out, depth); });
    return out;
  }
  function selsOf(ast, out) {
    out = out || [];
    if (!ast) return out;
    if (ast.k === 'sel') out.push(ast);
    ['e', 'l', 'r'].forEach(function (k) { if (ast[k]) selsOf(ast[k], out); });
    (ast.args || []).forEach(function (a) { selsOf(a, out); });
    return out;
  }

  /* ═══ rule files (rulefmt subset) ══════════════════════════════ */
  var RULE_KEYS = ['alert', 'record', 'expr', 'for', 'keep_firing_for', 'labels', 'annotations'];
  function strMap(x) { var o = {}; if (x && typeof x === 'object' && !Array.isArray(x)) Object.keys(x).forEach(function (k) { o[k] = x[k] == null ? '' : String(x[k]); }); return o; }
  function loadRuleText(text, path) {
    var y = yParse(text), errs = [], groups = [];
    if (y.error) return { errors: [path + ': yaml: ' + y.error], groups: [] };
    var doc = y.value;
    if (doc == null) return { errors: [], groups: [] };
    if (typeof doc !== 'object' || Array.isArray(doc)) return { errors: [path + ': yaml: expected a map with a "groups" list'], groups: [] };
    Object.keys(doc).forEach(function (k) { if (k !== 'groups') errs.push(path + ': field ' + k + ' not found in type rulefmt.RuleGroups'); });
    var gl = doc.groups == null ? [] : doc.groups;
    if (!Array.isArray(gl)) { errs.push(path + ': groups: expected a list'); gl = []; }
    var seenG = {};
    gl.forEach(function (g, gi) {
      if (!g || typeof g !== 'object' || Array.isArray(g)) { errs.push(path + ': group ' + (gi + 1) + ': expected a map'); return; }
      Object.keys(g).forEach(function (k) { if (['name', 'interval', 'rules', 'limit'].indexOf(k) === -1) errs.push(path + ': field ' + k + ' not found in type rulefmt.RuleGroup'); });
      if (!g.name) errs.push(path + ': ' + (gi + 1) + ': groupname must not be empty');
      if (g.name && seenG[g.name]) errs.push(path + ': ' + g.name + ': groupname: "' + g.name + '" is repeated in the same file');
      seenG[g.name] = 1;
      var grp = { name: String(g.name || ''), rules: [] };
      var rl = g.rules == null ? [] : g.rules;
      if (!Array.isArray(rl)) { errs.push(path + ': group "' + g.name + '": rules: expected a list'); rl = []; }
      rl.forEach(function (r, ri) {
        var where = path + ': group "' + g.name + '", rule ' + (ri + 1);
        if (!r || typeof r !== 'object' || Array.isArray(r)) { errs.push(where + ': expected a map'); return; }
        Object.keys(r).forEach(function (k) { if (RULE_KEYS.indexOf(k) === -1) errs.push(where + ': field ' + k + ' not found in type rulefmt.RuleNode'); });
        if (r.alert && r.record) errs.push(where + ': only one of \'record\' and \'alert\' must be set');
        if (!r.alert && !r.record) { errs.push(where + ': one of \'record\' or \'alert\' must be set'); return; }
        var name = String(r.alert || r.record);
        where += ', "' + name + '"';
        var ast = null;
        if (r.expr == null || String(r.expr).trim() === '') errs.push(where + ': field \'expr\' must be set in rule');
        else { try { ast = pqParse(String(r.expr)); } catch (e) { errs.push(where + ': could not parse expression: ' + e.message); } }
        var forSec = 0;
        if (r['for'] != null) {
          forSec = parseDur(r['for']);
          if (r.record) errs.push(where + ': invalid field \'for\' in recording rule');
          if (forSec !== forSec) { errs.push(where + ': not a valid duration string: "' + r['for'] + '"'); forSec = 0; }
        }
        if (r.record && !/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(name)) errs.push(where + ': invalid recording rule name: ' + name);
        if (r.alert && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) errs.push(where + ': invalid alert name: ' + name);
        if (r.labels != null && (typeof r.labels !== 'object' || Array.isArray(r.labels))) errs.push(where + ': labels: expected a map');
        grp.rules.push({ kind: r.alert ? 'alert' : 'record', name: name, expr: String(r.expr == null ? '' : r.expr), ast: ast, forSec: forSec, labels: strMap(r.labels), annotations: strMap(r.annotations), file: path });
      });
      groups.push(grp);
    });
    return { errors: errs, groups: groups };
  }
  function mergeRules(files) {
    var out = { errors: [], groups: [], rec: {}, alerts: [], records: [], text: '' };
    files.forEach(function (f) {
      var r = loadRuleText(f.text, f.path);
      out.errors = out.errors.concat(r.errors);
      out.text += '\u0000' + f.path + '\u0000' + f.text;
      r.groups.forEach(function (g) {
        out.groups.push(g);
        g.rules.forEach(function (x) {
          if (x.kind === 'record') { out.records.push(x); if (x.ast) out.rec[x.name] = x.ast; }
          else if (x.ast) out.alerts.push(x);
        });
      });
    });
    return out;
  }

  /* ═══ Alertmanager config, routing, silences ═══════════════════ */
  function parseMatcher(s) {
    var m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(=~|!~|!=|=)\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S*))\s*$/.exec(String(s));
    if (!m) return null;
    var v = m[3] != null ? m[3] : m[4] != null ? m[4] : m[5], mt = { l: m[1], op: m[2], v: v };
    if (m[2] === '=~' || m[2] === '!~') { try { mt.re = new RegExp('^(?:' + v + ')$'); } catch (e) { return null; } }
    return mt;
  }
  function loadAm(text) {
    var y = yParse(text), errs = [];
    if (y.error) return { errors: ['yaml: ' + y.error] };
    var doc = y.value || {};
    if (!doc.route || typeof doc.route !== 'object') return { errors: ['no route provided in config'] };
    var recv = {};
    (Array.isArray(doc.receivers) ? doc.receivers : []).forEach(function (r) { if (r && r.name) recv[r.name] = r; });
    function walk(r, top) {
      if (!r || typeof r !== 'object') return { receiver: null, routes: [], matchers: [] };
      if (top && !r.receiver) errs.push('root route must specify a default receiver');
      if (r.receiver && !recv[r.receiver]) errs.push('undefined receiver "' + r.receiver + '" used in route');
      var ms = [];
      (Array.isArray(r.matchers) ? r.matchers : r.matchers ? [r.matchers] : []).forEach(function (s) { var mt = parseMatcher(s); if (!mt) errs.push('bad matcher format: ' + s); else ms.push(mt); });
      if (r.match && typeof r.match === 'object') Object.keys(r.match).forEach(function (k) { ms.push({ l: k, op: '=', v: String(r.match[k]) }); });
      return { receiver: r.receiver || null, matchers: ms, routes: (Array.isArray(r.routes) ? r.routes : []).map(function (x) { return walk(x, false); }) };
    }
    var route = walk(doc.route, true);
    return { errors: errs, route: route, receivers: recv };
  }
  function routeAlert(am, labels) {
    function go(r, inherited) {
      var rc = r.receiver || inherited;
      for (var i = 0; i < r.routes.length; i++) {
        var k = r.routes[i];
        if (k.matchers.every(function (mt) { return mmatch(labels, mt); })) return go(k, rc);
      }
      return rc;
    }
    return am && am.route ? go(am.route, null) : null;
  }
  function isPager(am, rc) { var r = am && am.receivers && am.receivers[rc]; return !!(r && r.pagerduty_configs); }
  function silenced(state, labels) {
    return (state.silences || []).filter(function (s) { return s.endsAt > state.now() && s.matchers.every(function (mt) { return mmatch(labels, mt); }); })[0] || null;
  }

  /* ═══ evaluating alert rules over time ═════════════════════════ */
  function alertEls(r, t, ctx) {
    var v;
    try { v = pqEval(r.ast, t, ctx); } catch (e) { return []; }
    if (v.k !== 'v') return [];
    return v.v.map(function (e) {
      var lab = dropName(e.m);
      Object.keys(r.labels).forEach(function (k) { lab[k] = r.labels[k]; });
      lab.alertname = r.name;
      return { labels: lab, v: e.v };
    });
  }
  /* step through [from, to]; returns the first notification and (for
     replays) a timeline of pending/firing/resolved transitions */
  function stepAlerts(rules, series, from, to, step, am, opts) {
    opts = opts || {};
    var ctx = { series: series, rec: rules.rec }, active = {}, out = { first: null, firstPage: null, events: [], anyFiring: false };
    for (var t = from; t <= to + 1e-9; t += step) {
      var seen = {};
      rules.alerts.forEach(function (r, i) {
        alertEls(r, t, ctx).forEach(function (e) {
          var k = i + '|' + lkey(e.labels);
          seen[k] = 1;
          if (!active[k]) { active[k] = { since: t, firing: false, rule: r, labels: e.labels }; if (opts.timeline && r.forSec > 0) out.events.push({ t: t, a: active[k], state: 'pending' }); }
          var a = active[k];
          if (!a.firing && t - a.since >= r.forSec) {
            a.firing = true; out.anyFiring = true;
            var rc = routeAlert(am, e.labels), hit = { t: t, rule: r, labels: e.labels, receiver: rc, pager: isPager(am, rc), silence: opts.state ? silenced(opts.state, e.labels) : null };
            if (opts.timeline) out.events.push({ t: t, a: a, state: 'firing', hit: hit });
            if (!out.first && !hit.silence) out.first = hit;
            if (hit.pager && !hit.silence && !out.firstPage) out.firstPage = hit;
          }
        });
      });
      Object.keys(active).forEach(function (k) {
        if (seen[k]) return;
        if (opts.timeline) out.events.push({ t: t, a: active[k], state: active[k].firing ? 'resolved' : 'inactive' });
        delete active[k];
      });
    }
    out.active = active;
    return out;
  }
  /* alerts firing at T: present at every evaluation in [T - for, T] */
  function firingAt(rules, series, T, step) {
    var ctx = { series: series, rec: rules.rec }, out = [];
    rules.alerts.forEach(function (r) {
      var n = Math.max(0, Math.ceil(r.forSec / step - 1e-9)), keep = null, last = null;
      for (var k = n; k >= 0; k--) {
        var t = T - k * step;
        if (t < 0) { keep = {}; break; }
        var now = {};
        alertEls(r, t, ctx).forEach(function (e) { now[lkey(e.labels)] = e; });
        if (keep === null) keep = now; else Object.keys(keep).forEach(function (x) { if (!now[x]) delete keep[x]; });
        last = now;
      }
      Object.keys(keep || {}).forEach(function (x) { out.push({ rule: r, labels: last[x].labels }); });
    });
    return out;
  }

  /* ═══ series built from samples (promtool input_series, S22 history) ═ */
  function expandValues(s) {
    var out = [];
    String(s == null ? '' : s).trim().split(/\s+/).forEach(function (tok) {
      if (!tok) return;
      var m, NUM = '(-?\\d+(?:\\.\\d+)?(?:e[-+]?\\d+)?)';
      if (tok === '_' || tok === 'stale') { out.push(null); return; }
      if ((m = /^_x(\d+)$/.exec(tok))) { for (var i = 0; i < +m[1]; i++) out.push(null); return; }
      if ((m = new RegExp('^' + NUM + '([+-])' + '(\\d+(?:\\.\\d+)?(?:e[-+]?\\d+)?)x(\\d+)$', 'i').exec(tok))) {
        var a = Number(m[1]), b = Number(m[3]) * (m[2] === '-' ? -1 : 1);
        for (var j = 0; j <= +m[4]; j++) out.push(a + j * b);
        return;
      }
      if ((m = new RegExp('^' + NUM + 'x(\\d+)$', 'i').exec(tok))) { for (var k = 0; k <= +m[2]; k++) out.push(Number(m[1])); return; }
      if (new RegExp('^' + NUM + '$', 'i').test(tok)) { out.push(Number(tok)); return; }
      throw new Error('bad input series value "' + tok + '" (use numbers, a+bxn, axn, _ or _xn)');
    });
    return out;
  }
  function sampled(m, vals, step) {
    return { m: m, start: 0, step: step, vals: vals, at: function (t) {
      var i = Math.floor(t / step + 1e-9);
      if (i < 0) return undefined;
      for (var back = 0; back <= Math.floor(300 / step); back++) {
        var j = i - back;
        if (j < 0) return undefined;
        if (j < vals.length && vals[j] != null) return vals[j];
      }
      return undefined;
    } };
  }
  function seriesFromSpec(spec, vals, step) {
    var ast = pqParse(spec);
    if (ast.k !== 'sel' || ast.range) throw new Error('series "' + spec + '" must be a plain metric{labels} selector');
    var m = {};
    ast.m.forEach(function (mt) { if (mt.op === '=') m[mt.l] = mt.v; });
    if (ast.name) m.__name__ = ast.name;
    return sampled(m, vals, step);
  }
  /* per-minute increments → cumulative counters → promtool notation */
  function counterVals(incs) { var v = [0], c = 0; incs.forEach(function (x) { c += x; v.push(c); }); return v; }
  function notation(incs) {
    var parts = ['0'], i = 0, c = 0;
    while (i < incs.length) {
      var j = i;
      while (j + 1 < incs.length && incs[j + 1] === incs[i]) j++;
      var len = j - i + 1, first = c + incs[i];
      parts.push(len === 1 ? String(first) : first + '+' + incs[i] + 'x' + (len - 1));
      c += incs[i] * len; i = j + 1;
    }
    return parts.join(' ');
  }

  /* ═══ the monitoring stack's command verbs (S21, S22) ═══════════
     cfg: { dir, series(extra), onQuery(info), testRules(path), hasDashboards } */
  function promStack(state, w0, cfg) {
    var S = SIM(), memo = {};
    function rulePaths(w) {
      var dir = cfg.dir + '/rules';
      return (LXShell.children(w, dir) || []).filter(function (p) { return /\.ya?ml$/.test(p); }).sort();
    }
    function diskRules(w) {
      return rulePaths(w).map(function (p) { return { path: p.replace(cfg.dir + '/', ''), text: S.readFile(w, p) || '' }; });
    }
    function rulesOf(files) {
      var key = files.map(function (f) { return f.path + '\u0001' + f.text; }).join('\u0002');
      if (!memo[key]) memo[key] = mergeRules(files);
      return memo[key];
    }
    function amOf(text) { var k = 'am\u0001' + text; if (!memo[k]) memo[k] = loadAm(text); return memo[k]; }
    state.prom.rulesOf = rulesOf; state.prom.amOf = amOf;
    state.loadedRules = function () { return rulesOf(state.prom.loaded); };
    state.loadedAm = function () { return amOf(state.prom.amLoaded); };
    state.diskRules = function (w) { return rulesOf(diskRules(w)); };

    function reloadProm(w) {
      var files = diskRules(w), r = rulesOf(files);
      if (r.errors.length) { state.prom.reloadErrors = r.errors.slice(); return { ok: false, msg: 'failed to reload config: one or more errors occurred while applying the new configuration\n' + r.errors.join('\n') }; }
      state.prom.loaded = files; state.prom.loadedAt = state.now(); state.prom.reloads++; state.prom.reloadErrors = null;
      return { ok: true };
    }
    function reloadAm(w) {
      var text = S.readFile(w, cfg.dir + '/alertmanager.yml') || '', a = amOf(text);
      if (a.errors.length) return { ok: false, msg: 'failed to reload config: ' + a.errors.join('; ') };
      state.prom.amLoaded = text;
      return { ok: true };
    }
    function evalQuery(q, t) {
      var ast = pqParse(q), ctx = { series: cfg.series(), rec: state.loadedRules().rec, touched: [], sels: [] };
      var r = pqEval(ast, t, ctx);
      if (cfg.onQuery) cfg.onQuery({ ast: ast, r: r, t: t, ctx: ctx, q: q });
      return r;
    }
    function render(r, t, unix) {
      var when = unix ? '@[' + (DAY0 + t) + ']' : '@[' + iso(t) + ']';
      if (r.k === 's') return 'scalar: ' + fmtNum(r.v) + ' ' + when;
      if (!r.v.length) return 'Empty query result';
      return r.v.map(function (e) { return fmtLabels(e.m) + ' => ' + fmtNum(e.v) + ' ' + when; }).join('\n');
    }
    function alertsNow() {
      return firingAt(state.loadedRules(), cfg.series(), state.now(), 30).map(function (a) { var rc = routeAlert(state.loadedAm(), a.labels); return { labels: a.labels, rule: a.rule, receiver: rc, silence: silenced(state, a.labels) }; });
    }
    function ruleStates() {
      var now = state.now(), L = state.loadedRules(), fir = firingAt(L, cfg.series(), now, 30), ctx = { series: cfg.series(), rec: L.rec };
      return L.groups.map(function (g) {
        return { name: g.name, file: (g.rules[0] && g.rules[0].file) || '', rules: g.rules.map(function (r) {
          if (r.kind === 'record') return { type: 'recording', name: r.name, query: r.expr, health: r.ast ? 'ok' : 'err' };
          var f = fir.filter(function (a) { return a.rule === r; }).length, pend = f ? 0 : alertEls(r, now, ctx).length;
          return { type: 'alerting', name: r.name, query: r.expr, duration: r.forSec, labels: r.labels, state: f ? 'firing' : pend ? 'pending' : 'inactive', health: 'ok' };
        }) };
      });
    }
    function timeArg(a) {
      var t = null, rest = [];
      for (var i = 0; i < a.length; i++) {
        if (a[i] === '--time' || a[i] === '-t') { t = a[++i]; continue; }
        if (/^--time=/.test(a[i])) { t = a[i].slice(7); continue; }
        rest.push(a[i]);
      }
      return { t: t, rest: rest };
    }

    var verbs = {};
    verbs.promql = function (w, a) {
      var ta = timeArg(a), q = ta.rest.join(' ').trim();
      if (!q || q === '--help' || q === '-h') return res('promql (SIMULATION stand-in for the Prometheus query box / promtool query instant)\nUsage: promql [--time HH:MM | RFC3339] \'QUERY\'\nEvaluates a PromQL subset against this lab\'s Prometheus: selectors with = != =~ !~, [range] inside rate()/increase(),\nsum/avg/min/max/count [by|without (labels)], histogram_quantile, absent, vector, abs, clamp_min/max,\n+ - * / % ^, == != > < >= <= [bool], and/or/unless [on|ignoring (labels)]. Recording rules from the loaded rule files resolve by name.\nNot modelled: subqueries, offset/@, *_over_time, group_left/right, label_replace.');
      var t = state.now();
      if (ta.t != null) { t = parseTime(ta.t); if (t == null) return fail('promql: cannot parse time "' + ta.t + '" (use HH:MM, 2026-10-13T09:00:00Z or a unix timestamp)', 2); if (t > state.now()) return fail('promql: ' + ta.t + ' is in the future (now is ' + iso(state.now()) + ')', 2); }
      try { return res('# evaluated at ' + iso(t) + '\n' + render(evalQuery(q, t), t)); }
      catch (e) { return fail('Error executing query: ' + e.message, 1); }
    };
    verbs.promtool = function (w, a) {
      var sub = (a[0] || '') + ' ' + (a[1] || '');
      if (sub === 'check rules') {
        var files = a.slice(2).filter(function (x) { return x.charAt(0) !== '-'; });
        if (!files.length) return fail('promtool: error: expected at least one rule file', 2);
        var out = [], bad = false;
        files.forEach(function (f) {
          var text = S.readFile(w, f);
          out.push('Checking ' + f);
          if (text == null) { bad = true; out.push('  FAILED:\nopen ' + f + ': no such file or directory'); return; }
          var r = loadRuleText(text, f), n = r.groups.reduce(function (x, g) { return x + g.rules.length; }, 0);
          if (r.errors.length) { bad = true; out.push('  FAILED:\n' + r.errors.join('\n')); }
          else out.push('  SUCCESS: ' + n + ' rules found');
          out.push('');
        });
        return { out: out.join('\n').replace(/\n*$/, '\n'), code: bad ? 1 : 0 };
      }
      if (sub === 'check config') {
        var cf = a[2] || 'prometheus.yml', ct = S.readFile(w, cf);
        if (ct == null) return fail('Checking ' + cf + '\n  FAILED: open ' + cf + ': no such file or directory', 1);
        var y = yParse(ct);
        if (y.error) return fail('Checking ' + cf + '\n  FAILED: parsing YAML file ' + cf + ': ' + y.error, 1);
        var rp = diskRules(w), rr = rulesOf(rp);
        return { out: 'Checking ' + cf + '\n  SUCCESS: ' + rp.length + ' rule files found\n SUCCESS: ' + cf + ' is valid prometheus config file syntax\n\n' + rp.map(function (f) { var r1 = loadRuleText(f.text, f.path); return 'Checking ' + f.path + '\n' + (r1.errors.length ? '  FAILED:\n' + r1.errors.join('\n') : '  SUCCESS: ' + r1.groups.reduce(function (x, g) { return x + g.rules.length; }, 0) + ' rules found'); }).join('\n\n') + '\n', code: rr.errors.length ? 1 : 0 };
      }
      if (sub === 'test rules') {
        if (!cfg.testRules) return S.unsupported('promtool', 'test rules', ['check rules FILE', 'check config FILE', 'query instant URL QUERY']);
        if (!a[2]) return fail('promtool: error: expected at least one test file', 2);
        return cfg.testRules(w, a[2]);
      }
      if (sub === 'query instant') {
        var ta2 = timeArg(a.slice(2)), url = ta2.rest[0], q2 = ta2.rest.slice(1).join(' ');
        if (!url || !/^(https?:\/\/)?(prometheus|localhost)(:9090)?\/?$/.test(url)) return fail('Error querying ' + (url || '(no server)') + ': only http://prometheus:9090 exists in this lab', 1);
        var t2 = ta2.t != null ? parseTime(ta2.t) : state.now();
        if (t2 == null) return fail('promtool: cannot parse time ' + ta2.t, 2);
        try { return res(render(evalQuery(q2, t2), t2, true)); } catch (e) { return fail('query error: ' + e.message, 1); }
      }
      return S.unsupported('promtool', a.join(' ') || '(nothing)', cfg.testRules ? ['check rules FILE...', 'check config FILE', 'test rules TESTFILE', 'query instant URL QUERY [--time T]'] : ['check rules FILE...', 'check config FILE', 'query instant URL QUERY [--time T]']);
    };
    verbs.curl = function (w, a) {
      var f = S.flags(a, ['X', 'request', 'd', 'data', 'data-urlencode', 'o', 'w', 'H', 'm', 'max-time']);
      var url = f.pos.filter(function (x) { return /^(https?:\/\/)?[a-z0-9.-]+(:\d+)?(\/|$)/i.test(x); }).pop();
      if (!url) return fail('curl: no URL specified!', 2);
      var m = /^(?:https?:\/\/)?([^/:?]+)(?::(\d+))?(\/[^?]*)?(?:\?(.*))?$/.exec(url);
      if (!m) return fail('curl: (3) URL rejected: Malformed input to a URL function', 3);
      var host = m[1], port = m[2] || '80', path = m[3] || '/', qs = m[4] || '';
      var params = {};
      qs.split('&').forEach(function (kv) { if (!kv) return; var i = kv.indexOf('='); var k = i < 0 ? kv : kv.slice(0, i), v = i < 0 ? '' : kv.slice(i + 1); try { params[k] = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { params[k] = v; } });
      [].concat(f.f['data-urlencode'] || []).concat(f.f.d || []).concat(f.f.data || []).forEach(function (kv) { if (typeof kv !== 'string') return; var i = kv.indexOf('='); if (i > 0) params[kv.slice(0, i)] = kv.slice(i + 1); });
      var method = String(f.f.X || f.f.request || ((f.f.d || f.f.data || f.f['data-urlencode']) && !f.f.G ? 'POST' : 'GET')).toUpperCase();
      function json(o) { return res(JSON.stringify(o)); }
      var isProm = /^(prometheus|localhost)$/.test(host) && port === '9090', isAm = host === 'alertmanager' && port === '9093';
      if (!isProm && !isAm) return fail('curl: (6) Could not resolve host: ' + host + ' (this lab has http://prometheus:9090 and http://alertmanager:9093)', 6);
      if (path === '/-/reload') {
        if (method !== 'POST' && method !== 'PUT') return res('Only POST or PUT requests allowed');
        var r = isProm ? reloadProm(w) : reloadAm(w);
        return r.ok ? res('') : fail(r.msg, 22);
      }
      if (path === '/-/healthy' || path === '/-/ready') return res(isProm ? 'Prometheus Server is ' + (path === '/-/ready' ? 'Ready.' : 'Healthy.') : 'OK');
      if (isAm) {
        if (path === '/api/v2/silences') return json((state.silences || []).map(function (s) { return { id: s.id, status: { state: s.endsAt > state.now() ? 'active' : 'expired' }, matchers: s.matchers.map(function (mt) { return { name: mt.l, value: mt.v, isRegex: !!mt.re, isEqual: mt.op === '=' || mt.op === '=~' }; }), comment: s.comment, endsAt: iso(s.endsAt) }; }));
        if (path === '/api/v2/alerts') return json(alertsNow().map(function (x) { return { labels: x.labels, receivers: [{ name: x.receiver }], status: { state: x.silence ? 'suppressed' : 'active' } }; }));
        return fail('curl: (22) The requested URL returned error: 404 (this lab models /-/reload, /api/v2/alerts, /api/v2/silences)', 22);
      }
      if (path === '/api/v1/query') {
        if (!params.query) return json({ status: 'error', errorType: 'bad_data', error: 'invalid parameter "query": unknown position: parse error: no expression found in input' });
        var t = params.time != null ? parseTime(params.time) : state.now();
        if (t == null) return json({ status: 'error', errorType: 'bad_data', error: 'invalid parameter "time": cannot parse "' + params.time + '" to a valid timestamp' });
        try {
          var rv = evalQuery(params.query, t);
          if (rv.k === 's') return json({ status: 'success', data: { resultType: 'scalar', result: [DAY0 + t, fmtNum(rv.v)] } });
          return json({ status: 'success', data: { resultType: 'vector', result: rv.v.map(function (e) { return { metric: e.m, value: [DAY0 + t, fmtNum(e.v)] }; }) } });
        } catch (e) { return json({ status: 'error', errorType: 'bad_data', error: e.message }); }
      }
      if (path === '/api/v1/targets') {
        var ups = cfg.series().filter(function (s) { return s.m.__name__ === 'up'; });
        return json({ status: 'success', data: { activeTargets: ups.map(function (s) { var v = s.at(state.now()); return { labels: { instance: s.m.instance, job: s.m.job }, scrapeUrl: 'http://' + s.m.instance + '/metrics', health: v === 1 ? 'up' : 'down', lastScrape: iso(state.now() - 7) }; }) } });
      }
      if (path === '/api/v1/rules') return json({ status: 'success', data: { groups: ruleStates() } });
      if (path === '/api/v1/alerts') return json({ status: 'success', data: { alerts: alertsNow().map(function (x) { return { labels: x.labels, state: 'firing' }; }) } });
      if (path === '/api/v1/status/config') return res('(this lab: read prometheus.yml in ' + cfg.dir + ')');
      return fail('curl: (22) The requested URL returned error: 404 (this lab models /api/v1/query, /api/v1/targets, /api/v1/rules, /api/v1/alerts and /-/reload)', 22);
    };
    verbs.amtool = function (w, a) {
      var args = a.filter(function (x) { return !/^--(alertmanager\.url|output)=/.test(x); });
      if (args[0] === 'check-config') {
        var file = args[1] || cfg.dir + '/alertmanager.yml', text = S.readFile(w, file);
        if (text == null) return fail('Checking \'' + file + '\'  FAILED: open ' + file + ': no such file or directory', 1);
        var am = amOf(text);
        if (am.errors.length) return fail('Checking \'' + file + '\'  FAILED: ' + am.errors.join('; '), 1);
        return res('Checking \'' + file + '\'  SUCCESS\nFound:\n - global config\n - route\n - 0 inhibit rules\n - ' + Object.keys(am.receivers).length + ' receivers\n - 0 templates');
      }
      if (args[0] === 'config' && args[1] === 'routes') {
        var cfIdx = args.filter(function (x) { return /^--config\.file=/.test(x); })[0];
        var amc = cfIdx ? amOf(S.readFile(w, cfIdx.slice(14)) || '') : state.loadedAm();
        if (amc.errors && amc.errors.length) return fail('amtool: ' + amc.errors.join('; '), 1);
        if (args[2] === 'test') {
          var lab = {};
          args.slice(3).forEach(function (x) { var mt = parseMatcher(x); if (mt) lab[mt.l] = mt.v; });
          return res(routeAlert(amc, lab) || '(no receiver)');
        }
        var lines = ['Routing tree:'];
        (function show(r, ind) { lines.push(ind + '└── ' + (r.matchers.length ? '{' + r.matchers.map(function (mt) { return mt.l + mt.op + '"' + mt.v + '"'; }).join(',') + '}' : 'default-route') + '  receiver: ' + r.receiver); r.routes.forEach(function (k) { show(k, ind + '    '); }); })(amc.route, '');
        return res(lines.join('\n'));
      }
      if (args[0] === 'alert' && (!args[1] || args[1] === 'query')) {
        var al = alertsNow();
        if (!al.length) return res('Alertname   Starts At   Summary   State');
        return res('Alertname                         Severity   Receiver                State\n' + al.map(function (x) { return S.pad(x.labels.alertname, 34) + S.pad(x.labels.severity || '', 11) + S.pad(x.receiver || '', 24) + (x.silence ? 'suppressed' : 'active'); }).join('\n'));
      }
      if (args[0] === 'silence') {
        if (args[1] === 'query' || !args[1]) {
          var act = (state.silences || []).filter(function (s) { return s.endsAt > state.now(); });
          return res('ID                                    Matchers                       Ends At                 Comment\n' + act.map(function (s) { return S.pad(s.id, 38) + S.pad(s.matchers.map(function (mt) { return mt.l + mt.op + '"' + mt.v + '"'; }).join(' '), 31) + S.pad(iso(s.endsAt), 24) + s.comment; }).join('\n'));
        }
        if (args[1] === 'expire') {
          var hit = (state.silences || []).filter(function (s) { return s.id === args[2]; })[0];
          if (!hit) return fail('amtool: silence ' + (args[2] || '') + ' not found', 1);
          hit.endsAt = state.now(); return res('');
        }
        if (args[1] === 'add') {
          var ms = [], dur = 3600, comment = null;
          for (var i = 2; i < args.length; i++) {
            var x = args[i];
            if (/^--duration=/.test(x)) dur = parseDur(x.slice(11));
            else if (x === '-d' || x === '--duration') dur = parseDur(args[++i]);
            else if (/^--comment=/.test(x)) comment = x.slice(10);
            else if (x === '-c' || x === '--comment') comment = args[++i];
            else if (/^--author=/.test(x) || x === '-a') { if (x === '-a') i++; }
            else { var mt2 = parseMatcher(x); if (!mt2) return fail('amtool: error: bad matcher format: ' + x, 1); ms.push(mt2); }
          }
          if (!ms.length) return fail('amtool: error: no matchers specified', 1);
          if (!comment) return fail('amtool: error: comment required by config', 1);
          if (dur !== dur) return fail('amtool: error: invalid duration', 1);
          var id = (S.fnv('sil' + state.now() + ms.length).toString(16) + '0000000-7c1e-4f0a-9b3d-5e2a61c0d4f8').slice(0, 8) + '-7c1e-4f0a-9b3d-5e2a61c0d4f8';
          state.silences.push({ id: id, matchers: ms, comment: comment, startsAt: state.now(), endsAt: state.now() + dur });
          return res(id);
        }
      }
      return S.unsupported('amtool', args.join(' ') || '(nothing)', ['alert [query]', 'silence add MATCHER... --comment=TEXT [--duration=2h]', 'silence query', 'silence expire ID', 'check-config FILE', 'config routes [test LABEL=VALUE...]']);
    };
    verbs.systemctl = function (w, a) {
      var unit = String(a[1] || '').replace(/\.service$/, '');
      if (a[0] === 'reload' && unit === 'prometheus') { var r = reloadProm(w); return r.ok ? res('') : fail('Job for prometheus.service failed: ' + r.msg.split('\n')[0] + '\nSee "journalctl -u prometheus" for details.', 1); }
      if (a[0] === 'reload' && unit === 'alertmanager') { var r2 = reloadAm(w); return r2.ok ? res('') : fail('Job for alertmanager.service failed: ' + r2.msg, 1); }
      if (a[0] === 'status' && (unit === 'prometheus' || unit === 'alertmanager')) return res('● ' + unit + '.service - ' + unit + '\n     Active: active (running)' + (unit === 'prometheus' ? '\n   last rule reload: ' + iso(state.prom.loadedAt) + (state.prom.reloadErrors ? ' (latest reload FAILED: ' + state.prom.reloadErrors[0] + ')' : '') : ''));
      return S.unsupported('systemctl', a.join(' '), ['reload prometheus', 'reload alertmanager', 'status prometheus|alertmanager']);
    };
    verbs.journalctl = function (w, a) {
      if (a.join(' ').indexOf('prometheus') === -1) return S.unsupported('journalctl', a.join(' '), ['journalctl -u prometheus']);
      var lines = ['ts=' + iso(0) + ' level=info msg="Completed loading of configuration file" filename=/srv/monitoring/prometheus.yml'];
      if (state.prom.reloadErrors) lines.push('ts=' + iso(state.now()) + ' level=error msg="Error reloading config" err="' + state.prom.reloadErrors.join('; ') + '"');
      else if (state.prom.reloads) lines.push('ts=' + iso(state.prom.loadedAt) + ' level=info msg="Completed loading of configuration file" filename=/srv/monitoring/prometheus.yml');
      return res(lines.join('\n'));
    };
    return verbs;
  }
  function initProm(state, files, loadedAt) {
    state.prom = { loaded: files.filter(function (f) { return /^rules\//.test(f.path); }).map(function (f) { return { path: f.path, text: f.content }; }),
      amLoaded: (files.filter(function (f) { return f.path === 'alertmanager.yml'; })[0] || {}).content || '', loadedAt: loadedAt || 0, reloads: 0, reloadErrors: null };
    state.silences = [];
  }
  var ALERTMANAGER_YML = '# Alertmanager routing for the Beacon team (loaded on POST /-/reload)\nroute:\n  receiver: beacon-tickets\n  group_by: [alertname]\n  routes:\n    - receiver: beacon-oncall-pager\n      matchers:\n        - severity="page"\nreceivers:\n  - name: beacon-tickets\n    webhook_configs:\n      - url: http://tickets.corp.lab/hooks/alertmanager\n  - name: beacon-oncall-pager\n    pagerduty_configs:\n      - routing_key: lab-pd-routing-key-not-a-real-secret\n';
  function noDataAsHealthy(text) { return /\bor\s+(on\s*\(\s*\)\s*)?vector\s*\(\s*[01](\.0*)?\s*\)/.test(String(text)); }
  function silenceTest(c) { return (st(c).silences || []).length > 0; }
  var SILENCE_DEMO = 'amtool silence add alertname=~"Beacon.*" --duration=24h --comment="noisy, investigating"';

  /* ═══ S21 · Dashboard green while requests fail ════════════════════ */
  var INC_FROM = 8 * 3600 + 40 * 60, INC_TO = 9 * 3600 + 20 * 60, S21_NOW = 9 * 3600 + 30 * 60;
  var USER_METRICS = ['lb_http_responses_total', 'beacon_http_requests_total'];
  var F201 = { '0.05': 0.55, '0.1': 0.82, '0.25': 0.96, '0.5': 0.995, '1': 1, '+Inf': 1 };
  /* every series derives from state.faults (the recorded incident, replays,
     hypothetical gaps for the checks) and the drain of beacon-3 at 09:20 */
  function s21Series(state, extra) {
    function faults() { return extra ? state.faults.concat(extra) : state.faults; }
    function inF(kind, t) { var f = faults(); for (var i = 0; i < f.length; i++) if (f[i].kind === kind && t >= f[i].from && t < f[i].to) return f[i]; return null; }
    function drained(t) { return t >= state.drainFrom && !inF('write', t); }
    function bpts() { var b = [state.drainFrom]; faults().forEach(function (f) { b.push(f.from, f.to); }); return b.sort(function (x, y) { return x - y; }); }
    function integ(fn, t) {
      var b = bpts(), sum = 0, prev = 0;
      for (var i = 0; i <= b.length && prev < t; i++) {
        var edge = i < b.length ? Math.min(b[i], t) : t;
        if (edge > prev) { sum += fn((prev + edge) / 2) * (edge - prev); prev = edge; }
      }
      return sum;
    }
    function gapped(name, t) { var f = faults(); for (var i = 0; i < f.length; i++) if (f[i].kind === 'gap' && t >= f[i].from && t < f[i].to && f[i].names.indexOf(name) !== -1) return true; return false; }
    function statusRate(i, code) {
      return function (t) {
        if (i === 3 && inF('write', t)) return code === '503' ? 4 : 0;
        if (code !== '201') return 0;
        return drained(t) ? (i === 3 ? 0 : 6) : 4;
      };
    }
    var out = [];
    function counter(m, fn) { out.push({ m: m, start: 0, at: function (t) { return gapped(m.__name__, t) ? undefined : integ(fn, t); } }); }
    function sumOf(fns) { return function (t) { return fns.reduce(function (a, f) { return a + f(t); }, 0); }; }
    ['201', '503'].forEach(function (code) { counter({ __name__: 'lb_http_responses_total', job: 'lb', instance: 'lb-1:9100', route: '/status', code: code }, sumOf([1, 2, 3].map(function (i) { return statusRate(i, code); }))); });
    counter({ __name__: 'lb_http_responses_total', job: 'lb', instance: 'lb-1:9100', route: '/version', code: '200' }, function () { return 1.5; });
    [1, 2, 3].forEach(function (i) {
      var inst = 'beacon-' + i + ':8080', base = { job: 'beacon-api', instance: inst };
      function lab(x) { return Object.assign({ __name__: 'beacon_http_requests_total' }, base, x); }
      counter(lab({ path: '/status', method: 'POST', code: '201' }), statusRate(i, '201'));
      counter(lab({ path: '/status', method: 'POST', code: '503' }), statusRate(i, '503'));
      counter(lab({ path: '/healthz', method: 'GET', code: '200' }), function () { return 0.5; });
      counter(lab({ path: '/version', method: 'GET', code: '200' }), function () { return 0.5; });
      Object.keys(F201).forEach(function (le) {
        counter(Object.assign({ __name__: 'beacon_http_request_duration_seconds_bucket' }, base, { path: '/status', le: le }), function (t) { return statusRate(i, '201')(t) * F201[le] + statusRate(i, '503')(t); });
        counter(Object.assign({ __name__: 'beacon_http_request_duration_seconds_bucket' }, base, { path: '/healthz', le: le }), function () { return 0.5; });
      });
    });
    [['prometheus', 'localhost:9090'], ['lb', 'lb-1:9100'], ['beacon-api', 'beacon-1:8080'], ['beacon-api', 'beacon-2:8080'], ['beacon-api', 'beacon-3:8080']].forEach(function (x) {
      out.push({ m: { __name__: 'up', job: x[0], instance: x[1] }, start: 0, at: function () { return 1; } });
    });
    return out;
  }
  function panelsOf(text) {
    var y = yParse(text);
    if (y.error || !y.value || !Array.isArray(y.value.panels)) return { error: y.error || 'expected a "panels" list', panels: [] };
    return { title: y.value.title || 'dashboard', panels: y.value.panels.filter(function (p) { return p && typeof p === 'object'; }).map(function (p) {
      var ast = null, perr = null;
      try { ast = pqParse(String(p.expr || '')); } catch (e) { perr = e.message; }
      var th = /^\s*red\s*(<|>|<=|>=)\s*(-?[\d.]+)\s*$/.exec(String(p.thresholds || ''));
      return { title: String(p.title || ''), expr: String(p.expr || ''), ast: ast, perr: perr, unit: p.unit || '', th: th ? { op: th[1], v: Number(th[2]) } : null, noData: String(p.noData == null ? 'nodata' : p.noData) };
    }) };
  }
  function panelState(p, series, rec, t) {
    if (!p.ast) return { text: 'query error', state: 'ERROR' };
    var r;
    try { r = pqEval(p.ast, t, { series: series, rec: rec }); } catch (e) { return { text: 'query error', state: 'ERROR', why: e.message }; }
    var vals = r.k === 's' ? [r.v] : r.v.map(function (e) { return e.v; });
    if (!vals.length) return { text: 'No data', state: p.noData === 'ok' ? 'GREEN' : p.noData === 'alerting' ? 'RED' : 'NO DATA', nodata: true };
    function fmt(v) { return p.unit === 'percent' ? (v * 100).toFixed(2) + '%' : p.unit === 'reqps' ? v.toFixed(1) + ' req/s' : fmtNum(v); }
    var red = p.th && vals.some(function (v) { return v !== v || arith(p.th.op, v, p.th.v); });
    return { text: vals.map(fmt).join(', '), state: p.th ? (red ? 'RED' : 'GREEN') : '-', vals: vals };
  }
  function availabilityPanel(d) { return d.panels.filter(function (p) { return /availab/i.test(p.title); })[0] || d.panels.filter(function (p) { return p.th; })[0] || null; }

  function s21Judge(c) {
    var s = st(c), L = s.loadedRules(), am = s.loadedAm(), dash = SIM().readFile(c.w, '/srv/monitoring/dashboards/beacon.yaml') || '';
    var key = L.text + '\u0003' + s.prom.amLoaded + '\u0003' + dash;
    s._judge = s._judge || {};
    if (s._judge.key === key) return s._judge.v;
    var base = s21Series(s, null);
    var inc = stepAlerts(L, base, INC_FROM - 600, INC_FROM + 1500, 30, am);
    var quiet = !stepAlerts(L, base, 7 * 3600, INC_FROM - 300, 60, am).anyFiring;
    var names = {};
    if (inc.firstPage) namesOf(inc.firstPage.rule.ast, L.rec, names);
    delete names.up;
    var gapNames = Object.keys(names).length ? Object.keys(names) : USER_METRICS.slice();
    var gapSeries = s21Series(s, [{ kind: 'gap', from: 7 * 3600, to: 7 * 3600 + 1800, names: gapNames }]);
    var gap = stepAlerts(L, gapSeries, 7 * 3600 - 600, 7 * 3600 + 1200, 30, am);
    var d = panelsOf(dash), ap = availabilityPanel(d), panel = false;
    if (ap) {
      var pi = panelState(ap, base, L.rec, 9 * 3600), ph = panelState(ap, base, L.rec, 8 * 3600);
      panel = pi.state === 'RED' && !pi.nodata && ph.state === 'GREEN' && !ph.nodata && ap.noData !== 'ok';
    }
    var cheat = L.alerts.some(function (r) { return noDataAsHealthy(r.expr); }) || d.panels.some(function (p) { return noDataAsHealthy(p.expr); });
    var v = { alert: !!inc.firstPage && quiet && !cheat, gap: !!gap.first && quiet && !cheat, panel: panel && !cheat, gapNames: gapNames, incAt: inc.firstPage && inc.firstPage.t };
    s._judge = { key: key, v: v };
    return v;
  }

  var S21_PROM_YML = '# Prometheus for the Beacon lab stack\nglobal:\n  scrape_interval: 15s\n  evaluation_interval: 30s\nrule_files:\n  - rules/*.yaml\nalerting:\n  alertmanagers:\n    - static_configs:\n        - targets: [\'alertmanager:9093\']\nscrape_configs:\n  - job_name: prometheus\n    static_configs:\n      - targets: [\'localhost:9090\']\n  - job_name: lb\n    static_configs:\n      - targets: [\'lb-1:9100\']\n  - job_name: beacon-api\n    static_configs:\n      - targets: [\'beacon-1:8080\', \'beacon-2:8080\', \'beacon-3:8080\']\n';
  var S21_RULE = {
    a: { name: 'BeaconAvailabilityLow', expr: 'sum(rate(beacon_http_requests_total{job="beacon-api",path="/healthz",code=~"5.."}[5m])) / sum(rate(beacon_http_requests_total{job="beacon-api",path="/healthz"}[5m])) > 0.01', summary: 'Beacon is failing more than 1% of requests' },
    b: { name: 'BeaconAvailabilityLow', expr: 'sum(rate(beacon_http_requests_total{job="beacon",path="/status",code=~"5.."}[5m])) / sum(rate(beacon_http_requests_total{job="beacon",path="/status"}[5m])) > 0.01', summary: 'Beacon is failing more than 1% of status submissions' },
    c: { name: 'BeaconDown', expr: 'avg(up{job="beacon-api"}) < 1', summary: 'A Beacon backend is down' }
  };
  var S21_PANEL = {
    a: '(sum(rate(beacon_http_requests_total{job="beacon-api",path="/healthz",code!~"5.."}[5m])) / sum(rate(beacon_http_requests_total{job="beacon-api",path="/healthz"}[5m])))',
    b: '(sum(rate(beacon_http_requests_total{job="beacon",path="/status",code!~"5.."}[5m])) / sum(rate(beacon_http_requests_total{job="beacon",path="/status"}[5m])))',
    c: 'avg(up{job="beacon-api"})'
  };
  function s21RulesText(v) {
    var r = S21_RULE[v];
    return '# Beacon alerting rules. Prometheus loads rules/*.yaml on POST /-/reload.\ngroups:\n  - name: beacon-availability\n    rules:\n      - alert: ' + r.name + '\n        expr: ' + r.expr + '\n        for: 5m\n        labels:\n          severity: page\n          team: beacon\n        annotations:\n          summary: ' + r.summary + '\n';
  }
  function s21DashText(v) {
    var job = v === 'b' ? 'beacon' : 'beacon-api';
    return '# Beacon overview dashboard, provisioned from this file (dashctl renders it).\n# noData: what a panel shows when its query returns nothing (ok | alerting | nodata)\ntitle: Beacon overview\npanels:\n  - title: Availability\n    expr: ' + S21_PANEL[v] + '\n    unit: percent\n    thresholds: red < 0.99\n    noData: ok\n  - title: Request rate\n    expr: sum(rate(beacon_http_requests_total{job="' + job + '"}[5m]))\n    unit: reqps\n  - title: p99 latency (seconds)\n    expr: histogram_quantile(0.99, sum by (le) (rate(beacon_http_request_duration_seconds_bucket{job="' + job + '"}[5m])))\n  - title: Targets up\n    expr: sum(up)\n';
  }
  var S21_FIX_ALERT = 'sum(rate(lb_http_responses_total{route="/status",code=~"5.."}[5m])) / sum(rate(lb_http_responses_total{route="/status"}[5m])) > 0.01';
  var S21_FIX_PANEL = 'sum(rate(lb_http_responses_total{route="/status",code!~"5.."}[5m])) / sum(rate(lb_http_responses_total{route="/status"}[5m]))';
  var RELOAD = 'curl -s -X POST http://prometheus:9090/-/reload';
  function s21BrokenQueried(v, ast) {
    return selsOf(ast).some(function (n) {
      if (v === 'c') return n.name === 'up';
      return n.m.some(function (mt) { return v === 'a' ? (mt.l === 'path' && mt.op === '=' && mt.v === '/healthz') : (mt.l === 'job' && mt.op === '=' && mt.v === 'beacon'); });
    });
  }
  function fiveXX(sel) { var e = { code: '503' }, o = { code: '201' }; return sel.m.some(function (mt) { return mt.l === 'code'; }) && sel.m.filter(function (mt) { return mt.l === 'code'; }).every(function (mt) { return mmatch(e, mt) && !mmatch(o, mt); }); }

  LX.missions.push({
    id: 'sre-s21', track: 'sre', cat: 'scenario', level: 'intermediate', mins: 30, kind: 'incident',
    title: 'Users report failed submissions while the Beacon dashboard stayed green',
    brief: function () { return 'Support escalated a batch of tickets: between about 08:40 and 09:20 sensor submissions to Beacon (POST /status) were failing with server errors and customers retried by hand. On-call drained one backend at 09:20 once the tickets arrived. Nobody was paged, and the Beacon overview dashboard was green the whole time. Work in /srv/monitoring: find a signal that shows what users experienced, change the alert and the dashboard so this failure is caught next time and so the monitoring cannot quietly go blind, and prove both by replaying the recorded failures (`faultctl list`).'; },
    keys: ['dashctl render beacon --time 09:00', 'promql --time 09:00 \'sum by (route, code) (rate(lb_http_responses_total[5m]))\'', 'cat rules/beacon.yaml', 'cat dashboards/beacon.yaml', 'curl -s http://prometheus:9090/api/v1/targets', 'git log --oneline', 'faultctl list', RELOAD],
    world: function (seed) {
      var S = SIM(), v = S.variantOf(seed, ['a', 'b', 'c']);
      var state = { clock: 0, risky: [], seed: seed, variant: v, hooks: [], drainFrom: INC_TO, replays: [],
        faults: [{ kind: 'write', from: INC_FROM, to: INC_TO, recorded: true }], flags: {} };
      state.now = function () { return S21_NOW + state.clock; };
      var rulesText = s21RulesText(v), dashText = s21DashText(v);
      var files = [
        { path: 'prometheus.yml', content: S21_PROM_YML },
        { path: 'rules/beacon.yaml', content: rulesText },
        { path: 'alertmanager.yml', content: ALERTMANAGER_YML },
        { path: 'dashboards/beacon.yaml', content: dashText },
        { path: 'README.md', content: '# Beacon monitoring (lab copy)\n\n- Prometheus scrapes the load balancer (job lb, lb-1:9100) and the three Beacon backends (job beacon-api).\n- Rules in rules/*.yaml load on `curl -X POST http://prometheus:9090/-/reload` (or `systemctl reload prometheus`).\n- Alertmanager routes severity="page" to the on-call pager; everything else becomes a ticket.\n- dashboards/*.yaml are provisioned on every render: `dashctl render beacon [--time HH:MM]`.\n- `faultctl` replays failures recorded from production into the lab stack, so detection can be proven without waiting for the next outage.\n' }
      ];
      initProm(state, files, 3 * 3600 + 12 * 60 + 40);
      state.git = { branch: 'main', remote: 'origin', files: {}, log: [
        { sha: '9c1d2e7a40b58f1123cc0de94f6a7b3e21d0c4a1', msg: 'dashboards: beacon overview availability panel' },
        { sha: '4be0a91f3c6d27e85a1f09b7c3d2e4f6a8b0c1d2', msg: 'rules: beacon availability alert' }
      ] };
      if (v === 'b') state.git.log.unshift({ sha: '7f3e1a9c2b4d6e8f0a1c3e5b7d9f1a2c4e6b8d0f', msg: 'prometheus: rename scrape job beacon -> beacon-api to match service naming' });
      files.forEach(function (f) { state.git.files[f.path] = f.content; });
      var stack = promStack(state, null, { dir: '/srv/monitoring', series: function () { return s21Series(state, null); },
        onQuery: function (info) {
          var vals = info.r.k === 's' ? [info.r.v] : info.r.v.map(function (e) { return e.v; });
          var pos = vals.some(function (x) { return x === x && x > 0 && x !== Infinity; });
          var statusErr = info.ctx.touched.some(function (x) { var m = x.m; return /^5/.test(m.code || '') && (m.route === '/status' || m.path === '/status') && m.__name__ !== 'beacon_http_request_duration_seconds_bucket'; });
          var labelled = info.r.k === 'v' && info.r.v.some(function (e) { return /^5/.test(e.m.code || '') && e.v > 0; });
          var errSel = info.ctx.touched.some(function (x) { return fiveXX(x.sel); });
          if (pos && statusErr && (labelled || errSel)) state.flags.impact = true;
          if (s21BrokenQueried(state.variant, info.ast)) state.flags.measured = true;
        } });
      var verbs = Object.assign({}, stack, {
        dashctl: function (w, a) {
          if (a[0] !== 'render') return S.unsupported('dashctl', a.join(' ') || '(nothing)', ['render beacon [--time HH:MM]', 'list']);
          var name = a[1] || 'beacon', ti = a.indexOf('--time'), t = state.now();
          if (ti !== -1 || a.some(function (x) { return /^--time=/.test(x); })) {
            var raw = ti !== -1 ? a[ti + 1] : a.filter(function (x) { return /^--time=/.test(x); })[0].slice(7);
            t = parseTime(raw);
            if (t == null || t > state.now()) return fail('dashctl: bad or future time "' + raw + '"', 2);
          }
          var text = S.readFile(w, '/srv/monitoring/dashboards/' + name + '.yaml');
          if (text == null) return fail('dashctl: no dashboard "' + name + '" in /srv/monitoring/dashboards', 1);
          var d = panelsOf(text);
          if (d.error) return fail('dashctl: dashboards/' + name + '.yaml: ' + d.error, 1);
          var series = s21Series(state, null), rec = state.loadedRules().rec, rows = [];
          d.panels.forEach(function (p) { var ps = panelState(p, series, rec, t); rows.push([p.title, ps.text, ps.state + (ps.nodata && p.noData === 'ok' ? ' (no data shown as OK)' : '')]); });
          var ap = availabilityPanel(d);
          if (ap && t >= INC_FROM && t < INC_TO + 300 && panelState(ap, series, rec, t).state === 'GREEN') state.flags.measured = true;
          return res(d.title + '   (dashboards/' + name + '.yaml, evaluated at ' + iso(t) + ')\n' + S.table(['PANEL', 'VALUE', 'STATE'], rows));
        },
        faultctl: function (w, a) {
          if (a[0] === 'list' || !a[0]) return res('Recorded faults this lab can replay (each runs 10 minutes of logical time against the LIVE stack and its LOADED rules):\n  write-errors   recorded 08:40-09:20: beacon-3 back in rotation, answering POST /status with 503\n  scrape-gap     recorded last month: the series your paging alert reads stop arriving for 10 minutes while every target still reports up\nUsage: faultctl replay NAME');
          if (a[0] !== 'replay' || ['write-errors', 'scrape-gap'].indexOf(a[1]) === -1) return S.unsupported('faultctl', a.join(' '), ['list', 'replay write-errors', 'replay scrape-gap']);
          var T = state.now(), L = state.loadedRules(), am = state.loadedAm(), kind = a[1], f;
          if (kind === 'write-errors') f = { kind: 'write', from: T, to: T + 600, replay: true };
          else {
            var j = s21Judge({ w: w, ran: [], out: [] });
            f = { kind: 'gap', from: T, to: T + 600, names: j.gapNames, replay: true };
          }
          state.faults.push(f);
          var series = s21Series(state, null);
          var run = stepAlerts(L, series, T - 300, T + 600, 30, am, { timeline: true, state: state });
          var lines = [kind === 'write-errors' ? 'faultctl: replaying write-errors from ' + hm(T) + ': beacon-3 back in rotation, answering POST /status with 503 for 10 minutes' : 'faultctl: replaying scrape-gap from ' + hm(T) + ': series ' + f.names.join(', ') + ' stop arriving for 10 minutes (targets stay up)',
            'Prometheus evaluates the LOADED rules every 30s (last reload ' + iso(state.prom.loadedAt) + ')'];
          run.events.filter(function (e) { return e.t >= T && e.state !== 'inactive'; }).forEach(function (e) {
            lines.push(hm(e.t) + '  ' + S.pad(e.a.labels.alertname, 34) + S.pad(e.state, 9) + (e.hit ? '→ ' + (e.hit.silence ? 'SILENCED by ' + e.hit.silence.id : 'receiver ' + e.hit.receiver + (e.hit.pager ? ' (page)' : ' (ticket)')) : ''));
          });
          var d = panelsOf(S.readFile(w, '/srv/monitoring/dashboards/beacon.yaml') || ''), ap = availabilityPanel(d);
          if (ap) { var ps = panelState(ap, series, L.rec, T + 300); lines.push('Dashboard "' + ap.title + '" mid-replay: ' + ps.text + '  ' + ps.state); }
          lines.push(hm(T + 600) + '  replay ended' + (kind === 'write-errors' ? '; beacon-3 drained again' : '; series arriving again'));
          var hit = kind === 'write-errors' ? run.firstPage : run.first;
          if (hit) lines.push('Result: DETECTED — ' + hit.labels.alertname + ' reached ' + hit.receiver + ' ' + fmtDur(hit.t - T) + ' after the replay started.');
          else lines.push('Result: NOT DETECTED — ' + (run.events.some(function (e) { return e.hit && e.hit.silence; }) ? 'the alert fired but a silence swallowed it.' : kind === 'write-errors' ? 'no page reached on-call.' : 'nothing fired while the data was missing.'));
          state.replays.push({ kind: kind, at: T, detected: !!hit, rules: L.text });
          state.clock += 600;
          return res(lines.join('\n'));
        },
        git: S.verbs.git(state),
        edit: S.verbs.edit()
      });
      return { user: 'lab', host: 'ops-console', cwd: '/srv/monitoring',
        dirs: [{ path: '/srv/monitoring/rules' }, { path: '/srv/monitoring/dashboards' }],
        files: files.map(function (f) { return { path: '/srv/monitoring/' + f.path, content: f.content }; }),
        sre: state, extra: S.bind(state, verbs) };
    },
    objectives: [
      { id: 'impact', stage: 'evidence', text: 'Show the failure in a signal that measures what users experienced during 08:40–09:20',
        hint: 'Users talk to the load balancer, not to the health check. Which series counts their requests and the status codes they got?',
        hint2: 'The load balancer exports lb_http_responses_total by route and code. The failure is over now, so look back: an [1h] window, or --time 09:00.',
        reveal: 'promql \'sum by (code) (increase(lb_http_responses_total{route="/status"}[1h]))\'',
        done: function (c) { return !!st(c).flags.impact; } },
      { id: 'measured', stage: 'evidence', text: 'Find what the availability alert and panel actually measure, and what they showed while users were failing',
        hint: 'Green means "this query returned a good value". Which query, over which series?',
        hint2: 'Render the dashboard as it was during the incident (`dashctl render beacon --time 09:00`), and evaluate the alert expression from rules/beacon.yaml yourself.',
        reveal: 'dashctl render beacon --time 09:00',
        done: function (c) { return !!st(c).flags.measured; } },
      { id: 'alert', stage: 'fix', text: 'Make the paging alert fire on the user-facing failure (and stay quiet when users are fine), and load it into Prometheus',
        hint: 'Alert on the same signal you used to see the impact: the share of user requests that failed, not a health probe.',
        hint2: 'Edit the `expr:` of the alert in rules/beacon.yaml to a 5xx ratio on route="/status" from the load balancer, then POST /-/reload.',
        reveal: function (c) {
          return st(c).variant === 'b'
            ? "sed -i 's/job=\"beacon\"/job=\"beacon-api\"/g' rules/beacon.yaml && " + RELOAD
            : "sed -i '/- alert:/,/for:/s|^        expr: .*|        expr: " + S21_FIX_ALERT + "|' rules/beacon.yaml && " + RELOAD;
        },
        done: function (c) { return s21Judge(c).alert; } },
      { id: 'nodata', stage: 'fix', text: 'Make sure the monitoring raises an alert when the series the paging alert depends on stop arriving',
        hint: 'A ratio of nothing is nothing, and "nothing" never crosses a threshold. What expression is true exactly when a series is missing?',
        hint2: 'Add a second alert using absent() on the selector your paging alert reads, with a short `for:`, and reload.',
        reveal: function (c) {
          var sel = st(c).variant === 'b' ? 'beacon_http_requests_total{job="beacon-api",path="/status"}' : 'lb_http_responses_total{route="/status"}';
          return "printf '      - alert: BeaconUserSignalMissing\\n        expr: absent(" + sel + ")\\n        for: 2m\\n        labels:\\n          severity: page\\n        annotations:\\n          summary: No data for the Beacon user-facing signal; treat as unknown, not healthy\\n' >> rules/beacon.yaml && " + RELOAD;
        },
        done: function (c) { return s21Judge(c).gap; } },
      { id: 'panel', stage: 'fix', text: 'Make the availability panel show the user-facing failure and never show missing data as healthy',
        hint: 'The panel has the same problem as the alert, plus a setting for what to show when the query returns nothing.',
        hint2: 'In dashboards/beacon.yaml change the Availability `expr:` to the load balancer success ratio on /status, and `noData: ok` to `noData: alerting` (or `nodata`).',
        reveal: "sed -i '/title: Availability/,/noData/s|^    expr: .*|    expr: " + S21_FIX_PANEL + "|; s|noData: ok|noData: alerting|' dashboards/beacon.yaml",
        done: function (c) { return s21Judge(c).panel; } },
      { id: 'replay', stage: 'verify', text: 'Replay the recorded write failure and show that on-call is paged',
        hint: 'Detection is proven by the failure, not by reading the rule.',
        hint2: '`faultctl replay write-errors` runs the recorded failure against the live stack and the loaded rules.',
        reveal: 'faultctl replay write-errors',
        done: function (c) { var r = st(c).replays.filter(function (x) { return x.kind === 'write-errors'; }).pop(); return !!r && r.detected && s21Judge(c).alert && lastIs(c, /faultctl\s+replay\s+write-errors/, /Result: DETECTED/); } },
      { id: 'gap', stage: 'verify', text: 'Replay the recorded telemetry gap and show that missing data raises an alert instead of reading as healthy',
        hint: 'The second recorded fault is the monitoring going blind.',
        hint2: '`faultctl replay scrape-gap`.',
        reveal: 'faultctl replay scrape-gap',
        done: function (c) { var r = st(c).replays.filter(function (x) { return x.kind === 'scrape-gap'; }).pop(); return !!r && r.detected && s21Judge(c).gap && lastIs(c, /faultctl\s+replay\s+scrape-gap/, /Result: DETECTED/); } }
    ],
    sre: {
      scenarioId: 'S21', moduleId: 'M11', lab: 'L21', variants: ['a', 'b', 'c'],
      symptom: 'Customers saw failed submissions for forty minutes; no page, dashboard green throughout.',
      neutralTitle: 'Customer-visible errors that monitoring did not show',
      neutralBrief: 'For about forty minutes this morning customers saw failed submissions to Beacon; support tickets, not monitoring, raised it, and the overview dashboard stayed green. Change the monitoring so this would be detected next time and cannot quietly go blind, and prove it.',
      impact: 'Roughly a third of sensor submissions failed for forty minutes and customers retried by hand; on-call learned about it from support.',
      changes: 'No deploy this morning. The alert and dashboard were written last quarter; the monitoring repo has a few small commits since.',
      spoilers: ['healthz', 'health check', 'job label', 'renamed', 'absent', 'up{', 'wrong path', 'no data'],
      tools: ['promql (stand-in query box)', 'promtool check rules|check config|query instant', 'curl to http://prometheus:9090 and http://alertmanager:9093', 'amtool', 'dashctl render', 'faultctl list|replay', 'git log|diff|status', 'cat/grep/sed -i/printf >>/edit'],
      grammar: ['`promql [--time HH:MM] \'QUERY\'` — PromQL subset (see `promql --help`); `promtool query instant http://prometheus:9090 \'QUERY\'`', '`curl -s \'http://prometheus:9090/api/v1/query?query=…&time=…\'` (or `--data-urlencode \'query=…\'`), `/api/v1/targets`, `/api/v1/rules`, `/api/v1/alerts`, `curl -X POST http://prometheus:9090/-/reload`', '`promtool check rules rules/beacon.yaml`, `amtool alert`, `amtool silence add|query|expire`, `amtool config routes test severity=page`', '`dashctl render beacon [--time HH:MM]`, `faultctl list`, `faultctl replay write-errors|scrape-gap`', '`git log --oneline`, `git diff`, `cat`, `grep`, `sed -i`, `printf … >> FILE`'],
      palette: ['dashctl render beacon --time 09:00', 'promql --time 09:00 \'sum by (route, code) (rate(lb_http_responses_total[5m]))\'', 'cat rules/beacon.yaml', 'cat dashboards/beacon.yaml', 'git log --oneline', 'curl -s http://prometheus:9090/api/v1/targets', 'promtool check rules rules/beacon.yaml', RELOAD, 'faultctl list'],
      assumptions: ['The load balancer sees every user request; its counters are the closest thing to the user in this lab.', 'The failure itself (one backend rejecting writes) was mitigated at 09:20; this ticket is about detection.', 'Alertmanager routes severity="page" to the pager and everything else to tickets.'],
      simplified: ['Series are computed from the scenario state at any instant (traffic per backend over the logical clock); there is no TSDB, no scrape jitter, and rate() divides the plain difference by the window instead of extrapolating as Prometheus does.', 'The PromQL subset is listed in `promql --help`; subqueries, offset, *_over_time and group_left are not modelled.', 'Dashboards are a small YAML stand-in for a Grafana panel; `noData` mirrors Grafana\'s "no data" display/alert state setting.', 'faultctl replays run ten minutes of logical time in one command; the scrape-gap replay removes exactly the series your paging alert reads, which is what a renamed job or dropped metric does to it.', 'Each command advances the clock 10 seconds.'],
      unsafe: [
        { label: 'silenced the alerts instead of fixing what they measure', why: 'A silence hides every notification that matches it, including the real outage the monitoring exists to catch; the problem here is what the alert measures, not that it is noisy.',
          test: silenceTest, demo: SILENCE_DEMO },
        { label: 'removed the paging alert', why: 'With no paging rule loaded nothing can page on-call; a blind spot became total blindness.',
          test: function (c) { var s = st(c), L = s.loadedRules(), am = s.loadedAm(); return !L.alerts.some(function (r) { var lab = Object.assign({}, r.labels, { alertname: r.name }); return isPager(am, routeAlert(am, lab)); }); },
          demo: ["sed -i '/- alert:/,$d' rules/beacon.yaml", RELOAD] },
        { label: 'made missing data read as healthy', why: 'Appending `or vector(…)` (or showing no data as OK) turns "we have no idea" into a good number; the scrape gap would read as perfect availability.',
          test: function (c) { var s = st(c); return s.loadedRules().alerts.some(function (r) { return noDataAsHealthy(r.expr); }) || panelsOf(SIM().readFile(c.w, '/srv/monitoring/dashboards/beacon.yaml') || '').panels.some(function (p) { return noDataAsHealthy(p.expr); }); },
          demo: "sed -i 's|^\\(    expr: .*\\)$|\\1 or vector(1)|' dashboards/beacon.yaml" }
      ],
      alt: function (v) {
        if (v === 'b') return ['curl -s http://prometheus:9090/api/v1/query --data-urlencode \'query=sum(increase(lb_http_responses_total{route="/status",code=~"5.."}[1h]))\'', 'git log --oneline', 'promql \'sum(rate(beacon_http_requests_total{job="beacon",path="/status"}[5m]))\'', 'curl -s http://prometheus:9090/api/v1/targets',
          "sed -i '/- alert:/,/for:/s|^        expr: .*|        expr: " + S21_FIX_ALERT + "|' rules/beacon.yaml",
          "printf '      - alert: BeaconLoadBalancerSignalMissing\\n        expr: absent(lb_http_responses_total{route=\"/status\"})\\n        for: 3m\\n        labels:\\n          severity: page\\n' >> rules/beacon.yaml",
          'promtool check rules rules/beacon.yaml', 'systemctl reload prometheus',
          "sed -i '/title: Availability/,/noData/s|^    expr: .*|    expr: " + S21_FIX_PANEL + "|; s|noData: ok|noData: nodata|' dashboards/beacon.yaml",
          'dashctl render beacon --time 09:00', 'faultctl replay scrape-gap', 'faultctl replay write-errors'];
        return ['promql --time 09:00 \'sum by (instance) (rate(beacon_http_requests_total{path="/status",code=~"5.."}[5m]))\'', 'cat rules/beacon.yaml',
          v === 'a' ? 'promql --time 09:00 \'sum(rate(beacon_http_requests_total{job="beacon-api",path="/healthz"}[5m]))\'' : 'promql --time 09:00 \'avg(up{job="beacon-api"})\'',
          "sed -i '/- alert:/,/for:/s|^        expr: .*|        expr: sum(rate(beacon_http_requests_total{job=\"beacon-api\",path=\"/status\",code=~\"5..\"}[5m])) / sum(rate(beacon_http_requests_total{job=\"beacon-api\",path=\"/status\"}[5m])) > 0.02|' rules/beacon.yaml",
          "printf '  - name: beacon-telemetry\\n    rules:\\n      - alert: BeaconStatusSeriesMissing\\n        expr: absent(beacon_http_requests_total{job=\"beacon-api\",path=\"/status\"})\\n        for: 5m\\n        labels:\\n          severity: page\\n' >> rules/beacon.yaml",
          'promtool check rules rules/beacon.yaml', RELOAD,
          "sed -i '/title: Availability/,/noData/s|^    expr: .*|    expr: sum(rate(beacon_http_requests_total{job=\"beacon-api\",path=\"/status\",code!~\"5..\"}[5m])) / sum(rate(beacon_http_requests_total{job=\"beacon-api\",path=\"/status\"}[5m]))|; s|noData: ok|noData: alerting|' dashboards/beacon.yaml",
          'faultctl replay write-errors', 'faultctl replay scrape-gap']; },
      mechanism: 'The dashboard and the paging alert measured something other than what users experienced. In one variant they computed availability from `/healthz` requests, which kept answering 200 while the backend rejected every write; in another they selected `job="beacon"` after the scrape job had been renamed to `beacon-api`, so the query returned **no data** — and no data never crosses a threshold, while the panel was configured to show no data as OK; in the third they alerted on `up`, which only says the process answers a scrape. A user-impact signal is the ratio of failed user requests on the user path (5xx on `POST /status` at the load balancer, or at the backends with the correct job), alerted with a short `for:`. Because a ratio over missing series is silently empty, the fix also needs an `absent()` alert on exactly that selector (an `up == 0` alert does not catch a renamed job or dropped metric), and a panel that shows missing data as a problem. Replaying the recorded failure proves detection; reading the rule does not.',
      alternatives: [
        { h: 'Prometheus or the exporters were down', out: 'Ruled out: every target is up and the load balancer counters show the 503s clearly for the whole window.' },
        { h: 'Raise the alert sensitivity on the existing query', out: 'Rejected: a more sensitive health-probe, `up` or wrong-job query still measures nothing users do.' },
        { h: 'Alert on the backend logs instead', out: 'Possible, but the load balancer already counts every user request and status; logs are better for explaining a failure than for detecting it.' }
      ],
      clues: ['The p99 latency panel looks fine too: failed writes were fast. Latency alone would not have caught this either.'],
      passRubric: ['Names the user-impact signal (numerator, denominator, where it is measured) and why it is closer to users than the old one', 'Explains why the old alert and panel stayed green during the failure', 'Explains why no data must not read as healthy, and what absent() catches that up == 0 does not', 'Proves detection by replaying the failure rather than by reading the rule'],
      prereqs: ['les-m11-02', 'les-m11-05'], refs: ['T14', 'T01', 'T07']
    }
  });

  /* ═══ S22 · Team receives noisy pages ══════════════════════════════ */
  var DAYM = 1200;   /* requests per minute in the daytime (20 rps) */
  function minutes(spec) { var out = []; spec.forEach(function (sg) { for (var i = 0; i < sg[0]; i++) out.push([sg[1], sg[2]]); }); return out; }
  var S22_CASES = {
    spike: { name: 'a short spike does not page', mins: minutes([[420, DAYM, 0], [4, DAYM, 180], [86, DAYM, 0]]), evals: [['7h2m', false], ['7h8m', false], ['7h20m', false]] },
    burn: { name: 'a sustained burn pages, and the page clears after recovery', mins: minutes([[360, DAYM, 0], [90, DAYM, 36], [60, DAYM, 0]]), evals: [['6h45m', true], ['8h', false]], window: [360, 450] },
    flap: { name: 'an intermittent outage still pages', mins: (function () { var m = minutes([[360, DAYM, 0]]); for (var i = 0; i < 24; i++) m = m.concat(minutes([[4, DAYM, 36], [1, DAYM, 0]])); return m.concat(minutes([[30, DAYM, 0]])); })(), evals: [['7h', true]], window: [360, 480] },
    night: { name: 'one failed request at night does not page', mins: (function () { var m = minutes([[240, 8, 0], [20, 0, 0], [40, 8, 0]]); m = m.concat(minutes([[1, 8, 1], [59, 8, 0], [1, 8, 1], [89, 8, 0], [1, 8, 1], [89, 8, 0]])); return m; })(), evals: [['5h1m', false], ['6h1m', false], ['7h31m', false]] }
  };
  function caseList(v) { return v === 'b' ? ['spike', 'burn', 'flap', 'night'] : ['spike', 'burn', 'flap']; }
  function caseSeries(cs) {
    var ok = cs.mins.map(function (x) { return x[0] - x[1]; }), bad = cs.mins.map(function (x) { return x[1]; });
    return [sampled({ __name__: 'beacon_http_requests_total', job: 'beacon-api', code: '201' }, counterVals(ok), 60),
      sampled({ __name__: 'beacon_http_requests_total', job: 'beacon-api', code: '503' }, counterVals(bad), 60)];
  }
  function s22TestText(v) {
    var out = ['# Unit tests for the Beacon paging rule (written after the September outage review).', '# Run: promtool test rules tests/beacon-slo.test.yaml', 'rule_files:', '  - ../rules/beacon-slo.yaml', 'evaluation_interval: 1m', 'tests:'];
    caseList(v).forEach(function (k) {
      var cs = S22_CASES[k];
      out.push('  - name: ' + cs.name, '    interval: 1m', '    input_series:',
        '      - series: \'beacon_http_requests_total{job="beacon-api",code="201"}\'', '        values: \'' + notation(cs.mins.map(function (x) { return x[0] - x[1]; })) + '\'',
        '      - series: \'beacon_http_requests_total{job="beacon-api",code="503"}\'', '        values: \'' + notation(cs.mins.map(function (x) { return x[1]; })) + '\'',
        '    alert_rule_test:');
      cs.evals.forEach(function (e) {
        out.push('      - eval_time: ' + e[0], '        alertname: BeaconHighErrorRate');
        if (e[1]) out.push('        exp_alerts:', '          - exp_labels:', '              severity: page');
        else out.push('        exp_alerts: []');
      });
    });
    return out.join('\n') + '\n';
  }
  var S22_REC = ['5m', '30m', '1h', '6h'].map(function (wd) { return '      - record: beacon:error_ratio:rate' + wd + '\n        expr: sum(rate(beacon_http_requests_total{code=~"5.."}[' + wd + '])) / sum(rate(beacon_http_requests_total[' + wd + ']))'; }).join('\n');
  var S22_EXPR = {
    a: 'sum(rate(beacon_http_requests_total{code=~"5.."}[1m])) > 0.01',
    b: 'sum(rate(beacon_http_requests_total{code=~"5.."}[1m])) / sum(rate(beacon_http_requests_total[1m])) > 0.01'
  };
  function s22RulesText(v) {
    return '# Beacon SLO rules. The recording rules feed the SLO dashboard; the alert pages on-call.\ngroups:\n  - name: beacon-slo-recording\n    rules:\n' + S22_REC + '\n  - name: beacon-paging\n    rules:\n      - alert: BeaconHighErrorRate\n        expr: ' + S22_EXPR[v] + '\n        for: 0m\n        labels:\n          severity: page\n        annotations:\n          summary: Beacon is returning 5xx responses\n';
  }
  /* last night: a = steady day traffic with three short spikes; b = a quiet
     night (8 requests/minute, one maintenance window with none) with single
     failures, then the morning ramp */
  function s22History(v) {
    var m;
    if (v === 'a') m = minutes([[47, DAYM, 0], [2, DAYM, 120], [85, DAYM, 0], [3, DAYM, 180], [104, DAYM, 0], [3, DAYM, 150], [97, DAYM, 0], [2, DAYM, 240], [135, DAYM, 0], [4, DAYM, 180], [118, DAYM, 0]]);
    else {
      m = minutes([[360, 8, 0]]);
      [72, 117, 160, 202, 271, 308].forEach(function (i) { m[i] = [8, 1]; });
      for (var z = 220; z < 240; z++) m[z] = [0, 0];
      m = m.concat(minutes([[240, DAYM, 0]]));
    }
    return caseSeries({ mins: m });
  }
  var S22_NOW = 9 * 3600;
  function s22Judge(rules, am, v, memo) {
    var key = rules.text + '\u0003' + JSON.stringify(am.route || null) + v;
    if (memo[key]) return memo[key];
    var out = { ok: !rules.errors.length, fails: [], pagesOutage: true };
    caseList(v).forEach(function (k) {
      var cs = S22_CASES[k], series = caseSeries(cs);
      cs.evals.forEach(function (e) {
        var paged = firingAt(rules, series, parseDur(e[0]), 60).some(function (a) { return isPager(am, routeAlert(am, a.labels)); });
        if (paged !== e[1]) { out.ok = false; out.fails.push(cs.name + ' @' + e[0]); }
      });
      if (cs.window && !stepAlerts(rules, series, cs.window[0] * 60, cs.window[1] * 60, 60, am).firstPage) out.pagesOutage = false;
    });
    var pageAlerts = rules.alerts.filter(function (r) { return isPager(am, routeAlert(am, Object.assign({}, r.labels, { alertname: r.name }))); });
    out.hasFor = pageAlerts.length > 0 && pageAlerts.every(function (r) { return r.forSec >= 60; });
    memo[key] = out;
    return out;
  }
  var S22_FIX = '(beacon:error_ratio:rate1h > (14.4 * 0.001) and beacon:error_ratio:rate5m > (14.4 * 0.001)) or (beacon:error_ratio:rate6h > (6 * 0.001) and beacon:error_ratio:rate30m > (6 * 0.001))';
  var S22_ALT = '(sum(rate(beacon_http_requests_total{code=~"5.."}[1h])) / sum(rate(beacon_http_requests_total[1h])) > 0.0144 and sum(rate(beacon_http_requests_total{code=~"5.."}[5m])) / sum(rate(beacon_http_requests_total[5m])) > 0.0144) or (sum(rate(beacon_http_requests_total{code=~"5.."}[6h])) / sum(rate(beacon_http_requests_total[6h])) > 0.006 and sum(rate(beacon_http_requests_total{code=~"5.."}[30m])) / sum(rate(beacon_http_requests_total[30m])) > 0.006)';

  LX.missions.push({
    id: 'sre-s22', track: 'sre', cat: 'scenario', level: 'intermediate', mins: 30, kind: 'incident',
    title: 'On-call was paged again and again last night, and every page cleared by itself',
    brief: function (seed) { return 'The Beacon on-call engineer was paged repeatedly overnight. Each page resolved within a few minutes, and nobody found anything to fix. The team wants a page to mean "users are losing the SLO fast enough that it cannot wait until morning", without missing a real outage. The paging rule, its unit tests, the SLO and the notification history are in /srv/monitoring. Change the rule, prove it with the tests, and deploy it.'; },
    keys: ['tail -n 20 /var/log/alertmanager/notifications.log', 'promtool test rules tests/beacon-slo.test.yaml', 'cat rules/beacon-slo.yaml', 'cat slo.yaml', 'promql \'beacon:error_ratio:rate1h\'', 'amtool config routes test severity=page', RELOAD],
    world: function (seed) {
      var S = SIM(), v = S.variantOf(seed, ['a', 'b']), memo = {};
      var state = { clock: 0, risky: [], seed: seed, variant: v, hooks: [], flags: {} };
      state.now = function () { return S22_NOW + state.clock; };
      var rulesText = s22RulesText(v);
      var files = [
        { path: 'prometheus.yml', content: '# Prometheus for the Beacon lab stack\nglobal:\n  evaluation_interval: 1m\nrule_files:\n  - rules/*.yaml\nscrape_configs:\n  - job_name: beacon-api\n    static_configs:\n      - targets: [\'beacon-1:8080\', \'beacon-2:8080\']\n' },
        { path: 'rules/beacon-slo.yaml', content: rulesText },
        { path: 'alertmanager.yml', content: ALERTMANAGER_YML },
        { path: 'tests/beacon-slo.test.yaml', content: s22TestText(v) },
        { path: 'slo.yaml', content: '# Beacon availability SLO\nservice: beacon-api\nobjective: 99.9          # percent of requests answered without a 5xx\nwindow: 30d\nsli:\n  bad: beacon_http_requests_total{code=~"5.."}\n  total: beacon_http_requests_total\n# error budget = 0.1% of requests over 30 days (about 43 minutes of total outage)\n' },
        { path: 'runbooks/paging-policy.md', content: '# Paging policy\n\nA page wakes someone up. Page only when users are losing the SLO fast enough that waiting until working hours would spend a meaningful share of the month\'s error budget. Everything slower is a ticket.\n\nA page must also stop by itself soon after users stop failing, and must still fire for an outage that comes and goes.\n' }
      ];
      initProm(state, files, 3600 * 0 + 41 * 60 + 5);
      var history = s22History(v);
      /* the notification history is what the ORIGINAL rule did over last night */
      var orig = mergeRules([{ path: 'rules/beacon-slo.yaml', text: rulesText }]), am0 = loadAm(ALERTMANAGER_YML);
      var hist = stepAlerts(orig, history, 0, S22_NOW - 60, 60, am0, { timeline: true });
      var log = ['# Alertmanager notification history (exported ' + iso(S22_NOW) + '), newest last'];
      hist.events.forEach(function (e) {
        if (e.state !== 'firing' && e.state !== 'resolved') return;
        var rc = routeAlert(am0, e.a.labels);
        log.push(iso(e.t) + ' notify receiver=' + rc + ' status=' + e.state + ' alertname=' + e.a.labels.alertname + ' severity=' + (e.a.labels.severity || ''));
      });
      var stack = promStack(state, null, { dir: '/srv/monitoring', series: function () { return history; },
        onQuery: function (info) {
          if (info.ctx.sels.some(function (n) { return /^beacon:error_ratio:/.test(n.name || '') || (n.name === 'beacon_http_requests_total' && fiveXX(n)); })) state.flags.burn = true;
        },
        testRules: function (w, file) {
          var text = S.readFile(w, file);
          if (text == null) return fail('Unit Testing:  ' + file + '\n  FAILED:\n    open ' + file + ': no such file or directory', 1);
          var y = yParse(text);
          if (y.error) return fail('Unit Testing:  ' + file + '\n  FAILED:\n    ' + y.error, 1);
          var doc = y.value || {}, dir = file.indexOf('/') === -1 ? '.' : file.slice(0, file.lastIndexOf('/'));
          var rf = (Array.isArray(doc.rule_files) ? doc.rule_files : []).map(function (p) { var abs = LXShell.resolve(w, (p.charAt(0) === '/' ? '' : dir + '/') + p); return { path: p, text: S.readFile(w, abs) }; });
          var missing = rf.filter(function (f) { return f.text == null; })[0];
          if (missing) return fail('Unit Testing:  ' + file + '\n  FAILED:\n    open ' + missing.path + ': no such file or directory', 1);
          var rules = mergeRules(rf);
          if (rules.errors.length) return fail('Unit Testing:  ' + file + '\n  FAILED:\n    ' + rules.errors.join('\n    '), 1);
          var lines = [], ok = true;
          (Array.isArray(doc.tests) ? doc.tests : []).forEach(function (tc) {
            var step = parseDur(tc.interval || doc.evaluation_interval || '1m'), series;
            try { series = (tc.input_series || []).map(function (is) { return seriesFromSpec(is.series, expandValues(is.values), step); }); }
            catch (e) { ok = false; lines.push('    name: ' + tc.name + ',\n    ' + e.message); return; }
            (tc.alert_rule_test || []).forEach(function (art) {
              var T = parseDur(String(art.eval_time)), got = firingAt(rules, series, T, step).filter(function (a) { return a.labels.alertname === art.alertname; });
              var exp = (Array.isArray(art.exp_alerts) ? art.exp_alerts : []).map(function (x) { var l = strMap(x && x.exp_labels); l.alertname = art.alertname; return lkey(l); }).sort();
              var gotK = got.map(function (a) { return lkey(a.labels); }).sort();
              if (exp.join('|') !== gotK.join('|')) {
                ok = false;
                lines.push('    name: ' + tc.name + ',\n    alertname: ' + art.alertname + ', time: ' + art.eval_time + ', \n        exp:[' + exp.map(function (k, i) { return '\n            ' + i + ':\n              Labels:{' + k.split(',').map(function (kv) { var i2 = kv.indexOf('='); return kv.slice(0, i2) + '="' + kv.slice(i2 + 1) + '"'; }).join(', ') + '}'; }).join('') + (exp.length ? '\n            ' : '') + '], \n        got:[' + got.map(function (a, i) { return '\n            ' + i + ':\n              Labels:' + fmtLabels(a.labels) + '\n              Annotations:{summary="' + (a.rule.annotations.summary || '') + '"}'; }).join('') + (got.length ? '\n            ' : '') + ']');
              }
            });
          });
          var head = 'Unit Testing:  ' + file + '\n';
          return ok ? res(head + '  SUCCESS') : { out: head + '  FAILED:\n' + lines.join('\n') + '\n', code: 1 };
        } });
      state.judge = function (rules, am) { return s22Judge(rules, am, v, memo); };
      var verbs = Object.assign({}, stack, { edit: S.verbs.edit() });
      return { user: 'lab', host: 'ops-console', cwd: '/srv/monitoring',
        dirs: [{ path: '/srv/monitoring/rules' }, { path: '/srv/monitoring/tests' }, { path: '/srv/monitoring/runbooks' }, { path: '/var/log/alertmanager' }],
        files: files.map(function (f) { return { path: '/srv/monitoring/' + f.path, content: f.content }; }).concat([{ path: '/var/log/alertmanager/notifications.log', content: log.join('\n') + '\n' }]),
        sre: state, extra: S.bind(state, verbs) };
    },
    objectives: [
      { id: 'pages', stage: 'evidence', text: 'Read last night\'s notification history: how many pages, and how long did each last?',
        hint: 'A page that resolves itself in a minute or two is a measurement problem until proven otherwise.',
        hint2: 'The exported history is /var/log/alertmanager/notifications.log; compare each firing line with its resolved line.',
        reveal: 'tail -n 20 /var/log/alertmanager/notifications.log',
        done: function (c) { return saw(c, /(cat|tail|head|grep|less)\b.*notifications\.log/, /status=firing[\s\S]*status=resolved/); } },
      { id: 'tests', stage: 'evidence', text: 'Run the team\'s rule tests against the current rule and see which expectations it breaks',
        hint: 'The team already wrote down what a good page rule must do. Does the current one do it?',
        hint2: '`promtool test rules tests/beacon-slo.test.yaml` — read the FAILED case names.',
        reveal: 'promtool test rules tests/beacon-slo.test.yaml',
        done: function (c) { return saw(c, /promtool\s+test\s+rules/, /FAILED:[\s\S]*BeaconHighErrorRate/); } },
      { id: 'budget', stage: 'evidence', text: 'Find the SLO the page protects, and look at how fast the error budget was actually burning',
        hint: 'A threshold means nothing until you compare it with the budget: how much of the month did those minutes cost?',
        hint2: '`cat slo.yaml`, then query the error-ratio recording rules (beacon:error_ratio:rate5m … rate6h) that already exist.',
        reveal: 'cat slo.yaml; promql \'beacon:error_ratio:rate1h\'',
        done: function (c) { return saw(c, /(cat|grep|less|head)\b.*slo\.yaml/, /objective:\s*99\.9/) && !!st(c).flags.burn; } },
      { id: 'rule', stage: 'fix', text: 'Rewrite the paging rule so it pages on sustained error-budget burn, keeps catching real outages, clears soon after recovery, and holds for at least a minute',
        hint: 'One window cannot do it: a long window ignores blips but stays red long after recovery; a short window does the opposite. Require both.',
        hint2: 'Multi-window, multi-burn-rate: page when the 1h AND 5m error ratios exceed 14.4 × the budget (0.1%), OR the 6h AND 30m ratios exceed 6 ×; `for: 2m`. The recording rules already compute those ratios.',
        reveal: "sed -i '/alert: BeaconHighErrorRate/,/for:/s|^        expr: .*|        expr: " + S22_FIX + "|; /alert: BeaconHighErrorRate/,/for:/s|^        for: .*|        for: 2m|' rules/beacon-slo.yaml",
        done: function (c) { var s = st(c), j = s.judge(s.diskRules(c.w), s.loadedAm()); return j.ok && j.hasFor; } },
      { id: 'deploy', stage: 'fix', text: 'Load the new rule into Prometheus, with the page route still in place',
        hint: 'Editing the file changes nothing until Prometheus reloads it.',
        hint2: '`curl -X POST http://prometheus:9090/-/reload` (or `systemctl reload prometheus`); `amtool config routes test severity=page` shows where a page goes.',
        reveal: RELOAD,
        done: function (c) { var s = st(c), j = s.judge(s.loadedRules(), s.loadedAm()); return j.ok && j.hasFor; } },
      { id: 'verify', stage: 'verify', text: 'Prove it: the team\'s rule tests pass against the deployed rule',
        hint: 'The tests encode both halves: the noise is gone and real outages still page.',
        hint2: '`promtool test rules tests/beacon-slo.test.yaml` should print SUCCESS.',
        reveal: 'promtool test rules tests/beacon-slo.test.yaml',
        done: function (c) { var s = st(c), j = s.judge(s.loadedRules(), s.loadedAm()), d = s.judge(s.diskRules(c.w), s.loadedAm()); return j.ok && d.ok && lastIs(c, /promtool\s+test\s+rules/, /SUCCESS/); } }
    ],
    sre: {
      scenarioId: 'S22', moduleId: 'M11', lab: 'L22', variants: ['a', 'b'],
      symptom: 'Repeated pages that resolve themselves within minutes; nothing actionable found.',
      neutralTitle: 'Pages that resolve themselves before anyone can act',
      neutralBrief: 'The Beacon on-call engineer was paged repeatedly overnight; every page resolved by itself within minutes. Make a page mean real, sustained user impact without missing a real outage, prove it with the team\'s rule tests, and deploy it.',
      impact: 'On-call fatigue: pages are being ignored, which is how a real outage gets missed.',
      changes: 'None to the service. The paging rule was written in a hurry after an outage last quarter.',
      spoilers: ['burn rate', 'multi-window', 'instantaneous', '14.4', 'low traffic', 'threshold too low', 'for: 0m'],
      tools: ['promtool test rules|check rules|query instant', 'promql (stand-in query box)', 'curl to http://prometheus:9090 and http://alertmanager:9093', 'amtool', 'cat/grep/tail/sed -i/printf >>/edit'],
      grammar: ['`promtool test rules tests/beacon-slo.test.yaml` — real input-series notation (a+bxn, axn, _), alert_rule_test with exp_alerts/exp_labels', '`promtool check rules rules/beacon-slo.yaml`', '`promql [--time HH:MM] \'QUERY\'` over last night\'s history; recording rules resolve by name', '`curl -X POST http://prometheus:9090/-/reload`, `curl -X POST http://alertmanager:9093/-/reload`, `systemctl reload prometheus|alertmanager`', '`amtool config routes test severity=page`, `amtool alert`, `amtool silence add|query|expire`'],
      palette: ['tail -n 20 /var/log/alertmanager/notifications.log', 'promtool test rules tests/beacon-slo.test.yaml', 'cat rules/beacon-slo.yaml', 'cat slo.yaml', 'cat runbooks/paging-policy.md', 'promql --time 02:16 \'beacon:error_ratio:rate5m\'', 'promql \'beacon:error_ratio:rate6h\'', 'amtool config routes test severity=page', RELOAD],
      assumptions: ['The SLO is 99.9% of requests without a 5xx over 30 days; the budget is 0.1%.', 'The team\'s tests encode the policy: no page for a four-minute spike, a page within the hour for a sustained or intermittent 3% failure, and the page clears within half an hour of recovery.'],
      simplified: ['Evaluation runs at one-minute steps over per-minute fixtures; rate() is the plain difference over the window (no extrapolation), so ratios are exact.', 'Recording rules are evaluated on demand at each step rather than stored, which gives the same values a real rule evaluation would at that step.', 'promtool test compares alert label sets at each eval_time; annotations are printed but not compared.', 'Each command advances the clock 10 seconds.'],
      unsafe: [
        { label: 'deployed a rule that no longer pages for a real outage', why: 'Raising the threshold (or widening `for:`) until the noise stops also stops the page for a sustained 3% failure; the noise problem became a missed-outage problem.',
          test: function (c) { var s = st(c), L = s.loadedRules(); if (L.text === s.loadedRules0) return false; return !s.judge(L, s.loadedAm()).pagesOutage; },
          demo: ["sed -i 's/> 0.01/> 5/' rules/beacon-slo.yaml", RELOAD] },
        { label: 'removed the route that pages on-call', why: 'Deleting or redirecting the severity="page" route turns every page into a ticket, including a real outage at 3 a.m.',
          test: function (c) { var am = st(c).loadedAm(); return !isPager(am, routeAlert(am, { alertname: 'BeaconHighErrorRate', severity: 'page' })); },
          demo: ["sed -i '/- receiver: beacon-oncall-pager/,/severity=\"page\"/d' alertmanager.yml", 'curl -s -X POST http://alertmanager:9093/-/reload'] },
        { label: 'silenced the paging alert', why: 'A silence hides the next real outage as well as the noise.',
          test: silenceTest, demo: 'amtool silence add alertname=BeaconHighErrorRate --duration=7d --comment="too noisy"' }
      ],
      alt: function (v) {
        return ['grep -c status=firing /var/log/alertmanager/notifications.log', 'cat /var/log/alertmanager/notifications.log', 'cat runbooks/paging-policy.md', 'promtool test rules tests/beacon-slo.test.yaml', 'cat slo.yaml',
          v === 'b' ? 'promql --time 01:12 \'sum(rate(beacon_http_requests_total{code=~"5.."}[1h])) / sum(rate(beacon_http_requests_total[1h]))\'' : 'promql --time 07:59 \'beacon:error_ratio:rate5m\'',
          "sed -i '/- alert: BeaconHighErrorRate/,$d' rules/beacon-slo.yaml",
          "printf '      - alert: BeaconErrorBudgetBurn\\n        expr: " + S22_ALT + "\\n        for: 1m\\n        labels:\\n          severity: page\\n        annotations:\\n          summary: Beacon is burning its error budget fast enough to page\\n' >> rules/beacon-slo.yaml",
          "sed -i 's/alertname: BeaconHighErrorRate/alertname: BeaconErrorBudgetBurn/' tests/beacon-slo.test.yaml",
          'promtool check rules rules/beacon-slo.yaml', 'promtool test rules tests/beacon-slo.test.yaml', 'systemctl reload prometheus', 'amtool config routes test severity=page', 'promtool test rules tests/beacon-slo.test.yaml'];
      },
      mechanism: 'The paging rule compared a one-minute error rate (variant a: absolute errors per second; variant b: a one-minute error ratio) with a tiny threshold and `for: 0m`. Any blip paged and cleared a minute later; at night, with a handful of requests per minute, one failed request was a 12% "error ratio" for one minute, and minutes with no traffic at all are 0/0 = NaN, so the rule flapped between firing and no data. A page should mean the **error budget** is burning fast: with a 99.9% SLO the budget is 0.1%, and a burn rate of 14.4 spends 2% of a 30-day budget in an hour. The multi-window, multi-burn-rate rule pages when the 1h **and** 5m ratios exceed 14.4 × 0.1% (or 6h and 30m exceed 6 ×): the long window ignores short spikes and lone night-time failures, the short window lets the page clear minutes after recovery and makes it fire again during an intermittent outage. Raising the threshold instead would also silence the real outage, which the tests and the deployed-rule check catch.',
      alternatives: [
        { h: 'Raise the threshold', out: 'Rejected: a threshold high enough to ignore spikes ignores the sustained 3% burn the tests require to page.' },
        { h: 'Keep the 1m rule and add for: 10m', out: 'Rejected: an outage that dips for one minute out of five never satisfies the `for:` and never pages; the intermittent-outage test catches it.' },
        { h: 'One long window only (1h)', out: 'Rejected: the page stays red for most of an hour after recovery; the "clears after recovery" expectation catches it.' }
      ],
      clues: ['The recording rules for 5m/30m/1h/6h error ratios already exist for the SLO dashboard; nothing pages on them.'],
      passRubric: ['States the SLO, the budget and what burn rate a page threshold represents', 'Explains why each window pair needs a long and a short window', 'Explains why low traffic makes a short error ratio jumpy and why 0/0 is NaN, not zero', 'Shows the tests pass and the deployed rule still pages for a real outage'],
      prereqs: ['les-m11-04', 'les-m11-05'], refs: ['T01', 'T14']
    }
  });
  /* remember what was loaded at birth, so the unsafe check only fires on a
     deployed change */
  (function () {
    var m = LX.missions[LX.missions.length - 1], world = m.world;
    m.world = function (seed) { var w = world(seed); w.sre.loadedRules0 = w.sre.loadedRules().text; return w; };
  })();
})();
