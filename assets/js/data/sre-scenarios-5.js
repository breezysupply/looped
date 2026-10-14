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
      ctx.recStack = ctx.recStack || [];
      /* a rule that reads its own output would read stored history, which this model does not keep */
      if (ctx.recStack.indexOf(n.name) !== -1 || ctx.recStack.length > 8) return { k: 'v', v: [] };
      ctx.recStack.push(n.name);
      var r;
      try { r = pqEval(ctx.rec[n.name], t, ctx); } finally { ctx.recStack.pop(); }
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
        hint: 'Editing the file changes nothing until Prometheus reloads it, and a reload is a production change: run the tests first.',
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

/* ═════════════════════ S23 · S24 — PostgreSQL model ═════════════════════
   A bounded SQL subset evaluated over materialised rows and catalog views:
   SELECT [DISTINCT] … FROM t [alias] [[LEFT] JOIN t2 ON …] [WHERE] [GROUP BY]
   [HAVING] [ORDER BY] [LIMIT]; scalar and IN (…) subqueries; = <> < > <= >=,
   IS [NOT] NULL, IS [NOT] DISTINCT FROM, [I]LIKE, IN, BETWEEN, AND/OR/NOT;
   ::regclass/::text/::int/::interval casts; timestamps and intervals; count/
   min/max/sum/avg; now(), left(), substr(), coalesce(), cardinality(),
   pg_blocking_pids(), pg_cancel_backend(), pg_terminate_backend(),
   pg_reload_conf(), current_setting(). DDL/DML: CREATE [UNIQUE] INDEX
   [CONCURRENTLY], DROP INDEX, CREATE TABLE, ALTER TABLE … ADD UNIQUE/PRIMARY
   KEY, DELETE [USING], INSERT … VALUES|SELECT [ON CONFLICT DO NOTHING],
   ALTER SYSTEM/ROLE/DATABASE … SET, SHOW, SET, EXPLAIN [ANALYZE], \d, \di,
   \dt. Anything else answers with an honest "not modelled" error. */
(function () {
  function SIM() { return window.LXSim; }
  function st(c) { return c.w.sre; }
  function saw(c, re, outRe) { return SIM().saw(c, re, outRe); }
  function lastIs(c, cmdRe, outRe) { return SIM().lastIs(c, cmdRe, outRe); }
  function res(out, code) {
    var r = { out: out == null ? '' : String(out), code: code || 0 };
    if (r.out && !/\n$/.test(r.out)) r.out += '\n';
    return r;
  }
  function fail(msg, code) { return { out: '', err: String(msg).replace(/\n?$/, '\n'), code: code == null ? 1 : code }; }
  function two(n) { return (n < 10 ? '0' : '') + n; }
  function rep(s, n) { var o = ''; while (n-- > 0) o += s; return o; }
  function hms(t) { t = Math.max(0, Math.floor(t)); return two(Math.floor(t / 3600) % 24) + ':' + two(Math.floor(t % 3600 / 60)) + ':' + two(t % 60); }
  function isoZ(t) { return '2026-10-13T' + hms(t) + 'Z'; }
  function tsStr(t) { return '2026-10-13 ' + hms(t) + '+00'; }

  /* ── values ── */
  function TS(t) { return { ts: t }; }
  function IV(s) { return { iv: s }; }
  function isTs(v) { return !!v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, 'ts'); }
  function isIv(v) { return !!v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, 'iv'); }
  function parseInterval(s) {
    s = String(s).trim().toLowerCase();
    var m, tot = 0, any = false;
    if ((m = /^(-)?(\d+):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/.exec(s))) return (m[1] ? -1 : 1) * (+m[2] * 3600 + +m[3] * 60 + +(m[4] || 0));
    var re = /(-?\d+(?:\.\d+)?)\s*(milliseconds?|ms|seconds?|secs?|s|minutes?|mins?|min|m|hours?|hrs?|h|days?|d)(?![a-z])/g;
    while ((m = re.exec(s))) { any = true; var u = m[2]; tot += +m[1] * (/^(ms|milli)/.test(u) ? 0.001 : /^s/.test(u) ? 1 : /^m/.test(u) ? 60 : /^h/.test(u) ? 3600 : 86400); }
    if (any) return tot;
    if (/^-?\d+(\.\d+)?$/.test(s)) return +s;
    return null;
  }
  function fmtIv(sec) {
    var neg = sec < 0; sec = Math.abs(sec);
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec - h * 3600 - m * 60;
    var ss = s % 1 ? s.toFixed(3) : String(s);
    return (neg ? '-' : '') + two(h) + ':' + two(m) + ':' + (s < 10 ? '0' : '') + ss;
  }
  function fmtVal(v) {
    if (v === null || v === undefined) return '';
    if (v === true) return 't';
    if (v === false) return 'f';
    if (Array.isArray(v)) return '{' + v.map(fmtVal).join(',') + '}';
    if (isTs(v)) return tsStr(v.ts);
    if (isIv(v)) return fmtIv(v.iv);
    if (typeof v === 'number') return String(Math.round(v * 1e6) / 1e6);
    return String(v);
  }
  function num(v) { return isTs(v) ? v.ts : isIv(v) ? v.iv : typeof v === 'boolean' ? (v ? 1 : 0) : v; }
  function cmpVals(a, b) {
    if (a === null || a === undefined || b === null || b === undefined) return null;
    var x = num(a), y = num(b);
    if (typeof x === 'number' && typeof y === 'string' && /^-?\d+(\.\d+)?$/.test(y)) y = Number(y);
    if (typeof y === 'number' && typeof x === 'string' && /^-?\d+(\.\d+)?$/.test(x)) x = Number(x);
    if (Array.isArray(x) || Array.isArray(y)) { x = fmtVal(x); y = fmtVal(y); }
    return x < y ? -1 : x > y ? 1 : 0;
  }

  /* ── lexer and parser ── */
  function sqlErr(msg, detail) { var e = new Error(msg); e.sql = true; e.detail = detail; return e; }
  var SQL_OPS = ['<>', '!=', '<=', '>=', '::', '||', '=', '<', '>', '(', ')', ',', '*', '.', '-', '+', '/', ';', '[', ']', '%'];
  function sqlLex(src) {
    var s = String(src), i = 0, out = [], m;
    while (i < s.length) {
      var r = s.slice(i), ch = r.charAt(0);
      if (/\s/.test(ch)) { i++; continue; }
      if (r.indexOf('--') === 0) { var nl = r.indexOf('\n'); i += nl === -1 ? r.length : nl; continue; }
      if (ch === "'") {
        var j = 1, v = '';
        for (;;) {
          if (j >= r.length) throw sqlErr('unterminated quoted string at or near "' + r.slice(0, 20) + '"');
          var c2 = r.charAt(j);
          if (c2 === "'") { if (r.charAt(j + 1) === "'") { v += "'"; j += 2; continue; } j++; break; }
          v += c2; j++;
        }
        out.push({ t: 'str', v: v }); i += j; continue;
      }
      if (ch === '"') { var k = r.indexOf('"', 1); if (k < 0) throw sqlErr('unterminated quoted identifier at or near "' + r.slice(0, 20) + '"'); out.push({ t: 'id', v: r.slice(1, k), q: true }); i += k + 1; continue; }
      if ((m = /^\$\d+/.exec(r))) { out.push({ t: 'param', v: m[0] }); i += m[0].length; continue; }
      if ((m = /^\d+(\.\d+)?/.exec(r))) { out.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue; }
      if ((m = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(r))) { out.push({ t: 'id', v: m[0].toLowerCase() }); i += m[0].length; continue; }
      var op = null;
      for (var o = 0; o < SQL_OPS.length; o++) if (r.indexOf(SQL_OPS[o]) === 0) { op = SQL_OPS[o]; break; }
      if (!op) throw sqlErr('syntax error at or near "' + ch + '"');
      out.push({ t: 'op', v: op }); i += op.length;
    }
    return out;
  }
  var RESERVED = ['select', 'from', 'where', 'group', 'order', 'by', 'having', 'limit', 'offset', 'join', 'left', 'inner', 'on', 'and', 'or', 'not', 'as', 'union', 'using', 'set', 'values', 'returning', 'into', 'desc', 'asc', 'is', 'in', 'like', 'ilike', 'between', 'null', 'distinct', 'nulls', 'outer', 'cross', 'right', 'full', 'when', 'then', 'else', 'end', 'case'];
  function Parser(toks) { this.toks = toks; this.p = 0; }
  Parser.prototype = {
    peek: function (o) { return this.toks[this.p + (o || 0)]; },
    isKw: function (k, o) { var t = this.peek(o); return !!t && t.t === 'id' && !t.q && t.v === k; },
    isOp: function (v, o) { var t = this.peek(o); return !!t && t.t === 'op' && t.v === v; },
    eatKw: function (k) { if (this.isKw(k)) { this.p++; return true; } return false; },
    eatOp: function (v) { if (this.isOp(v)) { this.p++; return true; } return false; },
    near: function () { var t = this.peek(); return t ? 'syntax error at or near "' + (t.t === 'str' ? "'" + t.v + "'" : t.v) + '"' : 'syntax error at end of input'; },
    expectKw: function (k) { if (!this.eatKw(k)) throw sqlErr(this.near()); },
    expectOp: function (v) { if (!this.eatOp(v)) throw sqlErr(this.near()); },
    ident: function () { var t = this.peek(); if (!t || t.t !== 'id' || (!t.q && RESERVED.indexOf(t.v) !== -1)) throw sqlErr(this.near()); this.p++; return t.v; },
    done: function () { this.eatOp(';'); if (this.p < this.toks.length) throw sqlErr(this.near()); },
    expr: function () { return this.or(); },
    or: function () { var l = this.and(); while (this.eatKw('or')) l = { k: 'or', a: l, b: this.and() }; return l; },
    and: function () { var l = this.not(); while (this.eatKw('and')) l = { k: 'and', a: l, b: this.not() }; return l; },
    not: function () { if (this.eatKw('not')) return { k: 'not', e: this.not() }; return this.cmp(); },
    cmp: function () {
      var l = this.add();
      for (;;) {
        var t = this.peek();
        if (t && t.t === 'op' && ['=', '<>', '!=', '<', '>', '<=', '>='].indexOf(t.v) !== -1) { this.p++; l = { k: 'cmp', op: t.v === '!=' ? '<>' : t.v, l: l, r: this.add() }; continue; }
        if (this.isKw('is')) {
          this.p++;
          var neg = this.eatKw('not');
          if (this.eatKw('null')) { l = { k: 'isnull', e: l, neg: neg }; continue; }
          if (this.eatKw('distinct')) { this.expectKw('from'); l = { k: 'distinct', l: l, r: this.add(), neg: neg }; continue; }
          if (this.isKw('true') || this.isKw('false')) { var tv = this.peek().v === 'true'; this.p++; l = { k: 'istrue', e: l, v: tv, neg: neg }; continue; }
          throw sqlErr(this.near());
        }
        var negp = false;
        if (this.isKw('not') && (this.isKw('like', 1) || this.isKw('ilike', 1) || this.isKw('in', 1) || this.isKw('between', 1))) { this.p++; negp = true; }
        if (this.isKw('like') || this.isKw('ilike')) { var ci = this.peek().v === 'ilike'; this.p++; l = { k: 'like', e: l, pat: this.add(), ci: ci, neg: negp }; continue; }
        if (this.eatKw('in')) {
          this.expectOp('(');
          if (this.isKw('select')) { var sq = this.select(); this.expectOp(')'); l = { k: 'in', e: l, sub: sq, neg: negp }; continue; }
          var list = [this.expr()];
          while (this.eatOp(',')) list.push(this.expr());
          this.expectOp(')');
          l = { k: 'in', e: l, list: list, neg: negp }; continue;
        }
        if (this.eatKw('between')) { var lo = this.add(); this.expectKw('and'); l = { k: 'between', e: l, lo: lo, hi: this.add(), neg: negp }; continue; }
        if (negp) throw sqlErr(this.near());
        return l;
      }
    },
    add: function () {
      var l = this.mul();
      for (;;) { var t = this.peek(); if (t && t.t === 'op' && (t.v === '+' || t.v === '-' || t.v === '||')) { this.p++; l = { k: 'arith', op: t.v, l: l, r: this.mul() }; } else return l; }
    },
    mul: function () {
      var l = this.unary();
      for (;;) { var t = this.peek(); if (t && t.t === 'op' && (t.v === '*' || t.v === '/' || t.v === '%')) { this.p++; l = { k: 'arith', op: t.v, l: l, r: this.unary() }; } else return l; }
    },
    unary: function () {
      if (this.eatOp('-')) return { k: 'arith', op: '-', l: { k: 'lit', v: 0 }, r: this.unary() };
      var e = this.primary();
      while (this.eatOp('::')) {
        var ty = this.ident();
        while (this.peek() && this.peek().t === 'id' && /^(with|without|time|zone|precision|varying)$/.test(this.peek().v)) this.p++;
        e = { k: 'cast', e: e, ty: ty };
      }
      return e;
    },
    primary: function () {
      var t = this.peek();
      if (!t) throw sqlErr('syntax error at end of input');
      if (t.t === 'num') { this.p++; return { k: 'lit', v: t.v }; }
      if (t.t === 'str') { this.p++; return { k: 'lit', v: t.v }; }
      if (t.t === 'param') { this.p++; return { k: 'param', v: t.v }; }
      if (this.isOp('(')) {
        this.p++;
        if (this.isKw('select')) { var sq = this.select(); this.expectOp(')'); return { k: 'sub', q: sq }; }
        var e = this.expr(); this.expectOp(')'); return e;
      }
      if (t.t === 'op') throw sqlErr(this.near());
      if (!t.q) {
        if (t.v === 'null') { this.p++; return { k: 'lit', v: null }; }
        if (t.v === 'true' || t.v === 'false') { this.p++; return { k: 'lit', v: t.v === 'true' }; }
        if (t.v === 'interval' && this.peek(1) && this.peek(1).t === 'str') { this.p += 2; var iv = parseInterval(this.toks[this.p - 1].v); if (iv == null) throw sqlErr('invalid input syntax for type interval: "' + this.toks[this.p - 1].v + '"'); return { k: 'lit', v: IV(iv) }; }
        if (t.v === 'current_timestamp' || t.v === 'localtimestamp') { this.p++; return { k: 'fn', f: 'now', args: [] }; }
        if (t.v === 'case' || t.v === 'array' || t.v === 'exists') throw sqlErr('"' + t.v.toUpperCase() + '" expressions are not modelled in this simulation');
      }
      if (this.isOp('(', 1) && t.t === 'id') {
        var f = t.v; this.p += 2;
        var fn = { k: 'fn', f: f, args: [] };
        if (this.eatOp('*')) fn.star = true;
        else if (!this.isOp(')')) { if (this.eatKw('distinct')) fn.distinct = true; fn.args.push(this.expr()); while (this.eatOp(',')) fn.args.push(this.expr()); }
        this.expectOp(')');
        return fn;
      }
      var a = this.ident();
      if (this.eatOp('.')) {
        if (this.eatOp('*')) return { k: 'star', t: a };
        var b = this.ident();
        if (this.eatOp('.')) return { k: 'col', t: b, c: this.ident() };
        return { k: 'col', t: a, c: b };
      }
      return { k: 'col', t: null, c: a };
    },
    tableRef: function () {
      var name = this.ident();
      if (this.eatOp('.')) name = this.ident();
      var alias = name;
      if (this.eatKw('as')) alias = this.ident();
      else if (this.peek() && this.peek().t === 'id' && (this.peek().q || RESERVED.indexOf(this.peek().v) === -1)) alias = this.ident();
      return { name: name, alias: alias };
    },
    select: function () {
      this.expectKw('select');
      var q = { k: 'select', distinct: this.eatKw('distinct'), items: [], joins: [] };
      do {
        if (this.eatOp('*')) { q.items.push({ star: true }); continue; }
        var e = this.expr(), alias = null;
        if (e.k === 'star') { q.items.push({ star: true, t: e.t }); continue; }
        if (this.eatKw('as')) alias = this.ident();
        else if (this.peek() && this.peek().t === 'id' && (this.peek().q || RESERVED.indexOf(this.peek().v) === -1)) alias = this.ident();
        q.items.push({ e: e, alias: alias });
      } while (this.eatOp(','));
      if (this.eatKw('from')) {
        q.from = this.tableRef();
        for (;;) {
          if (this.eatOp(',')) { q.joins.push({ ref: this.tableRef(), on: null, left: false }); continue; }
          var left = false;
          if (this.isKw('left')) { this.p++; this.eatKw('outer'); left = true; }
          else this.eatKw('inner');
          if (this.eatKw('join')) { var ref = this.tableRef(); this.expectKw('on'); q.joins.push({ ref: ref, on: this.expr(), left: left }); continue; }
          if (left) throw sqlErr(this.near());
          break;
        }
      }
      if (this.eatKw('where')) q.where = this.expr();
      if (this.isKw('group')) { this.p++; this.expectKw('by'); q.group = [this.expr()]; while (this.eatOp(',')) q.group.push(this.expr()); }
      if (this.eatKw('having')) q.having = this.expr();
      if (this.isKw('order')) {
        this.p++; this.expectKw('by'); q.order = [];
        do {
          var oe = this.expr(), desc = false;
          if (this.eatKw('desc')) desc = true; else this.eatKw('asc');
          if (this.eatKw('nulls')) { if (!this.eatKw('first')) this.expectKw('last'); }
          q.order.push({ e: oe, desc: desc });
        } while (this.eatOp(','));
      }
      if (this.eatKw('limit')) { var lt = this.peek(); if (!lt || lt.t !== 'num') throw sqlErr(this.near()); this.p++; q.limit = lt.v; }
      if (this.eatKw('offset')) { var ot = this.peek(); if (!ot || ot.t !== 'num') throw sqlErr(this.near()); this.p++; q.offset = ot.v; }
      return q;
    }
  };

  /* ── evaluation ── */
  var AGGS = ['count', 'min', 'max', 'sum', 'avg'];
  function hasAgg(e) {
    if (!e || typeof e !== 'object') return false;
    if (e.k === 'fn' && AGGS.indexOf(e.f) !== -1) return true;
    if (e.k === 'sub') return false;
    return ['a', 'b', 'e', 'l', 'r', 'pat', 'lo', 'hi'].some(function (k) { return hasAgg(e[k]); }) || (e.args || []).some(hasAgg) || (e.list || []).some(hasAgg);
  }
  function hasParam(e) {
    if (!e || typeof e !== 'object') return null;
    if (e.k === 'param') return e.v;
    var hit = null;
    ['a', 'b', 'e', 'l', 'r', 'pat', 'lo', 'hi', 'where', 'having', 'q', 'sub'].forEach(function (k) { if (!hit && e[k]) hit = hasParam(e[k]); });
    (e.args || []).concat(e.list || []).concat((e.items || []).map(function (i) { return i.e; })).forEach(function (x) { if (!hit) hit = hasParam(x); });
    return hit;
  }
  function likeRe(p, ci) { return new RegExp('^' + String(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', ci ? 'i' : ''); }
  function resolveCol(e, ctx) {
    if (e.t) {
      var row = ctx.rows[e.t];
      if (row === undefined) throw sqlErr('missing FROM-clause entry for table "' + e.t + '"');
      if (row === null) return null;
      if (!Object.prototype.hasOwnProperty.call(row, e.c)) throw sqlErr('column ' + e.t + '.' + e.c + ' does not exist');
      return row[e.c];
    }
    var hits = Object.keys(ctx.rows).filter(function (a) { var r = ctx.rows[a]; return r ? Object.prototype.hasOwnProperty.call(r, e.c) : (ctx.cols[a] || []).indexOf(e.c) !== -1; });
    if (!hits.length) {
      if (ctx.alias && Object.prototype.hasOwnProperty.call(ctx.alias, e.c)) return ctx.alias[e.c];
      throw sqlErr('column "' + e.c + '" does not exist');
    }
    if (hits.length > 1) throw sqlErr('column reference "' + e.c + '" is ambiguous');
    var r2 = ctx.rows[hits[0]];
    return r2 ? r2[e.c] : null;
  }
  function typeName(v) { return v === null ? 'unknown' : isTs(v) ? 'timestamp with time zone' : isIv(v) ? 'interval' : Array.isArray(v) ? 'integer[]' : typeof v === 'number' ? 'integer' : typeof v === 'boolean' ? 'boolean' : 'text'; }
  function ev(e, ctx, db) {
    switch (e.k) {
      case 'lit': return e.v;
      case 'param': throw sqlErr('there is no parameter ' + e.v);
      case 'col': return resolveCol(e, ctx);
      case 'star': throw sqlErr('"*" is only allowed in the select list or count(*)');
      case 'sub': { var r = execSelect(e.q, db); if (r.rows.length > 1) throw sqlErr('more than one row returned by a subquery used as an expression'); return r.rows.length ? r.rows[0][0] : null; }
      case 'and': { var a = ev(e.a, ctx, db); if (a === false) return false; var b = ev(e.b, ctx, db); if (b === false) return false; return a === null || b === null ? null : true; }
      case 'or': { var a2 = ev(e.a, ctx, db); if (a2 === true) return true; var b2 = ev(e.b, ctx, db); if (b2 === true) return true; return a2 === null || b2 === null ? null : false; }
      case 'not': { var x = ev(e.e, ctx, db); return x === null ? null : !x; }
      case 'cmp': {
        var c = cmpVals(ev(e.l, ctx, db), ev(e.r, ctx, db));
        if (c === null) return null;
        return e.op === '=' ? c === 0 : e.op === '<>' ? c !== 0 : e.op === '<' ? c < 0 : e.op === '>' ? c > 0 : e.op === '<=' ? c <= 0 : c >= 0;
      }
      case 'isnull': { var v = ev(e.e, ctx, db); return e.neg ? v !== null && v !== undefined : v === null || v === undefined; }
      case 'istrue': { var v2 = ev(e.e, ctx, db) === e.v; return e.neg ? !v2 : v2; }
      case 'distinct': { var l = ev(e.l, ctx, db), r2 = ev(e.r, ctx, db), same = (l === null && r2 === null) || (l !== null && r2 !== null && cmpVals(l, r2) === 0); return e.neg ? same : !same; }
      case 'like': { var s = ev(e.e, ctx, db), p = ev(e.pat, ctx, db); if (s === null || p === null) return null; var mt = likeRe(p, e.ci).test(String(s)); return e.neg ? !mt : mt; }
      case 'in': {
        var val = ev(e.e, ctx, db);
        var opts = e.sub ? execSelect(e.sub, db).rows.map(function (rw) { return rw[0]; }) : e.list.map(function (y) { return ev(y, ctx, db); });
        if (val === null) return null;
        var hit = opts.some(function (o) { return cmpVals(val, o) === 0; });
        return e.neg ? !hit : hit;
      }
      case 'between': { var bv = ev(e.e, ctx, db), lo = ev(e.lo, ctx, db), hi = ev(e.hi, ctx, db); var inr = cmpVals(bv, lo) >= 0 && cmpVals(bv, hi) <= 0; return e.neg ? !inr : inr; }
      case 'arith': {
        var L = ev(e.l, ctx, db), R = ev(e.r, ctx, db);
        if (e.op === '||') return L === null || R === null ? null : fmtVal(L) + fmtVal(R);
        if (L === null || R === null) return null;
        if (isTs(L) && isTs(R) && e.op === '-') return IV(L.ts - R.ts);
        if (isTs(L) && isIv(R)) return TS(e.op === '-' ? L.ts - R.iv : L.ts + R.iv);
        if (isIv(L) && isIv(R)) return IV(e.op === '-' ? L.iv - R.iv : L.iv + R.iv);
        if (isIv(L) && typeof R === 'number') return IV(e.op === '*' ? L.iv * R : L.iv / R);
        if (typeof L !== 'number' || typeof R !== 'number') throw sqlErr('operator does not exist: ' + typeName(L) + ' ' + e.op + ' ' + typeName(R));
        if (e.op === '/' && R === 0) throw sqlErr('division by zero');
        return e.op === '+' ? L + R : e.op === '-' ? L - R : e.op === '*' ? L * R : e.op === '%' ? L % R : (Math.floor(L) === L && Math.floor(R) === R ? (L / R < 0 ? Math.ceil(L / R) : Math.floor(L / R)) : L / R);
      }
      case 'cast': {
        var cv = ev(e.e, ctx, db);
        if (cv === null) return null;
        if (e.ty === 'regclass') { return db.relByOid(cv) || String(cv); }
        if (e.ty === 'text' || e.ty === 'varchar' || e.ty === 'name') return fmtVal(cv);
        if (/^(int|integer|bigint|smallint|int4|int8|numeric|float|real|double)$/.test(e.ty)) { var n = Number(num(cv)); if (n !== n) throw sqlErr('invalid input syntax for type ' + e.ty + ': "' + fmtVal(cv) + '"'); return /^(int|integer|bigint|smallint|int4|int8)$/.test(e.ty) ? (n < 0 ? Math.ceil(n) : Math.floor(n)) : n; }
        if (e.ty === 'interval') { if (isIv(cv)) return cv; var iv = parseInterval(cv); if (iv == null) throw sqlErr('invalid input syntax for type interval: "' + cv + '"'); return IV(iv); }
        if (/^(timestamptz|timestamp)$/.test(e.ty)) { if (isTs(cv)) return cv; var m3 = /(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(cv)); if (!m3) throw sqlErr('invalid input syntax for type timestamp with time zone: "' + cv + '"'); return TS(+m3[1] * 3600 + +m3[2] * 60 + +(m3[3] || 0)); }
        return cv;
      }
      case 'fn': return callFn(e, ctx, db);
    }
    throw sqlErr('cannot evaluate expression');
  }
  function callFn(e, ctx, db) {
    var f = e.f;
    if (AGGS.indexOf(f) !== -1) {
      if (!ctx.group) throw sqlErr('aggregate functions are not allowed in WHERE');
      if (f === 'count' && e.star) return ctx.group.length;
      var vals = ctx.group.map(function (g) { return ev(e.args[0], g, db); }).filter(function (v) { return v !== null && v !== undefined; });
      if (e.distinct) { var seen = {}; vals = vals.filter(function (v) { var k = fmtVal(v); if (seen[k]) return false; seen[k] = 1; return true; }); }
      if (f === 'count') return vals.length;
      if (!vals.length) return null;
      if (f === 'min' || f === 'max') return vals.reduce(function (a, b) { var c = cmpVals(a, b); return (f === 'min' ? c <= 0 : c >= 0) ? a : b; });
      var sum = vals.reduce(function (a, b) { return a + num(b); }, 0);
      return f === 'sum' ? sum : sum / vals.length;
    }
    var args = e.args.map(function (x) { return ev(x, ctx, db); });
    if (db.fns && db.fns[f]) return db.fns[f].apply(null, args);
    switch (f) {
      case 'now': return TS(db.now());
      case 'pg_backend_pid': return db.session.pid;
      case 'cardinality': return args[0] === null ? null : (Array.isArray(args[0]) ? args[0].length : null);
      case 'array_length': return Array.isArray(args[0]) && args[0].length ? args[0].length : null;
      case 'left': { if (args[0] === null) return null; var s0 = fmtVal(args[0]); return s0.slice(0, args[1] < 0 ? s0.length + args[1] : args[1]); }
      case 'substr': case 'substring': { if (args[0] === null) return null; var s = fmtVal(args[0]); return args.length > 2 ? s.substr(args[1] - 1, args[2]) : s.substr(args[1] - 1); }
      case 'length': case 'char_length': return args[0] === null ? null : fmtVal(args[0]).length;
      case 'lower': return args[0] === null ? null : fmtVal(args[0]).toLowerCase();
      case 'upper': return args[0] === null ? null : fmtVal(args[0]).toUpperCase();
      case 'coalesce': for (var i = 0; i < args.length; i++) if (args[i] !== null && args[i] !== undefined) return args[i]; return null;
      case 'age': return args[0] === null ? null : IV(db.now() - num(args[0]));
      case 'version': return 'PostgreSQL 16.4 on aarch64-unknown-linux-gnu, compiled by gcc (Debian 12.2.0-14) 12.2.0, 64-bit';
      case 'unnest': case 'generate_series': throw sqlErr('set-returning functions such as ' + f + '() are not modelled in this simulation');
    }
    throw sqlErr('function ' + f + '(' + args.map(typeName).join(', ') + ') does not exist', 'This simulation models a documented subset of functions; see the supported grammar.');
  }
  function sourceOf(db, ref) {
    var t = db.source(ref.name);
    if (!t) throw sqlErr('relation "' + ref.name + '" does not exist');
    return t;
  }
  function execSelect(q, db) {
    if (q.from) db.touch(q.from.name, 'AccessShareLock');
    var refs = q.from ? [q.from].concat(q.joins.map(function (j) { return j.ref; })) : [];
    var srcs = refs.map(function (r) { return sourceOf(db, r); });
    var cols = {};
    refs.forEach(function (r, i) { cols[r.alias] = srcs[i].cols; });
    var rows;
    if (!q.from) rows = [{ rows: {}, cols: {} }];
    else {
      rows = srcs[0].rows.map(function (r) { var o = {}; o[refs[0].alias] = r; return { rows: o, cols: cols }; });
      q.joins.forEach(function (j, ji) {
        var right = srcs[ji + 1].rows, alias = j.ref.alias, next = [];
        rows.forEach(function (lc) {
          var matched = false;
          right.forEach(function (rr) {
            var rws = Object.assign({}, lc.rows); rws[alias] = rr;
            var cx = { rows: rws, cols: cols };
            if (!j.on || ev(j.on, cx, db) === true) { next.push(cx); matched = true; }
          });
          if (!matched && j.left) { var rn = Object.assign({}, lc.rows); rn[alias] = null; next.push({ rows: rn, cols: cols }); }
        });
        rows = next;
      });
    }
    if (q.where) rows = rows.filter(function (cx) { return ev(q.where, cx, db) === true; });
    var names = [], grouped = !!q.group || q.items.some(function (it) { return it.e && hasAgg(it.e); }) || hasAgg(q.having);
    function nameOf(it) { if (it.alias) return it.alias; if (it.e.k === 'col') return it.e.c; if (it.e.k === 'fn') return it.e.f; if (it.e.k === 'cast') return it.e.e.k === 'col' ? it.e.e.c : it.e.ty; return '?column?'; }
    q.items.forEach(function (it) {
      if (it.star) { refs.forEach(function (r, i) { if (!it.t || it.t === r.alias) srcs[i].cols.forEach(function (c) { names.push(c); }); }); }
      else names.push(nameOf(it));
    });
    function project(cx) {
      var out = [];
      q.items.forEach(function (it) {
        if (it.star) { refs.forEach(function (r) { if (!it.t || it.t === r.alias) cols[r.alias].forEach(function (c) { var rw = cx.rows[r.alias]; out.push(rw ? rw[c] : null); }); }); }
        else out.push(ev(it.e, cx, db));
      });
      return out;
    }
    var keyed = [];
    function keep(cx, vals) { var al = {}; names.forEach(function (n, i) { al[n] = vals[i]; }); cx.alias = al; keyed.push({ vals: vals, cx: cx }); }
    if (grouped) {
      if (q.items.some(function (it) { return it.star; })) throw sqlErr('column "*" must appear in the GROUP BY clause or be used in an aggregate function');
      var groups = {}, order = [];
      var gexprs = (q.group || []).map(function (g) {
        if (g.k === 'lit' && typeof g.v === 'number') { var it = q.items[g.v - 1]; if (!it || it.star) throw sqlErr('GROUP BY position ' + g.v + ' is not in select list'); return it.e; }
        if (g.k === 'col' && !g.t) { var al = q.items.filter(function (it2) { return it2.alias === g.c; })[0]; if (al && !refs.some(function (r, i) { return srcs[i].cols.indexOf(g.c) !== -1; })) return al.e; }
        return g;
      });
      rows.forEach(function (cx) {
        var k = gexprs.map(function (g) { return fmtVal(ev(g, cx, db)); }).join('\u0001');
        if (!groups[k]) { groups[k] = []; order.push(k); }
        groups[k].push(cx);
      });
      if (!q.group && !order.length) { order.push(''); groups[''] = []; }
      order.forEach(function (k) {
        var g = groups[k], cx = { rows: g[0] ? g[0].rows : {}, cols: cols, group: g };
        if (q.having && ev(q.having, cx, db) !== true) return;
        keep(cx, project(cx));
      });
    } else rows.forEach(function (cx) { keep(cx, project(cx)); });
    if (q.distinct) { var seenD = {}; keyed = keyed.filter(function (k) { var s = k.vals.map(fmtVal).join('\u0001'); if (seenD[s]) return false; seenD[s] = 1; return true; }); }
    if (q.order) {
      var keys = keyed.map(function (k) {
        return q.order.map(function (o) {
          if (o.e.k === 'lit' && typeof o.e.v === 'number') return k.vals[o.e.v - 1];
          if (o.e.k === 'col' && !o.e.t && names.indexOf(o.e.c) !== -1) return k.vals[names.indexOf(o.e.c)];
          return ev(o.e, k.cx, db);
        });
      });
      var idx = keyed.map(function (k, i) { return i; });
      idx.sort(function (x, y) {
        for (var i = 0; i < q.order.length; i++) {
          var a = keys[x][i], b = keys[y][i], d = q.order[i].desc;
          var an = a === null || a === undefined, bn = b === null || b === undefined;
          if (an || bn) { if (an && bn) continue; return (an ? 1 : -1) * (d ? -1 : 1); }
          var c = cmpVals(a, b);
          if (c) return d ? -c : c;
        }
        return x - y;
      });
      keyed = idx.map(function (i) { return keyed[i]; });
    }
    if (q.offset) keyed = keyed.slice(q.offset);
    if (q.limit != null) keyed = keyed.slice(0, q.limit);
    return { names: names, rows: keyed.map(function (k) { return k.vals; }) };
  }
  /* psql's aligned / expanded / unaligned output */
  function psqlTable(r, opt) {
    var names = r.names, rows = r.rows.map(function (rw) { return rw.map(fmtVal); });
    var foot = '(' + rows.length + ' row' + (rows.length === 1 ? '' : 's') + ')';
    if (opt.unaligned) return rows.map(function (rw) { return rw.join('|'); }).join('\n') + (rows.length ? '\n' : '') + (opt.tuplesOnly ? '' : foot + '\n');
    if (opt.expanded) {
      if (!rows.length) return '(0 rows)\n';
      var wn = names.reduce(function (a, n) { return Math.max(a, n.length); }, 0);
      return rows.map(function (rw, i) {
        var head = '-[ RECORD ' + (i + 1) + ' ]';
        while (head.length < wn + 1) head += '-';
        return head + '+' + rep('-', 12) + '\n' + rw.map(function (v, j) { var n = names[j]; while (n.length < wn) n += ' '; return n + ' | ' + v; }).join('\n');
      }).join('\n') + '\n';
    }
    var numeric = names.map(function (n, j) { return r.rows.length > 0 && r.rows.every(function (rw) { return rw[j] === null || typeof rw[j] === 'number'; }); });
    var w = names.map(function (n, j) { return rows.reduce(function (a, rw) { return Math.max(a, rw[j].length); }, n.length); });
    function cell(s, j, head) {
      var pad = w[j] - s.length;
      if (head) { var l = Math.floor(pad / 2); return rep(' ', l) + s + rep(' ', pad - l); }
      return numeric[j] ? rep(' ', pad) + s : s + rep(' ', pad);
    }
    var lines = [];
    if (!opt.tuplesOnly) { lines.push((' ' + names.map(function (n, j) { return cell(n, j, true); }).join(' | ')).replace(/\s+$/, '')); lines.push(w.map(function (x) { return rep('-', x + 2); }).join('+')); }
    rows.forEach(function (rw) { lines.push((' ' + rw.map(function (v, j) { return cell(v, j, false); }).join(' | ')).replace(/\s+$/, '')); });
    if (!opt.tuplesOnly) lines.push(foot);
    return lines.join('\n') + '\n';
  }
  function splitStatements(sql) {
    var out = [], cur = '', q = null;
    for (var i = 0; i < sql.length; i++) {
      var ch = sql.charAt(i);
      if (q) { cur += ch; if (ch === q) q = null; continue; }
      if (ch === "'" || ch === '"') { q = ch; cur += ch; continue; }
      if (ch === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  /* settings with units in ms, shown the way SHOW prints them */
  function msOf(v) { var s = String(v).trim().replace(/^'|'$/g, ''); if (/^\d+$/.test(s)) return +s; var iv = parseInterval(s); return iv == null ? null : Math.round(iv * 1000); }
  function fmtMs(ms) { if (!ms) return '0'; if (ms % 3600000 === 0) return ms / 3600000 + 'h'; if (ms % 60000 === 0) return ms / 60000 + 'min'; if (ms % 1000 === 0) return ms / 1000 + 's'; return ms + 'ms'; }

  /* ── the generic database: tables, catalog views, statements ── */
  function makeDb(o) {
    var db = { name: o.name || 'beacon', tables: o.tables, views: o.views || {}, fns: o.fns || {}, now: o.now, oid: o.oid || {}, session: null,
      settings: o.settings, autoConf: {}, roleSet: {}, dbSet: {}, hooks: o.hooks || {}, roles: [] };
    db.relByOid = function (oid) { return Object.keys(db.oid).filter(function (k) { return db.oid[k] === oid; })[0] || null; };
    db.source = function (name) {
      if (db.views[name]) return db.views[name]();
      var t = db.tables[name];
      if (!t) return null;
      if (t.opaque) throw sqlErr('(simulation) the ' + t.count + ' rows of ' + name + ' are not materialised in this model; use EXPLAIN, \\d ' + name + ' or pg_stat_user_tables');
      return { cols: t.cols.map(function (c) { return c.name; }), rows: t.rows };
    };
    db.touch = function (table, mode) { if (db.hooks.touch) db.hooks.touch(table, mode); };
    db.effective = function (name, role) {
      var s = db.settings[name];
      if (!s) return null;
      var v = s.applied;
      if (db.dbSet[name] != null) v = db.dbSet[name];
      if (db.roleSet[role] && db.roleSet[role][name] != null) v = db.roleSet[role][name];
      if (db.session && db.session.set[name] != null) v = db.session.set[name];
      return v;
    };
    db.showVal = function (name, v) { var s = db.settings[name]; return s.unit === 'ms' ? fmtMs(v) : String(v); };
    return db;
  }
  function uniqueOn(t, col) {
    if (!t) return null;
    return (t.indexes || []).filter(function (ix) { return ix.valid !== false && (ix.unique || ix.primary) && ix.cols.length === 1 && ix.cols[0].c === col; })[0] || null;
  }
  function firstDup(T, col) {
    var seen = {}, dup = null;
    (T.rows || []).forEach(function (r) { var k = fmtVal(r[col]); if (seen[k] && !dup) dup = k; seen[k] = 1; });
    return dup;
  }
  function describe(db, name) {
    var t = db.tables[name];
    if (!t) return null;
    var body = psqlTable({ names: ['Column', 'Type', 'Nullable', 'Default'], rows: t.cols.map(function (c) { return [c.name, c.type, c.notnull ? 'not null' : '', c.def || '']; }) }, {}).replace(/\(\d+ rows?\)\n$/, '');
    var idx = (t.indexes || []).map(function (ix) { return '    "' + ix.name + '" ' + (ix.primary ? 'PRIMARY KEY, ' : ix.unique ? 'UNIQUE, ' : '') + 'btree (' + ix.cols.map(function (c) { return c.c + (c.desc ? ' DESC' : ''); }).join(', ') + ')' + (ix.valid === false ? ' INVALID' : ''); });
    return '                Table "public.' + name + '"\n' + body + (idx.length ? 'Indexes:\n' + idx.join('\n') + '\n' : '');
  }
  function runSql(db, sql, opt) {
    var s = sql.trim(), m, m2;
    if (/^\\/.test(s)) {
      if (s === '\\x' || /^\\x\s+(on|off)$/.test(s)) { opt.expanded = s === '\\x' ? !opt.expanded : /on$/.test(s); return 'Expanded display is ' + (opt.expanded ? 'on' : 'off') + '.\n'; }
      if ((m = /^\\d\+?\s+(?:public\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?$/.exec(s))) {
        var nm0 = m[1].toLowerCase(), d = describe(db, nm0);
        if (d) return d;
        if (db.views[nm0]) return '                View "pg_catalog.' + nm0 + '"\n Column\n' + db.views[nm0]().cols.map(function (c) { return ' ' + c; }).join('\n') + '\n';
        throw sqlErr('Did not find any relation named "' + m[1] + '".');
      }
      if (s === '\\dt' || s === '\\dt+') return '            List of relations\n' + psqlTable({ names: ['Schema', 'Name', 'Type', 'Owner'], rows: Object.keys(db.tables).sort().map(function (n) { return ['public', n, 'table', 'beacon_owner']; }) }, {});
      if (s === '\\di' || s === '\\di+') { var rows = []; Object.keys(db.tables).sort().forEach(function (n) { (db.tables[n].indexes || []).forEach(function (ix) { rows.push(['public', ix.name, 'index', 'beacon_owner', n]); }); }); return '                List of relations\n' + psqlTable({ names: ['Schema', 'Name', 'Type', 'Owner', 'Table'], rows: rows }, {}); }
      throw sqlErr('(simulation) psql meta-command "' + s.split(/\s/)[0] + '" is not modelled; supported: \\d TABLE, \\dt, \\di, \\x');
    }
    var toks = sqlLex(s), P = new Parser(toks);
    if (!toks.length) return '';
    var head = toks[0].t === 'id' ? toks[0].v : '';
    if (head === 'select') { var q = P.select(); P.done(); return psqlTable(execSelect(q, db), opt); }
    if (head === 'explain') {
      P.p++;
      var analyze = false;
      if (P.isOp('(')) { while (!P.isOp(')') && P.peek()) { if (P.isKw('analyze')) analyze = true; P.p++; } P.expectOp(')'); }
      if (P.eatKw('analyze')) analyze = true;
      P.eatKw('verbose');
      if (!P.isKw('select')) throw sqlErr('(simulation) EXPLAIN is modelled for SELECT statements only');
      var eq = P.select(); P.done();
      var pr = hasParam(eq);
      if (pr) throw sqlErr('there is no parameter ' + pr);
      if (eq.from) { if (!db.views[eq.from.name] && !db.tables[eq.from.name]) throw sqlErr('relation "' + eq.from.name + '" does not exist'); db.touch(eq.from.name, 'AccessShareLock'); }
      var plan = (db.hooks.explain && eq.from ? db.hooks.explain(eq, analyze) : null) || ['Result  (cost=0.00..0.01 rows=1 width=4)'];
      if (db.hooks.afterExplain) db.hooks.afterExplain(plan);
      return psqlTable({ names: ['QUERY PLAN'], rows: plan.map(function (l) { return [l]; }) }, {});
    }
    if (head === 'show') {
      var nm = (toks[1] && toks[1].v) || '';
      if (nm === 'all') return psqlTable({ names: ['name', 'setting', 'description'], rows: Object.keys(db.settings).sort().map(function (k) { return [k, db.showVal(k, db.effective(k, db.session.user)), db.settings[k].desc || '']; }) }, opt);
      if (!db.settings[nm]) throw sqlErr('unrecognized configuration parameter "' + nm + '"');
      return psqlTable({ names: [nm], rows: [[db.showVal(nm, db.effective(nm, db.session.user))]] }, opt);
    }
    if (head === 'set') {
      if ((m2 = /^set\s+(?:session\s+)?([a-z_]+)\s*(?:=|\s+to\s+)\s*(.+)$/i.exec(s))) {
        var sn = m2[1].toLowerCase();
        if (!db.settings[sn]) throw sqlErr('unrecognized configuration parameter "' + sn + '"');
        if (db.settings[sn].ctx === 'postmaster') throw sqlErr('parameter "' + sn + '" cannot be changed without restarting the server');
        db.session.set[sn] = db.settings[sn].unit === 'ms' ? msOf(m2[2]) : m2[2].replace(/^'|'$/g, '');
        return 'SET\n';
      }
      throw sqlErr(P.near());
    }
    if (head === 'alter') {
      if ((m2 = /^alter\s+system\s+set\s+([a-z_]+)\s*(?:=|\s+to\s+)\s*(.+)$/i.exec(s))) {
        var an = m2[1].toLowerCase(), S0 = db.settings[an];
        if (!S0) throw sqlErr('unrecognized configuration parameter "' + an + '"');
        var av = S0.unit === 'ms' ? msOf(m2[2]) : m2[2].replace(/^'|'$/g, '').trim();
        if (av === null || av === '') throw sqlErr('invalid value for parameter "' + an + '": "' + m2[2] + '"');
        db.autoConf[an] = av;
        if (db.hooks.alterSystem) db.hooks.alterSystem(an, av);
        return 'ALTER SYSTEM\n';
      }
      if ((m2 = /^alter\s+system\s+reset\s+([a-z_]+)$/i.exec(s))) { delete db.autoConf[m2[1].toLowerCase()]; return 'ALTER SYSTEM\n'; }
      if ((m2 = /^alter\s+(role|user|database)\s+"?([a-z_][a-z0-9_]*)"?\s+set\s+([a-z_]+)\s*(?:=|\s+to\s+)\s*(.+)$/i.exec(s))) {
        var kind = m2[1].toLowerCase(), who = m2[2].toLowerCase(), pn = m2[3].toLowerCase();
        if (!db.settings[pn]) throw sqlErr('unrecognized configuration parameter "' + pn + '"');
        if (db.settings[pn].ctx === 'postmaster' || db.settings[pn].ctx === 'sighup') throw sqlErr('parameter "' + pn + '" cannot be changed now');
        var pv = db.settings[pn].unit === 'ms' ? msOf(m2[4]) : m2[4].replace(/^'|'$/g, '');
        if (pv === null) throw sqlErr('invalid value for parameter "' + pn + '": "' + m2[4] + '"');
        if (kind === 'database') { if (who !== db.name) throw sqlErr('database "' + who + '" does not exist'); db.dbSet[pn] = pv; return 'ALTER DATABASE\n'; }
        if (db.roles.indexOf(who) === -1) throw sqlErr('role "' + who + '" does not exist');
        (db.roleSet[who] = db.roleSet[who] || {})[pn] = pv;
        return 'ALTER ROLE\n';
      }
      if ((m2 = /^alter\s+table\s+(?:only\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s+add\s+(?:constraint\s+([a-z_][a-z0-9_]*)\s+)?(unique|primary\s+key)\s*\(\s*([a-z_][a-z0-9_]*)\s*\)$/i.exec(s))) {
        var tn = m2[1].toLowerCase(), T = db.tables[tn];
        if (!T) throw sqlErr('relation "' + tn + '" does not exist');
        var col = m2[4].toLowerCase(), pk = /primary/i.test(m2[3]), cname = (m2[2] || (tn + (pk ? '_pkey' : '_' + col + '_key'))).toLowerCase();
        if (!T.cols.some(function (c) { return c.name === col; })) throw sqlErr('column "' + col + '" named in key does not exist');
        if (T.opaque) throw sqlErr('(simulation) constraints on ' + tn + ' are not modelled');
        var dup = firstDup(T, col);
        if (dup) throw sqlErr('could not create unique index "' + cname + '"', 'Key (' + col + ')=(' + dup + ') is duplicated.');
        T.indexes.push({ name: cname, cols: [{ c: col }], unique: true, primary: pk, valid: true, constraint: true });
        return 'ALTER TABLE\n';
      }
      throw sqlErr('(simulation) this ALTER statement is not modelled; supported: ALTER SYSTEM SET|RESET, ALTER ROLE|DATABASE … SET, ALTER TABLE … ADD [CONSTRAINT n] UNIQUE|PRIMARY KEY (col)');
    }
    if (head === 'create') {
      if ((m2 = /^create\s+(unique\s+)?index\s+(concurrently\s+)?(if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)?\s*on\s+(?:only\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s*(?:using\s+btree\s*)?\(\s*([^)]*)\)\s*$/i.exec(s))) {
        var tbl = m2[5].toLowerCase(), TT = db.tables[tbl];
        if (!TT) throw sqlErr('relation "' + tbl + '" does not exist');
        var icols = m2[6].split(',').map(function (x) { var p = x.trim().toLowerCase().split(/\s+/); return { c: p[0], desc: p[1] === 'desc' }; });
        icols.forEach(function (ic) { if (!TT.cols.some(function (c) { return c.name === ic.c; })) throw sqlErr('column "' + ic.c + '" does not exist'); });
        var iname = (m2[4] || (tbl + '_' + icols.map(function (c) { return c.c; }).join('_') + (m2[1] ? '_key' : '_idx'))).toLowerCase();
        var exists = Object.keys(db.tables).some(function (k) { return k === iname || (db.tables[k].indexes || []).some(function (ix) { return ix.name === iname; }); });
        if (exists) { if (m2[3]) return 'NOTICE:  relation "' + iname + '" already exists, skipping\nCREATE INDEX\n'; throw sqlErr('relation "' + iname + '" already exists'); }
        db.touch(tbl, m2[2] ? 'ShareUpdateExclusiveLock' : 'ShareLock');
        var ix = { name: iname, cols: icols, unique: !!m2[1], valid: true };
        if (m2[1]) {
          var d2 = icols.length === 1 ? firstDup(TT, icols[0].c) : null;
          if (d2) {
            if (m2[2]) { ix.valid = false; TT.indexes.push(ix); }
            throw sqlErr('could not create unique index "' + iname + '"', 'Key (' + icols[0].c + ')=(' + d2 + ') is duplicated.');
          }
        }
        TT.indexes.push(ix);
        if (db.hooks.createIndex) db.hooks.createIndex(tbl, ix, !!m2[2]);
        return 'CREATE INDEX\n';
      }
      if ((m2 = /^create\s+table\s+(if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s*\(([\s\S]*)\)\s*$/i.exec(s))) {
        var ctn = m2[2].toLowerCase();
        if (db.tables[ctn] || db.views[ctn]) { if (m2[1]) return 'NOTICE:  relation "' + ctn + '" already exists, skipping\nCREATE TABLE\n'; throw sqlErr('relation "' + ctn + '" already exists'); }
        var defs = [], depth = 0, cur = '';
        m2[3].split('').forEach(function (ch) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && !depth) { defs.push(cur.trim()); cur = ''; } else cur += ch; });
        if (cur.trim()) defs.push(cur.trim());
        var NT = { cols: [], rows: [], indexes: [], created: true, serial: 0 };
        defs.forEach(function (dd) {
          var mm;
          if ((mm = /^(?:constraint\s+([a-z_][a-z0-9_]*)\s+)?(primary\s+key|unique)\s*\(\s*([a-z_][a-z0-9_]*)\s*\)$/i.exec(dd))) { var pk2 = /primary/i.test(mm[2]); NT.indexes.push({ name: (mm[1] || ctn + (pk2 ? '_pkey' : '_' + mm[3].toLowerCase() + '_key')).toLowerCase(), cols: [{ c: mm[3].toLowerCase() }], unique: true, primary: pk2, valid: true }); return; }
          if ((mm = /^([a-z_][a-z0-9_]*)\s+(.+)$/i.exec(dd))) {
            var cn = mm[1].toLowerCase(), rest = mm[2].toLowerCase();
            var ty = rest.replace(/\s+(primary\s+key|unique|not\s+null|null|default\s+.*|references\s+.*)$/g, '').replace(/\s+(primary\s+key|unique|not\s+null|null)\b.*$/, '').trim();
            var dm = /default\s+(\S+(?:\(\))?)/.exec(rest);
            NT.cols.push({ name: cn, type: ty === 'timestamptz' ? 'timestamp with time zone' : ty, notnull: /not\s+null|primary\s+key/.test(rest), def: dm ? dm[1] : '', serial: /serial/.test(ty) });
            if (/primary\s+key/.test(rest)) NT.indexes.push({ name: ctn + '_pkey', cols: [{ c: cn }], unique: true, primary: true, valid: true });
            else if (/\bunique\b/.test(rest)) NT.indexes.push({ name: ctn + '_' + cn + '_key', cols: [{ c: cn }], unique: true, valid: true });
            return;
          }
          throw sqlErr('syntax error at or near "' + dd.split(/\s/)[0] + '"');
        });
        db.tables[ctn] = NT;
        return 'CREATE TABLE\n';
      }
      throw sqlErr('(simulation) this CREATE statement is not modelled; supported: CREATE [UNIQUE] INDEX [CONCURRENTLY] [IF NOT EXISTS] name ON table (cols), CREATE TABLE name (…)');
    }
    if (head === 'drop') {
      if ((m2 = /^drop\s+index\s+(concurrently\s+)?(if\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)$/i.exec(s))) {
        var dn = m2[3].toLowerCase(), found = false;
        Object.keys(db.tables).forEach(function (k) {
          var T2 = db.tables[k], before = (T2.indexes || []).length;
          T2.indexes = (T2.indexes || []).filter(function (ix2) { if (ix2.name === dn && (ix2.primary || ix2.constraint)) throw sqlErr('cannot drop index ' + dn + ' because constraint ' + dn + ' on table ' + k + ' requires it'); return ix2.name !== dn; });
          if (T2.indexes.length !== before) found = true;
        });
        if (!found) { if (m2[2]) return 'NOTICE:  index "' + dn + '" does not exist, skipping\nDROP INDEX\n'; throw sqlErr('index "' + dn + '" does not exist'); }
        return 'DROP INDEX\n';
      }
      throw sqlErr('(simulation) only DROP INDEX is modelled here; dropping tables is not something this incident needs');
    }
    if (head === 'delete') {
      P.p++; P.expectKw('from');
      var tref = P.tableRef(), using = null, where = null;
      if (P.eatKw('using')) using = P.tableRef();
      if (P.eatKw('where')) where = P.expr();
      P.done();
      var DT = db.tables[tref.name];
      if (!DT) { if (db.views[tref.name]) throw sqlErr('cannot delete from view "' + tref.name + '"'); throw sqlErr('relation "' + tref.name + '" does not exist'); }
      if (DT.opaque) throw sqlErr('(simulation) deleting from ' + tref.name + ' is not modelled');
      var cols2 = {}; cols2[tref.alias] = DT.cols.map(function (c) { return c.name; });
      var other = using ? sourceOf(db, using) : null;
      if (using) cols2[using.alias] = other.cols;
      var doomed = DT.rows.filter(function (rw) {
        var base = {}; base[tref.alias] = rw;
        if (!where) return true;
        if (!other) return ev(where, { rows: base, cols: cols2 }, db) === true;
        return other.rows.some(function (orw) { var rr = Object.assign({}, base); rr[using.alias] = orw; return ev(where, { rows: rr, cols: cols2 }, db) === true; });
      });
      DT.rows = DT.rows.filter(function (rw) { return doomed.indexOf(rw) === -1; });
      if (db.hooks.afterDelete) db.hooks.afterDelete(tref.name, doomed);
      return 'DELETE ' + doomed.length + '\n';
    }
    if (head === 'insert') {
      if (!(m2 = /^insert\s+into\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*(?:\(([^)]*)\))?\s*([\s\S]+?)(\s+on\s+conflict\s*(?:\(\s*([a-z_]+)\s*\))?\s*do\s+nothing)?$/i.exec(s))) throw sqlErr(P.near());
      var it = m2[1].toLowerCase(), IT = db.tables[it];
      if (!IT) throw sqlErr('relation "' + it + '" does not exist');
      if (IT.opaque) throw sqlErr('(simulation) inserting into ' + it + ' is not modelled');
      var icl = m2[2] ? m2[2].split(',').map(function (x) { return x.trim().toLowerCase(); }) : IT.cols.map(function (c) { return c.name; });
      var src = m2[3].trim(), vals;
      if (/^select\b/i.test(src)) { var P2 = new Parser(sqlLex(src)); var sq = P2.select(); P2.done(); vals = execSelect(sq, db).rows; }
      else if (/^values\b/i.test(src)) { var P3 = new Parser(sqlLex(src)); vals = []; P3.p++; do { P3.expectOp('('); var row = [P3.expr()]; while (P3.eatOp(',')) row.push(P3.expr()); P3.expectOp(')'); vals.push(row.map(function (x) { return ev(x, { rows: {}, cols: {} }, db); })); } while (P3.eatOp(',')); P3.done(); }
      else throw sqlErr(P.near());
      var conflictCol = m2[5] ? m2[5].toLowerCase() : null, n = 0;
      if (m2[4] && conflictCol && !uniqueOn(IT, conflictCol)) throw sqlErr('there is no unique or exclusion constraint matching the ON CONFLICT specification');
      vals.forEach(function (v) {
        if (v.length !== icl.length) throw sqlErr('INSERT has more expressions than target columns');
        var rowObj = {};
        IT.cols.forEach(function (c) { rowObj[c.name] = null; });
        icl.forEach(function (c, i) { if (!Object.prototype.hasOwnProperty.call(rowObj, c)) throw sqlErr('column "' + c + '" of relation "' + it + '" does not exist'); rowObj[c] = v[i]; });
        IT.cols.forEach(function (c) { if (rowObj[c.name] === null && /now\(\)/.test(c.def || '')) rowObj[c.name] = TS(db.now()); if (rowObj[c.name] === null && c.serial) rowObj[c.name] = ++IT.serial; });
        var clash = (IT.indexes || []).filter(function (ix3) { return ix3.valid !== false && (ix3.unique || ix3.primary) && IT.rows.some(function (r) { return ix3.cols.every(function (c) { return cmpVals(r[c.c], rowObj[c.c]) === 0; }); }); })[0];
        if (clash) { if (m2[4]) return; throw sqlErr('duplicate key value violates unique constraint "' + clash.name + '"', 'Key (' + clash.cols.map(function (c) { return c.c; }).join(', ') + ')=(' + clash.cols.map(function (c) { return fmtVal(rowObj[c.c]); }).join(', ') + ') already exists.'); }
        IT.rows.push(rowObj); n++;
      });
      return 'INSERT 0 ' + n + '\n';
    }
    if (/^(begin|start|commit|end|rollback|abort)$/.test(head)) return (head === 'begin' || head === 'start') ? 'BEGIN\n' : 'WARNING:  there is no transaction in progress\n' + (head === 'rollback' || head === 'abort' ? 'ROLLBACK' : 'COMMIT') + '\n';
    if (head === 'analyze' || head === 'vacuum') return head.toUpperCase() + '\n';
    if (/^(update|truncate|lock|grant|revoke|reindex|cluster)$/.test(head)) throw sqlErr('(simulation) ' + head.toUpperCase() + ' is not modelled in this incident; it is not needed to diagnose or fix it');
    throw sqlErr(head ? 'syntax error at or near "' + head + '"' : P.near());
  }
  /* psql -c … [-x] [-A] [-t] [-h host] [-U user] [-d db] */
  function psqlVerb(state, db, opts) {
    return function (w, a) {
      var cmds = [], o = { expanded: false, unaligned: false, tuplesOnly: false }, host = null, user = opts.user, dbn = null, pos = [];
      for (var i = 0; i < a.length; i++) {
        var x = a[i];
        if (x === '-c' || x === '--command') { cmds.push(a[++i] || ''); continue; }
        if (/^--command=/.test(x)) { cmds.push(x.slice(10)); continue; }
        if (x === '-h' || x === '--host') { host = a[++i]; continue; }
        if (x === '-U' || x === '--username') { user = a[++i]; continue; }
        if (x === '-d' || x === '--dbname') { dbn = a[++i]; continue; }
        if (x === '-p' || x === '--port') { i++; continue; }
        if (x === '-f' || x === '--file') return fail('psql: -f is not modelled here; pass statements with -c "…"', 2);
        if (/^-[xAtXqe]+$/.test(x)) { if (/x/.test(x)) o.expanded = true; if (/A/.test(x)) o.unaligned = true; if (/t/.test(x)) o.tuplesOnly = true; continue; }
        if (x === '--expanded') { o.expanded = true; continue; }
        if (/^postgres(ql)?:\/\//.test(x)) { var um = /^postgres(?:ql)?:\/\/(?:([^:@/]+)(?::[^@/]*)?@)?([^/:]+)(?::\d+)?\/(\w+)/.exec(x); if (um) { if (um[1]) user = um[1]; host = um[2]; dbn = um[3]; } continue; }
        if (x.charAt(0) === '-') return fail('psql: error: unrecognized option "' + x + '" (modelled: -c, -h, -U, -d, -x, -A, -t)', 2);
        pos.push(x);
      }
      if (!dbn && pos[0]) dbn = pos[0];
      if (!cmds.length) return fail('psql (simulation): interactive sessions are not modelled. Run statements with psql -c "…" (several -c are allowed; \\x, \\d TABLE, \\dt and \\di work as -c too).', 2);
      if (host && opts.hosts.indexOf(host) === -1) return fail('psql: error: could not translate host name "' + host + '" to address: Name or service not known', 2);
      dbn = dbn || opts.db;
      if (dbn !== opts.db && dbn !== 'postgres') return fail('psql: error: connection to server at "' + opts.hosts[0] + '" (10.0.6.30), port 5432 failed: FATAL:  database "' + dbn + '" does not exist', 2);
      if (opts.users.indexOf(user) === -1) return fail('psql: error: connection to server at "' + opts.hosts[0] + '" (10.0.6.30), port 5432 failed: FATAL:  password authentication failed for user "' + user + '"', 2);
      db.session = { pid: state.nextPid++, user: user, set: {}, sql: '' };
      var out = '', code = 0;
      for (var k = 0; k < cmds.length && !code; k++) {
        var stmts = /^\s*\\/.test(cmds[k]) ? [cmds[k].trim()] : splitStatements(cmds[k]);
        for (var j = 0; j < stmts.length; j++) {
          db.session.sql = stmts[j];
          try { out += runSql(db, stmts[j], o); }
          catch (e) {
            if (!e.sql) throw e;
            out += (e.pre || '') + 'ERROR:  ' + e.message + '\n' + (e.detail ? 'DETAIL:  ' + e.detail + '\n' : '');
            code = 1; break;
          }
        }
      }
      if (opts.after) opts.after(cmds.join('\n'), out);
      return code ? { out: '', err: out.replace(/\n$/, ''), code: 1 } : res(out);
    };
  }
  /* ═══ S23 · API latency rises with idle CPU ════════════════════════ */
  var S23_NOW = 9 * 3600 + 30 * 60, BLOCKER = 48213, DECOY = 47790;
  var OIDS = { sensors: 16421, status_records: 16433 };
  var APP_Q = { upd: 'UPDATE sensors SET last_seen = $1, status = $2 WHERE id = $3', sel: 'SELECT id, name, site FROM sensors WHERE id = $1', hist: 'SELECT id, status, recorded_at FROM status_records WHERE sensor_id = $1 ORDER BY recorded_at DESC LIMIT 20' };
  var CONFLICTS = {
    AccessShareLock: ['AccessExclusiveLock'],
    RowShareLock: ['ExclusiveLock', 'AccessExclusiveLock'],
    RowExclusiveLock: ['ShareLock', 'ShareRowExclusiveLock', 'ExclusiveLock', 'AccessExclusiveLock'],
    ShareUpdateExclusiveLock: ['ShareUpdateExclusiveLock', 'ShareLock', 'ShareRowExclusiveLock', 'ExclusiveLock', 'AccessExclusiveLock'],
    ShareLock: ['RowExclusiveLock', 'ShareUpdateExclusiveLock', 'ShareRowExclusiveLock', 'ExclusiveLock', 'AccessExclusiveLock'],
    AccessExclusiveLock: ['AccessShareLock', 'RowShareLock', 'RowExclusiveLock', 'ShareUpdateExclusiveLock', 'ShareLock', 'ShareRowExclusiveLock', 'ExclusiveLock', 'AccessExclusiveLock']
  };
  function s23SensorIndex(s) { return s.db.tables.status_records.indexes.filter(function (ix) { return ix.valid !== false && ix.cols[0].c === 'sensor_id'; })[0] || null; }
  function s23Healthy(s) { return s.variant === 'a' ? !s.pg.backends.some(function (b) { return b.pid === BLOCKER; }) : !!s23SensorIndex(s); }
  /* the live view of every backend, derived from state each time it is read */
  function s23Backends(s) {
    var now = s.now(), healthy = s23Healthy(s);
    return s.pg.backends.map(function (b) {
      var r = { pid: b.pid, usename: b.usename, application_name: b.app, client_addr: b.client, datname: b.datname, backend_type: b.type || 'client backend', backend_start: b.start == null ? null : TS(b.start) };
      if (b.role === 'app') {
        var k = b.k, busy = !healthy || k < 2;
        var qs = busy ? now - (s.variant === 'a' ? (k * 7) % 29 + 1 : (k * 3) % 5 + 1) : now - 2 - k;
        r.state = busy ? 'active' : 'idle';
        r.query = s.variant === 'a' ? (k % 2 ? APP_Q.sel : APP_Q.upd) : APP_Q.hist;
        r.xact_start = busy ? TS(qs) : null; r.query_start = TS(qs); r.state_change = TS(qs);
        if (busy && !healthy) { r.wait_event_type = s.variant === 'a' ? 'Lock' : (k % 3 ? 'IO' : null); r.wait_event = s.variant === 'a' ? 'relation' : (k % 3 ? 'DataFileRead' : null); }
        else { r.wait_event_type = busy ? null : 'Client'; r.wait_event = busy ? null : 'ClientRead'; }
        r.locks = !healthy && s.variant === 'a' ? [{ rel: 'sensors', mode: k % 2 ? 'AccessShareLock' : 'RowExclusiveLock', granted: false, since: qs }] : busy ? [{ rel: 'status_records', mode: 'AccessShareLock', granted: true }] : [];
      } else {
        ['state', 'query', 'wait_event_type', 'wait_event'].forEach(function (f) { r[f] = b[f] == null ? null : b[f]; });
        r.xact_start = b.xact == null ? null : TS(b.xact); r.query_start = b.qstart == null ? null : TS(b.qstart); r.state_change = b.qstart == null ? null : TS(b.qstart);
        r.locks = b.locks || [];
      }
      return r;
    });
  }
  function s23Blocking(list, pid) {
    var me = list.filter(function (b) { return b.pid === pid; })[0], out = [];
    if (!me) return [];
    me.locks.filter(function (l) { return !l.granted; }).forEach(function (wl) {
      list.forEach(function (o) {
        if (o.pid === pid) return;
        if (o.locks.some(function (l) { return l.granted && l.rel === wl.rel && (CONFLICTS[l.mode] || []).indexOf(wl.mode) !== -1; }) && out.indexOf(o.pid) === -1) out.push(o.pid);
      });
    });
    return out;
  }
  function s23Plan(s, q, analyze) {
    var t = q.from.name;
    if (t !== 'status_records') return ['Seq Scan on ' + t + '  (cost=0.00..' + (t === 'sensors' ? '412.40 rows=18240' : '1.00 rows=1') + ' width=48)'];
    var sens = null;
    (function find(e) { if (!e) return; if (e.k === 'cmp' && e.op === '=' && e.l.k === 'col' && e.l.c === 'sensor_id' && e.r.k === 'lit') sens = e.r.v; find(e.a); find(e.b); })(q.where);
    if (sens === null) return ['Seq Scan on status_records  (cost=0.00..86311.04 rows=4213004 width=41)' + (analyze ? ' (actual time=0.011..1904.330 rows=4213004 loops=1)' : '')];
    var ix = s23SensorIndex(s), lim = q.limit != null;
    function A(tm, rows) { return analyze ? ' (actual time=' + tm + ' rows=' + rows + ' loops=1)' : ''; }
    var lines;
    if (ix && ix.cols[1] && ix.cols[1].c === 'recorded_at') {
      lines = lim ? ['Limit  (cost=0.43..21.87 rows=20 width=41)' + A('0.031..0.094', 20), '  ->  Index Scan using ' + ix.name + ' on status_records  (cost=0.43..1964.72 rows=1832 width=41)' + A('0.029..0.088', 20), '        Index Cond: (sensor_id = ' + sens + ')']
        : ['Index Scan using ' + ix.name + ' on status_records  (cost=0.43..1964.72 rows=1832 width=41)' + A('0.029..1.210', 1832), '  Index Cond: (sensor_id = ' + sens + ')'];
    } else if (ix) {
      lines = lim ? ['Limit  (cost=2017.94..2017.99 rows=20 width=41)' + A('2.904..2.911', 20), '  ->  Sort  (cost=2017.94..2022.52 rows=1832 width=41)' + A('2.902..2.906', 20), '        Sort Key: recorded_at DESC', '        ->  Bitmap Heap Scan on status_records  (cost=36.62..1969.19 rows=1832 width=41)' + A('0.212..2.401', 1832), '              Recheck Cond: (sensor_id = ' + sens + ')', '              ->  Bitmap Index Scan on ' + ix.name + '  (cost=0.00..36.16 rows=1832 width=0)' + A('0.148..0.148', 1832), '                    Index Cond: (sensor_id = ' + sens + ')']
        : ['Bitmap Heap Scan on status_records  (cost=36.62..1969.19 rows=1832 width=41)' + A('0.212..2.401', 1832), '  Recheck Cond: (sensor_id = ' + sens + ')', '  ->  Bitmap Index Scan on ' + ix.name + '  (cost=0.00..36.16 rows=1832 width=0)', '        Index Cond: (sensor_id = ' + sens + ')'];
    } else {
      lines = lim ? ['Limit  (cost=96441.83..96441.88 rows=20 width=41)' + A('4121.887..4121.893', 20), '  ->  Sort  (cost=96441.83..96446.41 rows=1832 width=41)' + A('4121.885..4121.889', 20), '        Sort Key: recorded_at DESC', '        ->  Seq Scan on status_records  (cost=0.00..96393.09 rows=1832 width=41)' + A('3.102..4120.611', 1841), '              Filter: (sensor_id = ' + sens + ')']
        : ['Seq Scan on status_records  (cost=0.00..96393.09 rows=1832 width=41)' + A('3.102..4120.611', 1841), '  Filter: (sensor_id = ' + sens + ')'];
      if (analyze) lines.push((lim ? '              ' : '  ') + 'Rows Removed by Filter: 4211163');
    }
    if (analyze) lines = lines.concat(['Planning Time: 0.142 ms', 'Execution Time: ' + (ix ? (ix.cols[1] ? '0.118' : '2.957') : '4121.940') + ' ms']);
    return lines;
  }
  function s23World(seed) {
    var S = SIM(), v = S.variantOf(seed, ['a', 'b']), W = null;
    var state = { clock: 0, risky: [], seed: seed, variant: v, hooks: [], flags: {}, nextPid: 52311 };
    state.now = function () { return S23_NOW + state.clock; };
    function pgLog(lines) { var p = '/var/log/postgresql/postgresql-16-main.log'; if (!W) return; S.writeFile(W, p, (S.readFile(W, p) || '') + lines.map(function (l) { return '2026-10-13 ' + hms(state.now()) + '.104 UTC ' + l; }).join('\n') + '\n'); }
    var backends = [];
    for (var k = 0; k < 20; k++) backends.push({ pid: 51231 + k, k: k, role: 'app', usename: 'beacon_app', app: 'beacon-api', client: k < 10 ? '10.0.6.21' : '10.0.6.22', datname: 'beacon', start: 6 * 3600 + 3 + k });
    if (v === 'a') backends.push({ pid: BLOCKER, role: 'other', usename: 'deploy', app: 'psql', client: '10.0.4.17', datname: 'beacon', start: 9 * 3600 + 100, xact: 9 * 3600 + 131, qstart: 9 * 3600 + 133, state: 'idle in transaction', wait_event_type: 'Client', wait_event: 'ClientRead', query: 'ALTER TABLE sensors ADD COLUMN firmware_version text;', locks: [{ rel: 'sensors', mode: 'AccessExclusiveLock', granted: true }] });
    backends.push({ pid: DECOY, role: 'other', usename: 'report', app: 'monthly-export', client: '10.0.7.40', datname: 'beacon', start: 8 * 3600 + 2440, xact: 8 * 3600 + 2462, qstart: 8 * 3600 + 2465, state: 'idle in transaction', wait_event_type: 'Client', wait_event: 'ClientRead', query: 'SELECT sensor_id, count(*) FROM status_records WHERE recorded_at >= \'2026-09-01\' GROUP BY sensor_id;', locks: [{ rel: 'status_records', mode: 'AccessShareLock', granted: true }] });
    backends.push({ pid: 46012, role: 'other', usename: 'grafana', app: 'grafana', client: '10.0.5.30', datname: 'beacon', start: 3 * 3600, qstart: S23_NOW - 14, state: 'idle', wait_event_type: 'Client', wait_event: 'ClientRead', query: 'SELECT 1' });
    [['autovacuum launcher', 1101, 'AutoVacuumMain'], ['logical replication launcher', 1102, 'LogicalLauncherMain'], ['background writer', 1098, 'BgWriterHibernate'], ['checkpointer', 1097, 'CheckpointerMain'], ['walwriter', 1100, 'WalWriterMain']].forEach(function (x) { backends.push({ pid: x[1], role: 'bg', usename: null, app: '', client: null, datname: null, type: x[0], start: 0, state: null, query: '', wait_event_type: 'Activity', wait_event: x[2] }); });
    state.pg = { backends: backends, killed: [], innocent: [], confirmedAt: null, terminatedBlockerConfirmed: false, maxConnRaised: false, restarted: null, blockingDdl: false };
    var tables = {
      sensors: { cols: [{ name: 'id', type: 'integer', notnull: true }, { name: 'name', type: 'text', notnull: true }, { name: 'site', type: 'text' }, { name: 'status', type: 'text' }, { name: 'last_seen', type: 'timestamp with time zone' }], opaque: true, count: 18240, indexes: [{ name: 'sensors_pkey', cols: [{ c: 'id' }], primary: true, unique: true, valid: true }] },
      status_records: { cols: [{ name: 'id', type: 'bigint', notnull: true, def: 'nextval(\'status_records_id_seq\'::regclass)' }, { name: 'sensor_id', type: 'integer', notnull: true }, { name: 'status', type: 'text', notnull: true }, { name: 'recorded_at', type: 'timestamp with time zone', notnull: true, def: 'now()' }], opaque: true, count: 4213004,
        indexes: [{ name: 'status_records_pkey', cols: [{ c: 'id' }], primary: true, unique: true, valid: true }, { name: 'status_records_recorded_at_idx', cols: [{ c: 'recorded_at' }], valid: true }] }
    };
    if (v === 'a') tables.status_records.indexes.push({ name: 'status_records_sensor_id_recorded_at_idx', cols: [{ c: 'sensor_id' }, { c: 'recorded_at', desc: true }], valid: true });
    var settings = {
      max_connections: { applied: '100', ctx: 'postmaster', desc: 'Sets the maximum number of concurrent connections.' },
      idle_in_transaction_session_timeout: { applied: 0, unit: 'ms', ctx: 'user', desc: 'Sets the maximum allowed idle time between queries, when in a transaction.' },
      statement_timeout: { applied: 0, unit: 'ms', ctx: 'user', desc: 'Sets the maximum allowed duration of any statement.' },
      lock_timeout: { applied: 0, unit: 'ms', ctx: 'user', desc: 'Sets the maximum allowed duration of any wait for a lock.' },
      log_lock_waits: { applied: 'on', ctx: 'superuser', desc: 'Logs long lock waits.' },
      deadlock_timeout: { applied: 1000, unit: 'ms', ctx: 'superuser', desc: 'Sets the time to wait on a lock before checking for deadlock.' },
      log_min_duration_statement: { applied: 1000, unit: 'ms', ctx: 'superuser', desc: 'Sets the minimum execution time above which statements will be logged.' },
      shared_buffers: { applied: '2GB', ctx: 'postmaster', desc: 'Sets the number of shared memory buffers used by the server.' }
    };
    function live() { return s23Backends(state); }
    function lockRows() {
      var out = [];
      live().forEach(function (b) {
        if (b.backend_type !== 'client backend') return;
        if (b.state && b.state !== 'idle') out.push({ locktype: 'virtualxid', database: null, relation: null, virtualxid: (b.pid % 97) + '/' + (b.pid % 1000), mode: 'ExclusiveLock', granted: true, fastpath: true, pid: b.pid, waitstart: null });
        b.locks.forEach(function (l) { out.push({ locktype: 'relation', database: 16390, relation: OIDS[l.rel], virtualxid: null, mode: l.mode, granted: l.granted, fastpath: false, pid: b.pid, waitstart: l.granted ? null : TS(l.since) }); });
      });
      return out;
    }
    var ACT = ['datid', 'datname', 'pid', 'usename', 'application_name', 'client_addr', 'backend_start', 'xact_start', 'query_start', 'state_change', 'wait_event_type', 'wait_event', 'state', 'query', 'backend_type'];
    var db = makeDb({ name: 'beacon', tables: tables, now: state.now, oid: OIDS, settings: settings,
      views: {
        pg_stat_activity: function () {
          var rows = live().map(function (b) { var r = {}; ACT.forEach(function (c) { r[c] = b[c] === undefined ? null : b[c]; }); r.datid = b.datname ? 16390 : null; return r; });
          rows.push({ datid: 16390, datname: 'beacon', pid: db.session.pid, usename: db.session.user, application_name: 'psql', client_addr: '10.0.4.9', backend_start: TS(state.now()), xact_start: TS(state.now()), query_start: TS(state.now()), state_change: TS(state.now()), wait_event_type: null, wait_event: null, state: 'active', query: db.session.sql, backend_type: 'client backend' });
          return { cols: ACT, rows: rows };
        },
        pg_locks: function () { return { cols: ['locktype', 'database', 'relation', 'virtualxid', 'mode', 'granted', 'fastpath', 'pid', 'waitstart'], rows: lockRows() }; },
        pg_settings: function () { return { cols: ['name', 'setting', 'unit', 'context', 'source', 'pending_restart'], rows: Object.keys(settings).sort().map(function (k2) { var x = settings[k2], pend = db.autoConf[k2] != null && String(db.autoConf[k2]) !== String(x.applied); return { name: k2, setting: String(x.applied), unit: x.unit || null, context: x.ctx, source: db.autoConf[k2] != null && !pend ? 'configuration file' : 'configuration file', pending_restart: pend && x.ctx === 'postmaster' }; }) }; },
        pg_stat_user_tables: function () {
          var n = Math.floor(state.clock / 10), bad = v === 'b' && !s23Healthy(state);
          return { cols: ['relid', 'relname', 'seq_scan', 'seq_tup_read', 'idx_scan', 'n_live_tup', 'n_dead_tup', 'last_autovacuum'], rows: [
            { relid: OIDS.sensors, relname: 'sensors', seq_scan: 12, seq_tup_read: 218880, idx_scan: 9822104 + n * 140, n_live_tup: 18240, n_dead_tup: 311, last_autovacuum: TS(7 * 3600 + 1222) },
            { relid: OIDS.status_records, relname: 'status_records', seq_scan: v === 'b' ? 21877 + (bad ? n * 41 : 0) : 3, seq_tup_read: v === 'b' ? 92156803440 + (bad ? n * 172733164 : 0) : 12639012, idx_scan: 6120992 + n * 300, n_live_tup: 4213004, n_dead_tup: 20311, last_autovacuum: TS(4 * 3600 + 3017) }] };
        },
        pg_indexes: function () { var rows = []; Object.keys(tables).forEach(function (t) { tables[t].indexes.forEach(function (ix) { rows.push({ schemaname: 'public', tablename: t, indexname: ix.name, indexdef: 'CREATE ' + (ix.unique ? 'UNIQUE ' : '') + 'INDEX ' + ix.name + ' ON public.' + t + ' USING btree (' + ix.cols.map(function (c) { return c.c + (c.desc ? ' DESC' : ''); }).join(', ') + ')' }); }); }); return { cols: ['schemaname', 'tablename', 'indexname', 'indexdef'], rows: rows }; }
      },
      fns: {
        pg_blocking_pids: function (pid) { return s23Blocking(live(), pid); },
        pg_cancel_backend: function (pid) { return signal(pid, false); },
        pg_terminate_backend: function (pid) { return signal(pid, true); },
        pg_reload_conf: function () { reloadConf(); return true; },
        current_setting: function (n) { if (!settings[n]) throw sqlErr('unrecognized configuration parameter "' + n + '"'); return db.showVal(n, db.effective(n, db.session.user)); }
      },
      hooks: {
        touch: function (table) {
          if (v === 'a' && table === 'sensors' && !s23Healthy(state)) { var e = sqlErr('canceling statement due to user request'); e.pre = '(simulation: this statement waited 30 s for a lock on "sensors" and you pressed Ctrl-C)\nCancel request sent\n'; state.clock += 30; throw e; }
        },
        explain: function (q, analyze) { return s23Plan(state, q, analyze); },
        afterExplain: function (plan) { var txt = plan.join('\n'); if (/Seq Scan on status_records/.test(txt) && /Filter: \(sensor_id/.test(txt)) state.flags.seqscan = true; },
        alterSystem: function (name, val) { if (name === 'max_connections' && Number(val) > 100) state.pg.maxConnRaised = true; },
        createIndex: function (t, ix, concurrently) { if (!concurrently && t === 'status_records') { state.pg.blockingDdl = true; state.clock += 40; } }
      } });
    db.roles = ['ops', 'beacon_app', 'deploy', 'report', 'grafana', 'postgres'];
    state.db = db;
    function reloadConf() {
      var lines = ['[1094] LOG:  received SIGHUP, reloading configuration files'];
      Object.keys(db.autoConf).forEach(function (k2) {
        if (settings[k2].ctx === 'postmaster') { if (String(db.autoConf[k2]) !== String(settings[k2].applied)) lines.push('[1094] LOG:  parameter "' + k2 + '" cannot be changed without restarting the server'); return; }
        if (String(settings[k2].applied) !== String(db.autoConf[k2])) { settings[k2].applied = db.autoConf[k2]; lines.push('[1094] LOG:  parameter "' + k2 + '" changed to "' + db.showVal(k2, db.autoConf[k2]) + '"'); }
      });
      pgLog(lines);
    }
    function signal(pid, term) {
      var b = state.pg.backends.filter(function (x) { return x.pid === pid; })[0];
      if (pid === db.session.pid) { if (term) { var e = sqlErr('terminating connection due to administrator command'); e.pre = 'FATAL:  terminating connection due to administrator command\nserver closed the connection unexpectedly\n'; throw e; } return true; }
      if (!b) { pgLog(['[' + db.session.pid + '] ops@beacon WARNING:  PID ' + pid + ' is not a PostgreSQL backend process']); return false; }
      if (b.role === 'bg') { var e2 = sqlErr('permission denied to terminate process'); e2.detail = 'Only roles with superuser privileges may terminate auxiliary processes.'; throw e2; }
      var view = live().filter(function (x) { return x.pid === pid; })[0];
      if (!term) {
        if (view.state === 'active' && b.role === 'app') pgLog(['[' + pid + '] beacon_app@beacon ERROR:  canceling statement due to user request']);
        return true;   /* an idle session has no running statement: a cancel changes nothing */
      }
      var blockers = {};
      live().forEach(function (x) { s23Blocking(live(), x.pid).forEach(function (p) { blockers[p] = 1; }); });
      state.pg.killed.push(pid);
      if (!blockers[pid]) state.pg.innocent.push(pid);
      if (pid === BLOCKER) state.pg.terminatedBlockerConfirmed = state.pg.confirmedAt !== null;
      state.pg.backends = state.pg.backends.filter(function (x) { return x.pid !== pid; });
      pgLog(['[' + pid + '] ' + b.usename + '@beacon FATAL:  terminating connection due to administrator command']);
      if (b.role === 'app') state.pg.backends.push(Object.assign({}, b, { pid: b.pid + 1000, start: state.now() }));
      return true;
    }
    function restartPg(how) {
      state.pg.restarted = state.now();
      var gone = state.pg.backends.filter(function (b) { return b.role !== 'bg'; }).length;
      state.pg.backends = state.pg.backends.filter(function (b) { return b.role === 'bg' || b.role === 'app'; }).map(function (b) { return b.role === 'app' ? Object.assign({}, b, { pid: b.pid + 2000, start: state.now() }) : b; });
      Object.keys(db.autoConf).forEach(function (k2) { settings[k2].applied = db.autoConf[k2]; });
      pgLog(['[1094] LOG:  received fast shutdown request', '[1094] LOG:  aborting any active transactions', '[1094] LOG:  database system is shut down', '[2201] LOG:  database system is ready to accept connections']);
      return res(how === 'stop' ? '' : '(' + gone + ' client connections were dropped; every open transaction was rolled back)');
    }
    var initLog = v === 'a'
      ? ['2026-10-13 09:02:13.311 UTC [48213] deploy@beacon LOG:  statement: ALTER TABLE sensors ADD COLUMN firmware_version text;']
        .concat([51231, 51232, 51236, 51240].map(function (p, i) { var ts = '2026-10-13 09:29:' + (41 + i * 4) + '.207 UTC [' + p + '] beacon_app@beacon '; return ts + 'LOG:  process ' + p + ' still waiting for ' + (i % 2 ? 'AccessShareLock' : 'RowExclusiveLock') + ' on relation 16421 of database 16390 after 1000.084 ms\n' + ts + 'DETAIL:  Process holding the lock: 48213. Wait queue: 51231, 51232, 51233, 51234, 51235, 51236, 51237, 51238, 51239, 51240, 51241, 51242, 51243, 51244, 51245, 51246, 51247, 51248, 51249, 51250.\n' + ts + 'STATEMENT:  ' + (i % 2 ? APP_Q.sel : APP_Q.upd); }))
      : [51231, 51234, 51238, 51243].map(function (p, i) { var ts = '2026-10-13 09:29:' + (40 + i * 5) + '.512 UTC [' + p + '] beacon_app@beacon '; return ts + 'LOG:  duration: ' + (3911 + i * 137) + '.510 ms  execute <unnamed>: ' + APP_Q.hist + '\n' + ts + 'DETAIL:  parameters: $1 = \'' + (42 + i * 311) + '\''; });
    var verbs = {
      psql: psqlVerb(state, db, { user: 'ops', db: 'beacon', hosts: ['beacon-db', 'beacon-db.corp.lab', 'localhost', '127.0.0.1'], users: ['ops', 'postgres', 'deploy', 'beacon_app', 'report', 'grafana'],
        after: function (sql, out) {
          var low = sql.toLowerCase();
          if (/pg_stat_activity/.test(low) && (v === 'a' ? /\bLock\b/.test(out) && /beacon_app|beacon-api/.test(sql + out) : /DataFileRead/.test(out) || (/status_records WHERE sensor_id/.test(out) && /beacon_app|beacon-api/.test(sql + out)))) state.flags.sessions = true;
          if (v === 'a' && /\b48213\b/.test(out)) {
            if (/pg_blocking_pids|pg_locks/.test(low)) state.flags.identified = true;
            if (/ALTER TABLE sensors|idle in transaction/.test(out) && /\bdeploy\b/.test(out) && state.pg.confirmedAt === null) state.pg.confirmedAt = state.now();
          }
        } }),
      curl: function (w, a) {
        var f = S.flags(a, ['o', 'w', 'X', 'H', 'm', 'max-time']), url = f.pos.filter(function (x) { return /^(https?:\/\/)?[a-z0-9.-]+(:\d+)?(\/|$)/i.test(x); }).pop();
        if (!url) return fail('curl: no URL specified!', 2);
        var m = /^(?:https?:\/\/)?([^/:]+)(?::(\d+))?(\/\S*)?$/.exec(url);
        if (!m || !/^beacon-api(\.corp\.lab)?$/.test(m[1])) return fail('curl: (6) Could not resolve host: ' + (m ? m[1] : url) + ' (this lab has http://beacon-api:8080)', 6);
        var path = m[3] || '/', healthy = s23Healthy(state), n = Math.floor(state.clock / 10), code = 200, body = '', t = 0.004;
        if (path === '/metrics') {
          var lines = ['# HELP beacon_db_pool_size Connections the pool may hold (per pod)', '# TYPE beacon_db_pool_size gauge'];
          [['beacon-api-7c9f4-x2k8p', 0], ['beacon-api-7c9f4-q9w1z', 1]].forEach(function (pd) {
            var lb = '{pod="' + pd[0] + '"}';
            lines.push('beacon_db_pool_size' + lb + ' 10', 'beacon_db_pool_in_use' + lb + ' ' + (healthy ? 1 + pd[1] : 10), 'beacon_db_pool_waiting' + lb + ' ' + (healthy ? 0 : (v === 'a' ? 19 : 14) - pd[1] * 2), 'beacon_db_pool_acquire_timeouts_total' + lb + ' ' + (1843 + pd[1] * 97 + (healthy ? 0 : n * 6)), 'beacon_http_request_duration_seconds' + lb.replace('}', ',quantile="0.99"}') + ' ' + (healthy ? '0.081' : v === 'a' ? '5.004' : '4.612'), 'process_cpu_utilisation_ratio' + lb + ' ' + (healthy ? '0.11' : '0.03'));
          });
          body = lines.join('\n');
        } else if (path === '/healthz') body = 'ok';
        else if (/^\/status\/sensor-\d+$/.test(path)) {
          if (healthy) { body = '{"sensor_id":' + path.replace(/\D/g, '') + ',"records":20}'; t = 0.038; }
          else if (v === 'a') { code = 503; t = 5.004; body = '{"error":"timed out after 5.0s waiting for a database connection (pool 10/10 in use, 19 waiting)"}'; }
          else { t = 4.612; body = '{"sensor_id":' + path.replace(/\D/g, '') + ',"records":20}'; }
        } else { code = 404; body = 'not found'; }
        state.clock += Math.floor(t);
        if (typeof f.f.w === 'string') { var wout = f.f.w.replace(/%\{http_code\}/g, String(code)).replace(/%\{time_total\}/g, t.toFixed(6)).replace(/\\n/g, '\n'); return { out: (f.f.o === '/dev/null' ? '' : body + '\n') + wout, code: 0 }; }
        return res((f.f.i ? 'HTTP/1.1 ' + code + (code === 200 ? ' OK' : code === 503 ? ' Service Unavailable' : ' Not Found') + '\n\n' : '') + body);
      },
      systemctl: function (w, a) {
        var unit = String(a[1] || '').replace(/\.service$/, '');
        if (!/^postgresql(@16-main)?$/.test(unit)) return S.unsupported('systemctl', a.join(' '), ['status|reload|restart postgresql']);
        if (a[0] === 'status') return res('● postgresql@16-main.service - PostgreSQL Cluster 16-main\n     Active: active (running) since ' + (state.pg.restarted !== null ? '2026-10-13 ' + hms(state.pg.restarted) : '2026-10-01 04:00:12') + ' UTC\n   Main PID: ' + (state.pg.restarted !== null ? 2201 : 1094) + ' (postgres)\n        CPU: 2.1%');
        if (a[0] === 'restart' || a[0] === 'stop' || a[0] === 'start') return restartPg(a[0]);
        if (a[0] === 'reload') { reloadConf(); return res(''); }
        return S.unsupported('systemctl', a.join(' '), ['status|reload|restart postgresql']);
      },
      pg_ctlcluster: function (w, a) {
        if (a[0] === '16' && a[1] === 'main' && /^(restart|stop|start|reload|status)$/.test(a[2] || '')) { if (a[2] === 'status') return res('pg_ctl: server is running (PID: 1094)'); if (a[2] === 'reload') { reloadConf(); return res(''); } return restartPg(a[2]); }
        return S.unsupported('pg_ctlcluster', a.join(' '), ['16 main status|reload|restart']);
      },
      edit: S.verbs.edit()
    };
    state.hooks.push(function (s, w) { W = w; });
    var files = [
      { path: '/var/log/postgresql/postgresql-16-main.log', content: '2026-10-13 06:00:01.002 UTC [1094] LOG:  checkpoint complete: wrote 1841 buffers (0.7%)\n' + initLog.join('\n') + '\n' },
      { path: '/home/lab/ticket.txt', content: 'INC-5521  Beacon API slow since about 09:05\n- p99 latency went from ~80 ms to ~5 s; some clients get 503s\n- API pods and the database host both show low CPU\n- no deploy of the API today\nAccess: psql -h beacon-db -U ops beacon (ops can signal backends); app metrics at http://beacon-api:8080/metrics\n' }
    ];
    return { user: 'lab', host: 'ops-bastion', cwd: '/home/lab', dirs: [{ path: '/var/log/postgresql' }], files: files, sre: state, extra: S.bind(state, verbs) };
  }
  function s23Fixed(c) {
    var s = st(c);
    if (!s23Healthy(s) || s.pg.restarted !== null) return false;
    if (s.variant === 'a') return s.pg.terminatedBlockerConfirmed && s.pg.killed.indexOf(BLOCKER) !== -1;
    return true;
  }
  function s23Guard(c) {
    var s = st(c), db = s.db;
    if (s.variant === 'a') {
      var sys = db.settings.idle_in_transaction_session_timeout.applied, role = (db.roleSet.deploy || {}).idle_in_transaction_session_timeout, dbs = db.dbSet.idle_in_transaction_session_timeout;
      return [sys, role, dbs].some(function (x) { return x != null && x > 0 && x <= 3600000; });
    }
    var r2 = (db.roleSet.beacon_app || {}).statement_timeout, d2 = db.dbSet.statement_timeout;
    return [r2, d2].some(function (x) { return x != null && x > 0 && x <= 60000; });
  }
  LX.missions.push({
    id: 'sre-s23', track: 'sre', cat: 'scenario', level: 'intermediate', mins: 25, kind: 'incident',
    title: 'Beacon API latency jumped to seconds while every CPU graph is flat',
    brief: function () { return 'INC-5521: since about 09:05 the Beacon API\'s p99 latency has gone from ~80 ms to ~5 s and some clients get 503s. The API pods and the database host both show low CPU, and nothing was deployed to the API today. You are on ops-bastion with `psql -h beacon-db -U ops beacon` (ops may signal backends) and the API metrics at http://beacon-api:8080/metrics. Find where requests are waiting, mitigate with the smallest safe action, and put a guard in place so it cannot recur the same way.'; },
    keys: ['curl -s http://beacon-api:8080/metrics', 'psql -c "SELECT pid, usename, application_name, state, wait_event_type, wait_event, left(query, 50) AS query FROM pg_stat_activity WHERE datname = \'beacon\'"', 'psql -c "SELECT pid, pg_blocking_pids(pid) FROM pg_stat_activity WHERE wait_event_type = \'Lock\'"', 'psql -c "SHOW max_connections"', 'psql -c \'\\d status_records\'', 'tail -n 20 /var/log/postgresql/postgresql-16-main.log', 'cat ticket.txt'],
    world: s23World,
    objectives: [
      { id: 'pool', stage: 'evidence', text: 'Show where API requests are spending their time',
        hint: 'Idle CPU with high latency means the requests are waiting for something. What does a request need before it can run a query?',
        hint2: 'The API exports its database pool: `curl -s http://beacon-api:8080/metrics` and look at in_use and waiting.',
        reveal: 'curl -s http://beacon-api:8080/metrics',
        done: function (c) { return saw(c, /curl\b.*beacon-api/, /beacon_db_pool_waiting\{[^}]*\} [1-9]|waiting for a database connection/); } },
      { id: 'sessions', stage: 'evidence', text: 'See what the database sessions behind the pool are doing',
        hint: 'Every pool connection is a backend in PostgreSQL. Are they running, idle, or waiting — and on what?',
        hint2: '`psql -c "SELECT pid, usename, state, wait_event_type, wait_event, left(query, 50) FROM pg_stat_activity WHERE datname = \'beacon\'"`.',
        reveal: 'psql -c "SELECT pid, usename, state, wait_event_type, wait_event, left(query, 50) AS query FROM pg_stat_activity WHERE datname = \'beacon\' ORDER BY state"',
        done: function (c) { return !!st(c).flags.sessions; } },
      { id: 'culprit', stage: 'evidence', text: 'Find the specific session or query responsible, and confirm what it is before touching anything',
        hint: 'Waiting sessions point at what they wait for. Running sessions can be asked how they run.',
        hint2: 'Lock waits: `pg_blocking_pids(pid)` (or pg_locks), then read that pid\'s row in pg_stat_activity. Slow statements: `EXPLAIN` the query with a literal in place of $1.',
        reveal: function (c) { return st(c).variant === 'a' ? 'psql -c "SELECT DISTINCT pg_blocking_pids(pid) AS blocked_by FROM pg_stat_activity WHERE wait_event_type = \'Lock\'" -c "SELECT pid, usename, application_name, client_addr, state, xact_start, query FROM pg_stat_activity WHERE pid = 48213"' : 'psql -c "EXPLAIN SELECT id, status, recorded_at FROM status_records WHERE sensor_id = 42 ORDER BY recorded_at DESC LIMIT 20"'; },
        done: function (c) { var s = st(c); return s.variant === 'a' ? (!!s.flags.identified || saw(c, /(tail|cat|grep|less|head)\b.*postgresql-16-main\.log/, /Process holding the lock: 48213/)) && s.pg.confirmedAt !== null : !!s.flags.seqscan; } },
      { id: 'mitigate', stage: 'fix', text: 'Mitigate with the smallest action that releases the pool, touching nothing that is not involved',
        hint: 'One session, or one missing access path, is holding twenty connections hostage.',
        hint2: 'A session idle in a transaction cannot be cancelled (nothing is running); terminate exactly that pid. A missing index on a live table is built with CREATE INDEX CONCURRENTLY.',
        reveal: function (c) { return st(c).variant === 'a' ? 'psql -c "SELECT pg_terminate_backend(48213)"' : 'psql -c "CREATE INDEX CONCURRENTLY status_records_sensor_id_recorded_at_idx ON status_records (sensor_id, recorded_at DESC)"'; },
        done: s23Fixed },
      { id: 'guard', stage: 'fix', text: 'Put a database-side guard in place so one session cannot hold the pool like this again',
        hint: 'The pool has no way to defend itself; PostgreSQL has timeouts for exactly this.',
        hint2: 'For a forgotten open transaction: idle_in_transaction_session_timeout (ALTER SYSTEM + pg_reload_conf(), or ALTER ROLE for the role that did it). For slow statements from the app: ALTER ROLE beacon_app SET statement_timeout.',
        reveal: function (c) { return st(c).variant === 'a' ? 'psql -c "ALTER SYSTEM SET idle_in_transaction_session_timeout = \'5min\'" -c "SELECT pg_reload_conf()"' : 'psql -c "ALTER ROLE beacon_app SET statement_timeout = \'2s\'"'; },
        done: s23Guard },
      { id: 'verify', stage: 'verify', text: 'Show that the pool has drained and requests are fast again',
        hint: 'The same signal that showed the problem should show it gone.',
        hint2: '`curl -s http://beacon-api:8080/metrics` — waiting back to 0; or time a request with `curl -s -o /dev/null -w \'%{http_code} %{time_total}\\n\' http://beacon-api:8080/status/sensor-42`.',
        reveal: 'curl -s http://beacon-api:8080/metrics',
        done: function (c) { var o = c.out[c.out.length - 1] || ''; return s23Fixed(c) && lastIs(c, /curl\b.*beacon-api/, /beacon_db_pool_waiting|^200 0\.0/m) && !/beacon_db_pool_waiting\{[^}]*\} [1-9]/.test(o); } }
    ],
    sre: {
      scenarioId: 'S23', moduleId: 'M12', lab: 'L23', variants: ['a', 'b'],
      symptom: 'p99 latency ~5 s and some 503s with low CPU on API and database.',
      neutralTitle: 'Slow API with idle CPU everywhere',
      neutralBrief: 'Since 09:05 the Beacon API p99 latency is ~5 s and some clients get 503s; CPU is low on the API pods and the database host, and nothing was deployed to the API today. Find where requests wait, mitigate safely, and prevent a repeat.',
      impact: 'Sensor submissions and history reads take seconds or fail; clients retry and add load.',
      changes: 'No API deploy today. Database maintenance and reporting jobs run from the bastion at their usual times.',
      spoilers: ['lock', 'idle in transaction', 'blocker', 'migration', 'index', 'seq scan', 'ALTER TABLE', 'pool exhausted'],
      tools: ['psql -c (PostgreSQL 16 subset)', 'curl http://beacon-api:8080/metrics and /status/sensor-N', 'tail/grep the PostgreSQL log', 'systemctl|pg_ctlcluster status|reload|restart postgresql'],
      grammar: ['`psql [-h beacon-db] [-U ops] [beacon] [-x] [-A] [-t] -c "SQL" [-c …]` — SELECT with joins, WHERE, GROUP BY, ORDER BY, LIMIT, subqueries over pg_stat_activity, pg_locks, pg_settings, pg_indexes, pg_stat_user_tables', 'Functions: pg_blocking_pids, pg_cancel_backend, pg_terminate_backend, pg_reload_conf, current_setting, now(), left(), cardinality(); casts ::regclass ::text ::interval', '`EXPLAIN [ANALYZE] SELECT …`, `SHOW name`, `ALTER SYSTEM SET`, `ALTER ROLE … SET`, `CREATE INDEX [CONCURRENTLY]`, `\\d TABLE`, `\\di`', '`curl -s http://beacon-api:8080/metrics`, `curl -s -o /dev/null -w \'%{http_code} %{time_total}\\n\' http://beacon-api:8080/status/sensor-42`', '`tail -n 40 /var/log/postgresql/postgresql-16-main.log`'],
      palette: ['curl -s http://beacon-api:8080/metrics', 'psql -c "SELECT state, wait_event_type, count(*) FROM pg_stat_activity WHERE datname = \'beacon\' GROUP BY state, wait_event_type"', 'psql -x -c "SELECT pid, usename, application_name, state, xact_start, query FROM pg_stat_activity WHERE state LIKE \'idle in%\'"', 'psql -c "SELECT pid, pg_blocking_pids(pid) FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid)) > 0"', 'psql -c "SELECT relation::regclass, mode, granted, pid FROM pg_locks WHERE relation IS NOT NULL"', 'psql -c "SELECT relname, seq_scan, seq_tup_read, idx_scan FROM pg_stat_user_tables"', 'psql -c \'\\d status_records\'', 'tail -n 20 /var/log/postgresql/postgresql-16-main.log'],
      assumptions: ['ops may signal other backends (it has pg_signal_backend).', 'The API holds at most 10 connections per pod and gives up waiting for one after 5 s (503).', 'max_connections is 100 and far from reached: the limit being hit is the app pool\'s.'],
      simplified: ['Backends, locks and the pool are derived from one state; there is no real executor. Joins and filters run over materialised catalog rows; the contents of sensors/status_records are not materialised (EXPLAIN, \\d and pg_stat_user_tables are).', 'Lock conflicts follow PostgreSQL\'s table-level lock matrix for the modes in this incident; row locks are not modelled.', 'EXPLAIN plans and costs are fixed shapes chosen from the indexes that exist, not computed by a planner.', 'Each psql -c is its own connection; BEGIN/COMMIT do not span commands. Each command advances the clock 10 seconds.'],
      unsafe: [
        { label: 'terminated sessions that were not blocking anything', why: 'Killing backends by state (or every idle-in-transaction session) also kills work that was not involved: here a month-end report export lost its transaction, and app connections were cut mid-request.',
          test: function (c) { return st(c).pg.innocent.length > 0; },
          demo: 'psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = \'idle in transaction\'"' },
        { label: 'restarted PostgreSQL', why: 'A restart drops every connection and rolls back every transaction in the cluster to fix one session or one query, and it destroys the evidence.',
          test: function (c) { return st(c).pg.restarted !== null; }, demo: 'systemctl restart postgresql' },
        { label: 'raised max_connections blindly', why: 'The server is nowhere near 100 connections; the wait is in the app pool. More connections means more waiters (or more concurrent full scans), more memory, and a restart.',
          test: function (c) { return !!st(c).pg.maxConnRaised; }, demo: 'psql -c "ALTER SYSTEM SET max_connections = 500"' },
        { label: 'built an index with a lock that blocks writes on a live table', why: 'Plain CREATE INDEX takes a SHARE lock: every INSERT into the 4.2M-row status_records waits until the build finishes. On a live table use CREATE INDEX CONCURRENTLY.',
          test: function (c) { return !!st(c).pg.blockingDdl; }, demo: 'psql -c "CREATE INDEX status_records_sensor_idx ON status_records (sensor_id)"' }
      ],
      alt: function (v) {
        if (v === 'a') return ['curl -s -o /dev/null -w \'%{http_code} %{time_total}\\n\' http://beacon-api:8080/status/sensor-42', 'curl -s http://beacon-api:8080/status/sensor-42', 'tail -n 20 /var/log/postgresql/postgresql-16-main.log',
          'psql -c "SELECT state, wait_event_type, count(*) FROM pg_stat_activity WHERE usename = \'beacon_app\' GROUP BY state, wait_event_type"',
          'psql -x -c "SELECT pid, usename, application_name, client_addr, state, now() - xact_start AS open_for, query FROM pg_stat_activity WHERE state LIKE \'idle in%\' ORDER BY xact_start"',
          'psql -c "SELECT pg_cancel_backend(48213)"', 'psql -c "SELECT pid, state FROM pg_stat_activity WHERE pid = 48213"', 'psql -c "SELECT pg_terminate_backend(48213)"',
          'psql -c "ALTER ROLE deploy SET idle_in_transaction_session_timeout = \'10min\'"', 'psql -c "SHOW idle_in_transaction_session_timeout"',
          'curl -s -o /dev/null -w \'%{http_code} %{time_total}\\n\' http://beacon-api:8080/status/sensor-42'];
        return ['curl -s http://beacon-api:8080/metrics | grep pool', 'psql -c "SELECT wait_event, query, count(*) FROM pg_stat_activity WHERE usename = \'beacon_app\' GROUP BY wait_event, query"', 'psql -c "SELECT relname, seq_scan, seq_tup_read, idx_scan FROM pg_stat_user_tables"', 'psql -c \'\\d status_records\'',
          'psql -c "EXPLAIN ANALYZE SELECT id, status, recorded_at FROM status_records WHERE sensor_id = 1187 ORDER BY recorded_at DESC LIMIT 20"',
          'psql -c "CREATE INDEX CONCURRENTLY IF NOT EXISTS status_records_sensor_id_idx ON status_records (sensor_id)"',
          'psql -c "EXPLAIN SELECT id, status, recorded_at FROM status_records WHERE sensor_id = 1187 ORDER BY recorded_at DESC LIMIT 20"',
          'psql -c "ALTER DATABASE beacon SET statement_timeout = \'5s\'"',
          'curl -s -o /dev/null -w \'%{http_code} %{time_total}\\n\' http://beacon-api:8080/status/sensor-42'];
      },
      mechanism: 'Latency rose with idle CPU because requests were **waiting**, not working: each API pod holds at most 10 database connections, all 20 were busy, and further requests queued for a connection until the pool\'s 5 s timeout (503). In variant a, a migration session ran `ALTER TABLE sensors ADD COLUMN …` inside a transaction and then sat **idle in transaction**: it holds an ACCESS EXCLUSIVE lock on sensors until it commits or ends, so every app statement touching sensors waits on it (pg_blocking_pids and the lock-wait log name pid 48213), and each waiter pins a pool connection. pg_cancel_backend does nothing to an idle session (no statement is running); pg_terminate_backend on exactly that pid ends the transaction (the ALTER is rolled back) and the waiters complete at once. The older idle-in-transaction report session holds only a share lock that blocks nobody, so killing it fixes nothing. In variant b nothing blocks: a history query filters status_records by sensor_id with no index for it, so each call is a 4-second sequential scan holding a connection; CREATE INDEX CONCURRENTLY gives it an index scan without blocking writes. Guards: idle_in_transaction_session_timeout ends forgotten transactions in future (it does not reach back into a session that is already idle); a statement_timeout on the app role caps how long one query can hold a pool slot. Raising max_connections or restarting the server treats neither cause.',
      alternatives: [
        { h: 'The database is overloaded', out: 'Ruled out: low CPU, and pg_stat_activity shows sessions waiting (Lock) or reading (DataFileRead) on one statement shape, not a general overload.' },
        { h: 'max_connections was reached', out: 'Ruled out: about 30 of 100 connections are in use; the limit being hit is the app pool\'s 10 per pod.' },
        { h: 'Kill the oldest idle-in-transaction session', out: 'Wrong session: the oldest one is the report export, holding a lock nothing waits for; pg_blocking_pids names the real one.' }
      ],
      clues: ['The report session (monthly-export) has been idle in a transaction longer than anything else; age alone is not evidence of blocking.'],
      passRubric: ['Explains why latency rose while CPU stayed idle (waiting for a pool slot, not computing)', 'Names the evidence that identified the culprit (blocking pids or the plan) and confirms it before acting', 'Explains why the chosen action is the smallest safe one, and why a cancel did or did not work', 'States the guard and what it would and would not catch'],
      prereqs: ['les-m12-01', 'les-m12-02'], refs: ['T09']
    }
  });

  /* ═══ S24 · Job processed twice after worker restart ═══════════════ */
  var S24_NOW = 9 * 3600 + 40 * 60;
  var WORKER_PY = [
    '#!/usr/bin/env python3',
    '"""beacon worker: turns order events from the beacon-notify queue into notification rows.',
    '',
    'beacon-mailer e-mails every row in notifications exactly once, so one row = one e-mail.',
    '"""',
    '# sim: guard-on-conflict = /INSERT INTO notifications[^\\n]*ON CONFLICT\\s*\\(\\s*message_id\\s*\\)\\s*DO NOTHING/i',
    '# sim: guard-processed = /INSERT INTO processed_messages[^\\n]*ON CONFLICT[^\\n]*DO NOTHING[\\s\\S]*rowcount\\s*==\\s*0/i',
    '# sim: extends-visibility = /queue\\.extend_visibility\\(\\s*msg/',
    '# sim: ack-before-insert = /^    queue\\.ack\\(msg\\)[^\\n]*\\n[\\s\\S]*INSERT INTO notifications/m',
    'import json',
    'import logging',
    '',
    'from beacon import db, queue, render',
    '',
    'log = logging.getLogger("beacon.worker")',
    '',
    '',
    'def handle(msg):',
    '    order = json.loads(msg.body)',
    '    body = render.notification(order)    # invoice PDFs take ~45 s; confirmations well under 1 s',
    '    with db.transaction():',
    '        db.execute(',
    '            "INSERT INTO notifications (message_id, order_id, kind, body) VALUES (%s, %s, %s, %s)",',
    '            (msg.id, order["order_id"], order["kind"], body),',
    '        )',
    '    queue.ack(msg)                       # only after the row is committed',
    '',
    '',
    'def main():',
    '    for msg in queue.receive("beacon-notify"):',
    '        handle(msg)',
    '',
    '',
    'if __name__ == "__main__":',
    '    main()',
    ''
  ].join('\n');
  var WORKER_ENV = '# EnvironmentFile for beacon-worker@.service\nQUEUE=beacon-notify\n# true: ack after the database commit (at-least-once); false: ack on receipt\nACKS_LATE=true\nPREFETCH=1\n';
  function s24World(seed) {
    var S = SIM(), v = S.variantOf(seed, ['a', 'b']);
    var state = { clock: 0, risky: [], seed: seed, variant: v, hooks: [], flags: {}, nextPid: 61001, replays: [] };
    state.now = function () { return S24_NOW + state.clock; };
    var base = v === 'a' ? 1031 : 2061, slow = v === 'a' ? [] : [base + 8, base + 16, base + 22];
    var dupIds = v === 'a' ? ['m-' + (base + 5), 'm-' + (base + 11)] : slow.map(function (n) { return 'm-' + n; });
    var rows = [], qlog = [], wlog = { 1: [], 2: [] }, archive = {}, id = 0;
    function L(t, s) { return isoZ(t) + ' ' + s; }
    function row(mid, ord, kind, t) { rows.push({ id: ++id, message_id: mid, order_id: ord, kind: kind, body: kind === 'invoice-pdf' ? 'Invoice for ' + ord + ' (PDF attached)' : 'Order ' + ord + ' confirmed', created_at: TS(t) }); return id; }
    for (var k = 0; k < 24; k++) {
      var mid = 'm-' + (base + k), t0 = 8 * 3600 + k * 180, kind = slow.indexOf(base + k) !== -1 ? 'invoice-pdf' : 'order-confirmation', ord = 'o-' + (7700 + k + (v === 'a' ? 0 : 400));
      archive[mid] = { kind: kind, order: ord };
      var wk = (k % 2) + 1, ow = wk === 1 ? 2 : 1;
      qlog.push(L(t0, 'deliver ' + mid + ' to=worker-' + wk + ' receive_count=1 visibility_timeout=' + (v === 'a' ? 60 : 30) + 's'));
      wlog[wk].push(L(t0, 'processing ' + mid + ' (order ' + ord + ', ' + kind + ')'));
      if (v === 'a' && dupIds.indexOf(mid) !== -1) {
        wlog[wk].push(L(t0 + 1, 'inserted notification id=' + row(mid, ord, kind, t0 + 1) + ' for ' + mid));
        wlog[wk].push(L(t0 + 1, 'systemd[1]: Stopping beacon-worker@' + wk + '.service (' + (k === 5 ? 'deploy beacon-worker 2.3.1' : 'config push') + ')...'));
        wlog[wk].push(L(t0 + 1, 'systemd[1]: beacon-worker@' + wk + '.service: Deactivated successfully.'));
        wlog[wk].push(L(t0 + 3, 'systemd[1]: Started beacon-worker@' + wk + '.service - Beacon worker ' + wk + '.'));
        qlog.push(L(t0 + 60, 'visibility timeout expired: ' + mid + ' (no ack from worker-' + wk + '); message visible again'));
        qlog.push(L(t0 + 61, 'deliver ' + mid + ' to=worker-' + ow + ' receive_count=2 visibility_timeout=60s'));
        wlog[ow].push(L(t0 + 61, 'processing ' + mid + ' (order ' + ord + ', ' + kind + ')'));
        wlog[ow].push(L(t0 + 62, 'inserted notification id=' + row(mid, ord, kind, t0 + 61) + ' for ' + mid));
        qlog.push(L(t0 + 62, 'ack ' + mid + ' by=worker-' + ow));
      } else if (kind === 'invoice-pdf') {
        qlog.push(L(t0 + 30, 'visibility timeout expired: ' + mid + ' (no ack from worker-' + wk + ' yet); message visible again'));
        qlog.push(L(t0 + 31, 'deliver ' + mid + ' to=worker-' + ow + ' receive_count=2 visibility_timeout=30s'));
        wlog[ow].push(L(t0 + 31, 'processing ' + mid + ' (order ' + ord + ', ' + kind + ')'));
        wlog[wk].push(L(t0 + 45, 'inserted notification id=' + row(mid, ord, kind, t0 + 45) + ' for ' + mid));
        qlog.push(L(t0 + 45, 'ack ' + mid + ' by=worker-' + wk + ' (stale receipt: the message was redelivered at ' + hms(t0 + 31) + ')'));
        wlog[ow].push(L(t0 + 76, 'inserted notification id=' + row(mid, ord, kind, t0 + 76) + ' for ' + mid));
        qlog.push(L(t0 + 76, 'ack ' + mid + ' by=worker-' + ow));
      } else {
        wlog[wk].push(L(t0 + 1, 'inserted notification id=' + row(mid, ord, kind, t0 + 1) + ' for ' + mid));
        qlog.push(L(t0 + 1, 'ack ' + mid + ' by=worker-' + wk));
      }
    }
    state.q = { name: 'beacon-notify', visibility: v === 'a' ? 60 : 30, maxReceive: 5, pending: [], dlq: [], log: qlog, archive: archive, seq: base + 24, dupIds: dupIds, replayId: dupIds[dupIds.length - 1] };
    state.wlog = wlog;
    state.deletedWhileUnguarded = false;
    var tables = {
      notifications: { serial: id, cols: [{ name: 'id', type: 'bigint', notnull: true, def: 'nextval(\'notifications_id_seq\'::regclass)', serial: true }, { name: 'message_id', type: 'text', notnull: true }, { name: 'order_id', type: 'text', notnull: true }, { name: 'kind', type: 'text', notnull: true }, { name: 'body', type: 'text' }, { name: 'created_at', type: 'timestamp with time zone', notnull: true, def: 'now()' }],
        rows: rows, indexes: [{ name: 'notifications_pkey', cols: [{ c: 'id' }], primary: true, unique: true, valid: true }, { name: 'notifications_order_id_idx', cols: [{ c: 'order_id' }], valid: true }] }
    };
    function procOf(text) { var p = S.probeState(text || ''); return { onConflict: !!p['guard-on-conflict'], processed: !!p['guard-processed'], extends: !!p['extends-visibility'], ackFirst: !!p['ack-before-insert'] }; }
    function envAcksLate(text) { var x = S.kvGet(text || '', 'ACKS_LATE'); return !x || !/^(false|0|no)\b/i.test(x); }
    var initRun = procOf(WORKER_PY);
    initRun.acksLate = true;
    state.workers = { 1: { active: true, run: initRun, since: 6 * 3600 }, 2: { active: true, run: S.clone(initRun), since: 6 * 3600 } };
    function guarded(run) { return run.onConflict || run.processed; }
    function qlogAdd(s) { state.q.log.push(L(state.now(), s)); }
    function wlogAdd(wid, s) { state.wlog[wid].push(L(state.now(), s)); }
    function ackFirst(run) { return !run.acksLate || run.ackFirst; }
    /* the side effect, with the database rules the running code relies on */
    function sideEffect(msg, run) {
      var N = db.tables.notifications, P = db.tables.processed_messages, has = N.rows.some(function (r) { return r.message_id === msg.id; });
      if (run.processed) {
        if (!P) return { ok: false, err: 'relation "processed_messages" does not exist' };
        if (!uniqueOn(P, 'message_id')) return { ok: false, err: 'there is no unique or exclusion constraint matching the ON CONFLICT specification' };
        if (P.rows.some(function (r) { return r.message_id === msg.id; })) return { ok: true, inserted: false, how: 'processed_messages already has ' + msg.id + ', skipped' };
      }
      var uq = uniqueOn(N, 'message_id');
      if (run.onConflict && !uq) return { ok: false, err: 'there is no unique or exclusion constraint matching the ON CONFLICT specification' };
      if (has && uq) {
        if (!run.onConflict) return { ok: false, err: 'duplicate key value violates unique constraint "' + uq.name + '"' };
        if (run.processed) P.rows.push({ message_id: msg.id, processed_at: TS(state.now()) });
        return { ok: true, inserted: false, how: 'INSERT … ON CONFLICT (message_id) DO NOTHING → INSERT 0 0' };
      }
      if (run.processed) P.rows.push({ message_id: msg.id, processed_at: TS(state.now()) });
      var a = state.q.archive[msg.id] || { kind: 'order-confirmation', order: 'o-0' };
      N.rows.push({ id: ++N.serial, message_id: msg.id, order_id: a.order, kind: a.kind, body: a.kind === 'invoice-pdf' ? 'Invoice for ' + a.order + ' (PDF attached)' : 'Order ' + a.order + ' confirmed', created_at: TS(state.now()) });
      return { ok: true, inserted: true, id: N.serial };
    }
    function receive(msg, wid) {
      var run = state.workers[wid].run, ar = state.q.archive[msg.id] || {};
      msg.rc = (msg.rc || 0) + 1;
      qlogAdd('deliver ' + msg.id + ' to=worker-' + wid + ' receive_count=' + msg.rc + ' visibility_timeout=' + state.q.visibility + 's');
      wlogAdd(wid, 'processing ' + msg.id + ' (order ' + ar.order + ', ' + ar.kind + ')');
      if (ackFirst(run)) qlogAdd('ack ' + msg.id + ' by=worker-' + wid + ' (on receipt)');
    }
    function finish(msg, wid, note) {
      var run = state.workers[wid].run, early = ackFirst(run), r = sideEffect(msg, run);
      if (!r.ok) {
        wlogAdd(wid, 'ERROR ' + r.err + ' — transaction rolled back, message not acked');
        if (early) { wlogAdd(wid, msg.id + ' was already acked on receipt: this notification is lost'); return { lost: true }; }
        for (var i = msg.rc + 1; i <= state.q.maxReceive; i++) { qlogAdd('visibility timeout expired: ' + msg.id + '; deliver to=worker-' + wid + ' receive_count=' + i); wlogAdd(wid, 'ERROR ' + r.err + ' (attempt ' + i + ')'); }
        qlogAdd('moved ' + msg.id + ' to beacon-notify-dlq after ' + state.q.maxReceive + ' receives');
        state.q.dlq.push(msg.id);
        return { error: r.err };
      }
      wlogAdd(wid, r.inserted ? 'inserted notification id=' + r.id + ' for ' + msg.id : msg.id + ': ' + r.how);
      if (!early) qlogAdd('ack ' + msg.id + ' by=worker-' + wid + (note || ''));
      return { inserted: r.inserted };
    }
    function handle(msg, wid) { receive(msg, wid); return finish(msg, wid); }
    function activeIds() { return ['1', '2'].filter(function (k2) { return state.workers[k2].active; }); }
    function deliver(msg) {
      var ids = activeIds();
      if (!ids.length) return null;
      var a = state.q.archive[msg.id] || {}, proc = a.kind === 'invoice-pdf' ? 45 : 1, w0 = ids[0], run = state.workers[w0].run, vis = state.q.visibility, results = [];
      receive(msg, w0);
      if (proc > vis && !run.extends) {
        var w1 = ids[1] || ids[0], m2 = { id: msg.id, rc: msg.rc };
        state.clock += vis;
        qlogAdd('visibility timeout expired: ' + msg.id + ' (no ack from worker-' + w0 + ' yet); message visible again');
        state.clock += 1;
        receive(m2, w1);
        state.clock += proc - vis - 1;
        results.push(finish(msg, w0, ' (stale receipt: the message was redelivered at ' + hms(state.now() - (proc - vis - 1)) + ')'));
        state.clock += vis + 1;
        results.push(finish(m2, w1));
      } else {
        if (run.extends && proc > vis) wlogAdd(w0, 'extended visibility of ' + msg.id + ' while rendering');
        state.clock += proc;
        results.push(finish(msg, w0));
      }
      return results;
    }
    /* stopping a worker interrupts the message it is working on after the
       side effect and before the ack (SIGTERM, no graceful drain) */
    function stopWorker(wid) {
      var Wk = state.workers[wid];
      if (!Wk.active) return;
      var mid = 'm-' + (state.q.seq++), msg = { id: mid, rc: 1 };
      state.q.archive[mid] = { kind: 'order-confirmation', order: 'o-' + (8200 + state.q.seq) };
      qlogAdd('deliver ' + mid + ' to=worker-' + wid + ' receive_count=1 visibility_timeout=' + state.q.visibility + 's');
      wlogAdd(wid, 'processing ' + mid + ' (order ' + state.q.archive[mid].order + ', order-confirmation)');
      if (ackFirst(Wk.run)) {
        qlogAdd('ack ' + mid + ' by=worker-' + wid + ' (on receipt)');
        wlogAdd(wid, 'systemd[1]: Stopping beacon-worker@' + wid + '.service... (SIGTERM before the insert: ' + mid + ' was already acked and is now lost)');
      } else {
        var r = sideEffect(msg, Wk.run);
        wlogAdd(wid, r.ok ? (r.inserted ? 'inserted notification id=' + r.id + ' for ' + mid : mid + ': ' + r.how) : 'ERROR ' + r.err);
        wlogAdd(wid, 'systemd[1]: Stopping beacon-worker@' + wid + '.service... (SIGTERM; exiting before the ack of ' + mid + ')');
        state.q.pending.push({ id: mid, rc: 1, dueAt: state.now() + state.q.visibility });
      }
      Wk.active = false;
    }
    function startWorker(w, wid) {
      var Wk = state.workers[wid];
      if (Wk.active) return;
      Wk.run = procOf(S.readFile(w, '/opt/beacon/worker.py'));
      Wk.run.acksLate = envAcksLate(S.readFile(w, '/etc/beacon/worker.env'));
      Wk.active = true; Wk.since = state.now();
      wlogAdd(wid, 'systemd[1]: Started beacon-worker@' + wid + '.service - Beacon worker ' + wid + '.');
    }
    state.hooks.push(function (s) {
      if (!activeIds().length) return;
      var due = s.q.pending.filter(function (p) { return p.dueAt <= s.now(); });
      if (!due.length) return;
      s.q.pending = s.q.pending.filter(function (p) { return p.dueAt > s.now(); });
      due.forEach(function (p) { qlogAdd('visibility timeout expired: ' + p.id + ' (no ack); message visible again'); handle(p, activeIds()[0]); });
    });
    var db = makeDb({ name: 'beacon', tables: tables, now: state.now, oid: { notifications: 16502 }, settings: { statement_timeout: { applied: 0, unit: 'ms', ctx: 'user' }, max_connections: { applied: '100', ctx: 'postmaster' } },
      views: {
        pg_indexes: function () { var r = []; Object.keys(db.tables).forEach(function (t) { (db.tables[t].indexes || []).forEach(function (ix) { r.push({ schemaname: 'public', tablename: t, indexname: ix.name, indexdef: 'CREATE ' + (ix.unique ? 'UNIQUE ' : '') + 'INDEX ' + ix.name + ' ON public.' + t + ' USING btree (' + ix.cols.map(function (c) { return c.c; }).join(', ') + ')' }); }); }); return { cols: ['schemaname', 'tablename', 'indexname', 'indexdef'], rows: r }; },
        pg_stat_activity: function () { var r = activeIds().map(function (k2) { return { pid: 60010 + +k2, usename: 'beacon_worker', application_name: 'beacon-worker@' + k2, state: 'idle', query: 'COMMIT', xact_start: null }; }); r.push({ pid: 60020, usename: 'beacon_mailer', application_name: 'beacon-mailer', state: 'idle', query: 'SELECT id, body FROM notifications WHERE id > $1 ORDER BY id', xact_start: null }); r.push({ pid: db.session.pid, usename: db.session.user, application_name: 'psql', state: 'active', query: db.session.sql, xact_start: TS(state.now()) }); return { cols: ['pid', 'usename', 'application_name', 'state', 'xact_start', 'query'], rows: r }; }
      },
      hooks: {
        afterDelete: function (t, gone) { if (t === 'notifications' && gone.length && activeIds().some(function (k2) { return !guarded(state.workers[k2].run); })) state.deletedWhileUnguarded = true; }
      } });
    db.roles = ['ops', 'beacon_worker', 'beacon_mailer'];
    state.db = db;
    function idRe(x) { return new RegExp('(^|[\\s(])' + x + '([\\s;:)]|$)'); }
    var verbs = {
      psql: psqlVerb(state, db, { user: 'ops', db: 'beacon', hosts: ['beacon-db', 'beacon-db.corp.lab', 'localhost', '127.0.0.1'], users: ['ops', 'postgres'],
        after: function (sql, out) {
          if (!/notifications/i.test(sql)) return;
          state.q.dupIds.forEach(function (d) {
            if (out.split(d).length - 1 >= 2 || out.split('\n').some(function (l) { return l.indexOf(d) !== -1 && /(^|\|)\s*[2-9]\s*(\||$)/.test(l); })) state.flags.dupes = true;
          });
          var last = state.replays[state.replays.length - 1];
          if (last && (sql.indexOf(last.id) !== -1 || out.indexOf(last.id) !== -1) && state.clock > last.clock) last.checked = true;
        } }),
      queuectl: function (w, a) {
        var q = state.q, sub = a[0];
        var SUP = ['stats', 'log [--message ID] [-n N]', 'show ID', 'replay ID', 'set visibility-timeout SECONDS', 'dlq'];
        if (sub === 'stats' || !sub) return res('queue:                  ' + q.name + '\nvisibility_timeout:     ' + q.visibility + 's\nmax_receive_count:      ' + q.maxReceive + ' (then beacon-notify-dlq)\nvisible:                0\nin_flight:              ' + q.pending.length + '\ndead_letter_depth:      ' + q.dlq.length + '\ndelivery:               at-least-once (a message is handed out again if it is not acked within visibility_timeout)');
        if (sub === 'log') {
          var mi = a.indexOf('--message'), ni = a.indexOf('-n'), lines = q.log;
          if (mi !== -1) { var re = idRe(a[mi + 1] || '-'); lines = lines.filter(function (l) { return re.test(l); }); }
          return res(lines.slice(-(ni !== -1 ? +a[ni + 1] || 40 : 40)).join('\n'));
        }
        if (sub === 'show') {
          var mid = a[1], ar = q.archive[mid];
          if (!ar) return fail('queuectl: no message ' + (mid || '') + ' in the retention window', 1);
          var re2 = idRe(mid);
          return res('message_id: ' + mid + '\nbody: {"order_id": "' + ar.order + '", "kind": "' + ar.kind + '"}\nhistory:\n  ' + q.log.filter(function (l) { return re2.test(l); }).join('\n  '));
        }
        if (sub === 'set' && a[1] === 'visibility-timeout') {
          var n = parseInt(a[2], 10);
          if (!(n > 0 && n <= 43200)) return fail('queuectl: visibility-timeout must be 1..43200 seconds', 2);
          q.visibility = n;
          return res('beacon-notify: visibility_timeout=' + n + 's');
        }
        if (sub === 'dlq') return res(q.dlq.length ? q.dlq.join('\n') : '(dead-letter queue empty)');
        if (sub === 'replay') {
          var rid = a[1];
          if (!q.archive[rid]) return fail('queuectl: no message ' + (rid || '') + ' in the retention window', 1);
          var count = function () { return db.tables.notifications.rows.filter(function (r) { return r.message_id === rid; }).length; };
          var before = count(), dlq0 = q.dlq.length, msg = { id: rid, rc: 0 }, startLog = q.log.length;
          var wl0 = { 1: state.wlog[1].length, 2: state.wlog[2].length };
          var out = deliver(msg);
          if (!out) { q.pending.push({ id: rid, rc: 0, dueAt: state.now() }); state.replays.push({ id: rid, clock: state.clock, ok: false, checked: false }); return res('queuectl: re-sent ' + rid + ' (same message id and body); no worker is running, so it waits in the queue'); }
          var allGuard = activeIds().every(function (k2) { return guarded(state.workers[k2].run); });
          state.replays.push({ id: rid, clock: state.clock, ok: count() === before && q.dlq.length === dlq0 && allGuard, checked: false });
          var tl = q.log.slice(startLog).map(function (l, i) { return { t: l.slice(0, 20), o: (/^ack /.test(l.slice(21)) ? 200 : 0) + i, s: l.slice(0, 21) + 'queue     ' + l.slice(21) }; });
          ['1', '2'].forEach(function (k2) { state.wlog[k2].slice(wl0[k2]).forEach(function (l, i) { tl.push({ t: l.slice(0, 20), o: 100 + i, s: l.slice(0, 21) + 'worker-' + k2 + '  ' + l.slice(21) }); }); });
          tl.sort(function (x, y) { return x.t < y.t ? -1 : x.t > y.t ? 1 : x.o - y.o; });
          return res('queuectl: re-sent ' + rid + ' (same message id and body) to ' + q.name + '\n' + tl.map(function (x) { return x.s; }).join('\n'));
        }
        return S.unsupported('queuectl', a.join(' '), SUP);
      },
      systemctl: function (w, a) {
        var verb = a[0], unit = String(a[1] || '').replace(/\.service$/, ''), m = /^beacon-worker(?:@([12]))?$/.exec(unit);
        if (!m) return S.unsupported('systemctl', a.join(' '), ['status|start|stop|restart beacon-worker[@1|@2]']);
        var ids = m[1] ? [m[1]] : ['1', '2'];
        if (verb === 'status') return { out: ids.map(function (k2) { var Wk = state.workers[k2]; return '● beacon-worker@' + k2 + '.service - Beacon worker ' + k2 + '\n     Active: ' + (Wk.active ? 'active (running) since ' + hms(Wk.since) : 'inactive (dead)') + '\n   Main PID: ' + (Wk.active ? 3300 + +k2 : '-') + ' (python3 /opt/beacon/worker.py)'; }).join('\n\n') + '\n', code: ids.every(function (k2) { return state.workers[k2].active; }) ? 0 : 3 };
        if (verb === 'stop') { ids.forEach(stopWorker); return res(''); }
        if (verb === 'start') { ids.forEach(function (k2) { startWorker(w, k2); }); return res(''); }
        if (verb === 'restart') { ids.forEach(function (k2) { stopWorker(k2); startWorker(w, k2); }); return res(''); }
        return S.unsupported('systemctl', a.join(' '), ['status|start|stop|restart beacon-worker[@1|@2]']);
      },
      journalctl: function (w, a) {
        var ui = a.indexOf('-u'), unit = ui !== -1 ? String(a[ui + 1] || '') : '', m = /^beacon-worker@([12])(\.service)?$/.exec(unit), ni = a.indexOf('-n');
        if (!m) return S.unsupported('journalctl', a.join(' '), ['journalctl -u beacon-worker@1|beacon-worker@2 [-n N]']);
        return res(state.wlog[m[1]].slice(-(ni !== -1 ? +a[ni + 1] || 30 : 30)).join('\n'));
      },
      python3: function () { return fail('python3: the worker runs under systemd here (systemctl status beacon-worker); this simulator does not execute Python. L24 runs the real worker.', 2); },
      edit: S.verbs.edit()
    };
    var files = [
      { path: '/opt/beacon/worker.py', content: WORKER_PY },
      { path: '/etc/beacon/worker.env', content: WORKER_ENV },
      { path: '/home/lab/ticket.txt', content: 'INC-5530  Customers received the same e-mail twice\n- ' + (v === 'a' ? 'two orders this morning got two "order confirmed" e-mails each' : 'every invoice e-mail this morning was sent twice') + '\n- beacon-mailer sends one e-mail per row in the notifications table\n- workers: beacon-worker@1 and @2 (systemd), code in /opt/beacon/worker.py, settings in /etc/beacon/worker.env\n- queue: beacon-notify (queuectl), database: psql -h beacon-db -U ops beacon\n' + (v === 'b' ? '- last week the queue visibility timeout was lowered from 120 s to 30 s so crashed messages retry faster\n' : '- the worker was redeployed at 08:15 and its config pushed at 08:33\n') }
    ];
    return { user: 'lab', host: 'ops-bastion', cwd: '/home/lab', dirs: [{ path: '/opt/beacon' }, { path: '/etc/beacon' }], files: files, sre: state, extra: S.bind(state, verbs) };
  }
  function s24DbGuard(s) { var N = s.db.tables.notifications, P = s.db.tables.processed_messages; return { onConflict: !!uniqueOn(N, 'message_id'), processed: !!(P && uniqueOn(P, 'message_id')) }; }
  function s24Probes(c) { var p = SIM().probeState(SIM().readFile(c.w, '/opt/beacon/worker.py') || ''); return { onConflict: !!p['guard-on-conflict'], processed: !!p['guard-processed'], extends: !!p['extends-visibility'], ackFirst: !!p['ack-before-insert'] }; }
  function s24Supported(run, g) { return (run.onConflict && g.onConflict) || (run.processed && g.processed && (!run.onConflict || g.onConflict)); }
  function s24Deployed(c) {
    var s = st(c), g = s24DbGuard(s), ids = ['1', '2'].filter(function (k) { return s.workers[k].active; });
    if (ids.length < 2) return false;
    var ok = ids.every(function (k) { var r = s.workers[k].run; return s24Supported(r, g) && r.acksLate && !r.ackFirst; });
    if (s.variant === 'b') ok = ok && (s.q.visibility >= 60 || ids.every(function (k) { return s.workers[k].run.extends; }));
    return ok;
  }
  LX.missions.push({
    id: 'sre-s24', track: 'sre', cat: 'scenario', level: 'intermediate', mins: 30, kind: 'incident',
    title: 'Customers received the same e-mail twice this morning',
    brief: function () { return 'INC-5530: customers are getting duplicate e-mails from Beacon. beacon-mailer sends one e-mail per row of the notifications table, and those rows are written by two queue workers (beacon-worker@1 and @2) consuming beacon-notify. Find out how one order produced two rows, make the duplicate impossible rather than cleaning it up by hand, deploy the change, and prove it by replaying an affected message. Details are in ~/ticket.txt.'; },
    keys: ['cat ticket.txt', 'psql -c "SELECT message_id, count(*) FROM notifications GROUP BY message_id HAVING count(*) > 1"', 'queuectl stats', 'queuectl log -n 30', 'journalctl -u beacon-worker@1 -n 20', 'cat /opt/beacon/worker.py', 'cat /etc/beacon/worker.env', 'psql -c \'\\d notifications\''],
    world: s24World,
    objectives: [
      { id: 'dupes', stage: 'evidence', text: 'Show the duplicated side effect in the database, and what the duplicate rows have in common',
        hint: 'One e-mail per row: find rows that should have been one.',
        hint2: 'Group notifications by message_id and keep the groups with more than one row.',
        reveal: 'psql -c "SELECT message_id, count(*) FROM notifications GROUP BY message_id HAVING count(*) > 1"',
        done: function (c) { return !!st(c).flags.dupes; } },
      { id: 'redelivery', stage: 'evidence', text: 'Find in the queue and worker logs how the same message was handled twice',
        hint: 'The queue promises at-least-once delivery. When does it hand a message out again?',
        hint2: '`queuectl log --message ID` for a duplicated id; compare with `journalctl -u beacon-worker@1`.',
        reveal: function (c) { return 'queuectl log --message ' + st(c).q.dupIds[0]; },
        done: function (c) { return saw(c, /(queuectl\s+(log|show)|journalctl)\b/, /receive_count=2|visible again/); } },
      { id: 'code', stage: 'evidence', text: 'Find where the worker performs the side effect and where it acknowledges the message',
        hint: 'What happens if the process dies between those two lines?',
        hint2: '`grep -nE "INSERT|ack|transaction" /opt/beacon/worker.py`.',
        reveal: 'grep -nE "INSERT|ack|transaction" /opt/beacon/worker.py',
        done: function (c) { var re = /(cat|grep|sed|head|less|tail)\b.*worker\.py/; return saw(c, re, /queue\.ack\(msg\)/) && saw(c, re, /INSERT INTO notifications/); } },
      { id: 'guard', stage: 'fix', text: 'Make a second delivery of the same message unable to create a second row, enforced by the database and used by the worker code',
        hint: 'The message id is already an idempotency key. Something has to refuse a second row for it, atomically.',
        hint2: 'A unique index on notifications(message_id) plus `ON CONFLICT (message_id) DO NOTHING` in the INSERT — or a processed_messages table with a primary key, written in the same transaction. Existing duplicates must go before a unique index can be built, and only once nothing can make new ones.',
        reveal: "systemctl stop beacon-worker && psql -c \"DELETE FROM notifications a USING notifications b WHERE a.message_id = b.message_id AND a.id > b.id\" && psql -c \"CREATE UNIQUE INDEX CONCURRENTLY notifications_message_id_key ON notifications (message_id)\" && sed -i 's/VALUES (%s, %s, %s, %s)\",/VALUES (%s, %s, %s, %s) ON CONFLICT (message_id) DO NOTHING\",/' /opt/beacon/worker.py",
        done: function (c) { var p = s24Probes(c); return s24Supported(p, s24DbGuard(st(c))) && !p.ackFirst; } },
      { id: 'deploy', stage: 'fix', text: 'Run the corrected worker on both instances, with acknowledgement still after the side effect and redelivery only when a worker has really failed',
        hint: 'The fix only counts when the running workers use it, and the queue must not hand out a message that is still being worked on.',
        hint2: 'Start or restart both worker instances. If a message can take longer than the visibility timeout, raise it (`queuectl set visibility-timeout 120`) or extend visibility while working.',
        reveal: function (c) { return st(c).variant === 'b' ? 'queuectl set visibility-timeout 120 && systemctl start beacon-worker' : 'systemctl start beacon-worker'; },
        done: s24Deployed },
      { id: 'verify', stage: 'verify', text: 'Replay an affected message and show that it created no new row',
        hint: 'A duplicate delivery is the test case; the queue can produce one on demand.',
        hint2: '`queuectl replay ID` for a duplicated id, then look at that id\'s rows in notifications.',
        reveal: function (c) { var id = st(c).q.replayId; return 'queuectl replay ' + id + ' && psql -c "SELECT id, message_id, created_at FROM notifications WHERE message_id = \'' + id + '\'"'; },
        done: function (c) { var s = st(c), r = s.replays[s.replays.length - 1]; return !!r && r.ok && r.checked && s24Deployed(c); } }
    ],
    sre: {
      scenarioId: 'S24', moduleId: 'M12', lab: 'L24', variants: ['a', 'b'],
      symptom: 'Some customers received the same notification e-mail twice.',
      neutralTitle: 'Duplicate customer e-mails from the notification pipeline',
      neutralBrief: 'Customers are getting duplicate e-mails from Beacon. One e-mail is sent per row in the notifications table, written by two queue workers. Find how one order produced two rows, make the duplicate impossible rather than cleaning up by hand, deploy, and prove it.',
      impact: 'Customers received duplicate order and invoice e-mails; support is fielding "was I charged twice?" questions.',
      changes: 'Worker redeployed and its configuration pushed this morning; queue settings were tuned last week.',
      spoilers: ['ack', 'visibility', 'idempotency', 'redeliver', 'at-least-once', 'unique', 'crash', 'ON CONFLICT'],
      tools: ['psql -c (PostgreSQL 16 subset)', 'queuectl stats|log|show|replay|set visibility-timeout|dlq', 'systemctl status|start|stop|restart beacon-worker[@1|@2]', 'journalctl -u beacon-worker@N', 'cat/grep/sed -i/edit on /opt/beacon/worker.py and /etc/beacon/worker.env'],
      grammar: ['`psql -c "SQL"` — SELECT … GROUP BY … HAVING, DELETE … USING, CREATE [UNIQUE] INDEX [CONCURRENTLY], DROP INDEX, CREATE TABLE, ALTER TABLE … ADD UNIQUE, INSERT … VALUES|SELECT [ON CONFLICT DO NOTHING], \\d notifications', '`queuectl log [--message ID] [-n N]`, `queuectl show ID`, `queuectl replay ID`, `queuectl set visibility-timeout SECONDS`, `queuectl stats`, `queuectl dlq`', '`systemctl stop|start|restart beacon-worker` (both instances) or `beacon-worker@1`; a worker reads /opt/beacon/worker.py and /etc/beacon/worker.env when it starts', '`journalctl -u beacon-worker@1 -n 30`'],
      palette: ['cat ticket.txt', 'psql -c "SELECT message_id, count(*) FROM notifications GROUP BY message_id HAVING count(*) > 1"', 'psql -c "SELECT id, message_id, kind, created_at FROM notifications ORDER BY id DESC LIMIT 10"', 'queuectl stats', 'queuectl log -n 30', 'journalctl -u beacon-worker@2 -n 20', 'grep -n "ack\\|INSERT" /opt/beacon/worker.py', 'psql -c \'\\d notifications\''],
      assumptions: ['The queue is at-least-once: an unacked message becomes visible again after the visibility timeout.', 'Message ids are stable across redeliveries and replays (the producer sets them).', 'beacon-mailer sends exactly one e-mail per notifications row; it does not deduplicate.'],
      simplified: ['The worker\'s behaviour is decided by the documented "# sim:" probes in worker.py (no Python runs here); L24 runs the real worker against a real queue and database.', 'Stopping a worker always interrupts a message after its INSERT and before its ack (SIGTERM with no graceful drain), so a restart reproduces the failure; new traffic is otherwise idle during the exercise.', 'A message that keeps failing is retried up to max_receive_count at once (time compressed) and then dead-lettered.', 'An INVALID index left by a failed CREATE INDEX CONCURRENTLY enforces nothing here. Each command advances the clock 10 seconds.'],
      unsafe: [
        { label: 'deleted duplicate rows while the workers could still create more', why: 'Cleaning the table while the unguarded code path is still running hides the evidence and changes nothing: the next restart or slow message makes the next duplicate. Fix (or stop) the code path first.',
          test: function (c) { return !!st(c).deletedWhileUnguarded; },
          demo: 'psql -c "DELETE FROM notifications a USING notifications b WHERE a.message_id = b.message_id AND a.id > b.id"' },
        { label: 'switched to acknowledging before the side effect', why: 'Ack-on-receipt turns at-least-once into at-most-once: no duplicates, but a crash between ack and insert loses the notification silently. Duplicates are fixed with idempotency, not by risking data loss.',
          test: function (c) { var s = st(c); return ['1', '2'].some(function (k) { var Wk = s.workers[k]; return Wk.active && (!Wk.run.acksLate || Wk.run.ackFirst); }); },
          demo: ["sed -i 's/^ACKS_LATE=true/ACKS_LATE=false/' /etc/beacon/worker.env", 'systemctl restart beacon-worker'] }
      ],
      alt: function (v) {
        var dup = v === 'a' ? 'm-1042' : 'm-2083', other = v === 'a' ? 'm-1036' : 'm-2069';
        return ['cat ticket.txt', 'queuectl stats', 'queuectl show ' + dup, 'journalctl -u beacon-worker@2 -n 30',
          'psql -c "SELECT id, message_id, order_id, created_at FROM notifications WHERE message_id IN (\'' + other + '\', \'' + dup + '\') ORDER BY id"',
          'cat /opt/beacon/worker.py',
          'psql -c "CREATE TABLE processed_messages (message_id text PRIMARY KEY, processed_at timestamptz NOT NULL DEFAULT now())"',
          "sed -i 's/^    with db.transaction():$/    with db.transaction():\\n        cur = db.execute(\"INSERT INTO processed_messages (message_id) VALUES (%s) ON CONFLICT DO NOTHING\", (msg.id,))\\n        if cur.rowcount == 0:\\n            log.info(\"duplicate delivery %s skipped\", msg.id)\\n            queue.ack(msg)\\n            return/' /opt/beacon/worker.py",
          'systemctl stop beacon-worker',
          'psql -c "INSERT INTO processed_messages (message_id) SELECT DISTINCT message_id FROM notifications"']
          .concat(v === 'b' ? ["sed -i 's/^    body = render.notification(order) .*$/    queue.extend_visibility(msg, 120)\\n    body = render.notification(order)/' /opt/beacon/worker.py"] : [])
          .concat(['systemctl start beacon-worker', 'systemctl status beacon-worker', 'queuectl replay ' + dup, 'psql -c "SELECT count(*) FROM notifications WHERE message_id = \'' + dup + '\'"']);
      },
      mechanism: 'The queue delivers **at least once**: a message is handed out again if it is not acknowledged within the visibility timeout. The worker inserts the notification row, commits, and only then acks — correct, because acking first would lose messages when a worker dies. But nothing makes the side effect idempotent. In variant a, a deploy and a config push sent SIGTERM to a worker after its INSERT committed and before its ack; the message reappeared a minute later, the other worker inserted a second row, and the mailer sent a second e-mail. In variant b, invoice rendering takes ~45 s but the visibility timeout had been lowered to 30 s, so the queue handed every invoice to the second worker while the first was still rendering; both inserted. The durable fix uses the message id as an **idempotency key enforced by the database**: a unique index on notifications(message_id) with `INSERT … ON CONFLICT (message_id) DO NOTHING`, or a processed_messages table with a primary key written in the same transaction (backfilled from the rows that already exist, after the old workers stop). Duplicates already present must be removed before a unique index can be built, and only once the duplicating path is stopped. Variant b also needs the visibility timeout above the processing time (or a worker that extends visibility while it works), otherwise the work is still done twice even though the row is not. Replaying an affected message after deployment shows a duplicate delivery producing no second row.',
      alternatives: [
        { h: 'beacon-mailer sends twice', out: 'Ruled out: there are two rows per affected message, and the mailer sends one e-mail per row.' },
        { h: 'The producer published the order twice', out: 'Ruled out: the queue log shows one message id delivered twice (receive_count=2), not two messages.' },
        { h: 'Check-then-insert in Python ("SELECT … then INSERT if absent")', out: 'Rejected: two workers can both see "absent" at once (variant b does exactly that); only a database constraint makes it atomic.' }
      ],
      clues: ['The dead-letter queue is empty; nothing failed outright, which is why nobody noticed until customers did.'],
      passRubric: ['Explains at-least-once delivery, the ack boundary, and why ack-before-work trades duplicates for data loss', 'Names the idempotency key and where uniqueness is enforced, and why it must be the database', 'Explains the order of operations: stop or fix the duplicating path, then clean up, then add the constraint', 'Proves no new row on a replayed duplicate delivery'],
      prereqs: ['les-m12-04', 'les-m12-02'], refs: ['T09', 'T11']
    }
  });
})();
