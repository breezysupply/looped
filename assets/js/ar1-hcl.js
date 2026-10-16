/* A small HCL reader and structural model for the Anduril Round 1 Terraform
   labs (window.LXHcl).

   What it is: a parser for the HCL native syntax that Terraform files use
   (blocks, attributes, strings with ${} templates, heredocs, lists, objects,
   function calls, traversals, comments) plus a model of the AWS networking
   resources the labs care about — which subnet a route table serves, which
   rules a security group really has, whether an instance gets a public IP.
   Labs grade relationships and values from this model, never exact text or
   naming conventions.

   What it is not: terraform validate. It does not load provider schemas,
   does not know every argument, and cannot tell you what AWS will accept.
   Every result it produces is labelled "structural check". Real checks are
   `terraform fmt -check`, `terraform init` + `terraform validate`, and a plan
   with credentials — the labs give those commands separately. */
(function (root) {
  'use strict';

  /* ══ lexer-level helpers ═════════════════════════════════════════ */
  function isIdStart(c) { return /[A-Za-z_]/.test(c); }
  function isId(c) { return /[A-Za-z0-9_\-]/.test(c); }

  function HclError(msg, line) { this.message = msg; this.line = line; }

  /* Scan a quoted string starting at s[i] === '"'. Returns the index just past
     the closing quote. Understands escapes and nested ${ … } templates. */
  function scanString(s, i, line) {
    var j = i + 1;
    while (j < s.length) {
      var c = s[j];
      if (c === '\\') { j += 2; continue; }
      if (c === '"') return j + 1;
      if (c === '\n') throw new HclError('unterminated string', line.n);
      if ((c === '$' || c === '%') && s[j + 1] === '{') { j = scanBraces(s, j + 1, line); continue; }
      j++;
    }
    throw new HclError('unterminated string', line.n);
  }
  /* s[i] === '{' — return index just past the matching '}' */
  function scanBraces(s, i, line) {
    var depth = 0, j = i;
    while (j < s.length) {
      var c = s[j];
      if (c === '"') { j = scanString(s, j, line); continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (!depth) return j + 1; }
      else if (c === '\n') line.n++;
      j++;
    }
    throw new HclError('unbalanced braces', line.n);
  }
  /* heredoc at s[i] === '<' '<' — returns index just past the terminator line */
  function scanHeredoc(s, i, line) {
    var m = /^<<-?([A-Za-z_][A-Za-z0-9_]*)[ \t]*\n/.exec(s.slice(i, i + 80));
    if (!m) return -1;
    var tag = m[1], j = i + m[0].length; line.n++;
    while (j <= s.length) {
      var e = s.indexOf('\n', j); if (e === -1) e = s.length;
      if (s.slice(j, e).trim() === tag) { return e; }
      j = e + 1; line.n++;
      if (e === s.length) break;
    }
    throw new HclError('unterminated heredoc ' + tag, line.n);
  }

  /* ══ body parser: blocks and attributes ══════════════════════════ */
  function parse(src) {
    var s = String(src || '').replace(/\r\n?/g, '\n');
    var pos = 0, line = { n: 1 };
    function skipWs(nl) {
      for (;;) {
        var c = s[pos];
        if (c === ' ' || c === '\t' || (nl && c === '\n')) { if (c === '\n') line.n++; pos++; continue; }
        if (c === '#' || (c === '/' && s[pos + 1] === '/')) { while (pos < s.length && s[pos] !== '\n') pos++; continue; }
        if (c === '/' && s[pos + 1] === '*') { var e = s.indexOf('*/', pos + 2); if (e === -1) throw new HclError('unterminated comment', line.n); for (var k = pos; k < e; k++) if (s[k] === '\n') line.n++; pos = e + 2; continue; }
        return;
      }
    }
    function ident() { var st = pos; while (pos < s.length && isId(s[pos])) pos++; return s.slice(st, pos); }
    /* expression text: up to a newline (or a closing '}' / ',') at depth 0 */
    function exprText(stopAtBrace) {
      var st = pos, depth = 0, startLine = line.n;
      while (pos < s.length) {
        var c = s[pos];
        if (c === '"') { pos = scanString(s, pos, line); continue; }
        if (c === '<' && s[pos + 1] === '<') { var h = scanHeredoc(s, pos, line); if (h !== -1) { pos = h; continue; } }
        if (c === '#' || (c === '/' && s[pos + 1] === '/')) { if (depth === 0) break; while (pos < s.length && s[pos] !== '\n') pos++; continue; }
        if (c === '/' && s[pos + 1] === '*') { var e = s.indexOf('*/', pos + 2); if (e === -1) throw new HclError('unterminated comment', line.n); pos = e + 2; continue; }
        if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') { if (depth === 0) { if (c === '}' && stopAtBrace) break; throw new HclError('unexpected "' + c + '"', line.n); } depth--; }
        else if (c === '\n') { if (depth === 0) break; line.n++; }
        pos++;
      }
      if (depth) throw new HclError('unclosed bracket in expression starting on line ' + startLine, line.n);
      return s.slice(st, pos).trim();
    }
    function body(isTop) {
      var out = { attrs: {}, blocks: [] };
      for (;;) {
        skipWs(true);
        if (pos >= s.length) { if (!isTop) throw new HclError('missing closing "}"', line.n); return out; }
        if (s[pos] === '}') { if (isTop) throw new HclError('unexpected "}"', line.n); pos++; return out; }
        if (!isIdStart(s[pos])) throw new HclError('expected an argument name or block type, found "' + s[pos] + '"', line.n);
        var at = line.n, name = ident();
        skipWs(false);
        if (s[pos] === '=' && s[pos + 1] !== '=') {
          pos++; skipWs(false);
          var exprLine = line.n, raw = exprText(true);
          if (!raw) throw new HclError('missing value for "' + name + '"', at);
          if (out.attrs[name]) throw new HclError('argument "' + name + '" set twice', at);
          out.attrs[name] = { name: name, raw: raw, line: exprLine };
          continue;
        }
        var labels = [];
        while (s[pos] === '"' || isIdStart(s[pos] || '')) {
          if (s[pos] === '"') { var e2 = scanString(s, pos, line); labels.push(s.slice(pos + 1, e2 - 1)); pos = e2; }
          else labels.push(ident());
          skipWs(false);
        }
        if (s[pos] !== '{') throw new HclError('expected "=" or "{" after "' + name + '"', at);
        pos++;
        var inner = body(false);
        out.blocks.push({ type: name, labels: labels, attrs: inner.attrs, blocks: inner.blocks, line: at });
      }
    }
    try {
      var b = body(true);
      /* parse every attribute expression now so syntax errors surface */
      walkAttrs(b, function (a) { a.ast = parseExpr(a.raw, a.line); });
      return { ok: true, body: b };
    } catch (e) {
      if (e instanceof HclError) return { ok: false, error: e.message, line: e.line };
      throw e;
    }
  }
  function walkAttrs(b, fn) {
    Object.keys(b.attrs).forEach(function (k) { fn(b.attrs[k]); });
    b.blocks.forEach(function (x) { walkAttrs(x, fn); });
  }

  /* ══ expressions ═════════════════════════════════════════════════ */
  function tokenize(src, line0) {
    var t = [], i = 0, s = src, line = { n: line0 || 1 };
    while (i < s.length) {
      var c = s[i];
      if (/\s/.test(c)) { if (c === '\n') line.n++; i++; continue; }
      if (c === '#' || (c === '/' && s[i + 1] === '/')) { while (i < s.length && s[i] !== '\n') i++; continue; }
      if (c === '/' && s[i + 1] === '*') { var ce = s.indexOf('*/', i + 2); i = ce === -1 ? s.length : ce + 2; continue; }
      if (c === '"') { var e = scanString(s, i, line); t.push({ k: 'str', v: s.slice(i + 1, e - 1) }); i = e; continue; }
      if (c === '<' && s[i + 1] === '<') {
        var m = /^<<(-?)([A-Za-z_][A-Za-z0-9_]*)[ \t]*\n/.exec(s.slice(i, i + 80));
        if (m) { var he = scanHeredoc(s, i, line); var bodyTxt = s.slice(i + m[0].length, he).replace(/\n[ \t]*[A-Za-z_][A-Za-z0-9_]*[ \t]*$/, '\n'); t.push({ k: 'heredoc', v: bodyTxt }); i = he; continue; }
      }
      if (/[0-9]/.test(c)) { var n = /^[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/.exec(s.slice(i))[0]; t.push({ k: 'num', v: Number(n) }); i += n.length; continue; }
      if (isIdStart(c)) { var st = i; while (i < s.length && isId(s[i])) i++; t.push({ k: 'id', v: s.slice(st, i) }); continue; }
      var two = s.slice(i, i + 3) === '...' ? '...' : s.slice(i, i + 2);
      if (['==', '!=', '<=', '>=', '&&', '||', '=>', '...'].indexOf(two) !== -1) { t.push({ k: 'op', v: two }); i += two.length; continue; }
      if ('[](){},.:?=<>+-*/%!'.indexOf(c) !== -1) { t.push({ k: 'op', v: c }); i++; continue; }
      throw new HclError('unexpected character "' + c + '"', line.n);
    }
    return t;
  }

  function parseExpr(src, line0) {
    var toks = tokenize(src, line0), p = 0;
    function peek(v) { var x = toks[p]; return x && x.k === 'op' && x.v === v; }
    function eat(v) { if (!peek(v)) throw new HclError('expected "' + v + '" in expression `' + src.slice(0, 60) + '`', line0); p++; }
    function expr() {
      var c = binary(0);
      if (peek('?')) { p++; var a = expr(); eat(':'); var b = expr(); return { t: 'cond', c: c, a: a, b: b }; }
      return c;
    }
    var PREC = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };
    function binary(min) {
      var left = unary();
      for (;;) {
        var x = toks[p]; if (!x || x.k !== 'op' || !PREC[x.v] || PREC[x.v] <= min) return left;
        p++; left = { t: 'bin', op: x.v, l: left, r: binary(PREC[x.v]) };
      }
    }
    function unary() {
      if (peek('!') || peek('-')) { var op = toks[p++].v; return { t: 'un', op: op, e: unary() }; }
      return postfix(primary());
    }
    function postfix(e) {
      for (;;) {
        if (peek('.')) {
          p++; var x = toks[p];
          if (x && x.k === 'id') { p++; e = { t: 'get', o: e, name: x.v }; continue; }
          if (x && x.k === 'num') { p++; e = { t: 'idx', o: e, i: { t: 'lit', v: x.v } }; continue; }
          if (peek('*')) { p++; e = { t: 'splat', o: e }; continue; }
          throw new HclError('expected a name after "."', line0);
        }
        if (peek('[')) {
          p++;
          if (peek('*')) { p++; eat(']'); e = { t: 'splat', o: e }; continue; }
          var i = expr(); eat(']'); e = { t: 'idx', o: e, i: i }; continue;
        }
        return e;
      }
    }
    function template(raw) {
      var parts = [], buf = '', i = 0;
      while (i < raw.length) {
        var c = raw[i];
        if (c === '\\' && i + 1 < raw.length) { var nx = raw[i + 1]; buf += nx === 'n' ? '\n' : nx === 't' ? '\t' : nx; i += 2; continue; }
        if ((c === '$' || c === '%') && raw[i + 1] === '{') {
          if (raw[i + 2] === c) { buf += c + '{'; i += 3; continue; }
          var end = scanBraces(raw, i + 1, { n: line0 });
          var inner = raw.slice(i + 2, end - 1).replace(/^~|~$/g, '');
          if (buf) { parts.push(buf); buf = ''; }
          parts.push(c === '$' ? parseExpr(inner, line0) : { t: 'unknown', why: 'template directive' });
          i = end; continue;
        }
        buf += c; i++;
      }
      if (buf || !parts.length) parts.push(buf);
      return parts.length === 1 && typeof parts[0] === 'string' ? { t: 'lit', v: parts[0] } : { t: 'tpl', parts: parts };
    }
    function primary() {
      var x = toks[p];
      if (!x) throw new HclError('expression ends too early: `' + src.slice(0, 60) + '`', line0);
      if (x.k === 'num') { p++; return { t: 'lit', v: x.v }; }
      if (x.k === 'str') { p++; return template(x.v); }
      if (x.k === 'heredoc') { p++; return template(x.v.replace(/\\/g, '\\\\')); }
      if (x.k === 'id') {
        p++;
        if (x.v === 'true' || x.v === 'false') return { t: 'lit', v: x.v === 'true' };
        if (x.v === 'null') return { t: 'lit', v: null };
        if (peek('(')) {
          p++; var args = [];
          while (!peek(')')) { args.push(expr()); if (peek('...')) p++; if (peek(',')) p++; else break; }
          eat(')'); return { t: 'call', fn: x.v, args: args };
        }
        return { t: 'var', name: x.v };
      }
      if (peek('(')) { p++; var e = expr(); eat(')'); return e; }
      if (peek('[')) {
        p++;
        if (toks[p] && toks[p].k === 'id' && toks[p].v === 'for') { skipFor(']'); return { t: 'unknown', why: 'for expression' }; }
        var items = [];
        while (!peek(']')) { items.push(expr()); if (peek(',')) p++; else break; }
        eat(']'); return { t: 'list', items: items };
      }
      if (peek('{')) {
        p++;
        if (toks[p] && toks[p].k === 'id' && toks[p].v === 'for') { skipFor('}'); return { t: 'unknown', why: 'for expression' }; }
        var props = [];
        while (!peek('}')) {
          var kt = toks[p], key;
          if (kt && (kt.k === 'id' || kt.k === 'str') && toks[p + 1] && toks[p + 1].k === 'op' && (toks[p + 1].v === '=' || toks[p + 1].v === ':')) { key = kt.v; p += 2; }
          else { var ke = expr(); key = ke.t === 'lit' ? String(ke.v) : '?'; if (peek('=') || peek(':')) p++; else throw new HclError('expected "=" in object', line0); }
          props.push({ k: key, v: expr() });
          if (peek(',')) p++;
        }
        eat('}'); return { t: 'obj', props: props };
      }
      throw new HclError('unexpected "' + x.v + '" in expression', line0);
    }
    function skipFor(close) {
      var depth = 1; while (p < toks.length) { var x = toks[p++]; if (x.k === 'op' && (x.v === '[' || x.v === '{' || x.v === '(')) depth++; if (x.k === 'op' && (x.v === ']' || x.v === '}' || x.v === ')')) { depth--; if (!depth) { if (x.v !== close) throw new HclError('mismatched brackets', line0); return; } } }
      throw new HclError('unclosed for expression', line0);
    }
    var out = expr();
    if (p < toks.length) throw new HclError('unexpected "' + toks[p].v + '" after expression `' + src.slice(0, 60) + '`', line0);
    return out;
  }

  /* ══ CIDR helpers ════════════════════════════════════════════════ */
  function ip2n(ip) { var p = String(ip).split('.'); if (p.length !== 4) return NaN; var n = 0; for (var i = 0; i < 4; i++) { var o = Number(p[i]); if (!/^\d+$/.test(p[i]) || o > 255) return NaN; n = n * 256 + o; } return n; }
  function n2ip(n) { return [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255].join('.'); }
  function cidr(c) {
    var m = /^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/.exec(String(c || '').trim()); if (!m) return null;
    var bits = Number(m[2]), n = ip2n(m[1]); if (isNaN(n) || bits > 32) return null;
    var size = Math.pow(2, 32 - bits), base = n - (n % size);
    return { base: base, bits: bits, size: size, aligned: base === n, str: n2ip(base) + '/' + bits };
  }
  function within(child, parent) { var a = cidr(child), b = cidr(parent); return !!(a && b && a.bits >= b.bits && a.base >= b.base && a.base + a.size <= b.base + b.size); }
  function overlaps(x, y) { var a = cidr(x), b = cidr(y); return !!(a && b && a.base < b.base + b.size && b.base < a.base + a.size); }
  function cidrsubnet(prefix, newbits, netnum) {
    var c = cidr(prefix); if (!c || c.bits + newbits > 32) return UNKNOWN;
    var bits = c.bits + newbits, size = Math.pow(2, 32 - bits);
    if (netnum >= Math.pow(2, newbits)) return UNKNOWN;
    return n2ip(c.base + netnum * size) + '/' + bits;
  }

  /* ══ evaluation ══════════════════════════════════════════════════ */
  var UNKNOWN = { unknown: true, toString: function () { return '(known after apply)'; } };
  function known(v) { return v !== UNKNOWN && !(v && v.unknown); }

  var FN = {
    cidrsubnet: function (a) { return known(a[0]) && known(a[1]) && known(a[2]) ? cidrsubnet(a[0], Number(a[1]), Number(a[2])) : UNKNOWN; },
    cidrhost: function (a) { var c = known(a[0]) && cidr(a[0]); return c && known(a[1]) ? n2ip(c.base + Number(a[1])) : UNKNOWN; },
    tostring: function (a) { return known(a[0]) ? String(a[0]) : UNKNOWN; },
    tonumber: function (a) { return known(a[0]) ? Number(a[0]) : UNKNOWN; },
    tolist: function (a) { return a[0]; }, toset: function (a) { return a[0]; },
    element: function (a) { return known(a[0]) && Array.isArray(a[0]) && known(a[1]) ? a[0][Number(a[1]) % a[0].length] : UNKNOWN; },
    concat: function (a) { return a.every(function (x) { return known(x) && Array.isArray(x); }) ? [].concat.apply([], a) : UNKNOWN; },
    length: function (a) { return known(a[0]) && a[0] != null ? (Array.isArray(a[0]) || typeof a[0] === 'string' ? a[0].length : Object.keys(a[0]).length) : UNKNOWN; },
    lower: function (a) { return known(a[0]) ? String(a[0]).toLowerCase() : UNKNOWN; },
    upper: function (a) { return known(a[0]) ? String(a[0]).toUpperCase() : UNKNOWN; },
    join: function (a) { return known(a[0]) && known(a[1]) && Array.isArray(a[1]) ? a[1].join(a[0]) : UNKNOWN; },
    lookup: function (a) { return known(a[0]) && a[0] && known(a[1]) && Object.prototype.hasOwnProperty.call(a[0], a[1]) ? a[0][a[1]] : (a.length > 2 ? a[2] : UNKNOWN); },
    merge: function (a) { if (!a.every(known)) return UNKNOWN; var o = {}; a.forEach(function (x) { Object.keys(x || {}).forEach(function (k) { o[k] = x[k]; }); }); return o; },
    format: function (a) { if (!a.every(known)) return UNKNOWN; var i = 1; return String(a[0]).replace(/%[sdv]/g, function () { return String(a[i++]); }); },
    coalesce: function (a) { for (var i = 0; i < a.length; i++) if (known(a[i]) && a[i] != null && a[i] !== '') return a[i]; return UNKNOWN; },
    try: function (a) { for (var i = 0; i < a.length; i++) if (known(a[i])) return a[i]; return UNKNOWN; }
  };

  /* ══ model ═══════════════════════════════════════════════════════ */
  function Model(files) {
    var self = this;
    this.files = files;
    this.errors = [];
    this.resources = []; this.data = []; this.variables = {}; this.locals = {}; this.outputs = []; this.providers = []; this.terraform = []; this.modules = [];
    Object.keys(files).forEach(function (fname) {
      var r = parse(files[fname]);
      if (!r.ok) { self.errors.push({ file: fname, line: r.line, message: r.error }); return; }
      r.body.blocks.forEach(function (b) {
        b.file = fname;
        if (b.type === 'resource') { if (b.labels.length !== 2) self.errors.push({ file: fname, line: b.line, message: 'resource blocks need two labels: type and name' }); else { b.rtype = b.labels[0]; b.name = b.labels[1]; self.resources.push(b); } }
        else if (b.type === 'data') { if (b.labels.length !== 2) self.errors.push({ file: fname, line: b.line, message: 'data blocks need two labels: type and name' }); else { b.rtype = b.labels[0]; b.name = b.labels[1]; self.data.push(b); } }
        else if (b.type === 'variable') { if (b.labels.length !== 1) self.errors.push({ file: fname, line: b.line, message: 'variable blocks need one label' }); else self.variables[b.labels[0]] = b; }
        else if (b.type === 'locals') Object.keys(b.attrs).forEach(function (k) { self.locals[k] = b.attrs[k]; });
        else if (b.type === 'output') { if (b.labels.length !== 1) self.errors.push({ file: fname, line: b.line, message: 'output blocks need one label' }); else { b.name = b.labels[0]; self.outputs.push(b); } }
        else if (b.type === 'provider') self.providers.push(b);
        else if (b.type === 'terraform') self.terraform.push(b);
        else if (b.type === 'module') self.modules.push(b);
        else self.errors.push({ file: fname, line: b.line, message: 'unknown top-level block "' + b.type + '"' });
      });
    });
    /* duplicate addresses */
    var seen = {};
    this.resources.concat(this.data.map(function (d) { return { rtype: 'data.' + d.rtype, name: d.name, line: d.line, file: d.file }; })).forEach(function (r) {
      var k = r.rtype + '.' + r.name;
      if (seen[k]) self.errors.push({ file: r.file, line: r.line, message: 'duplicate resource "' + k + '"' });
      seen[k] = true;
    });
    this.ok = !this.errors.length;
  }
  Model.prototype.all = function (type) { return this.resources.filter(function (r) { return r.rtype === type; }); };
  Model.prototype.find = function (type, name) { return this.resources.filter(function (r) { return r.rtype === type && r.name === name; })[0] || null; };
  Model.prototype.dataOf = function (type) { return this.data.filter(function (r) { return r.rtype === type; }); };
  Model.prototype.ast = function (block, name) { var a = block && block.attrs[name]; return a ? a.ast : null; };
  Model.prototype.has = function (block, name) { return !!(block && block.attrs[name]); };
  Model.prototype.sub = function (block, type) { return (block && block.blocks || []).filter(function (b) { return b.type === type; }); };

  /* references in an expression: [{ kind, type, name, attr }] */
  Model.prototype.refsOf = function (ast) {
    var out = [], self = this;
    (function walk(e) {
      if (!e || typeof e !== 'object') return;
      if (e.t === 'get' || e.t === 'idx' || e.t === 'var' || e.t === 'splat') {
        var chain = traversal(e);
        if (chain) {
          var r0 = chain[0];
          if (r0 === 'var' && chain[1]) out.push({ kind: 'var', name: chain[1] });
          else if (r0 === 'local' && chain[1]) out.push({ kind: 'local', name: chain[1] });
          else if (r0 === 'data' && chain[2]) out.push({ kind: 'data', type: chain[1], name: chain[2], attr: chain[3] });
          else if (r0 === 'module' && chain[1]) out.push({ kind: 'module', name: chain[1], attr: chain[2] });
          else if (chain[1] && self.find(r0, chain[1])) out.push({ kind: 'resource', type: r0, name: chain[1], attr: chain[2] });
          else if (chain[1] && /^[a-z0-9]+_[a-z0-9_]+$/.test(r0)) out.push({ kind: 'missing', type: r0, name: chain[1], attr: chain[2] });
        }
        if (e.t === 'idx') walk(e.i);
        if (e.o) walk(e.o);
        return;
      }
      Object.keys(e).forEach(function (k) { var v = e[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') walk(v); });
    })(ast);
    return out;
  };
  function traversal(e) {
    var chain = [];
    while (e) {
      if (e.t === 'var') { chain.unshift(e.name); return chain; }
      if (e.t === 'get') { chain.unshift(e.name); e = e.o; continue; }
      if (e.t === 'idx' || e.t === 'splat') { e = e.o; continue; }
      return null;
    }
    return null;
  }
  /* resolve to the resource (of one of `types`) that an attribute points at */
  Model.prototype.points = function (block, name, types) {
    var ast = this.ast(block, name); if (!ast) return null;
    types = [].concat(types);
    var hits = this.refsOf(ast).filter(function (r) { return r.kind === 'resource' && types.indexOf(r.type) !== -1; });
    if (hits.length) return this.find(hits[0].type, hits[0].name);
    /* through a local that is itself a reference */
    var loc = this.refsOf(ast).filter(function (r) { return r.kind === 'local'; })[0];
    if (loc && this.locals[loc.name] && !this._pt) { this._pt = true; var res = this.points({ attrs: { x: this.locals[loc.name] } }, 'x', types); this._pt = false; return res; }
    return null;
  };
  /* all resources (any of `types`) that an attribute's expression references — for list attributes */
  Model.prototype.pointsAll = function (block, name, types) {
    var self = this, ast = this.ast(block, name); if (!ast) return [];
    types = [].concat(types);
    return this.refsOf(ast).filter(function (r) { return r.kind === 'resource' && types.indexOf(r.type) !== -1; }).map(function (r) { return self.find(r.type, r.name); });
  };
  Model.prototype.val = function (block, name) { var ast = this.ast(block, name); return ast ? this.eval(ast, 0) : undefined; };
  Model.prototype.eval = function (e, depth) {
    var self = this;
    if (!e || depth > 12) return UNKNOWN;
    switch (e.t) {
      case 'lit': return e.v;
      case 'tpl': var parts = e.parts.map(function (x) { return typeof x === 'string' ? x : self.eval(x, depth + 1); }); return parts.every(known) ? parts.join('') : UNKNOWN;
      case 'list': var items = e.items.map(function (x) { return self.eval(x, depth + 1); }); return items;
      case 'obj': var o = {}; e.props.forEach(function (p) { o[p.k] = self.eval(p.v, depth + 1); }); return o;
      case 'call': var fn = FN[e.fn]; if (!fn) return UNKNOWN; return fn(e.args.map(function (a) { return self.eval(a, depth + 1); }));
      case 'cond': var c = self.eval(e.c, depth + 1); if (!known(c)) return UNKNOWN; return self.eval(c ? e.a : e.b, depth + 1);
      case 'un': var u = self.eval(e.e, depth + 1); if (!known(u)) return UNKNOWN; return e.op === '!' ? !u : -u;
      case 'bin':
        var l = self.eval(e.l, depth + 1), r = self.eval(e.r, depth + 1); if (!known(l) || !known(r)) return UNKNOWN;
        switch (e.op) { case '+': return l + r; case '-': return l - r; case '*': return l * r; case '/': return l / r; case '%': return l % r; case '==': return l === r; case '!=': return l !== r; case '<': return l < r; case '>': return l > r; case '<=': return l <= r; case '>=': return l >= r; case '&&': return l && r; case '||': return l || r; }
        return UNKNOWN;
      case 'var': case 'get': case 'idx':
        var chain = traversal(e);
        if (!chain) return UNKNOWN;
        if (chain[0] === 'var') {
          var v = self.variables[chain[1]]; if (!v || !v.attrs['default']) return UNKNOWN;
          var dv = self.eval(v.attrs['default'].ast, depth + 1);
          return pick(dv, chain.slice(2), e);
        }
        if (chain[0] === 'local') { var lv = self.locals[chain[1]]; return lv ? pick(self.eval(lv.ast, depth + 1), chain.slice(2), e) : UNKNOWN; }
        var res = chain[1] && self.find(chain[0], chain[1]);
        if (res && chain[2] && res.attrs[chain[2]] && !res.attrs.count && !res.attrs.for_each) return pick(self.eval(res.attrs[chain[2]].ast, depth + 1), chain.slice(3), e);
        return UNKNOWN;
      default: return UNKNOWN;
    }
    function pick(v, rest, node) {
      if (node.t === 'idx' && known(v) && Array.isArray(v)) { var i = self.eval(node.i, depth + 1); return known(i) ? v[i] : UNKNOWN; }
      for (var k = 0; k < rest.length; k++) { if (!known(v) || v == null || typeof v !== 'object') return UNKNOWN; v = v[rest[k]]; }
      return v === undefined ? UNKNOWN : v;
    }
  };

  /* ══ AWS networking views ════════════════════════════════════════ */
  var WORLD4 = '0.0.0.0/0', WORLD6 = '::/0';
  function protoOf(v) { var p = String(v).toLowerCase(); return p === '6' ? 'tcp' : p === '17' ? 'udp' : p === '1' ? 'icmp' : (p === 'all' || p === '-1') ? '-1' : p; }
  function asList(v) { return !known(v) ? [UNKNOWN] : v == null ? [] : Array.isArray(v) ? v : [v]; }

  /* every effective rule on a security group, whichever style declared it */
  Model.prototype.sgRules = function (sg) {
    var self = this, out = [];
    ['ingress', 'egress'].forEach(function (dir) {
      self.sub(sg, dir).forEach(function (b) {
        out.push({ dir: dir, style: 'inline', block: b, proto: protoOf(self.val(b, 'protocol')), from: self.val(b, 'from_port'), to: self.val(b, 'to_port'),
          cidrs: asList(self.val(b, 'cidr_blocks')).concat(asList(self.val(b, 'ipv6_cidr_blocks'))).filter(function (x) { return x !== undefined; }),
          sgs: self.pointsAll(b, 'security_groups', 'aws_security_group').concat(b.attrs.self && self.val(b, 'self') === true ? [sg] : []),
          prefixLists: self.has(b, 'prefix_list_ids') ? asList(self.val(b, 'prefix_list_ids')) : [] });
      });
    });
    this.all('aws_vpc_security_group_ingress_rule').concat(this.all('aws_vpc_security_group_egress_rule')).forEach(function (r) {
      if (self.points(r, 'security_group_id', 'aws_security_group') !== sg) return;
      var proto = protoOf(self.val(r, 'ip_protocol'));
      out.push({ dir: r.rtype.indexOf('ingress') !== -1 ? 'ingress' : 'egress', style: 'rule', block: r, proto: proto,
        from: proto === '-1' ? 0 : self.val(r, 'from_port'), to: proto === '-1' ? 65535 : self.val(r, 'to_port'),
        cidrs: [self.val(r, 'cidr_ipv4'), self.val(r, 'cidr_ipv6')].filter(function (x) { return x !== undefined && x !== null; }),
        sgs: self.pointsAll(r, 'referenced_security_group_id', 'aws_security_group'), prefixLists: self.has(r, 'prefix_list_id') ? [self.val(r, 'prefix_list_id')] : [] });
    });
    this.all('aws_security_group_rule').forEach(function (r) {
      if (self.points(r, 'security_group_id', 'aws_security_group') !== sg) return;
      var proto = protoOf(self.val(r, 'protocol'));
      out.push({ dir: self.val(r, 'type') === 'egress' ? 'egress' : 'ingress', style: 'legacy', block: r, proto: proto, from: self.val(r, 'from_port'), to: self.val(r, 'to_port'),
        cidrs: asList(self.val(r, 'cidr_blocks')).concat(self.has(r, 'ipv6_cidr_blocks') ? asList(self.val(r, 'ipv6_cidr_blocks')) : []),
        sgs: self.pointsAll(r, 'source_security_group_id', 'aws_security_group'), prefixLists: [] });
    });
    return out;
  };
  /* does a rule cover TCP `port`? */
  function covers(rule, port, proto) {
    proto = proto || 'tcp';
    if (rule.proto !== '-1' && rule.proto !== proto) return false;
    if (rule.proto === '-1') return true;
    if (!known(rule.from) || !known(rule.to)) return false;
    return Number(rule.from) <= port && port <= Number(rule.to);
  }
  function worldOpen(rule) { return rule.cidrs.some(function (c) { return c === WORLD4 || c === WORLD6; }); }
  function fromCidr(rule, c) { return rule.cidrs.some(function (x) { return known(x) && (x === c || within(c, x)); }); }

  /* routes of a route table, either style */
  Model.prototype.routesOf = function (rt) {
    var self = this, out = [];
    function target(b) {
      var kinds = [['gateway_id', 'aws_internet_gateway', 'igw'], ['nat_gateway_id', 'aws_nat_gateway', 'nat'], ['egress_only_gateway_id', 'aws_egress_only_internet_gateway', 'eigw'],
        ['transit_gateway_id', 'aws_ec2_transit_gateway', 'tgw'], ['vpc_peering_connection_id', 'aws_vpc_peering_connection', 'pcx'], ['vpc_endpoint_id', 'aws_vpc_endpoint', 'vpce'], ['network_interface_id', 'aws_network_interface', 'eni']];
      for (var i = 0; i < kinds.length; i++) {
        if (!self.has(b, kinds[i][0])) continue;
        var to = self.points(b, kinds[i][0], ['aws_internet_gateway', 'aws_nat_gateway', 'aws_egress_only_internet_gateway', 'aws_ec2_transit_gateway', 'aws_vpc_peering_connection', 'aws_vpc_endpoint', 'aws_network_interface']);
        return { attr: kinds[i][0], kind: to ? ({ aws_internet_gateway: 'igw', aws_nat_gateway: 'nat', aws_egress_only_internet_gateway: 'eigw', aws_ec2_transit_gateway: 'tgw', aws_vpc_peering_connection: 'pcx', aws_vpc_endpoint: 'vpce', aws_network_interface: 'eni' })[to.rtype] : 'unresolved', expected: kinds[i][2], res: to };
      }
      return { attr: null, kind: 'none', res: null };
    }
    this.sub(rt, 'route').forEach(function (b) { var tg = target(b); out.push({ style: 'inline', block: b, dest: self.val(b, 'cidr_block'), dest6: self.val(b, 'ipv6_cidr_block'), target: tg }); });
    this.all('aws_route').forEach(function (r) {
      if (self.points(r, 'route_table_id', 'aws_route_table') !== rt) return;
      var tg = target(r); out.push({ style: 'resource', block: r, dest: self.val(r, 'destination_cidr_block'), dest6: self.val(r, 'destination_ipv6_cidr_block'), target: tg });
    });
    return out;
  };
  Model.prototype.mainOf = function (rt) {
    var self = this;
    return this.all('aws_main_route_table_association').some(function (a) { return self.points(a, 'route_table_id', 'aws_route_table') === rt; });
  };
  /* the route table a subnet uses: explicit association, else a declared main association for its VPC */
  Model.prototype.rtFor = function (subnet) {
    var self = this, vpc = this.points(subnet, 'vpc_id', 'aws_vpc');
    var ex = this.all('aws_route_table_association').filter(function (a) { return self.points(a, 'subnet_id', 'aws_subnet') === subnet; });
    if (ex.length) return { rt: self.points(ex[0], 'route_table_id', 'aws_route_table'), how: 'explicit', count: ex.length };
    var main = this.all('aws_main_route_table_association').filter(function (a) { return vpc && self.points(a, 'vpc_id', 'aws_vpc') === vpc; })[0];
    if (main) return { rt: self.points(main, 'route_table_id', 'aws_route_table'), how: 'main', count: 0 };
    return { rt: null, how: 'default-main', count: 0 };
  };
  Model.prototype.defaultRoute = function (rt) {
    return rt ? this.routesOf(rt).filter(function (r) { return r.dest === WORLD4; })[0] || null : null;
  };
  Model.prototype.isPublicSubnet = function (subnet) { var r = this.rtFor(subnet), d = this.defaultRoute(r.rt); return !!(d && d.target.kind === 'igw'); };
  Model.prototype.igwFor = function (vpc) {
    var self = this;
    var direct = this.all('aws_internet_gateway').filter(function (g) { return self.points(g, 'vpc_id', 'aws_vpc') === vpc; });
    if (direct.length) return direct[0];
    var att = this.all('aws_internet_gateway_attachment').filter(function (a) { return self.points(a, 'vpc_id', 'aws_vpc') === vpc; })[0];
    return att ? this.points(att, 'internet_gateway_id', 'aws_internet_gateway') : null;
  };
  Model.prototype.instancePublic = function (inst) {
    var sn = this.points(inst, 'subnet_id', 'aws_subnet');
    var api = this.val(inst, 'associate_public_ip_address');
    if (api === true) return 'associate_public_ip_address';
    if (api === false) return this.eipFor(inst) ? 'elastic IP' : null;
    if (sn && this.val(sn, 'map_public_ip_on_launch') === true) return 'subnet map_public_ip_on_launch';
    if (this.eipFor(inst)) return 'elastic IP';
    return null;
  };
  Model.prototype.eipFor = function (inst) {
    var self = this;
    return this.all('aws_eip').filter(function (e) { return self.points(e, 'instance', 'aws_instance') === inst; })[0] ||
      this.all('aws_eip_association').filter(function (a) { return self.points(a, 'instance_id', 'aws_instance') === inst; })[0] || null;
  };
  Model.prototype.sgsOf = function (inst) { return this.pointsAll(inst, 'vpc_security_group_ids', 'aws_security_group').concat(this.pointsAll(inst, 'security_groups', 'aws_security_group')); };
  Model.prototype.amiSource = function (inst) {
    var a = this.ast(inst, 'ami'); if (!a) return null;
    var refs = this.refsOf(a);
    if (refs.some(function (r) { return r.kind === 'data' && r.type === 'aws_ami'; })) return 'data.aws_ami';
    if (refs.some(function (r) { return r.kind === 'data' && r.type === 'aws_ssm_parameter'; })) return 'ssm parameter';
    if (refs.some(function (r) { return r.kind === 'var'; })) return 'variable';
    if (refs.some(function (r) { return r.kind === 'local'; })) return 'local';
    var v = this.val(inst, 'ami');
    return known(v) && /^ami-[0-9a-f]{8,17}$/.test(String(v)) ? 'hard-coded' : 'other';
  };
  /* literal credentials anywhere in provider blocks or variables' defaults */
  Model.prototype.embeddedSecrets = function () {
    var self = this, out = [];
    this.providers.forEach(function (p) {
      ['access_key', 'secret_key', 'token'].forEach(function (k) { if (self.has(p, k)) { var v = self.val(p, k); if (known(v) && v) out.push('provider ' + k + ' is a literal'); else if (self.has(p, k)) out.push('provider sets ' + k + ' (use the credential chain instead)'); } });
    });
    Object.keys(this.files).forEach(function (f) {
      if (/AKIA[0-9A-Z]{16}/.test(self.files[f])) out.push(f + ' contains something shaped like an AWS access key ID');
    });
    return out;
  };
  Model.prototype.providerPin = function () {
    var self = this, pin = null;
    this.terraform.forEach(function (t) {
      self.sub(t, 'required_providers').forEach(function (rp) {
        var a = rp.attrs.aws; if (!a) return;
        var v = self.eval(a.ast, 0);
        if (known(v) && v && typeof v === 'object') pin = { source: v.source, version: v.version };
        else if (typeof v === 'string') pin = { source: null, version: v };
      });
    });
    return pin;
  };

  /* references to things the configuration never declares (terraform
     validate would reject these too) */
  Model.prototype.dangling = function () {
    var self = this, out = [], seen = {};
    function scan(b, where) {
      Object.keys(b.attrs).forEach(function (k) {
        self.refsOf(b.attrs[k].ast).forEach(function (r) {
          var bad = r.kind === 'missing' ? r.type + '.' + r.name :
            r.kind === 'var' && !self.variables[r.name] ? 'var.' + r.name :
            r.kind === 'local' && !self.locals[r.name] ? 'local.' + r.name :
            r.kind === 'data' && !self.data.some(function (d) { return d.rtype === r.type && d.name === r.name; }) ? 'data.' + r.type + '.' + r.name : null;
          if (bad && !seen[bad]) { seen[bad] = 1; out.push(bad + ' (used in ' + where + ', line ' + b.attrs[k].line + ')'); }
        });
      });
      b.blocks.forEach(function (x) { if (x.type !== 'dynamic') scan(x, where); });
    }
    this.resources.forEach(function (r) { scan(r, r.rtype + '.' + r.name); });
    this.data.forEach(function (r) { scan(r, 'data.' + r.rtype + '.' + r.name); });
    this.outputs.forEach(function (o) { scan(o, 'output ' + o.name); });
    this.providers.forEach(function (p) { scan(p, 'provider'); });
    Object.keys(this.locals).forEach(function (k) { scan({ attrs: { x: self.locals[k] }, blocks: [] }, 'local.' + k); });
    return out;
  };

  /* ══ grading ═════════════════════════════════════════════════════
     A lab supplies checks: [{ id, label, sev: 'required'|'critical'|'advice',
     defect?, test(M, ctx) → true | false | string (why it failed) }].
     'critical' checks are things that must NOT be present (world-open SSH,
     embedded keys); 'advice' never blocks a pass. */
  function grade(files, checks, ctx) {
    var M = new Model(files);
    var res = { parsed: M.ok, errors: M.errors, results: [], label: 'Structural checks (local parser — not terraform validate, not AWS)' };
    if (!M.ok) return res;
    checks = [{ id: 'refs', label: 'Every reference points at something declared', hint: 'Declare the variable, local, data source or resource, or fix the name.',
      test: function (m) { var d = m.dangling(); return d.length ? 'undeclared: ' + d.join('; ') : true; } }].concat(checks);
    checks.forEach(function (c) {
      var r;
      try { r = c.test(M, ctx || {}); } catch (e) { r = 'checker could not evaluate this (' + e.message + ')'; }
      var ok = r === true;
      res.results.push({ id: c.id, label: c.label, sev: c.sev || 'required', defect: c.defect || null, ok: ok, why: ok ? '' : (typeof r === 'string' ? r : c.fail || 'not satisfied'), hint: c.hint || '' });
    });
    res.required = res.results.filter(function (r) { return r.sev === 'required'; });
    res.critical = res.results.filter(function (r) { return r.sev === 'critical' && !r.ok; });
    res.passed = res.required.every(function (r) { return r.ok; }) && !res.critical.length;
    return res;
  }

  root.LXHcl = {
    parse: parse, parseExpr: parseExpr, Model: Model, grade: grade, UNKNOWN: UNKNOWN, known: known,
    cidr: cidr, within: within, overlaps: overlaps, cidrsubnet: cidrsubnet,
    covers: covers, worldOpen: worldOpen, fromCidr: fromCidr, protoOf: protoOf
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.LXHcl;
})(typeof window !== 'undefined' ? window : globalThis);
