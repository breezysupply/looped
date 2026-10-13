/* SRE & Cloud Deployment Foundations — simulated incidents S25–S28 (M13–M14).

   Same contract as sre-scenarios-1.js; played by tests/data/test-sre-scenarios.js.

   S25 models a release scan: an image built from a Dockerfile and pinned
   requirements, a BuildKit-style SBOM that covers every stage, a scanner
   stand-in (`scan`, table and a JSON subset), a triage file the learner
   edits, and a release gate that reads it. S26 models an air-gapped
   receiver: signed bundles on transfer media, a pinned trust store, an
   internal registry, a Helm/kubectl stand-in over a small install model, a
   blocked egress that records every external fetch, and a one-way path from
   a connected build host. S27 is a load and capacity model on the logical
   clock (replicas, pools, retries at two layers, database saturation,
   shedding, duplicate writes). S28 is an incident timeline with a recurring
   cause (a filling disk or a scheduled job) and an incident record that the
   learner updates.

   Everything here is invented for the lab: advisory ids, package versions
   and their "vulnerabilities", keys, digests, hosts. Learner-visible text
   (title, briefs, objective text) never names the root cause; mechanism,
   alternatives and the worked fix live in the debrief. */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.missions = LX.missions || [];

(function () {
  function SIM() { return window.LXSim; }
  function SH() { return window.LXShell; }
  function st(c) { return c.w.sre; }
  function saw(c, re, outRe) { return SIM().saw(c, re, outRe); }
  function lastIs(c, cmdRe, outRe) { return SIM().lastIs(c, cmdRe, outRe); }
  function fileText(c, p) { return SIM().readFile(c.w, p); }

  /* deterministic hex for ids and digests */
  function hex(seed, n) {
    var r = SIM().rng('hex:' + seed), s = '';
    while (s.length < n) s += '0123456789abcdef'.charAt(Math.floor(r.next() * 16));
    return s;
  }
  function h64(text) { return hex('h64:' + SIM().fnv(String(text)) + ':' + String(text).length, 64); }
  function res(out, code, errText) {
    var r = { out: out == null ? '' : String(out), code: code || 0 };
    if (r.out && !/\n$/.test(r.out)) r.out += '\n';
    if (errText) r.err = String(errText).replace(/\n?$/, '\n');
    return r;
  }
  /* repeatable flags: --bump a --bump b → { bump: [a, b] } */
  function multi(args, names) {
    var out = { pos: [] };
    for (var i = 0; i < args.length; i++) {
      var t = args[i], m = /^--([a-z][a-z0-9-]*)(=(.*))?$/.exec(t);
      if (m && names.indexOf(m[1]) !== -1) {
        var v = m[3] != null ? m[3] : (i + 1 < args.length ? args[++i] : '');
        (out[m[1]] = out[m[1]] || []).push(v);
      } else if (m) { (out[m[1]] = out[m[1]] || []).push(true); } else out.pos.push(t);
    }
    return out;
  }
  function one(f, k) { return f[k] && f[k].length ? f[k][f[k].length - 1] : undefined; }
  /* builtins that still advance the scenario clock when a scenario needs time to pass */
  function clocked(names) {
    var o = {};
    names.forEach(function (n) { o[n] = function (w, a, stdin) { var b = SH().builtin(n); return b ? b(w, a, stdin) : SIM().err(n + ': not available'); }; });
    return o;
  }

  /* ═══ S25 · Security scan flags many findings before release ═══════════ */
  var S25_DIR = '/home/lab/beacon-release';
  var S25_TODAY = '2026-10-13', S25_MAXDAY = '2027-01-11';
  var VEX = ['component_not_present', 'vulnerable_code_not_present', 'vulnerable_code_not_in_execute_path', 'vulnerable_code_cannot_be_controlled_by_adversary', 'inline_mitigations_already_exist'];
  var S25_BASE_OS = { libssl3: '3.0.14-1~deb12u2', openssl: '3.0.14-1~deb12u2', libc6: '2.36-9+deb12u8', zlib1g: '1:1.2.13.dfsg-1', 'libsqlite3-0': '3.40.1-2+deb12u1', libexpat1: '2.5.0-1+deb12u1',
    'perl-base': '5.36.0-7+deb12u1', tar: '1.34+dfsg-1.2+deb12u1', login: '1:4.13+dfsg1-1+b1', 'ncurses-base': '6.4-4', libgnutls30: '3.7.9-2+deb12u3', libsystemd0: '252.30-1~deb12u2', gpgv: '2.2.40-1.1' };
  var S25_BASES = {
    '3.12.7-slim-bookworm': { debian: '12.7', os: S25_BASE_OS, py: { pip: '24.0', setuptools: '68.2.2' } },
    '3.12.8-slim-bookworm': { debian: '12.8', os: Object.assign({}, S25_BASE_OS, { libssl3: '3.0.15-1~deb12u1', openssl: '3.0.15-1~deb12u1', libc6: '2.36-9+deb12u9' }), py: { pip: '24.0', setuptools: '68.2.2' } }
  };
  var S25_BUILDER = { 'gcc-12': '12.2.0-14', 'libc6-dev': '2.36-9+deb12u8', 'linux-libc-dev': '6.1.112-1', git: '1:2.39.5-0+deb12u1', libcurl4: '7.88.1-10+deb12u7', binutils: '2.40-2', make: '4.3-4.1' };
  var S25_PYPI = { urllib3: ['2.0.7', '2.2.2', '2.2.3'], requests: ['2.31.0', '2.32.3'], certifi: ['2024.2.2', '2024.8.30'], idna: ['3.6', '3.7'], pyyaml: ['6.0.1', '6.0.2'], jinja2: ['3.1.3', '3.1.4'], markupsafe: ['2.1.5'], cryptography: ['42.0.4', '43.0.1'], setuptools: ['68.2.2', '70.0.0'] };
  var S25_REQS = 'requests==2.31.0\nurllib3==2.0.7\ncertifi==2024.2.2\nidna==3.6\npyyaml==6.0.1\njinja2==3.1.3\nmarkupsafe==2.1.5\ncryptography==42.0.4\n';
  /* [id, package, severity, title, affected versions, fixed version, status, reachability regex over src/, worked triage] */
  var S25_NOISE = [
    ['CVE-2026-90201', 'libc6', 'MEDIUM', 'getaddrinfo may return stale entries after resolv.conf reload', ['2.36-9+deb12u8'], '2.36-9+deb12u9', 'fixed'],
    ['CVE-2026-90202', 'libc6', 'LOW', 'Out-of-bounds read with a crafted LC_ALL value', ['2.36-9+deb12u8', '2.36-9+deb12u9'], '', 'will_not_fix'],
    ['CVE-2026-90203', 'perl-base', 'LOW', 'Quadratic regex time on nested quantifiers', ['5.36.0-7+deb12u1'], '', 'will_not_fix'],
    ['CVE-2026-90204', 'tar', 'LOW', 'Missing warning for --absolute-names member paths', ['1.34+dfsg-1.2+deb12u1'], '', 'affected'],
    ['CVE-2026-90205', 'login', 'LOW', 'Password-aging message reveals account existence', ['1:4.13+dfsg1-1+b1'], '', 'will_not_fix'],
    ['CVE-2026-90206', 'ncurses-base', 'LOW', 'Terminfo parsing over-read', ['6.4-4'], '', 'affected'],
    ['CVE-2026-90207', 'libgnutls30', 'MEDIUM', 'Timing side channel in RSA-PSK key exchange', ['3.7.9-2+deb12u3'], '', 'affected'],
    ['CVE-2026-90208', 'libsystemd0', 'LOW', 'sd-bus message size check off by one', ['252.30-1~deb12u2'], '', 'will_not_fix'],
    ['CVE-2026-90209', 'gpgv', 'LOW', 'Signature subpacket parsing over-read', ['2.2.40-1.1'], '', 'will_not_fix'],
    ['CVE-2026-90210', 'zlib1g', 'MEDIUM', 'Integer overflow in contrib/minizip zipOpenNewFileInZip4_64', ['1:1.2.13.dfsg-1'], '', 'will_not_fix'],
    ['CVE-2026-90211', 'git', 'MEDIUM', 'Credential helper prompt injection via a crafted URL', ['1:2.39.5-0+deb12u1'], '', 'affected'],
    ['CVE-2026-90212', 'libcurl4', 'MEDIUM', 'Cookie domain matching too permissive for IDN hosts', ['7.88.1-10+deb12u7'], '', 'affected'],
    ['CVE-2026-90213', 'binutils', 'LOW', 'objdump crash on malformed DWARF', ['2.40-2'], '', 'will_not_fix'],
    ['CVE-2026-90214', 'binutils', 'LOW', 'readelf over-read on crafted section headers', ['2.40-2'], '', 'will_not_fix'],
    ['CVE-2026-90215', 'requests', 'MEDIUM', 'verify=False persists for later requests in a Session', ['2.31.0'], '2.32.3', 'fixed'],
    ['CVE-2026-90216', 'setuptools', 'MEDIUM', 'Command injection through package index URLs in legacy download paths', ['68.2.2'], '70.0.0', 'fixed'],
    ['CVE-2026-90217', 'cryptography', 'LOW', 'Bundled OpenSSL in wheels: low-severity denial of service', ['42.0.4'], '43.0.1', 'fixed'],
    ['CVE-2026-90218', 'jinja2', 'MEDIUM', 'HTML attribute injection through xmlattr filter keys', ['3.1.3'], '3.1.4', 'fixed']
  ];
  var S25_GATING = {
    a: [
      ['CVE-2026-91101', 'urllib3', 'CRITICAL', 'Proxy-Authorization header kept on cross-origin redirects', ['2.0.7'], '2.2.2', 'fixed'],
      ['CVE-2026-91102', 'certifi', 'HIGH', 'Bundle still trusts two distrusted root certificate authorities', ['2024.2.2'], '2024.8.30', 'fixed'],
      ['CVE-2026-91103', 'pyyaml', 'HIGH', 'Code execution when full_load()/FullLoader parses untrusted YAML', ['6.0.1', '6.0.2'], '', 'affected', 'full_load|FullLoader|unsafe_load|yaml\\.load\\(',
        { d: 'not_affected', j: 'vulnerable_code_not_in_execute_path', detail: 'Beacon calls only yaml.safe_load (src/beacon/config.py), full_load/FullLoader/unsafe_load are never called' }],
      ['CVE-2026-91104', 'gcc-12', 'HIGH', 'Stack protector not applied to some variable-length arrays', ['12.2.0-14'], '12.2.0-14+deb12u1', 'fixed', null,
        { d: 'not_affected', j: 'component_not_present', detail: 'gcc-12 is installed only in the builder stage, the final image has no compiler' }],
      ['CVE-2026-91105', 'linux-libc-dev', 'CRITICAL', 'Kernel: use-after-free in nf_tables set handling', ['6.1.112-1'], '6.1.115-1', 'fixed', null,
        { d: 'not_affected', j: 'component_not_present', detail: 'kernel headers exist only in the builder stage, the final image does not contain them' }],
      ['CVE-2026-91106', 'libsqlite3-0', 'HIGH', 'Heap overflow in the FTS5 tokenizer with a crafted MATCH expression', ['3.40.1-2+deb12u1'], '', 'affected', 'MATCH',
        { d: 'accepted', owner: 'data-team', expires: '2026-12-15', detail: 'search passes user text to FTS5 MATCH, no fixed package yet, cap q at 128 chars and re-check weekly' }],
      ['CVE-2026-91107', 'idna', 'UNKNOWN', 'Excessive CPU in idna.encode() with very long crafted labels (not yet scored)', ['3.6', '3.7'], '', 'under_investigation', null,
        { d: 'under_investigation', owner: 'platform-team', expires: '2026-11-13', detail: 'not scored yet, hostnames come from config, re-check when the advisory is scored' }]
    ],
    b: [
      ['CVE-2026-91201', 'libssl3', 'CRITICAL', 'Buffer over-read in X.509 name-constraint checking during TLS handshakes', ['3.0.14-1~deb12u2'], '3.0.15-1~deb12u1', 'fixed'],
      ['CVE-2026-91201', 'openssl', 'CRITICAL', 'Buffer over-read in X.509 name-constraint checking during TLS handshakes', ['3.0.14-1~deb12u2'], '3.0.15-1~deb12u1', 'fixed'],
      ['CVE-2026-91202', 'jinja2', 'HIGH', 'Sandbox escape through the |attr filter', ['3.1.3'], '3.1.4', 'fixed'],
      ['CVE-2026-91203', 'cryptography', 'HIGH', 'NULL dereference when loading a malformed PKCS#12 bundle', ['42.0.4', '43.0.1'], '', 'affected', 'pkcs12|load_key_and_certificates',
        { d: 'not_affected', j: 'vulnerable_code_not_in_execute_path', detail: 'Beacon uses cryptography only for Fernet tokens (src/beacon/tokens.py), no PKCS#12 loading anywhere' }],
      ['CVE-2026-91204', 'git', 'HIGH', 'Code execution when cloning a repository with crafted submodules', ['1:2.39.5-0+deb12u1'], '1:2.39.5-0+deb12u2', 'fixed', null,
        { d: 'not_affected', j: 'component_not_present', detail: 'git is installed only in the builder stage, the final image has no git' }],
      ['CVE-2026-91205', 'libcurl4', 'CRITICAL', 'Heap overflow in the SOCKS5 proxy handshake with a long hostname', ['7.88.1-10+deb12u7'], '7.88.1-10+deb12u8', 'fixed', null,
        { d: 'not_affected', j: 'component_not_present', detail: 'libcurl4 exists only in the builder stage, the final image does not contain it' }],
      ['CVE-2026-91206', 'libexpat1', 'HIGH', 'Unbounded entity expansion in the XML parser', ['2.5.0-1+deb12u1'], '', 'affected', 'ElementTree|xml\\.etree|expat',
        { d: 'accepted', owner: 'ingest-team', expires: '2026-12-01', detail: 'partner feeds are parsed with ElementTree, no fixed package yet, feeds come only from allow-listed partners over mTLS' }],
      ['CVE-2026-91207', 'markupsafe', 'UNKNOWN', 'Possible quadratic time in escape() on crafted input (not yet scored)', ['2.1.5'], '', 'under_investigation', null,
        { d: 'under_investigation', owner: 'platform-team', expires: '2026-11-13', detail: 'not scored yet, report templates escape server-side data only, re-check when scored' }]
    ]
  };
  var S25_SRC = {
    'src/beacon/__init__.py': '"""Beacon: synthetic sensor status API (course starter service)."""\n__version__ = "1.8.0"\n',
    'src/beacon/__main__.py': 'import sys\n\nfrom beacon import api, worker\n\n\ndef main():\n    role = sys.argv[1] if len(sys.argv) > 1 else "api"\n    return {"api": api.serve, "worker": worker.run}[role]()\n\n\nif __name__ == "__main__":\n    sys.exit(main())\n',
    'src/beacon/config.py': '"""Load settings from /etc/beacon/beacon.yaml."""\nimport os\n\nimport yaml\n\n\ndef load(path=None):\n    path = path or os.environ.get("BEACON_CONFIG", "/etc/beacon/beacon.yaml")\n    with open(path, encoding="utf-8") as fh:\n        return yaml.safe_load(fh) or {}\n',
    'src/beacon/store.py': '"""Record store: SQLite with a full-text index for search."""\nimport sqlite3\n\n\ndef connect(path):\n    conn = sqlite3.connect(path)\n    conn.execute("CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(sensor, status)")\n    return conn\n\n\ndef search(conn, text):\n    # /v1/records/search?q=... : the caller\'s text goes straight to FTS5\n    sql = "SELECT rowid, sensor, status FROM records_fts WHERE records_fts MATCH ? LIMIT 50"\n    return conn.execute(sql, (text,)).fetchall()\n',
    'src/beacon/forwarder.py': '"""Forward accepted batches to the archive service through the egress proxy."""\nimport os\n\nimport requests\n\nPROXIES = {"https": os.environ.get("BEACON_EGRESS_PROXY", "http://proxy.corp.lab:3128")}\n\n\ndef forward(batch, url):\n    r = requests.post(url, json=batch, proxies=PROXIES, timeout=5, allow_redirects=True)\n    r.raise_for_status()\n    return r.status_code\n',
    'src/beacon/feeds.py': '"""Partner status feeds (XML) pulled every five minutes."""\nimport xml.etree.ElementTree as ET\n\n\ndef parse(body):\n    root = ET.fromstring(body)\n    return [{"sensor": n.get("id"), "status": n.findtext("status")} for n in root.iter("sensor")]\n',
    'src/beacon/report.py': '"""Daily HTML status report."""\nfrom jinja2 import Environment, PackageLoader, select_autoescape\n\nenv = Environment(loader=PackageLoader("beacon"), autoescape=select_autoescape())\n\n\ndef render(rows):\n    return env.get_template("report.html").render(rows=rows)\n',
    'src/beacon/tokens.py': '"""Short-lived API tokens (lab key material only)."""\nfrom cryptography.fernet import Fernet\n\n\ndef issue(key, subject):\n    return Fernet(key).encrypt(subject.encode())\n\n\ndef check(key, token, ttl=900):\n    return Fernet(key).decrypt(token, ttl=ttl).decode()\n'
  };
  var S25_DOCKERFILE = '# syntax=docker/dockerfile:1\n# Build: the SBOM attestation is generated with scan-stage=true, so it lists every stage.\nFROM registry.lab/base/python:3.12.7-bookworm AS builder\nRUN apt-get update && apt-get install -y --no-install-recommends gcc-12 libc6-dev linux-libc-dev git make binutils libcurl4\nCOPY requirements.txt /src/\nRUN pip wheel --wheel-dir /wheels -r /src/requirements.txt\n\nFROM registry.lab/base/python:3.12.7-slim-bookworm\nRUN useradd --system --uid 10001 beacon\nCOPY --from=builder /wheels /wheels\nRUN pip install --no-index --find-links /wheels /wheels/* && rm -rf /wheels\nCOPY src/ /app/\nUSER 10001\nENTRYPOINT ["python", "-m", "beacon", "api"]\n';
  var S25_TRIAGE = '# Vulnerability triage for registry.lab/beacon/api 1.8.0 (read by `scan --ignorefile` and `gate`).\n# One entry per finding you decide on:\n#   - id: CVE-…                 the advisory id exactly as the scanner prints it\n#     decision: not_affected | accepted | under_investigation | fixed\n#     justification: (not_affected only) component_not_present | vulnerable_code_not_present |\n#                    vulnerable_code_not_in_execute_path | vulnerable_code_cannot_be_controlled_by_adversary |\n#                    inline_mitigations_already_exist\n#     detail: "the evidence, in one sentence"\n#     owner: (accepted / under_investigation) who re-checks it\n#     expires: (accepted / under_investigation) YYYY-MM-DD, at most 90 days out\nfindings:\n';
  var S25_GATE = '# Release gate for Beacon images (read by `gate`). Changes need security review.\npolicy:\n  fail_on: [CRITICAL, HIGH, UNKNOWN]\n  ignorefile: triage.yaml\n  suppress_fixable_in_final: false\n  accept_max_days: 90\n';
  var S25_NOTES = '# Beacon 1.8.0 release notes (draft)\n\n## Changes\n- Partner XML feeds are ingested every five minutes.\n- Full-text search: /v1/records/search?q=...\n- Daily HTML status report.\n\n## Security\nTODO(release manager): summarise the scan triage: what was patched, what is not affected and why, what risk is accepted, by whom and until when.\n';

  function s25Adv(v) {
    return S25_GATING[v].concat(S25_NOISE).map(function (r) {
      return { id: r[0], pkg: r[1], sev: r[2], title: r[3], vers: r[4], fixed: r[5], status: r[6], fn: r[7] || null, t: r[8] || null };
    });
  }
  function s25Pins(text) {
    var pins = {};
    String(text || '').split('\n').forEach(function (l) { var m = /^\s*([A-Za-z0-9_.-]+)\s*==\s*(\S+)/.exec(l); if (m) pins[m[1].toLowerCase()] = m[2]; });
    return pins;
  }
  function s25BaseOf(text) {
    var froms = [], re = /^FROM\s+(\S+)(\s+AS\s+\S+)?\s*$/gim, m;
    while ((m = re.exec(String(text || '')))) froms.push(m[1]);
    var last = froms[froms.length - 1] || '';
    return (/^registry\.lab\/base\/python:(.+)$/.exec(last) || [])[1] || last;
  }
  function s25Components(img) {
    var out = [], b = S25_BASES[img.base];
    Object.keys(b.os).forEach(function (k) { out.push({ name: k, ver: b.os[k], type: 'debian', stage: 'final', by: 'FROM registry.lab/base/python:' + img.base }); });
    var py = Object.assign({}, b.py, img.pins);
    Object.keys(py).forEach(function (k) { out.push({ name: k, ver: py[k], type: 'python-pkg', stage: 'final', by: 'RUN pip install --no-index --find-links /wheels /wheels/*' }); });
    Object.keys(S25_BUILDER).forEach(function (k) { out.push({ name: k, ver: S25_BUILDER[k], type: 'debian', stage: 'builder', by: 'RUN apt-get install -y --no-install-recommends gcc-12 libc6-dev linux-libc-dev git make binutils libcurl4' }); });
    return out;
  }
  var SEV_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];
  function s25Findings(s) {
    var comps = s25Components(s.img), out = [];
    comps.forEach(function (c) {
      s.adv.forEach(function (a) {
        if (a.pkg === c.name && a.vers.indexOf(c.ver) !== -1) out.push({ id: a.id, pkg: c.name, ver: c.ver, type: c.type, stage: c.stage, by: c.by, sev: a.sev, status: a.status, fixed: a.fixed, title: a.title, adv: a });
      });
    });
    return out.sort(function (x, y) { return SEV_ORDER.indexOf(x.sev) - SEV_ORDER.indexOf(y.sev) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0); });
  }
  function s25SrcText(w) { return Object.keys(S25_SRC).map(function (p) { return SIM().readFile(w, S25_DIR + '/' + p) || ''; }).join('\n'); }
  /* what a finding really is, decided from the image, the advisory and the source as they are now */
  function s25Class(w, f) {
    if (f.stage === 'builder') return 'build';
    if (f.fixed) return 'fix';
    if (f.status === 'under_investigation' || f.sev === 'UNKNOWN') return 'unknown';
    if (f.adv.fn && !new RegExp(f.adv.fn).test(s25SrcText(w))) return 'unused';
    return 'accept';
  }
  function s25Triage(text) {
    var entries = [], cur = null;
    String(text || '').split('\n').forEach(function (l) {
      if (/^\s*#/.test(l) || !l.trim()) return;
      var m = /^\s*-\s+id\s*:\s*(.*)$/.exec(l);
      if (m) { cur = { id: m[1].replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '') }; entries.push(cur); return; }
      var k = /^\s+([a-z_]+)\s*:\s*(.*)$/.exec(l);
      if (k && cur) cur[k[1]] = k[2].replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '');
    });
    var by = {};
    entries.forEach(function (e) { by[e.id] = e; });
    return { entries: entries, by: by, wildcard: entries.filter(function (e) { return /\*/.test(e.id) || /^(all|any)$/i.test(e.id); })[0] || null };
  }
  function s25EntryFor(tr, id) { return tr.by[id] || tr.wildcard || null; }
  function s25DateOk(d) { return /^\d{4}-\d\d-\d\d$/.test(d || '') && d > S25_TODAY && d <= S25_MAXDAY; }
  function s25OwnerOk(o) { return !!o && !/^(tbd|todo|none|n\/a|-|\?)$/i.test(o); }
  function s25FailOn(text) {
    var v = SIM().yamlGet(text || '', 'policy.fail_on') || '';
    return v.replace(/[\[\]]/g, '').split(',').map(function (x) { return x.trim().toUpperCase(); }).filter(Boolean);
  }

  function s25World(seed) {
    var S = SIM(), v = S.variantOf(seed, ['a', 'b']);
    var s = { clock: 0, risky: [], hooks: [], variant: v, adv: s25Adv(v), builds: 1, lastGate: null, gateOverride: false };
    s.img = { n: 1, tag: 'registry.lab/beacon/api:1.8.0-rc1', base: '3.12.7-slim-bookworm', pins: s25Pins(S25_REQS) };
    s.img.digest = 'sha256:' + h64('S25-' + v + JSON.stringify(s.img));
    s.reachRe = v === 'a' ? 'safe_load|full_load|FullLoader|MATCH|import yaml|sqlite3' : 'pkcs12|Fernet|cryptography|ElementTree|etree';
    function file(w, p) { return S.readFile(w, S25_DIR + '/' + p); }
    function policy(w) { var t = file(w, 'release-gate.yaml') || ''; return { failOn: s25FailOn(t), ignorefile: (S.yamlGet(t, 'policy.ignorefile') || 'triage.yaml').trim() }; }
    function findingsNow() { return s25Findings(s); }
    function gating(failOn) { return findingsNow().filter(function (f) { return failOn.indexOf(f.sev) !== -1; }); }
    /* a release gate decides on the form of the triage; whether its claims are TRUE is the reviewer's job (the objectives) */
    function evalGate(w, failOn, ignorefile) {
      var tr = s25Triage(file(w, ignorefile) || ''), lines = [], block = 0, seen = {};
      gating(failOn).forEach(function (f) {
        var key = f.id + '/' + f.pkg; if (seen[key]) return; seen[key] = 1;
        var e = s25EntryFor(tr, f.id), tag = f.id + '  ' + f.pkg + ' ' + f.ver + '  ' + f.sev, why = null, okWhy = '';
        var fixableFinal = f.stage === 'final' && !!f.fixed;
        if (!e) why = 'untriaged' + (fixableFinal ? ' (fix available: ' + f.fixed + ')' : '');
        else if (e.decision === 'not_affected') {
          if (VEX.indexOf(e.justification) === -1) why = 'not_affected needs a VEX justification (' + VEX.join(' | ') + ')';
          else if (fixableFinal) why = 'fix available (' + f.fixed + ') in the final image: patch it; policy does not allow suppressing a fixable finding';
          else okWhy = 'not_affected (' + e.justification + ')';
        } else if (e.decision === 'accepted' || e.decision === 'affected' || e.decision === 'under_investigation') {
          if (fixableFinal) why = 'fix available (' + f.fixed + ') in the final image: patch it instead of accepting the risk';
          else if (!s25OwnerOk(e.owner)) why = e.decision + ' needs an owner';
          else if (!s25DateOk(e.expires)) why = e.decision + ' needs expires: YYYY-MM-DD after ' + S25_TODAY + ' and no later than ' + S25_MAXDAY;
          else okWhy = e.decision + ' (owner ' + e.owner + ', expires ' + e.expires + ')';
        } else if (e.decision === 'fixed') why = 'triage says fixed, but the scanned image still has ' + f.pkg + ' ' + f.ver;
        else why = 'unknown decision "' + (e.decision || '') + '"';
        if (why) { block++; lines.push('  BLOCK  ' + tag + '  ' + why); } else lines.push('  ok     ' + tag + '  ' + okWhy + (tr.by[f.id] ? '' : '  [matched wildcard "' + tr.wildcard.id + '"]'));
      });
      var present = {}; findingsNow().forEach(function (f) { present[f.id] = 1; });
      tr.entries.forEach(function (e) { if (!/\*/.test(e.id) && !present[e.id]) lines.push('  note   ' + e.id + '  not in this image any more: stale triage entry'); });
      return { pass: block === 0, block: block, lines: lines, entries: tr.entries.length };
    }
    s.api = {
      patched: function (w) { return !findingsNow().some(function (f) { return ['CRITICAL', 'HIGH', 'UNKNOWN'].indexOf(f.sev) !== -1 && s25Class(w, f) === 'fix'; }); },
      truthful: function (w) {
        var tr = s25Triage(file(w, 'triage.yaml') || '');
        if (tr.wildcard) return false;
        return s.adv.filter(function (a) { return ['CRITICAL', 'HIGH', 'UNKNOWN'].indexOf(a.sev) !== -1; }).every(function (a) {
          var f = s25Findings({ img: { base: '3.12.7-slim-bookworm', pins: s25Pins(S25_REQS) }, adv: [a] })[0];
          if (!f) return true;
          var cls = s25Class(w, f), e = tr.by[a.id];
          if (cls === 'fix') return true;   /* patched, checked by api.patched */
          if (!e) return false;
          if (cls === 'build') return e.decision === 'not_affected' && e.justification === 'component_not_present';
          if (cls === 'unused') return e.decision === 'not_affected' && e.justification === 'vulnerable_code_not_in_execute_path';
          var okD = cls === 'unknown' ? ['under_investigation', 'accepted', 'affected'] : ['accepted', 'affected', 'under_investigation'];
          return okD.indexOf(e.decision) !== -1 && s25OwnerOk(e.owner) && s25DateOk(e.expires);
        });
      },
      gate: function (w) { var p = policy(w); return evalGate(w, p.failOn, p.ignorefile); }
    };
    function sevList(x) { return String(x).split(',').map(function (y) { return y.trim().toUpperCase(); }).filter(Boolean); }
    var verbs = {
      scan: function (w, a) {
        var f = multi(a, ['format', 'severity', 'ignorefile', 'exit-code', 'f', 'output']);
        if (a[0] === '--help' || a[0] === '-h') return S.ok('scan (simulation; a trivy/grype-like stand-in over the image\'s SBOM attestation)\nUsage: scan [IMAGE] [--format table|json] [--severity LIST] [--ignorefile FILE] [--exit-code N]\nIMAGE defaults to the last image `rebuild` produced (' + s.img.tag + ').');
        var target = f.pos[0];
        if (target && target !== s.img.tag && target !== '.' && !/^registry\.lab\/beacon\/api(:1\.8\.0)?$/.test(target)) return S.err('scan: ' + target + ': ' + (target.indexOf('registry.lab/beacon/api') === 0 ? 'not the current build; scan ' + s.img.tag + ' (older builds are not kept in this simulation)' : 'image not found locally (built here: ' + s.img.tag + ')'));
        var list = findingsNow(), sevs = one(f, 'severity'), ign = one(f, 'ignorefile'), fmt = one(f, 'format') || one(f, 'f') || 'table', suppressed = [];
        if (sevs) { var want = sevList(sevs); list = list.filter(function (x) { return want.indexOf(x.sev) !== -1; }); }
        if (ign) {
          var t = S.readFile(w, ign.charAt(0) === '/' ? ign : S25_DIR + '/' + ign.replace(/^\.\//, ''));
          if (t == null) return S.err('scan: --ignorefile ' + ign + ': no such file');
          var tr = s25Triage(t);
          list = list.filter(function (x) { var e = s25EntryFor(tr, x.id); if (e && e.decision) { suppressed.push({ f: x, d: e.decision }); return false; } return true; });
        }
        var code = list.length && one(f, 'exit-code') ? Number(one(f, 'exit-code')) || 0 : 0;
        if (fmt === 'json') {
          var group = function (type) { return list.filter(function (x) { return x.type === type; }).map(function (x) { return { VulnerabilityID: x.id, PkgName: x.pkg, InstalledVersion: x.ver, FixedVersion: x.fixed || undefined, Status: x.status, Severity: x.sev, Title: x.title, Layer: { Stage: x.stage, CreatedBy: x.by } }; }); };
          var doc = { SchemaVersion: 2, ArtifactName: s.img.tag, ArtifactType: 'container_image', Metadata: { ImageID: s.img.digest, Source: 'SBOM attestation (BuildKit, scan-stage=true: every stage)' },
            Results: [{ Target: s.img.tag + ' (debian ' + S25_BASES[s.img.base].debian + ')', Class: 'os-pkgs', Type: 'debian', Vulnerabilities: group('debian') }, { Target: 'Python', Class: 'lang-pkgs', Type: 'python-pkg', Vulnerabilities: group('python-pkg') }] };
          return { out: JSON.stringify(doc, null, 2) + '\n', code: code };
        }
        var counts = {}; SEV_ORDER.forEach(function (k) { counts[k] = 0; }); list.forEach(function (x) { counts[x.sev]++; });
        var out = s.img.tag + ' (debian ' + S25_BASES[s.img.base].debian + ')  ' + s.img.digest.slice(0, 19) + '…\nSource: SBOM attestation (BuildKit, scan-stage=true: every stage of the build)\nAdvisory data: invented for this lab.\n\nTotal: ' + list.length + ' (UNKNOWN: ' + counts.UNKNOWN + ', LOW: ' + counts.LOW + ', MEDIUM: ' + counts.MEDIUM + ', HIGH: ' + counts.HIGH + ', CRITICAL: ' + counts.CRITICAL + ')\n\n';
        out += list.length ? S.table(['Library', 'Type', 'Vulnerability', 'Severity', 'Status', 'Installed', 'Fixed', 'Title'], list.map(function (x) { return [x.pkg, x.type === 'debian' ? 'deb' : 'pypi', x.id, x.sev, x.status, x.ver, x.fixed || '-', x.title]; })) : '(no findings)\n';
        if (ign) {
          var byD = {}; suppressed.forEach(function (x) { byD[x.d] = (byD[x.d] || 0) + 1; });
          out += '\nSuppressed by ' + ign + ': ' + suppressed.length + (suppressed.length ? ' (' + Object.keys(byD).map(function (k) { return k + ' ' + byD[k]; }).join(', ') + ')' : '') + '\n';
        }
        return { out: out, code: code };
      },
      sbom: function (w, a) {
        var f = multi(a, ['stage', 'format']), stage = one(f, 'stage');
        if (a[0] === '--help') return S.ok('sbom (simulation): list the SBOM attestation of the current build\nUsage: sbom [IMAGE] [--stage final|builder] [--format table|json]');
        var comps = s25Components(s.img).filter(function (c) { return !stage || c.stage === stage; });
        if (stage && stage !== 'final' && stage !== 'builder') return S.err('sbom: unknown stage "' + stage + '" (stages in this build: builder, final)');
        if (one(f, 'format') === 'json') return S.ok(JSON.stringify({ spdxVersion: 'SPDX-2.3', name: s.img.tag, packages: comps.map(function (c) { return { name: c.name, versionInfo: c.ver, comment: 'type=' + c.type + '; stage=' + c.stage + '; created by: ' + c.by }; }) }, null, 2));
        return S.ok('SBOM ' + s.img.tag + ' (BuildKit attestation, scan-stage=true)\n' + S.table(['NAME', 'VERSION', 'TYPE', 'STAGE'], comps.map(function (c) { return [c.name, c.ver, c.type, c.stage]; })) +
          'stage "final" is the image that ships; stage "builder" exists only during the build.');
      },
      rebuild: function (w, a) {
        var f = multi(a, ['bump']);
        if (a[0] === '--help') return S.ok('rebuild (simulation of `docker buildx build --sbom=true --attest type=sbom,scan-stage=true`)\nUsage: rebuild [--bump NAME==VERSION]... [--bump base=TAG]\n--bump edits requirements.txt (or the final FROM in the Dockerfile) and then builds. Editing those files yourself and running `rebuild` is the same.');
        var req = file(w, 'requirements.txt'), dock = file(w, 'Dockerfile'), log = [];
        if (req == null || dock == null) return S.err('rebuild: requirements.txt and Dockerfile are needed in ' + S25_DIR);
        (f.bump || []).forEach(function (b) {
          var mb = /^base=(.+)$/.exec(b), mp = /^([A-Za-z0-9_.-]+)==(\S+)$/.exec(b);
          if (mb) { dock = dock.replace(/^(FROM\s+registry\.lab\/base\/python:)(\S+)(\s*)$/m, function (all, p1, p2, p3) { return /bookworm$/.test(p2) && /slim/.test(p2) ? p1 + mb[1] + p3 : all; }); log.push('bumped final base image to ' + mb[1]); }
          else if (mp) {
            var re = new RegExp('^' + mp[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '==.*$', 'mi');
            req = re.test(req) ? req.replace(re, mp[1].toLowerCase() + '==' + mp[2]) : req.replace(/\n?$/, '\n') + mp[1].toLowerCase() + '==' + mp[2] + '\n';
            log.push('pinned ' + mp[1].toLowerCase() + '==' + mp[2] + ' in requirements.txt');
          } else log.push('ignored --bump "' + b + '" (want NAME==VERSION or base=TAG)');
        });
        S.writeFile(w, S25_DIR + '/requirements.txt', req); S.writeFile(w, S25_DIR + '/Dockerfile', dock);
        var base = s25BaseOf(dock), pins = s25Pins(req);
        if (!S25_BASES[base]) return S.err((log.length ? log.join('\n') + '\n' : '') + 'ERROR: failed to solve: registry.lab/base/python:' + base + ': failed to resolve source metadata: not found\n(the internal mirror has: ' + Object.keys(S25_BASES).join(', ') + ')');
        var bad = Object.keys(pins).filter(function (k) { return !S25_PYPI[k] || S25_PYPI[k].indexOf(pins[k]) === -1; })[0];
        if (bad) return S.err((log.length ? log.join('\n') + '\n' : '') + ' => [builder 4/4] RUN pip wheel --wheel-dir /wheels -r /src/requirements.txt\nERROR: Could not find a version that satisfies the requirement ' + bad + '==' + pins[bad] + ' (from versions: ' + ((S25_PYPI[bad] || []).join(', ') || 'none') + ')\nERROR: No matching distribution found for ' + bad + '==' + pins[bad] + '\nERROR: failed to solve: process "/bin/sh -c pip wheel ..." did not complete successfully: exit code: 1');
        s.builds++;
        s.img = { n: s.builds, tag: 'registry.lab/beacon/api:1.8.0-rc' + s.builds, base: base, pins: pins };
        s.img.digest = 'sha256:' + h64('S25-' + v + JSON.stringify(s.img));
        return S.ok((log.length ? log.join('\n') + '\n' : '') + '[+] Building 47.3s (15/15) FINISHED (simulated)\n => [builder 1/4] FROM registry.lab/base/python:3.12.7-bookworm\n => [stage-1 1/5] FROM registry.lab/base/python:' + base + '\n => [builder 4/4] RUN pip wheel --wheel-dir /wheels -r /src/requirements.txt\n' +
          Object.keys(pins).map(function (k) { return '    Saved ./' + k + '-' + pins[k] + '-py3-none-any.whl'; }).join('\n') + '\n => exporting to image, attaching SBOM attestation (scan-stage=true)\n => naming to ' + s.img.tag + '@' + s.img.digest);
      },
      triage: function (w, a) {
        var sub = a[0], path = S25_DIR + '/triage.yaml';
        if (sub === 'list') {
          var tr = s25Triage(S.readFile(w, path) || '');
          if (!tr.entries.length) return S.ok('(triage.yaml has no entries yet)');
          return S.ok(S.table(['ID', 'DECISION', 'JUSTIFICATION', 'OWNER', 'EXPIRES'], tr.entries.map(function (e) { return [e.id, e.decision || '-', e.justification || '-', e.owner || '-', e.expires || '-']; })));
        }
        if (sub === 'add' && a[1]) {
          var f = multi(a.slice(2), ['decision', 'justification', 'detail', 'owner', 'expires']);
          if (!one(f, 'decision')) return S.err('triage add: --decision is required (not_affected | accepted | under_investigation | fixed)');
          var block = '  - id: ' + a[1] + '\n    decision: ' + one(f, 'decision') + '\n' + (one(f, 'justification') ? '    justification: ' + one(f, 'justification') + '\n' : '') +
            (one(f, 'detail') ? '    detail: "' + String(one(f, 'detail')).replace(/"/g, '\'') + '"\n' : '') + (one(f, 'owner') ? '    owner: ' + one(f, 'owner') + '\n' : '') + (one(f, 'expires') ? '    expires: ' + one(f, 'expires') + '\n' : '');
          var cur = S.readFile(w, path); if (cur == null) cur = 'findings:\n';
          S.writeFile(w, path, cur.replace(/\n?$/, '\n') + block);
          return S.ok('appended ' + a[1] + ' to triage.yaml');
        }
        return S.ok('triage is a SIMULATION convenience that appends an entry to triage.yaml (editing the file with printf >> or sed works the same).\nUsage: triage add ID --decision D [--justification J] [--detail "TEXT"] [--owner O] [--expires YYYY-MM-DD]\n       triage list');
      },
      gate: function (w, a) {
        var f = multi(a, ['severity', 'ignorefile']), p = policy(w);
        var failOn = one(f, 'severity') ? sevList(one(f, 'severity')) : p.failOn, ign = one(f, 'ignorefile') || p.ignorefile;
        var override = !!one(f, 'severity') || !!one(f, 'ignorefile');
        if (one(f, 'severity') && failOn.indexOf('CRITICAL') === -1) s.gateHidCritical = true;
        var r = evalGate(w, failOn, ign);
        s.lastGate = { pass: r.pass, override: override, at: s.clock };
        return { out: 'release-gate (simulation) · policy release-gate.yaml' + (override ? ' (OVERRIDDEN on the command line)' : '') + '\nimage ' + s.img.tag + '@' + s.img.digest.slice(0, 19) + '…\nfail_on: ' + failOn.join(', ') + ' · ignorefile: ' + ign + ' (' + r.entries + ' entries)\n' + (r.lines.join('\n') || '  (nothing at these severities)') + '\nRESULT: ' + (r.pass ? 'PASS' : 'FAIL (' + r.block + ' blocking)') + '\n', code: r.pass ? 0 : 1 };
      },
      edit: S.verbs.edit()
    };
    var files = [{ path: S25_DIR + '/Dockerfile', content: S25_DOCKERFILE }, { path: S25_DIR + '/requirements.txt', content: S25_REQS }, { path: S25_DIR + '/triage.yaml', content: S25_TRIAGE },
      { path: S25_DIR + '/release-gate.yaml', content: S25_GATE }, { path: S25_DIR + '/RELEASE_NOTES.md', content: S25_NOTES }];
    Object.keys(S25_SRC).forEach(function (p) { files.push({ path: S25_DIR + '/' + p, content: S25_SRC[p] }); });
    return { user: 'lab', host: 'build-1', cwd: S25_DIR, dirs: [{ path: S25_DIR }, { path: S25_DIR + '/src/beacon' }], files: files, sre: s, extra: S.bind(s, verbs) };
  }
  function s25TriageCmds(v) {
    return S25_GATING[v].filter(function (r) { return r[8]; }).map(function (r) {
      var t = r[8];
      return 'triage add ' + r[0] + ' --decision ' + t.d + (t.j ? ' --justification ' + t.j : '') + (t.owner ? ' --owner ' + t.owner + ' --expires ' + t.expires : '') + ' --detail "' + t.detail + '"';
    });
  }
  function s25Printf(v) {
    return S25_GATING[v].filter(function (r) { return r[8]; }).map(function (r) {
      var t = r[8];
      return "printf '  - id: %s\\n    decision: %s\\n" + (t.j ? '    justification: ' + t.j + '\\n' : '') + (t.owner ? '    owner: ' + t.owner + '\\n    expires: ' + t.expires + '\\n' : '') + "    detail: \"%s\"\\n' " + r[0] + ' ' + t.d + " '" + t.detail.replace(/'/g, '') + "' >> triage.yaml";
    });
  }
  var S25_PALETTE = ['scan', 'scan --format json', 'scan --ignorefile triage.yaml', 'sbom --stage builder', 'grep -rn "yaml" src/', 'cat requirements.txt', 'rebuild --bump NAME==VERSION', 'triage add', 'triage list', 'gate'];
  var S25_COMPLIANCE = /\b(fedramp|il ?[2-6]|cmmc|stig|soc ?2|hipaa|pci[- ]dss|ato)\b[^\n]{0,60}\b(compliant|compliance|certified|authori[sz]ed|accredited|approved)\b|\b(compliant|certified|accredited)\b[^\n]{0,40}\b(fedramp|il ?[2-6]|cmmc|stig)\b/i;

  LX.missions.push({
    id: 'sre-s25', track: 'sre', cat: 'scenario', level: 'intermediate', mins: 25, kind: 'incident',
    title: 'Beacon 1.8.0 release blocked by its image scan',
    brief: function () { return 'Beacon 1.8.0 is due to ship today and the release gate is red: the image scan lists about two dozen findings, several CRITICAL and HIGH. You are on build-1 in /home/lab/beacon-release with the Dockerfile, the pinned requirements, the source, an empty triage.yaml and the gate policy. Decide what each blocking finding really means for this image, change what needs changing, record the rest so a reviewer can check it, and get an honest green gate.'; },
    keys: S25_PALETTE,
    world: s25World,
    objectives: [
      { id: 'scan', stage: 'evidence', text: 'Run the scan and read which findings block the release, not just the totals',
        hint: 'The gate fails on some severities only. Which rows are those, and what does each say about a fix?', hint2: '`scan` prints a table; `--format json` adds where each package came from.',
        reveal: 'scan',
        done: function (c) { return saw(c, /scan\b/, /CRITICAL/); } },
      { id: 'sbom', stage: 'evidence', text: 'Establish which packages actually ship in the final image and which exist only during the build',
        hint: 'The scanner read an SBOM of the whole build. Is every package in it part of what runs?', hint2: '`sbom` (or `sbom --stage builder`) shows the stage of each component; the JSON scan output carries it too.',
        reveal: 'sbom --stage builder',
        done: function (c) { return saw(c, /sbom\b/, /builder/) || saw(c, /scan\b.*json/, /"Stage": "builder"/); } },
      { id: 'reach', stage: 'evidence', text: 'Check in the source whether the flagged libraries are used the way the advisories describe',
        hint: 'An advisory names a function or feature. A package being installed does not mean that code path runs.', hint2: 'grep the source for the modules and functions the titles mention.',
        reveal: function (c) { return st(c).variant === 'a' ? 'grep -rnE "yaml|MATCH|sqlite3|idna" src/' : 'grep -rnE "cryptography|pkcs12|etree|markupsafe" src/'; },
        done: function (c) { return saw(c, /(grep|cat|head|less|tail)\b.*(src|\.py)/, new RegExp(st(c).reachRe)); } },
      { id: 'patch', stage: 'fix', text: 'Rebuild so every blocking finding that already has a fixed version is gone from the image',
        hint: 'A fixed version that is available is a patch, not a decision.', hint2: 'Bump the pinned dependency (or the base image) and rebuild: `rebuild --bump NAME==VERSION`, or edit the file and `rebuild`.',
        reveal: function (c) { return st(c).variant === 'a' ? 'rebuild --bump urllib3==2.2.2 --bump certifi==2024.8.30' : 'rebuild --bump base=3.12.8-slim-bookworm --bump jinja2==3.1.4'; },
        done: function (c) { return st(c).img.n > 1 && st(c).api.patched(c.w); } },
      { id: 'triage', stage: 'fix', text: 'Record a reviewable decision for every remaining blocking finding: justification for not affected, owner and expiry for accepted or open risk',
        hint: 'Each remaining row is one of: not in what ships, present but its vulnerable code is never called, or present and possibly reachable with no fix yet.', hint2: 'VEX-style: `not_affected` + `component_not_present` or `vulnerable_code_not_in_execute_path`; otherwise `accepted`/`under_investigation` with an owner and an expiry within 90 days. `triage add …` appends an entry.',
        reveal: function (c) { return s25TriageCmds(st(c).variant).join(' && '); },
        explain: 'Builder-only packages never ship, so the component is not present in the product. A library whose vulnerable function is never called is present but the vulnerable code is not in the execute path. Something reachable with no fix, or not yet scored, is a risk someone owns until a date.',
        done: function (c) { return st(c).api.truthful(c.w); } },
      { id: 'gate', stage: 'verify', text: 'Run the release gate under its own policy and get a pass',
        hint: 'The gate reads the policy file and the triage file; overriding either on the command line does not count.', hint2: '`gate`, then read every BLOCK line it prints.',
        reveal: 'gate',
        done: function (c) { var s = st(c); return !!s.lastGate && s.lastGate.pass && !s.lastGate.override && s.img.n > 1 && s.api.patched(c.w) && s.api.truthful(c.w) && lastIs(c, /gate\b/, /RESULT: PASS/); } }
    ],
    sre: {
      scenarioId: 'S25', moduleId: 'M13', lab: 'L25', variants: ['a', 'b'],
      symptom: 'The release gate fails on an image scan with about two dozen findings, several CRITICAL and HIGH.',
      neutralTitle: 'Release gate red on the image scan',
      neutralBrief: 'The Beacon 1.8.0 image scan lists about two dozen findings and the release gate fails. Decide what each blocking finding means for this image, change what needs changing, record the rest so it can be reviewed, and get the gate to pass honestly.',
      impact: 'The 1.8.0 release (partner feeds, search, daily report) cannot ship today.',
      changes: 'New dependencies for 1.8.0; the build now attaches an SBOM covering every stage.',
      spoilers: ['builder stage', 'component_not_present', 'not_in_execute_path', 'safe_load', 'pkcs12', 'bump', 'base image'],
      tools: ['scan [--format json] [--severity LIST] [--ignorefile FILE] [--exit-code N]', 'sbom [--stage final|builder] [--format json]', 'rebuild [--bump NAME==VERSION|base=TAG]', 'triage add|list', 'gate', 'grep, cat, sed -i, printf >>, edit'],
      grammar: ['`scan [IMAGE] [--format table|json] [--severity CRITICAL,HIGH,…] [--ignorefile triage.yaml] [--exit-code N]`', '`sbom [IMAGE] [--stage final|builder] [--format json]`', '`rebuild [--bump NAME==VERSION]… [--bump base=TAG]` (or edit requirements.txt / the final FROM and run `rebuild`)',
        '`triage add ID --decision not_affected|accepted|under_investigation|fixed [--justification J] [--detail "…"] [--owner O] [--expires YYYY-MM-DD]`, `triage list`', '`gate [--severity LIST] [--ignorefile FILE]` (overrides are reported and do not count as a release pass)', 'grep -rn, cat, sed -i, printf \'…\' >> triage.yaml, `edit FILE KEY VALUE`'],
      palette: S25_PALETTE,
      assumptions: ['Advisory ids, versions and titles are invented for the lab; they describe no real vulnerability.', 'The internal mirrors hold exactly the versions `rebuild` lists in its errors.', 'Today is 2026-10-13; accepted risk may run at most 90 days.'],
      simplified: ['The scanner matches exact installed versions against a fixed advisory list; there is no version-range logic, no CVSS vectors and no vendor severity disagreement.', 'Reachability is decided by whether the source under src/ calls the function an advisory names; real reachability also depends on dependencies, configuration and inputs.', 'The gate checks the form of the triage (decision, justification, owner, expiry, no suppression of a fixable final-image finding); whether a justification is true is what the objectives and a human reviewer check.', 'Builds are instant and change only the package set; nothing is pushed or signed here.', 'Every scenario command advances a logical clock by 10 seconds.'],
      unsafe: [
        { label: 'blanket-ignored findings', why: 'A wildcard or "all" entry suppresses every current and future finding, including ones that are reachable and fixable; the gate turns green without anyone having looked.',
          test: function (c) { return !!s25Triage(fileText(c, S25_DIR + '/triage.yaml') || '').wildcard; },
          demo: "printf '  - id: \"*\"\\n    decision: not_affected\\n    justification: component_not_present\\n' >> triage.yaml" },
        { label: 'hid criticals with a severity filter', why: 'Narrowing the gate\'s fail_on (or running it with a severity override) so CRITICAL no longer blocks makes the release look clean while the critical findings ship.',
          test: function (c) { return !!st(c).gateHidCritical || s25FailOn(fileText(c, S25_DIR + '/release-gate.yaml') || '').indexOf('CRITICAL') === -1; },
          demo: 'gate --severity MEDIUM,LOW' },
        { label: 'claimed a compliance status in the release note', why: 'A scan triage is not an authorization or a certification. Writing that the release is FedRAMP/IL-level/STIG "compliant" is an unsupported claim that others will rely on.',
          test: function (c) { return S25_COMPLIANCE.test(fileText(c, S25_DIR + '/RELEASE_NOTES.md') || ''); },
          demo: function () { return 'echo "Security: all findings triaged; this release is FedRAMP High and IL5 compliant." >> RELEASE_NOTES.md'; } }
      ],
      alt: function (v) {
        var fix = v === 'a'
          ? ["sed -i 's/^urllib3==2.0.7$/urllib3==2.2.2/' requirements.txt", "sed -i 's/^certifi==.*$/certifi==2024.8.30/' requirements.txt"]
          : ["sed -i 's/python:3.12.7-slim-bookworm/python:3.12.8-slim-bookworm/' Dockerfile", "sed -i 's/^jinja2==3.1.3$/jinja2==3.1.4/' requirements.txt"];
        return ['scan --format json', 'scan --severity CRITICAL,HIGH,UNKNOWN', v === 'a' ? 'grep -rn "yaml\\.\\|MATCH" src/beacon/' : 'grep -rn "cryptography\\|ElementTree" src/beacon/', 'cat requirements.txt']
          .concat(fix).concat(['rebuild', 'scan --severity CRITICAL,HIGH,UNKNOWN']).concat(s25Printf(v))
          .concat(['triage list', 'scan --ignorefile triage.yaml --severity CRITICAL,HIGH,UNKNOWN --exit-code 1',
            'echo "Security: patched findings with available fixes; not-affected decisions and accepted risk (owner, expiry) are recorded in triage.yaml for review." >> RELEASE_NOTES.md', 'gate']);
      },
      mechanism: 'The scanner read the build\'s SBOM attestation, which (with scan-stage=true) lists the **builder** stage as well as the image that ships, and it matches package versions against advisories without knowing how Beacon uses them. Triage sorts each blocking finding: (1) **a fixed version is available and the package ships** → patch it (bump the pin or the base image) and rebuild; suppressing it is not a decision. (2) **The package exists only in the builder stage** → not affected, `component_not_present`. (3) **The package ships but the vulnerable function is never called** (e.g. only `safe_load`, no PKCS#12 loading) → not affected, `vulnerable_code_not_in_execute_path`, with the evidence in one sentence. (4) **Reachable with no fix, or not yet scored** → accepted or under investigation, with an owner and an expiry, plus any mitigation. The gate then checks the form; a reviewer checks the claims. Nothing here makes the image "compliant" with anything: that is an authorization decision outside this work.',
      alternatives: [
        { h: 'Ignore everything below CRITICAL', out: 'Rejected: the policy fails on HIGH and UNKNOWN too, and a severity filter is not a triage.' },
        { h: 'Upgrade every package to its newest version', out: 'Over-broad: several findings have no fix at all, and builder-only packages do not ship; a big unreviewed upgrade adds release risk without clearing the gate.' },
        { h: 'Mark the reachable no-fix finding not_affected', out: 'False: the source passes user input to that code. It is accepted risk with an owner, an expiry and a mitigation.' }
      ],
      clues: ['MEDIUM and LOW rows do not block this release; they are still worth a ticket.', 'Two rows can share one advisory id (two packages from the same source).'],
      passRubric: ['Separates findings into patch, not affected (with the right justification), and owned accepted/unknown risk', 'Shows the evidence behind each not-affected claim (stage, or the function never called)', 'Patches by bumping a pinned version or the base image and rescans the new build', 'Makes no compliance or authorization claim from a scan'],
      prereqs: ['les-m13-02', 'les-m13-03'], refs: ['T10', 'T21']
    }
  });
  /* ═══ S26 · Disconnected install fails halfway ═════════════════════════ */
  var S26_MEDIA = '/media/transfer', S26_TRUST = '/etc/looped/trust', S26_LOG = '/var/log/looped/install-beacon-1.8.0.log';
  var S26_KEYS = {
    'release-2026': { fp: 'SHA256:7c2e9a41d0b35f86e1aa4c7d2f90b6e3c5d81f04a9b7e26c3d58f1a0e4b9c672', status: 'active', dist: 'yes (2025-12 key ceremony, delivered out of band)' },
    'release-2027': { fp: 'SHA256:3f9a6c20e18b47d5a2c9f0e7b6d14a83c5e2f9071b8d6a4e3c2f1b0a9d8e7c65', status: 'staged', dist: 'no: ceremony SEC-2207 on 2026-11-02; enclaves must not trust it before they receive it out of band' }
  };
  function s26KeyFile(id) { return '# LOOPED lab signing key (public half; not a real key)\nkeyid: ' + id + '\nfingerprint: ' + S26_KEYS[id].fp + '\n-----BEGIN LAB PUBLIC KEY-----\n' + hex('pub:' + id, 64) + '\n-----END LAB PUBLIC KEY-----\n'; }
  function s26Sig(id, d) { return hex('sig:' + id + ':' + d, 88); }
  function s26Digest(ref) { return 'sha256:' + hex('S26img:' + ref, 64); }
  function s26Archive(ref) { return ref.replace(/^registry\.lab\//, '').replace(/[/:]/g, '_') + '.oci.tar'; }
  /* the chart's workloads, as `helm template` renders them */
  function s26Render(ver, sets) {
    var reg = (sets && sets['global.imageRegistry']) || 'registry.lab', mig = !(sets && /^false$/i.test(sets['migrate.enabled'] || ''));
    return [
      { name: 'beacon-api', kind: 'Deployment', init: mig ? [{ name: 'migrate', ref: reg + '/beacon/migrate:' + ver }] : [], containers: [{ name: 'api', ref: reg + '/beacon/api:' + ver }] },
      { name: 'beacon-worker', kind: 'Deployment', init: [], containers: [{ name: 'worker', ref: reg + '/beacon/worker:' + ver }] },
      { name: 'beacon-redis', kind: 'StatefulSet', init: [], containers: [{ name: 'redis', ref: reg + '/library/redis:7.2.5' }] }
    ];
  }
  function s26ImagesFrom(ver, mode) {
    var all = [];
    s26Render(ver, {}).forEach(function (wl) { wl.init.concat(wl.containers).forEach(function (c) { all.push(c.ref); }); });
    /* values.yaml lists the images it parameterises; the init container's image is written in the template */
    return mode === 'values' ? all.filter(function (r) { return !/\/migrate:/.test(r); }) : all;
  }
  function s26Template(ver, sets) {
    return s26Render(ver, sets).map(function (wl) {
      return '---\n# Source: beacon/' + (wl.name === 'beacon-redis' ? 'charts/redis/templates/statefulset.yaml' : 'templates/' + wl.name.replace('beacon-', '') + '.yaml') + '\napiVersion: apps/v1\nkind: ' + wl.kind + '\nmetadata:\n  name: ' + wl.name + '\n  namespace: beacon\nspec:\n  template:\n    spec:\n' +
        (wl.init.length ? '      initContainers:\n' + wl.init.map(function (c) { return '        - name: ' + c.name + '\n          image: ' + c.ref + '\n          args: ["migrate", "--to", "head"]'; }).join('\n') + '\n' : '') +
        '      containers:\n' + wl.containers.map(function (c) { return '        - name: ' + c.name + '\n          image: ' + c.ref; }).join('\n');
    }).join('\n') + '\n';
  }
  function s26MakeBundle(name, ver, mode, keyid, stamp) {
    var files = {}, imgs = s26ImagesFrom(ver, mode).map(function (ref) {
      var arch = 'images/' + s26Archive(ref), body = 'OCI image layout archive (simulated)\nref: ' + ref + '\ndigest: ' + s26Digest(ref) + '\nplatform: linux/arm64,linux/amd64\n';
      files[arch] = body;
      return { ref: ref, digest: s26Digest(ref), archive: arch, sha256: h64(body) };
    });
    var chartFile = 'charts/beacon-' + ver + '.tgz', chartBody = 'Helm chart archive (simulated)\nchart: beacon\nversion: ' + ver + '\nappVersion: ' + ver + '\ndependencies: redis 19.6.4 (vendored under charts/)\n';
    files[chartFile] = chartBody;
    files['keys/signing.pub'] = s26KeyFile(keyid);
    var manifest = JSON.stringify({ bundle: name, created: stamp, builder: 'build-1.corp.lab', imageSource: mode === 'values' ? 'values.yaml (parameterised images only)' : 'rendered manifests (helm template, all subcharts)',
      chart: { file: chartFile, sha256: h64(chartBody) }, images: imgs, signer: keyid }, null, 2) + '\n';
    var d = h64(manifest);
    files['manifest.json'] = manifest;
    files['manifest.json.sig'] = 'LAB SIGNATURE (simulated `cosign sign-blob` over manifest.json)\nkeyid: ' + keyid + '\nfingerprint: ' + S26_KEYS[keyid].fp + '\nsigned-sha256: ' + d + '\nsignature: ' + s26Sig(keyid, d) + '\n';
    return files;
  }
  function s26World(seed) {
    var S = SIM(), v = S.variantOf(seed, ['a', 'b']);
    var s = { clock: 0, risky: [], hooks: [], variant: v, verified: {}, egress: [], skipVerify: false, bundleKeyUsed: false, outbox: {}, schema: 17, loads: [] };
    s.conn = v === 'a' ? { mode: 'values', key: 'release-2026' } : { mode: 'rendered', key: 'release-2027' };
    var first = s26MakeBundle('beacon-bundle-1.8.0', '1.8.0', s.conn.mode, s.conn.key, '2026-10-13T07:58:12Z');
    s.registry = {};
    ['beacon/api:1.7.3', 'beacon/worker:1.7.3', 'beacon/migrate:1.7.3', 'library/redis:7.2.5'].forEach(function (k) { s.registry[k] = s26Digest('registry.lab/' + k); });
    if (v === 'a') {
      s26ImagesFrom('1.8.0', 'values').forEach(function (ref) { s.registry[ref.replace(/^registry\.lab\//, '')] = s26Digest(ref); });
      s.release = { name: 'beacon', ns: 'beacon', rev: 4, ver: '1.8.0', status: 'failed', prev: '1.7.3', sets: {}, desc: 'Upgrade "beacon" failed: context deadline exceeded', updated: '2026-10-13 08:47:31' };
    } else {
      s.release = { name: 'beacon', ns: 'beacon', rev: 3, ver: '1.7.3', status: 'deployed', prev: '1.7.2', sets: {}, desc: 'Upgrade complete', updated: '2026-09-08 10:12:09' };
    }
    s.history = [{ rev: 1, ver: '1.7.0', status: 'superseded', desc: 'Install complete' }, { rev: 2, ver: '1.7.2', status: 'superseded', desc: 'Upgrade complete' }, { rev: 3, ver: '1.7.3', status: v === 'a' ? 'superseded' : 'deployed', desc: 'Upgrade complete' }];
    if (v === 'a') s.history.push({ rev: 4, ver: '1.8.0', status: 'failed', desc: s.release.desc });
    s.trustInit = {}; s.trustInit[S26_TRUST + '/release-2026.pub'] = s26KeyFile('release-2026');

    function trustFiles(w) {
      var U = SH().util, out = {};
      if (!U.node(w, S26_TRUST)) return out;
      U.walk(w, S26_TRUST).forEach(function (p) { var n = U.node(w, p); if (n && n.t === 'f') out[p] = n.content || ''; });
      return out;
    }
    function keyOf(text) { var m = /^keyid:\s*(\S+)/m.exec(text || ''); return m ? m[1] : null; }
    function trustTampered(w) { var now = trustFiles(w); return JSON.stringify(now) !== JSON.stringify(s.trustInit); }
    function bdir(p) { return String(p || '').replace(/\/+$/, '').replace(/\/manifest\.json$/, ''); }
    function absb(w, p) { return SH().util.resolve(w, bdir(p)); }
    function check(w, dir, keyPath) {
      var man = S.readFile(w, dir + '/manifest.json'), sig = S.readFile(w, dir + '/manifest.json.sig');
      if (man == null) return { err: 'bundle: ' + dir + ': no manifest.json (is this a bundle directory?)' };
      if (sig == null) return { err: 'bundle: ' + dir + ': no manifest.json.sig: an unsigned bundle is never loaded here' };
      var sk = keyOf(sig), signed = (/^signed-sha256:\s*(\S+)/m.exec(sig) || [])[1], sv = (/^signature:\s*(\S+)/m.exec(sig) || [])[1];
      var keys = {};
      if (keyPath) { var kt = S.readFile(w, keyPath); if (kt == null) return { err: 'bundle verify: --key ' + keyPath + ': no such file' }; keys[keyOf(kt)] = keyPath; }
      else { var tf = trustFiles(w); Object.keys(tf).forEach(function (p) { var k = keyOf(tf[p]); if (k) keys[k] = p; }); }
      var r = { man: man, signer: sk, keys: keys, sigOk: false, sums: [], why: '' };
      var manD = h64(man);
      if (!keys[sk]) r.why = 'key ' + sk + ' (' + (S26_KEYS[sk] ? S26_KEYS[sk].fp : 'unknown fingerprint') + ') is not in the trust store';
      else if (signed !== manD) r.why = 'manifest.json changed after it was signed (signed sha256 ' + String(signed).slice(0, 12) + '…, now ' + manD.slice(0, 12) + '…)';
      else if (sv !== s26Sig(sk, signed)) r.why = 'signature does not verify with key ' + sk;
      else r.sigOk = true;
      var m; try { m = JSON.parse(man); } catch (e) { r.sigOk = false; r.why = r.why || 'manifest.json is not valid JSON'; m = { images: [] }; }
      r.m = m;
      [{ archive: m.chart && m.chart.file, sha256: m.chart && m.chart.sha256 }].concat(m.images || []).forEach(function (e) {
        if (!e.archive) return;
        var body = S.readFile(w, dir + '/' + e.archive);
        r.sums.push({ file: e.archive, ok: body != null && h64(body) === e.sha256, missing: body == null, want: e.sha256 });
      });
      r.allSums = r.sums.length > 0 && r.sums.every(function (x) { return x.ok; });
      r.ok = r.sigOk && r.allSums;
      return r;
    }
    function avail(ref) {
      var host = ref.split('/')[0];
      if (host !== 'registry.lab') return 'external';
      return s.registry[ref.slice(host.length + 1)] ? 'ok' : 'missing';
    }
    function podName(wl, ver) { return wl === 'beacon-redis' ? 'beacon-redis-0' : wl + '-' + hex(wl + ver + 'rs', 9).replace(/[0-9]/g, function (d) { return 'bcdfghjklm'.charAt(+d); }).replace(/[a]/g, 'z') + '-' + hex(wl + ver + 'pod', 5).replace(/[0-9]/g, function (d) { return 'pqrstvwxyz'.charAt(+d); }); }
    function pods() {
      var rel = s.release, out = [];
      s26Render(rel.ver, rel.sets).forEach(function (wl) {
        var st0 = 'Running', why = null, ext = null;
        wl.init.forEach(function (c) { var a = avail(c.ref); if (st0 === 'Running' && a !== 'ok') { st0 = a === 'external' ? 'Init:ErrImagePull' : 'Init:ImagePullBackOff'; why = c; ext = a === 'external'; } });
        if (st0 === 'Running') wl.containers.forEach(function (c) { var a = avail(c.ref); if (st0 === 'Running' && a !== 'ok') { st0 = a === 'external' ? 'ErrImagePull' : 'ImagePullBackOff'; why = c; ext = a === 'external'; } });
        if (st0 === 'Running' && wl.name === 'beacon-api' && !wl.init.length && rel.ver === '1.8.0' && s.schema < 18) st0 = 'CrashLoopBackOff';
        var ver = wl.name === 'beacon-redis' ? '7.2.5' : rel.ver;
        out.push({ name: podName(wl.name, wl.name === 'beacon-redis' ? 'r' : rel.ver + (Object.keys(rel.sets).length ? JSON.stringify(rel.sets) : '')), wl: wl, status: st0, why: why, ext: ext, ver: ver, ready: st0 === 'Running' });
        if (st0 !== 'Running' && wl.name !== 'beacon-redis' && rel.prev) out.push({ name: podName(wl.name, rel.prev), wl: wl, status: 'Running', ver: rel.prev, ready: true, old: true });
      });
      return out;
    }
    function healthy() { return s.release.ver === '1.8.0' && s.release.status === 'deployed' && s.schema >= 18 && pods().every(function (p) { return p.ready && !p.old; }); }
    s.api = {
      bundles: function (w) { var U = SH().util; if (!U.node(w, S26_MEDIA)) return []; return U.walk(w, S26_MEDIA).filter(function (p) { return /\/manifest\.json$/.test(p); }).map(function (p) { return p.replace(/\/manifest\.json$/, ''); }); },
      goodBundle: function (w) {
        if (trustTampered(w) || s.bundleKeyUsed) return false;
        var need = s26ImagesFrom('1.8.0', 'rendered');
        return s.api.bundles(w).some(function (dir) {
          var r = check(w, dir); if (!r.ok || s.verified[dir] !== h64(r.man)) return false;
          var have = (r.m.images || []).map(function (e) { return e.ref; });
          return need.every(function (x) { return have.indexOf(x) !== -1; });
        });
      },
      loaded: function () {
        return !s.skipVerify && s26ImagesFrom('1.8.0', 'rendered').every(function (ref) { var k = ref.replace(/^registry\.lab\//, ''); return s.registry[k] === s26Digest(ref) && s.loads.some(function (l) { return l.verified && l.refs.indexOf(ref) !== -1; }); });
      },
      healthy: healthy
    };
    function egress(kind, target) { s.egress.push({ at: s.clock, kind: kind, target: target }); return 'dial tcp: lookup ' + target.split('/')[0] + ': no such host (this enclave has no internet egress; the attempt was logged as a security event)'; }
    function nsOf(a) { var i = a.indexOf('-n'); if (i === -1) i = a.indexOf('--namespace'); return i !== -1 ? a[i + 1] : (a.indexOf('-A') !== -1 || a.indexOf('--all-namespaces') !== -1 ? '*' : 'default'); }
    function events(p) {
      var c = p.why;
      if (!c) return p.status === 'CrashLoopBackOff' ? ['Warning  BackOff  pod/' + p.name + '  Back-off restarting failed container api'] : ['Normal   Started  pod/' + p.name + '  Started container ' + p.wl.containers[0].name];
      return p.ext
        ? ['Warning  Failed   pod/' + p.name + '  Failed to pull image "' + c.ref + '": rpc error: code = Unknown desc = failed to resolve reference "' + c.ref + '": ' + 'dial tcp: lookup ' + c.ref.split('/')[0] + ': no such host']
        : ['Normal   Pulling  pod/' + p.name + '  Pulling image "' + c.ref + '"', 'Warning  Failed   pod/' + p.name + '  Failed to pull image "' + c.ref + '": rpc error: code = NotFound desc = failed to pull and unpack image "' + c.ref + '": failed to resolve reference "' + c.ref + '": ' + c.ref + ': not found',
          'Warning  Failed   pod/' + p.name + '  Error: ErrImagePull', 'Normal   BackOff  pod/' + p.name + '  Back-off pulling image "' + c.ref + '"'];
    }
    function helmInstall(w, a, upgrade) {
      var ni = a.indexOf('-n'), ns = 'default';
      if (ni !== -1) { ns = a[ni + 1] || ''; a = a.slice(0, ni).concat(a.slice(ni + 2)); }
      var f = multi(a, ['set', 'namespace', 'timeout', 'values']), pos = f.pos.filter(function (x) { return x !== '-f'; });
      if (one(f, 'namespace')) ns = one(f, 'namespace');
      var name = pos[0], chart = pos[1];
      if (!name || !chart) return S.err('Error: "helm ' + (upgrade ? 'upgrade' : 'install') + '" requires 2 arguments: RELEASE CHART');
      if (/^(oci|https?):\/\//.test(chart) || (!/\.tgz$/.test(chart) && chart.indexOf('/') !== -1 && !S.readFile(w, chart))) { return S.err('Error: ' + (upgrade ? 'UPGRADE' : 'INSTALLATION') + ' FAILED: ' + egress('chart', chart.replace(/^[a-z]+:\/\//, ''))); }
      var body = S.readFile(w, chart);
      if (body == null) return S.err('Error: path "' + chart + '" not found');
      var ver = (/^version:\s*(\S+)/m.exec(body) || [])[1];
      if (!ver) return S.err('Error: file "' + chart + '" does not appear to be a gzipped archive (not a chart this simulation knows)');
      if (name !== 'beacon') return S.err('Error: this simulation models the release "beacon" only');
      if (ns !== 'beacon') return S.err('Error: create: failed to create: namespaces "' + ns + '" not found (the release lives in -n beacon)');
      if (!upgrade && s.release) return S.err('Error: INSTALLATION FAILED: cannot re-use a name that is still in use (use helm upgrade)');
      var sets = {};
      (f.set || []).forEach(function (kv) { String(kv).split(',').forEach(function (p) { var i = p.indexOf('='); if (i > 0) sets[p.slice(0, i)] = p.slice(i + 1); }); });
      var prevVer = s.release.ver;
      s.release = { name: 'beacon', ns: 'beacon', rev: s.release.rev + 1, ver: ver, status: 'pending-upgrade', prev: prevVer !== ver ? prevVer : s.release.prev, sets: sets, updated: S.stamp(s) };
      s26Render(ver, sets).forEach(function (wl) { wl.init.concat(wl.containers).forEach(function (c) { if (avail(c.ref) === 'external') egress('image', c.ref); }); });
      var ps = pods(), api = ps.filter(function (p) { return p.wl.name === 'beacon-api' && !p.old; })[0];
      if (ver === '1.8.0' && api && api.wl.init.length && api.status === 'Running') s.schema = 18;
      ps = pods();
      var allReady = ps.every(function (p) { return p.ready && !p.old; }), wait = a.indexOf('--wait') !== -1;
      s.release.status = !wait || allReady ? 'deployed' : 'failed';
      if (allReady) s.release.prev = null;
      s.history.forEach(function (h) { if (h.status === 'deployed') h.status = 'superseded'; });
      s.history.push({ rev: s.release.rev, ver: ver, status: s.release.status, desc: s.release.status === 'deployed' ? 'Upgrade complete' : 'Upgrade "beacon" failed: context deadline exceeded' });
      if (s.release.status === 'failed') return S.err('Error: UPGRADE FAILED: context deadline exceeded (waited ' + (one(f, 'timeout') || '5m0s') + ' for all pods to become ready)');
      return S.ok('Release "beacon" has been upgraded. Happy Helming!\nNAME: beacon\nLAST DEPLOYED: ' + S.stamp(s) + '\nNAMESPACE: beacon\nSTATUS: deployed\nREVISION: ' + s.release.rev + '\nCHART: beacon-' + ver + (wait ? '' : '\n(no --wait: helm did not wait for the pods; check them)'));
    }
    var verbs = {
      bundle: function (w, a) {
        var sub = a[0];
        if (sub === 'verify') {
          var f = multi(a.slice(1), ['key']), dir = f.pos[0];
          if (!dir) return S.err('usage: bundle verify DIR [--key PUBKEY]');
          dir = absb(w, dir);
          if (f.key && one(f, 'key') === true) return S.err('bundle verify: --key needs a file');
          var kp = one(f, 'key');
          if (kp) { kp = SH().util.resolve(w, kp); if (kp.indexOf(S26_TRUST + '/') !== 0) s.bundleKeyUsed = true; }
          if (a.indexOf('--insecure-ignore-sig') !== -1 || a.indexOf('--skip-signature') !== -1) { s.skipVerify = true; }
          var r = check(w, dir, kp);
          if (r.err) return S.err(r.err);
          var out = 'bundle verify (simulation) ' + dir + '\nmanifest.json.sig: signed by ' + r.signer + ' (' + (S26_KEYS[r.signer] ? S26_KEYS[r.signer].fp : '?') + ')\n' + (kp ? 'key: ' + kp + ' (given on the command line)' : 'trust store ' + S26_TRUST + ': ' + (Object.keys(r.keys).join(', ') || '(empty)')) + '\n';
          if (!r.sigOk) return { out: out + 'signature: FAILED: ' + r.why + '\nchecksums: not checked (nothing in a bundle is trusted before its signature)\nRESULT: NOT VERIFIED\n', code: 1 };
          out += 'signature: OK\nchecksums:\n' + r.sums.map(function (x) { return '  ' + (x.ok ? 'OK      ' : x.missing ? 'MISSING ' : 'MISMATCH') + ' ' + x.file + '  ' + x.want.slice(0, 16) + '…'; }).join('\n') + '\n';
          if (!r.allSums) return { out: out + 'RESULT: NOT VERIFIED (checksum)\n', code: 1 };
          if (!kp) s.verified[dir] = h64(r.man);
          return S.ok(out + 'RESULT: VERIFIED (' + r.sums.length + '/' + r.sums.length + ' files)');
        }
        if (sub === 'inspect') {
          var d2 = a[1] ? absb(w, a[1]) : null, man = d2 && S.readFile(w, d2 + '/manifest.json');
          if (man == null) return S.err('usage: bundle inspect DIR (a directory with manifest.json)');
          var m; try { m = JSON.parse(man); } catch (e) { return S.err('bundle inspect: manifest.json is not valid JSON'); }
          var sg = S.readFile(w, d2 + '/manifest.json.sig') || '';
          return S.ok('bundle ' + m.bundle + ' · created ' + m.created + ' on ' + m.builder + '\nsigned by: ' + (keyOf(sg) || '(unsigned)') + '\nimage list from: ' + m.imageSource + '\nchart: ' + m.chart.file + '\nimages:\n' + m.images.map(function (e) { return '  ' + e.ref + '@' + e.digest.slice(0, 19) + '…'; }).join('\n'));
        }
        if (sub === 'trust') {
          if (a[1] === 'list') { var tf = trustFiles(w); return S.ok(S.table(['KEYID', 'FINGERPRINT', 'FILE'], Object.keys(tf).map(function (p) { var k = keyOf(tf[p]); return [k || '(not a key)', k && S26_KEYS[k] ? S26_KEYS[k].fp : '-', p]; }))); }
          if (a[1] === 'add' && a[2]) {
            var src = SH().util.resolve(w, a[2]), body = S.readFile(w, src);
            if (body == null) return S.err('bundle trust add: ' + a[2] + ': no such file');
            S.writeFile(w, S26_TRUST + '/' + src.split('/').pop(), body);
            return S.ok('added ' + (keyOf(body) || src) + ' to ' + S26_TRUST);
          }
          return S.ok('Usage: bundle trust list | bundle trust add PUBKEY');
        }
        return S.ok('bundle (simulation of the site bundle tool: cosign verify-blob + sha256sum + manifest reading)\nUsage: bundle verify DIR [--key PUBKEY] | bundle inspect DIR | bundle trust list | bundle trust add PUBKEY');
      },
      registry: function (w, a) {
        if (a[0] === 'load') {
          var dir = a[1] ? absb(w, a[1]) : null, skip = a.indexOf('--skip-verify') !== -1;
          var man = dir && S.readFile(w, dir + '/manifest.json');
          if (man == null) return S.err('usage: registry load DIR [--skip-verify]');
          if (!skip && s.verified[dir] !== h64(man)) return S.err('registry load: refusing ' + dir + ': it has not passed `bundle verify` against the trust store (or changed since). Runbook step 2 comes first.');
          if (skip) s.skipVerify = true;
          var m; try { m = JSON.parse(man); } catch (e) { return S.err('registry load: manifest.json is not valid JSON'); }
          var out = [];
          m.images.forEach(function (e) {
            var body = S.readFile(w, dir + '/' + e.archive);
            if (body == null) { out.push('  skip ' + e.ref + ': archive missing'); return; }
            var dgm = (/^digest:\s*(\S+)/m.exec(body) || [])[1];
            s.registry[e.ref.replace(/^registry\.lab\//, '')] = dgm;
            out.push('  pushed ' + e.ref + '@' + String(dgm).slice(0, 19) + '…');
          });
          s.loads.push({ dir: dir, verified: !skip, refs: m.images.map(function (e) { return e.ref; }) });
          return S.ok('loading ' + m.images.length + ' images from ' + dir + ' into registry.lab' + (skip ? ' (VERIFICATION SKIPPED)' : '') + '\n' + out.join('\n'));
        }
        if (a[0] === 'ls' || a[0] === 'catalog') {
          var keys = Object.keys(s.registry).sort().filter(function (k) { return !a[1] || k.indexOf(a[1].replace(/^registry\.lab\//, '')) === 0; });
          return S.ok(S.table(['REPOSITORY', 'TAG', 'DIGEST'], keys.map(function (k) { var i = k.lastIndexOf(':'); return ['registry.lab/' + k.slice(0, i), k.slice(i + 1), s.registry[k].slice(0, 19) + '…']; })));
        }
        return S.ok('registry (simulation of the enclave registry tooling, e.g. oras/skopeo against registry.lab)\nUsage: registry load DIR | registry ls [REPO]');
      },
      helm: function (w, a) {
        var sub = a[0];
        if (sub === 'template') {
          var f = multi(a.slice(1), ['set']), chart = f.pos[1], body = chart && S.readFile(w, chart);
          if (!chart) return S.err('Error: "helm template" requires RELEASE CHART');
          if (body == null) return S.err('Error: path "' + chart + '" not found');
          var ver = (/^version:\s*(\S+)/m.exec(body) || [])[1]; if (!ver) return S.err('Error: not a chart archive');
          var sets = {}; (f.set || []).forEach(function (kv) { var i = String(kv).indexOf('='); if (i > 0) sets[kv.slice(0, i)] = kv.slice(i + 1); });
          return S.ok(s26Template(ver, sets));
        }
        if (sub === 'upgrade') return helmInstall(w, a.slice(1).filter(function (x) { return x !== '--install' && x !== '-i'; }), true);
        if (sub === 'install') return helmInstall(w, a.slice(1), false);
        if (sub === 'list' || sub === 'ls') return S.ok(S.table(['NAME', 'NAMESPACE', 'REVISION', 'UPDATED', 'STATUS', 'CHART', 'APP VERSION'], nsOf(a) === 'beacon' || nsOf(a) === '*' ? [['beacon', 'beacon', s.release.rev, s.release.updated, s.release.status, 'beacon-' + s.release.ver, s.release.ver]] : []));
        if (sub === 'status') return S.ok('NAME: beacon\nLAST DEPLOYED: ' + s.release.updated + '\nNAMESPACE: beacon\nSTATUS: ' + s.release.status + '\nREVISION: ' + s.release.rev + '\nCHART: beacon-' + s.release.ver + (s.release.desc && s.release.status === 'failed' ? '\nDESCRIPTION: ' + s.release.desc : ''));
        if (sub === 'history') return S.ok(S.table(['REVISION', 'STATUS', 'CHART', 'APP VERSION', 'DESCRIPTION'], s.history.map(function (h) { return [h.rev, h.status, 'beacon-' + h.ver, h.ver, h.desc]; })));
        if (sub === 'dependency' || sub === 'dep' || sub === 'repo' || sub === 'pull') {
          if (sub === 'dependency' && a[1] === 'list') return S.ok('NAME \tVERSION\tREPOSITORY                          \tSTATUS\nredis\t19.6.4 \thttps://charts.bitnami.com/bitnami\tok (vendored)');
          return S.err('Error: ' + egress('chart', 'charts.bitnami.com/bitnami'));
        }
        return S.unsupported('helm', sub || '', ['template RELEASE CHART [--set k=v]', 'upgrade [--install] RELEASE CHART -n NS [--set k=v] [--wait]', 'install', 'list -n NS', 'status RELEASE -n NS', 'history RELEASE -n NS', 'dependency list']);
      },
      kubectl: function (w, a) {
        var ns = nsOf(a), verb = a[0], what = a[1], ps = pods();
        if (ns !== 'beacon' && ns !== '*' && (verb === 'get' || verb === 'describe' || verb === 'logs')) return S.ok('No resources found in ' + ns + ' namespace.');
        if (verb === 'get' && /^(pods?|po)$/.test(what || '')) {
          return S.ok(S.table(['NAME', 'READY', 'STATUS', 'RESTARTS', 'AGE'], ps.map(function (p) { return [p.name, p.ready ? '1/1' : '0/1', p.status, p.status === 'CrashLoopBackOff' ? 5 : 0, p.old || (p.ver === '1.7.3' && s.release.rev === 3) ? '35d' : '4m']; })));
        }
        if (verb === 'get' && /^(events?|ev)$/.test(what || '')) {
          var ev = []; ps.forEach(function (p) { if (!p.ready) ev = ev.concat(events(p)); });
          return S.ok(ev.length ? 'TYPE     REASON   OBJECT  MESSAGE\n' + ev.join('\n') : 'No resources found in beacon namespace.');
        }
        if (verb === 'describe' && /^(pods?|po)$/.test(what || '')) {
          var name = a[2], p = ps.filter(function (x) { return x.name === name || (name && name.charAt(0) !== '-' && x.name.indexOf(name) === 0); })[0];
          if (!p) return S.err('Error from server (NotFound): pods "' + (name || '') + '" not found');
          return S.ok('Name:         ' + p.name + '\nNamespace:    beacon\nStatus:       ' + (p.ready ? 'Running' : 'Pending') + '\n' + (p.wl.init.length && !p.old ? 'Init Containers:\n' + p.wl.init.map(function (c) { return '  ' + c.name + ':\n    Image:  ' + c.ref + '\n    State:  ' + (p.why === c ? 'Waiting (Reason: ' + p.status.replace('Init:', '') + ')' : 'Terminated (Completed)'); }).join('\n') + '\n' : '') +
            'Containers:\n' + p.wl.containers.map(function (c) { return '  ' + c.name + ':\n    Image:  ' + (p.old ? c.ref.replace(/:[^:]+$/, ':' + p.ver) : c.ref) + '\n    State:  ' + (p.ready ? 'Running' : 'Waiting'); }).join('\n') + '\nEvents:\n  ' + events(p).join('\n  '));
        }
        if (verb === 'logs') {
          var nm = a.filter(function (x, i) { return i > 0 && x.charAt(0) !== '-' && a[i - 1] !== '-n' && a[i - 1] !== '-c'; })[0], p2 = ps.filter(function (x) { return x.name === nm; })[0];
          if (!p2) return S.err('Error from server (NotFound): pods "' + (nm || '') + '" not found');
          if (p2.status === 'CrashLoopBackOff') return S.ok('beacon api 1.8.0 starting\nFATAL database schema is at version 17; this build needs 18 (the migrate init container applies it)');
          if (!p2.ready) return S.err('Error from server (BadRequest): container "' + (p2.why ? p2.why.name : 'api') + '" in pod "' + p2.name + '" is waiting to start: trying and failing to pull image');
          return S.ok('beacon ' + p2.wl.containers[0].name + ' ' + p2.ver + ' ready');
        }
        return S.unsupported('kubectl', [verb, what].filter(Boolean).join(' '), ['get pods -n beacon', 'get events -n beacon', 'describe pod NAME -n beacon', 'logs POD -n beacon']);
      },
      docker: function (w, a) {
        if (a[0] === 'pull' && a[1]) {
          var ref = a[1], host = ref.split('/')[0];
          if (host === 'registry.lab') { var k = ref.slice(host.length + 1); return s.registry[k] ? S.ok(ref.split('/').pop() + ': Pulling from ' + ref.split('/').slice(1, -1).join('/') + '\nDigest: ' + s.registry[k] + '\nStatus: Downloaded newer image for ' + ref) : S.err('Error response from daemon: manifest for ' + ref + ' not found: manifest unknown'); }
          return S.err('Error response from daemon: Get "https://' + (/[.:]/.test(host) ? host : 'registry-1.docker.io') + '/v2/": ' + egress('image', /[.:]/.test(host) ? ref : 'docker.io/' + ref));
        }
        return S.unsupported('docker', a[0] || '', ['pull REF']);
      },
      skopeo: function (w, a) {
        var srcRef = (a.filter(function (x) { return /^docker:\/\//.test(x); })[0] || '').replace(/^docker:\/\//, '');
        if (a[0] === 'copy' && srcRef && srcRef.split('/')[0] !== 'registry.lab') return S.err('FATA[0000] initializing source docker://' + srcRef + ': ' + egress('image', srcRef));
        return S.unsupported('skopeo', a[0] || '', ['copy docker://SRC docker://DST (external sources are blocked here)']);
      },
      curl: function (w, a) {
        var url = a.filter(function (x) { return /^https?:\/\//.test(x); })[0];
        if (!url) return S.err('curl: no URL specified!');
        var host = url.replace(/^https?:\/\//, '').split('/')[0];
        if (host === 'registry.lab') return /\/v2\/_catalog/.test(url) ? S.ok(JSON.stringify({ repositories: Object.keys(s.registry).map(function (k) { return k.slice(0, k.lastIndexOf(':')); }).filter(function (x, i, arr) { return arr.indexOf(x) === i; }) })) : S.err('curl: (22) The requested URL returned error: 404');
        return S.err('curl: (6) Could not resolve host: ' + host + ' (' + egress('http', host) + ')', 6);
      },
      connected: function (w, a) {
        var sub = a[0];
        if (sub === 'keys' && (a[1] === 'list' || !a[1])) return S.ok('[build-1, connected side] signing keys\n' + S.table(['KEYID', 'FINGERPRINT', 'STATUS', 'DISTRIBUTED TO ENCLAVES'], Object.keys(S26_KEYS).map(function (k) { return [k, S26_KEYS[k].fp, S26_KEYS[k].status, S26_KEYS[k].dist]; })));
        if (sub === 'helm' && a[1] === 'template') { if (a[3] && a[3] !== '1.8.0') return S.err('[build-1] Error: chart "beacon" version "' + a[3] + '" not found in the release repository (1.8.0 is current)'); return S.ok(s26Template('1.8.0', {})); }
        if (sub === 'bundle' && a[1] === 'config') return S.ok('[build-1] bundle defaults\nimages-from: ' + s.conn.mode + '\nsigning key: ' + s.conn.key);
        if (sub === 'bundle' && a[1] === 'ls') return S.ok(Object.keys(s.outbox).join('\n') || '(outbox empty)');
        if (sub === 'bundle' && a[1] === 'create') {
          var f = multi(a.slice(2), ['images-from', 'key', 'out']), chart = f.pos[0], ver = f.pos[1];
          if (chart !== 'beacon' || ver !== '1.8.0') return S.err('[build-1] usage: connected bundle create beacon 1.8.0 [--images-from values|rendered] [--key KEYID] [--out NAME]');
          var mode = one(f, 'images-from') || s.conn.mode, key = one(f, 'key') || s.conn.key, out = one(f, 'out') || 'beacon-bundle-1.8.0-r' + (Object.keys(s.outbox).length + 2);
          if (['values', 'rendered'].indexOf(mode) === -1) return S.err('[build-1] --images-from must be values or rendered');
          if (!S26_KEYS[key]) return S.err('[build-1] no signing key "' + key + '" (see connected keys list)');
          if (s.outbox[out] || S.readFile(w, S26_MEDIA + '/' + out + '/manifest.json') != null) return S.err('[build-1] ' + out + ' already exists; choose another --out name');
          s.outbox[out] = s26MakeBundle(out, '1.8.0', mode, key, S.stamp(s));
          var imgs = s26ImagesFrom('1.8.0', mode);
          return S.ok('[build-1] ' + (mode === 'rendered' ? 'rendering chart beacon 1.8.0 with production values (helm template, subcharts included)' : 'reading image list from values.yaml') + '\nimages:\n' + imgs.map(function (r) { return '  ' + r; }).join('\n') + '\nsigned manifest.json with ' + key + ' (' + S26_KEYS[key].fp.slice(0, 19) + '…)\nwrote outbox/' + out + ' (' + Object.keys(s.outbox[out]).length + ' files); use `transfer ' + out + '` to move it across');
        }
        return S.ok('connected runs a command on build-1, the CONNECTED side (simulation). Supported:\n  connected keys list\n  connected helm template beacon 1.8.0\n  connected bundle config | ls\n  connected bundle create beacon 1.8.0 [--images-from values|rendered] [--key KEYID] [--out NAME]');
      },
      transfer: function (w, a) {
        var name = a[0];
        if (!name || !s.outbox[name]) return S.err('transfer: no bundle "' + (name || '') + '" in the build-1 outbox (connected bundle ls)');
        if (S.readFile(w, S26_MEDIA + '/' + name + '/manifest.json') != null) return S.err('transfer: ' + S26_MEDIA + '/' + name + ' already exists on the media');
        var files = s.outbox[name];
        Object.keys(files).forEach(function (rel) { SH().util.mkdirp(w, (S26_MEDIA + '/' + name + '/' + rel).replace(/\/[^/]+$/, '')); S.writeFile(w, S26_MEDIA + '/' + name + '/' + rel, files[rel]); });
        return S.ok('transfer (simulation of the one-way media path build-1 → enclave)\ncopied ' + Object.keys(files).length + ' files to ' + S26_MEDIA + '/' + name);
      }
    };
    var logA = '2026-10-13T08:41:02Z step 1/4 copy media -> ' + S26_MEDIA + '/beacon-bundle-1.8.0 ... ok\n2026-10-13T08:41:40Z step 2/4 bundle verify ... VERIFIED (release-2026, 4/4 files)\n2026-10-13T08:42:15Z step 3/4 registry load ... 3 images pushed to registry.lab\n2026-10-13T08:42:31Z step 4/4 helm upgrade --install beacon ' + S26_MEDIA + '/beacon-bundle-1.8.0/charts/beacon-1.8.0.tgz -n beacon --wait\n2026-10-13T08:47:31Z Error: UPGRADE FAILED: context deadline exceeded\n2026-10-13T08:47:31Z install stopped at step 4/4\n';
    var logB = '2026-10-13T08:41:02Z step 1/4 copy media -> ' + S26_MEDIA + '/beacon-bundle-1.8.0 ... ok\n2026-10-13T08:41:40Z step 2/4 bundle verify ... FAILED (see bundle verify output)\n2026-10-13T08:41:40Z install stopped at step 2/4; nothing loaded, release unchanged\n# night shift: "bundle has a keys/ dir with what looks like the new key. import it and rerun?"\n';
    var files = [{ path: '/home/lab/RUNBOOK.md', content: '# Beacon install runbook (enclave, no internet egress)\n\n1. Copy the transfer media to ' + S26_MEDIA + '/<bundle>.\n2. `bundle verify ' + S26_MEDIA + '/<bundle>`: the signature must verify against the keys pinned in ' + S26_TRUST + ' and every checksum must match. Never add keys that arrive on the same media: new signing keys come only through the out-of-band key ceremony.\n3. `registry load ' + S26_MEDIA + '/<bundle>` pushes the images to registry.lab.\n4. `helm upgrade --install beacon ' + S26_MEDIA + '/<bundle>/charts/beacon-<ver>.tgz -n beacon --wait`.\n\nThis enclave has no internet egress; any outbound attempt is logged as a security event. Bundles are built on build-1 (connected side) and come across one way.\n' },
      { path: S26_LOG, content: v === 'a' ? logA : logB }, { path: S26_TRUST + '/release-2026.pub', content: s26KeyFile('release-2026') }];
    Object.keys(first).forEach(function (rel) { files.push({ path: S26_MEDIA + '/beacon-bundle-1.8.0/' + rel, content: first[rel] }); });
    return { user: 'lab', host: 'enclave-ops-1', cwd: '/home/lab',
      dirs: [{ path: S26_MEDIA }, { path: S26_MEDIA + '/beacon-bundle-1.8.0/images' }, { path: S26_MEDIA + '/beacon-bundle-1.8.0/charts' }, { path: S26_MEDIA + '/beacon-bundle-1.8.0/keys' }, { path: S26_TRUST }, { path: '/var/log/looped' }],
      files: files, sre: s, extra: S.bind(s, verbs) };
  }
  function s26NewDir(c) {
    var s = st(c), list = s.api.bundles(c.w).filter(function (d) { return !/\/beacon-bundle-1\.8\.0$/.test(d) && s.verified[d]; });
    return list.length ? list[list.length - 1] : S26_MEDIA + '/beacon-bundle-1.8.0-r2';
  }
  var S26_PALETTE = ['cat /var/log/looped/install-beacon-1.8.0.log', 'kubectl get pods -n beacon', 'kubectl get events -n beacon', 'bundle verify /media/transfer/beacon-bundle-1.8.0', 'bundle inspect /media/transfer/beacon-bundle-1.8.0', 'bundle trust list', 'registry ls', 'helm template beacon CHART', 'connected keys list', 'connected bundle create beacon 1.8.0', 'transfer NAME', 'registry load DIR', 'helm upgrade beacon CHART -n beacon --wait'];

  LX.missions.push({
    id: 'sre-s26', track: 'sre', cat: 'scenario', level: 'intermediate', mins: 30, kind: 'incident',
    title: 'Beacon 1.8.0 install in the enclave stopped partway',
    brief: function () { return 'The Beacon 1.8.0 install in the disconnected enclave stopped partway through its runbook this morning (log in /var/log/looped/). The enclave has no internet egress; bundles are built on build-1 on the connected side and come across one way on transfer media. You are on enclave-ops-1. Find what stopped the install, get a complete and trustworthy bundle across, and finish the install without fetching anything from outside.'; },
    keys: S26_PALETTE,
    world: s26World,
    objectives: [
      { id: 'failure', stage: 'evidence', text: 'Find which runbook step stopped and the exact error behind it',
        hint: 'The install log names the step; the tool that ran that step says why.', hint2: 'Read the log, then the evidence for that step: `kubectl get events -n beacon` for a stuck rollout, `bundle verify DIR` for a verification failure.',
        reveal: function (c) { return st(c).variant === 'a' ? 'kubectl get events -n beacon' : 'bundle verify /media/transfer/beacon-bundle-1.8.0'; },
        done: function (c) { return st(c).variant === 'a' ? saw(c, /kubectl\s+(describe|get\s+(events?|ev)\b)/, /beacon\/migrate:1\.8\.0[^\n]*not found/) : saw(c, /bundle\s+verify\b/, /not in the trust store/); } },
      { id: 'inventory', stage: 'evidence', text: 'Compare what the release needs with what arrived on the media, and who vouched for it',
        hint: 'A bundle is a claim about a set of artifacts, made by a key. Check the set and check the key.', hint2: 'What the chart will run: `helm template`. What arrived: `bundle inspect` / manifest.json. Who signed it versus who is trusted: the .sig file, `bundle trust list`, `connected keys list`.',
        reveal: function (c) { return st(c).variant === 'a' ? 'helm template beacon /media/transfer/beacon-bundle-1.8.0/charts/beacon-1.8.0.tgz | grep image: && bundle inspect /media/transfer/beacon-bundle-1.8.0' : 'bundle trust list && connected keys list'; },
        done: function (c) {
          if (st(c).variant === 'a') return saw(c, /(connected\s+)?helm\s+template\b/, /beacon\/migrate:1\.8\.0/) && saw(c, /bundle\s+inspect\b|cat\s+\S*manifest\.json\b|registry\s+(ls|catalog)\b|curl\b.*_catalog/, /beacon\/api/);
          return saw(c, /bundle\s+trust\s+list|ls\b.*\/etc\/looped\/trust|cat\s+\/etc\/looped\/trust/, /release-2026/) && saw(c, /connected\s+keys\b|bundle\s+inspect\b|cat\s+\S*manifest\.json\.sig/, /release-2027/);
        } },
      { id: 'rebundle', stage: 'fix', text: 'Get a bundle onto the media that carries everything the release runs and verifies against the pinned trust store',
        hint: 'The receiving side cannot repair a bundle: anything changed here is no longer what was signed.', hint2: 'Rebuild it on build-1 (`connected bundle create beacon 1.8.0 …`), `transfer` it, then `bundle verify` it here.',
        reveal: function (c) { return 'connected bundle create beacon 1.8.0 ' + (st(c).variant === 'a' ? '--images-from rendered' : '--key release-2026') + ' --out beacon-bundle-1.8.0-r2 && transfer beacon-bundle-1.8.0-r2 && bundle verify /media/transfer/beacon-bundle-1.8.0-r2'; },
        done: function (c) { return st(c).api.goodBundle(c.w); } },
      { id: 'load', stage: 'fix', text: 'Load every image the release needs into the internal registry from the verified bundle',
        hint: 'The registry is the only place the cluster may pull from.', hint2: '`registry load DIR` (it refuses an unverified bundle), then `registry ls`.',
        reveal: function (c) { return 'registry load ' + s26NewDir(c); },
        done: function (c) { return st(c).api.loaded(); } },
      { id: 'install', stage: 'verify', text: 'Finish the release and show every Beacon pod running 1.8.0 with nothing fetched from outside',
        hint: 'Helm saying "upgraded" is not the same as the pods running.', hint2: '`helm upgrade beacon DIR/charts/beacon-1.8.0.tgz -n beacon --wait`, then `kubectl get pods -n beacon`.',
        reveal: function (c) { return 'helm upgrade beacon ' + s26NewDir(c) + '/charts/beacon-1.8.0.tgz -n beacon --wait && kubectl get pods -n beacon'; },
        done: function (c) { var s = st(c); return s.api.healthy() && s.api.loaded() && !s.egress.length && lastIs(c, /kubectl\s+get\s+(pods?|po)\b|helm\s+status\b/, /Running|STATUS: deployed/); } }
    ],
    sre: {
      scenarioId: 'S26', moduleId: 'M13', lab: 'L26', variants: ['a', 'b'],
      symptom: 'The enclave install of Beacon 1.8.0 stopped partway through its runbook.',
      neutralTitle: 'Disconnected install stopped partway',
      neutralBrief: 'An install of Beacon 1.8.0 in a disconnected enclave stopped partway through its runbook. Bundles are built on a connected host and arrive one way on transfer media. Find what stopped it, get a complete and trustworthy bundle across, and finish the install with no external fetch.',
      impact: 'The enclave runs 1.7.3 (or a half-rolled 1.8.0); the 1.8.0 fixes are not available to users there.',
      changes: 'Beacon 1.8.0 adds a schema migration; the build host\'s signing setup was touched last week.',
      spoilers: ['migrate', 'init container', 'values.yaml', 'release-2027', 'untrusted key', 'rendered'],
      tools: ['bundle verify|inspect|trust list|trust add', 'registry load|ls', 'helm template|upgrade|install|list|status|history', 'kubectl get pods|events, describe pod, logs', 'connected keys list | helm template | bundle config|ls|create', 'transfer NAME', 'docker pull, skopeo copy, curl (egress is blocked and logged)'],
      grammar: ['`bundle verify DIR [--key PUBKEY]`, `bundle inspect DIR`, `bundle trust list`, `bundle trust add PUBKEY`', '`registry load DIR [--skip-verify]`, `registry ls [REPO]`', '`helm template beacon CHART [--set k=v]`, `helm upgrade [--install] beacon CHART -n beacon [--set k=v] [--wait]`, `helm list|status|history -n beacon`',
        '`kubectl get pods|events -n beacon`, `kubectl describe pod NAME -n beacon`, `kubectl logs POD -n beacon`', '`connected keys list`, `connected helm template beacon 1.8.0`, `connected bundle create beacon 1.8.0 [--images-from values|rendered] [--key KEYID] [--out NAME]`, `transfer NAME`'],
      palette: S26_PALETTE,
      assumptions: ['The enclave has no route to the internet; build-1 is reachable only through the one-way transfer.', 'The keys in /etc/looped/trust were delivered by the out-of-band key ceremony and are the only trust anchors.', 'Keys, signatures and digests are lab fixtures: invented, not cryptographically real.'],
      simplified: ['Signatures and checksums are deterministic stand-ins for cosign and sha256: a manifest edited after signing, a missing or changed archive, or a key outside the trust store fail exactly as they would, but no real cryptography runs.', 'Helm, kubectl and the registry are bounded models of one release in one namespace: rollouts are instant, a stuck rollout keeps the previous pod serving, and only the listed subcommands exist.', 'The connected build host and the transfer are single commands; in reality they are separate machines, people and approvals.', 'Every scenario command advances a logical clock by 10 seconds.'],
      unsafe: [
        { label: 'disabled signature verification', why: 'Loading a bundle without verifying it (or with verification switched off) means anything on the media can reach the cluster; the signature is the only link between the enclave and the build host.',
          test: function (c) { return !!st(c).skipVerify; },
          demo: 'registry load /media/transfer/beacon-bundle-1.8.0 --skip-verify' },
        { label: 'pulled from the internet on the receiver', why: 'The enclave is disconnected by design; reaching out (docker pull, helm repo/dependency, a public registry override) is a boundary violation even when egress blocks it, and is logged as a security event.',
          test: function (c) { return st(c).egress.length > 0; },
          demo: 'docker pull ghcr.io/looped-lab/beacon-migrate:1.8.0' },
        { label: 'trusted a key delivered inside the bundle', why: 'A key that arrives on the same media as the thing it signs proves nothing: whoever could alter the bundle could also replace the key. New keys come only through the out-of-band ceremony.',
          test: function (c) { var s = st(c); if (s.bundleKeyUsed) return true; var U = SH().util, now = {}; if (U.node(c.w, S26_TRUST)) U.walk(c.w, S26_TRUST).forEach(function (p) { var n = U.node(c.w, p); if (n && n.t === 'f') now[p] = n.content || ''; }); return JSON.stringify(now) !== JSON.stringify(s.trustInit); },
          demo: 'bundle trust add /media/transfer/beacon-bundle-1.8.0/keys/signing.pub' }
      ],
      alt: function (v) {
        var name = v === 'a' ? 'beacon-1.8.0-fix' : 'beacon-1.8.0-resigned', dir = '/media/transfer/' + name;
        var head = v === 'a'
          ? ['cat /var/log/looped/install-beacon-1.8.0.log', 'kubectl get pods -n beacon', function (c) { var row = (c.out[c.out.length - 1] || '').split('\n').filter(function (l) { return /ImagePullBackOff/.test(l); })[0] || ''; return 'kubectl describe pod ' + row.split(/\s+/)[0] + ' -n beacon'; },
            'cat /media/transfer/beacon-bundle-1.8.0/manifest.json', 'connected helm template beacon 1.8.0', 'connected bundle config', 'connected bundle create beacon 1.8.0 --images-from rendered --out ' + name]
          : ['cat /var/log/looped/install-beacon-1.8.0.log', 'bundle verify /media/transfer/beacon-bundle-1.8.0', 'cat /media/transfer/beacon-bundle-1.8.0/manifest.json.sig', 'ls -l /etc/looped/trust/', 'connected keys list', 'connected bundle create beacon 1.8.0 --key release-2026 --out ' + name];
        return head.concat(['transfer ' + name, 'bundle verify ' + dir, 'registry load ' + dir, 'registry ls beacon', 'helm upgrade --install beacon ' + dir + '/charts/beacon-1.8.0.tgz -n beacon --wait', 'helm status beacon -n beacon']);
      },
      mechanism: 'A disconnected install is only as good as the bundle: the receiver can verify it and load it, but cannot repair it, because anything changed on the receiving side is no longer what was signed. (a) The connected-side bundler took its image list from **values.yaml**, which parameterises the API, worker and Redis images; the **migrate init container** image is written in the chart template, so it was never bundled. Verification passed (the bundle is consistently signed, just incomplete), the load pushed three images, and the rollout stuck with the new API pod in Init:ImagePullBackOff while the old 1.7.3 pod kept serving. The fix is to build the image list from the **rendered** chart (`helm template`, subcharts included), rebundle, transfer, verify, load and finish the upgrade. (b) The build host signed with **release-2027**, a staged key that has not been through the out-of-band ceremony, so the enclave rightly refused it; the key shipped in the bundle\'s keys/ directory is not a trust anchor. The fix is to re-sign (rebundle) with the active pinned key, or wait for the ceremony, and never import a key from the same media.',
      alternatives: [
        { h: 'The registry is down or full', out: 'Ruled out: `registry ls` answers and holds the other 1.8.0 images; the error is NotFound for one reference.' },
        { h: 'Pull the missing image from the internet "just once"', out: 'Rejected: the enclave has no egress by design; the attempt is a security event and would bring in an unverified artifact.' },
        { h: 'Edit manifest.json on the receiver to add the image', out: 'Rejected: the signature then fails (the manifest changed after signing), and there is still no verified archive for it.' },
        { h: 'Disable the migrate init container with --set migrate.enabled=false', out: 'Rejected: 1.8.0 needs schema 18; the API then crash-loops on an old schema.' }
      ],
      clues: ['A stuck rollout keeps the previous ReplicaSet\'s pod serving, so users may see 1.7.3, not an outage.', 'The bundle tool lists where its image list came from in manifest.json.'],
      passRubric: ['Identifies the failing step from evidence (event or verification output), not from the log line alone', 'Explains why the receiver must not repair the bundle or trust a key from the media', 'Rebundles from the rendered chart / with the pinned key, transfers, verifies, loads and installs', 'Shows all pods running 1.8.0 with no egress attempt recorded'],
      prereqs: ['les-m13-03', 'les-m13-04'], refs: ['T21', 'T13']
    }
  });
  /* ═══ S27 · Scaling API replicas makes outage worse ═════════════════════
     Load model, one step per 10 logical seconds. Offered load R req/s, q
     queries each. Active database connections grow towards replicas × pool
     as latency rises; past ~64 active connections the database serves less
     (CPU and lock contention). Each layer retries a failed attempt up to
     attempts-1 times (immediately, or spread out by exponential backoff with
     jitter, optionally capped by a retry budget), multiplying attempts.
     Attempts beyond what pools can queue fail without reaching the database.
     A concurrency limit sheds excess requests fast instead of queueing them.
     f (the per-attempt failure fraction) is state, so the system can stay
     overloaded after its trigger has gone (a metastable failure). */
  var S27_DIR = '/home/lab/beacon', S27_R = 1000, S27_Q = 2, S27_CAP = 2400, S27_T0 = 30600; /* 08:30:00 */
  function s27Time(sec) { return SIM().hms(S27_T0 + sec); }
  function s27ApiCfg(pool) { return '# beacon-api ConfigMap (apply with: kubectl apply -f deploy/api-config.yaml)\ndb:\n  pool_size: ' + pool + '            # connections per replica\n  pool_timeout_ms: 30000     # how long a request waits for a free connection\n  retry:\n    attempts: 4              # total tries per query (1 = no retry)\n    backoff: none            # none | exponential\n    jitter: false\n    budget_percent: 0        # retries as % of first attempts; 0 = unlimited\nserver:\n  max_concurrency: 0         # in-flight requests per replica; 0 = unlimited\nidempotency:\n  enabled: true\n  header: Idempotency-Key\n'; }
  var S27_GW = '# edge gateway route for beacon-api (apply with: kubectl apply -f deploy/gateway.yaml)\nroutes:\n  beacon-api:\n    timeout_ms: 5000\n    retry:\n      attempts: 4            # total tries per request (1 = no retry)\n      backoff: none          # none | exponential\n      jitter: false\n      budget_percent: 0      # 0 = unlimited\n      on: 5xx,timeout,connect-failure\n    forward_headers: Idempotency-Key,X-Request-Id\n';
  var S27_NOTES = '# Beacon capacity notes (load test 2026-09-22, beacon-db 16 vCPU)\n\n- Throughput peaks at about 2,400 queries/s with 48-64 active connections.\n- Above that it falls: ~1,650/s at 120 active, ~1,200/s near 197.\n- max_connections = 200 (3 reserved for superusers).\n- Each API request runs 2 queries (one INSERT, one read).\n- Size pools so replicas x pool_size stays at or below the peak (about 64 in total), not near max_connections.\n';
  function s27Num(x, d) { var n = Number(String(x == null ? '' : x).trim()); return isFinite(n) && String(x).trim() !== '' ? n : d; }
  function s27Bool(x) { return /^(true|yes|on)$/i.test(String(x || '').trim()); }
  function s27ParseApi(t) {
    var g = function (p) { return SIM().yamlGet(t, p); };
    return { pool: s27Num(g('db.pool_size'), NaN), poolTimeout: s27Num(g('db.pool_timeout_ms'), 30000), attempts: s27Num(g('db.retry.attempts'), NaN), backoff: String(g('db.retry.backoff') || 'none').trim(), jitter: s27Bool(g('db.retry.jitter')),
      budget: s27Num(g('db.retry.budget_percent'), 0), M: s27Num(g('server.max_concurrency'), 0), idem: s27Bool(g('idempotency.enabled')), header: String(g('idempotency.header') || '').trim() };
  }
  function s27ParseGw(t) {
    var g = function (p) { return SIM().yamlGet(t, 'routes.beacon-api.' + p); };
    return { timeout: s27Num(g('timeout_ms'), 5000), attempts: s27Num(g('retry.attempts'), NaN), backoff: String(g('retry.backoff') || 'none').trim(), jitter: s27Bool(g('retry.jitter')), budget: s27Num(g('retry.budget_percent'), 0), fwd: String(g('forward_headers') || '') };
  }
  function sumPow(x, n) { var s = 0, p = 1; for (var k = 0; k < n; k++) { s += p; p *= x; } return s; }
  function s27Step(s) {
    var c = s.live, m = s.m, U = s.db.max - s.db.reserved, want = c.N * c.api.pool;
    var active = Math.min(want, U, Math.max(8, m.L * 0.02 / Math.max(0.05, 1 - Math.min(m.u, 0.95))));
    var refused = want > U && active >= U ? 1 - U / want : 0;
    var Ceff = S27_CAP / (1 + Math.max(0, active - 64) / 128);
    var f = s.forceF != null ? s.forceF : m.f, fa = 1 - (1 - f) * (1 - refused);
    function layer(p, L) {
      var spread = L.backoff === 'exponential' && L.jitter, corr = spread ? 0.5 : 1, A = Math.max(1, Math.floor(L.attempts) || 1), B = L.budget > 0 ? L.budget / 100 : 0;
      var a = sumPow(p * corr, A), fail = p * Math.pow(p * corr, A - 1);
      if (B > 0 && a - 1 > B) { var r = B / (a - 1); a = 1 + B; fail = p * Math.pow(p * corr, (A - 1) * r); }
      return { a: a, fail: fail };
    }
    var api = layer(fa, c.api), rf = 1 - Math.pow(1 - api.fail, S27_Q), gw = layer(rf, c.gw), amp = api.a * gw.a;
    var L = Math.min(S27_R * S27_Q * amp * (1 - refused * 0.9), 2.2 * Ceff), shed = 0;
    if (c.api.M > 0 && c.api.M <= 4 * c.api.pool) { var knee = 0.85 * Ceff; if (L > knee) { shed = 1 - knee / L; L = knee; } }
    var u = L / Ceff, S = Math.min(L, Ceff / (1 + 0.3 * Math.max(0, u - 1)));
    var F = Math.min(0.97, Math.max(0.0005, 1 - S / L));
    var good = Math.min(1, (S / (S27_R * S27_Q * (1 - shed))) / (1 + 0.05 * (amp - 1)));
    var success = (1 - shed) * good * (1 - refused * 0.5) * (1 - Math.min(gw.fail, 0.5) * 0.2) * 0.9992;
    var p99 = f > 0.02 || refused > 0 ? Math.min(30000, (c.gw.backoff === 'exponential' ? 1.6 : Math.max(1, Math.floor(c.gw.attempts) || 1)) * c.gw.timeout * Math.min(1, f * 3 + refused))
      : 60 + 25 / Math.max(0.02, 1 - Math.min(u, 0.98));
    p99 = Math.max(p99, 60 + 25 / Math.max(0.02, 1 - Math.min(u, 0.98)));
    var writes = S27_R / 2, replays = writes * ((gw.a - 1) * 0.35 + (api.a - 1) * 0.1) * 10;
    var dedup = c.api.idem && c.gw.fwd.indexOf(c.api.header || 'Idempotency-Key') !== -1;
    s.m = { f: 0.5 * m.f + 0.5 * F, L: L, u: u, Ceff: Ceff, active: Math.round(active), conns: Math.min(want, U), refused: refused, amp: amp, shed: shed, success: success, p99: Math.round(p99), good: S };
    if (dedup) s.replays += Math.round(replays); else s.dups += Math.round(replays);
    s.hist.push({ t: s.clock, N: c.N, success: success, p99: Math.round(p99), cpu: Math.min(100, Math.round(u * 100)), conns: Math.min(want, U), amp: amp, shed: shed });
    if (s.hist.length > 400) s.hist.shift();
  }
  function s27Bounded(c) {
    function retries(L) { return (Math.floor(L.attempts) || 1) > 1; }
    function good(L) { return L.attempts <= 3 && L.backoff === 'exponential' && L.jitter && L.budget > 0 && L.budget <= 20; }
    var ra = retries(c.api), rg = retries(c.gw);
    if (ra && rg) return false;
    if (!ra && !rg) return true;
    return good(ra ? c.api : c.gw);
  }
  function s27Capped(c) { return c.N * c.api.pool <= 64 && c.api.M >= 1 && c.api.M <= 4 * c.api.pool; }

  function s27World(seed) {
    var S = SIM(), v = S.variantOf(seed, ['a', 'b']);
    var s = { clock: 0, risky: [], hooks: [], variant: v, hist: [], events: [], dups: 0, replays: 0, db: { max: 200, reserved: 3, maxSet: null },
      live: { N: 6, api: s27ParseApi(s27ApiCfg(10)), gw: s27ParseGw(S27_GW) }, m: { f: 0.0005, L: 2000, u: 0.8 } };
    /* the morning, replayed through the same model */
    var plan = v === 'a'
      ? [[2040, function () { s.forceF = 0.95; s.events.push([2040, 'beacon-db primary restarted by the managed service (maintenance window); queries failed for 30 s']); }], [2070, function () { s.forceF = null; }],
         [2520, function () { s.live.N = 12; s.events.push([2520, 'kubectl scale deploy/beacon-api --replicas=12 (on-call: "more capacity")']); }]]
      : [[1800, function () { s.live.api = s27ParseApi(s27ApiCfg(25)); s.events.push([1800, 'ConfigMap beacon-api applied: db.pool_size 10 -> 25 (PR #412 "fix pool timeouts")']); }],
         [2520, function () { s.live.N = 12; s.events.push([2520, 'kubectl scale deploy/beacon-api --replicas=12 (on-call: "more capacity")']); }]];
    for (var t = 10; t <= 3300; t += 10) {
      s.clock = t;
      plan.forEach(function (p) { if (p[0] === t) p[1](); });
      s27Step(s);
    }
    s.clock = 3300;
    /* LXShell runs hooks before and after every command line as well as in each bound verb: step once per clock value */
    s._stepAt = s.clock;
    s.hooks.push(function (x) { if (x._stepAt === x.clock) return; x._stepAt = x.clock; s27Step(x); });
    function snapshot() {
      var m = s.m, c = s.live;
      return 'Beacon API · ' + s27Time(s.clock) + 'Z (logical clock: each command = 10 s)\nnow: replicas ' + c.N + ' · offered ' + S27_R + ' req/s · success ' + (m.success * 100).toFixed(1) + '% · p99 ' + m.p99 + ' ms · shed ' + (m.shed * 100).toFixed(1) + '%\n' +
        'database: CPU ' + Math.min(100, Math.round(m.u * 100)) + '% · connections ' + m.conns + '/' + (s.db.max - s.db.reserved) + ' usable (max_connections ' + s.db.max + ') · refused ' + Math.round(m.refused * 100) + '% of connects · completed ' + Math.round(m.good) + ' q/s of ' + Math.round(m.L) + ' attempted\n' +
        'retries: ×' + m.amp.toFixed(2) + ' database work per user request (gateway ' + c.gw.attempts + ' tries/' + c.gw.backoff + ', api ' + c.api.attempts + ' tries/' + c.api.backoff + ') · idempotent replays served ' + s.replays + ' · duplicate rows ' + s.dups;
    }
    function timeline(mins) {
      var rows = s.hist.filter(function (h, i) { return h.t > s.clock - mins * 60 && h.t % 60 === 0; });
      return S.table(['TIME', 'REPLICAS', 'SUCCESS', 'P99_MS', 'DB_CPU', 'DB_CONNS', 'WORK_PER_REQ'], rows.map(function (h) { return [s27Time(h.t), h.N, (h.success * 100).toFixed(1) + '%', h.p99, h.cpu + '%', h.conns, '×' + h.amp.toFixed(2)]; }));
    }
    function apply(w, path) {
      var abs = SH().util.resolve(w, path), t = S.readFile(w, abs);
      if (t == null) return { err: 'error: the path "' + path + '" does not exist' };
      if (/gateway/.test(abs)) { var g = s27ParseGw(t); if (!(g.attempts >= 1) || !(g.timeout > 0)) return { err: 'error: ' + path + ': routes.beacon-api.retry.attempts and timeout_ms must be positive numbers' }; s.live.gw = g; s.events.push([s.clock, 'gateway route beacon-api applied (retry ' + g.attempts + ' tries, ' + g.backoff + (g.jitter ? '+jitter' : '') + ', budget ' + g.budget + '%)']); return { out: 'configmap/edge-gateway-routes configured' }; }
      var a = s27ParseApi(t);
      if (!(a.pool >= 1) || !(a.attempts >= 1)) return { err: 'error: ' + path + ': db.pool_size and db.retry.attempts must be positive numbers' };
      s.live.api = a; s.events.push([s.clock, 'ConfigMap beacon-api applied (pool ' + a.pool + ', db retry ' + a.attempts + ' tries, max_concurrency ' + a.M + ', idempotency ' + (a.idem ? 'on' : 'OFF') + '); rollout restarted']);
      return { out: 'configmap/beacon-api configured\ndeployment.apps/beacon-api restarted' };
    }
    function sql(q) {
      var t = q.trim().replace(/;\s*$/, ''), lc = t.toLowerCase(), m = s.m;
      var tbl = function (head, rows) { var w0 = head.map(function (h, i) { return Math.max(h.length, rows.reduce(function (x, r) { return Math.max(x, String(r[i]).length); }, 0)); }); return ' ' + head.map(function (h, i) { return S.pad(h, w0[i]); }).join(' | ') + '\n' + w0.map(function (x) { return new Array(x + 3).join('-'); }).join('+') + '\n' + rows.map(function (r) { return ' ' + r.map(function (c, i) { return S.pad(c, w0[i]); }).join(' | '); }).join('\n') + (rows.length ? '\n' : '') + '(' + rows.length + ' row' + (rows.length === 1 ? '' : 's') + ')'; };
      var busy = Math.round(Math.min(m.conns, m.active)), idle = Math.max(0, m.conns - busy);
      if (/^show\s+max_connections$/.test(lc)) return tbl(['max_connections'], [[s.db.max]]) + (s.db.maxSet != null ? '\n(pending after restart: ' + s.db.maxSet + ')' : '');
      if (/^alter\s+system\s+set\s+max_connections\s*(=|to)\s*(\d+)$/.test(lc)) { s.db.maxSet = Number(/(\d+)$/.exec(lc)[1]); return 'ALTER SYSTEM\nNOTICE (simulation): max_connections is read at server start; the new value is pending until beacon-db restarts'; }
      if (/from\s+pg_stat_activity/.test(lc)) {
        if (/group\s+by\s+state/.test(lc)) return tbl(['state', 'count'], [['active', busy], ['idle', idle], ['idle in transaction', 0]].concat(m.refused > 0 ? [] : []));
        if (/group\s+by\s+(usename|application_name|1)/.test(lc)) return tbl(['application_name', 'count'], [['beacon-api', m.conns], ['psql', 1]]);
        if (/wait_event/.test(lc)) return tbl(['wait_event_type', 'wait_event', 'count'], m.u > 1 ? [['LWLock', 'BufferContent', Math.round(busy * 0.4)], ['Lock', 'transactionid', Math.round(busy * 0.2)], ['', 'CPU', Math.round(busy * 0.4)]] : [['', 'CPU', busy], ['Client', 'ClientRead', idle]]);
        if (/count\(\*\)/.test(lc)) return tbl(['count'], [[m.conns + 1]]);
        return S.err('psql (simulation): pg_stat_activity is modelled for count(*), GROUP BY state, GROUP BY application_name and wait_event columns').err;
      }
      if (/having\s+count\(\*\)\s*>\s*1/.test(lc) && /idempotency_key/.test(lc)) return tbl(['idempotency_key', 'count'], s.dups > 0 ? [[hex('dup' + s.dups, 8) + '-…', 2], [hex('dup2' + s.dups, 8) + '-…', 2]].slice(0, Math.min(2, s.dups)) : []);
      if (/count\(\*\)\s*-\s*count\(distinct\s+idempotency_key\)/.test(lc)) return tbl(['duplicates'], [[s.dups]]);
      if (/^select\s+count\(\*\)\s+from\s+records/.test(lc)) return tbl(['count'], [[18243117 + Math.round(s.clock * S27_R / 2 * Math.max(0, s.m.success)) + s.dups]]);
      return null;
    }
    var verbs = {
      metrics: function (w, a) {
        var f = multi(a, ['last']), mins = Math.min(60, Math.max(5, Number(one(f, 'last')) || 15));
        var ev = s.events.filter(function (e) { return e[0] > s.clock - mins * 60 - 1800; });
        return S.ok(snapshot() + '\n\n' + timeline(mins) + 'events:\n' + (ev.length ? ev.map(function (e) { return '  ' + s27Time(e[0]) + '  ' + e[1]; }).join('\n') : '  (none)'));
      },
      sleep: function (w, a) {
        var n = Math.min(600, Math.max(0, parseInt(a[0], 10) || 0)), k = Math.floor(n / 10);
        for (var i = 0; i < k; i++) { s.clock += 10; s._stepAt = s.clock; s27Step(s); }
        return { out: '', code: 0 };
      },
      psql: function (w, a) {
        var ci = a.indexOf('-c'), q = ci !== -1 ? a.slice(ci + 1).join(' ') : null;
        if (!q) return S.err('psql (simulation): use psql -c "SQL" (interactive sessions are not modelled). Connected to beacon-db as ops.');
        var r = sql(q.replace(/^["']|["']$/g, ''));
        if (r == null) return S.err('psql (simulation): this statement is not modelled. Supported: show max_connections; ALTER SYSTEM SET max_connections = N; select … from pg_stat_activity (count(*), group by state | application_name, wait_event); duplicate checks on records.idempotency_key (… group by idempotency_key having count(*) > 1, or count(*) - count(distinct idempotency_key)); select count(*) from records', 2);
        return S.ok(r);
      },
      kubectl: function (w, a) {
        var verb = a[0];
        if (verb === 'scale') {
          var rep = (a.filter(function (x) { return /^--replicas=\d+$/.test(x); })[0] || '').split('=')[1], ri = a.indexOf('--replicas');
          if (rep == null && ri !== -1) rep = a[ri + 1];
          var target = a.filter(function (x, i) { return i > 0 && x.charAt(0) !== '-' && a[i - 1] !== '-n' && a[i - 1] !== '--replicas'; })[0] || '';
          if (!/beacon-api/.test(target)) return S.err('Error from server (NotFound): deployments.apps "' + target.replace(/^deploy(ment)?\//, '') + '" not found (this simulation scales deploy/beacon-api)');
          var n = parseInt(rep, 10); if (!(n >= 1 && n <= 40)) return S.err('error: --replicas must be between 1 and 40 here');
          s.events.push([s.clock, 'kubectl scale deploy/beacon-api --replicas=' + n + ' (you)']); s.live.N = n;
          return S.ok('deployment.apps/beacon-api scaled');
        }
        if (verb === 'apply') {
          var fi = a.indexOf('-f'), p = fi !== -1 ? a[fi + 1] : null;
          if (!p) return S.err('error: must specify -f FILE');
          var abs = SH().util.resolve(w, p), nd = SH().util.node(w, abs), outs = [];
          var targets = nd && nd.t === 'd' ? SH().util.walk(w, abs).filter(function (x) { return /\.ya?ml$/.test(x); }) : [abs];
          for (var i = 0; i < targets.length; i++) { var r = apply(w, targets[i]); if (r.err) return S.err(r.err); outs.push(r.out); }
          return S.ok(outs.join('\n'));
        }
        if (verb === 'get' && /^(deploy|deployment|deployments|deploy\/beacon-api)$/.test(a[1] || '')) return S.ok(S.table(['NAME', 'READY', 'UP-TO-DATE', 'AVAILABLE', 'AGE'], [['beacon-api', s.live.N + '/' + s.live.N, s.live.N, s.live.N, '41d'], ['edge-gateway', '2/2', 2, 2, '41d']]));
        if (verb === 'get' && /^(pods?|po)$/.test(a[1] || '')) { var rows = []; for (var k = 0; k < s.live.N; k++) rows.push(['beacon-api-6c9d8f7b5-' + hex('p' + k, 5), '1/1', 'Running', 0, k < 6 ? '41d' : '13m']); return S.ok(S.table(['NAME', 'READY', 'STATUS', 'RESTARTS', 'AGE'], rows)); }
        if (verb === 'logs') {
          var gwLog = /gateway/.test(a.join(' ')), m = s.m, c = s.live, L = [];
          var ts = function (i) { return s27Time(s.clock - 9 + i) + 'Z '; };
          if (gwLog) {
            if (m.f > 0.02 || m.refused > 0) for (var j = 1; j < Math.min(4, c.gw.attempts); j++) L.push(ts(j) + 'upstream beacon-api: 504 after ' + c.gw.timeout + 'ms; retry ' + j + '/' + (c.gw.attempts - 1) + (c.gw.backoff === 'exponential' ? ' after backoff' : ' (immediate)'));
            L.push(ts(5) + 'POST /v1/records -> ' + (m.success > 0.99 ? '201' : '504') + ' (Idempotency-Key forwarded: ' + (c.gw.fwd.indexOf('Idempotency-Key') !== -1 ? 'yes' : 'NO') + ')');
            return S.ok(L.join('\n'));
          }
          if (m.refused > 0) L.push(ts(1) + 'ERROR db connect: FATAL: sorry, too many clients already');
          if (m.f > 0.02) {
            L.push(ts(2) + 'WARN pool: waited ' + (m.refused > 0 || c.api.pool * c.N >= 150 ? c.api.poolTimeout : Math.round(c.api.poolTimeout / 6)) + 'ms for a connection (pool_size=' + c.api.pool + ', in use ' + c.api.pool + ')');
            for (var i2 = 1; i2 <= Math.min(3, c.api.attempts - 1); i2++) L.push(ts(2 + i2) + 'WARN db: canceling statement due to statement timeout (attempt ' + i2 + '/' + c.api.attempts + '), retrying ' + (c.api.backoff === 'exponential' ? 'after backoff' : 'immediately'));
            if (c.api.attempts > 1) L.push(ts(7) + 'ERROR POST /v1/records failed after ' + c.api.attempts + ' attempts');
          }
          if (s.replays > 0 && c.api.idem) L.push(ts(8) + 'INFO idempotent replay served (POST /v1/records, key ' + hex('k' + s.clock, 8) + '-…)');
          if (m.shed > 0.001) L.push(ts(8) + 'WARN shedding: 503 Retry-After: 1 (in-flight ' + c.api.M + '/' + c.api.M + ')');
          L.push(ts(9) + 'INFO POST /v1/records 201 ' + Math.round(m.p99 / 6) + 'ms');
          return S.ok(L.join('\n'));
        }
        if (verb === 'rollout' && a[1] === 'status') return S.ok('deployment "beacon-api" successfully rolled out');
        return S.unsupported('kubectl', [verb, a[1]].filter(Boolean).join(' '), ['get deploy|pods -n beacon', 'scale deploy/beacon-api --replicas=N -n beacon', 'apply -f FILE|DIR', 'logs deploy/beacon-api|deploy/edge-gateway -n beacon', 'rollout status deploy/beacon-api']);
      },
      edit: S.verbs.edit()
    };
    s.api = { bounded: function () { return s27Bounded(s.live); }, capped: function () { return s27Capped(s.live); },
      recovered: function () { var h = s.hist.slice(-6); return h.length === 6 && h.every(function (x) { return x.success >= 0.99 && x.p99 <= 1000; }); },
      dataOk: function () { return s.live.api.idem && s.live.gw.fwd.indexOf(s.live.api.header || 'Idempotency-Key') !== -1 && s.dups === 0; } };
    return { user: 'lab', host: 'ops-1', cwd: S27_DIR, dirs: [{ path: S27_DIR + '/deploy' }],
      files: [{ path: S27_DIR + '/deploy/api-config.yaml', content: s27ApiCfg(v === 'a' ? 10 : 25) }, { path: S27_DIR + '/deploy/gateway.yaml', content: S27_GW }, { path: S27_DIR + '/CAPACITY.md', content: S27_NOTES }],
      sre: s, extra: S.bind(s, verbs) };
  }
  var S27_DUPQ = 'psql -c "select idempotency_key, count(*) from records group by idempotency_key having count(*) > 1"';
  var S27_PALETTE = ['metrics', 'metrics --last 40', 'kubectl logs deploy/beacon-api -n beacon', 'psql -c "select count(*) from pg_stat_activity"', 'psql -c "show max_connections"', 'cat deploy/gateway.yaml', 'cat deploy/api-config.yaml', 'cat CAPACITY.md', 'kubectl scale deploy/beacon-api --replicas=N -n beacon', 'kubectl apply -f deploy/', 'sleep 60'];

  LX.missions.push({
    id: 'sre-s27', track: 'sre', cat: 'scenario', level: 'intermediate', mins: 25, kind: 'incident',
    title: 'Beacon API errors got worse after adding replicas',
    brief: function () { return 'Since about nine o\'clock a large share of Beacon API requests fail or time out. The on-call doubled the API replicas at 09:12 and the error rate went up, not down. You are on ops-1 with the deployment config, the gateway route, metrics and read access to the database. Find what is limiting the service and what is multiplying the damage, bring the success rate back without making the data wrong, and keep it there.'; },
    keys: S27_PALETTE,
    world: s27World,
    objectives: [
      { id: 'impact', stage: 'evidence', text: 'Measure user impact over the morning and line it up with what changed',
        hint: 'When did it start, what changed just before, and what did each change do to the success rate?', hint2: '`metrics` (or `metrics --last 60`) shows the timeline and the change events side by side.',
        reveal: 'metrics --last 60',
        done: function (c) { return saw(c, /metrics\b/, /success[\s\S]*events:/); } },
      { id: 'db', stage: 'evidence', text: 'Find what the database is doing: how many connections reach it and what it can serve',
        hint: 'More callers is not more capacity if they all queue at the same place.', hint2: '`psql -c "select count(*) from pg_stat_activity"`, `psql -c "show max_connections"`, and CAPACITY.md.',
        reveal: 'psql -c "select count(*) from pg_stat_activity" && psql -c "show max_connections"',
        done: function (c) { return saw(c, /psql\b.*(pg_stat_activity|max_connections)/i, /\(1 row\)|\(\d+ rows\)/); } },
      { id: 'retries', stage: 'evidence', text: 'Find what multiplies one user request into many database attempts',
        hint: 'Count the layers between the user and the database and what each does when a call fails.', hint2: 'Read the retry settings in deploy/gateway.yaml and deploy/api-config.yaml, or the API and gateway logs.',
        reveal: 'grep -A4 "retry:" deploy/gateway.yaml deploy/api-config.yaml',
        done: function (c) { return saw(c, /(cat|grep|head|less|tail)\b.*(gateway|api-config)/, /attempts:\s*4/) || saw(c, /kubectl\s+logs\b/, /attempt \d+\/4|retry \d+\/3/); } },
      { id: 'bound', stage: 'fix', text: 'Bound retries: one layer only, at most three tries, spread out with backoff and jitter, under a retry budget',
        hint: 'Two layers retrying four times each is up to sixteen attempts per request, all at the worst moment.', hint2: 'Set one layer\'s attempts to 1; on the other use attempts ≤ 3, backoff exponential, jitter true, budget_percent 10; then `kubectl apply -f …`.',
        reveal: 'edit deploy/api-config.yaml db.retry.attempts 1 && edit deploy/gateway.yaml routes.beacon-api.retry.attempts 3 && edit deploy/gateway.yaml routes.beacon-api.retry.backoff exponential && edit deploy/gateway.yaml routes.beacon-api.retry.jitter true && edit deploy/gateway.yaml routes.beacon-api.retry.budget_percent 10 && kubectl apply -f deploy/api-config.yaml && kubectl apply -f deploy/gateway.yaml',
        done: function (c) { return st(c).api.bounded(); } },
      { id: 'cap', stage: 'fix', text: 'Cap what the API can push at the database and shed the excess quickly instead of queueing it',
        hint: 'Total connections are replicas × pool size; the database is fastest well below its maximum.', hint2: 'Bring replicas × pool_size near the peak in CAPACITY.md (≤ 64) and set server.max_concurrency to a small multiple of pool_size, then apply.',
        reveal: function (c) { return st(c).variant === 'a' ? 'kubectl scale deploy/beacon-api --replicas=6 -n beacon && edit deploy/api-config.yaml server.max_concurrency 20 && kubectl apply -f deploy/api-config.yaml' : 'edit deploy/api-config.yaml db.pool_size 5 && edit deploy/api-config.yaml server.max_concurrency 10 && kubectl apply -f deploy/api-config.yaml'; },
        done: function (c) { return st(c).api.capped(); } },
      { id: 'recover', stage: 'verify', text: 'Show the success rate at or above 99% with p99 under one second, sustained for a minute',
        hint: 'One good sample is not a recovery; give it time and look again.', hint2: '`sleep 120`, then `metrics`.',
        reveal: 'sleep 120 && metrics',
        done: function (c) { var s = st(c); return s.api.bounded() && s.api.capped() && s.api.recovered() && lastIs(c, /metrics\b/, /success 99\.\d%|success 100\.0%/); } },
      { id: 'data', stage: 'verify', text: 'Prove no request was written twice while clients and the gateway were retrying',
        hint: 'Retried writes are safe only if the server can recognise a replay.', hint2: 'Query records for idempotency keys that appear more than once: `psql -c "select idempotency_key, count(*) from records group by idempotency_key having count(*) > 1"`.',
        reveal: S27_DUPQ,
        done: function (c) { var s = st(c); return s.api.bounded() && s.api.capped() && s.api.dataOk() && lastIs(c, /psql\b.*(having\s+count|count\(distinct\s+idempotency_key\))/i, /\(0 rows\)|^\s+0\s*$/m); } }
    ],
    sre: {
      scenarioId: 'S27', moduleId: 'M14', lab: 'L27', variants: ['a', 'b'],
      symptom: 'Roughly half of API requests fail or time out; doubling replicas made it worse.',
      neutralTitle: 'API errors got worse after adding replicas',
      neutralBrief: 'A large share of Beacon API requests fail or time out since this morning, and doubling the API replicas made the error rate worse. Find what limits the service and what multiplies the damage, restore the success rate without making the data wrong, and keep it there.',
      impact: 'About half of sensor status submissions fail or time out; clients see 504s.',
      changes: 'Morning maintenance on the database (variant-dependent), a pool-size change (variant-dependent), and a scale-up from 6 to 12 replicas at 09:12.',
      spoilers: ['retry storm', 'metastable', 'too many clients', 'pool exhaustion', 'amplification', 'immediate retries'],
      tools: ['metrics [--last MIN]', 'psql -c "SQL" (bounded subset)', 'kubectl get deploy|pods, scale, apply -f, logs deploy/beacon-api|deploy/edge-gateway', 'cat, grep, sed -i, edit', 'sleep N'],
      grammar: ['`metrics [--last MINUTES]`', '`psql -c "show max_connections"`, `psql -c "select count(*) from pg_stat_activity"`, `… group by state`, `… group by application_name`, wait_event columns, `ALTER SYSTEM SET max_connections = N`, duplicate checks on records.idempotency_key',
        '`kubectl scale deploy/beacon-api --replicas=N -n beacon`, `kubectl apply -f deploy/api-config.yaml|deploy/gateway.yaml|deploy/`, `kubectl logs deploy/beacon-api|deploy/edge-gateway -n beacon`', '`edit FILE dotted.path VALUE` or `sed -i` on the YAML; changes take effect on `kubectl apply`', '`sleep N` (≤ 600) advances the clock'],
      palette: S27_PALETTE,
      assumptions: ['Offered load is steady at about 1,000 requests/s with 2 queries each; nobody else changes anything while you work.', 'The capacity notes are accurate for this database.', 'The idempotency key is generated by clients and stored with each record.'],
      simplified: ['The load model is a deterministic per-10-second update over averages (no queues, no per-request simulation); it reproduces the shape of retry amplification, connection-count contention and shedding, not exact numbers.', 'Configuration takes effect instantly on apply; rollouts and connection-pool warm-up are not modelled.', 'psql answers a fixed set of queries from the model; it is not a database.', 'Every scenario command advances a logical clock by 10 seconds; `sleep` advances it further.'],
      unsafe: [
        { label: 'raised max_connections far above what the database can serve', why: 'More connections than the database can schedule make it slower, not faster (the capacity notes show throughput falling past ~64 active). Raising max_connections to admit everyone hides the limit and deepens the collapse.',
          test: function (c) { var x = st(c).db.maxSet; return x != null && x > 400; },
          demo: 'psql -c "ALTER SYSTEM SET max_connections = 2000"' },
        { label: 'disabled the idempotency check', why: 'With retries anywhere in the path, a write whose response was lost is sent again; without the idempotency check (or with the gateway dropping the key) the record is stored twice. Faster is not acceptable if the data is wrong.',
          test: function (c) { var l = st(c).live; return !l.api.idem || l.gw.fwd.indexOf(l.api.header || 'Idempotency-Key') === -1; },
          demo: ['edit deploy/api-config.yaml idempotency.enabled false', 'kubectl apply -f deploy/api-config.yaml'] }
      ],
      alt: function (v) {
        return ['metrics', 'kubectl logs deploy/beacon-api -n beacon', 'kubectl logs deploy/edge-gateway -n beacon', 'psql -c "select state, count(*) from pg_stat_activity group by state"', 'cat CAPACITY.md', 'cat deploy/gateway.yaml',
          'edit deploy/gateway.yaml routes.beacon-api.retry.attempts 1',
          "sed -i 's/attempts: 4 /attempts: 3 /; s/backoff: none /backoff: exponential /; s/jitter: false/jitter: true/; s/budget_percent: 0 /budget_percent: 10 /' deploy/api-config.yaml",
          v === 'a' ? 'edit deploy/api-config.yaml db.pool_size 5' : 'kubectl scale deploy/beacon-api --replicas=8 -n beacon',
          v === 'a' ? 'kubectl get pods -n beacon' : 'edit deploy/api-config.yaml db.pool_size 8',
          'edit deploy/api-config.yaml server.max_concurrency 12',
          'kubectl apply -f deploy/', 'kubectl get deploy -n beacon', 'sleep 300', 'metrics --last 10',
          'psql -c "select count(*) - count(distinct idempotency_key) as duplicates from records"'];
      },
      mechanism: 'The database is the bottleneck, and the morning\'s changes added load to it. Two layers retry: the gateway tries each request up to 4 times and the API tries each query up to 4 times, immediately. When queries start failing, each user request becomes many database attempts (up to 16 per query), all landing while the database is already struggling, so it stays overloaded after the trigger has gone: a self-sustaining (metastable) failure. (a) The trigger was a 30-second database restart at 09:04; the retry amplification kept it down. (b) The trigger was raising the pool size to 25: with every pool full, 150 active connections made the database slower (contention), and scaling to 12 replicas asked for 300 connections, past max_connections, so connects were refused. In both, **doubling the replicas doubled the connections pointed at the bottleneck** and made it worse. The repair: retry at one layer only, at most 3 tries, exponential backoff with jitter and a retry budget; cap replicas × pool size near the database\'s best concurrency (≤ 64 here) and set a per-replica concurrency limit so excess requests are shed quickly (503 + Retry-After) rather than queued; then watch the success rate hold. Retried writes stayed correct because the API deduplicates on the client\'s Idempotency-Key, which the gateway forwards.',
      alternatives: [
        { h: 'The API needs more replicas (CPU-bound)', out: 'Ruled out by the timeline: success fell when replicas doubled; API CPU is not the limit, database work per request is.' },
        { h: 'Raise max_connections', out: 'Rejected: the capacity notes show throughput falling as active connections rise; more connections means a slower database.' },
        { h: 'Turn retries off everywhere', out: 'Possible but blunt: one bounded, jittered retry with a budget recovers transient failures without amplifying an overload.' }
      ],
      clues: ['The success rate before the first change is the baseline the system can return to.', 'Idempotent replays served is a count of retried writes the API recognised.'],
      passRubric: ['Shows from the timeline that adding replicas made it worse and why (connections to the bottleneck)', 'Explains how layered immediate retries multiply database work and sustain the overload', 'Bounds retries to one layer with backoff, jitter and a budget, and caps pools/concurrency with shedding', 'Verifies sustained recovery and that no write was duplicated (idempotency key)'],
      prereqs: ['les-m14-01', 'les-m14-02'], refs: ['T01', 'T08']
    }
  });
  /* ═══ S28 · Incident seems resolved then returns ═══════════════════════
     Clock 0 = 09:00:00Z; the learner arrives at 09:25:00 (clock 1500). The
     recurring cause runs on the clock in 10-second steps, whether the
     learner runs a scenario verb, a built-in, or `sleep`. */
  var S28_INC = 'INC-0412', S28_LOG = '/var/log/beacon/api-debug.log', S28_APILOG = '/var/log/beacon/api.log', S28_ENV = '/etc/beacon/beacon.env', S28_CRON = '/etc/cron.d/beacon-export', S28_EXPLOG = '/var/log/beacon/export.log', S28_SYSLOG = '/var/log/syslog';
  var GiB = 1073741824, MiB = 1048576, S28_DEBUG_RATE = Math.round(400 * MiB / 60), S28_INFO_RATE = Math.round(2 * MiB / 60), S28_WINDOW = 900;
  function s28Fam(v) { return v === 'a' ? [/\/api-debug\.log/, /\/var\/log\/beacon\/api\.log/] : [/\/var\/log\/syslog/, /\/var\/log\/beacon\/export\.log/]; }
  function s28FieldMatch(field, val) {
    return String(field).split(',').some(function (p) {
      if (p === '*') return true;
      var st0 = /^\*\/(\d+)$/.exec(p); if (st0) return val % Number(st0[1]) === 0;
      var rg = /^(\d+)-(\d+)(\/(\d+))?$/.exec(p); if (rg) return val >= +rg[1] && val <= +rg[2] && (!rg[4] || (val - rg[1]) % +rg[4] === 0);
      return /^\d+$/.test(p) && +p === val;
    });
  }
  function s28CronLine(text) {
    var l = String(text || '').split('\n').filter(function (x) { return /beacon-export/.test(x) && !/^\s*#/.test(x) && /^\s*\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+/.test(x); })[0];
    if (!l) return null;
    var f = l.trim().split(/\s+/);
    return { min: f[0], hour: f[1], primary: !/beacon-db-replica/.test(l) && /beacon-db-primary/.test(l), line: l };
  }
  function s28Business(cl) { for (var h = 7; h <= 19; h++) if (s28FieldMatch(cl.hour, h)) return true; return false; }

  function s28World(seed) {
    var S = SIM(), v = S.variantOf(seed, ['a', 'b']);
    var s = { clock: 1500, risky: [], hooks: [], variant: v, level: v === 'a' ? 'debug' : 'info', pid: 2417, startedAt: v === 'a' ? 990 : 0, full: false, exp: null, expSeq: 0, evidenceGone: false, stableSince: null, mustPass: null, lastTotal: null, _at: 1500,
      inc: { id: S28_INC, sev: 'SEV2', title: v === 'a' ? 'Beacon writes failing' : 'Beacon writes slow and failing', status: 'resolved', resolvedBy: 'sam', reopenedAt: null, premature: false, updates: [], followups: [], timeline: [] } };
    var T = function (sec, who, text) { s.inc.timeline.push({ at: sec, who: who, text: text }); };
    if (v === 'a') {
      T(160, 'alertmanager', 'ALERT BeaconWriteErrors FIRING (POST /v1/records 5xx 97%)');
      T(250, 'sam', 'investigating; /var at 100% on beacon-vm');
      T(510, 'sam', 'removed /var/log/beacon/api-debug.log (4.1G) to free space; df unchanged??');
      T(990, 'sam', 'restarted beacon (systemctl restart beacon); /var back to 76%');
      T(1030, 'alertmanager', 'ALERT BeaconWriteErrors resolved');
      T(1205, 'sam', 'resolved: "restart freed the space, all good"');
    } else {
      T(80, 'alertmanager', 'ALERT BeaconWriteLatency FIRING (POST /v1/records p99 > 5s, 41% 5xx)');
      T(300, 'sam', 'investigating; DB CPU 100% on beacon-db-primary');
      T(840, 'sam', 'failed over beacon-db-primary to the standby (promoted); writes recover');
      T(880, 'alertmanager', 'ALERT BeaconWriteLatency resolved');
      T(1205, 'sam', 'resolved: "failover fixed it"');
    }
    var disks = v === 'a'
      ? [{ fs: '/dev/nvme0n1p1', size: 8 * GiB, mount: '/', base: Math.round(3.1 * GiB) }, { fs: '/dev/nvme1n1', size: 20 * GiB, mount: '/var', base: Math.round(15.27 * GiB) }, { fs: '/dev/nvme2n1', size: 100 * GiB, mount: '/srv', base: 12 * GiB }]
      : [{ fs: '/dev/nvme0n1p1', size: 8 * GiB, mount: '/', base: Math.round(3.1 * GiB) }, { fs: '/dev/nvme1n1', size: 20 * GiB, mount: '/var', base: Math.round(9.4 * GiB) }];
    function U() { return SH().util; }
    function nodeOf(w, p) { return U().node(w, p); }
    function famTotal(w) {
      return s28Fam(v).map(function (re) { var t = 0; Object.keys(w.fs).forEach(function (p) { var n = w.fs[p]; if (n.t === 'f' && re.test(p)) t += n.orig != null ? n.orig : U().sizeOf(n); }); return t; });
    }
    function varDisk(w) { return (w.disks || []).filter(function (d) { return d.mount === '/var'; })[0]; }
    function used(w, d) { var t = d.base || 0; Object.keys(w.fs).forEach(function (p) { var n = w.fs[p]; if (n.t === 'f' && U().mountOf(w, p) === d) t += U().sizeOf(n); }); return t; }
    function append(w, p, line) { var n = nodeOf(w, p); if (!n) return; var sz = U().sizeOf(n); n.content = (n.content || '') + line + '\n'; n.size = Math.max(sz, 0) + line.length + 1; }
    function apiProc(w) { return (w.procs || []).filter(function (p) { return /beacon api/.test(p.cmd); })[0]; }
    /* ── fix state, decided from what is on disk and running now ── */
    function fixedA(w) {
      var d = varDisk(w), n = nodeOf(w, S28_LOG);
      return s.level === 'info' && used(w, d) < 0.85 * d.size && !s.evidenceGone && famTotal(w)[0] > 0 && !s.full;
    }
    function fixedB(w) { var cl = s28CronLine(S.readFile(w, S28_CRON)); return !(cl && cl.primary && s28Business(cl)) && !(s.exp && s.exp.primary); }
    function fixed(w) { return v === 'a' ? fixedA(w) : fixedB(w); }
    function symptom() { return v === 'a' ? s.full : !!(s.exp && s.exp.primary && s.clock - s.exp.start >= 30); }
    function step(w, t) {
      /* evidence: a family of log files whose (uncompressed) size went down lost data */
      var tot = famTotal(w);
      if (s.lastTotal) tot.forEach(function (x, i) { if (x < s.lastTotal[i] - 1) s.evidenceGone = true; });
      if (v === 'a') {
        var d = varDisk(w), rate = s.level === 'debug' ? S28_DEBUG_RATE : S28_INFO_RATE, grow = rate * 10, free = d.size - used(w, d), p = apiProc(w);
        if (p) {
          var add = Math.max(0, Math.min(grow, free));
          var n = nodeOf(w, S28_LOG), del = (w.deleted || []).filter(function (x) { return x.path === S28_LOG && x.pid === p.pid; })[0];
          if (n) n.size = U().sizeOf(n) + add;
          else if (del) { del.size += add; d.base += add; }
          var nowFull = grow > free;
          if (nowFull && !s.full) { s.full = true; T(t, 'alertmanager', 'ALERT BeaconWriteErrors FIRING (POST /v1/records 5xx 100%)'); append(w, S28_APILOG, S.stamp({ clock: t }) + ' ERROR POST /v1/records write failed: [Errno 28] No space left on device'); }
          if (!nowFull && s.full && free > 64 * MiB) { s.full = false; T(t, 'alertmanager', 'ALERT BeaconWriteErrors resolved'); }
        }
      } else {
        var cl = s28CronLine(S.readFile(w, S28_CRON)), sec = 32400 + t;
        if (s.exp && t - s.exp.start >= 720) { append(w, S28_EXPLOG, S.stamp({ clock: t }) + ' export --full finished: 1,284,113 rows in 12m00s'); if (s.exp.primary) T(t, 'alertmanager', 'ALERT BeaconWriteLatency resolved'); s.exp = null; w.procs = (w.procs || []).filter(function (x) { return !/beacon-export/.test(x.cmd); }); }
        if (cl && !s.exp && sec % 60 === 0 && s28FieldMatch(cl.min, Math.floor(sec / 60) % 60) && s28FieldMatch(cl.hour, Math.floor(sec / 3600))) {
          s.expSeq++; var pid = 5100 + s.expSeq * 7;
          s.exp = { pid: pid, dbpid: 88200 + s.expSeq * 13, start: t, primary: cl.primary };
          (w.procs = w.procs || []).push({ pid: pid, user: 'beacon', cmd: '/usr/local/bin/beacon-export --full', cpu: 4, mem: 1 });
          append(w, S28_SYSLOG, 'Oct 13 ' + S.hms(sec) + ' beacon-vm CRON[' + pid + ']: (beacon) CMD (' + cl.line.trim().split(/\s+/).slice(6).join(' ') + ')');
          append(w, S28_EXPLOG, S.stamp({ clock: t }) + ' export --full start (dsn ' + (cl.primary ? 'beacon-db-primary' : 'beacon-db-replica') + ')');
        }
        if (s.exp && s.exp.primary && t - s.exp.start === 30) T(t, 'alertmanager', 'ALERT BeaconWriteLatency FIRING (POST /v1/records p99 > 5s, 41% 5xx)');
      }
      /* verification window: continuous time with the cause removed and no symptom */
      if (fixed(w) && !symptom()) {
        if (s.stableSince == null) {
          s.stableSince = t;
          if (v === 'b') { var nx = t + 10; while ((32400 + nx) % 1800 !== 0) nx += 10; s.mustPass = nx; }
        }
      } else { s.stableSince = null; s.mustPass = null; }
      s.lastTotal = famTotal(w);
    }
    function advance(w) { while (s._at < s.clock) { s._at += 10; step(w, s._at); } if (!s.lastTotal) s.lastTotal = famTotal(w); else { var tot = famTotal(w); tot.forEach(function (x, i) { if (x < s.lastTotal[i] - 1) s.evidenceGone = true; }); s.lastTotal = tot; } }
    s.hooks.push(function (x, w) { advance(w); });
    function stableEnough() { return s.stableSince != null && s.clock - s.stableSince >= S28_WINDOW && (s.mustPass == null || s.clock >= s.mustPass + 60); }
    s.api = { fixed: function (w) { return fixed(w); }, stable: stableEnough, symptom: symptom };
    function restart(w) {
      var old = apiProc(w);
      (w.deleted || []).filter(function (x) { return old && x.pid === old.pid; }).forEach(function (x) { var d = U().mountOf(w, x.path); if (d) d.base = Math.max(0, (d.base || 0) - x.size); });
      w.deleted = (w.deleted || []).filter(function (x) { return !old || x.pid !== old.pid; });
      var lvl = S.kvGet(S.readFile(w, S28_ENV) || '', 'LOG_LEVEL') || 'info';
      s.level = /debug/i.test(lvl) ? 'debug' : 'info';
      s.pid += 113; s.startedAt = s.clock;
      w.procs = (w.procs || []).filter(function (p) { return !/beacon api/.test(p.cmd); });
      w.procs.push({ pid: s.pid, user: 'beacon', cmd: 'python3 -m beacon api', cpu: 3, mem: 2, open: v === 'a' ? [S28_LOG] : [] });
      if (v === 'a' && !nodeOf(w, S28_LOG)) U().mkfile(w, S28_LOG, '', { owner: 'beacon', group: 'beacon', mode: '640', size: 0 });
      var d = varDisk(w); if (v === 'a' && s.full && d.size - used(w, d) > 64 * MiB) { s.full = false; T(s.clock, 'alertmanager', 'ALERT BeaconWriteErrors resolved'); }
    }
    function checkUpdate(text) {
      var now = 32400 + s.clock, nm = /next update[^0-9]{0,30}(\d{1,2}):(\d{2})/i.exec(text) || /\b(\d{1,2}):(\d{2})\s*(utc|z)\b/i.exec(text);
      var nextOk = !!nm && (+nm[1] * 3600 + +nm[2] * 60) > now;
      return { scope: /\b(beacon|api|writes?|ingest|records|post)\b/i.test(text), impact: /\d+\s*%|\berrors?\b|\bfail|\bunavailable|\bdegraded|\bslow|\btime ?outs?\b|\busers?\b|\bclients?\b/i.test(text), next: nextOk, nextSeen: !!nm };
    }
    var verbs = {
      incident: function (w, a) {
        var sub = a[0], id = a[1], inc = s.inc;
        if (!sub || sub === '--help') return S.ok('incident (simulation of the incident tracker)\nUsage: incident show [ID] | incident reopen ID [--reason "…"] | incident status ID investigating|identified|monitoring\n       incident update ID "TEXT" | incident followup ID --owner NAME "TEXT" | incident resolve ID [--summary "…"]');
        if (sub === 'list') return S.ok(S.table(['ID', 'SEV', 'STATUS', 'TITLE'], [[inc.id, inc.sev, inc.status.toUpperCase(), inc.title]]));
        if (id && id !== inc.id) return S.err('incident: ' + id + ': not found (open incidents: ' + inc.id + ')');
        if (sub === 'show') {
          var lines = [inc.id + '  ' + inc.sev + '  ' + inc.title + '  status: ' + inc.status.toUpperCase() + (inc.status === 'resolved' ? ' (by ' + inc.resolvedBy + ')' : ''), 'service: beacon (beacon-vm)   IC: you (handover from sam at 09:25)', 'timeline:'];
          inc.timeline.slice().sort(function (x, y) { return x.at - y.at; }).forEach(function (e) { lines.push('  ' + S.hms(32400 + e.at) + 'Z  ' + S.pad(e.who, 13) + e.text); });
          if (inc.updates.length) { lines.push('status updates:'); inc.updates.forEach(function (u) { lines.push('  ' + S.hms(32400 + u.at) + 'Z  ' + u.text); }); }
          if (inc.followups.length) { lines.push('follow-ups:'); inc.followups.forEach(function (f) { lines.push('  [' + f.owner + '] ' + f.text); }); }
          return S.ok(lines.join('\n'));
        }
        var f = multi(a.slice(2), ['reason', 'owner', 'summary', 'message']), text = (one(f, 'message') || f.pos.join(' ')).trim();
        if (sub === 'reopen') {
          if (inc.status !== 'resolved') return S.err('incident: ' + inc.id + ' is already open (' + inc.status + ')');
          inc.status = 'investigating'; inc.reopenedAt = s.clock;
          T(s.clock, 'you', 'reopened' + (one(f, 'reason') ? ': ' + one(f, 'reason') : '') + ' (original start 09:0' + (v === 'a' ? '2' : '1') + ' kept)');
          return S.ok(inc.id + ' reopened at ' + S.stamp(s) + ' (status investigating); post an update for stakeholders');
        }
        if (sub === 'status') {
          if (['investigating', 'identified', 'monitoring'].indexOf(id ? a[2] : '') === -1) return S.err('incident status ID investigating|identified|monitoring');
          if (inc.status === 'resolved') return S.err('incident: ' + inc.id + ' is resolved; reopen it first');
          inc.status = a[2]; T(s.clock, 'you', 'status -> ' + a[2]); return S.ok(inc.id + ' status ' + a[2]);
        }
        if (sub === 'update') {
          if (!text) return S.err('incident update ID "TEXT"');
          if (inc.status === 'resolved') return S.err('incident: ' + inc.id + ' is resolved; reopen it before posting updates');
          var ch = checkUpdate(text), ok2 = ch.scope && ch.impact && ch.next;
          inc.updates.push({ at: s.clock, text: text, ok: ok2 });
          return S.ok('posted at ' + S.stamp(s) + ' to #inc-0412 and the status page\nchecks: scope ' + (ch.scope ? 'yes' : 'MISSING (what service/feature is affected?)') + ' · impact ' + (ch.impact ? 'yes' : 'MISSING (what do users see, how much?)') + ' · next update ' + (ch.next ? 'yes' : ch.nextSeen ? 'NOT IN THE FUTURE' : 'MISSING ("next update HH:MM UTC")'));
        }
        if (sub === 'followup') {
          var owner = one(f, 'owner');
          if (!owner || owner === true || text.length < 10) return S.err('incident followup ID --owner NAME "what will be done" (both required)');
          inc.followups.push({ owner: owner, text: text, at: s.clock });
          return S.ok('follow-up recorded for ' + owner);
        }
        if (sub === 'resolve') {
          if (inc.status === 'resolved') return S.err('incident: ' + inc.id + ' is already resolved');
          if (!(fixed(w) && stableEnough())) inc.premature = true;
          inc.status = 'resolved'; inc.resolvedBy = 'you';
          T(s.clock, 'you', 'resolved' + (one(f, 'summary') ? ': ' + one(f, 'summary') : ''));
          return S.ok(inc.id + ' resolved at ' + S.stamp(s));
        }
        return S.unsupported('incident', sub, ['show', 'list', 'reopen', 'status', 'update', 'followup', 'resolve']);
      },
      curl: function (w, a) {
        var fl = multi(a, ['data', 'request', 'write-out', 'output']), url = a.filter(function (x) { return /^https?:\/\//.test(x); })[0];
        var wi = a.indexOf('-w'), wout = wi !== -1 ? a[wi + 1] : one(fl, 'write-out'), xi = a.indexOf('-X'), method = xi !== -1 ? a[xi + 1] : one(fl, 'request') || (a.indexOf('-d') !== -1 || one(fl, 'data') ? 'POST' : 'GET');
        if (!url) return S.err('curl: no URL specified!');
        var m = /^https?:\/\/(127\.0\.0\.1:8080|localhost:8080|beacon\.corp\.lab)(\/[^\s?]*)?/.exec(url);
        if (!m) return S.err('curl: (6) Could not resolve host (this simulation serves http://127.0.0.1:8080 and https://beacon.corp.lab)', 6);
        var path = m[2] || '/', code = 404, body = 'not found';
        if (path === '/healthz') { code = 200; body = 'ok'; }
        else if (path === '/v1/records' && method === 'POST') {
          if (v === 'a' && s.full) { code = 500; body = '{"error": "write failed: [Errno 28] No space left on device"}'; }
          else if (v === 'b' && symptom()) { code = 504; body = 'upstream timed out after 5000 ms'; }
          else { code = 201; body = '{"id": ' + (91022 + s.clock) + ', "status": "accepted"}'; }
        } else if (path === '/v1/records') { code = 200; body = '{"records": [], "next": null}'; }
        if (wout && /http_code/.test(wout)) return S.ok(String(code));
        return { out: (a.indexOf('-i') !== -1 ? 'HTTP/1.1 ' + code + '\n\n' : '') + body + '\n', code: 0 };
      },
      systemctl: function (w, a) {
        var sub = a[0], unit = (a[1] || '').replace(/\.service$/, '');
        if (unit !== 'beacon' && sub !== '--help') return S.err('Unit ' + (a[1] || '') + '.service could not be found (this simulation manages beacon.service)', 5);
        var p = apiProc(w);
        if (sub === 'restart') { restart(w); return S.ok(''); }
        if (sub === 'status') return S.ok('● beacon.service - Beacon API (course starter service)\n     Loaded: loaded (/etc/systemd/system/beacon.service; enabled)\n     Active: active (running)\n   Main PID: ' + (p ? p.pid : '-') + ' (python3)\n     Environment: from ' + S28_ENV + ' (LOG_LEVEL=' + s.level + ' at start)');
        if (sub === 'is-active') return S.ok('active');
        if (sub === 'cat') return S.ok('# /etc/systemd/system/beacon.service\n[Service]\nUser=beacon\nEnvironmentFile=' + S28_ENV + '\nExecStart=/usr/bin/python3 -m beacon api\nRestart=on-failure');
        return S.unsupported('systemctl', sub || '', ['status beacon', 'restart beacon', 'is-active beacon', 'cat beacon']);
      },
      journalctl: function (w, a) {
        var lines = [];
        if (v === 'a') lines = [].concat(s.full ? ['beacon[' + s.pid + ']: ERROR POST /v1/records write failed: [Errno 28] No space left on device'] : ['beacon[' + s.pid + ']: INFO POST /v1/records 201 14ms']);
        else lines = [].concat(symptom() ? ['beacon[' + s.pid + ']: WARN db: statement timeout after 5000 ms (INSERT INTO records …)'] : ['beacon[' + s.pid + ']: INFO POST /v1/records 201 16ms']);
        return S.ok(['Oct 13 ' + S.hms(32400 + s.startedAt) + ' beacon-vm systemd[1]: Started beacon.service - Beacon API (course starter service).', 'Oct 13 ' + S.hms(32400 + s.startedAt) + ' beacon-vm beacon[' + s.pid + ']: INFO starting beacon api (LOG_LEVEL=' + s.level + ')'].concat(lines.map(function (l) { return 'Oct 13 ' + S.hms(32400 + s.clock) + ' beacon-vm ' + l; })).join('\n'));
      },
      logrotate: function (w, a) {
        var conf = a.filter(function (x) { return x.charAt(0) !== '-'; })[0];
        if (!conf || S.readFile(w, conf) == null) return S.err('logrotate: usage: logrotate [-f] [-v] CONFIG (the Beacon config is /etc/logrotate.d/beacon)');
        if (a.indexOf('-f') === -1 && a.indexOf('--force') === -1) return S.ok('(no logs past their size/age limit yet; -f forces a rotation)');
        var out = [];
        U().walk(w, '/var/log/beacon').filter(function (p) { return /\.log$/.test(p) && nodeOf(w, p) && nodeOf(w, p).t === 'f'; }).forEach(function (p) {
          var n = nodeOf(w, p), sz = U().sizeOf(n);
          for (var k = 6; k >= 1; k--) { var o = nodeOf(w, p + '.' + k + '.gz'); if (o) { w.fs[U().resolve(w, p + '.' + (k + 1) + '.gz')] = o; delete w.fs[U().resolve(w, p + '.' + k + '.gz')]; } }
          var gz = U().mkfile(w, p + '.1.gz', '(gzip data, simulated: ' + sz + ' bytes of ' + p.split('/').pop() + ')\n', { owner: n.owner, group: n.group, mode: n.mode, size: Math.max(1, Math.round(sz / 20)) });
          gz.orig = sz + (n.orig || 0);
          n.size = 0; n.orig = undefined;
          out.push('rotating ' + p + ' (copytruncate, compress): ' + sz + ' bytes -> ' + p.split('/').pop() + '.1.gz');
        });
        return S.ok(a.indexOf('-v') !== -1 ? out.join('\n') : '');
      },
      gzip: function (w, a) {
        var file = a.filter(function (x) { return x.charAt(0) !== '-'; })[0], n = file && nodeOf(w, file);
        if (!n || n.t !== 'f') return S.err('gzip: ' + (file || '') + ': No such file or directory');
        var abs = U().resolve(w, file), sz = U().sizeOf(n);
        var gz = U().mkfile(w, abs + '.gz', '(gzip data, simulated: ' + sz + ' bytes)\n', { owner: n.owner, group: n.group, mode: n.mode, size: Math.max(1, Math.round(sz / 20)) }); gz.orig = sz;
        var holder = (w.procs || []).filter(function (p) { return (p.open || []).indexOf(abs) !== -1; })[0];
        if (holder) { (w.deleted = w.deleted || []).push({ path: abs, size: sz, pid: holder.pid, cmd: holder.cmd }); var d = U().mountOf(w, abs); if (d) d.base = (d.base || 0) + sz; }
        delete w.fs[abs];
        return S.ok('');
      },
      psql: function (w, a) {
        var ci = a.indexOf('-c'), q = ci !== -1 ? a.slice(ci + 1).join(' ').replace(/^["']|["']$/g, '') : null, lc = (q || '').toLowerCase();
        if (!q) return S.err('psql (simulation): use psql -h beacon-db-primary -c "SQL"');
        var cm = /pg_(cancel|terminate)_backend\((\d+)\)/.exec(lc);
        if (cm) { var hit = s.exp && s.exp.dbpid === +cm[2]; if (hit) { append(w, S28_EXPLOG, S.stamp(s) + ' ERROR canceling statement due to user request'); if (s.exp.primary) T(s.clock, 'alertmanager', 'ALERT BeaconWriteLatency resolved'); s.exp = null; w.procs = (w.procs || []).filter(function (x) { return !/beacon-export/.test(x.cmd); }); }
          return S.ok(' pg_' + cm[1] + '_backend\n-------------------\n ' + (hit ? 't' : 'f') + '\n(1 row)'); }
        if (/from\s+pg_stat_activity/.test(lc)) {
          var rows = [[31877, 'beacon', 'beacon-api', 'active', S.hms(32400 + s.clock - 1) + 'Z', 'INSERT INTO records (sensor, status, idempotency_key) …'], [31880, 'beacon', 'beacon-api', 'idle', S.hms(32400 + s.clock - 3) + 'Z', 'SELECT id, sensor, status FROM records WHERE …']];
          if (v === 'b' && s.exp && s.exp.primary) rows.unshift([s.exp.dbpid, 'export', 'beacon-export', 'active', S.hms(32400 + s.exp.start) + 'Z', 'COPY (SELECT r.*, s.* FROM records r JOIN sensors s ON …) TO STDOUT']);
          return S.ok(S.table(['pid', 'usename', 'application_name', 'state', 'query_start', 'query'], rows) + '(' + rows.length + ' rows)');
        }
        return S.err('psql (simulation): supported here: select … from pg_stat_activity; select pg_cancel_backend(PID) / pg_terminate_backend(PID)', 2);
      },
      pkill: function (w, a) {
        if (v === 'b' && s.exp && /beacon-export/.test(a.join(' '))) { append(w, S28_EXPLOG, S.stamp(s) + ' export --full killed (SIGTERM)'); if (s.exp.primary) T(s.clock, 'alertmanager', 'ALERT BeaconWriteLatency resolved'); s.exp = null; w.procs = (w.procs || []).filter(function (x) { return !/beacon-export/.test(x.cmd); }); return S.ok(''); }
        return { out: '', code: 1 };
      },
      sleep: function (w, a) { var n = Math.min(600, Math.max(0, parseInt(a[0], 10) || 0)); s.clock += Math.floor(n / 10) * 10; advance(w); return { out: '', code: 0 }; },
      edit: S.verbs.edit()
    };
    /* built-ins still advance the scenario clock here: time is the point of this incident */
    var builtinsClocked = clocked(['df', 'du', 'ls', 'cat', 'tail', 'head', 'grep', 'lsof', 'rm', 'truncate', 'mv', 'cp', 'stat', 'ps', 'sed']);
    Object.keys(builtinsClocked).forEach(function (k) { verbs[k] = builtinsClocked[k]; });
    var debugLines = 'DEBUG beacon.api: request POST /v1/records headers={…} body_bytes=412\nDEBUG beacon.store: INSERT records sensor=lab-sensor-0117 params=(…)\nDEBUG beacon.api: response 201 in 14ms\n';
    var files = [{ path: S28_ENV, content: v === 'a' ? '# Beacon environment (read by beacon.service)\nBEACON_CONFIG=/etc/beacon/beacon.yaml\n# BEA-311 (lee, 08:20): debug logging to chase a parser bug; revert after\nLOG_LEVEL=debug\n' : '# Beacon environment (read by beacon.service)\nBEACON_CONFIG=/etc/beacon/beacon.yaml\nLOG_LEVEL=info\n', owner: 'root', mode: '640' },
      { path: S28_APILOG, content: '2026-10-13T09:02:31Z ERROR POST /v1/records write failed: ' + (v === 'a' ? '[Errno 28] No space left on device' : 'statement timeout after 5000 ms') + '\n2026-10-13T09:1' + (v === 'a' ? '6:30' : '4:05') + 'Z INFO beacon api started\n', owner: 'beacon', mode: '640', size: v === 'a' ? 48 * MiB : 31 * MiB },
      { path: '/etc/logrotate.d/beacon', content: '/var/log/beacon/*.log {\n    size 100M\n    rotate 7\n    compress\n    copytruncate\n    missingok\n}\n' },
      { path: '/srv/archive/README', content: 'Long-term log archive (separate disk). Incident evidence goes here, never to /dev/null.\n' }];
    if (v === 'a') files.push({ path: S28_LOG, content: debugLines, owner: 'beacon', mode: '640', size: S28_DEBUG_RATE * (1500 - 1080) });
    else files.push({ path: S28_CRON, content: '# Partner export (PR #77, lee, 2026-10-13 08:50): every 30 min, from the primary because the replica lags\nSHELL=/bin/sh\n*/30 * * * * beacon /usr/local/bin/beacon-export --full --dsn postgresql://export@beacon-db-primary.corp.lab/beacon >> ' + S28_EXPLOG + ' 2>&1\n', owner: 'root' },
      { path: S28_EXPLOG, content: '2026-10-13T08:00:02Z export --incremental start (dsn beacon-db-replica)\n2026-10-13T08:01:40Z export --incremental finished: 9,412 rows\n2026-10-13T09:00:01Z export --full start (dsn beacon-db-primary)\n2026-10-13T09:14:02Z ERROR server closed the connection unexpectedly\n', owner: 'beacon', size: 6 * 1024 },
      { path: S28_SYSLOG, content: 'Oct 13 08:00:01 beacon-vm CRON[4011]: (beacon) CMD (/usr/local/bin/beacon-export --incremental --dsn postgresql://export@beacon-db-replica.corp.lab/beacon >> ' + S28_EXPLOG + ' 2>&1)\nOct 13 08:50:12 beacon-vm cron[612]: (*system*) RELOAD (/etc/cron.d/beacon-export)\nOct 13 09:00:01 beacon-vm CRON[4120]: (beacon) CMD (/usr/local/bin/beacon-export --full --dsn postgresql://export@beacon-db-primary.corp.lab/beacon >> ' + S28_EXPLOG + ' 2>&1)\n', size: 2 * MiB });
    return { user: 'root', host: 'beacon-vm', cwd: '/root', dirs: [{ path: '/var/log/beacon' }, { path: '/srv/archive' }, { path: '/etc/cron.d' }], disks: disks,
      procs: [{ pid: 2417, user: 'beacon', cmd: 'python3 -m beacon api', cpu: 3, mem: 2, open: v === 'a' ? [S28_LOG] : [] }, { pid: 612, user: 'root', cmd: '/usr/sbin/cron -f', cpu: 0, mem: 0 }],
      files: files, sre: s, extra: S.bind(s, verbs) };
  }
  function s28Sleeps(c) {
    var s = st(c), need = s.stableSince == null ? 910 : Math.max(s.stableSince + S28_WINDOW, s.mustPass == null ? 0 : s.mustPass + 60) - s.clock + 30, out = [];
    while (need > 0) { out.push('sleep ' + Math.min(600, Math.ceil(need / 10) * 10)); need -= 600; }
    return out;
  }
  var S28_POST = 'curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:8080/v1/records -d \'{"sensor": "lab-sensor-0001", "status": "ok"}\'';
  var S28_UPDATE = 'incident update INC-0412 "Reopened: Beacon API writes (POST /v1/records) are failing or slow again for all clients, reads are fine. The 09:18 mitigation removed the symptom, not the cause, we have found a recurring trigger and are fixing it. Next update 10:15 UTC."';
  var S28_PALETTE = ['incident show INC-0412', 'curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:8080/v1/records', 'df -h /var', 'ls -lh /var/log/beacon/', 'cat /etc/cron.d/beacon-export', 'grep CRON /var/log/syslog', 'psql -c "select pid, usename, state, query from pg_stat_activity"', 'incident reopen INC-0412', 'incident update INC-0412 "…"', 'sleep 300', 'incident followup INC-0412 --owner NAME "…"', 'incident resolve INC-0412'];

  LX.missions.push({
    id: 'sre-s28', track: 'sre', cat: 'scenario', level: 'intermediate', mins: 30, kind: 'incident',
    title: 'Incident INC-0412 was closed at 09:20; you are taking over',
    brief: function () { return 'INC-0412 (Beacon writes failing) was declared resolved at 09:20 after a quick mitigation, and you are taking over incident command at 09:25 on beacon-vm. Before anyone moves on, decide whether it is really over. If it is not, handle it properly: an accurate incident record, a time-stamped update for stakeholders, the real cause found and removed, a verification window before closing, and an owned follow-up.'; },
    keys: S28_PALETTE,
    world: s28World,
    objectives: [
      { id: 'record', stage: 'evidence', text: 'Read the incident record: what failed, what was done, and on what evidence it was closed',
        hint: 'A resolution is a claim. What evidence does the timeline give for it?', hint2: '`incident show INC-0412`.',
        reveal: 'incident show INC-0412',
        done: function (c) { return saw(c, /incident\s+(show|list)\b/, /INC-0412[\s\S]*RESOLVED/); } },
      { id: 'trigger', stage: 'evidence', text: 'Find what is still driving the symptom, and when it will bite next',
        hint: 'The mitigation changed something temporary. What on this host is still doing what it did before 09:00?', hint2: 'Watch the resource that failed over a minute or two (df, ls -lh, logs), and look for things that run on a schedule or were changed this morning (environment files, /etc/cron.d, syslog).',
        reveal: function (c) { return st(c).variant === 'a' ? 'df -h /var && sleep 60 && df -h /var && tail -n 3 /var/log/beacon/api-debug.log && cat /etc/beacon/beacon.env' : 'grep CRON /var/log/syslog && cat /etc/cron.d/beacon-export'; },
        done: function (c) { return st(c).variant === 'a' ? saw(c, /df\b/, /\s\/var\s*$/m) && saw(c, /(cat|grep|tail|head|less)\b.*(beacon\.env|api-debug)/, /LOG_LEVEL=debug|DEBUG/) : saw(c, /(cat|grep|less|head)\b.*\/etc\/cron\.d|crontab\b/, /\*\/30[^\n]*beacon-export/); } },
      { id: 'reopen', stage: 'fix', text: 'Reopen the incident accurately and post a time-stamped update with scope, impact and the next update time',
        hint: 'Stakeholders were told it was over. What do they need to know now, and when will they hear next?', hint2: '`incident reopen INC-0412 --reason "…"`, then `incident update INC-0412 "…"` naming what is affected, what users see, and "next update HH:MM UTC".',
        reveal: 'incident reopen INC-0412 --reason "the cause was not removed, the symptom recurs on a schedule" && ' + S28_UPDATE,
        done: function (c) { var i = st(c).inc; return i.reopenedAt != null && i.updates.some(function (u) { return u.ok && u.at >= i.reopenedAt; }); } },
      { id: 'cause', stage: 'fix', text: 'Remove the recurring cause without destroying the evidence',
        hint: 'Stop the thing that keeps happening; keep what explains it.', hint2: 'Change the setting or the schedule that drives it and apply it (restart a service, or edit the cron entry); reclaim space by rotating and compressing, never by deleting.',
        reveal: function (c) { return st(c).variant === 'a' ? "sed -i 's/^LOG_LEVEL=debug$/LOG_LEVEL=info/' /etc/beacon/beacon.env && systemctl restart beacon && logrotate -f /etc/logrotate.d/beacon" : "sed -i 's/beacon-db-primary/beacon-db-replica/' /etc/cron.d/beacon-export" + (st(c).exp && st(c).exp.primary ? ' && psql -c "select pg_cancel_backend(' + st(c).exp.dbpid + ')"' : ''); },
        explain: 'Variant a: debug logging left on writes ~400 MB/min to /var; turning it off and rotating the log (copytruncate + compress) stops the growth and frees space while keeping the evidence. Variant b: a 30-minute cron job runs a full export against the primary; pointing it at the replica (or moving it off-hours) stops the recurring load.',
        done: function (c) { return st(c).api.fixed(c.w); } },
      { id: 'window', stage: 'verify', text: 'Keep watching through a verification window (15 minutes, and past the next time the trigger would have fired) and show the user path working',
        hint: 'It looked fixed at 09:20 too.', hint2: '`sleep 600`, `sleep 300`, then a real write: `curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:8080/v1/records`.',
        reveal: function (c) { return s28Sleeps(c).concat([S28_POST]).join(' && '); },
        done: function (c) { var s = st(c); return s.api.fixed(c.w) && s.api.stable() && lastIs(c, /curl\b.*\/v1\/records/, /^201\s*$/m); } },
      { id: 'close', stage: 'verify', text: 'Record the follow-up with an owner, then resolve the incident',
        hint: 'Something made this possible and is not fixed yet. Who owns it?', hint2: '`incident followup INC-0412 --owner NAME "…"`, then `incident resolve INC-0412 --summary "…"`.',
        reveal: function (c) { return 'incident followup INC-0412 --owner lee "' + (st(c).variant === 'a' ? 'BEA-311: debug logging needs a size cap and an expiry, alert on /var growth rate, not only on full' : 'PR #77: fix replica lag or move the full export off-hours, add statement_timeout for the export role') + '" && incident resolve INC-0412 --summary "cause removed and verified over a full window"'; },
        done: function (c) { var i = st(c).inc; return i.status === 'resolved' && i.resolvedBy === 'you' && !i.premature && i.followups.some(function (f) { return f.owner && f.text.length >= 20; }) && lastIs(c, /incident\s+resolve\b/, /resolved at/); } }
    ],
    sre: {
      scenarioId: 'S28', moduleId: 'M14', lab: 'L28', variants: ['a', 'b'],
      symptom: 'Writes failed this morning; a mitigation made the symptom vanish and the incident was closed within minutes.',
      neutralTitle: 'Incident closed after a quick mitigation',
      neutralBrief: 'A Beacon write outage was declared resolved minutes after a mitigation made the symptom vanish. You are taking over incident command. Decide whether it is over; if not, keep the record accurate, update stakeholders, find and remove the cause, verify over a window and record an owned follow-up.',
      impact: 'Clients could not submit sensor status records (POST /v1/records) for about 15 minutes this morning.',
      changes: 'Several changes on beacon-vm this morning; a restart or database failover at about 09:15.',
      spoilers: ['debug', 'LOG_LEVEL', 'cron', 'export', 'disk full', 'deleted file', 'logrotate', 'replica'],
      tools: ['incident show|reopen|status|update|followup|resolve', 'curl (user path)', 'df, du, ls, cat, tail, grep, lsof +L1, stat', 'systemctl status|restart beacon, journalctl -u beacon', 'logrotate -f, gzip, sed -i, edit', 'psql -c (pg_stat_activity, pg_cancel_backend)', 'pkill -f beacon-export', 'sleep N'],
      grammar: ['`incident show INC-0412`, `incident reopen INC-0412 [--reason "…"]`, `incident status INC-0412 investigating|identified|monitoring`, `incident update INC-0412 "TEXT"`, `incident followup INC-0412 --owner NAME "TEXT"`, `incident resolve INC-0412 [--summary "…"]`',
        '`curl [-s] [-o /dev/null] [-w "%{http_code}"] [-X POST] http://127.0.0.1:8080/v1/records|/healthz`', '`systemctl status|restart beacon`, `logrotate -f [-v] /etc/logrotate.d/beacon`, `gzip FILE`', '`psql -c "select … from pg_stat_activity"`, `psql -c "select pg_cancel_backend(PID)"`', '`sleep N` (≤ 600) advances the clock; every other command advances it 10 s'],
      palette: S28_PALETTE,
      assumptions: ['You are root on beacon-vm and incident commander from 09:25.', 'The incident tool posts updates to the incident channel and status page.', 'Nothing else changes on the host while you work.'],
      simplified: ['Time is logical: every command is 10 seconds and `sleep` advances further; the recurring cause runs on that clock.', 'Disk usage is modelled from file sizes and a fixed growth rate; compression is a fixed 20:1. A file deleted while a process holds it keeps its space until the process restarts, as on Linux.', 'The database, cron and the incident tracker are bounded stand-ins; psql answers only the listed queries.', 'Update checks look for scope, impact and a future "next update" time in the text; a human still judges whether the update is clear and true.'],
      unsafe: [
        { label: 'resolved before the verification window passed', why: 'Closing the incident before the cause is removed and the service has stayed healthy for a full window (including the next time the trigger would fire) repeats the 09:20 mistake: stakeholders stop watching just before it comes back.',
          test: function (c) { return !!st(c).inc.premature; },
          demo: ['incident reopen INC-0412', 'incident resolve INC-0412'] },
        { label: 'deleted or truncated the evidence', why: 'Logs are the record of what happened and why. Deleting or truncating them destroys the evidence for the postmortem (and a file deleted while a process holds it does not even free the space).',
          test: function (c) { return !!st(c).evidenceGone; },
          demo: function (c, v) { return v === 'a' ? 'rm /var/log/beacon/api-debug.log' : 'rm /var/log/beacon/export.log'; } }
      ],
      alt: function (v) {
        if (v === 'a') return ['incident list', 'incident show INC-0412', S28_POST, 'ls -lh /var/log/beacon/', 'sleep 30', 'ls -lh /var/log/beacon/', 'df -h /var', 'grep LOG_LEVEL /etc/beacon/beacon.env',
          'incident reopen INC-0412 --reason "/var is filling again at ~400 MB/min"', 'incident status INC-0412 identified',
          'incident update INC-0412 "Beacon API writes will fail again within minutes (disk on beacon-vm filling), 0% of POST /v1/records are failing right now but impact returns at 100% when full. Next update 10:00 UTC."',
          'edit /etc/beacon/beacon.env LOG_LEVEL info', 'gzip /var/log/beacon/api-debug.log', 'lsof +L1', 'systemctl restart beacon', 'df -h /var', 'incident status INC-0412 monitoring',
          'sleep 600', 'sleep 320', S28_POST, 'incident followup INC-0412 --owner platform-team "Alert on the growth rate of /var, cap debug logging by size and time, and document why rm does not free space for open files"',
          'incident resolve INC-0412 --summary "debug logging off, log compressed and kept, 15 min stable"'];
        return ['incident show INC-0412', 'tail -n 5 /var/log/beacon/export.log', 'ls -l /etc/cron.d/', 'cat /etc/cron.d/beacon-export', 'incident reopen INC-0412',
          'incident update INC-0412 "Beacon writes (POST /v1/records) will slow down and time out again at 09:30 for all clients when a scheduled export hits the database; next update 09:45 UTC."',
          "sed -i 's/^\\*/# */' /etc/cron.d/beacon-export", 'cat /etc/cron.d/beacon-export', 'sleep 600', 'sleep 600', 'sleep 120', 'psql -c "select pid, usename, state, query from pg_stat_activity"', S28_POST,
          'incident followup INC-0412 --owner data-team "Re-enable the full export only against a replica or off-hours, with a statement_timeout for the export role"', 'incident resolve INC-0412'];
      },
      mechanism: 'The mitigation removed the symptom, not the cause, and the incident was closed with no verification window. (a) Debug logging (left on since 08:20 for another ticket) writes ~400 MB/min to /var. Someone deleted the 4 GB debug log at 09:08, but the process held it open, so no space came back until the 09:16 restart released it; the new log then filled /var again by about 09:30. Fix: turn debug logging off and restart, rotate and compress the log (copytruncate keeps the open file valid) to reclaim space while keeping the evidence. (b) A cron entry added at 08:50 runs a full export against the primary every 30 minutes; the 09:14 failover killed the 09:00 run, and the 09:30 run brought the load back. Fix: point it at the replica or move it off-hours (and cancel a running export). In both, reopen the incident (keeping the original start time), post an update with scope, impact and next update time, verify across a window that includes the next trigger, then resolve with an owned follow-up for the condition that allowed it.',
      alternatives: [
        { h: 'The restart/failover fixed a one-off glitch', out: 'Ruled out: the resource is trending back to the failure (a), or the trigger is on a schedule that fires again at :30 (b).' },
        { h: 'The database or disk hardware is failing', out: 'Ruled out: the growth matches the debug log rate exactly (a); load appears only while the export runs (b).' },
        { h: 'Free space by deleting old logs', out: 'Rejected: it destroys evidence, and a file still held open frees nothing until restart.' }
      ],
      clues: ['/healthz answers 200 throughout: it does not exercise writes.', 'The incident timeline keeps the original start time when reopened.'],
      passRubric: ['Shows the cause was still present after the mitigation (trend or schedule), not just that the symptom returned', 'Reopens with an accurate, time-stamped update (scope, impact, next update)', 'Removes the recurring trigger while preserving evidence', 'Verifies across a window that includes the next trigger before resolving, and records an owned follow-up'],
      prereqs: ['les-m14-04', 'les-m14-05'], refs: ['T01', 'T15']
    }
  });
})();
