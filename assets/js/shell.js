/* Simulated shell: virtual filesystem, ~40 commands, pipes, redirects,
   for/while/if. Pure logic — no DOM — so it can be unit-tested in node.

   world = { cwd, user, host, root, env, fs, procs, units, disks, dmesg,
             journal, sockets, history, out }                              */
(function (global) {
  'use strict';

  /* ── Virtual filesystem ─────────────────────────────────────
     fs is a flat map of absolute path → node
     node = { t:'d'|'f'|'l', mode, owner, group, size, content, mtime, target } */

  function norm(p) {
    var abs = p.charAt(0) === '/';
    var parts = p.split('/'), out = [];
    for (var i = 0; i < parts.length; i++) {
      var s = parts[i];
      if (!s || s === '.') continue;
      if (s === '..') { out.pop(); continue; }
      out.push(s);
    }
    return (abs ? '/' : '') + out.join('/') || '/';
  }
  function resolve(w, p) {
    if (!p) return w.cwd;
    if (p === '~') return '/home/' + w.user;
    if (p.indexOf('~/') === 0) return norm('/home/' + w.user + '/' + p.slice(2));
    return norm(p.charAt(0) === '/' ? p : w.cwd + '/' + p);
  }
  function node(w, p) { return w.fs[resolve(w, p)]; }
  function dirname(p) { var i = p.lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i); }
  function basename(p) { return p.slice(p.lastIndexOf('/') + 1) || '/'; }

  function children(w, dir) {
    dir = resolve(w, dir);
    var pre = dir === '/' ? '/' : dir + '/';
    return Object.keys(w.fs).filter(function (p) {
      return p !== dir && p.indexOf(pre) === 0 && p.slice(pre.length).indexOf('/') === -1;
    }).sort();
  }
  function walk(w, dir) {
    dir = resolve(w, dir);
    var pre = dir === '/' ? '/' : dir + '/';
    return Object.keys(w.fs).filter(function (p) { return p === dir || p.indexOf(pre) === 0; }).sort();
  }
  function sizeOf(n) { return n.size != null ? n.size : (n.content ? n.content.length : 0); }

  function mkfile(w, p, content, opts) {
    p = resolve(w, p);
    opts = opts || {};
    w.fs[p] = { t:'f', mode: opts.mode || '644', owner: opts.owner || w.user,
                group: opts.group || w.user, content: content || '',
                size: opts.size, mtime: opts.mtime || w.now };
    return w.fs[p];
  }
  function mkdirp(w, p, opts) {
    p = resolve(w, p);
    var parts = p.split('/').filter(Boolean), cur = '';
    for (var i = 0; i < parts.length; i++) {
      cur += '/' + parts[i];
      if (!w.fs[cur]) {
        w.fs[cur] = { t:'d', mode:(opts && opts.mode) || '755',
                      owner:(opts && opts.owner) || w.user,
                      group:(opts && opts.group) || w.user, mtime: w.now };
      }
    }
  }

  /* mount that owns a path, for df/du accounting */
  function mountOf(w, p) {
    var best = null;
    (w.disks || []).forEach(function (d) {
      if (p === d.mount || p.indexOf(d.mount === '/' ? '/' : d.mount + '/') === 0) {
        if (!best || d.mount.length > best.mount.length) best = d;
      }
    });
    return best;
  }
  function diskUsed(w, d) {
    var used = d.base || 0;
    Object.keys(w.fs).forEach(function (p) {
      var n = w.fs[p];
      if (n.t !== 'f') return;
      if (mountOf(w, p) === d) used += sizeOf(n);
    });
    return used;
  }

  /* ── Formatting helpers ─────────────────────────────────────── */
  function human(bytes) {
    var u = ['', 'K', 'M', 'G', 'T'], i = 0, n = bytes;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    var s = n >= 100 || i === 0 ? Math.round(n) : (Math.round(n * 10) / 10);
    return s + u[i];
  }
  function pad(s, n, right) {
    s = String(s);
    while (s.length < n) s = right ? s + ' ' : ' ' + s;
    return s;
  }
  function modeStr(n) {
    var m = String(n.mode), bits = '';
    for (var i = 0; i < 3; i++) {
      var d = parseInt(m.charAt(m.length - 3 + i), 10) || 0;
      bits += (d & 4 ? 'r' : '-') + (d & 2 ? 'w' : '-') + (d & 1 ? 'x' : '-');
    }
    return (n.t === 'd' ? 'd' : n.t === 'l' ? 'l' : '-') + bits;
  }
  function mtimeStr(n) { return n.mtime || 'Aug 14 09:12'; }

  /* ── Tokenizer ──────────────────────────────────────────────── */
  function tokenize(line) {
    var toks = [], cur = '', quote = null, i;
    for (i = 0; i < line.length; i++) {
      var ch = line[i];
      if (quote) {
        if (ch === quote) { quote = null; cur += '\u0001Q'; }
        else if (quote === "'") {
          /* single quotes are literal: hide $, * and ? from expansion */
          cur += ch === '$' ? '\u0011' : ch === '*' ? '\u0012' : ch === '?' ? '\u0013' : ch;
        }
        else cur += ch;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; cur += '\u0001Q'; continue; }
      if (ch === '\\' && i + 1 < line.length) { cur += line[++i]; continue; }
      if (/\s/.test(ch)) { if (cur) { toks.push(cur); cur = ''; } continue; }
      if (ch === '|' || ch === '<') { if (cur) { toks.push(cur); cur = ''; } toks.push(ch); continue; }
      if (ch === '>') {
        if (cur === '2' || cur === '1') { toks.push(cur + '>'); cur = ''; }
        else { if (cur) { toks.push(cur); cur = ''; } toks.push(line[i + 1] === '>' ? (i++, '>>') : '>'); }
        continue;
      }
      cur += ch;
    }
    if (cur) toks.push(cur);
    return toks;
  }
  function unquote(t) { return t.replace(/\u0001Q/g, ''); }
  function wasQuoted(t) { return t.indexOf('\u0001Q') !== -1; }

  /* ── Expansion ──────────────────────────────────────────────── */
  function expand(w, tok) {
    var quoted = wasQuoted(tok);
    var s = tok, substituted = false;
    /* $(...) */
    s = s.replace(/\$\(([^)]*)\)/g, function (_, inner) {
      substituted = true;
      var r = exec(w, unquote(inner));
      return (r.out || '').replace(/\n+$/, '');
    });
    /* $VAR and ${VAR} */
    s = s.replace(/\$\{(\w+)\}|\$(\w+|\?)/g, function (m, a, b) {
      var k = a || b;
      if (k === '?') return String(w.lastCode || 0);
      return w.env[k] != null ? w.env[k] : '';
    });
    s = unquote(s);
    /* an unquoted substitution is split into words, as bash does */
    if (substituted && !quoted && /\s/.test(s)) {
      return s.split(/\s+/).filter(Boolean);
    }
    var literal = /[\u0011\u0012\u0013]/.test(s);
    s = s.replace(/\u0011/g, '$').replace(/\u0012/g, '*').replace(/\u0013/g, '?');
    if (literal) return [s];
    /* globbing (unquoted only) */
    if (!quoted && /[*?]/.test(s)) {
      var dir = s.indexOf('/') === -1 ? w.cwd : dirname(resolve(w, s));
      var pat = new RegExp('^' + basename(s).replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
      var hits = children(w, dir).filter(function (p) { return pat.test(basename(p)); })
        .map(function (p) { return s.indexOf('/') === -1 ? basename(p) : p; });
      if (hits.length) return hits;
    }
    return [s];
  }

  /* ── Command table ──────────────────────────────────────────── */
  var CMD = {};
  function ok(out) { return { out: out == null ? '' : out, code: 0 }; }
  function err(msg, code) { return { out: '', err: msg, code: code == null ? 1 : code }; }
  function lines(s) { return s ? s.replace(/\n$/, '').split('\n') : []; }

  function flags(args) {
    var f = {}, rest = [];
    for (var i = 0; i < args.length; i++) {
      var a = args[i];
      if (a.charAt(0) === '-' && a.length > 1 && a !== '-' && !/^-\d/.test(a)) {
        if (a.charAt(1) === '-') f[a.slice(2)] = true;
        else for (var j = 1; j < a.length; j++) f[a.charAt(j)] = true;
        f._raw = (f._raw || []).concat([a]);
      } else rest.push(a);
    }
    return { f: f, rest: rest };
  }

  CMD.pwd = function (w) { return ok(w.cwd + '\n'); };
  CMD.whoami = function (w) { return ok(w.user + '\n'); };
  CMD.hostname = function (w) { return ok(w.host + '\n'); };
  CMD.id = function (w) {
    return ok('uid=' + (w.user === 'root' ? 0 : 1000) + '(' + w.user + ') gid=' +
      (w.user === 'root' ? 0 : 1000) + '(' + w.user + ') groups=' +
      (w.user === 'root' ? '0(root)' : '1000(' + w.user + '),4(adm),190(systemd-journal)') + '\n');
  };
  CMD.uname = function (w, a) {
    var p = flags(a).f;
    if (p.a) return ok('Linux ' + w.host + ' 6.1.0-aws #1 SMP x86_64 GNU/Linux\n');
    if (p.m) return ok('x86_64\n');
    return ok('6.1.0-aws\n');
  };
  CMD.date = function (w) { return ok((w.date || 'Fri Aug 14 09:41:02 UTC 2026') + '\n'); };
  CMD.nproc = function (w) { return ok((w.cores || 4) + '\n'); };
  CMD.echo = function (w, a) {
    var p = flags(a);
    return ok(p.rest.join(' ') + (p.f.n ? '' : '\n'));
  };
  CMD.env = function (w) {
    return ok(Object.keys(w.env).sort().map(function (k) { return k + '=' + w.env[k]; }).join('\n') + '\n');
  };
  CMD.cd = function (w, a) {
    var target = a[0] || '/home/' + w.user;
    if (target === '-') target = w.prevDir || w.cwd;
    var p = resolve(w, target), n = w.fs[p];
    if (!n) return err('cd: ' + target + ': No such file or directory');
    if (n.t !== 'd') return err('cd: ' + target + ': Not a directory');
    w.prevDir = w.cwd; w.cwd = p; w.env.PWD = p;
    return ok('');
  };
  CMD.clear = function () { return { out: '', code: 0, clear: true }; };

  CMD.ls = function (w, a) {
    var p = flags(a), f = p.f;
    var targets = p.rest.length ? p.rest : ['.'];
    var chunks = [];
    targets.forEach(function (t) {
      var abs = resolve(w, t), n = w.fs[abs];
      if (!n) { chunks.push('ls: cannot access \'' + t + '\': No such file or directory'); return; }
      var listing = n.t === 'd' && !f.d;
      var list = listing ? children(w, abs) : [abs];
      /* the dotfile filter applies to a directory's contents, never to a target
         the user named outright — `ls -ld ~/.ssh` must still print .ssh */
      if (!f.a && listing) list = list.filter(function (x) { return basename(x).charAt(0) !== '.'; });
      if (f.S) list.sort(function (x, y) { return sizeOf(w.fs[y]) - sizeOf(w.fs[x]); });
      if (f.t) list.sort(function (x, y) { return (w.fs[y].ts || 0) - (w.fs[x].ts || 0); });
      if (f.r) list.reverse();
      var showPath = !listing;
      if (f.l) {
        var total = list.reduce(function (s, x) { return s + sizeOf(w.fs[x]); }, 0);
        var body = list.map(function (x) {
          var e = w.fs[x];
          return modeStr(e) + ' 1 ' + pad(e.owner, 8, true) + ' ' + pad(e.group, 8, true) + ' ' +
            pad(f.h ? human(sizeOf(e)) : sizeOf(e), 6) + ' ' + mtimeStr(e) + ' ' +
            (showPath ? x : basename(x));
        });
        chunks.push((listing ? 'total ' + (f.h ? human(total) : Math.ceil(total / 1024)) + '\n' : '') + body.join('\n'));
      } else {
        chunks.push(list.map(function (x) { return showPath ? x : basename(x); }).join('  '));
      }
    });
    return ok(chunks.join('\n') + '\n');
  };

  CMD.cat = function (w, a, stdin) {
    var p = flags(a);
    if (!p.rest.length) return ok(stdin);
    var out = '';
    for (var i = 0; i < p.rest.length; i++) {
      var n = node(w, p.rest[i]);
      if (!n) return err('cat: ' + p.rest[i] + ': No such file or directory');
      if (n.t === 'd') return err('cat: ' + p.rest[i] + ': Is a directory');
      if (n.content == null && n.size) {
        return ok('(' + human(n.size) + ' of log output — use head, tail, or grep instead)\n');
      }
      out += n.content;
    }
    if (p.f.n) {
      out = lines(out).map(function (l, i) { return pad(i + 1, 6) + '\t' + l; }).join('\n') + '\n';
    }
    return ok(out);
  };

  function numFlag(args, letter, dflt) {
    for (var i = 0; i < args.length; i++) {
      if (args[i] === '-' + letter && args[i + 1]) return parseInt(args[i + 1], 10);
      var m = args[i].match(new RegExp('^-' + letter + '(\\d+)$'));
      if (m) return parseInt(m[1], 10);
      if (/^-\d+$/.test(args[i])) return parseInt(args[i].slice(1), 10);
    }
    return dflt;
  }
  function fileOrStdin(w, args, stdin) {
    var rest = args.filter(function (a, i) {
      if (a.charAt(0) === '-') return false;
      if (args[i - 1] && /^-[nc]$/.test(args[i - 1])) return false;
      return true;
    });
    if (!rest.length) return { text: stdin || '', name: null };
    var n = node(w, rest[0]);
    if (!n) return { missing: rest[0] };
    if (n.content == null && n.size) return { text: (n.fake || ''), name: rest[0], truncated: true };
    return { text: n.content, name: rest[0] };
  }

  CMD.head = function (w, a, stdin) {
    var n = numFlag(a, 'n', 10), src = fileOrStdin(w, a, stdin);
    if (src.missing) return err('head: cannot open \'' + src.missing + '\' for reading: No such file or directory');
    return ok(lines(src.text).slice(0, n).join('\n') + '\n');
  };
  CMD.tail = function (w, a, stdin) {
    var n = numFlag(a, 'n', 10), src = fileOrStdin(w, a, stdin);
    if (src.missing) return err('tail: cannot open \'' + src.missing + '\' for reading: No such file or directory');
    if (a.indexOf('-f') !== -1 || a.indexOf('-F') !== -1) {
      return ok(lines(src.text).slice(-n).join('\n') + '\n(following… Ctrl-C in a real shell; the sandbox returns immediately)\n');
    }
    return ok(lines(src.text).slice(-n).join('\n') + '\n');
  };
  CMD.wc = function (w, a, stdin) {
    var p = flags(a), src = fileOrStdin(w, a, stdin);
    if (src.missing) return err('wc: ' + src.missing + ': No such file or directory');
    var l = lines(src.text);
    if (p.f.l) return ok(l.length + (src.name ? ' ' + src.name : '') + '\n');
    if (p.f.w) return ok(src.text.split(/\s+/).filter(Boolean).length + '\n');
    if (p.f.c) return ok(src.text.length + '\n');
    return ok(l.length + ' ' + src.text.split(/\s+/).filter(Boolean).length + ' ' + src.text.length +
      (src.name ? ' ' + src.name : '') + '\n');
  };

  CMD.grep = function (w, a, stdin) {
    var p = flags(a), f = p.f, rest = p.rest.slice();
    var ctxAfter = numFlag(a, 'A', 0), ctxBefore = numFlag(a, 'B', 0), ctxBoth = numFlag(a, 'C', 0);
    if (ctxBoth) { ctxAfter = ctxBoth; ctxBefore = ctxBoth; }
    /* -A/-B/-C/-m take a count; only those consumed tokens are dropped.
       Filtering every bare number ate the pattern in `grep 8080`. */
    var eaten = [];
    for (var ci = 0; ci < a.length; ci++) {
      if (/^-[ABCm]$/.test(a[ci]) && /^\d+$/.test(a[ci + 1] || '')) eaten.push(a[ci + 1]);
    }
    rest = rest.filter(function (x) {
      var j = eaten.indexOf(x);
      if (j !== -1) { eaten.splice(j, 1); return false; }
      return true;
    });
    var pat = rest.shift();
    if (pat == null) return err('usage: grep [OPTION]... PATTERN [FILE]...');
    var rx;
    try { rx = new RegExp(pat, f.i ? 'i' : ''); } catch (e) { return err('grep: invalid pattern'); }

    var files = [];
    if (!rest.length) files.push({ name: null, text: stdin || '' });
    else rest.forEach(function (t) {
      var abs = resolve(w, t), n = w.fs[abs];
      if (!n) { files.push({ name: t, missing: true }); return; }
      if (n.t === 'd') {
        if (f.r || f.R) walk(w, abs).forEach(function (p2) {
          if (w.fs[p2].t === 'f') files.push({ name: p2, text: w.fs[p2].content || w.fs[p2].fake || '' });
        });
        else files.push({ name: t, isDir: true });
      } else files.push({ name: t, text: n.content == null ? (n.fake || '') : n.content });
    });

    var out = [], count = 0, matchedFiles = [];
    var multi = files.length > 1;
    files.forEach(function (file) {
      if (file.missing) { out.push('grep: ' + file.name + ': No such file or directory'); return; }
      if (file.isDir) { out.push('grep: ' + file.name + ': Is a directory'); return; }
      var ls = lines(file.text), hit = false;
      ls.forEach(function (line, i) {
        var m = rx.test(line);
        if (f.v ? !m : m) {
          hit = true; count++;
          if (f.l || f.c) return;
          var prefix = (multi && !f.h ? file.name + ':' : '') + (f.n ? (i + 1) + ':' : '');
          if (ctxBefore) for (var b = Math.max(0, i - ctxBefore); b < i; b++) out.push('- ' + ls[b]);
          out.push(prefix + (f.o ? (line.match(rx) || [''])[0] : line));
          if (ctxAfter) for (var c = i + 1; c <= Math.min(ls.length - 1, i + ctxAfter); c++) out.push('- ' + ls[c]);
        }
      });
      if (hit) matchedFiles.push(file.name);
    });
    if (f.c) return { out: count + '\n', code: count ? 0 : 1 };
    if (f.l) return { out: matchedFiles.join('\n') + (matchedFiles.length ? '\n' : ''), code: matchedFiles.length ? 0 : 1 };
    return { out: out.join('\n') + (out.length ? '\n' : ''), code: count ? 0 : 1 };
  };

  CMD.sort = function (w, a, stdin) {
    var p = flags(a), src = fileOrStdin(w, a, stdin);
    if (src.missing) return err('sort: cannot read: ' + src.missing);
    var l = lines(src.text);
    var key = numFlag(a, 'k', 0);
    var sep = null;
    for (var i = 0; i < a.length; i++) {
      var m = a[i].match(/^-t(.)$/); if (m) sep = m[1];
      if (a[i] === '-t' && a[i + 1]) sep = a[i + 1];
    }
    function val(line) {
      if (!key) return line;
      var parts = sep ? line.split(sep) : line.trim().split(/\s+/);
      return parts[key - 1] || '';
    }
    function num(s) {
      var m = String(s).match(/^\s*([\d.]+)\s*([KMGT])?/i);
      if (!m) return NaN;
      var mult = { K: 1024, M: 1048576, G: 1073741824, T: 1099511627776 }[(m[2] || '').toUpperCase()] || 1;
      return parseFloat(m[1]) * mult;
    }
    l.sort(function (x, y) {
      var vx = val(x), vy = val(y);
      if (p.f.n || p.f.h) {
        var nx = num(vx), ny = num(vy);
        if (isNaN(nx) && isNaN(ny)) return vx < vy ? -1 : vx > vy ? 1 : 0;
        return (isNaN(nx) ? -Infinity : nx) - (isNaN(ny) ? -Infinity : ny);
      }
      return vx < vy ? -1 : vx > vy ? 1 : 0;
    });
    if (p.f.r) l.reverse();
    if (p.f.u) l = l.filter(function (x, i) { return i === 0 || x !== l[i - 1]; });
    return ok(l.join('\n') + '\n');
  };

  CMD.uniq = function (w, a, stdin) {
    var p = flags(a), src = fileOrStdin(w, a, stdin);
    var l = lines(src.text), out = [], counts = [];
    l.forEach(function (line) {
      if (out.length && out[out.length - 1] === line) counts[counts.length - 1]++;
      else { out.push(line); counts.push(1); }
    });
    if (p.f.c) return ok(out.map(function (x, i) { return pad(counts[i], 7) + ' ' + x; }).join('\n') + '\n');
    if (p.f.d) return ok(out.filter(function (x, i) { return counts[i] > 1; }).join('\n') + '\n');
    if (p.f.u) return ok(out.filter(function (x, i) { return counts[i] === 1; }).join('\n') + '\n');
    return ok(out.join('\n') + '\n');
  };

  CMD.cut = function (w, a, stdin) {
    var delim = ' ', fieldSpec = null, charSpec = null;
    for (var i = 0; i < a.length; i++) {
      var m;
      if ((m = a[i].match(/^-d(.+)$/))) delim = m[1];
      else if (a[i] === '-d' && a[i + 1] != null) delim = a[++i];
      else if ((m = a[i].match(/^-f(.+)$/))) fieldSpec = m[1];
      else if (a[i] === '-f' && a[i + 1]) fieldSpec = a[++i];
      else if ((m = a[i].match(/^-c(.+)$/))) charSpec = m[1];
      else if (a[i] === '-c' && a[i + 1]) charSpec = a[++i];
    }
    var src = fileOrStdin(w, a.filter(function (x) { return x.charAt(0) !== '-'; }), stdin);
    if (src.missing) return err('cut: ' + src.missing + ': No such file or directory');
    var out = lines(src.text).map(function (line) {
      if (charSpec) {
        var cm = charSpec.split('-');
        return line.slice(parseInt(cm[0], 10) - 1, cm[1] ? parseInt(cm[1], 10) : undefined);
      }
      var parts = line.split(delim);
      return fieldSpec.split(',').map(function (spec) {
        if (spec.indexOf('-') !== -1) {
          var r = spec.split('-');
          return parts.slice(parseInt(r[0], 10) - 1, r[1] ? parseInt(r[1], 10) : undefined).join(delim);
        }
        return parts[parseInt(spec, 10) - 1] || '';
      }).join(delim);
    });
    return ok(out.join('\n') + '\n');
  };

  /* awk subset: -F sep, pattern { print $n, ... } / END { print sum } */
  CMD.awk = function (w, a, stdin) {
    var sep = null, prog = null, files = [];
    for (var i = 0; i < a.length; i++) {
      var m;
      if ((m = a[i].match(/^-F(.+)$/))) sep = m[1];
      else if (a[i] === '-F' && a[i + 1]) sep = a[++i];
      else if (prog === null) prog = a[i];
      else files.push(a[i]);
    }
    if (prog === null) return err('usage: awk [-F sep] \'program\' [file]');
    var src = files.length ? fileOrStdin(w, files, stdin) : { text: stdin || '' };
    if (src.missing) return err('awk: cannot open ' + src.missing);

    var body = prog.replace(/^\s*/, '');
    var endMatch = body.match(/END\s*\{([^}]*)\}/);
    var mainMatch = body.match(/^([^{]*)\{([^}]*)\}/);
    var pattern = mainMatch ? mainMatch[1].trim() : (endMatch ? null : body.trim());
    var action = mainMatch ? mainMatch[2].trim() : 'print';
    var vars = { sum: 0 }, out = [], NR = 0;

    function fields(line) { return sep ? line.split(sep) : line.trim().split(/\s+/); }
    function value(expr, F, nr) {
      expr = expr.trim();
      if (expr === '$0') return F.join(' ');
      if (expr === 'NR') return nr;
      if (expr === 'NF') return F.length;
      var m2 = expr.match(/^\$(\d+)$/);
      if (m2) return F[parseInt(m2[1], 10) - 1] != null ? F[parseInt(m2[1], 10) - 1] : '';
      if (/^".*"$/.test(expr)) return expr.slice(1, -1);
      if (/^-?[\d.]+$/.test(expr)) return parseFloat(expr);
      if (vars[expr] != null) return vars[expr];
      return expr;
    }
    function truthy(pat, F, nr) {
      if (!pat) return true;
      if (/^\/.*\/$/.test(pat)) return new RegExp(pat.slice(1, -1)).test(F.join(' '));
      var cmp = pat.match(/^(.+?)\s*(>=|<=|==|!=|>|<|~)\s*(.+)$/);
      if (cmp) {
        var l = value(cmp[1], F, nr), r = value(cmp[3], F, nr);
        if (cmp[2] === '~') return new RegExp(String(r).replace(/^\/|\/$/g, '')).test(l);
        var ln = parseFloat(l), rn = parseFloat(r);
        if (!isNaN(ln) && !isNaN(rn)) { l = ln; r = rn; }
        switch (cmp[2]) {
          case '>': return l > r; case '<': return l < r;
          case '>=': return l >= r; case '<=': return l <= r;
          case '==': return l == r; case '!=': return l != r;
        }
      }
      var mod = pat.match(/^NR\s*%\s*(\d+)\s*==\s*(\d+)$/);
      if (mod) return nr % parseInt(mod[1], 10) === parseInt(mod[2], 10);
      return !!value(pat, F, nr);
    }
    function runAction(act, F, nr) {
      act.split(';').forEach(function (stmt) {
        stmt = stmt.trim();
        if (!stmt) return;
        var acc = stmt.match(/^(\w+)\s*\+=\s*(.+)$/);
        if (acc) { vars[acc[1]] = (vars[acc[1]] || 0) + parseFloat(value(acc[2], F, nr) || 0); return; }
        var assign = stmt.match(/^(\w+)\s*=\s*(.+)$/);
        if (assign && !/^print/.test(stmt)) { vars[assign[1]] = value(assign[2], F, nr); return; }
        if (/^print\b/.test(stmt)) {
          var argsStr = stmt.replace(/^print\s*/, '');
          if (!argsStr) { out.push(F.join(' ')); return; }
          var parts = argsStr.split(/\s*,\s*/).map(function (x) { return value(x, F, nr); });
          out.push(parts.join(' '));
        }
      });
    }
    lines(src.text).forEach(function (line) {
      NR++;
      var F = fields(line);
      if (truthy(pattern, F, NR)) runAction(action, F, NR);
    });
    if (endMatch) runAction(endMatch[1], [], NR);
    return ok(out.join('\n') + (out.length ? '\n' : ''));
  };

  /* sed subset: s/a/b/[g], -n 'N,Mp', '/re/d', -i */
  CMD.sed = function (w, a, stdin) {
    var inPlace = false, quiet = false, script = null, files = [], suffix = '';
    for (var i = 0; i < a.length; i++) {
      var t = a[i];
      if (/^-i/.test(t)) { inPlace = true; suffix = t.slice(2); }
      else if (t === '-n') quiet = true;
      else if (t === '-e' && a[i + 1]) script = a[++i];
      else if (t === '-E' || t === '-r') continue;
      else if (script === null) script = t;
      else files.push(t);
    }
    if (!script) return err('usage: sed [-n] [-i] script [file]');
    var src = files.length ? fileOrStdin(w, files, stdin) : { text: stdin || '' };
    if (src.missing) return err('sed: can\'t read ' + src.missing + ': No such file or directory');
    var input = lines(src.text), out = [];

    var sub = script.match(/^s(.)(.*?)\1(.*?)\1([gi]*)$/);
    var rangeP = script.match(/^(\d+),(\d+)p$/);
    var reDel = script.match(/^\/(.*)\/d$/);
    var reP = script.match(/^\/(.*)\/p$/);

    input.forEach(function (line, idx) {
      if (sub) {
        var rx = new RegExp(sub[2], sub[4].indexOf('g') !== -1 ? 'g' : '');
        out.push(line.replace(rx, sub[3]));
      } else if (rangeP) {
        if (idx + 1 >= +rangeP[1] && idx + 1 <= +rangeP[2]) out.push(line);
      } else if (reDel) {
        if (!new RegExp(reDel[1]).test(line)) out.push(line);
      } else if (reP) {
        if (new RegExp(reP[1]).test(line)) out.push(line);
      } else out.push(line);
    });
    var text = out.join('\n') + (out.length ? '\n' : '');
    if (inPlace && files.length) {
      var abs = resolve(w, files[0]);
      if (suffix) mkfile(w, abs + suffix, w.fs[abs].content, { mode: w.fs[abs].mode, owner: w.fs[abs].owner });
      w.fs[abs].content = text;
      w.fs[abs].size = null;
      return ok('');
    }
    return ok(quiet && !rangeP && !reP ? '' : text);
  };

  CMD.tr = function (w, a, stdin) {
    var p = flags(a), rest = p.rest;
    var s = stdin || '';
    if (p.f.d && rest[0]) return ok(s.split('').filter(function (c) { return rest[0].indexOf(c) === -1; }).join(''));
    if (p.f.s && rest[0]) return ok(s.replace(new RegExp('[' + rest[0] + ']+', 'g'), rest[0]));
    if (rest.length >= 2) {
      var from = rest[0].replace(/A-Z/, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ').replace(/a-z/, 'abcdefghijklmnopqrstuvwxyz');
      var to = rest[1].replace(/A-Z/, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ').replace(/a-z/, 'abcdefghijklmnopqrstuvwxyz');
      return ok(s.split('').map(function (c) {
        var i = from.indexOf(c); return i === -1 ? c : (to[i] || to[to.length - 1]);
      }).join(''));
    }
    return ok(s);
  };

  CMD.tee = function (w, a, stdin) {
    var p = flags(a);
    p.rest.forEach(function (t) {
      var abs = resolve(w, t);
      if (p.f.a && w.fs[abs]) w.fs[abs].content = (w.fs[abs].content || '') + stdin;
      else mkfile(w, abs, stdin);
    });
    return ok(stdin);
  };

  CMD.find = function (w, a) {
    var start = (a[0] && a[0].charAt(0) !== '-') ? a[0] : '.';
    var namePat = null, iname = null, type = null, sizeMin = null, mtime = null, maxdepth = null;
    var doDelete = false, execCmd = null;
    /* real find rejects a path that turns up after the expression has begun,
       which is what `find -size +100M /var/log` is */
    for (var pi = (start === '.' ? 0 : 1); pi < a.length; pi++) {
      if (a[pi].charAt(0) === '-') break;
    }
    for (var qi = pi; qi < a.length; qi++) {
      if (a[qi].charAt(0) !== '-' && !/^[+-]?\d/.test(a[qi]) &&
          ['-name','-iname','-type','-size','-mtime','-maxdepth','-exec','-newer','-perm','-user']
            .indexOf(a[qi - 1]) === -1 &&
          a[qi] !== '{}' && a[qi] !== '+' && a[qi] !== ';' && a[qi] !== '\\;' &&
          a.indexOf('-exec') === -1) {
        return err('find: paths must precede expression: \'' + a[qi] + '\'\n' +
          'find: possible unquoted pattern after predicate `' + a[qi - 1] + '\'?');
      }
    }
    for (var i = 0; i < a.length; i++) {
      switch (a[i]) {
        case '-name': namePat = a[++i]; break;
        case '-iname': iname = a[++i]; break;
        case '-type': type = a[++i]; break;
        case '-size': sizeMin = a[++i]; break;
        case '-mtime': mtime = a[++i]; break;
        case '-maxdepth': maxdepth = parseInt(a[++i], 10); break;
        case '-delete': doDelete = true; break;
        case '-exec': execCmd = a.slice(i + 1).join(' ').replace(/\s*(\\;|\+)\s*$/, ''); i = a.length; break;
      }
    }
    if (sizeMin != null && !/^[+-]?\d+[bckMGwT]?$/.test(sizeMin)) {
      return err('find: Invalid argument `' + sizeMin + '\' to -size');
    }
    var base = resolve(w, start);
    if (!w.fs[base]) return err('find: \'' + start + '\': No such file or directory');
    var all = walk(w, base).filter(function (p) {
      var n = w.fs[p];
      if (maxdepth != null) {
        var depth = p === base ? 0 : p.slice(base.length).split('/').filter(Boolean).length;
        if (depth > maxdepth) return false;
      }
      if (type === 'f' && n.t !== 'f') return false;
      if (type === 'd' && n.t !== 'd') return false;
      if (type === 'l' && n.t !== 'l') return false;
      if (namePat) {
        var rx = new RegExp('^' + namePat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
        if (!rx.test(basename(p))) return false;
      }
      if (iname) {
        var rx2 = new RegExp('^' + iname.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i');
        if (!rx2.test(basename(p))) return false;
      }
      if (sizeMin) {
        var m = sizeMin.match(/^([+-]?)(\d+)([bckMGwT]?)$/);
        if (m) {
          var mult = { k: 1024, M: 1048576, G: 1073741824, '': 512 }[m[3]];
          var want = parseInt(m[2], 10) * mult, have = sizeOf(n);
          if (m[1] === '+' && !(have > want)) return false;
          if (m[1] === '-' && !(have < want)) return false;
          if (!m[1] && have !== want) return false;
        }
      }
      if (mtime) {
        var mm = mtime.match(/^([+-]?)(\d+)$/);
        if (mm) {
          var age = n.ageDays != null ? n.ageDays : 0;
          if (mm[1] === '+' && !(age > +mm[2])) return false;
          if (mm[1] === '-' && !(age < +mm[2])) return false;
        }
      }
      return true;
    });
    if (doDelete) {
      all.forEach(function (p) { if (p !== base) delete w.fs[p]; });
      return ok('');
    }
    if (execCmd) {
      var out = '';
      var targets = all.filter(function (p) { return p !== base; });
      if (/\{\}\s*$/.test(execCmd) || execCmd.indexOf('{}') !== -1) {
        var cmdStr = execCmd.replace('{}', targets.join(' '));
        var r = exec(w, cmdStr);
        out += r.out || '';
      }
      return ok(out);
    }
    return ok(all.join('\n') + (all.length ? '\n' : ''));
  };

  CMD.xargs = function (w, a, stdin) {
    var items = (stdin || '').split(/\s+/).filter(Boolean);
    var cmdStr = a.filter(function (x) { return x.charAt(0) !== '-'; }).join(' ');
    if (!cmdStr) return ok(items.join(' ') + '\n');
    return exec(w, cmdStr + ' ' + items.join(' '));
  };

  CMD.du = function (w, a) {
    var p = flags(a), f = p.f;
    var depth = numFlag(a, 'd', f.s ? 0 : 1);
    var targets = p.rest.length ? p.rest : ['.'];
    var out = [];
    targets.forEach(function (t) {
      var base = resolve(w, t);
      if (!w.fs[base]) { out.push('du: cannot access \'' + t + '\': No such file or directory'); return; }
      function total(dir) {
        return walk(w, dir).reduce(function (s, p2) {
          return s + (w.fs[p2].t === 'f' ? sizeOf(w.fs[p2]) : 0);
        }, 0);
      }
      if (!f.s && depth >= 1) {
        children(w, base).forEach(function (c) {
          if (w.fs[c].t === 'd' || f.a) out.push((f.h ? human(total(c)) : Math.ceil(total(c) / 1024)) + '\t' + c);
        });
      }
      out.push((f.h ? human(total(base)) : Math.ceil(total(base) / 1024)) + '\t' + (t === '.' ? base : t));
    });
    return ok(out.join('\n') + '\n');
  };

  CMD.df = function (w, a) {
    var p = flags(a), f = p.f;
    var disks = w.disks || [];
    if (p.rest.length) {
      var picked = p.rest.map(function (t) { return mountOf(w, resolve(w, t)); })
        .filter(function (d, i, arr) { return d && arr.indexOf(d) === i; });
      if (picked.length) disks = picked;
    }
    var rows = disks.map(function (d) {
      if (f.i) {
        var iuse = Math.round(d.iused / d.inodes * 100);
        return [d.fs, d.inodes, d.iused, d.inodes - d.iused, iuse + '%', d.mount];
      }
      var used = diskUsed(w, d), avail = Math.max(0, d.size - used);
      var pct = Math.min(100, Math.round(used / d.size * 100));
      return [d.fs, f.h ? human(d.size) : Math.round(d.size / 1024),
              f.h ? human(used) : Math.round(used / 1024),
              f.h ? human(avail) : Math.round(avail / 1024), pct + '%', d.mount];
    });
    var head = f.i ? ['Filesystem', 'Inodes', 'IUsed', 'IFree', 'IUse%', 'Mounted on']
                   : ['Filesystem', 'Size', 'Used', 'Avail', 'Use%', 'Mounted on'];
    var all = [head].concat(rows);
    var widths = head.map(function (_, i) {
      return Math.max.apply(null, all.map(function (r) { return String(r[i]).length; }));
    });
    return ok(all.map(function (r) {
      return r.map(function (c, i) {
        return i === 0 || i === 5 ? pad(c, widths[i], true) : pad(c, widths[i]);
      }).join(' ');
    }).join('\n') + '\n');
  };

  CMD.touch = function (w, a) {
    flags(a).rest.forEach(function (t) {
      var abs = resolve(w, t);
      if (w.fs[abs]) w.fs[abs].mtime = w.now;
      else mkfile(w, abs, '');
    });
    return ok('');
  };
  CMD.mkdir = function (w, a) {
    var p = flags(a);
    for (var i = 0; i < p.rest.length; i++) {
      var abs = resolve(w, p.rest[i]);
      if (!p.f.p && !w.fs[dirname(abs)]) return err('mkdir: cannot create directory ‘' + p.rest[i] + '’: No such file or directory');
      if (!p.f.p && w.fs[abs]) return err('mkdir: cannot create directory ‘' + p.rest[i] + '’: File exists');
      mkdirp(w, abs);
    }
    return ok('');
  };
  CMD.rm = function (w, a) {
    var p = flags(a);
    for (var i = 0; i < p.rest.length; i++) {
      var abs = resolve(w, p.rest[i]), n = w.fs[abs];
      if (!n) { if (!p.f.f) return err('rm: cannot remove \'' + p.rest[i] + '\': No such file or directory'); continue; }
      if (n.t === 'd' && !p.f.r) return err('rm: cannot remove \'' + p.rest[i] + '\': Is a directory');
      /* a file held open by a process keeps its blocks until the holder closes it */
      var holder = (w.procs || []).filter(function (pr) { return (pr.open || []).indexOf(abs) !== -1; })[0];
      if (holder && n.t === 'f') {
        w.deleted = w.deleted || [];
        w.deleted.push({ path: abs, size: sizeOf(n), pid: holder.pid, cmd: holder.cmd });
        var d = mountOf(w, abs);
        if (d) d.base = (d.base || 0) + sizeOf(n);
      }
      walk(w, abs).forEach(function (p2) { delete w.fs[p2]; });
    }
    return ok('');
  };
  CMD.cp = function (w, a) {
    var p = flags(a), src = p.rest[0], dst = p.rest[1];
    if (!src || !dst) return err('cp: missing file operand');
    var from = resolve(w, src), to = resolve(w, dst);
    if (!w.fs[from]) return err('cp: cannot stat \'' + src + '\': No such file or directory');
    if (w.fs[to] && w.fs[to].t === 'd') to = to + '/' + basename(from);
    if (w.fs[from].t === 'd') {
      if (!p.f.r && !p.f.a) return err('cp: -r not specified; omitting directory \'' + src + '\'');
      walk(w, from).forEach(function (p2) {
        var rel = p2.slice(from.length);
        w.fs[to + rel] = JSON.parse(JSON.stringify(w.fs[p2]));
      });
    } else {
      w.fs[to] = JSON.parse(JSON.stringify(w.fs[from]));
    }
    return ok('');
  };
  CMD.mv = function (w, a) {
    var r = CMD.cp(w, ['-r'].concat(a));
    if (r.code) return r;
    var from = resolve(w, flags(a).rest[0]);
    walk(w, from).forEach(function (p2) { delete w.fs[p2]; });
    return ok('');
  };
  CMD.ln = function (w, a) {
    var p = flags(a), target = p.rest[0], name = p.rest[1];
    if (!target || !name) return err('ln: missing file operand');
    var abs = resolve(w, name);
    w.fs[abs] = { t: p.f.s ? 'l' : 'f', mode:'777', owner:w.user, group:w.user,
                  target: resolve(w, target), size: 0, mtime: w.now };
    return ok('');
  };
  CMD.truncate = function (w, a) {
    var size = null, targets = [];
    for (var i = 0; i < a.length; i++) {
      if (a[i] === '-s' && a[i + 1] != null) size = a[++i];
      else if (/^-s/.test(a[i])) size = a[i].slice(2);
      else if (a[i].charAt(0) !== '-') targets.push(a[i]);
    }
    if (size == null) return err('truncate: you must specify either --size or --reference');
    targets.forEach(function (t) {
      var n = node(w, t);
      if (!n) { mkfile(w, t, ''); n = node(w, t); }
      var bytes = parseInt(size, 10) || 0;
      n.size = bytes; n.content = bytes === 0 ? '' : (n.content || '');
      /* truncating a file a process holds open keeps the descriptor — space returns */
    });
    return ok('');
  };
  CMD.stat = function (w, a) {
    var p = flags(a), t = p.rest[p.rest.length - 1], n = node(w, t);
    if (!n) return err('stat: cannot statx \'' + t + '\': No such file or directory');
    var fmtIdx = a.indexOf('-c');
    if (fmtIdx !== -1 && a[fmtIdx + 1]) {
      return ok(a[fmtIdx + 1].replace(/%a/g, n.mode).replace(/%U/g, n.owner)
        .replace(/%G/g, n.group).replace(/%n/g, resolve(w, t)).replace(/%s/g, sizeOf(n)) + '\n');
    }
    return ok('  File: ' + resolve(w, t) + '\n  Size: ' + sizeOf(n) +
      '\tBlocks: ' + Math.ceil(sizeOf(n) / 512) + '   IO Block: 4096   ' +
      (n.t === 'd' ? 'directory' : 'regular file') +
      '\nAccess: (0' + n.mode + '/' + modeStr(n) + ')  Uid: ( 1000/' + n.owner +
      ')   Gid: ( 1000/' + n.group + ')\n');
  };
  CMD.chmod = function (w, a) {
    var p = flags(a), mode = p.rest[0], targets = p.rest.slice(1);
    if (!mode || !targets.length) return err('chmod: missing operand');
    targets.forEach(function (t) {
      var list = p.f.R ? walk(w, t) : [resolve(w, t)];
      list.forEach(function (abs) {
        var n = w.fs[abs];
        if (!n) return;
        if (/^\d+$/.test(mode)) n.mode = mode.length === 4 ? mode.slice(1) : mode;
        else {
          var m = mode.match(/^([ugoa]*)([+-=])([rwx]+)$/);
          if (!m) return;
          var digits = String(n.mode).split('').map(Number);
          var who = m[1] || 'a', bits = 0;
          if (m[3].indexOf('r') !== -1) bits += 4;
          if (m[3].indexOf('w') !== -1) bits += 2;
          if (m[3].indexOf('x') !== -1) bits += 1;
          [['u', 0], ['g', 1], ['o', 2]].forEach(function (pairs) {
            if (who.indexOf(pairs[0]) !== -1 || who.indexOf('a') !== -1) {
              if (m[2] === '+') digits[pairs[1]] |= bits;
              else if (m[2] === '-') digits[pairs[1]] &= ~bits;
              else digits[pairs[1]] = bits;
            }
          });
          n.mode = digits.join('');
        }
      });
    });
    return ok('');
  };
  CMD.chown = function (w, a) {
    var p = flags(a), spec = p.rest[0], targets = p.rest.slice(1);
    if (w.user !== 'root' && !w.sudo) return err('chown: changing ownership: Operation not permitted');
    var parts = (spec || '').split(':');
    targets.forEach(function (t) {
      (p.f.R ? walk(w, t) : [resolve(w, t)]).forEach(function (abs) {
        var n = w.fs[abs];
        if (!n) return;
        if (parts[0]) n.owner = parts[0];
        if (parts[1]) n.group = parts[1];
      });
    });
    return ok('');
  };

  /* ── Process / system commands ──────────────────────────────── */
  CMD.ps = function (w, a) {
    var procs = w.procs || [];
    var head = 'USER       PID %CPU %MEM    VSZ   RSS STAT  TIME COMMAND';
    if (a.indexOf('-ef') !== -1) head = 'UID          PID    PPID  C STIME TTY          TIME CMD';
    var rows = procs.map(function (p) {
      return pad(p.user, 8, true) + ' ' + pad(p.pid, 5) + ' ' + pad(p.cpu != null ? p.cpu.toFixed(1) : '0.0', 4) +
        ' ' + pad(p.mem != null ? p.mem.toFixed(1) : '0.0', 4) + ' ' + pad(p.vsz || 118204, 6) + ' ' +
        pad(p.rss || 2884, 5) + ' ' + pad(p.state || 'S', 4, true) + ' ' + pad(p.time || '0:01', 5) + ' ' + p.cmd;
    });
    return ok(head + '\n' + rows.join('\n') + '\n');
  };
  CMD.top = function (w, a) {
    var procs = (w.procs || []).slice().sort(function (x, y) { return (y.cpu || 0) - (x.cpu || 0); });
    var m = w.mem || { total: 3829, free: 148, used: 2913, cache: 767 };
    var c = w.cpu || { us: 2.1, sy: 1.4, id: 88.0, wa: 8.5 };
    return ok('top - 15:41:20 up ' + (w.uptime || '12 days') + ',  2 users,  load average: ' +
      (w.load || '0.42, 0.51, 0.48') + '\n' +
      'Tasks: ' + procs.length + ' total,   1 running, ' + (procs.length - 1) + ' sleeping\n' +
      '%Cpu(s): ' + c.us + ' us, ' + c.sy + ' sy,  0.0 ni, ' + c.id + ' id, ' + c.wa + ' wa\n' +
      'MiB Mem : ' + m.total + '.0 total, ' + m.free + '.0 free, ' + m.used + '.0 used, ' + m.cache + '.0 buff/cache\n\n' +
      '  PID USER      PR  NI    VIRT    RES  %CPU  %MEM COMMAND\n' +
      procs.slice(0, 8).map(function (p) {
        return pad(p.pid, 5) + ' ' + pad(p.user, 9, true) + ' 20   0 ' + pad(p.vsz || 118204, 7) + ' ' +
          pad(p.rss || 2884, 6) + ' ' + pad((p.cpu || 0).toFixed(1), 5) + ' ' +
          pad((p.mem || 0).toFixed(1), 5) + ' ' + p.cmd.split(' ')[0];
      }).join('\n') + '\n');
  };
  CMD.free = function (w, a) {
    var h = flags(a).f.h;
    var m = w.mem || { total: 3829, free: 148, used: 2913, cache: 767, available: 610 };
    function v(mb) { return h ? (mb >= 1024 ? (mb / 1024).toFixed(1) + 'Gi' : mb + 'Mi') : mb * 1024; }
    return ok('               total        used        free      shared  buff/cache   available\n' +
      'Mem:    ' + pad(v(m.total), 12) + pad(v(m.used), 12) + pad(v(m.free), 12) + pad(v(21), 12) +
      pad(v(m.cache), 12) + pad(v(m.available != null ? m.available : m.free + m.cache), 12) + '\n' +
      'Swap:   ' + pad(v(m.swap || 0), 12) + pad(v(0), 12) + pad(v(m.swap || 0), 12) + '\n');
  };
  CMD.iostat = function (w, a) {
    var devs = (w.io && w.io.devices) || [];
    if (!devs.length) return ok('Linux 6.1.0-aws\n\nDevice   r/s  w/s  rkB/s  wkB/s  await  aqu-sz  %util\n');
    return ok('Linux 6.1.0-aws (' + w.host + ')\n\n' +
      'Device      r/s     w/s     rkB/s     wkB/s   await  aqu-sz   %util\n' +
      devs.map(function (d) {
        return pad(d.name, 8, true) + pad(d.r.toFixed(1), 8) + pad(d.w.toFixed(1), 8) +
          pad(d.rkb.toFixed(1), 10) + pad(d.wkb.toFixed(1), 10) + pad(d.await.toFixed(2), 8) +
          pad(d.qu.toFixed(2), 8) + pad(d.util.toFixed(1), 8);
      }).join('\n') + '\n');
  };
  CMD.pidstat = function (w, a) {
    var io = (w.io && w.io.perProcess) || [];
    if (a.indexOf('-d') === -1) {
      return ok('Linux 6.1.0-aws\n\nUID   PID   %usr %system  %CPU   CPU  Command\n' +
        (w.procs || []).map(function (p2) {
          return pad(1000, 4) + pad(p2.pid, 6) + pad((p2.cpu || 0).toFixed(2), 7) +
            pad('0.10', 8) + pad((p2.cpu || 0).toFixed(2), 6) + pad(0, 6) + '  ' + p2.cmd.split(' ')[0];
        }).join('\n') + '\n');
    }
    return ok('Linux 6.1.0-aws\n\nUID   PID    kB_rd/s   kB_wr/s kB_ccwr/s iodelay Command\n' +
      io.map(function (x) {
        return pad(x.uid != null ? x.uid : 0, 4) + pad(x.pid, 6) + pad(x.rd.toFixed(1), 11) +
          pad(x.wr.toFixed(1), 10) + pad('0.00', 10) + pad(x.delay || 0, 8) + '  ' + x.cmd;
      }).join('\n') + '\n');
  };
  CMD.ionice = function (w, a) {
    var pid = null;
    for (var i = 0; i < a.length; i++) if (a[i] === '-p' && a[i + 1]) pid = parseInt(a[++i], 10);
    var cls = /-c\s*3|^-c3$/.test(a.join(' ')) ? 3 : null;
    var proc = (w.procs || []).filter(function (x) { return x.pid === pid; })[0];
    if (!proc) return err('ionice: failed to set pid ' + pid + '\'s I/O class: No such process');
    proc.ionice = cls;
    if (cls === 3 && w.io) {
      /* the greedy job stands aside. Only the devices it was actually saturating
         recover — an already-idle volume must not be made to look worse. */
      (w.io.devices || []).forEach(function (d) {
        if (d.util < 50) return;
        d.util = 38.6; d.await = 9.21; d.qu = 1.94;
        d.w /= 4; d.wkb /= 4; d.r /= 4; d.rkb /= 4;
      });
      w.load = '4.12, 9.80, 8.91';
      if (w.cpu) { w.cpu.wa = 12.4; w.cpu.id = 82.1; }
      (w.io.perProcess || []).forEach(function (x) { if (x.pid === pid) { x.rd /= 4; x.wr /= 4; x.delay = 22; } });
    }
    return ok('');
  };
  CMD.renice = function (w, a) {
    var pid = null, n = null;
    for (var i = 0; i < a.length; i++) {
      if (a[i] === '-p' && a[i + 1]) pid = parseInt(a[++i], 10);
      if (a[i] === '-n' && a[i + 1]) n = parseInt(a[++i], 10);
    }
    var proc = (w.procs || []).filter(function (x) { return x.pid === pid; })[0];
    if (!proc) return err('renice: failed to get priority: No such process');
    proc.nice = n;
    return ok(pid + ' (process ID) old priority 0, new priority ' + n + '\n');
  };
  CMD.uptime = function (w) {
    return ok(' 15:41:02 up ' + (w.uptime || '12 days') + ',  2 users,  load average: ' + (w.load || '0.42, 0.51, 0.48') + '\n');
  };
  CMD.kill = function (w, a) {
    var p = flags(a);
    var pid = parseInt(p.rest[p.rest.length - 1], 10);
    var proc = (w.procs || []).filter(function (x) { return x.pid === pid; })[0];
    if (!proc) return err('kill: (' + pid + '): No such process');
    w.procs = w.procs.filter(function (x) { return x.pid !== pid; });
    if (proc.unit && w.units[proc.unit]) w.units[proc.unit].active = false;
    return ok('');
  };
  CMD.dmesg = function (w, a) {
    var msgs = w.dmesg || [];
    return ok(msgs.join('\n') + (msgs.length ? '\n' : ''));
  };
  CMD.lsof = function (w, a) {
    var joined = a.join(' ');
    if (/\+L1/.test(joined)) {
      var del = w.deleted || [];
      if (!del.length) return ok('');
      return ok('COMMAND   PID   USER   FD   TYPE DEVICE  SIZE/OFF NLINK  NODE NAME\n' +
        del.map(function (d) {
          return pad(d.cmd.split(' ')[0], 9, true) + pad(d.pid, 5) + '  ' + w.user + '   12w   REG  259,2 ' +
            pad(d.size, 12) + '     0 44210 ' + d.path + ' (deleted)';
        }).join('\n') + '\n');
    }
    var portMatch = joined.match(/-i\s*:(\d+)/);
    if (portMatch) {
      var s = (w.sockets || []).filter(function (x) { return String(x.port) === portMatch[1]; });
      return ok(s.length ? 'COMMAND   PID   USER   FD   TYPE  NODE NAME\n' + s.map(function (x) {
        return pad(x.cmd, 9, true) + pad(x.pid, 5) + '  ' + x.user + '   7u  IPv4  TCP ' + x.addr + ':' + x.port + ' (LISTEN)';
      }).join('\n') + '\n' : '');
    }
    return ok('');
  };
  CMD.ss = function (w, a) {
    var socks = w.sockets || [];
    var head = 'Netid State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process\n';
    return ok(head + socks.map(function (s) {
      return 'tcp   LISTEN 0      4096   ' + pad(s.addr + ':' + s.port, 19, true) + ' 0.0.0.0:*' +
        '  users:(("' + s.cmd + '",pid=' + s.pid + ',fd=7))';
    }).join('\n') + '\n');
  };
  CMD.systemctl = function (w, a) {
    var verb = a[0], unit = (a[1] || '').replace(/\.service$/, '');
    var units = w.units || {};
    if (verb === 'list-units' || verb === 'list-unit-files') {
      var argstr = a.join(' ');
      var onlyFailed = /--failed|--state[= ]failed/.test(argstr);
      var names = Object.keys(units).filter(function (u) {
        return !onlyFailed || units[u].failed;
      });
      if (!names.length) return ok('0 loaded units listed.\n');
      var rows = names.map(function (u) {
        var U2 = units[u];
        var active = U2.failed ? 'failed' : (U2.active ? 'active' : 'inactive');
        var sub = U2.failed ? 'failed' : (U2.active ? 'running' : 'dead');
        return (U2.failed ? '● ' : '  ') + pad(u + '.service', 24, true) +
          ' loaded ' + pad(active, 9, true) + pad(sub, 9, true) + (U2.desc || u);
      });
      return ok('  UNIT                     LOAD   ACTIVE   SUB      DESCRIPTION\n' +
        rows.join('\n') + '\n\n' + names.length + ' loaded units listed.\n');
    }
    var U = units[unit];
    if (!U && verb !== 'daemon-reload') return err('Unit ' + unit + '.service could not be found.');
    switch (verb) {
      case 'status':
        return {
          out: '● ' + unit + '.service - ' + (U.desc || unit) + '\n' +
            '     Loaded: loaded (/etc/systemd/system/' + unit + '.service; ' + (U.enabled ? 'enabled' : 'disabled') + ')\n' +
            '     Active: ' + (U.active ? 'active (running) since Fri 2026-08-14 09:02:11 UTC' : 'failed (Result: ' + (U.result || 'exit-code') + ')') + '\n' +
            (U.active ? '   Main PID: ' + (U.pid || 8123) + ' (' + unit + ')\n' : '') + '\n' +
            (U.log || []).slice(-4).join('\n') + '\n',
          code: U.active ? 0 : 3
        };
      case 'start': case 'restart':
        if (U.validate && !U.validate(w)) {
          U.active = false; U.failed = true;
          return err('Job for ' + unit + '.service failed because the control process exited with error code.\nSee "systemctl status ' + unit + '.service" and "journalctl -xeu ' + unit + '.service" for details.');
        }
        U.active = true; U.failed = false;
        if (U.onStart) U.onStart(w);
        return ok('');
      case 'stop': U.active = false; return ok('');
      case 'enable': U.enabled = true; if (a.indexOf('--now') !== -1) U.active = true; return ok('');
      case 'disable': U.enabled = false; return ok('');
      case 'is-active': return { out: (U.active ? 'active' : 'inactive') + '\n', code: U.active ? 0 : 3 };
      case 'is-enabled': return { out: (U.enabled ? 'enabled' : 'disabled') + '\n', code: U.enabled ? 0 : 1 };
      case 'cat': return ok(U.unitFile || '# /etc/systemd/system/' + unit + '.service\n[Service]\nExecStart=/usr/local/bin/' + unit + '\n');
      case 'daemon-reload': return ok('');
      default: return err('Unknown operation ' + verb + '.');
    }
  };
  CMD.journalctl = function (w, a) {
    var unit = null, n = 20;
    for (var i = 0; i < a.length; i++) {
      if (a[i] === '-u' && a[i + 1]) unit = a[++i].replace(/\.service$/, '');
      if (a[i] === '-n' && a[i + 1]) n = parseInt(a[++i], 10);
    }
    var log = unit && w.units && w.units[unit] ? (w.units[unit].log || []) : (w.journal || []);
    return ok(log.slice(-n).join('\n') + (log.length ? '\n' : '-- No entries --\n'));
  };
  CMD.ip = function (w, a) {
    if (a[0] === 'r' || a[0] === 'route') {
      return ok('default via 10.0.0.1 dev eth0 proto dhcp metric 100\n' +
        '10.0.0.0/16 dev eth0 proto kernel scope link src ' + (w.ip || '10.0.3.77') + '\n');
    }
    return ok('1: lo: <LOOPBACK,UP> mtu 65536\n    inet 127.0.0.1/8 scope host lo\n' +
      '2: eth0: <BROADCAST,MULTICAST,UP> mtu 9001\n    inet ' + (w.ip || '10.0.3.77') + '/16 scope global dynamic eth0\n');
  };
  CMD.curl = function (w, a) {
    var url = a.filter(function (x) { return /^https?:\/\//.test(x); })[0];
    if (!url) return err('curl: no URL specified');
    var m = url.match(/^https?:\/\/([^\/:]+)(?::(\d+))?/);
    var host = m[1], port = m[2] || '80';
    var listening = (w.sockets || []).filter(function (s) { return String(s.port) === port; })[0];
    var localhost = host === 'localhost' || host === '127.0.0.1';
    if (!listening) return err('curl: (7) Failed to connect to ' + host + ' port ' + port + ': Connection refused', 7);
    if (!localhost && listening.addr === '127.0.0.1') {
      return err('curl: (7) Failed to connect to ' + host + ' port ' + port + ': Connection refused', 7);
    }
    return ok(a.indexOf('-I') !== -1
      ? 'HTTP/1.1 200 OK\nContent-Type: application/json\n'
      : '{"status":"ok"}\n');
  };
  CMD.ping = function (w, a) {
    var host = flags(a).rest[flags(a).rest.length - 1];
    return ok('PING ' + host + ' 56(84) bytes of data.\n64 bytes from ' + host + ': icmp_seq=1 ttl=64 time=0.4 ms\n\n' +
      '--- ' + host + ' ping statistics ---\n1 packets transmitted, 1 received, 0% packet loss\n');
  };
  CMD.history = function (w) {
    return ok((w.history || []).map(function (h, i) { return pad(i + 1, 5) + '  ' + h; }).join('\n') + '\n');
  };
  CMD.which = function (w, a) {
    var name = a[0];
    return CMD[name] ? ok('/usr/bin/' + name + '\n') : { out: '', code: 1 };
  };
  CMD.sleep = function () { return ok(''); };
  CMD['true'] = function () { return ok(''); };
  CMD['false'] = function () { return { out: '', code: 1 }; };
  CMD.test = function (w, a) {
    var r = evalTest(w, a);
    return { out: '', code: r ? 0 : 1 };
  };
  CMD.help = function (w) {
    return ok(
      'REFERENCE — you should never need to leave this app\n' +
      '  man <cmd>        full page: synopsis, options, examples, the trap\n' +
      '  man -k <word>    find a command by what it does (same as apropos)\n' +
      '  guide <topic>    search commands, scenarios and drills together\n' +
      '\nIMPLEMENTED HERE\n' +
      wrap(Object.keys(CMD).sort().join('  '), 58, '  ') + '\n' +
      '\nSHELL FEATURES\n' +
      '  pipes |   redirects > >> <   ; && ||   $VAR   $(cmd)   globs *\n' +
      '  for x in …; do …; done      while read …; do …; done < file\n' +
      '  if [ -f x ]; then …; fi     sudo\n');
  };
  /* ── man / apropos / guide: the reference, in the terminal ──── */
  var LIB = null;
  function lib() { return LIB || (typeof LX !== 'undefined' ? LX : null); }

  function wrap(text, width, indent) {
    width = width || 58; indent = indent || '';
    var out = [], line = '';
    String(text).split(/\s+/).forEach(function (word) {
      if ((line + ' ' + word).trim().length > width) { out.push(indent + line.trim()); line = word; }
      else line += ' ' + word;
    });
    if (line.trim()) out.push(indent + line.trim());
    return out.join('\n');
  }

  function findCmd(name) {
    var L = lib();
    if (!L || !L.commands) return null;
    var exact = L.commands.filter(function (c) { return c.name === name; })[0];
    if (exact) return exact;
    /* aliases people actually type */
    var alias = { egrep:'grep', fgrep:'grep', vim:'vi', dnf:'yum', 'apt-get':'apt' };
    var target = alias[name];
    return target ? L.commands.filter(function (c) { return c.name === target; })[0] || null : null;
  }

  function manPage(c) {
    var out = [];
    out.push(c.name.toUpperCase() + '(1)' + '                    Linux Pocket Guide');
    out.push('');
    out.push('NAME');
    out.push(wrap(c.name + ' — ' + c.sum, 56, '       '));
    out.push('');
    out.push('SYNOPSIS');
    out.push('       ' + c.syntax);
    if (c.flags && c.flags.length) {
      out.push('');
      out.push('OPTIONS');
      c.flags.forEach(function (f) {
        out.push('       ' + f[0]);
        out.push(wrap(f[1], 52, '              '));
      });
    }
    if (c.ex && c.ex.length) {
      out.push('');
      out.push('EXAMPLES');
      c.ex.forEach(function (e) {
        out.push('       $ ' + e[0]);
        out.push(wrap(e[1], 52, '              '));
      });
    }
    if (c.tip) {
      out.push('');
      out.push('NOTES');
      out.push(wrap(c.tip, 56, '       '));
    }
    if (c.related && c.related.length) {
      out.push('');
      out.push('SEE ALSO');
      out.push(wrap(c.related.join(', '), 56, '       '));
    }
    out.push('');
    return out.join('\n') + '\n';
  }

  function searchLib(kw) {
    var L = lib();
    if (!L || !L.commands) return [];
    var rx = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    return L.commands.filter(function (c) {
      return rx.test(c.name) || rx.test(c.sum) || rx.test(c.tip || '') ||
        (c.flags || []).some(function (f) { return rx.test(f[1]); });
    });
  }

  CMD.man = function (w, a) {
    var p = flags(a), rest = p.rest;
    if (p.f.k || a[0] === '-k') {
      return CMD.apropos(w, rest);
    }
    if (!rest.length) return err('What manual page do you want?\nTry: man df   ·   man -k "disk space"   ·   guide inode');
    var c = findCmd(rest[0]);
    if (c) return ok(manPage(c));
    var near = searchLib(rest[0]);
    if (near.length) {
      return ok('No page for "' + rest[0] + '". Related entries:\n' +
        near.slice(0, 8).map(function (x) { return '  ' + pad(x.name, 14, true) + x.sum; }).join('\n') + '\n');
    }
    return err('No manual entry for ' + rest[0] + '\nTry: man -k <keyword>  to search by what it does.');
  };

  CMD.apropos = function (w, a) {
    var kw = a.filter(function (x) { return x.charAt(0) !== '-'; }).join(' ');
    if (!kw) return err('apropos: what should I search for?');
    var hits = searchLib(kw);
    if (!hits.length) return { out:'apropos: nothing appropriate for "' + kw + '"\n', code:1 };
    return ok(hits.slice(0, 14).map(function (c) {
      return pad(c.name, 14, true) + '- ' + c.sum;
    }).join('\n') + '\n' + (hits.length > 14 ? '(' + (hits.length - 14) + ' more — narrow the keyword)\n' : ''));
  };

  /* guide: search the whole study library, not just commands */
  CMD.guide = function (w, a) {
    var L = lib();
    var kw = a.join(' ');
    if (!kw) return err('guide: search the whole guide — commands, scenarios, and drills.\nTry: guide inode   ·   guide "deleted file"   ·   guide oom');
    if (!L) return err('guide: reference library not loaded');
    var rx;
    try { rx = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); }
    catch (e) { return err('guide: bad search'); }
    var out = [];

    var cmds = searchLib(kw);
    if (cmds.length) {
      out.push('COMMANDS');
      cmds.slice(0, 6).forEach(function (c) {
        out.push('  ' + pad(c.name, 12, true) + c.sum);
      });
      out.push('  (man <name> for the full page)');
    }
    (L.scenarios || []).filter(function (sc) {
      return rx.test(sc.title) || rx.test(sc.situation) || rx.test(sc.key || '') ||
        sc.steps.some(function (t) { return rx.test(t[0]) || rx.test(t[1]); });
    }).slice(0, 3).forEach(function (sc, i) {
      if (i === 0) { out.push(''); out.push('SCENARIOS'); }
      out.push('  ' + sc.title);
      sc.steps.slice(0, 4).forEach(function (t) { out.push('      $ ' + t[0]); });
      if (sc.key) out.push(wrap('key: ' + sc.key, 54, '      '));
    });
    (L.drills || []).filter(function (d) { return rx.test(d.q) || rx.test(d.a); })
      .slice(0, 2).forEach(function (d, i) {
        if (i === 0) { out.push(''); out.push('DRILLS'); }
        out.push('  ' + d.q);
        out.push(wrap(d.a, 54, '      '));
      });

    if (!out.length) return { out:'guide: nothing found for "' + kw + '"\n', code:1 };
    return ok(out.join('\n') + '\n');
  };
  ['vi', 'vim', 'nano', 'less', 'more'].forEach(function (name) {
    CMD[name] = function (w, a) {
      return ok(name + ': interactive editors and pagers are not available in the sandbox.\n' +
        'To write a file: echo "text" > file   (or use sed -i to edit one)\n' +
        'To read one: cat, head, tail, or grep\n');
    };
  });

  function evalTest(w, args) {
    var a = args.slice();
    if (a[a.length - 1] === ']') a.pop();
    if (a[0] === '[' || a[0] === '[[') a.shift();
    if (a[0] === '-f' || a[0] === '-e') { var n = node(w, a[1]); return !!n && (a[0] === '-e' || n.t === 'f'); }
    if (a[0] === '-d') { var d = node(w, a[1]); return !!d && d.t === 'd'; }
    if (a[0] === '-z') return !a[1];
    if (a[0] === '-n') return !!a[1];
    if (a[1] === '=' || a[1] === '==') return a[0] === a[2];
    if (a[1] === '!=') return a[0] !== a[2];
    if (a[1] === '-eq') return +a[0] === +a[2];
    if (a[1] === '-ne') return +a[0] !== +a[2];
    if (a[1] === '-gt') return +a[0] > +a[2];
    if (a[1] === '-lt') return +a[0] < +a[2];
    return !!a[0];
  }

  /* ── Execution ──────────────────────────────────────────────── */
  function runSimple(w, toks, stdin) {
    /* redirects */
    var outFile = null, appendFile = null, inFile = null, args = [];
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (t === '>') { outFile = unquote(toks[++i]); continue; }
      if (t === '>>') { appendFile = unquote(toks[++i]); continue; }
      if (t === '<') { inFile = unquote(toks[++i]); continue; }
      if (t === '2>' || t === '2>&1' || t === '1>') { if (toks[i + 1] && toks[i + 1].charAt(0) !== '-') i++; continue; }
      args.push(t);
    }
    if (inFile) {
      var n = node(w, inFile);
      if (!n) return err('bash: ' + inFile + ': No such file or directory');
      stdin = n.content || '';
    }

    /* leading VAR=value assignments */
    var assigns = {};
    while (args.length && /^[A-Za-z_]\w*=/.test(unquote(args[0]))) {
      var pair = unquote(args.shift());
      var eq = pair.indexOf('=');
      assigns[pair.slice(0, eq)] = pair.slice(eq + 1);
    }
    if (!args.length) {
      Object.keys(assigns).forEach(function (k) { w.env[k] = assigns[k]; });
      return ok('');
    }

    var expanded = [];
    args.forEach(function (t) { expanded = expanded.concat(expand(w, t)); });

    var cmd = expanded[0], rest = expanded.slice(1);
    if (cmd === 'sudo') {
      w.sudo = true;
      var r0 = runSimple(w, rest.concat(outFile ? ['>', outFile] : []), stdin);
      w.sudo = false;
      return r0;
    }
    if (cmd === 'export') {
      rest.forEach(function (pair) {
        var eq = pair.indexOf('=');
        if (eq > 0) w.env[pair.slice(0, eq)] = pair.slice(eq + 1);
      });
      return ok('');
    }
    if (cmd === '[' || cmd === '[[') return CMD.test(w, rest);

    var fn = (w.extra && w.extra[cmd]) || CMD[cmd];
    if (!fn) {
      var msg = 'bash: ' + cmd + ': command not found';
      var known = findCmd(cmd);
      if (known) {
        msg += '\n  ' + cmd + ' is not implemented in this sandbox, but the reference is:' +
               '\n  man ' + known.name + '   (' + known.sum + ')';
      } else {
        /* did you mean …? one-character-off typos are the common case */
        var near = Object.keys(CMD).filter(function (k) {
          if (Math.abs(k.length - cmd.length) > 2) return false;
          var d = 0, i, j;
          for (i = 0, j = 0; i < k.length && j < cmd.length;) {
            if (k[i] === cmd[j]) { i++; j++; }
            else { d++; if (k.length > cmd.length) i++; else if (k.length < cmd.length) j++; else { i++; j++; } }
          }
          return d + Math.abs((k.length - i) - (cmd.length - j)) <= 2;
        }).slice(0, 4);
        if (near.length) msg += '\n  did you mean: ' + near.join(', ') + '?';
        msg += '\n  `help` lists what runs here · `man -k ' + cmd + '` searches by purpose';
      }
      return err(msg);
    }
    var res = fn(w, rest, stdin) || ok('');

    if (outFile || appendFile) {
      var target = resolve(w, outFile || appendFile);
      var body = res.out || '';
      if (appendFile && w.fs[target]) w.fs[target].content = (w.fs[target].content || '') + body;
      else mkfile(w, target, body);
      if (w.fs[target]) w.fs[target].size = null;
      res = { out: '', code: res.code, err: res.err };
    }
    return res;
  }

  function runPipeline(w, segment) {
    var parts = [], cur = [];
    var toks = tokenize(segment);
    toks.forEach(function (t) {
      if (t === '|') { parts.push(cur); cur = []; }
      else cur.push(t);
    });
    parts.push(cur);

    var stdin = '', res = ok('');
    for (var i = 0; i < parts.length; i++) {
      res = runSimple(w, parts[i], stdin);
      if (res.clear) return res;
      stdin = res.out || '';
      if (res.err) return { out: (res.out || ''), err: res.err, code: res.code };
    }
    return res;
  }

  /* control structures — for / while / if, single line */
  function runControl(w, line) {
    var m;
    if ((m = line.match(/^\s*for\s+(\w+)\s+in\s+(.+?);\s*do\s+(.+?);?\s*done\s*$/))) {
      var varName = m[1], listStr = m[2], body = m[3];
      var items = [];
      if (/\$\(/.test(listStr)) {
        /* expand the whole list at once so $(cat file) survives tokenising */
        items = expand(w, listStr);
      } else {
        tokenize(listStr).forEach(function (t) { items = items.concat(expand(w, t)); });
      }
      var out = '';
      for (var i = 0; i < items.length && i < 200; i++) {
        w.env[varName] = items[i];
        var r = exec(w, body);
        out += r.out || '';
        if (r.err) out += r.err + '\n';
      }
      return { out: out, code: 0 };
    }

    if ((m = line.match(/^\s*while\s+(.*?read\s+.+?);\s*do\s+(.+?);?\s*done\s*(?:<\s*(\S+))?\s*$/))) {
      var readCmd = m[1], body2 = m[2], file = m[3];
      var text = '';
      if (file) {
        var n = node(w, unquote(file));
        if (!n) return err('bash: ' + file + ': No such file or directory');
        text = n.content || '';
      }
      var ifsMatch = readCmd.match(/IFS=("([^"]*)"|'([^']*)'|(\S*))/);
      var ifs = ifsMatch ? (ifsMatch[2] != null ? ifsMatch[2] : ifsMatch[3] != null ? ifsMatch[3] : ifsMatch[4]) : null;
      var varsMatch = readCmd.match(/read\s+(?:-r\s+)?(.+)$/);
      var names = varsMatch ? varsMatch[1].trim().split(/\s+/) : ['REPLY'];
      var out2 = '';
      lines(text).forEach(function (line2) {
        var parts;
        if (ifs === '') parts = [line2];
        else if (ifs && ifs !== ' ') parts = line2.split(ifs);
        else parts = line2.trim().split(/\s+/);
        names.forEach(function (nm, idx) {
          /* the last variable soaks up the remaining fields, as read does */
          w.env[nm] = idx === names.length - 1 ? parts.slice(idx).join(ifs && ifs !== ' ' ? ifs : ' ') : (parts[idx] || '');
        });
        var r = exec(w, body2);
        out2 += r.out || '';
        if (r.err) out2 += r.err + '\n';
      });
      return { out: out2, code: 0 };
    }

    if ((m = line.match(/^\s*if\s+(.+?);\s*then\s+(.+?)(?:;\s*else\s+(.+?))?;?\s*fi\s*$/))) {
      var cond = exec(w, m[1]);
      var branch = cond.code === 0 ? m[2] : m[3];
      return branch ? exec(w, branch) : ok('');
    }
    return null;
  }

  function exec(w, line) {
    if (!line || !line.trim()) return ok('');
    if (/^\s*(for|while|if)\s/.test(line)) {
      var ctl = runControl(w, line);
      if (ctl) { w.lastCode = ctl.code; return ctl; }
    }

    /* split on ; && || respecting quotes */
    var segs = [], cur = '', quote = null, op = null, ops = [];
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
      if (ch === ';') { segs.push(cur); ops.push(';'); cur = ''; continue; }
      if (ch === '&' && line[i + 1] === '&') { segs.push(cur); ops.push('&&'); cur = ''; i++; continue; }
      if (ch === '|' && line[i + 1] === '|') { segs.push(cur); ops.push('||'); cur = ''; i++; continue; }
      cur += ch;
    }
    segs.push(cur);

    /* rejoin for/while/if blocks that the ';' split tore apart */
    var merged = [], mergedOps = [], buf = null;
    for (var g = 0; g < segs.length; g++) {
      var seg = segs[g];
      if (buf !== null) {
        buf += '; ' + seg;
        if (/\b(done|fi|esac)\s*$/.test(seg.trim())) { merged.push(buf); buf = null; }
        continue;
      }
      if (/^\s*(for|while|until|if)\s/.test(seg) && !/\b(done|fi)\s*$/.test(seg.trim())) {
        buf = seg; mergedOps.push(ops[g - 1]);
        continue;
      }
      merged.push(seg); mergedOps.push(ops[g - 1]);
    }
    if (buf !== null) merged.push(buf);
    segs = merged; ops = mergedOps.slice(1).concat([null]);
    var opFor = function (i) { return mergedOps[i]; };

    var out = '', errOut = '', code = 0, clear = false;
    for (var s = 0; s < segs.length; s++) {
      if (!segs[s].trim()) continue;
      var prevOp = opFor(s);
      if (prevOp === '&&' && code !== 0) continue;
      if (prevOp === '||' && code === 0) continue;
      var r = /^\s*(for|while|until|if)\s/.test(segs[s])
        ? (runControl(w, segs[s]) || runPipeline(w, segs[s]))
        : runPipeline(w, segs[s]);
      if (r.clear) { clear = true; continue; }
      out += r.out || '';
      if (r.err) errOut += r.err + '\n';
      code = r.code || 0;
      w.lastCode = code;
    }
    return { out: out, err: errOut || null, code: code, clear: clear };
  }

  /* ── Public API ─────────────────────────────────────────────── */
  function createWorld(seed) {
    var w = {
      user: seed.user || 'ec2-user', host: seed.host || 'ip-10-0-4-118',
      cwd: seed.cwd || ('/home/' + (seed.user || 'ec2-user')),
      now: 'Aug 14 09:12', fs: {}, history: [], env: {},
      procs: seed.procs ? JSON.parse(JSON.stringify(seed.procs)) : [],
      disks: seed.disks ? JSON.parse(JSON.stringify(seed.disks)) : [],
      sockets: seed.sockets ? JSON.parse(JSON.stringify(seed.sockets)) : [],
      dmesg: (seed.dmesg || []).slice(),
      journal: (seed.journal || []).slice(),
      units: {}, deleted: [],
      mem: seed.mem, cpu: seed.cpu, load: seed.load, uptime: seed.uptime,
      io: seed.io ? JSON.parse(JSON.stringify(seed.io)) : null, extra: seed.extra || null,
      cores: seed.cores || 4, ip: seed.ip
    };
    w.env = { HOME: '/home/' + w.user, USER: w.user, PWD: w.cwd, SHELL: '/bin/bash',
              PATH: '/usr/local/bin:/usr/bin:/bin' };
    mkdirp(w, '/'); mkdirp(w, '/home/' + w.user); mkdirp(w, '/var/log'); mkdirp(w, '/etc'); mkdirp(w, '/tmp');
    (seed.dirs || []).forEach(function (d) {
      var dp = d.path || d;
      mkdirp(w, dp);
      /* apply the seed's attributes even when the path was bootstrapped above,
         otherwise a seeded mode on /home/<user> is silently dropped */
      var dn = w.fs[resolve(w, dp)];
      if (dn && typeof d === 'object') {
        if (d.mode) dn.mode = String(d.mode);
        if (d.owner) dn.owner = d.owner;
        if (d.group) dn.group = d.group;
      }
    });
    (seed.files || []).forEach(function (f) {
      mkdirp(w, dirname(resolve(w, f.path)));
      var n = mkfile(w, f.path, f.content || '', f);
      if (f.size != null) n.size = f.size;
      if (f.fake) { n.fake = f.fake; if (f.content == null) n.content = null; }
      if (f.ageDays != null) n.ageDays = f.ageDays;
      if (f.mtime) n.mtime = f.mtime;
    });
    Object.keys(seed.units || {}).forEach(function (k) {
      w.units[k] = Object.assign({}, seed.units[k]);
    });
    return w;
  }

  function run(w, line) {
    w.history.push(line);
    var r = exec(w, line);
    return r;
  }

  var api = { createWorld: createWorld, run: run, exec: exec, human: human,
              setLibrary: function (l) { LIB = l; },
              resolve: resolve, node: node, children: children, diskUsed: diskUsed,
              commands: function () { return Object.keys(CMD).sort(); } };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LXShell = api;
})(typeof window !== 'undefined' ? window : globalThis);
