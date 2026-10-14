/* SRE & Cloud Deployment Foundations — simulated incidents S13–S16 (M07–M08).

   Same contract as sre-scenarios-1.js; played by tests/data/test-sre-scenarios.js.

   S13/S14 run on a small Docker Engine model defined in this file (images,
   a registry with manifests and indexes, containers, published ports,
   a Compose project, buildx and binfmt emulation). The generic `docker`
   verb in shell-containers.js only prints fixtures, so it is not reused.
   S15/S16 run on the reconciling cluster model (k8s-model.js); `kubectl` is
   wrapped in a world verb here to add what that model does not print by
   itself (in-pod curl to localhost, kube-probe request lines in logs, the
   "connection refused" wording of a probe aimed at the wrong port) and to
   put every command on the scenario clock.

   Learner-visible text (title, briefs, objective text) never names the root
   cause; mechanism, alternatives and the worked fix live in the debrief. */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.missions = LX.missions || [];

(function () {
  function SIM() { return window.LXSim; }
  function KM() { return window.LXK8s; }
  function st(c) { return c.w.sre; }
  function M(c) { return c.w.k8sModel; }
  function ran(c, re) { return SIM().ran(c, re); }
  function saw(c, re, outRe) { return SIM().saw(c, re, outRe); }
  function lastIs(c, cmdRe, outRe) { return SIM().lastIs(c, cmdRe, outRe); }
  function lastCode(c) { return SIM().lastCode(c); }

  /* deterministic hex for ids and digests */
  function hex(seed, n) {
    var r = SIM().rng('hex:' + seed), s = '';
    while (s.length < n) s += '0123456789abcdef'.charAt(Math.floor(r.next() * 16));
    return s;
  }
  function digestOf(seed) { return 'sha256:' + hex(seed, 64); }
  function res(out, code, errText) {
    var r = { out: out == null ? '' : String(out), code: code || 0 };
    if (r.out && !/\n$/.test(r.out)) r.out += '\n';
    if (errText) r.err = String(errText).replace(/\n?$/, '\n');
    return r;
  }
  function since(sec) {
    sec = Math.max(0, Math.floor(sec));
    if (sec < 1) return 'Less than a second';
    if (sec < 60) return sec + ' seconds';
    if (sec < 120) return 'About a minute';
    if (sec < 3600) return Math.floor(sec / 60) + ' minutes';
    if (sec < 7200) return 'About an hour';
    return Math.floor(sec / 3600) + ' hours';
  }
  function archName(a) { return a === 'amd64' ? 'x86_64' : a === 'arm64' ? 'aarch64' : a; }
  function platOf(a) { return 'linux/' + a; }
  function platLabel(a) { return a === 'arm64' ? 'linux/arm64/v8' : 'linux/' + a; }

  /* ═══ Docker Engine model (S13, S14) ═══════════════════════════════
     st.dk = { hostArch, hostIp, hostName, binfmt: [archs], images: { id: image },
               tags: { 'name:tag': id }, registry: { name: { tags, blobs } },
               containers: [...], networks: [...], dir, sourceVersion, seq }
     An image: { id, arch, entryArch, entryPath, app: 'beacon'|'binfmt',
                 version, ipv6, env, entrypoint, cmd, files: { path: arch } }
     A container: { id, name, ref, imageId, env, ports, net, privileged,
                    compose, status, exitCode, pid, ip, startedAt, logs,
                    app: { addr, port }, emulated, hash } */
  function parseRef(ref) {
    var digest = null, at = String(ref).indexOf('@');
    if (at !== -1) { digest = ref.slice(at + 1); ref = ref.slice(0, at); }
    var slash = ref.lastIndexOf('/'), colon = ref.lastIndexOf(':'), tag = null, name = ref;
    if (colon > slash) { tag = ref.slice(colon + 1); name = ref.slice(0, colon); }
    if (!tag && !digest) tag = 'latest'; /* the Docker CLI's default when none is given */
    return { name: name, tag: tag, digest: digest };
  }
  function hostOfName(name) { var h = name.split('/')[0]; return /[.:]/.test(h) ? h : 'docker.io'; }
  function localImage(d, ref) {
    if (!ref) return null;
    var bare = String(ref).replace(/^sha256:/, '');
    if (/^[0-9a-f]{12,64}$/.test(bare)) {
      var byId = Object.keys(d.images).filter(function (id) { return id.replace(/^sha256:/, '').indexOf(bare) === 0; })[0];
      if (byId) return d.images[byId];
    }
    var r = parseRef(ref);
    if (r.digest) {
      var hit = Object.keys(d.images).filter(function (id) { return (d.images[id].repoDigests || []).indexOf(r.name + '@' + r.digest) !== -1; })[0];
      return hit ? d.images[hit] : null;
    }
    var tid = d.tags[r.name + ':' + r.tag];
    return tid ? d.images[tid] : null;
  }
  function setTag(d, key, id) {
    var old = d.tags[key];
    if (old && d.images[old]) d.images[old].repoTags = d.images[old].repoTags.filter(function (t) { return t !== key; });
    d.tags[key] = id;
    if (d.images[id].repoTags.indexOf(key) === -1) d.images[id].repoTags.push(key);
  }
  function remote(d, ref) {
    var r = parseRef(ref), repo = d.registry[r.name];
    if (!repo) return { r: r, missingRepo: true };
    var dg = r.digest || repo.tags[r.tag];
    if (!dg || !repo.blobs[dg]) return { r: r, missing: true };
    return { r: r, repo: repo, digest: dg, blob: repo.blobs[dg] };
  }
  function pull(s, ref, platform, quiet) {
    var d = s.dk, x = remote(d, ref);
    if (x.missingRepo) {
      var host = hostOfName(x.r.name);
      if (!d.reachable || d.reachable.indexOf(host) !== -1) return { err: 'Error response from daemon: pull access denied for ' + x.r.name + ', repository does not exist or may require \'docker login\'' };
      return { err: 'Error response from daemon: Get "https://' + host + '/v2/": dial tcp: lookup ' + host + ': no such host' };
    }
    if (x.missing) return { err: 'Error response from daemon: manifest for ' + ref + ' not found: manifest unknown: manifest unknown' };
    var want = platform || platOf(d.hostArch), blob;
    if (x.blob.kind === 'index') {
      var man = x.blob.manifests.filter(function (mm) { return mm.platform === want; })[0];
      if (!man) return { err: 'Error response from daemon: no matching manifest for ' + (want === 'linux/arm64' ? 'linux/arm64/v8' : want) + ' in the manifest list entries' };
      blob = x.repo.blobs[man.digest];
    } else {
      if (platform && x.blob.platform !== platform) return { err: 'Error response from daemon: image with reference ' + ref + ' was found but does not match the specified platform: wanted ' + platform + ', actual: ' + x.blob.platform };
      blob = x.blob;
    }
    var tpl = SIM().clone(blob.image), existed = !!d.images[tpl.id];
    if (!existed) { tpl.repoTags = []; tpl.repoDigests = []; d.images[tpl.id] = tpl; }
    var img = d.images[tpl.id];
    if (img.repoDigests.indexOf(x.r.name + '@' + x.digest) === -1) img.repoDigests.push(x.r.name + '@' + x.digest);
    if (x.r.tag && !x.r.digest) setTag(d, x.r.name + ':' + x.r.tag, img.id);
    var path = x.r.name.split('/').slice(1).join('/');
    var out = quiet ? '' : (x.r.digest ? x.r.name.split('/').pop() + '@' + x.r.digest : x.r.tag) + ': Pulling from ' + path + '\n' +
      (existed ? '' : [1, 2, 3].map(function (i) { return hex(img.id + i, 12) + ': Pull complete'; }).join('\n') + '\n') +
      'Digest: ' + x.digest + '\nStatus: ' + (existed ? 'Image is up to date for ' : 'Downloaded newer image for ') + ref + '\n' + ref + '\n';
    return { out: out, img: img };
  }
  function envList(img, c) {
    var env = {};
    (img.env || []).forEach(function (kv) { var i = kv.indexOf('='); env[kv.slice(0, i)] = kv.slice(i + 1); });
    Object.keys(c.env || {}).forEach(function (k) { env[k] = c.env[k]; });
    return env;
  }
  function running(d) { return d.containers.filter(function (c) { return c.status === 'running'; }); }
  function findCtr(d, ref) {
    if (!ref) return null;
    return d.containers.filter(function (c) { return c.name === ref || c.name === ref.replace(/^\//, '') || (ref.length >= 4 && c.id.indexOf(ref) === 0); })[0] || null;
  }
  function hostPortBusy(d, port, self) {
    return d.containers.some(function (c) {
      if (c === self || c.status !== 'running') return false;
      if (c.net === 'host') return !!c.app && c.app.port === port;
      return c.ports.some(function (p) { return p.hostPort === port; });
    });
  }
  function createCtr(s, spec) {
    var d = s.dk;
    d.seq++;
    var c = { id: hex('ctr:' + s.seed + ':' + d.seq + ':' + spec.name, 64), name: spec.name, ref: spec.ref, imageId: spec.imageId,
      env: spec.env || {}, ports: spec.ports || [], net: spec.net || 'bridge', privileged: !!spec.privileged, compose: spec.compose || null,
      status: 'created', exitCode: 0, pid: 0, ip: (spec.net === 'host') ? null : '172.18.0.' + (1 + d.seq), created: spec.at == null ? s.clock : spec.at,
      startedAt: null, finishedAt: null, logs: [], app: null, emulated: false, hash: spec.hash || null,
      entryOverride: spec.entryOverride || null, args: spec.args || null };
    d.containers.push(c);
    return c;
  }
  function stopCtr(s, c, code) {
    if (c.status !== 'running') return;
    c.status = 'exited'; c.exitCode = code == null ? 0 : code; c.finishedAt = s.clock; c.pid = 0;
    if (c.app) c.logs.push('{"level":"info","msg":"signal received, shutting down gracefully","signal":15}', '{"level":"info","msg":"stopped"}');
    c.app = null;
  }
  /* what happens when the runtime execs the container's entrypoint */
  function startCtr(s, c, at) {
    var d = s.dk, img = d.images[c.imageId], now = at == null ? s.clock : at;
    if (c.net !== 'host') {
      for (var i = 0; i < c.ports.length; i++) {
        if (hostPortBusy(d, c.ports[i].hostPort, c)) {
          return { err: 'driver failed programming external connectivity on endpoint ' + c.name + ' (' + c.id + '): Bind for 0.0.0.0:' + c.ports[i].hostPort + ' failed: port is already allocated' };
        }
      }
    }
    var chain = [[img.entryPath, img.entryArch]];
    if (img.entryPath !== '/usr/local/bin/python3' && img.app === 'beacon') chain.push(['/usr/local/bin/python3', img.arch]);
    c.emulated = false;
    for (var j = 0; j < chain.length; j++) {
      var arch = chain[j][1];
      if (arch === d.hostArch) continue;
      if (d.binfmt.indexOf(arch) !== -1) { c.emulated = true; continue; }
      c.status = 'exited'; c.exitCode = 255; c.startedAt = now; c.finishedAt = now; c.pid = 0; c.app = null;
      c.logs.push('exec ' + chain[j][0] + ': exec format error');
      return { exited: true, line: 'exec ' + chain[j][0] + ': exec format error' };
    }
    var env = envList(img, c);
    var listen = env.BEACON_SERVER_LISTEN || '0.0.0.0', port = parseInt(env.BEACON_SERVER_PORT || '8080', 10);
    c.startedAt = now; c.finishedAt = null;
    c.logs.push('{"level":"info","msg":"starting beacon-api","version":"' + img.version + '","config_source":"/app/beacon.yaml+env","user":"10001"' + (c.emulated ? ',"sim_note":"(simulation) part of this container runs under qemu-' + archName(img.entryArch === d.hostArch ? img.arch : img.entryArch) + ' emulation"' : '') + '}');
    var fatal = null;
    if (listen.indexOf(':') !== -1 && !img.ipv6) fatal = 'FATAL listen ' + listen + ':' + port + ': Address family not supported by protocol (errno 97)';
    else if (c.net === 'host' && hostPortBusy(d, port, c)) fatal = 'FATAL listen ' + listen + ':' + port + ': Address already in use (errno 98)';
    if (fatal) {
      c.logs.push('{"level":"fatal","msg":"listen","error":"' + fatal + '"}', fatal);
      c.status = 'exited'; c.exitCode = 1; c.finishedAt = now; c.pid = 0; c.app = null;
      return { exited: true, line: fatal };
    }
    c.status = 'running'; c.exitCode = 0;
    c.pid = 2300 + d.seq * 17 + (s.clock % 97);
    c.app = { addr: listen, port: port };
    if (listen.indexOf(':') !== -1) {
      c.logs.push('{"level":"info","msg":"listening on [' + listen + ']:' + port + '","listen":"' + listen + '","port":' + port + ',"ipv6_only":true}');
      c.logs.push('beacon-api ' + img.version + ' listening on [' + listen + ']:' + port + ' (IPV6_V6ONLY=1)');
    } else {
      c.logs.push('{"level":"info","msg":"listening on ' + listen + ':' + port + '","listen":"' + listen + '","port":' + port + '}');
      c.logs.push('beacon-api ' + img.version + ' listening on ' + listen + ':' + port);
    }
    return { ok: true };
  }
  function removeCtr(s, c) {
    stopCtr(s, c, 137);
    s.dk.containers = s.dk.containers.filter(function (x) { return x !== c; });
  }
  /* can a client INSIDE the container's network namespace reach the app? */
  function inside(c, host, port) {
    var a = c.app;
    if (!a || c.status !== 'running' || port !== a.port) return false;
    var h = String(host).replace(/^\[|\]$/g, '');
    var v4loop = h === '127.0.0.1', v6loop = h === '::1', lh = h === 'localhost', own = h === c.ip || h === c.id.slice(0, 12);
    if (a.addr === '0.0.0.0') return v4loop || lh || own || h === '0.0.0.0';
    if (a.addr === '127.0.0.1') return v4loop || lh;
    if (a.addr === '::' || a.addr === '::1') return v6loop || lh;
    return h === a.addr;
  }
  /* can a client on the HOST reach host:port? (published ports go through docker-proxy) */
  function hostReach(s, host, port) {
    var d = s.dk, h = String(host).replace(/^\[|\]$/g, '');
    var loop = h === 'localhost' || h === '127.0.0.1' || h === '::1', ext = h === d.hostIp || h === d.hostName;
    if (!loop && !ext) {
      if (!/^[\d.]+$/.test(h) && h.indexOf(':') === -1) return { code: 6, msg: 'curl: (6) Could not resolve host: ' + host };
      return { code: 28, msg: 'curl: (28) Failed to connect to ' + host + ' port ' + port + ' after 3001 ms: Timeout was reached' };
    }
    var hn = running(d).filter(function (c) { return c.net === 'host' && c.app && c.app.port === port; })[0];
    if (hn) {
      var a = hn.app;
      var okHn = a.addr === '0.0.0.0' || (a.addr === '127.0.0.1' && (h === '127.0.0.1' || h === 'localhost')) ||
        ((a.addr === '::' || a.addr === '::1') && (h === '::1' || h === 'localhost')) || (a.addr === d.hostIp && ext);
      return okHn ? { ok: true, c: hn } : { code: 7, msg: 'curl: (7) Failed to connect to ' + host + ' port ' + port + ' after 0 ms: Couldn\'t connect to server' };
    }
    var pc = running(d).filter(function (c) { return c.net !== 'host' && c.ports.some(function (p) { return p.hostPort === port; }); })[0];
    if (!pc) return { code: 7, msg: 'curl: (7) Failed to connect to ' + host + ' port ' + port + ' after 0 ms: Couldn\'t connect to server' };
    var b = pc.ports.filter(function (p) { return p.hostPort === port; })[0];
    if (pc.app && pc.app.port === b.containerPort && (pc.app.addr === '0.0.0.0' || pc.app.addr === pc.ip)) return { ok: true, c: pc };
    if (loop) return { code: 56, msg: 'curl: (56) Recv failure: Connection reset by peer', proxied: true };
    return { code: 7, msg: 'curl: (7) Failed to connect to ' + host + ' port ' + port + ' after 1 ms: Couldn\'t connect to server' };
  }
  function beaconReply(s, c, path, method) {
    var img = s.dk.images[c.imageId];
    var p = path.replace(/\?.*$/, '');
    if (p === '/healthz') return { code: 200, body: 'ok' };
    if (p === '/ready') return { code: 200, body: '{"ready": true, "store": "memory", "queue": "none"}' };
    if (p === '/version') return { code: 200, body: '{"version": "' + img.version + '", "environment": "lab", "commit": "' + hex('commit' + img.version, 7) + '"}' };
    if (p === '/metrics') return { code: 200, body: 'beacon_requests_total{route="/healthz",method="GET",code="200"} 3' };
    return { code: 404, body: '{"error": "not found", "path": "' + p + '"}' };
  }
  /* curl's flags, enough for the probes people actually type */
  function curlParse(a) {
    var f = {}, pos = [], valued = { o: 1, w: 1, H: 1, X: 1, d: 1, m: 1, u: 1 };
    var longValued = ['--output', '--write-out', '--header', '--request', '--data', '--max-time', '--connect-timeout', '--user'];
    for (var i = 0; i < a.length; i++) {
      var t = a[i];
      if (t.indexOf('--') === 0) {
        var eq = t.indexOf('=');
        if (eq > 0) { f[t.slice(2, eq)] = t.slice(eq + 1); continue; }
        if (longValued.indexOf(t) !== -1) { f[t.slice(2)] = a[++i]; continue; }
        f[t.slice(2)] = true; continue;
      }
      if (t.charAt(0) === '-' && t.length > 1) {
        for (var j = 1; j < t.length; j++) {
          var ch = t.charAt(j);
          if (valued[ch]) { f[ch] = j + 1 < t.length ? t.slice(j + 1) : a[++i]; break; }
          f[ch] = true;
        }
        continue;
      }
      pos.push(t);
    }
    if (f.output) f.o = f.output; if (f['write-out']) f.w = f['write-out'];
    if (f.verbose) f.v = true; if (f.silent) f.s = true; if (f['show-error']) f.S = true; if (f.include) f.i = true; if (f.head) f.I = true; if (f.fail) f.f = true;
    return { f: f, url: pos.filter(function (x) { return /^https?:\/\//.test(x) || /^(\[[0-9a-f:]+\]|[a-z0-9.-]+)(:\d+)?(\/|$)/i.test(x); }).pop() };
  }
  function parseUrl(u) {
    var m = /^(?:(https?):\/\/)?(\[[0-9a-fA-F:]+\]|[^\/:]+)(?::(\d+))?(\/.*)?$/.exec(u || '');
    if (!m) return null;
    var scheme = m[1] || 'http';
    return { scheme: scheme, host: m[2], port: m[3] ? Number(m[3]) : (scheme === 'https' ? 443 : 80), path: m[4] || '/' };
  }
  /* render one curl invocation given a reachability verdict and a reply */
  function curlRender(cp, u, verdict, reply) {
    var f = cp.f, lines = [], ip = u.host === 'localhost' ? '::1' : u.host.replace(/^\[|\]$/g, '');
    var wantCode = typeof f.w === 'string' && f.w.indexOf('%{http_code}') !== -1;
    if (f.v) lines.push('*   Trying ' + (ip.indexOf(':') !== -1 ? '[' + ip + ']' : ip) + ':' + u.port + '...');
    if (!verdict.ok) {
      if (f.v && verdict.proxied) lines.push('* Connected to ' + u.host + ' (' + ip + ') port ' + u.port, '> GET ' + u.path + ' HTTP/1.1', '> Host: ' + u.host + ':' + u.port, '> User-Agent: curl/8.5.0', '> Accept: */*', '>', '* Recv failure: Connection reset by peer', '* Closing connection');
      var quiet = f.s && !f.S;
      var out = (lines.length ? lines.join('\n') + '\n' : '') + (wantCode ? '000' : '');
      return { out: out, err: quiet ? null : verdict.msg + '\n', code: verdict.code };
    }
    if (u.scheme === 'https') return { out: '', err: 'curl: (35) OpenSSL/3.0.13: error:0A00010B:SSL routines::wrong version number\n', code: 35 };
    var reason = { 200: 'OK', 404: 'Not Found', 503: 'Service Unavailable' }[reply.code] || '';
    var head = ['HTTP/1.0 ' + reply.code + ' ' + reason, 'Server: BaseHTTP/0.6 Python/3.12.7', 'Content-Type: ' + (/^[{\[]/.test(reply.body) ? 'application/json' : 'text/plain; charset=utf-8'), 'X-Request-Id: ' + hex('req' + u.path + reply.code, 16)];
    if (f.v) { lines.push('* Connected to ' + u.host + ' (' + ip + ') port ' + u.port, '> GET ' + u.path + ' HTTP/1.1', '> Host: ' + u.host + ':' + u.port, '> User-Agent: curl/8.5.0', '> Accept: */*', '>'); head.forEach(function (h) { lines.push('< ' + h); }); lines.push('<'); }
    if (f.f && reply.code >= 400) return { out: lines.join('\n') + (lines.length ? '\n' : ''), err: 'curl: (22) The requested URL returned error: ' + reply.code + '\n', code: 22 };
    var body = '';
    if (f.I) body = head.join('\n') + '\n';
    else {
      if (f.i) body += head.join('\n') + '\n\n';
      if (f.o !== '/dev/null') body += reply.body + '\n';
    }
    if (wantCode) body += String(reply.code);
    return { out: (lines.length ? lines.join('\n') + '\n' : '') + body, code: 0 };
  }
  function hostCurl(s) {
    return function (w, a) {
      if (!a.length || a[0] === '--help') return res('curl (simulation): curl [-s] [-S] [-i] [-I] [-v] [-f] [-o FILE] [-w FMT] http://HOST:PORT/PATH — from this host');
      var cp = curlParse(a), u = parseUrl(cp.url);
      if (!cp.url) return res('', 2, 'curl: no URL specified!');
      if (!u) return res('', 3, 'curl: (3) URL rejected: Malformed input to a URL function');
      var v = hostReach(s, u.host, u.port);
      var r = curlRender(cp, u, v, v.ok ? beaconReply(s, v.c, u.path) : null);
      return { out: r.out, err: r.err, code: r.code };
    };
  }
  function ssRows(rows, wantProc) {
    var head = ['State', 'Recv-Q', 'Send-Q', 'Local Address:Port', 'Peer Address:Port'].concat(wantProc ? ['Process'] : []);
    return SIM().table(head, rows.map(function (r) { return ['LISTEN', '0', r.q || '128', r.local, r.peer].concat(wantProc ? [r.proc || ''] : []); }));
  }
  function ctrListenRows(c) {
    if (!c.app) return [];
    var a = c.app, v6 = a.addr.indexOf(':') !== -1;
    return [{ local: (v6 ? '[' + a.addr + ']' : a.addr) + ':' + a.port, peer: v6 ? '[::]:*' : '0.0.0.0:*', proc: 'users:(("python3",pid=1,fd=3))' }];
  }
  function ssVerbArgs(a) {
    var flagsStr = a.filter(function (x) { return x.charAt(0) === '-'; }).join('');
    return { listen: /l/.test(flagsStr), proc: /p/.test(flagsStr) };
  }
  function hostSs(s) {
    return function (w, a) {
      var o = ssVerbArgs(a);
      if (!o.listen) return SIM().unsupported('ss', a.join(' '), ['ss -lnt', 'ss -ltnp']);
      var d = s.dk, rows = [{ local: '0.0.0.0:22', peer: '0.0.0.0:*', proc: 'users:(("sshd",pid=812,fd=3))' }, { local: '[::]:22', peer: '[::]:*', proc: 'users:(("sshd",pid=812,fd=4))' }];
      running(d).forEach(function (c) {
        if (c.net === 'host') { ctrListenRows(c).forEach(function (r) { r.proc = 'users:(("python3",pid=' + c.pid + ',fd=3))'; rows.push(r); }); return; }
        c.ports.forEach(function (p, i) {
          rows.push({ local: '0.0.0.0:' + p.hostPort, peer: '0.0.0.0:*', q: '4096', proc: 'users:(("docker-proxy",pid=' + (c.pid + 40 + i) + ',fd=4))' });
          rows.push({ local: '[::]:' + p.hostPort, peer: '[::]:*', q: '4096', proc: 'users:(("docker-proxy",pid=' + (c.pid + 44 + i) + ',fd=4))' });
        });
      });
      return res(ssRows(rows, o.proc));
    };
  }
  /* commands run inside a container (docker exec) or its namespace (nsenter) */
  function execIn(s, c, cmd, netOnly) {
    var prog = cmd[0], rest = cmd.slice(1);
    if (prog === 'ss' || prog === 'netstat') {
      var o = ssVerbArgs(rest);
      if (!o.listen) return SIM().unsupported(prog, rest.join(' '), [prog + ' -lnt', prog + ' -ltnp']);
      if (prog === 'netstat') {
        return res(['Active Internet connections (only servers)', 'Proto Recv-Q Send-Q Local Address           Foreign Address         State' + (o.proc ? '       PID/Program name' : '')].concat(ctrListenRows(c).map(function (r) {
          var v6 = r.local.charAt(0) === '[';
          return SIM().pad(v6 ? 'tcp6' : 'tcp', 6) + SIM().pad('0', 7) + SIM().pad('0', 7) + SIM().pad(r.local.replace(/^\[|\]/g, ''), 24) + SIM().pad(v6 ? ':::*' : '0.0.0.0:*', 24) + 'LISTEN' + (o.proc ? '      1/python3' : '');
        })).join('\n'));
      }
      return res(ssRows(ctrListenRows(c), o.proc));
    }
    if (prog === 'curl') {
      var cp = curlParse(rest), u = parseUrl(cp.url);
      if (!cp.url) return res('', 2, 'curl: no URL specified!');
      if (!u) return res('', 3, 'curl: (3) URL rejected: Malformed input to a URL function');
      var okIn = inside(c, u.host, u.port);
      var h = u.host.replace(/^\[|\]$/g, '');
      var known = ['127.0.0.1', '::1', 'localhost', '0.0.0.0', c.ip, c.id.slice(0, 12)].indexOf(h) !== -1;
      var verdict = okIn ? { ok: true } : known ? { code: 7, msg: 'curl: (7) Failed to connect to ' + u.host + ' port ' + u.port + ' after 0 ms: Couldn\'t connect to server' } : { code: 6, msg: 'curl: (6) Could not resolve host: ' + u.host };
      var r = curlRender(cp, u, verdict, okIn ? beaconReply(s, c, u.path) : null);
      return { out: r.out, err: r.err, code: r.code };
    }
    if (netOnly) return res('', 2, 'nsenter (simulation): inside the network namespace only ss, netstat and curl are modelled.');
    if (prog === 'env' || prog === 'printenv') {
      var env = envList(s.dk.images[c.imageId], c);
      if (rest[0]) return env[rest[0]] != null ? res(env[rest[0]]) : res('', 1);
      return res(Object.keys(env).map(function (k) { return k + '=' + env[k]; }).concat(['HOSTNAME=' + c.id.slice(0, 12)]).join('\n'));
    }
    if (prog === 'cat' && rest[0] === '/etc/hosts') return res('127.0.0.1\tlocalhost\n::1\tlocalhost ip6-localhost ip6-loopback\n' + (c.ip ? c.ip + '\t' + c.id.slice(0, 12) : ''));
    if (prog === 'hostname') return res(rest[0] === '-i' ? (c.ip || s.dk.hostIp) : c.id.slice(0, 12));
    if (prog === 'id') return res('uid=10001(beacon) gid=10001(beacon) groups=10001(beacon)');
    if (prog === 'sh' || prog === 'bash' || prog === '/bin/sh') return res('', 2, 'docker exec (simulation): interactive shells are not modelled. Run one command per docker exec, e.g. docker exec ' + c.name + ' ss -lnt');
    return res('', 126, 'docker exec (simulation): "' + prog + '" is not modelled inside the container. Supported: ss, netstat, curl, env, printenv, cat /etc/hosts, hostname, id.');
  }

  /* ── Go-template subset for --format ─────────────────────────── */
  function goPrint(v) {
    if (v === null || v === undefined) return '<nil>';
    if (Array.isArray(v)) return '[' + v.map(goPrint).join(' ') + ']';
    if (typeof v === 'object') {
      var keys = Object.keys(v);
      if (keys.length && keys.every(function (k) { return /^[A-Z]/.test(k); })) return '{' + keys.map(function (k) { return goPrint(v[k]); }).join(' ') + '}';
      return 'map[' + keys.sort().map(function (k) { return k + ':' + goPrint(v[k]); }).join(' ') + ']';
    }
    return String(v);
  }
  function getPath(obj, path) {
    if (path === '.') return obj;
    var parts = path.replace(/^\./, '').split('.'), cur = obj;
    for (var i = 0; i < parts.length; i++) { if (cur == null) return undefined; cur = cur[parts[i]]; }
    return cur;
  }
  function goTemplate(tpl, obj) {
    var bad = null;
    var t = String(tpl).replace(/\{\{\s*range\s+(\.[\w.]*)\s*\}\}([\s\S]*?)\{\{\s*end\s*\}\}/g, function (all, p, inner) {
      var v = getPath(obj, p), items = Array.isArray(v) ? v : v && typeof v === 'object' ? Object.keys(v).map(function (k) { return v[k]; }) : [];
      return items.map(function (it) { var g = goTemplate(inner, it); if (g.err) bad = g.err; return g.out || ''; }).join('');
    });
    t = t.replace(/\{\{\s*([^}]*?)\s*\}\}/g, function (all, expr) {
      var m;
      if ((m = /^json\s+(\.[\w.]*)$/.exec(expr))) return JSON.stringify(getPath(obj, m[1]) === undefined ? null : getPath(obj, m[1]));
      if ((m = /^index\s+(\.[\w.]*)\s+"([^"]+)"$/.exec(expr))) { var o = getPath(obj, m[1]); return goPrint(o ? o[m[2]] : undefined); }
      if ((m = /^index\s+(\.[\w.]*)\s+(\d+)$/.exec(expr))) { var o2 = getPath(obj, m[1]); return goPrint(o2 ? o2[Number(m[2])] : undefined); }
      if (/^\.[\w.]*$/.test(expr)) {
        var v = getPath(obj, expr);
        if (v === undefined) { bad = 'template: :1:' + (tpl.indexOf(expr) + 1) + ': executing "" at <' + expr + '>: map has no entry for key "' + expr.split('.').pop() + '"'; return ''; }
        return goPrint(v);
      }
      bad = 'template: this simulation supports {{.Field.Path}}, {{json .Path}}, {{index .Path "key"}} and {{range .Path}}…{{end}}; "' + expr + '" is not modelled';
      return '';
    });
    return bad ? { err: bad } : { out: t };
  }

  /* ── inspect documents ───────────────────────────────────────── */
  function imageDoc(img) {
    return { Id: img.id, RepoTags: img.repoTags.slice(), RepoDigests: img.repoDigests.slice(), Created: img.created || '2026-10-12T16:40:11Z',
      Architecture: img.arch, Os: 'linux', Size: img.sizeBytes || 171442176,
      Config: { User: '10001:10001', Env: (img.env || []).slice(), Entrypoint: (img.entrypoint || []).slice(), Cmd: (img.cmd || []).slice(), WorkingDir: '/app', ExposedPorts: { '8080/tcp': {} } } };
  }
  function ctrDoc(s, c) {
    var d = s.dk, img = d.images[c.imageId], env = envList(img, c);
    var ports = {}, bindings = {};
    c.ports.forEach(function (p) {
      var k = p.containerPort + '/tcp';
      bindings[k] = [{ HostIp: '', HostPort: String(p.hostPort) }];
      ports[k] = c.status === 'running' ? [{ HostIp: '0.0.0.0', HostPort: String(p.hostPort) }, { HostIp: '::', HostPort: String(p.hostPort) }] : null;
    });
    if (!c.ports.length && c.net !== 'host') ports['8080/tcp'] = null;
    var nets = {};
    nets[c.net] = { IPAddress: c.status === 'running' && c.ip ? c.ip : '', Gateway: c.net === 'host' ? '' : '172.18.0.1' };
    var ep = c.entryOverride ? [c.entryOverride] : (img.entrypoint || []);
    var health = healthOf(s, c);
    return { Id: c.id, Created: SIM().stamp({ clock: c.created }), Path: ep[0] || '', Args: ep.slice(1).concat(c.args || img.cmd || []),
      State: { Status: c.status, Running: c.status === 'running', ExitCode: c.exitCode, Pid: c.pid, StartedAt: c.startedAt == null ? '0001-01-01T00:00:00Z' : SIM().stamp({ clock: c.startedAt }),
               FinishedAt: c.finishedAt == null ? '0001-01-01T00:00:00Z' : SIM().stamp({ clock: c.finishedAt }), Error: '', Health: health ? { Status: health } : undefined },
      Image: img.id, Name: '/' + c.name, Platform: 'linux',
      Config: { Hostname: c.id.slice(0, 12), Image: c.ref, Env: Object.keys(env).map(function (k) { return k + '=' + env[k]; }), Entrypoint: ep, Cmd: c.args || img.cmd || [],
                ExposedPorts: { '8080/tcp': {} }, Labels: c.compose ? { 'com.docker.compose.project': c.compose.project, 'com.docker.compose.service': c.compose.service } : {} },
      HostConfig: { NetworkMode: c.net, Privileged: c.privileged, PortBindings: bindings },
      NetworkSettings: { Ports: ports, Networks: nets } };
  }
  function healthOf(s, c) {
    var img = s.dk.images[c.imageId];
    if (!img || img.app !== 'beacon' || c.status !== 'running') return null;
    if (s.clock - c.startedAt < 10) return 'starting';
    return inside(c, '127.0.0.1', 8080) ? 'healthy' : 'unhealthy';
  }
  function portsStr(c) {
    if (c.status !== 'running' || c.net === 'host') return '';
    return c.ports.map(function (p) { return '0.0.0.0:' + p.hostPort + '->' + p.containerPort + '/tcp, [::]:' + p.hostPort + '->' + p.containerPort + '/tcp'; }).join(', ');
  }
  function statusStr(s, c) {
    if (c.status === 'running') { var h = healthOf(s, c); return 'Up ' + since(s.clock - c.startedAt) + (h ? ' (' + h + ')' : ''); }
    if (c.status === 'created') return 'Created';
    return 'Exited (' + c.exitCode + ') ' + since(s.clock - c.finishedAt) + ' ago';
  }
  function cmdStr(s, c, n) {
    var img = s.dk.images[c.imageId], ep = c.entryOverride ? [c.entryOverride] : (img.entrypoint || []);
    var full = ep.concat(c.args || img.cmd || []).join(' ');
    return '"' + (full.length > n ? full.slice(0, n) + '…' : full) + '"';
  }

  /* ── Compose: a one-service subset of the Compose file format ── */
  function unq(x) { return String(x == null ? '' : x).trim().replace(/^["']|["']$/g, ''); }
  function parseCompose(text) {
    var out = { name: null, services: {} }, svc = null, key = null, inServices = false;
    String(text).split('\n').forEach(function (raw) {
      var ln = raw.replace(/\s+#.*$/, '').replace(/^#.*$/, '');
      if (!ln.trim()) return;
      var ind = ln.match(/^ */)[0].length, m;
      if (ind === 0) { m = /^([\w-]+):\s*(.*)$/.exec(ln); if (!m) return; if (m[1] === 'name') out.name = unq(m[2]); inServices = m[1] === 'services'; svc = null; return; }
      if (inServices && ind === 2) { m = /^\s+([\w.-]+):\s*$/.exec(ln); if (m) { svc = out.services[m[1]] = { ports: [], envFiles: [], environment: {} }; key = null; } return; }
      if (!svc) return;
      if (ind === 4) {
        m = /^\s+([\w_]+):\s*(.*)$/.exec(ln); if (!m) return;
        key = m[1]; var val = m[2].trim();
        if (val === '') return;
        if (key === 'env_file') svc.envFiles.push(unq(val));
        else if (key === 'ports' && /^\[/.test(val)) val.replace(/^\[|\]$/g, '').split(',').forEach(function (p) { if (p.trim()) svc.ports.push(unq(p)); });
        else svc[key] = unq(val);
        return;
      }
      if (ind >= 6) {
        if ((m = /^\s+-\s*(.*)$/.exec(ln))) {
          var item = unq(m[1]);
          if (key === 'ports') svc.ports.push(item);
          else if (key === 'env_file') svc.envFiles.push(item);
          else if (key === 'environment') { var i = item.indexOf('='); if (i > 0) svc.environment[item.slice(0, i)] = item.slice(i + 1); }
        } else if (key === 'environment' && (m = /^\s+([\w]+):\s*(.*)$/.exec(ln))) svc.environment[m[1]] = unq(m[2]);
      }
    });
    return out;
  }
  function parseEnvFile(text) {
    var env = {};
    String(text).split('\n').forEach(function (ln) {
      if (!ln.trim() || /^\s*#/.test(ln)) return;
      var i = ln.indexOf('=');
      if (i > 0) env[ln.slice(0, i).trim()] = ln.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    });
    return env;
  }
  function parsePort(p) {
    var m = /^(?:(\d+\.\d+\.\d+\.\d+):)?(\d+):(\d+)(?:\/tcp)?$/.exec(String(p));
    return m ? { hostIp: m[1] || '0.0.0.0', hostPort: Number(m[2]), containerPort: Number(m[3]) } : null;
  }
  /* read = function (path) -> text|null; the same parse at world build and at run time */
  function composeSpec(dir, read) {
    var text = read(dir + '/compose.yaml');
    if (text == null) return { err: 'no configuration file provided: not found' };
    var cf = parseCompose(text), sv = cf.services.api;
    if (!sv) return { err: 'compose.yaml: service "api" not found (this simulation models a one-service project)' };
    if (!sv.image) return { err: 'service "api" has neither an image nor a build context specified: invalid compose project' };
    var env = {};
    for (var i = 0; i < sv.envFiles.length; i++) {
      var et = read(dir + '/' + sv.envFiles[i].replace(/^\.\//, ''));
      if (et == null) return { err: 'env file ' + dir + '/' + sv.envFiles[i] + ' not found: stat ' + dir + '/' + sv.envFiles[i] + ': no such file or directory' };
      var pe = parseEnvFile(et); Object.keys(pe).forEach(function (k) { env[k] = pe[k]; });
    }
    Object.keys(sv.environment).forEach(function (k) { env[k] = sv.environment[k]; });
    var ports = [];
    for (var j = 0; j < sv.ports.length; j++) {
      var pp = parsePort(sv.ports[j]);
      if (!pp) return { err: 'services.api.ports: "' + sv.ports[j] + '" is not modelled (use "HOST:CONTAINER")' };
      ports.push(pp);
    }
    var project = cf.name || dir.split('/').pop();
    return { project: project, image: sv.image, env: env, ports: ports, net: sv.network_mode === 'host' ? 'host' : project + '_default',
      privileged: sv.privileged === 'true', platform: sv.platform || null };
  }
  function specHash(spec, imageId) { return SIM().fnv(JSON.stringify([imageId, spec.env, spec.ports, spec.net, spec.privileged, spec.platform])).toString(16); }
  function vfsReader(w) { return function (p) { return SIM().readFile(w, p); }; }
  function composeCtr(d) { return d.containers.filter(function (c) { return c.compose && c.compose.service === 'api'; })[0] || null; }
  /* the compose container exists, runs, and was created from the files as they are now */
  function composeCurrent(s, w) {
    var sp = composeSpec(s.dk.dir, vfsReader(w)), cur = composeCtr(s.dk);
    if (sp.err || !cur || cur.status !== 'running') return false;
    var img = localImage(s.dk, sp.image);
    return !!img && cur.hash === specHash(sp, img.id);
  }

  function composeVerb(s, w, a) {
    var d = s.dk, f = a.indexOf('-f') !== -1 ? a[a.indexOf('-f') + 1] : null;
    if (f) { a = a.filter(function (x, i) { return x !== '-f' && a[i - 1] !== '-f'; }); }
    var dir = f ? SIM().fileOf(w, f) ? f.replace(/\/[^/]*$/, '') || '.' : null : w.cwd;
    if (f && dir === '.') dir = w.cwd;
    var sub = a[0], rest = a.slice(1);
    if (!sub || sub === '--help') return res('docker compose (simulation, one service "api"): up -d [--force-recreate], ps [-a], logs [api], config, port api PORT, exec api CMD, restart, stop, start, down, pull');
    if (dir !== d.dir) return res('', 14, 'no configuration file provided: not found');
    var sp = composeSpec(dir, vfsReader(w));
    if (sp.err && sub !== 'ps' && sub !== 'down' && sub !== 'logs') return res('', 15, sp.err);
    var cur = composeCtr(d), name = (sp.project || 'looped') + '-api-1';
    if (sub === 'up') {
      if (rest.indexOf('-d') === -1 && rest.indexOf('--detach') === -1) return res('', 2, 'docker compose up (simulation): attached mode is not modelled; use docker compose up -d and then docker compose logs.');
      var out = [], img = localImage(d, sp.image);
      if (!img) {
        var pr = pull(s, sp.image, sp.platform, true);
        if (pr.err) return res(' api Pulling\n api Error ' + pr.err.replace(/^Error response from daemon: /, ''), 18, 'Error response from daemon: ' + pr.err.replace(/^Error response from daemon: /, ''));
        out.push(' api Pulling', ' api Pulled');
        img = pr.img;
      }
      if (img.arch !== d.hostArch && !sp.platform) out.push(' ! api The requested image\'s platform (' + platOf(img.arch) + ') does not match the detected host platform (' + platLabel(d.hostArch) + ') and no specific platform was requested');
      var h = specHash(sp, img.id), force = rest.indexOf('--force-recreate') !== -1, c = cur, recreated = false;
      if (d.networks.indexOf(sp.net) === -1 && sp.net !== 'host') { d.networks.push(sp.net); out.push(' Network ' + sp.net + '  Created'); }
      if (cur && (force || cur.hash !== h || cur.name !== name)) {
        out.push(' Container ' + cur.name + '  Recreate');
        removeCtr(s, cur); recreated = true; c = null;
      }
      if (!c) {
        c = createCtr(s, { name: name, ref: sp.image, imageId: img.id, env: sp.env, ports: sp.ports, net: sp.net, privileged: sp.privileged, compose: { project: sp.project, service: 'api' }, hash: h });
        out.push(' Container ' + name + '  ' + (recreated ? 'Recreated' : 'Created'));
      } else if (c.status === 'running') { out.push(' Container ' + name + '  Running'); return res(out.join('\n')); }
      out.push(' Container ' + name + '  Starting');
      var r = startCtr(s, c);
      if (r.err) return res(out.join('\n'), 1, 'Error response from daemon: ' + r.err);
      out.push(' Container ' + name + '  Started');
      return res(out.join('\n'));
    }
    if (sub === 'ps') {
      var all = rest.indexOf('-a') !== -1 || rest.indexOf('--all') !== -1;
      var list = d.containers.filter(function (c2) { return c2.compose && (all || c2.status === 'running'); });
      return res(SIM().table(['NAME', 'IMAGE', 'COMMAND', 'SERVICE', 'CREATED', 'STATUS', 'PORTS'], list.map(function (c2) {
        return [c2.name, c2.ref, cmdStr(s, c2, 20), c2.compose.service, since(s.clock - c2.created) + ' ago', statusStr(s, c2), portsStr(c2)];
      })));
    }
    if (sub === 'logs') {
      if (rest.indexOf('-f') !== -1 || rest.indexOf('--follow') !== -1) return res('', 2, 'docker compose logs -f is not modelled: run it again to see new lines (each command advances the clock).');
      if (!cur) return res('');
      var tl = rest.indexOf('--tail') !== -1 ? Number(rest[rest.indexOf('--tail') + 1]) : (rest.filter(function (x) { return /^--tail=/.test(x); })[0] ? Number(rest.filter(function (x) { return /^--tail=/.test(x); })[0].slice(7)) : 0);
      var lines = tl ? cur.logs.slice(-tl) : cur.logs;
      return res(lines.map(function (l) { return 'api-1  | ' + l; }).join('\n'));
    }
    if (sub === 'config') {
      var ylines = ['name: ' + sp.project, 'services:', '  api:', '    environment:'];
      Object.keys(sp.env).sort().forEach(function (k) { ylines.push('      ' + k + ': ' + (sp.env[k] === '' ? '""' : /^[\w./:-]+$/.test(sp.env[k]) && !/^::/.test(sp.env[k]) ? sp.env[k] : JSON.stringify(sp.env[k]))); });
      ylines.push('    image: ' + sp.image);
      if (sp.platform) ylines.push('    platform: ' + sp.platform);
      if (sp.net === 'host') ylines.push('    network_mode: host'); else ylines.push('    networks:', '      default: null');
      if (sp.ports.length) { ylines.push('    ports:'); sp.ports.forEach(function (p) { ylines.push('      - mode: ingress', '        target: ' + p.containerPort, '        published: "' + p.hostPort + '"', '        protocol: tcp'); }); }
      if (sp.privileged) ylines.push('    privileged: true');
      if (sp.net !== 'host') ylines.push('networks:', '  default:', '    name: ' + sp.net);
      return res(ylines.join('\n'));
    }
    if (sub === 'port') {
      var pport = Number(rest[1]);
      if (rest[0] !== 'api' || !pport) return res('', 1, 'usage (simulation): docker compose port api PRIVATE_PORT');
      if (!cur || cur.status !== 'running') return res('', 1, 'service "api" is not running');
      var b = cur.ports.filter(function (p) { return p.containerPort === pport; })[0];
      if (!b) return res('', 1, 'no port ' + pport + '/tcp for container ' + cur.name + ': ' + (cur.ports.map(function (p) { return p.containerPort + '/tcp'; }).join(', ') || 'none'));
      return res('0.0.0.0:' + b.hostPort);
    }
    if (sub === 'exec') {
      var ex = rest.filter(function (x) { return x !== '-it' && x !== '-T' && x !== '-i' && x !== '-t'; });
      if (ex[0] !== 'api') return res('', 1, 'service "' + (ex[0] || '') + '" is not running');
      if (!cur || cur.status !== 'running') return res('', 1, 'service "api" is not running');
      return execIn(s, cur, ex.slice(1));
    }
    if (sub === 'restart' || sub === 'start') {
      if (!cur) return res('', 1, 'no container found for project "' + (sp.project || 'looped') + '": not found');
      if (sub === 'restart') stopCtr(s, cur, 0);
      if (cur.status !== 'running') { var rs = startCtr(s, cur); if (rs.err) return res('', 1, 'Error response from daemon: ' + rs.err); }
      return res(' Container ' + cur.name + '  ' + (sub === 'restart' ? 'Restarting' : 'Starting') + '\n Container ' + cur.name + '  Started');
    }
    if (sub === 'stop') { if (cur) stopCtr(s, cur, 0); return res(cur ? ' Container ' + cur.name + '  Stopping\n Container ' + cur.name + '  Stopped' : ''); }
    if (sub === 'down') {
      var outd = [];
      d.containers.filter(function (c3) { return c3.compose; }).forEach(function (c3) { outd.push(' Container ' + c3.name + '  Stopping', ' Container ' + c3.name + '  Stopped', ' Container ' + c3.name + '  Removing', ' Container ' + c3.name + '  Removed'); removeCtr(s, c3); });
      var netName = (sp.project || 'looped') + '_default';
      if (d.networks.indexOf(netName) !== -1) { d.networks = d.networks.filter(function (n) { return n !== netName; }); outd.push(' Network ' + netName + '  Removing', ' Network ' + netName + '  Removed'); }
      return res(outd.join('\n'));
    }
    if (sub === 'pull') { var pl = pull(s, sp.image, sp.platform, true); return pl.err ? res(' api Error', 18, pl.err) : res(' api Pulling\n api Pulled'); }
    return SIM().unsupported('docker compose', sub, ['up -d [--force-recreate]', 'ps [-a]', 'logs', 'config', 'port api PORT', 'exec api CMD', 'restart', 'stop', 'start', 'down', 'pull']);
  }

  /* ── registry views: docker manifest inspect, buildx imagetools ─ */
  function manifestJson(x, verbose) {
    var b = x.blob;
    if (b.kind === 'index') {
      return JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json', manifests: b.manifests.map(function (mm) {
        var p = mm.platform.split('/');
        return { mediaType: 'application/vnd.oci.image.manifest.v1+json', size: 1795, digest: mm.digest, platform: mm.platform === 'unknown/unknown' ? { architecture: 'unknown', os: 'unknown' } : { architecture: p[1], os: p[0] } };
      }) }, null, 3);
    }
    var man = { schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json', config: { mediaType: 'application/vnd.oci.image.config.v1+json', size: 7342, digest: 'sha256:' + hex('cfg' + x.digest, 64) },
      layers: [1, 2, 3, 4].map(function (i) { return { mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip', size: 1000000 * i + 3311, digest: 'sha256:' + hex('layer' + i + x.digest, 64) }; }) };
    if (!verbose) return JSON.stringify(man, null, 3);
    var pp = b.platform.split('/');
    return JSON.stringify({ Ref: x.r.name + (x.r.tag ? ':' + x.r.tag : '@' + x.digest), Descriptor: { mediaType: man.mediaType, digest: x.digest, size: 1795, platform: { architecture: pp[1], os: pp[0] } }, SchemaV2Manifest: man }, null, 3);
  }
  function imagetools(s, a) {
    var d = s.dk;
    if (a[0] !== 'inspect') return SIM().unsupported('docker buildx imagetools', a[0] || '', ['inspect REF [--raw] [--format "{{json .Image}}"]']);
    var fi = a.indexOf('--format'), fmt = fi !== -1 ? a[fi + 1] : (a.filter(function (x) { return /^--format=/.test(x); })[0] || '').slice(9) || null;
    var ref = a.slice(1).filter(function (x, i, arr) { return x.charAt(0) !== '-' && arr[i - 1] !== '--format'; })[0];
    if (!ref) return res('', 1, 'ERROR: requires exactly 1 argument');
    var x = remote(d, ref);
    if (x.missingRepo || x.missing) return res('', 1, 'ERROR: ' + ref + ': not found');
    if (a.indexOf('--raw') !== -1) return res(manifestJson(x, false));
    if (fmt) {
      if (/^\{\{\s*json\s+\.Image\s*\}\}$/.test(fmt)) {
        if (x.blob.kind === 'index') {
          var o = {};
          x.blob.manifests.forEach(function (mm) { if (mm.platform !== 'unknown/unknown') { var im = x.repo.blobs[mm.digest].image; o[mm.platform] = { created: im.created || '2026-10-12T16:40:11Z', architecture: im.arch, os: 'linux', config: { Entrypoint: im.entrypoint, Cmd: im.cmd } }; } });
          return res(JSON.stringify(o, null, 2));
        }
        var im1 = x.blob.image;
        return res(JSON.stringify({ created: im1.created || '2026-10-12T16:40:11Z', architecture: im1.arch, os: 'linux', config: { Entrypoint: im1.entrypoint, Cmd: im1.cmd } }, null, 2));
      }
      return res('', 1, 'ERROR: --format: this simulation supports "{{json .Image}}" only');
    }
    var lines = ['Name:      ' + ref, 'MediaType: ' + (x.blob.kind === 'index' ? 'application/vnd.oci.image.index.v1+json' : 'application/vnd.oci.image.manifest.v1+json'), 'Digest:    ' + x.digest];
    if (x.blob.kind === 'index') {
      lines.push('', 'Manifests:');
      x.blob.manifests.forEach(function (mm, i) {
        if (i) lines.push('');
        lines.push('  Name:        ' + x.r.name + '@' + mm.digest, '  MediaType:   application/vnd.oci.image.manifest.v1+json', '  Platform:    ' + mm.platform);
        if (mm.platform === 'unknown/unknown') lines.push('  Annotations:', '    vnd.docker.reference.digest: ' + mm.ref, '    vnd.docker.reference.type:   attestation-manifest');
      });
    }
    return res(lines.join('\n'));
  }

  /* ── docker build / docker buildx build over the context's Dockerfile ─ */
  function buildCmd(s, w, a) {
    var d = s.dk, plat = null, tags = [], file = null, ctx = null, push = false; /* --load is the default with the docker driver */
    for (var i = 0; i < a.length; i++) {
      var t = a[i];
      if (t === '--platform') plat = a[++i]; else if (/^--platform=/.test(t)) plat = t.slice(11);
      else if (t === '-t' || t === '--tag') tags.push(a[++i]); else if (/^--tag=/.test(t)) tags.push(t.slice(6));
      else if (t === '-f' || t === '--file') file = a[++i];
      else if (t === '--push') push = true;
      else if (t === '--progress' || t === '--builder' || t === '--build-arg') i++;
      else if (t.charAt(0) === '-') { /* --no-cache, --pull: accepted */ }
      else ctx = t;
    }
    if (!ctx) return res('', 1, 'ERROR: "docker buildx build" requires exactly 1 argument.');
    var base = ctx === '.' ? w.cwd : (ctx.charAt(0) === '/' ? ctx : w.cwd + '/' + ctx).replace(/\/$/, '');
    var dfPath = file ? (file.charAt(0) === '/' ? file : w.cwd + '/' + file) : base + '/Dockerfile';
    var text = SIM().readFile(w, dfPath);
    if (text == null) return res('', 1, 'ERROR: failed to solve: failed to read dockerfile: open Dockerfile: no such file or directory');
    var plats = (plat || platOf(d.hostArch)).split(',');
    if (plats.length > 1) return res('', 1, 'ERROR: Multi-platform build is not supported for the docker driver.\nSwitch to a different driver, or turn on the containerd image store, and try again.\nLearn more at https://docs.docker.com/go/build-multi-platform/\n(simulation: multi-platform images are built and pushed by CI; the L13 lab does it for real)');
    if (push) return res('', 1, 'ERROR: pushing to a registry is not modelled in this simulation; build with --load (or plain docker build) for this host. CI publishes registry images.');
    var arch = plats[0].split('/')[1];
    if (!arch || ['amd64', 'arm64'].indexOf(arch) === -1) return res('', 1, 'ERROR: failed to solve: ' + plats[0] + ': platform not modelled (linux/arm64, linux/amd64)');
    var steps = ['[+] Building 38.4s (15/15) FINISHED                                docker:default', ' => [internal] load build definition from Dockerfile', ' => [internal] load metadata for docker.io/library/python:3.12.7-slim-bookworm'];
    if (arch !== d.hostArch && d.binfmt.indexOf(arch) === -1) {
      return res(steps.concat([' => [stage-1 1/7] FROM docker.io/library/python:3.12.7-slim-bookworm (' + plats[0] + ')', ' => ERROR [stage-1 3/7] RUN pip install --no-cache-dir --require-hashes -r /tmp/requirements.txt', '------', ' > [stage-1 3/7] RUN pip install --no-cache-dir --require-hashes -r /tmp/requirements.txt:', '0.112 exec /bin/sh: exec format error', '------']).join('\n'), 1,
        'ERROR: failed to solve: process "/bin/sh -c pip install --no-cache-dir --require-hashes -r /tmp/requirements.txt" did not complete successfully: exit code: 255');
    }
    var m = /^FROM\s+(?:--platform=(\S+)\s+)?(\S+)\s+AS\s+init\s*$/mi.exec(text);
    var initArch = null;
    if (m) {
      var pv = m[1];
      initArch = !pv ? arch : pv === '$BUILDPLATFORM' ? d.hostArch : pv === '$TARGETPLATFORM' ? arch : (pv.split('/')[1] || arch);
      steps.push(' => [init 1/1] FROM ' + m[2] + (pv ? ' (--platform=' + pv + ')' : ''));
    }
    var usesTini = /ENTRYPOINT\s*\[\s*"\/usr\/local\/bin\/tini"/.test(text);
    var id = 'sha256:' + hex('build:' + text + ':' + arch + ':' + s.seed, 64);
    steps.push(' => [stage-1 1/7] FROM docker.io/library/python:3.12.7-slim-bookworm', ' => [stage-1 2/7] COPY requirements.txt /tmp/requirements.txt', ' => [stage-1 3/7] RUN pip install --no-cache-dir --require-hashes -r /tmp/requirements.txt');
    if (m) steps.push(' => [stage-1 4/7] COPY --from=init /tini /usr/local/bin/tini');
    steps.push(' => [stage-1 5/7] RUN groupadd --gid 10001 beacon && useradd --uid 10001 --gid 10001 ...', ' => [stage-1 6/7] COPY --chown=beacon:beacon beacon/ /app/beacon/', ' => exporting to image', ' => => writing image ' + id);
    var img = { id: id, arch: arch, entryArch: usesTini ? (initArch || arch) : arch, entryPath: usesTini ? '/usr/local/bin/tini' : '/usr/local/bin/python3', app: 'beacon', version: d.sourceVersion, ipv6: false,
      env: ['PATH=/usr/local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', 'PYTHONUNBUFFERED=1', 'BEACON_CONFIG=/app/beacon.yaml', 'BEACON_STORE_KIND=memory'],
      entrypoint: usesTini ? ['/usr/local/bin/tini', '--', 'python3', '-m', 'beacon'] : ['python3', '-m', 'beacon'], cmd: ['api'], created: SIM().stamp(s), repoTags: [], repoDigests: [], built: true,
      files: { '/usr/local/bin/tini': initArch || arch, '/usr/local/bin/python3.12': arch } };
    d.images[id] = d.images[id] || img;
    tags.forEach(function (tg) { var r = parseRef(tg); setTag(d, r.name + ':' + r.tag, id); steps.push(' => => naming to ' + (hostOfName(r.name) === 'docker.io' ? 'docker.io/' + (r.name.indexOf('/') === -1 ? 'library/' : '') + r.name : r.name) + ':' + r.tag + ' done'); });
    if (!tags.length) steps.push(' => => (no tag given: the image is only reachable by its ID)');
    return res(steps.join('\n'));
  }

  /* ── docker run / create ─────────────────────────────────────── */
  function runParse(a) {
    var o = { d: false, rm: false, name: null, ports: [], env: {}, envFiles: [], net: null, privileged: false, platform: null, entry: null, image: null, args: [] };
    var valued = ['--name', '-p', '--publish', '-e', '--env', '--env-file', '--network', '--net', '--platform', '--entrypoint', '-u', '--user', '--restart', '-w', '--workdir', '-v', '--volume', '--health-cmd'];
    for (var i = 0; i < a.length; i++) {
      var t = a[i], v = null;
      if (o.image) { o.args.push(t); continue; }
      if (/^--[\w-]+=/.test(t)) { v = t.slice(t.indexOf('=') + 1); t = t.slice(0, t.indexOf('=')); }
      else if (valued.indexOf(t) !== -1) v = a[++i];
      if (t === '-d' || t === '--detach') o.d = true;
      else if (t === '--rm') o.rm = true;
      else if (t === '--privileged') o.privileged = true;
      else if (/^-[ditr]+$/.test(t) && t !== '-d') { if (t.indexOf('d') !== -1) o.d = true; }
      else if (t === '--name') o.name = v;
      else if (t === '-p' || t === '--publish') o.ports.push(v);
      else if (t === '-e' || t === '--env') { var k = String(v).indexOf('='); if (k > 0) o.env[v.slice(0, k)] = v.slice(k + 1); }
      else if (t === '--env-file') o.envFiles.push(v);
      else if (t === '--network' || t === '--net') o.net = v;
      else if (t === '--platform') o.platform = v;
      else if (t === '--entrypoint') o.entry = v;
      else if (t.charAt(0) === '-') { /* other flags accepted, not modelled */ }
      else o.image = t;
    }
    return o;
  }
  var NAMES = ['eager_hopper', 'quirky_lovelace', 'brave_turing', 'calm_noether', 'keen_ritchie', 'tender_shannon'];
  function oneShot(s, img, o, c) {
    var d = s.dk, entry = o.entry, args = o.args;
    var path = entry || (img.entrypoint || [])[0], arch = entry && !/tini/.test(entry) ? img.arch : img.entryArch;
    if (/tini/.test(path || '')) arch = img.files && img.files['/usr/local/bin/tini'] || img.entryArch;
    var shown = /^\//.test(path) ? path : '/usr/bin/' + path;
    if (path === 'python3' || path === 'python') shown = '/usr/local/bin/python3';
    if (arch !== d.hostArch && d.binfmt.indexOf(arch) === -1) return { out: '', line: 'exec ' + shown + ': exec format error', code: 255 };
    if (path === 'uname') return { out: args.indexOf('-m') !== -1 ? archName(img.arch) : 'Linux ' + c.id.slice(0, 12) + ' 6.8.0-45-generic #45-Ubuntu SMP ' + archName(img.arch) + ' GNU/Linux', code: 0 };
    if (path === 'python3' || path === 'python') {
      if (args[0] === '-V' || args[0] === '--version') return { out: 'Python 3.12.7', code: 0 };
      if (args[0] === '-c' && /platform|machine|uname/.test(args.slice(1).join(' '))) return { out: archName(img.arch), code: 0 };
      return { out: '', line: 'python3 (simulation): only -V and -c "import platform; print(platform.machine())" are modelled', code: 2 };
    }
    if (path === 'cat' && args[0] === '/etc/os-release') return { out: 'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\nVERSION_CODENAME=bookworm', code: 0 };
    if (path === 'file') return { out: '', line: 'docker: Error response from daemon: failed to create task for container: exec: "file": executable file not found in $PATH: unknown.', code: 127 };
    if (/tini/.test(path)) return { out: args.indexOf('--version') !== -1 ? 'tini version 0.19.0' : '', code: 0 };
    return { out: '', line: 'docker run (simulation): "' + path + '" is not modelled as a one-off command. Modelled: uname -m, python3 -V, python3 -c "…platform…", cat /etc/os-release.', code: 126 };
  }
  function runCmd(s, w, a, createOnly) {
    var d = s.dk, o = runParse(a), pre = '';
    if (!o.image) return res('', 125, '"docker ' + (createOnly ? 'create' : 'run') + '" requires at least 1 argument.');
    var img = localImage(d, o.image);
    if (img && o.platform && platOf(img.arch) !== o.platform) img = null;
    if (!img) {
      var p = pull(s, o.image, o.platform, false);
      if (p.err) return res('Unable to find image \'' + o.image + '\' locally', 125, 'docker: ' + p.err + '.\nSee \'docker run --help\'.');
      pre = 'Unable to find image \'' + o.image + '\' locally\n' + p.out;
      img = p.img;
    }
    var warn = img.arch !== d.hostArch && !o.platform ? 'WARNING: The requested image\'s platform (' + platOf(img.arch) + ') does not match the detected host platform (' + platLabel(d.hostArch) + ') and no specific platform was requested\n' : '';
    if (img.app === 'binfmt') {
      if (createOnly) return res('', 1, 'docker create (simulation): the binfmt tool image is modelled for run --rm only');
      var inst = o.args.indexOf('--install') !== -1 ? o.args[o.args.indexOf('--install') + 1] : null;
      var un = o.args.indexOf('--uninstall') !== -1 ? o.args[o.args.indexOf('--uninstall') + 1] : null;
      var archs = String(inst || un || '').split(',').map(function (x) { return x === 'all' ? ['amd64', 'riscv64', 'ppc64le', 's390x'] : [x.replace(/^linux\//, '')]; }).reduce(function (x, y) { return x.concat(y); }, []).filter(Boolean);
      if (inst) {
        if (!o.privileged) return res(pre + archs.map(function (x) { return 'installing: ' + x + ' cannot register "/usr/bin/qemu-' + archName(x) + '" to /proc/sys/fs/binfmt_misc/register: write /proc/sys/fs/binfmt_misc/register: operation not permitted'; }).join('\n'), 1);
        archs.forEach(function (x) { if (d.binfmt.indexOf(x) === -1) d.binfmt.push(x); });
        return res(pre + archs.map(function (x) { return 'installing: ' + x + ' OK'; }).join('\n') + '\n' + JSON.stringify({ supported: [platOf(d.hostArch)].concat(d.binfmt.map(platOf)), emulators: d.binfmt.map(function (x) { return 'qemu-' + archName(x); }) }, null, 2));
      }
      if (un) { d.binfmt = d.binfmt.filter(function (x) { return archs.indexOf(x) === -1; }); return res(pre + archs.map(function (x) { return 'uninstalling: ' + x + ' OK'; }).join('\n')); }
      return res(pre + JSON.stringify({ supported: [platOf(d.hostArch)].concat(d.binfmt.map(platOf)), emulators: d.binfmt.map(function (x) { return 'qemu-' + archName(x); }) }, null, 2));
    }
    var env = {};
    for (var i = 0; i < o.envFiles.length; i++) {
      var ef = o.envFiles[i], et = SIM().readFile(w, ef.charAt(0) === '/' ? ef : w.cwd + '/' + ef);
      if (et == null) return res('', 125, 'docker: open ' + ef + ': no such file or directory.');
      var pe = parseEnvFile(et); Object.keys(pe).forEach(function (k) { env[k] = pe[k]; });
    }
    Object.keys(o.env).forEach(function (k) { env[k] = o.env[k]; });
    var ports = [];
    for (var j = 0; j < o.ports.length; j++) { var pp = parsePort(o.ports[j]); if (!pp) return res('', 125, 'docker: -p ' + o.ports[j] + ': this simulation models HOST:CONTAINER mappings.'); ports.push(pp); }
    var name = o.name || NAMES[d.seq % NAMES.length];
    var clash = findCtr(d, name);
    if (clash && clash.name === name) return res('', 125, 'docker: Error response from daemon: Conflict. The container name "/' + name + '" is already in use by container "' + clash.id + '". You have to remove (or rename) that container to be able to reuse that name.\nSee \'docker run --help\'.');
    var c = createCtr(s, { name: name, ref: o.image, imageId: img.id, env: env, ports: o.net === 'host' ? [] : ports, net: o.net === 'host' ? 'host' : (o.net || 'bridge'), privileged: o.privileged,
      entryOverride: o.entry, args: o.args.length ? o.args : null });
    if (o.net === 'host' && ports.length) warn += 'WARNING: Published ports are discarded when using host network mode\n';
    if (createOnly) return res(pre + warn + c.id);
    var isApp = img.app === 'beacon' && !o.entry && (!o.args.length || (o.args.length === 1 && o.args[0] === 'api'));
    if (!isApp) {
      var r1 = oneShot(s, img, o, c);
      c.status = 'exited'; c.exitCode = r1.code; c.startedAt = s.clock; c.finishedAt = s.clock;
      if (r1.line) c.logs.push(r1.line); if (r1.out) c.logs.push(r1.out);
      if (o.rm) s.dk.containers = s.dk.containers.filter(function (x) { return x !== c; });
      return { out: pre + warn + (r1.out ? r1.out + '\n' : ''), err: r1.line ? r1.line + '\n' : null, code: r1.code };
    }
    var r = startCtr(s, c);
    if (r.err) return res(pre + warn, 125, 'docker: Error response from daemon: ' + r.err + '.');
    if (o.d) return res(pre + warn + c.id);
    if (r.exited) { if (o.rm) s.dk.containers = s.dk.containers.filter(function (x) { return x !== c; }); return { out: pre + warn, err: r.line + '\n', code: c.exitCode }; }
    return res(pre + warn + c.logs.slice(-2).join('\n') + '\n(simulation: attached mode is not modelled; the container keeps running in the background — docker logs ' + c.name + ')');
  }

  function dockerVerb(s) {
    var HELP = 'docker (simulation): ps [-a], inspect [-f FMT] NAME|IMAGE, logs NAME, port NAME, exec NAME CMD, run, create, start, stop, restart, rm [-f], cp, images, pull [--platform], image inspect, manifest inspect [-v], buildx imagetools inspect, buildx build, build, info, version, compose …';
    var LIST = ['ps', 'inspect', 'logs', 'port', 'exec', 'run', 'create', 'start', 'stop', 'restart', 'rm', 'cp', 'images', 'pull', 'image inspect', 'manifest inspect', 'buildx imagetools inspect', 'buildx build', 'build', 'info', 'version', 'compose'];
    return function (w, a) {
      var d = s.dk, sub = a[0];
      if (!sub || sub === '--help' || sub === 'help') return res(HELP);
      if (sub === 'container') { a = a.slice(1); sub = a[0] === 'ls' ? 'ps' : a[0]; }
      if (sub === 'image') {
        if (a[1] === 'inspect') { a = ['inspect', '--type', 'image'].concat(a.slice(2)); sub = 'inspect'; }
        else if (a[1] === 'ls') { a = ['images'].concat(a.slice(2)); sub = 'images'; }
        else if (a[1] === 'pull') { a = ['pull'].concat(a.slice(2)); sub = 'pull'; }
        else return SIM().unsupported('docker image', a[1] || '', ['inspect', 'ls', 'pull']);
      }
      var rest = a.slice(1);
      function fmtOf(arr) {
        for (var i = 0; i < arr.length; i++) {
          if (arr[i] === '-f' || arr[i] === '--format') return arr[i + 1];
          if (/^--format=/.test(arr[i])) return arr[i].slice(9);
          if (/^-f./.test(arr[i])) return arr[i].slice(2);
        }
        return null;
      }
      function names(arr, valued) { return arr.filter(function (x, i) { return x.charAt(0) !== '-' && valued.indexOf(arr[i - 1]) === -1; }); }
      switch (sub) {
        case 'ps': {
          var all = rest.indexOf('-a') !== -1 || rest.indexOf('--all') !== -1;
          var list = d.containers.filter(function (c) { return all || c.status === 'running'; }).slice().reverse();
          return res(SIM().table(['CONTAINER ID', 'IMAGE', 'COMMAND', 'CREATED', 'STATUS', 'PORTS', 'NAMES'], list.map(function (c) {
            return [c.id.slice(0, 12), c.ref, cmdStr(s, c, 20), since(s.clock - c.created) + ' ago', statusStr(s, c), portsStr(c), c.name];
          })));
        }
        case 'inspect': {
          var fmt = fmtOf(rest), typ = rest.indexOf('--type') !== -1 ? rest[rest.indexOf('--type') + 1] : null;
          var targets = names(rest, ['-f', '--format', '--type']);
          if (!targets.length) return res('', 1, '"docker inspect" requires at least 1 argument.');
          var docs = [], missing = null;
          targets.forEach(function (t) {
            var c = typ === 'image' ? null : findCtr(d, t), img = c || typ === 'container' ? null : localImage(d, t);
            if (c) docs.push(ctrDoc(s, c)); else if (img) docs.push(imageDoc(img)); else missing = t;
          });
          if (missing) return res('', 1, 'Error: No such ' + (typ || 'object') + ': ' + missing);
          if (fmt) {
            var outs = [];
            for (var k = 0; k < docs.length; k++) { var g = goTemplate(fmt, docs[k]); if (g.err) return res('', 1, g.err); outs.push(g.out); }
            return res(outs.join('\n'));
          }
          return res(JSON.stringify(docs, null, 4));
        }
        case 'logs': {
          if (rest.indexOf('-f') !== -1 || rest.indexOf('--follow') !== -1) return res('', 2, 'docker logs -f is not modelled: run it again to see new lines (each command advances the clock).');
          var lc = findCtr(d, names(rest, ['--tail', '-n', '--since'])[0]);
          if (!lc) return res('', 1, 'Error response from daemon: No such container: ' + (names(rest, ['--tail', '-n', '--since'])[0] || ''));
          var tn = rest.indexOf('--tail') !== -1 ? Number(rest[rest.indexOf('--tail') + 1]) : rest.indexOf('-n') !== -1 ? Number(rest[rest.indexOf('-n') + 1]) : 0;
          var lines = tn ? lc.logs.slice(-tn) : lc.logs;
          return res(lines.join('\n'));
        }
        case 'port': {
          var pc = findCtr(d, rest[0]);
          if (!pc) return res('', 1, 'Error response from daemon: No such container: ' + (rest[0] || ''));
          if (pc.status !== 'running') return res('');
          var pl = pc.ports.filter(function (p) { return !rest[1] || String(p.containerPort) === String(rest[1]).replace(/\/tcp$/, ''); });
          if (rest[1] && !pl.length) return res('', 1, 'Error: No public port \'' + String(rest[1]).replace(/\/tcp$/, '') + '/tcp\' published for ' + pc.name);
          return res(pl.map(function (p) { return rest[1] ? '0.0.0.0:' + p.hostPort + '\n[::]:' + p.hostPort : p.containerPort + '/tcp -> 0.0.0.0:' + p.hostPort + '\n' + p.containerPort + '/tcp -> [::]:' + p.hostPort; }).join('\n'));
        }
        case 'exec': {
          var ea = rest.slice(), opts = [];
          while (ea.length && ea[0].charAt(0) === '-') { var fl = ea.shift(); if (['-u', '--user', '-e', '--env', '-w', '--workdir'].indexOf(fl) !== -1) ea.shift(); opts.push(fl); }
          var ec = findCtr(d, ea[0]);
          if (!ec) return res('', 1, 'Error response from daemon: No such container: ' + (ea[0] || ''));
          if (ec.status !== 'running') return res('', 1, 'Error response from daemon: container ' + ec.id + ' is not running');
          if (!ea[1]) return res('', 1, '"docker exec" requires at least 2 arguments.');
          return execIn(s, ec, ea.slice(1));
        }
        case 'run': return runCmd(s, w, rest, false);
        case 'create': return runCmd(s, w, rest, true);
        case 'start': case 'stop': case 'restart': case 'kill': {
          var outS = [];
          var tl = names(rest, ['-t', '--time', '-s', '--signal']);
          for (var q = 0; q < tl.length; q++) {
            var sc = findCtr(d, tl[q]);
            if (!sc) return res(outS.join('\n'), 1, 'Error response from daemon: No such container: ' + tl[q]);
            if (sub !== 'start') stopCtr(s, sc, sub === 'kill' ? 137 : 0);
            if (sub === 'start' || sub === 'restart') { var r2 = startCtr(s, sc); if (r2.err) return res(outS.join('\n'), 1, 'Error response from daemon: ' + r2.err); }
            outS.push(tl[q]);
          }
          return res(outS.join('\n'));
        }
        case 'rm': {
          var force = rest.indexOf('-f') !== -1 || rest.indexOf('--force') !== -1, outR = [];
          var rl = names(rest, []);
          for (var z = 0; z < rl.length; z++) {
            var rc = findCtr(d, rl[z]);
            if (!rc) return res(outR.join('\n'), 1, 'Error response from daemon: No such container: ' + rl[z]);
            if (rc.status === 'running' && !force) return res(outR.join('\n'), 1, 'Error response from daemon: cannot remove container "/' + rc.name + '": container is running: stop the container before removing or force remove');
            removeCtr(s, rc); outR.push(rl[z]);
          }
          return res(outR.join('\n'));
        }
        case 'cp': {
          var src = rest[0] || '', dst = rest[1];
          var mm = /^([^:]+):(\/.+)$/.exec(src);
          if (!mm || !dst) return res('', 1, 'docker cp (simulation): only CONTAINER:/path HOSTPATH (container to host) is modelled');
          var cc = findCtr(d, mm[1]);
          if (!cc) return res('', 1, 'Error response from daemon: No such container: ' + mm[1]);
          var ci = d.images[cc.imageId], farch = (ci.files || {})[mm[2]];
          if (!farch) return res('', 1, 'Error response from daemon: Could not find the file ' + mm[2] + ' in container ' + mm[1]);
          var target = dst.charAt(0) === '/' ? dst : w.cwd + '/' + dst;
          var tn2 = LXShell.node(w, target);
          if (tn2 && tn2.t === 'd') target = target.replace(/\/$/, '') + '/' + mm[2].split('/').pop();
          SIM().writeFile(w, target, '#sim-elf: ' + farch + '\n(binary content of ' + mm[2] + ' copied from ' + cc.name + ')\n');
          return res('Successfully copied 1.08MB to ' + target);
        }
        case 'images': {
          var rows = [];
          Object.keys(d.images).forEach(function (id) {
            var im = d.images[id], tg = im.repoTags.length ? im.repoTags : ['<none>:<none>'];
            tg.forEach(function (t) { var i2 = t.lastIndexOf(':'); rows.push([t.slice(0, i2), t.slice(i2 + 1), id.replace(/^sha256:/, '').slice(0, 12), im.built ? since(s.clock - 0) + ' ago' : '20 hours ago', im.size || '171MB']); });
          });
          var flt = names(rest, []);
          if (flt[0]) rows = rows.filter(function (r) { return r[0] === parseRef(flt[0]).name || (r[0] + ':' + r[1]) === flt[0]; });
          return res(SIM().table(['REPOSITORY', 'TAG', 'IMAGE ID', 'CREATED', 'SIZE'], rows));
        }
        case 'pull': {
          var pplat = rest.indexOf('--platform') !== -1 ? rest[rest.indexOf('--platform') + 1] : (rest.filter(function (x) { return /^--platform=/.test(x); })[0] || '').slice(11) || null;
          var pref = names(rest, ['--platform'])[0];
          if (!pref) return res('', 1, '"docker pull" requires exactly 1 argument.');
          var pr = pull(s, pref, pplat, false);
          return pr.err ? res('', 1, pr.err) : res(pr.out);
        }
        case 'manifest': {
          if (rest[0] !== 'inspect') return SIM().unsupported('docker manifest', rest[0] || '', ['inspect [-v] REF']);
          var verbose = rest.indexOf('-v') !== -1 || rest.indexOf('--verbose') !== -1;
          var mref = names(rest.slice(1), [])[0];
          var x = remote(d, mref || '');
          if (!mref || x.missingRepo || x.missing) return res('', 1, 'no such manifest: ' + (mref || ''));
          if (verbose && x.blob.kind === 'index') {
            return res(JSON.stringify(x.blob.manifests.filter(function (mm2) { return mm2.platform !== 'unknown/unknown'; }).map(function (mm2) {
              var pp2 = mm2.platform.split('/');
              return { Ref: x.r.name + '@' + mm2.digest, Descriptor: { mediaType: 'application/vnd.oci.image.manifest.v1+json', digest: mm2.digest, size: 1795, platform: { architecture: pp2[1], os: pp2[0] } } };
            }), null, 3));
          }
          return res(manifestJson(x, verbose));
        }
        case 'buildx': {
          if (rest[0] === 'imagetools') return imagetools(s, rest.slice(1));
          if (rest[0] === 'build') return buildCmd(s, w, rest.slice(1));
          return SIM().unsupported('docker buildx', rest[0] || '', ['imagetools inspect REF', 'build --platform P -t TAG [--load] CONTEXT']);
        }
        case 'build': return buildCmd(s, w, rest);
        case 'info': {
          var ifmt = fmtOf(rest);
          var info = { Architecture: archName(d.hostArch), OSType: 'linux', OperatingSystem: 'Ubuntu 24.04.1 LTS', KernelVersion: '6.8.0-45-generic', ServerVersion: '28.3.3', Driver: 'overlay2', NCPU: 4, Name: d.hostName };
          if (ifmt) { var gi = goTemplate(ifmt, info); return gi.err ? res('', 1, gi.err) : res(gi.out); }
          return res('Client: Docker Engine - Community\n Version:    28.3.3\n Context:    default\n\nServer:\n Containers: ' + d.containers.length + '\n  Running: ' + running(d).length + '\n Images: ' + Object.keys(d.images).length + '\n Server Version: 28.3.3\n Storage Driver: overlay2\n Kernel Version: 6.8.0-45-generic\n Operating System: Ubuntu 24.04.1 LTS\n OSType: linux\n Architecture: ' + archName(d.hostArch) + '\n CPUs: 4\n Name: ' + d.hostName);
        }
        case 'version': {
          var vf = fmtOf(rest), ver = { Client: { Version: '28.3.3', Os: 'linux', Arch: d.hostArch }, Server: { Version: '28.3.3', Os: 'linux', Arch: d.hostArch } };
          if (vf) { var gv = goTemplate(vf, ver); return gv.err ? res('', 1, gv.err) : res(gv.out); }
          return res('Client: Docker Engine - Community\n Version:           28.3.3\n API version:       1.51\n OS/Arch:           linux/' + d.hostArch + '\n\nServer: Docker Engine - Community\n Engine:\n  Version:          28.3.3\n  API version:      1.51 (minimum version 1.24)\n  OS/Arch:          linux/' + d.hostArch);
        }
        case 'compose': return composeVerb(s, w, rest);
      }
      return SIM().unsupported('docker', sub, LIST);
    };
  }
  function nsenterVerb(s) {
    return function (w, a) {
      var pid = null, net = false, i = 0;
      for (; i < a.length; i++) {
        var t = a[i];
        if (t === '-t' || t === '--target') pid = Number(a[++i]);
        else if (/^--target=/.test(t)) pid = Number(t.slice(9));
        else if (/^-t\d+$/.test(t)) pid = Number(t.slice(2));
        else if (t === '-n' || t === '--net') net = true;
        else if (/^-[a-z]+$/.test(t)) { if (t.indexOf('n') !== -1) net = true; if (t.indexOf('t') !== -1) pid = Number(a[++i]); }
        else break;
      }
      if (!pid || !net) return res('', 1, 'nsenter (simulation): only "nsenter -t PID -n COMMAND" (enter a container\'s network namespace) is modelled');
      var c = running(s.dk).filter(function (x) { return x.pid === pid; })[0];
      if (!c) return res('', 1, 'nsenter: cannot open /proc/' + pid + '/ns/net: No such file or directory');
      if (!a[i]) return res('', 1, 'nsenter (simulation): give a command to run, e.g. ss -lnt');
      return execIn(s, c, a.slice(i), true);
    };
  }
  function fileVerb() {
    return function (w, a) {
      var p = a.filter(function (x) { return x.charAt(0) !== '-'; })[0];
      if (!p) return res('', 1, 'Usage: file [-bchikLlNnprsSvzZ0] [--apple] [--extension] [--mime-encoding] [--mime-type] FILE...');
      var n = LXShell.node(w, p);
      if (!n) return res(p + ': cannot open `' + p + '\' (No such file or directory)');
      if (n.t === 'd') return res(p + ': directory');
      var m = /^#sim-elf:\s*(\w+)/.exec(n.content || '');
      if (m) return res(p + ': ELF 64-bit LSB executable, ' + (m[1] === 'amd64' ? 'x86-64' : m[1] === 'arm64' ? 'ARM aarch64' : m[1]) + ', version 1 (SYSV), statically linked, stripped');
      if (/^FROM /m.test(n.content || '')) return res(p + ': Dockerfile, ASCII text');
      return res(p + ': ASCII text');
    };
  }

  /* image/registry fixtures, built per world so attempts never share state */
  function beaconImage(seed, o) {
    var id = 'sha256:' + hex('img:' + seed, 64);
    return { id: id, arch: o.arch, entryArch: o.entryArch || o.arch, entryPath: o.tini ? '/usr/local/bin/tini' : '/usr/local/bin/python3', app: 'beacon', version: o.version, ipv6: !!o.ipv6,
      env: ['PATH=/usr/local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', 'PYTHONUNBUFFERED=1', 'BEACON_CONFIG=/app/beacon.yaml', 'BEACON_STORE_KIND=memory'],
      entrypoint: o.tini ? ['/usr/local/bin/tini', '--', 'python3', '-m', 'beacon'] : ['python3', '-m', 'beacon'], cmd: ['api'], created: o.created || '2026-10-12T16:40:11Z',
      repoTags: [], repoDigests: [], size: o.size || '171MB', files: { '/usr/local/bin/tini': o.tini ? (o.entryArch || o.arch) : undefined, '/usr/local/bin/python3.12': o.arch } };
  }
  function addManifest(repo, digest, image) { repo.blobs[digest] = { kind: 'manifest', platform: platOf(image.arch), image: image }; }
  function addIndex(repo, tagSeed, images) {
    var idx = digestOf('idx:' + tagSeed), mans = [];
    images.forEach(function (im) { var dg = digestOf('man:' + im.id); addManifest(repo, dg, im); mans.push({ digest: dg, platform: platOf(im.arch) }); });
    images.forEach(function (im) { mans.push({ digest: digestOf('att:' + im.id), platform: 'unknown/unknown', ref: digestOf('man:' + im.id) }); });
    repo.blobs[idx] = { kind: 'index', manifests: mans };
    return idx;
  }
  function installLocal(d, image, refs, repoDigest) {
    var im = SIM().clone(image); im.repoTags = []; im.repoDigests = repoDigest ? [repoDigest] : [];
    d.images[im.id] = im;
    refs.forEach(function (r) { setTag(d, r, im.id); });
    return im;
  }
  function dockerState(seed, extra) {
    return Object.assign({ hostArch: 'arm64', hostIp: '10.0.5.20', hostName: 'beacon-dev', binfmt: [], images: {}, tags: {}, registry: {}, containers: [], networks: [],
      dir: '/home/lab/beacon', sourceVersion: '1.4.1', seq: 0, reachable: null }, extra || {});
  }
  function dockerWorld(state, files, extraVerbs) {
    var S = SIM();
    var verbs = { docker: dockerVerb(state), curl: hostCurl(state), ss: hostSs(state), nsenter: nsenterVerb(state), file: fileVerb(), edit: S.verbs.edit() };
    Object.keys(extraVerbs || {}).forEach(function (k) { verbs[k] = extraVerbs[k]; });
    return { user: 'lab', host: 'beacon-dev', cwd: '/home/lab/beacon', arch: 'aarch64', os: 'Linux', kernel: '6.8.0-45-generic', ip: '10.0.5.20',
      dirs: [{ path: '/home/lab/beacon/beacon' }, { path: '/tmp' }], files: files, sre: state, extra: S.bind(state, verbs) };
  }
  function filesMap(files) { var m = {}; files.forEach(function (f) { m[f.path] = f.content; }); return function (p) { return m[p] == null ? null : m[p]; }; }
  /* bring the compose project up at world build, from the very files the learner sees */
  function bootCompose(s, files, at) {
    var sp = composeSpec(s.dk.dir, filesMap(files));
    var img = localImage(s.dk, sp.image);
    s.dk.networks.push(sp.net);
    var c = createCtr(s, { name: sp.project + '-api-1', ref: sp.image, imageId: img.id, env: sp.env, ports: sp.ports, net: sp.net, privileged: sp.privileged,
      compose: { project: sp.project, service: 'api' }, hash: specHash(sp, img.id), at: at });
    startCtr(s, c, at);
    return c;
  }
  var UNSAFE_RUNTIME = function (d) { return d.containers.some(function (c) { return c.status === 'running' && (c.net === 'host' || c.privileged); }); };

  var DOCKER_GRAMMAR = [
    '`docker ps [-a]`, `docker logs NAME`, `docker port NAME`, `docker inspect [-f \'{{…}}\'] NAME|IMAGE`, `docker exec NAME ss -lnt|curl URL|env`',
    '`docker compose ps [-a]|up -d [--force-recreate]|logs [api]|config|port api PORT|exec api CMD|restart|down`',
    '`docker run [-d] [--rm] [--name N] [-p H:C] [-e K=V] [--env-file F] [--network host] [--privileged] [--platform P] [--entrypoint X] IMAGE [ARGS]`, `docker rm [-f]`, `docker create`, `docker cp CTR:/path DEST`',
    '`docker images`, `docker pull [--platform P] REF`, `docker image inspect [--format \'{{.Architecture}}\'] REF`, `docker manifest inspect [-v] REF`, `docker buildx imagetools inspect REF`, `docker buildx build --platform P -t TAG --load .`, `docker info`, `docker version`',
    '`curl [-sS] [-i] [-v] [-o /dev/null -w \'%{http_code}\'] http://localhost:8080/PATH`, `ss -lnt[p]`, `nsenter -t PID -n ss -lnt`, `file PATH`, `uname -m`, `cat`, `sed -i`, `edit FILE KEY VALUE`'
  ];
  var DOCKER_SIMPLIFIED = [
    'One Docker host, one Compose project with one service, and a logical clock: every command advances time by 10 seconds.',
    'The engine is modelled as far as images, tags, digests, manifests and indexes, containers, published ports (through docker-proxy), the container network namespace and its listening sockets; there are no volumes, no user-defined networks beyond the project default, no image layers you can inspect.',
    'Container processes are Beacon or a few one-off tools; `docker exec` runs only ss, netstat, curl, env, cat /etc/hosts, hostname and id. The lab image includes curl and iproute2 for debugging; the L13 production image does not, which is why nsenter is also supported.',
    'Only the documented command set is supported; anything else says so rather than pretending to work.'
  ];

  /* ═══ S13 · Container is running but unreachable ═══════════════════ */
  LX.missions.push({
    id: 'sre-s13', track: 'sre', cat: 'scenario', level: 'intermediate', mins: 20, kind: 'incident',
    title: 'Beacon container is up, but the host gets no answer on port 8080',
    brief: function () { return 'The Beacon dev stack on beacon-dev is managed with docker compose in /home/lab/beacon. Since this morning\'s change to the stack, `docker compose ps` shows the api container up, but every request from the host to http://localhost:8080 fails. Nobody changed the image. Make Beacon reachable from the host the way the stack is meant to run, and explain what was wrong.'; },
    keys: ['docker compose ps', 'curl -sS http://localhost:8080/healthz', 'docker port looped-api-1', 'docker inspect looped-api-1', 'docker exec looped-api-1 ss -lnt', 'docker compose logs api', 'cat compose.yaml', 'cat beacon.env', 'docker compose up -d', 'ss -ltnp'],
    world: function (seed) {
      var S = SIM(), v = S.variantOf(seed, ['a', 'b', 'c']);
      var state = { clock: 0, risky: [], seed: seed, variant: v, hooks: [], dk: dockerState(seed) };
      var d = state.dk;
      var ver = v === 'c' ? '1.5.0-rc1' : '1.4.0';
      var img = beaconImage('s13:' + ver, { arch: 'arm64', version: ver, ipv6: v === 'c', created: '2026-10-12T16:40:11Z' });
      var repo = d.registry['registry.lab/beacon/api'] = { tags: {}, blobs: {} };
      var amd = beaconImage('s13:' + ver + ':amd64', { arch: 'amd64', version: ver, ipv6: v === 'c' });
      repo.tags[ver] = addIndex(repo, 's13' + ver, [amd, img]);
      installLocal(d, img, ['registry.lab/beacon/api:' + ver], 'registry.lab/beacon/api@' + repo.tags[ver]);
      var compose = '# Beacon dev stack on beacon-dev (see labs/sre-cloud-foundations/L13)\nname: looped\nservices:\n  api:\n    image: registry.lab/beacon/api:' + ver + '\n    env_file: beacon.env\n    ports:\n      - "8080:' + (v === 'b' ? '80' : '8080') + '"\n    restart: unless-stopped\n';
      var envf = '# Runtime settings for the api container.\n# BEACON_<SECTION>_<KEY> overrides beacon.yaml inside the image.\nBEACON_SERVER_LISTEN=' + (v === 'a' ? '127.0.0.1' : v === 'c' ? '::' : '0.0.0.0') + '\nBEACON_SERVER_PORT=8080\nBEACON_STORE_KIND=memory\nBEACON_APP_ENVIRONMENT=lab\n';
      var notes = '# Change log for the dev stack\n- 08:40 ' + (v === 'a' ? 'beacon.env: copied the server settings from the VM deployment (L03) so both match' : v === 'b' ? 'compose.yaml: tidied the ports section to match the image docs' : 'compose.yaml: moved to the 1.5.0-rc1 image; beacon.env: listen on all addresses for IPv6 testing') + '\n- 08:42 docker compose up -d\n';
      var files = [{ path: '/home/lab/beacon/compose.yaml', content: compose }, { path: '/home/lab/beacon/beacon.env', content: envf }, { path: '/home/lab/beacon/CHANGES.md', content: notes }];
      bootCompose(state, files, -840);
      return dockerWorld(state, files);
    },
    objectives: [
      { id: 'symptom', stage: 'evidence', text: 'Show that the container is up while a request from the host still fails, and how it fails',
        hint: 'Two facts that seem to contradict each other are the starting point: the runtime says up, the client says no.',
        hint2: '`docker compose ps` for the container state, then a curl from the host with -sS so the error is printed.',
        reveal: 'docker compose ps && curl -sS http://localhost:8080/healthz',
        done: function (c) { return saw(c, /docker\s+(compose\s+)?ps\b/, /\bUp \d|\bUp About|\bUp Less/) && saw(c, /curl\b/, /Connection reset by peer|Recv failure|Couldn't connect to server|Empty reply/); } },
      { id: 'mapping', stage: 'evidence', text: 'Establish which container port the host port 8080 is mapped to',
        hint: 'A published port is a mapping with two ends. Which two?',
        hint2: '`docker port NAME` or `docker inspect NAME` (NetworkSettings.Ports) shows host side and container side.',
        reveal: 'docker port looped-api-1',
        done: function (c) { return saw(c, /docker\s+(port|inspect|container\s+inspect|compose\s+port)\b/, /\d+\/tcp\s*->\s*(0\.0\.0\.0|\[::\]):\d+|"HostPort"|^0\.0\.0\.0:\d+$|\d+\/tcp:\[\{/m); } },
      { id: 'socket', stage: 'evidence', text: 'Find the address and port the Beacon process is actually listening on inside the container',
        hint: 'The mapping only helps if something listens where it points. Look from inside the container\'s network namespace, not from the host.',
        hint2: '`docker exec looped-api-1 ss -lnt` (or `nsenter -t PID -n ss -lnt`, or the startup line in the logs).',
        reveal: 'docker exec looped-api-1 ss -lnt',
        done: function (c) { return saw(c, /docker\s+(exec|container\s+exec|compose\s+exec)\b.*\b(ss|netstat)\b|nsenter\b.*\b(ss|netstat)\b/, /LISTEN/) || saw(c, /docker\s+(compose\s+)?logs\b/, /listening on/); } },
      { id: 'fix', stage: 'fix', text: 'Correct the stack definition so the published port reaches the listening socket, and recreate the container from it',
        hint: 'Fix where the setting is defined, not the running container: the next `up` must not undo it. A restart keeps a container\'s old settings.',
        hint2: 'Edit beacon.env or compose.yaml (sed -i or edit), then `docker compose up -d` so Compose recreates the container.',
        reveal: function (c) {
          var v = st(c).variant;
          if (v === 'b') return "sed -i 's/\"8080:80\"/\"8080:8080\"/' compose.yaml && docker compose up -d";
          return "sed -i 's/^BEACON_SERVER_LISTEN=.*/BEACON_SERVER_LISTEN=0.0.0.0/' beacon.env && docker compose up -d";
        },
        done: function (c) { var s = st(c), cur = composeCtr(s.dk), h = hostReach(s, 'localhost', 8080); return composeCurrent(s, c.w) && !UNSAFE_RUNTIME(s.dk) && !!h.ok && h.c === cur; } },
      { id: 'verify', stage: 'verify', text: 'Verify from the host that Beacon answers on http://localhost:8080',
        hint: '"Up" and "healthy" were true before the fix. Ask the user path.',
        hint2: '`curl -i http://localhost:8080/healthz` from the host.',
        reveal: 'curl -i http://localhost:8080/healthz',
        done: function (c) { var s = st(c); return composeCurrent(s, c.w) && !!hostReach(s, 'localhost', 8080).ok && lastIs(c, /curl\b.*(localhost|127\.0\.0\.1|10\.0\.5\.20|beacon-dev|\[::1\]):8080/, /200 OK|^ok$|"version"|"ready": true|^200$/m) && lastCode(c) === 0; } }
    ],
    sre: {
      scenarioId: 'S13', moduleId: 'M07', lab: 'L13', variants: ['a', 'b', 'c'],
      symptom: 'docker compose ps shows the api container Up, but every request from the host to localhost:8080 fails.',
      neutralTitle: 'Beacon dev container up but not answering from the host',
      neutralBrief: 'On beacon-dev the Beacon api container is reported as running by docker compose, but requests from the host to http://localhost:8080 fail since a change to the stack this morning. The image did not change. Make Beacon answer from the host as the stack intends and explain the cause.',
      impact: 'Every developer and test client on beacon-dev is blocked; the container looks healthy to anyone who only checks docker ps.',
      changes: 'A small edit to the dev stack files at 08:40 and a `docker compose up -d` at 08:42 (see CHANGES.md).',
      spoilers: ['127.0.0.1', 'loopback', 'bind', 'listen', 'ipv6', 'container port', 'publish', '8080:80'],
      tools: ['docker (ps, port, inspect, logs, exec, run, rm)', 'docker compose (ps, up -d, logs, config, port, exec, down)', 'curl', 'ss', 'nsenter', 'cat', 'sed -i', 'edit'],
      grammar: DOCKER_GRAMMAR,
      palette: ['docker compose ps', 'curl -sS http://localhost:8080/healthz', 'docker port looped-api-1', 'docker inspect -f \'{{json .NetworkSettings.Ports}}\' looped-api-1', 'docker exec looped-api-1 ss -lnt', 'docker exec looped-api-1 curl -s http://127.0.0.1:8080/healthz', 'docker compose logs api', 'docker compose config', 'ss -ltnp', 'docker compose up -d'],
      assumptions: ['You are on beacon-dev (Linux arm64) as a user in the docker group.', 'The stack is meant to run on the default project network with port 8080 published; it is not meant to share the host network.', 'The lab image adds curl and iproute2 for debugging.'],
      simplified: DOCKER_SIMPLIFIED.concat(['Variant c models a Beacon release candidate that binds an IPv6 socket with IPV6_V6ONLY set when told to listen on "::"; the course starter binds IPv4 only.']),
      unsafe: [
        { label: 'ran Beacon on the host network', why: '`--network host` (or network_mode: host) removes the container\'s network isolation and the port mapping altogether; with a loopback listen address it even "works" from the host while still being unreachable from anywhere else. It hides the cause instead of fixing it.',
          test: function (c) { return st(c).dk.containers.some(function (x) { return x.status === 'running' && x.net === 'host'; }); },
          demo: function (c, v) { return ['docker compose down', 'docker run -d --name looped-api-hostnet --network host --env-file beacon.env registry.lab/beacon/api:' + (v === 'c' ? '1.5.0-rc1' : '1.4.0')]; } },
        { label: 'ran Beacon privileged', why: '`--privileged` gives the container every capability and all host devices. It has nothing to do with which address a process listens on, and it turns any bug in Beacon into a host compromise.',
          test: function (c) { return st(c).dk.containers.some(function (x) { return x.status === 'running' && x.privileged; }); },
          demo: function (c, v) { return ['docker compose down', 'docker run -d --name looped-api-priv --privileged -p 8080:8080 --env-file beacon.env registry.lab/beacon/api:' + (v === 'c' ? '1.5.0-rc1' : '1.4.0')]; } }
      ],
      alt: function (v) {
        if (v === 'a') return ['docker ps', 'curl -v http://127.0.0.1:8080/healthz', 'docker inspect -f \'{{json .NetworkSettings.Ports}}\' looped-api-1',
          function (c) { return 'nsenter -t ' + composeCtr(st(c).dk).pid + ' -n ss -ltn'; }, 'cat beacon.env', 'edit beacon.env BEACON_SERVER_LISTEN 0.0.0.0', 'docker compose up -d --force-recreate', 'curl -s http://localhost:8080/version'];
        if (v === 'b') return ['docker compose ps', 'curl -sS localhost:8080/ready', 'docker inspect looped-api-1', 'docker compose logs api', 'docker exec looped-api-1 curl -s http://127.0.0.1:8080/healthz',
          "sed -i 's/8080:80\"/8080:8080\"/' compose.yaml", 'docker compose config', 'docker compose up -d', 'curl -i http://localhost:8080/healthz'];
        return ['docker compose ps', 'curl -v http://localhost:8080/healthz', 'docker port looped-api-1', 'docker exec looped-api-1 ss -ltnp', 'docker exec looped-api-1 curl -s http://[::1]:8080/healthz',
          'edit beacon.env BEACON_SERVER_LISTEN 0.0.0.0', 'docker compose up -d', 'curl -s localhost:8080/healthz'];
      },
      mechanism: 'Publishing `8080:C` makes Docker (docker-proxy and NAT rules) forward host port 8080 to **port C on the container\'s own network interface** (172.18.0.x). The request then needs a socket listening on that interface and port. Depending on the seed: (a) Beacon was told `BEACON_SERVER_LISTEN=127.0.0.1`, so it listens only on the container\'s loopback — correct for a process behind a local proxy on a VM, wrong inside a container, where loopback is private to the container; (b) the mapping pointed at container port 80 while Beacon listens on 8080; (c) Beacon listened on `[::]` with IPV6_V6ONLY, so IPv4 traffic forwarded to 172.18.0.x had nothing to reach (note that `ss` shows a dual-stack socket as `*:8080` and an IPv6-only one as `[::]:8080`). In every case docker-proxy accepts on the host, fails to reach the backend and resets the connection (curl exit 56), while the container is "Up" and even "healthy" in (a) and (b), because the image\'s HEALTHCHECK calls 127.0.0.1:8080 from inside. The fix is in the definition: listen on 0.0.0.0 (or publish to the right container port) and recreate with `docker compose up -d` — a restart keeps the old environment.',
      alternatives: [
        { h: 'A host firewall blocks 8080', out: 'Ruled out: `ss -ltnp` on the host shows docker-proxy listening on 8080 and the connection is accepted then reset; a firewall drop would time out, a reject would refuse before connecting.' },
        { h: 'Beacon is crashing', out: 'Ruled out: the container is Up, the logs end with a listening line, and curl from inside the container (to the address it listens on) returns 200.' },
        { h: 'The image is broken', out: 'Ruled out: the image did not change and the in-container request succeeds; the fault is in how the stack wires the port to the process.' }
      ],
      clues: ['"(healthy)" in docker ps only means the HEALTHCHECK passed from inside the container — it says nothing about reachability from the host.', 'CHANGES.md is a hint about when, not proof of what.'],
      passRubric: ['Explains that a published port forwards to the container\'s interface address, not to its loopback', 'Names the exact mismatch with evidence (ss inside vs docker port)', 'Fixes the definition and explains why recreate, not restart, applies it', 'Rejects host networking/privileged as fixes and says why', 'Verifies from the host, not from inside the container'],
      prereqs: ['les-m07-01', 'les-m07-03'], refs: ['T16', 'T06']
    }
  });

  /* ═══ S14 · Works on another laptop but the image will not start ═══ */
  function s14Dockerfile(v) {
    return '# syntax=docker/dockerfile:1\n# Beacon image as built by CI for linux/amd64 and linux/arm64.\n' +
      (v === 'b' ? '# 2026-09-30: pinned the init stage to amd64 because the arm64 runner was flaky\nFROM --platform=linux/amd64 registry.lab/tools/tini:0.19.0 AS init\n' : 'FROM registry.lab/tools/tini:0.19.0 AS init\n') +
      '\nFROM python:3.12.7-slim-bookworm\nCOPY requirements.txt /tmp/requirements.txt\nRUN pip install --no-cache-dir --require-hashes -r /tmp/requirements.txt && rm /tmp/requirements.txt\nCOPY --from=init /tini /usr/local/bin/tini\nRUN groupadd --gid 10001 beacon && useradd --uid 10001 --gid 10001 --home /app --shell /usr/sbin/nologin beacon\nWORKDIR /app\nCOPY --chown=beacon:beacon beacon/ /app/beacon/\nCOPY --chown=beacon:beacon beacon.yaml /app/beacon.yaml\nUSER 10001:10001\nENV PYTHONUNBUFFERED=1 BEACON_CONFIG=/app/beacon.yaml BEACON_STORE_KIND=memory\nEXPOSE 8080\n# tini is PID 1 and forwards SIGTERM to Beacon\nENTRYPOINT ["/usr/local/bin/tini", "--", "python3", "-m", "beacon"]\nCMD ["api"]\n';
  }
  function s14Fixed(c) {
    var s = st(c), d = s.dk, cur = composeCtr(d);
    if (!composeCurrent(s, c.w) || !cur || cur.emulated) return false;
    var img = d.images[cur.imageId];
    if (img.arch !== d.hostArch || img.entryArch !== d.hostArch || img.version !== '1.4.1') return false;
    if (s.variant === 'b' && /^FROM\s+--platform=linux\/amd64\s+\S*tini/mi.test(SIM().readFile(c.w, '/home/lab/beacon/Dockerfile') || '')) return false;
    return !!hostReach(s, 'localhost', 8080).ok;
  }
  LX.missions.push({
    id: 'sre-s14', track: 'sre', cat: 'scenario', level: 'intermediate', mins: 25, kind: 'incident',
    title: 'Beacon 1.4.1 runs on a teammate\'s laptop but will not start on beacon-dev',
    brief: function () { return 'A teammate tested Beacon 1.4.1 on their laptop and says the image "works fine". On beacon-dev (your Linux VM, /home/lab/beacon) `docker compose up -d` reports the api container started, yet it is not running and nothing answers on port 8080. Someone in the channel suggests adding a nodeSelector "like we do in the cluster". Get 1.4.1 running properly on beacon-dev and explain why the two machines behave differently.'; },
    keys: ['docker compose ps -a', 'docker compose logs api', 'uname -m', 'docker image inspect --format \'{{.Architecture}}\' ', 'docker buildx imagetools inspect ', 'docker manifest inspect -v ', 'cat compose.yaml', 'cat Dockerfile', 'docker buildx build --platform linux/arm64 -t ', 'curl -s http://localhost:8080/version'],
    world: function (seed) {
      var S = SIM(), v = S.variantOf(seed, ['a', 'b']);
      var state = { clock: 0, risky: [], seed: seed, variant: v, hooks: [], dk: dockerState(seed) };
      var d = state.dk;
      var repo = d.registry['registry.lab/beacon/api'] = { tags: {}, blobs: {} };
      var old64 = beaconImage('s14:1.4.0:arm64', { arch: 'arm64', version: '1.4.0', tini: true }), old86 = beaconImage('s14:1.4.0:amd64', { arch: 'amd64', version: '1.4.0', tini: true });
      repo.tags['1.4.0'] = addIndex(repo, 's14-1.4.0', [old86, old64]);
      /* CI's 1.4.1 index: in variant b its arm64 image carries an amd64 tini */
      var ci86 = beaconImage('s14:1.4.1:amd64:' + v, { arch: 'amd64', version: '1.4.1', tini: true });
      var ci64 = beaconImage('s14:1.4.1:arm64:' + v, { arch: 'arm64', entryArch: v === 'b' ? 'amd64' : 'arm64', version: '1.4.1', tini: true });
      repo.tags['1.4.1'] = addIndex(repo, 's14-1.4.1-' + v, [ci86, ci64]);
      var ref;
      if (v === 'a') {
        /* the teammate's laptop build, pushed by hand: one manifest, amd64 only */
        var dev = beaconImage('s14:1.4.1-dev', { arch: 'amd64', version: '1.4.1', tini: true, created: '2026-10-13T07:58:02Z' });
        var devDigest = digestOf('man:' + dev.id);
        addManifest(repo, devDigest, dev); repo.tags['1.4.1-dev'] = devDigest;
        installLocal(d, dev, ['registry.lab/beacon/api:1.4.1-dev'], 'registry.lab/beacon/api@' + devDigest);
        ref = 'registry.lab/beacon/api:1.4.1-dev';
      } else {
        installLocal(d, ci64, ['registry.lab/beacon/api:1.4.1'], 'registry.lab/beacon/api@' + repo.tags['1.4.1']);
        ref = 'registry.lab/beacon/api:1.4.1';
      }
      installLocal(d, old64, ['registry.lab/beacon/api:1.4.0'], 'registry.lab/beacon/api@' + repo.tags['1.4.0']);
      var tools = d.registry['registry.lab/tools/binfmt'] = { tags: {}, blobs: {} };
      var binfmt = { id: 'sha256:' + hex('binfmt', 64), arch: 'arm64', entryArch: 'arm64', entryPath: '/usr/bin/binfmt', app: 'binfmt', version: 'qemu-v9.2.2', env: [], entrypoint: ['/usr/bin/binfmt'], cmd: [], repoTags: [], repoDigests: [], size: '69.6MB', files: {} };
      tools.tags['qemu-v9.2.2'] = addIndex(tools, 'binfmt', [binfmt]);
      installLocal(d, binfmt, ['registry.lab/tools/binfmt:qemu-v9.2.2'], 'registry.lab/tools/binfmt@' + tools.tags['qemu-v9.2.2']);
      var compose = '# Beacon dev stack on beacon-dev\nname: looped\nservices:\n  api:\n    image: ' + ref + '\n    env_file: beacon.env\n    ports:\n      - "8080:8080"\n';
      var envf = 'BEACON_SERVER_LISTEN=0.0.0.0\nBEACON_SERVER_PORT=8080\nBEACON_STORE_KIND=memory\nBEACON_APP_ENVIRONMENT=lab\n';
      var notes = '# Beacon 1.4.1\n- fixes duplicate idempotency keys under retry\n- CI publishes registry.lab/beacon/api:1.4.1 (pipeline #2291, multi-platform)\n' + (v === 'a' ? '- dev builds for quick testing are pushed by hand as :1.4.1-dev\n' : '');
      var files = [{ path: '/home/lab/beacon/compose.yaml', content: compose }, { path: '/home/lab/beacon/beacon.env', content: envf },
        { path: '/home/lab/beacon/Dockerfile', content: s14Dockerfile(v) }, { path: '/home/lab/beacon/RELEASE.md', content: notes },
        { path: '/home/lab/beacon/requirements.txt', content: 'psycopg[binary]==3.2.3 --hash=sha256:(pinned in the real file)\nredis==5.2.0 --hash=sha256:(pinned in the real file)\n' },
        { path: '/home/lab/beacon/beacon.yaml', content: 'server:\n  listen: 0.0.0.0\n  port: 8080\n' },
        { path: '/home/lab/beacon/beacon/__init__.py', content: '__version__ = "1.4.1"\n' }];
      bootCompose(state, files, -600);
      return dockerWorld(state, files);
    },
    objectives: [
      { id: 'symptom', stage: 'evidence', text: 'Find out what happens when the container tries to start',
        hint: 'compose said "Started". What did the process inside say before it went away?',
        hint2: '`docker compose ps -a` for the exit code, `docker compose logs api` (or `docker logs looped-api-1`) for the last words.',
        reveal: 'docker compose logs api',
        done: function (c) { return saw(c, /docker\s+(compose\s+)?(logs|start\b.*-a|run)\b|docker\s+container\s+logs/, /exec format error/); } },
      { id: 'host', stage: 'evidence', text: 'Establish what kind of machine this Docker host is',
        hint: 'The same image file behaves differently on two machines. What is different about the machines?',
        hint2: '`uname -m`, or `docker version` / `docker info` (OS/Arch, Architecture).',
        reveal: 'uname -m',
        done: function (c) { return saw(c, /uname\b|docker\s+(info|version)\b|arch\b/, /aarch64|arm64/); } },
      { id: 'artifact', stage: 'evidence', text: 'Show what the image actually contains for this machine, down to the program that fails',
        hint: 'An image reference can name one build or a list of builds. Find out which this is, and which build you got.',
        hint2: 'Platform: `docker image inspect --format \'{{.Architecture}}\' REF`, `docker manifest inspect -v REF`, `docker buildx imagetools inspect REF`. The program itself: copy it out (`docker create`, `docker cp`) and run `file` on it.',
        reveal: function (c) {
          return st(c).variant === 'a' ? "docker image inspect --format '{{.Os}}/{{.Architecture}}' registry.lab/beacon/api:1.4.1-dev"
            : "docker image inspect --format '{{.Architecture}}' registry.lab/beacon/api:1.4.1 && docker create --name looped-probe registry.lab/beacon/api:1.4.1 && docker cp looped-probe:/usr/local/bin/tini /tmp/tini && file /tmp/tini";
        },
        done: function (c) {
          var plat = /docker\s+(image\s+inspect|inspect|manifest\s+inspect|buildx\s+imagetools\s+inspect)\b/;
          if (st(c).variant === 'a') return saw(c, plat, /^linux\/amd64$|^amd64$|"Architecture": "amd64"|"architecture": "amd64"/m);
          return saw(c, plat, /^arm64$|"Architecture": "arm64"|"architecture": "arm64"|Platform:\s+linux\/arm64/m) && saw(c, /file\b/, /x86-64/);
        } },
      { id: 'fix', stage: 'fix', text: 'Run a 1.4.1 image built for this machine, started by the stack definition, without emulation',
        hint: 'Either use a published build that contains this machine\'s platform, or build one for it — and make sure every program in it was built for that platform too.',
        hint2: 'Point compose.yaml at the right reference (a multi-platform index, by digest) or build with `docker buildx build --platform linux/arm64 … --load .` after fixing anything in the Dockerfile that forces the wrong platform; then `docker compose up -d`.',
        reveal: function (c) {
          var s = st(c);
          if (s.variant === 'a') return "sed -i 's#image: registry.lab/beacon/api:1.4.1-dev#image: registry.lab/beacon/api:1.4.1@" + s.dk.registry['registry.lab/beacon/api'].tags['1.4.1'] + "#' compose.yaml && docker compose up -d";
          return "sed -i 's#^FROM --platform=linux/amd64 #FROM #' Dockerfile && docker buildx build --platform linux/arm64 -t looped/beacon-api:1.4.1-local --load . && sed -i 's#image: registry.lab/beacon/api:1.4.1$#image: looped/beacon-api:1.4.1-local#' compose.yaml && docker compose up -d";
        },
        done: function (c) { return s14Fixed(c); } },
      { id: 'verify', stage: 'verify', text: 'Verify from the host that Beacon 1.4.1 answers',
        hint: 'A container that stays up is not yet a working service. Which version answers?',
        hint2: '`curl -s http://localhost:8080/version`.',
        reveal: 'curl -s http://localhost:8080/version',
        done: function (c) { return s14Fixed(c) && lastIs(c, /curl\b.*:8080\/version/, /"version": "1\.4\.1"/) && lastCode(c) === 0; } }
    ],
    sre: {
      scenarioId: 'S14', moduleId: 'M07', lab: 'L13', variants: ['a', 'b'],
      symptom: 'docker compose up -d reports Started; the container is Exited a second later and port 8080 never answers. The same image reference works on a teammate\'s laptop.',
      neutralTitle: 'Image works for a teammate but will not start on beacon-dev',
      neutralBrief: 'Beacon 1.4.1 runs on a teammate\'s laptop. On beacon-dev, docker compose reports the api container started, but it does not stay running and nothing answers on 8080. Get 1.4.1 running properly on beacon-dev and explain why the two machines differ.',
      impact: 'Nobody can test 1.4.1 on the shared dev VM; the release is blocked on a "works for me".',
      changes: 'compose.yaml moved to 1.4.1 this morning.',
      spoilers: ['architecture', 'arm64', 'amd64', 'x86', 'platform', 'emulat', 'exec format', 'manifest', 'tini'],
      tools: ['docker (ps, logs, image inspect, manifest inspect, buildx imagetools inspect, buildx build, create, cp, pull, run, info, version)', 'docker compose', 'uname', 'file', 'cat', 'sed -i', 'curl'],
      grammar: DOCKER_GRAMMAR,
      palette: ['docker compose ps -a', 'docker compose logs api', 'uname -m', 'docker version', 'docker image inspect --format \'{{.Architecture}}\' registry.lab/beacon/api:1.4.1', 'docker manifest inspect -v registry.lab/beacon/api:1.4.1', 'docker buildx imagetools inspect registry.lab/beacon/api:1.4.1', 'cat Dockerfile', 'docker buildx build --platform linux/arm64 -t looped/beacon-api:1.4.1-local --load .', 'curl -s http://localhost:8080/version'],
      assumptions: ['beacon-dev is a Linux arm64 VM (Apple silicon host); the teammate\'s laptop is x86-64.', 'There is no Kubernetes involved here: compose runs the container directly on this host.', 'CI is the source of published images; local builds are for testing on this host.'],
      simplified: DOCKER_SIMPLIFIED.concat(['Image builds read the Dockerfile and model only what decides the result here: the target platform, a platform pinned on a build stage, and whether RUN steps can execute. Multi-platform builds and pushes are left to CI and the L13 lab.']),
      unsafe: [
        { label: 'made it start by emulating the other CPU', why: 'Installing qemu/binfmt so the wrong-architecture program runs under emulation makes the container start, but it runs slowly, differently from production, and leaves the published artifact broken for every arm64 host. Emulation is a deliberate, stated choice for builds or a one-off test — not the fix for a wrong artifact.',
          test: function (c) { return st(c).dk.containers.some(function (x) { return x.status === 'running' && x.emulated; }); },
          demo: ['docker run --privileged --rm registry.lab/tools/binfmt:qemu-v9.2.2 --install amd64', 'docker compose up -d --force-recreate'] }
      ],
      alt: function (v) {
        if (v === 'a') return ['docker compose ps -a', 'docker logs looped-api-1', 'docker version', 'docker manifest inspect -v registry.lab/beacon/api:1.4.1-dev', 'docker buildx imagetools inspect registry.lab/beacon/api:1.4.1',
          'docker buildx build --platform linux/arm64 -t registry.lab/beacon/api:1.4.1-dev --load .', 'docker compose up -d --force-recreate', 'curl -s http://localhost:8080/version'];
        return ['docker ps -a', 'docker logs looped-api-1', 'docker info --format \'{{.Architecture}}\'', 'docker buildx imagetools inspect registry.lab/beacon/api:1.4.1', 'docker run --rm --entrypoint uname registry.lab/beacon/api:1.4.1 -m',
          'cat Dockerfile', 'docker create --name looped-copy registry.lab/beacon/api:1.4.1', 'docker cp looped-copy:/usr/local/bin/tini /tmp/', 'file /tmp/tini', 'docker rm looped-copy',
          "sed -i 's#--platform=linux/amd64 ##' Dockerfile", 'docker build -t registry.lab/beacon/api:1.4.1-fixed .', "sed -i 's#api:1.4.1$#api:1.4.1-fixed#' compose.yaml", 'docker compose up -d', 'curl -i http://localhost:8080/version'];
      },
      mechanism: 'A container is a process run by the host kernel, so every program in the image must be built for the host\'s CPU. beacon-dev is arm64; the teammate\'s laptop is x86-64 (amd64). When the kernel is asked to execute an x86-64 binary on arm64 with no emulator registered, `execve` fails with **exec format error**, the container exits 255, and compose still printed "Started" because the start call itself succeeded. Depending on the seed: (a) the reference in compose.yaml was a hand-pushed dev build — a single **manifest** for linux/amd64, not an index — so Docker pulled the only build there was (with a platform-mismatch warning) and none of its programs can run here, starting with the entrypoint `tini`; CI\'s `1.4.1` tag is an **index** with an arm64 entry, so pinning that index by digest, or rebuilding locally with `--platform linux/arm64`, fixes it. (b) the reference was CI\'s multi-platform index and the arm64 image really is arm64 — but the Dockerfile pinned the `init` stage to `linux/amd64`, so the `tini` binary copied into every image (and used as ENTRYPOINT) is x86-64; `file` on the copied binary shows it. Rebuilding without the pin fixes this host; the Dockerfile fix in CI fixes everyone. Kubernetes scheduling (nodeSelector) is irrelevant: there is no scheduler here, and on a cluster a nodeSelector would only move the pod to an amd64 node rather than fix the artifact.',
      alternatives: [
        { h: 'Add a nodeSelector / it is a scheduling problem', out: 'Rejected: compose runs the container directly on this host; there is no scheduler. Even on Kubernetes a nodeSelector for amd64 would hide a broken arm64 artifact.' },
        { h: 'The 1.4.1 code crashes', out: 'Ruled out: Python never started — the error is from the kernel exec, before any Beacon log line; the same code runs once the binary matches the CPU.' },
        { h: 'File permissions on the entrypoint', out: 'Ruled out: that would be "permission denied", not "exec format error".' }
      ],
      clues: ['The platform-mismatch WARNING in compose output (variant a) is the runtime telling you what it pulled.', 'In variant b, `docker image inspect` truthfully says arm64 — the image metadata describes the base, not every binary copied into it.'],
      passRubric: ['Connects exec format error to a binary built for a different CPU than the host', 'Distinguishes a single-platform manifest from a multi-platform index with evidence', 'Finds what is actually mismatched (the whole image in a, only the copied tini binary in b) rather than stopping at image metadata', 'Rejects emulation and nodeSelector as fixes and says why', 'Verifies the running version from the host'],
      prereqs: ['les-m07-01', 'les-m07-05'], refs: ['T06', 'T16']
    }
  });

  /* ═══ Kubernetes worlds (S15, S16) ═══════════════════════════════════ */
  var K8S_SIMPLIFIED = [
    'One namespace (beacon) on a kind-like cluster with a logical clock: every command advances time by 10 seconds, so waiting means running another read-only command.',
    'Controllers are simplified: first-fit scheduling, no informer lag, no watch; image pulls succeed or fail by the rules stated in the debrief, with exponential back-off.',
    'The network is modelled only as far as Service names, ports and ready endpoints; `kubectl exec … -- curl` runs from inside the pod. port-forward, edit and apply for Deployments are not modelled — use set, patch and rollout.',
    'Only the documented command set is supported; anything else says so rather than pretending to work.'
  ];
  var K8S_GRAMMAR = [
    '`kubectl get pods|deploy|rs|svc|endpoints|events|cm|secrets|sa [NAME] [-o wide|yaml|json|jsonpath=…]`, `kubectl describe pod|deploy|svc|cm NAME`, `kubectl logs POD|deploy/NAME [--previous]`',
    '`kubectl rollout status|history|undo|restart deploy/beacon-api`, `kubectl set image deploy/beacon-api api=IMAGE`, `kubectl patch deploy|cm|sa NAME -p \'JSON\'`, `kubectl apply -f FILE` (ConfigMap)',
    '`kubectl exec POD|deploy/NAME -- curl -s URL` (localhost inside the pod, or a Service name), `kubectl create secret docker-registry`, `lab-registry list|inspect` (a simulated registry client)'
  ];
  var NODES = function () {
    return [{ name: 'looped-foundations-control-plane', arch: 'arm64', role: 'control-plane', taints: [{ key: 'node-role.kubernetes.io/control-plane', effect: 'NoSchedule' }] },
            { name: 'looped-foundations-worker', arch: 'arm64' }, { name: 'looped-foundations-worker2', arch: 'arm64' }];
  };
  function beaconProfile(version, extra) {
    return Object.assign({ port: 8080, namedPort: 'http', readyPath: '/ready', livePath: '/healthz', startSec: 4, memMi: 70, boot: [],
      runLogs: ['{"level":"info","msg":"starting beacon-api","version":"' + version + '","config_source":"/app/beacon.yaml+env"}', 'beacon-api ' + version + ' listening on 0.0.0.0:8080'],
      http: { '/healthz': 'ok', '/ready': '{"ready": true, "store": "postgres"}', '/version': '{"version": "' + version + '", "environment": "lab"}' } }, extra || {});
  }
  var TOOLBOX = { 'registry.lab/tools/toolbox': { port: 8080, readyPath: '/', livePath: '/', startSec: 1, memMi: 10, boot: ['toolbox: sleeping; use kubectl exec'] } };
  function clientDeployment() {
    return { name: 'beacon-client', replicas: 1, selector: { app: 'beacon-client' }, history: [{ labels: { app: 'beacon-client' }, containers: [{ name: 'client', image: 'registry.lab/tools/toolbox:1.2.0' }] }] };
  }
  function beaconService() { return { name: 'beacon-api', selector: { app: 'beacon-api' }, clusterIP: '10.96.112.40', ports: [{ name: 'http', port: 80, targetPort: 'http' }] }; }
  function k8sDep(c, name) { return KM().find(M(c), 'deployments', name, M(c).ns); }
  function k8sPods(c, app) { return M(c).pods.filter(function (p) { return !p.gone && (p.labels || {}).app === app; }); }
  function readyCount(c, app) { return k8sPods(c, app).filter(function (p) { return KM().podReady(p); }).length; }
  function stuckPod(c) {
    var ps = k8sPods(c, 'beacon-api').filter(function (p) { return !KM().podReady(p); }).sort(function (x, y) { return y.created - x.created; });
    return (ps[0] || k8sPods(c, 'beacon-api')[0] || { name: 'beacon-api' }).name;
  }
  /* A JSON merge patch replaces the whole containers list. The API server
     rejects the result when a container loses its image; the cluster model
     accepts it and then fails on every later command, so the rejection is
     reproduced here before the patch reaches the model. */
  function mergeDropsImage(a) {
    if (a.filter(function (x) { return x.charAt(0) !== '-'; })[0] !== 'patch') return null;
    var ti = a.indexOf('--type'), type = ti !== -1 ? a[ti + 1] : (a.filter(function (x) { return /^--type=/.test(x); })[0] || '').slice(7);
    if (type !== 'merge') return null;
    var pi = a.indexOf('-p') !== -1 ? a.indexOf('-p') : a.indexOf('--patch'), body = null;
    try { body = JSON.parse(a[pi + 1]); } catch (e) { return null; }
    var tpl = body && body.spec && body.spec.template && body.spec.template.spec;
    var name = a.filter(function (x) { return x.charAt(0) !== '-' && x !== 'patch' && !/^(deploy|deployment|deployments)$/.test(x) && x !== a[pi + 1] && x !== type; })[0] || 'beacon-api';
    if (!tpl || !Array.isArray(tpl.containers)) return null;
    for (var i = 0; i < tpl.containers.length; i++) {
      if (!tpl.containers[i].image) return res('', 1, 'The Deployment "' + name.replace(/^.*\//, '') + '" is invalid: spec.template.spec.containers[' + i + '].image: Required value\n(a merge patch replaces the whole containers list; use the default strategic patch to change one field)');
    }
    return null;
  }
  /* kubectl and the registry helper on the scenario clock; `wrapK` adds per-scenario behaviour */
  function kubectlVerbs(state, wrapK) {
    function base(w, a) { var k = LXShell.builtin('kubectl'); return k ? k(w, a) : res('', 1, 'kubectl: not available'); }
    var kubectl = function (w, a) {
      var bad = mergeDropsImage(a);
      if (bad) return bad;
      return wrapK ? wrapK(w, a, base) : base(w, a);
    };
    return {
      kubectl: kubectl, k: kubectl,
      'lab-registry': function (w, a) {
        var r = LXShell.builtin('lab-registry'), m = w.k8sModel;
        if (!r) return res('', 1, 'lab-registry: not available');
        /* the helper describes itself as listing reachable registries; the
           model lists every reference it knows, so hide unreachable hosts */
        var reach = m && m.reachable;
        function hostOk(ref) { var h = String(ref).split('/')[0]; return !reach || reach.indexOf(h) !== -1; }
        if (reach && a[0] === 'inspect' && a[1] && !hostOk(a[1])) { KM().advance(m, KM().PER_COMMAND); return res('', 1, 'lab-registry inspect: ' + a[1] + ': not found in any reachable registry'); }
        var out = r(w, a);
        if (reach && a[0] === 'list' && out.code === 0) {
          var kept = String(out.out || '').split('\n').filter(function (l) { return l && hostOk(l); });
          out = res(kept.length ? kept.join('\n') : '(no images match)');
        }
        return out;
      },
      curl: function (w, a) {
        var cp = curlParse(a), u = parseUrl(cp.url);
        if (!u) return res('', 2, 'curl: no URL specified!');
        return res('', /^10\.96\.|^10\.244\.|svc|beacon-api|cluster\.local/.test(u.host) ? 7 : 6, /^10\.96\.|^10\.244\.|svc|beacon-api|cluster\.local/.test(u.host)
          ? 'curl: (7) Failed to connect to ' + u.host + ' port ' + u.port + ': No route to host\n(simulation: this workstation is outside the cluster network; use kubectl exec deploy/beacon-client -- curl …)'
          : 'curl: (6) Could not resolve host: ' + u.host);
      }
    };
  }
  function k8sWorld(state, k8s, files, wrapK) {
    var S = SIM();
    return { user: 'lab', host: 'looped-ops', cwd: '/home/lab/beacon', files: files, k8sModel: k8s, sre: state,
      extra: S.bind(state, Object.assign(kubectlVerbs(state, wrapK), { edit: S.verbs.edit() })) };
  }

  /* ═══ S15 · Pod in ImagePullBackOff ════════════════════════════════ */
  function pinned(img) { return /@sha256:[0-9a-f]{64}$/.test(img) || /:v?\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(img); }
  function s15Intended(s) {
    var repo = s.variant === 'a' ? 'registry.lab/beacon/api' : s.variant === 'b' ? 'registry.lab/beacon-private/api' : 'registry.lab/mirror/beacon/api';
    return [repo + ':1.4.1', repo + '@' + s.digest141, repo + ':1.4.1@' + s.digest141];
  }
  function s15Fixed(c) {
    var s = st(c), d = k8sDep(c, 'beacon-api');
    if (!d) return false;
    var img = (d.template.containers.filter(function (x) { return x.name === 'api'; })[0] || {}).image;
    if (s15Intended(s).indexOf(img) === -1) return false;
    var pods = k8sPods(c, 'beacon-api');
    return KM().rolloutComplete(M(c), 'beacon-api', M(c).ns) && readyCount(c, 'beacon-api') >= 2 && pods.every(function (p) { return p.containers[0].image === img; });
  }
  LX.missions.push({
    id: 'sre-s15', track: 'sre', cat: 'scenario', level: 'intermediate', mins: 20, kind: 'incident',
    title: 'beacon-api 1.4.1 rollout stuck: the new pods never start',
    brief: function () { return 'The beacon-api 1.4.1 release went out to the beacon namespace on looped-foundations 15 minutes ago and the pipeline is still "waiting for rollout". The previous release is still serving. Finish the release properly — 1.4.1, pinned, from a source this cluster can use — and prove 1.4.1 is what the Service answers with.'; },
    keys: ['kubectl get pods', 'kubectl rollout status deploy/beacon-api', 'kubectl describe pod ', 'kubectl get events --field-selector type=Warning', 'kubectl get deploy beacon-api -o yaml', 'kubectl get secrets', 'lab-registry list registry.lab/', 'kubectl set image deploy/beacon-api api=', 'kubectl exec deploy/beacon-client -- curl -s http://beacon-api/version'],
    world: function (seed) {
      var S = SIM(), v = S.variantOf(seed, ['a', 'b', 'c']);
      var state = { clock: 0, risky: [], seed: seed, variant: v, hooks: [] };
      var repo = v === 'a' ? 'registry.lab/beacon/api' : v === 'b' ? 'registry.lab/beacon-private/api' : 'registry.lab/mirror/beacon/api';
      var oldImage = v === 'c' ? 'registry.lab/mirror/beacon/api:1.4.0' : 'registry.lab/beacon/api:1.4.0';
      var newImage = v === 'a' ? 'registry.lab/beacon/api:v1.4.1' : v === 'b' ? 'registry.lab/beacon-private/api:1.4.1' : 'registry.beacon.example/beacon/api:1.4.1';
      state.digest141 = digestOf('s15:' + repo + ':1.4.1');
      var both = ['amd64', 'arm64'], reg = {};
      function put(ref, dg) { reg[ref] = { arch: both, digest: dg || digestOf('s15:' + ref) }; }
      put(oldImage);
      put(repo + ':1.4.1', state.digest141); put(repo + '@' + state.digest141, state.digest141); put(repo + ':1.4.1@' + state.digest141, state.digest141);
      put(repo + ':1.4', state.digest141); /* a floating minor tag that the registry also serves */
      if (v === 'c') put('registry.beacon.example/beacon/api:1.4.1', state.digest141);
      put('registry.lab/tools/toolbox:1.2.0');
      var apps = Object.assign({}, TOOLBOX);
      [repo, 'registry.lab/beacon/api', 'registry.beacon.example/beacon/api'].forEach(function (r) { apps[r] = beaconProfile('1.4.1'); });
      apps[oldImage] = beaconProfile('1.4.0');
      var tplOld = { labels: { app: 'beacon-api' }, containers: [{ name: 'api', image: oldImage, ports: [{ name: 'http', containerPort: 8080 }], readiness: { path: '/ready', port: 8080, period: 5 }, liveness: { path: '/healthz', port: 8080, initialDelay: 10 } }] };
      var tplNew = S.clone(tplOld);
      tplNew.containers[0].image = newImage;
      if (v === 'b') tplNew.imagePullSecrets = ['regcred'];
      var k8s = { namespace: 'beacon', context: 'kind-looped-foundations', now: 3600, nodes: NODES(), registry: reg, apps: apps,
        registryAuth: v === 'b' ? { 'registry.lab/beacon-private/': 'regcred-beacon' } : {},
        reachable: v === 'c' ? ['registry.lab'] : null,
        secrets: v === 'b' ? [{ name: 'regcred-beacon', type: 'kubernetes.io/dockerconfigjson', data: { '.dockerconfigjson': '(simulated credential for registry.lab — lab-regcred-not-a-real-secret)' } }] : [],
        services: [beaconService()],
        deployments: [{ name: 'beacon-api', replicas: 2, selector: { app: 'beacon-api' }, changedAgo: 900, history: [tplOld, tplNew] }, clientDeployment()] };
      var notes = '# beacon-api 1.4.1\n- fixes duplicate idempotency keys under retry\n- image built and published by CI (pipeline #2291)\n- deployment values updated by the release bot' + (v === 'c' ? ' (chart 0.9.0 defaults)' : '') + '\n';
      return k8sWorld(state, k8s, [{ path: '/home/lab/beacon/RELEASE-1.4.1.md', content: notes }]);
    },
    objectives: [
      { id: 'status', stage: 'evidence', text: 'Establish what state the rollout and its new pods are in',
        hint: 'The pipeline waits on the Deployment; the Deployment waits on pods. What do the new pods say?',
        hint2: '`kubectl get pods` (STATUS column) or `kubectl rollout status deploy/beacon-api`.',
        reveal: 'kubectl get pods',
        done: function (c) { return saw(c, /k(ubectl)?\b.*\b(get\s+(po|pods?)|rollout\s+status|describe\s+(deploy|deployments?|po|pods?)|get\s+(deploy|deployments?))\b/, /ImagePullBackOff|ErrImagePull|exceeded its progress deadline|ProgressDeadlineExceeded/); } },
      { id: 'reason', stage: 'evidence', text: 'Read the exact error the node got when it tried to fetch the image',
        hint: 'The STATUS column is a category. The registry\'s (or the network\'s) actual answer is recorded somewhere else.',
        hint2: 'The pod\'s Events: `kubectl describe pod NAME`, or `kubectl get events`.',
        reveal: function (c) { return 'kubectl describe pod ' + stuckPod(c); },
        done: function (c) {
          var re = { a: /: not found/, b: /401 Unauthorized/, c: /no such host/ }[st(c).variant];
          return saw(c, /k(ubectl)?\b.*\b(describe\s+(po|pods?)|get\s+(events?|ev)|events)\b/, re);
        } },
      { id: 'access', stage: 'evidence', text: 'Check the image source and access path against what the cluster can actually use',
        hint: 'The error says which of three things is wrong: the artifact, the permission to fetch it, or the path to the registry. Check that one directly.',
        hint2: 'Artifacts and registries: `lab-registry list registry.lab/`. Credentials: `kubectl get secrets` and the imagePullSecrets in `kubectl get deploy beacon-api -o yaml`.',
        reveal: function (c) { return st(c).variant === 'b' ? 'kubectl get secrets && kubectl get deploy beacon-api -o yaml' : 'lab-registry list registry.lab/'; },
        done: function (c) {
          var v = st(c).variant;
          if (v === 'a') return saw(c, /lab-registry\s+(list|inspect)\b/, /registry\.lab\/beacon\/api:1\.4\.1\b/);
          if (v === 'c') return saw(c, /lab-registry\s+(list|inspect)\b/, /registry\.lab\/mirror\/beacon\/api:1\.4\.1\b/);
          return saw(c, /k(ubectl)?\b.*\b(get\s+(secrets?)|describe\s+secrets?)\b/, /regcred-beacon/) && saw(c, /k(ubectl)?\b.*\bget\b.*-o\s*=?\s*(yaml|json|jsonpath)/, /regcred(?!-)/);
        } },
      { id: 'fix', stage: 'fix', text: 'Complete the rollout on a pinned 1.4.1 image the nodes can fetch, keeping the access controls in place',
        hint: 'Correct the one thing the event points at; keep the version pinned (a tag like 1.4.1 or a digest).',
        hint2: '`kubectl set image deploy/beacon-api api=REF`, or `kubectl patch deploy beacon-api -p \'{"spec":{"template":{"spec":{"imagePullSecrets":[{"name":"…"}]}}}}\'`; then let the rollout finish.',
        reveal: function (c) {
          var v = st(c).variant;
          if (v === 'a') return 'kubectl set image deploy/beacon-api api=registry.lab/beacon/api:1.4.1';
          if (v === 'c') return 'kubectl set image deploy/beacon-api api=registry.lab/mirror/beacon/api:1.4.1';
          return 'kubectl patch deploy beacon-api -p \'{"spec":{"template":{"spec":{"imagePullSecrets":[{"name":"regcred-beacon"}]}}}}\'';
        },
        done: function (c) { return s15Fixed(c); } },
      { id: 'verify', stage: 'verify', text: 'Verify the rollout finished and the Service answers with 1.4.1',
        hint: 'Ask the Deployment, then ask the user path.',
        hint2: '`kubectl rollout status deploy/beacon-api`, then `kubectl exec deploy/beacon-client -- curl -s http://beacon-api/version`.',
        reveal: 'kubectl rollout status deploy/beacon-api && kubectl exec deploy/beacon-client -- curl -s http://beacon-api/version',
        done: function (c) { return s15Fixed(c) && lastIs(c, /k(ubectl)?\s+exec\b.*\bcurl\b.*beacon-api/, /"version": "1\.4\.1"/) && lastCode(c) === 0; } }
    ],
    sre: {
      scenarioId: 'S15', moduleId: 'M08', lab: 'L15', variants: ['a', 'b', 'c'],
      symptom: 'New beacon-api pods sit in ErrImagePull / ImagePullBackOff; the rollout never completes and the old pods keep serving.',
      neutralTitle: 'beacon-api release not completing',
      neutralBrief: 'The beacon-api 1.4.1 release in the beacon namespace has been "waiting for rollout" for 15 minutes; the previous release is still serving. Finish the release on a pinned 1.4.1 image the cluster can use and prove the Service answers with 1.4.1.',
      impact: 'None yet for users — maxUnavailable 0 kept the old pods — but the release is blocked and the pipeline will fail at its deadline.',
      changes: 'Release bot updated the beacon-api Deployment for 1.4.1 fifteen minutes ago.',
      spoilers: ['not found', 'credential', 'secret', 'egress', 'mirror', 'proxy', '401', 'unauthori', 'no such host', 'typo', 'v1.4.1'],
      tools: ['kubectl (get, describe, logs, events, rollout, set image, patch, exec, create secret)', 'lab-registry (simulated registry client)'],
      grammar: K8S_GRAMMAR,
      palette: ['kubectl get pods', 'kubectl rollout status deploy/beacon-api', 'kubectl describe pod ', 'kubectl get events --field-selector type=Warning', 'kubectl get deploy beacon-api -o yaml', 'kubectl get secrets', 'lab-registry list registry.lab/', 'lab-registry inspect ', 'kubectl rollout undo deploy/beacon-api', 'kubectl exec deploy/beacon-client -- curl -s http://beacon-api/version'],
      assumptions: ['Nodes are arm64; every image here is published for amd64 and arm64.', 'CI publishes Beacon images to registry.lab; the platform team provisioned any registry credentials this namespace needs.', 'Rolling back is an acceptable mitigation, but the release goal is 1.4.1.'],
      simplified: K8S_SIMPLIFIED.concat(['Registry access is a rule table: an unknown reference is "not found", a protected path needs the named pull secret on the pod (from its spec or ServiceAccount), and an unreachable registry host fails name resolution. There are no real credentials or networks.']),
      unsafe: [
        { label: 'switched the Deployment to a floating tag', why: 'A floating tag (a bare minor version, or `latest`) makes the next pull depend on whatever was pushed last: two pods can run different code and a rollback cannot name what it returns to. Pin a version or a digest.',
          test: function (c) { var d = k8sDep(c, 'beacon-api'); return !!d && d.template.containers.some(function (x) { return x.name === 'api' && !pinned(x.image); }); },
          demo: function (c, v) { return 'kubectl set image deploy/beacon-api api=' + (v === 'a' ? 'registry.lab/beacon/api' : v === 'b' ? 'registry.lab/beacon-private/api' : 'registry.lab/mirror/beacon/api') + ':1.4'; } }
      ],
      alt: function (v) {
        if (v === 'a') return ['kubectl rollout status deploy/beacon-api', 'kubectl get events --field-selector type=Warning', 'lab-registry inspect registry.lab/beacon/api:1.4.1',
          function (c) { return 'kubectl set image deploy/beacon-api api=registry.lab/beacon/api@' + st(c).digest141; }, 'kubectl rollout status deploy/beacon-api', 'kubectl exec deploy/beacon-client -- curl -s http://beacon-api/version'];
        if (v === 'b') return ['kubectl get deploy beacon-api', 'kubectl get pods', 'kubectl get events', 'kubectl get secrets', 'kubectl get deploy beacon-api -o jsonpath={.spec.template.spec.imagePullSecrets}',
          'kubectl patch serviceaccount default -p \'{"imagePullSecrets":[{"name":"regcred-beacon"}]}\'', 'kubectl rollout restart deploy/beacon-api', 'kubectl rollout status deploy/beacon-api', 'kubectl exec deploy/beacon-client -- curl -s http://beacon-api/version'];
        return ['kubectl describe deploy beacon-api', 'kubectl get pods', 'kubectl get events', 'lab-registry list registry.lab/mirror/',
          function (c) { return 'kubectl set image deploy/beacon-api api=registry.lab/mirror/beacon/api:1.4.1@' + st(c).digest141; }, 'kubectl rollout status deploy/beacon-api', 'kubectl exec deploy/beacon-client -- curl -s http://beacon-api/version'];
      },
      mechanism: 'The kubelet on the node pulls the image named in the pod spec; when the pull fails the container waits in **ErrImagePull**, then **ImagePullBackOff** with growing delays. With maxUnavailable 0 the Deployment keeps the old pods, so users are unaffected while the rollout sits until its progress deadline. The Failed event carries the real reason, and the three reasons need three different fixes: (a) **not found** — the registry has no such reference (the release bot wrote `v1.4.1`; CI publishes `1.4.1`) → point at the published tag or its digest; (b) **401 Unauthorized** — the path is private and the pod presents no credential: the Deployment names a pull secret `regcred` that does not exist here, while the provisioned one is `regcred-beacon` → reference the right secret (in the pod spec or the ServiceAccount; pull secrets attach at pod creation); (c) **no such host** — the nodes have no route or DNS to the upstream registry; this cluster pulls through the internal mirror (`registry.lab/mirror/…`) → use the mirrored reference. Each fix keeps a pinned 1.4.1 and the access controls intact.',
      alternatives: [
        { h: 'The node is out of disk or the image is too big', out: 'Ruled out: the event is from resolving/authorising the reference, before any layer is downloaded.' },
        { h: 'Wrong CPU architecture', out: 'Ruled out: that reads "no match for platform in manifest"; these images publish both amd64 and arm64.' },
        { h: 'Just roll back', out: 'A valid mitigation (users are not affected), but the release still needs the cause fixed; rolling back alone does not meet the goal.' }
      ],
      clues: ['The old pods being Ready is why there is no outage — not evidence that the new image is fine.', 'Deleting the stuck pod only makes a new one fail the same way.'],
      passRubric: ['Quotes the event reason and maps it to artifact, access or path', 'Fixes that one thing and keeps the image pinned', 'Explains why maxUnavailable 0 protected users', 'Verifies 1.4.1 through the Service, not only rollout status'],
      prereqs: ['les-m08-02', 'les-m08-04'], refs: ['T02', 'T04']
    }
  });

  /* ═══ S16 · Deployment never becomes ready ═══════════════════════════ */
  var S16_REPO = 'registry.lab/beacon/api';
  function readinessOf(c) { var d = k8sDep(c, 'beacon-api'); return d ? (d.template.containers.filter(function (x) { return x.name === 'api'; })[0] || {}).readiness : null; }
  function cmOf(m) { return KM().find(m, 'configmaps', 'beacon-config', m.ns); }
  function s16Fixed(c) {
    var s = st(c), r = readinessOf(c), d = k8sDep(c, 'beacon-api'), cm = cmOf(M(c));
    if (!d || !r || r.exec || s.execProbeTried || d.replicas !== 2) return false;
    if (r.path !== '/ready' || !(r.port == null || r.port === 8080 || r.port === '8080' || r.port === 'http')) return false;
    if (!cm || (cm.data || {}).BEACON_STORE_KIND !== 'postgres' || !(cm.data || {}).BEACON_STORE_URL) return false;
    return KM().rolloutComplete(M(c), 'beacon-api', M(c).ns) && readyCount(c, 'beacon-api') >= 2;
  }
  function podSpecReadiness(m, podName) {
    var p = m.pods.filter(function (x) { return x.name === podName; })[0];
    if (p) return { r: (p.spec.containers[0] || {}).readiness, ip: p.ip };
    var rs = m.replicasets.filter(function (x) { return podName.indexOf(x.name + '-') === 0; })[0];
    return rs ? { r: (rs.template.containers[0] || {}).readiness, ip: null } : null;
  }
  /* the model reports every failed HTTP probe as a 404; a probe aimed at a
     port nothing listens on is "connection refused" in real kubelet output */
  function rewriteProbeMsgs(s, m, text) {
    var cur = null;
    return String(text).split('\n').map(function (ln) {
      var nm = /^Name:\s+(\S+)/.exec(ln);
      if (nm) cur = nm[1];
      if (ln.indexOf('Readiness probe failed: HTTP probe failed with statuscode: 404') === -1) return ln;
      var pm = /pod\/(\S+)/.exec(ln), pod = pm ? pm[1] : cur;
      if (!pod) return ln;
      var info = podSpecReadiness(m, pod);
      if (!info || !info.r || info.r.port == null || info.r.port === 8080 || info.r.port === 'http') return ln;
      var ip = info.ip || s.podIps[pod] || '10.244.1.23';
      return ln.replace('Readiness probe failed: HTTP probe failed with statuscode: 404', 'Readiness probe failed: Get "http://' + ip + ':' + info.r.port + (info.r.path || '/') + '": dial tcp ' + ip + ':' + info.r.port + ': connect: connection refused');
    }).join('\n');
  }
  function podFor(m, ref) {
    if (!ref) return null;
    if (/^(deploy|deployment|deployments)\//.test(ref)) {
      var dn = ref.split('/')[1], d = KM().find(m, 'deployments', dn, m.ns);
      if (!d) return null;
      var pods = [];
      KM().rsFor(m, d).forEach(function (r) { pods = pods.concat(KM().podsOf(m, r)); });
      pods.sort(function (a, b) { return b.created - a.created; });
      return pods[0] || null;
    }
    var name = ref.replace(/^(po|pod|pods)\//, '');
    return m.pods.filter(function (p) { return p.name === name && !p.gone; })[0] || null;
  }
  function s16Kubectl(state) {
    return function (w, a, base) {
      var m = w.k8sModel, verb = a.filter(function (x) { return x.charAt(0) !== '-'; })[0];
      /* in-pod requests to the pod's own address */
      if (verb === 'exec' && a.indexOf('--') !== -1) {
        var after = a.slice(a.indexOf('--') + 1), before = a.slice(0, a.indexOf('--'));
        if (after[0] === 'curl') {
          var cp = curlParse(after.slice(1)), u = parseUrl(cp.url);
          var h = u ? u.host.replace(/^\[|\]$/g, '') : '';
          if (u && (h === 'localhost' || h === '127.0.0.1' || h === '::1')) {
            var ref = before.filter(function (x, i) { return x !== 'exec' && x.charAt(0) !== '-' && ['-n', '--namespace', '-c', '--container'].indexOf(before[i - 1]) === -1; })[0];
            KM().advance(m, KM().PER_COMMAND);
            var p = podFor(m, ref);
            if (!p) return res('', 1, 'Error from server (NotFound): pods "' + String(ref || '').replace(/^.*\//, '') + '" not found');
            var ct = p.containers[0];
            if (!ct || ct.state !== 'running') return res('', 1, 'error: unable to upgrade connection: container not found ("' + (ct ? ct.name : 'api') + '")');
            var prof = KM().profileFor(m, ct.image);
            var okIn = u.port === prof.port;
            var body = okIn ? ((prof.http || {})[u.path] != null ? prof.http[u.path] : null) : null;
            var r = curlRender(cp, u, okIn ? { ok: true } : { code: 7, msg: 'curl: (7) Failed to connect to ' + u.host + ' port ' + u.port + ' after 0 ms: Couldn\'t connect to server' },
              okIn ? (body == null ? { code: 404, body: '{"error": "not found", "path": "' + u.path + '"}' } : { code: 200, body: body }) : null);
            r.out = r.out.replace(/^HTTP\/1\.0/m, 'HTTP/1.0');
            return { out: r.out, err: r.err, code: r.code };
          }
        }
      }
      /* an exec readiness probe is not modelled: say so, and remember the attempt */
      if (verb === 'patch' && /readinessProbe[\s\S]*"exec"/.test(a.join(' '))) {
        state.execProbeTried = true;
        return res('', 1, 'error: exec probes are not modelled in this simulation (the model has no container filesystem); the patch was not applied.\nNote for the debrief: replacing the readiness check with a command that always succeeds would hide the failure, not fix it.');
      }
      var out = base(w, a);
      if (verb === 'describe' || verb === 'get' || verb === 'events') {
        out = { out: rewriteProbeMsgs(state, m, out.out || ''), err: out.err, code: out.code };
      }
      if ((verb === 'logs' || verb === 'log') && out.code === 0 && a.indexOf('--previous') === -1 && a.indexOf('-p') === -1) {
        var lref = a.filter(function (x, i) { return x !== verb && x.charAt(0) !== '-' && ['-n', '--namespace', '-c', '--container', '--tail', '--since'].indexOf(a[i - 1]) === -1; })[0];
        var lp = podFor(m, lref), lc = lp && lp.containers[0];
        if (lc && lc.state === 'running') {
          var spec = lp.spec.containers[0], lprof = KM().profileFor(m, lc.image), extra = [], up = m.clock - lc.startedAt;
          [['readiness', spec.readiness], ['liveness', spec.liveness]].forEach(function (pr) {
            var probe = pr[1];
            if (!probe || probe.exec) return;
            var port = probe.port == null ? lprof.port : probe.port;
            if (!(port === lprof.port || port === 'http' || String(port) === String(lprof.port))) return;
            var period = probe.period || 10, n = Math.min(3, Math.max(0, Math.floor((up - (probe.initialDelay || 0)) / period)));
            var path = probe.path || '/', code = (lprof.http || {})[path] != null ? 200 : 404;
            for (var i = 0; i < n; i++) extra.push('{"level":"info","msg":"request","method":"GET","path":"' + path + '","status":' + code + ',"user_agent":"kube-probe/1.33"}');
          });
          if (extra.length) out = { out: (out.out || '') + extra.join('\n') + '\n', err: out.err, code: out.code };
        }
      }
      return out;
    };
  }
  LX.missions.push({
    id: 'sre-s16', track: 'sre', cat: 'scenario', level: 'intermediate', mins: 25, kind: 'incident',
    title: 'New beacon-api Deployment never becomes available',
    brief: function () { return 'beacon-api 1.4.1 was deployed to the beacon namespace of looped-foundations for the first time this morning, from the manifests in /home/lab/beacon/k8s. The Deployment has never had an available replica and the beacon-client pod gets no answer from the beacon-api Service. Make it available without weakening how Kubernetes decides a pod may take traffic, and explain the cause.'; },
    keys: ['kubectl get deploy beacon-api', 'kubectl get pods', 'kubectl describe pod ', 'kubectl get events --field-selector type=Warning', 'kubectl logs deploy/beacon-api', 'kubectl describe deploy beacon-api', 'kubectl get configmap beacon-config -o yaml', 'kubectl exec deploy/beacon-api -- curl -s http://localhost:8080/', 'kubectl rollout status deploy/beacon-api', 'kubectl exec deploy/beacon-client -- curl -s http://beacon-api/version'],
    world: function (seed) {
      var S = SIM(), v = S.variantOf(seed, ['a', 'b', 'c']);
      var state = { clock: 0, risky: [], seed: seed, variant: v, hooks: [], podIps: {}, execProbeTried: false };
      var cmData = { BEACON_STORE_KIND: 'postgres', BEACON_STORE_URL: 'postgresql://beacon@beacon-db.beacon.svc:5432/beacon', BEACON_APP_ENVIRONMENT: 'lab', BEACON_QUEUE_KIND: 'none' };
      if (v === 'c') { delete cmData.BEACON_STORE_URL; cmData.BEACON_DATABASE_URL = 'postgresql://beacon@beacon-db.beacon.svc:5432/beacon'; }
      var readiness = { path: v === 'a' ? '/readyz' : '/ready', port: v === 'b' ? 8081 : 8080, period: 5, failureThreshold: 3 };
      var tpl = { labels: { app: 'beacon-api' }, containers: [{ name: 'api', image: S16_REPO + ':1.4.1', ports: [{ name: 'http', containerPort: 8080 }],
        envFrom: [{ configMapRef: 'beacon-config' }], env: [{ name: 'PGPASSWORD', secretKey: { name: 'beacon-db', key: 'password' } }],
        resources: { requests: { cpu: '100m', memory: '64Mi' }, limits: { memory: '256Mi' } },
        readiness: readiness, liveness: { path: '/healthz', port: 8080, initialDelay: 10, period: 10, failureThreshold: 3 } }] };
      var apps = Object.assign({}, TOOLBOX);
      apps[S16_REPO] = beaconProfile('1.4.1', { requiresEnv: ['BEACON_STORE_URL'], missingEnvLog: 'FATAL config: store.url is required when store.kind is postgres (BEACON_STORE_URL)' });
      var k8s = { namespace: 'beacon', context: 'kind-looped-foundations', now: 1500, nodes: NODES(),
        registry: { 'registry.lab/beacon/api:1.4.1': { arch: ['amd64', 'arm64'] }, 'registry.lab/tools/toolbox:1.2.0': { arch: ['amd64', 'arm64'] } }, apps: apps,
        configmaps: [{ name: 'beacon-config', data: cmData }],
        secrets: [{ name: 'beacon-db', type: 'Opaque', data: { password: 'lab-db-password-not-a-real-secret' } }],
        services: [beaconService(), { name: 'beacon-db', selector: { app: 'beacon-db' }, clusterIP: '10.96.80.12', ports: [{ name: 'pg', port: 5432, targetPort: 5432 }] }],
        deployments: [{ name: 'beacon-api', replicas: 2, selector: { app: 'beacon-api' }, maxUnavailable: 0, history: [tpl] }, clientDeployment()] };
      /* keep the model's single readiness path in step with what Beacon really
         serves (both /ready and /healthz answer 200), and the config rule that
         only the postgres store needs a URL */
      state.hooks.push(function (s, w) {
        var m = w && w.k8sModel; if (!m) return;
        var d = KM().find(m, 'deployments', 'beacon-api', m.ns), prof = m.apps[S16_REPO];
        var rp = d && d.template.containers[0] && d.template.containers[0].readiness;
        prof.readyPath = rp && rp.path === '/healthz' ? '/healthz' : '/ready';
        var cm = cmOf(m);
        prof.requiresEnv = cm && (cm.data || {}).BEACON_STORE_KIND !== 'postgres' ? [] : ['BEACON_STORE_URL'];
        m.pods.forEach(function (p) { if (p.ip) s.podIps[p.name] = p.ip; });
      });
      function yamlData(o) { return Object.keys(o).map(function (k) { return '  ' + k + ': "' + o[k] + '"'; }).join('\n'); }
      var cmYaml = 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: beacon-config\n  namespace: beacon\ndata:\n' + yamlData(cmData) + '\n';
      var depYaml = 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: beacon-api\n  namespace: beacon\nspec:\n  replicas: 2\n  selector:\n    matchLabels:\n      app: beacon-api\n  template:\n    metadata:\n      labels:\n        app: beacon-api\n    spec:\n      containers:\n        - name: api\n          image: registry.lab/beacon/api:1.4.1\n          ports:\n            - name: http\n              containerPort: 8080\n          envFrom:\n            - configMapRef:\n                name: beacon-config\n          env:\n            - name: PGPASSWORD\n              valueFrom:\n                secretKeyRef:\n                  name: beacon-db\n                  key: password\n          readinessProbe:\n            httpGet:\n              path: ' + readiness.path + '\n              port: ' + readiness.port + '\n            periodSeconds: 5\n          livenessProbe:\n            httpGet:\n              path: /healthz\n              port: 8080\n            initialDelaySeconds: 10\n';
      var files = [{ path: '/home/lab/beacon/k8s/configmap.yaml', content: cmYaml }, { path: '/home/lab/beacon/k8s/deployment.yaml', content: depYaml },
        { path: '/home/lab/beacon/k8s/README.md', content: '# beacon-api manifests\nApplied with kubectl apply -f k8s/ on first deploy. In this simulation apply -f is modelled for the ConfigMap; change the Deployment with kubectl patch/set and keep this file in step.\n' }];
      return k8sWorld(state, k8s, files, s16Kubectl(state));
    },
    objectives: [
      { id: 'state', stage: 'evidence', text: 'Establish the Deployment\'s availability and what its pods are doing',
        hint: 'Start from the object that is failing its promise, then go one level down.',
        hint2: '`kubectl get deploy beacon-api` (READY/AVAILABLE) and `kubectl get pods` (READY, STATUS, RESTARTS).',
        reveal: 'kubectl get deploy beacon-api && kubectl get pods',
        done: function (c) { return saw(c, /k(ubectl)?\b.*\b(get\s+(deploy|deployments?|po|pods?)|rollout\s+status|describe\s+(deploy|deployments?))\b/, /beacon-api\S*\s+0\/[12]\s|0 of 2 updated|CrashLoopBackOff|0 available|exceeded its progress deadline/); } },
      { id: 'why', stage: 'evidence', text: 'Find the recorded reason the pods are not ready',
        hint: 'Kubernetes writes down why it will not send traffic to a pod, and the app writes down why it is unhappy. Read both kinds of record.',
        hint2: 'Pod events (`kubectl describe pod NAME`, `kubectl get events`) and container logs (`kubectl logs`, `--previous` after a restart).',
        reveal: function (c) { return st(c).variant === 'c' ? 'kubectl logs ' + stuckPod(c) + ' --previous' : 'kubectl describe pod ' + stuckPod(c); },
        done: function (c) {
          var v = st(c).variant;
          if (v === 'c') return saw(c, /k(ubectl)?\b.*\blogs?\b/, /FATAL config/);
          var re = v === 'a' ? /Readiness probe failed: HTTP probe failed with statuscode: 404/ : /Readiness probe failed: Get "http:\/\/[\d.]+:8081\/[^"]*": dial tcp [\d.]+:8081: connect: connection refused/;
          return saw(c, /k(ubectl)?\b.*\b(describe\s+(po|pods?)|get\s+(events?|ev)|events)\b/, re);
        } },
      { id: 'compare', stage: 'evidence', text: 'Compare what the cluster asks of the app with what the app actually provides',
        hint: 'A check can be wrong, or the thing it checks can be wrong. Look at both sides.',
        hint2: 'The check: `kubectl describe deploy beacon-api` (Readiness line) or the manifest. The app: `kubectl exec deploy/beacon-api -- curl -s http://localhost:8080/ready`. Its configuration: `kubectl get configmap beacon-config -o yaml`.',
        reveal: function (c) { return st(c).variant === 'c' ? 'kubectl get configmap beacon-config -o yaml' : 'kubectl describe deploy beacon-api && kubectl exec deploy/beacon-api -- curl -s http://localhost:8080/ready'; },
        done: function (c) {
          if (st(c).variant === 'c') return saw(c, /k(ubectl)?\b.*\b(get\s+(cm|configmaps?)\b.*-o\s*=?\s*(yaml|json)|describe\s+(cm|configmaps?))\b|cat\s+\S*configmap\.yaml/, /BEACON_STORE_KIND/);
          var probeCfg = saw(c, /k(ubectl)?\b.*\b(describe\s+(deploy|deployments?|po|pods?)\b|get\s+(deploy|deployments?|po|pods?)\b.*-o\s*=?\s*(yaml|json))|cat\s+\S*deployment\.yaml/, /Readiness:\s+http-get|readinessProbe/);
          return probeCfg && saw(c, /k(ubectl)?\s+exec\b.*\bcurl\b.*:8080\/ready\b/, /"ready": true|^200$/m);
        } },
      { id: 'fix', stage: 'fix', text: 'Correct the actual cause so both replicas become Ready, with the readiness check still testing readiness',
        hint: 'Change the one thing that is wrong — the check\'s target, or the configuration — and leave the check doing its job.',
        hint2: 'Probe: `kubectl patch deploy beacon-api -p \'{"spec":{"template":{"spec":{"containers":[{"name":"api","readinessProbe":{"httpGet":{…}}}]}}}}\'`. Config: patch or apply the ConfigMap, then `kubectl rollout restart deploy/beacon-api` (env is read at container start).',
        reveal: function (c) {
          var v = st(c).variant;
          if (v === 'a') return 'kubectl patch deploy beacon-api -p \'{"spec":{"template":{"spec":{"containers":[{"name":"api","readinessProbe":{"httpGet":{"path":"/ready"}}}]}}}}\'';
          if (v === 'b') return 'kubectl patch deploy beacon-api -p \'{"spec":{"template":{"spec":{"containers":[{"name":"api","readinessProbe":{"httpGet":{"port":8080}}}]}}}}\'';
          return 'kubectl patch configmap beacon-config -p \'{"data":{"BEACON_STORE_URL":"postgresql://beacon@beacon-db.beacon.svc:5432/beacon"}}\' && kubectl rollout restart deploy/beacon-api';
        },
        done: function (c) { return s16Fixed(c); } },
      { id: 'verify', stage: 'verify', text: 'Verify the rollout completed and the client reaches Beacon through the Service',
        hint: 'Ready pods are the means; the client getting an answer through the Service is the end.',
        hint2: '`kubectl rollout status deploy/beacon-api`, then `kubectl exec deploy/beacon-client -- curl -s http://beacon-api/version`.',
        reveal: 'kubectl rollout status deploy/beacon-api && kubectl exec deploy/beacon-client -- curl -s http://beacon-api/version',
        done: function (c) { return s16Fixed(c) && lastIs(c, /k(ubectl)?\s+exec\b.*beacon-client\b.*\bcurl\b.*beacon-api/, /"version": "1\.4\.1"|"ready": true|^ok$/m) && lastCode(c) === 0; } }
    ],
    sre: {
      scenarioId: 'S16', moduleId: 'M08', lab: 'L16', variants: ['a', 'b', 'c'],
      symptom: 'beacon-api shows 0/2 available since its first deploy; the Service has no ready endpoints and the client gets no answer.',
      neutralTitle: 'New beacon-api Deployment never becomes available',
      neutralBrief: 'beacon-api 1.4.1 was deployed to the beacon namespace for the first time this morning. The Deployment has never had an available replica and the client gets no answer from the beacon-api Service. Make it available without weakening how Kubernetes decides a pod may take traffic, and explain the cause.',
      impact: 'beacon-api is entirely unavailable to in-cluster clients; there is no previous version to fall back to.',
      changes: 'First deploy of beacon-api to the beacon namespace from /home/lab/beacon/k8s.',
      spoilers: ['probe', '/readyz', '8081', 'configmap', 'BEACON_STORE_URL', 'DATABASE_URL', 'healthz'],
      tools: ['kubectl (get, describe, logs, events, exec … curl, patch, apply -f, rollout)', 'cat', 'sed -i', 'edit'],
      grammar: K8S_GRAMMAR,
      palette: ['kubectl get deploy beacon-api', 'kubectl get pods', 'kubectl describe pod ', 'kubectl get events --field-selector type=Warning', 'kubectl logs deploy/beacon-api', 'kubectl describe deploy beacon-api', 'kubectl get configmap beacon-config -o yaml', 'kubectl exec deploy/beacon-api -- curl -s http://localhost:8080/ready', 'kubectl rollout status deploy/beacon-api', 'kubectl exec deploy/beacon-client -- curl -s http://beacon-api/version'],
      assumptions: ['Beacon serves /healthz (liveness: never checks dependencies) and /ready (readiness: 503 when its store is unreachable) on 8080.', 'beacon-db is the PostgreSQL Service Beacon is meant to use; the in-memory store is for tests only.', 'The manifests in k8s/ are what the platform applied; keep them in step with what you change.'],
      simplified: K8S_SIMPLIFIED.concat(['Readiness and liveness are modelled as HTTP GETs that pass only for the path and port Beacon serves; exec probes are not modelled.', 'Beacon\'s store connection is not simulated: with a URL set, /ready answers 200.']),
      unsafe: [
        { label: 'removed or neutered the readiness probe', why: 'Deleting the readiness probe (or replacing it with an always-true command, or pointing it at /healthz, which never checks dependencies) makes pods "Ready" without proving they can serve. It hides this failure and the next one: traffic will go to pods that cannot answer.',
          test: function (c) { var r = readinessOf(c); return !!k8sDep(c, 'beacon-api') && (!r || !!r.exec || r.path === '/healthz' || !!st(c).execProbeTried); },
          demo: 'kubectl patch deploy beacon-api -p \'{"spec":{"template":{"spec":{"containers":[{"name":"api","readinessProbe":null}]}}}}\'' },
        { label: 'switched Beacon to the in-memory store', why: 'Changing BEACON_STORE_KIND to memory to get past a configuration error makes the pods start, but every record is lost on restart and each replica has its own data. The configuration was incomplete; complete it.',
          test: function (c) { var cm = cmOf(M(c)); return !!cm && (cm.data || {}).BEACON_STORE_KIND !== 'postgres'; },
          demo: 'kubectl patch configmap beacon-config -p \'{"data":{"BEACON_STORE_KIND":"memory"}}\'' }
      ],
      alt: function (v) {
        if (v === 'a') return ['kubectl rollout status deploy/beacon-api --timeout=20s', 'kubectl get events --field-selector type=Warning', 'kubectl get deploy beacon-api -o yaml',
          function (c) { return 'kubectl exec ' + stuckPod(c) + ' -- curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/ready'; },
          "sed -i 's#path: /readyz#path: /ready#' k8s/deployment.yaml",
          'kubectl patch deploy beacon-api --type=strategic -p \'{"spec":{"template":{"spec":{"containers":[{"name":"api","readinessProbe":{"httpGet":{"path":"/ready","port":8080}}}]}}}}\'',
          'kubectl rollout status deploy/beacon-api', 'kubectl exec deploy/beacon-client -- curl -s http://beacon-api/ready'];
        if (v === 'b') return ['kubectl get pods', function (c) { return 'kubectl describe pod ' + stuckPod(c); }, function (c) { return 'kubectl logs ' + stuckPod(c); }, 'cat k8s/deployment.yaml',
          'kubectl exec deploy/beacon-api -- curl -s http://localhost:8080/ready', "sed -i 's#port: 8081#port: 8080#' k8s/deployment.yaml",
          'kubectl patch deploy beacon-api -p \'{"spec":{"template":{"spec":{"containers":[{"name":"api","readinessProbe":{"httpGet":{"port":"http"}}}]}}}}\'',
          'kubectl rollout status deploy/beacon-api', 'kubectl exec deploy/beacon-client -- curl -s http://beacon-api/version'];
        return ['kubectl get pods', 'kubectl describe deploy beacon-api', 'kubectl logs deploy/beacon-api --previous', 'kubectl describe configmap beacon-config', 'cat k8s/configmap.yaml',
          "sed -i 's/BEACON_DATABASE_URL/BEACON_STORE_URL/' k8s/configmap.yaml", 'kubectl apply -f k8s/configmap.yaml', 'kubectl rollout restart deploy/beacon-api',
          'kubectl rollout status deploy/beacon-api', 'kubectl exec deploy/beacon-client -- curl -s http://beacon-api/version'];
      },
      mechanism: 'A Service sends traffic only to pods whose readiness probe passes; a Deployment counts a replica as available only when it is Ready. Nothing restarts a pod for failing readiness — it just never receives traffic, which is exactly "0/2 available, no endpoints". Depending on the seed: (a) the readiness probe asks for `/readyz`, a path Beacon does not serve, so every probe gets **404** while `curl localhost:8080/ready` from inside the pod returns 200; (b) the probe asks the right path on port **8081**, where nothing listens — kubelet reports **connection refused**, and Beacon\'s logs show no probe requests at all; (c) the probe is right but the app never gets that far: the ConfigMap was regenerated with `BEACON_DATABASE_URL` instead of `BEACON_STORE_URL`, so Beacon exits with **FATAL config** at start and the pods crash-loop. The fix changes the wrong thing — probe path, probe port (8080 or the named port `http`), or the ConfigMap key followed by a restart, because environment from a ConfigMap is read when a container starts — and keeps the probe testing `/ready`. Deleting or neutering the probe would make the pods "Ready" without proving they can serve.',
      alternatives: [
        { h: 'The Service selector is wrong', out: 'Ruled out: the Service lists the pods as not-ready endpoints; once readiness passes they become ready endpoints with no Service change.' },
        { h: 'Liveness kills the pods', out: 'Ruled out for (a)/(b): restart counts stay at 0 and there are no Killing events. In (c) the restarts come from the app exiting, not from liveness.' },
        { h: 'The image is bad', out: 'Ruled out: the image pulled and the process started; in-pod curl to /ready succeeds in (a)/(b), and (c) logs a precise config error.' }
      ],
      clues: ['beacon-db existing as a Service does not mean Beacon is configured to use it.', 'Readiness failures do not restart a container; liveness failures do.'],
      passRubric: ['Distinguishes a wrong check from a wrong app/config, with the evidence that separates them', 'Explains what readiness does to Service endpoints and Deployment availability', 'Keeps a readiness probe that tests /ready and explains why removing it is unsafe', 'For config faults, explains why a restart was needed after the ConfigMap change', 'Verifies through the Service from the client, not only pod status'],
      prereqs: ['les-m08-03', 'les-m08-04', 'les-m08-05'], refs: ['T22', 'T02']
    }
  });
})();
