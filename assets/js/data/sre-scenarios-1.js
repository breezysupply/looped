/* SRE & Cloud Deployment Foundations — simulated incidents S01–S08 (M01–M04).

   Each scenario is a sandbox mission with an `sre` block. `world(seed)`
   builds a fresh LXShell world for that seed: state in `sre`, bounded verbs
   in `extra` (see sre-sim.js). Objectives check evidence and STATE, never
   typed strings; `sre.unsafe` lists the documented shortcut(s) that fail
   the attempt even when every objective is met. Reset rebuilds the same
   seed; /variant picks the next one.

   Learner-visible text (title, briefs, objective text) never names the
   root cause; mechanism/alternatives/solution live in the debrief block.
   tests/data/test-sre-scenarios.js plays every scenario through the reveal
   ladder, an alternative path, the unsafe shortcut and reset. */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.missions = LX.missions || [];

(function () {
  function SIM() { return window.LXSim; }
  function st(c) { return c.w.sre; }
  /* evidence helpers live in sre-sim.js (quote-aware command segments) */
  function ran(c, re) { return SIM().ran(c, re); }
  function saw(c, re, outRe) { return SIM().saw(c, re, outRe); }
  function lastIs(c, cmdRe, outRe) { return SIM().lastIs(c, cmdRe, outRe); }
  function lastCode(c) { return SIM().lastCode(c); }
  function fileText(c, p) { return SIM().readFile(c.w, p); }
  function node(c, p) { return SIM().fileOf(c.w, p); }
  var SIMPLIFIED_LINUX = [
    'One host, one service, a logical clock: every command advances time by 10 seconds.',
    'systemd is modelled as far as unit loading, start/stop/restart, daemon-reload, the journal and the restart counter; there are no timers, sockets units or drop-ins.',
    'Permissions follow owner/group/other bits with a single service user and group; no ACLs, no capabilities, no SELinux.',
    'Only the documented command set is supported; anything else says so rather than pretending to work.'
  ];
  var SRC_LINUX = ['T15'];

  /* ── a Linux host running Beacon under systemd ─────────────────────
     opts: { configText, configMode, configOwner, configGroup, dirMode,
             unitText, variant, disks, files, extraFiles, hooks } */
  function linuxBeaconWorld(seed, opts) {
    var S = SIM();
    var state = { clock: 0, risky: [], seed: seed, variant: opts.variant,
      unit: { loaded: opts.unitText, failedStarts: 0, active: false, pid: 0, started: null },
      net: { hosts: { 'beacon.corp.lab': '10.0.5.20' }, listeners: [], apps: {}, certs: {}, cas: {}, from: '10.0.5.20' },
      hooks: [] };
    var files = [
      { path: '/etc/beacon/beacon.yaml', content: opts.configText, mode: opts.configMode || '640', owner: opts.configOwner || 'root', group: opts.configGroup || 'beacon' },
      { path: '/etc/systemd/system/beacon.service', content: opts.unitText, mode: '644', owner: 'root', group: 'root' },
      { path: '/opt/beacon/beacon/api.py', content: '# Beacon API (course starter) — see labs/sre-cloud-foundations/beacon\n', mode: '644', owner: 'root', group: 'root' },
      { path: '/opt/beacon/beacon/__main__.py', content: '# python3 -m beacon {api|worker|client}\n', mode: '644', owner: 'root', group: 'root' },
      { path: '/var/lib/beacon/beacon.db', content: '', size: 4096 * 12, owner: 'beacon', group: 'beacon', mode: '640' }
    ].concat(opts.files || []);
    var dirs = [
      { path: '/root', mode: '700', owner: 'root', group: 'root' },
      { path: '/etc/beacon', mode: opts.dirMode || '755', owner: 'root', group: 'root' },
      { path: '/opt/beacon', mode: '755', owner: 'root', group: 'root' },
      { path: '/opt/beacon/beacon', mode: '755', owner: 'root', group: 'root' },
      { path: '/var/lib/beacon', mode: '750', owner: 'beacon', group: 'beacon' }
    ].concat(opts.dirs || []);
    var units = { beacon: { desc: 'Beacon API (course starter service)', enabled: true, active: false, failed: true, log: [] } };
    var world = {
      user: 'root', host: 'beacon-vm', cwd: '/root', arch: 'aarch64', os: 'Linux', kernel: '6.8.0-45-generic', ip: '10.0.5.20',
      disks: opts.disks || [{ fs: '/dev/vda1', size: 20 * 1024 * 1024 * 1024, base: 5 * 1024 * 1024 * 1024, mount: '/', inodes: 1310720, iused: 91003 }],
      dirs: dirs, files: files, units: units, procs: [{ pid: 1, user: 'root', cmd: '/sbin/init' }], sockets: [],
      sre: state, extra: {}
    };
    /* the app the proxy/curl talks to */
    state.net.apps.beacon = { version: '1.4.0', routes: {
      '/healthz': { code: 200, body: 'ok\n' },
      '/ready': function (req, s) { return s.beaconReady === false ? { code: 503, body: { ready: false } } : { code: 200, body: { ready: true, store: 'sqlite' } }; },
      '/version': { code: 200, body: { version: '1.4.0', environment: 'lab' } },
      '/status': function (req, s) {
        if (req.method !== 'POST') return { code: 404, body: 'not found' };
        if (s.storeFull) return { code: 503, body: { error: 'store unavailable' } };
        s.writes = (s.writes || 0) + 1;
        return { code: 201, body: { id: 'rec-' + s.writes, sensor_id: 'sensor-1', status: 'ok', duplicate: false } };
      },
      '/metrics': { code: 200, body: 'beacon_requests_total{route="/healthz",method="GET",code="200"} 12\n' }
    } };

    function unitProp(text, key) {
      var re = new RegExp('^' + key + '=(.*)$', 'm'), m = re.exec(text || '');
      return m ? m[1].trim() : null;
    }
    function canAccess(w, path, user, what) {
      var n = S.fileOf(w, path) || (window.LXShell && LXShell.node(w, path));
      if (!n) return false;
      var mode = String(n.mode || '644'), idx = n.owner === user ? 0 : (n.group === user ? 1 : 2);
      var bits = parseInt(mode.charAt(idx), 10);
      return what === 'r' ? (bits & 4) !== 0 : what === 'w' ? (bits & 2) !== 0 : (bits & 1) !== 0;
    }
    function dirsTraversable(w, path, user) {
      var parts = path.split('/').filter(Boolean), cur = '';
      for (var i = 0; i < parts.length - 1; i++) {
        cur += '/' + parts[i];
        var n = LXShell.node(w, cur);
        if (!n) return { ok: false, where: cur, why: 'no such directory' };
        if (!canAccess(w, cur, user, 'x')) return { ok: false, where: cur, why: 'permission denied' };
      }
      return { ok: true };
    }
    /* what happens when systemd starts the unit from the LOADED unit text */
    function tryStart(w) {
      var u = state.unit, text = u.loaded, U = w.units.beacon;
      var user = unitProp(text, 'User') || 'root';
      var wd = unitProp(text, 'WorkingDirectory') || '/';
      var exec = unitProp(text, 'ExecStart') || '';
      var envCfg = null;
      (text.match(/^Environment=.*$/mg) || []).forEach(function (l) { var m = /BEACON_CONFIG=(\S+)/.exec(l); if (m) envCfg = m[1]; });
      var m = /--config\s+(\S+)/.exec(exec);
      var cfg = m ? m[1] : envCfg;
      var lines = ['Started beacon.service - Beacon API (course starter service).'];
      var fail = null;
      if (!/python3/.test(exec)) fail = 'beacon.service: Failed to execute ' + (exec.split(' ')[0] || '(empty)') + ': No such file or directory';
      else if (!/-m beacon/.test(exec)) fail = 'python3: No module named ' + (exec.replace(/.*-m\s+(\S+).*/, '$1') || 'beacon');
      else if (!LXShell.node(w, wd) || LXShell.node(w, wd).t !== 'd') fail = 'beacon.service: Changing to the requested working directory failed: No such file or directory';
      else if (!LXShell.node(w, wd + '/beacon/__main__.py')) fail = '/usr/bin/python3: No module named beacon';
      else if (!cfg) fail = 'FATAL config: no configuration given (BEACON_CONFIG or --config)';
      else {
        var abs = cfg.charAt(0) === '/' ? cfg : (wd.replace(/\/$/, '') + '/' + cfg);
        var tr = dirsTraversable(w, abs, user);
        if (!tr.ok) fail = 'FATAL config: open ' + cfg + ': permission denied (' + tr.where + ': ' + tr.why + ', running as ' + user + ')';
        else {
          var pr = S.beaconConfigProblem(w, { configPath: abs, user: user });
          if (!pr.ok) fail = pr.log + (pr.why === 'permission' ? '' : '');
          else if (opts.extraStartCheck) fail = opts.extraStartCheck(w, state);
        }
      }
      var startLine = 'starting beacon-api 1.4.0 (config ' + (cfg || 'none') + ', cwd ' + wd + ', user ' + user + ')';
      if (fail) {
        u.failedStarts++;
        U.active = false; U.failed = true; U.result = 'exit-code';
        U.log.push('systemd[1]: Started beacon.service - Beacon API (course starter service).');
        if (!/^beacon\.service:/.test(fail) && !/^\/usr\/bin\/python3|^python3/.test(fail)) U.log.push('beacon-api[' + (3100 + u.failedStarts) + ']: ' + startLine);
        U.log.push((/^beacon\.service:/.test(fail) ? 'systemd[1]: ' : 'beacon-api[' + (3100 + u.failedStarts) + ']: ') + fail);
        U.log.push('systemd[1]: beacon.service: Main process exited, code=exited, status=1/FAILURE');
        U.log.push('systemd[1]: beacon.service: Failed with result \'exit-code\'.');
        if (/Restart=on-failure/.test(text)) {
          U.log.push('systemd[1]: beacon.service: Scheduled restart job, restart counter is at ' + u.failedStarts + '.');
          if (u.failedStarts >= 5) { U.log.push('systemd[1]: beacon.service: Start request repeated too quickly.'); U.log.push('systemd[1]: beacon.service: Failed with result \'start-limit-hit\'.'); U.result = 'start-limit-hit'; }
        }
        stopListening(w);
        return { ok: false, why: fail };
      }
      u.active = true; u.pid = 4200 + u.failedStarts; u.started = state.clock; u.user = user;
      U.active = true; U.failed = false; U.pid = u.pid;
      U.log.push('systemd[1]: Started beacon.service - Beacon API (course starter service).');
      U.log.push('beacon-api[' + u.pid + ']: ' + startLine);
      U.log.push('beacon-api[' + u.pid + ']: listening on 0.0.0.0:8080');
      w.procs = w.procs.filter(function (p) { return !/beacon api/.test(p.cmd); });
      w.procs.push({ pid: u.pid, user: user, cmd: '/usr/bin/python3 -m beacon api', cpu: 0.3, mem: 1.1, start: '09:1' + (u.failedStarts % 10) });
      w.sockets = w.sockets.filter(function (s) { return s.port !== 8080; });
      w.sockets.push({ proto: 'tcp', addr: '0.0.0.0', port: 8080, pid: u.pid, cmd: 'python3', user: user });
      state.net.listeners = state.net.listeners.filter(function (l) { return l.port !== 8080; });
      state.net.listeners.push({ addr: '0.0.0.0', port: 8080, host: '10.0.5.20', app: 'beacon' });
      state.net.listeners.push({ addr: '0.0.0.0', port: 8080, host: '127.0.0.1', app: 'beacon' });
      return { ok: true };
    }
    function stopListening(w) {
      state.unit.active = false; state.unit.pid = 0;
      w.units.beacon.active = false;
      w.procs = w.procs.filter(function (p) { return !/beacon api/.test(p.cmd); });
      w.sockets = w.sockets.filter(function (s) { return s.port !== 8080; });
      state.net.listeners = state.net.listeners.filter(function (l) { return l.port !== 8080; });
    }
    state.tryStart = tryStart; state.stopListening = stopListening; state.canAccess = canAccess;

    var verbs = {
      systemctl: function (w, a) {
        var verb = a[0], unit = (a[1] || '').replace(/\.service$/, '');
        if (verb === 'daemon-reload') { state.unit.loaded = S.readFile(w, '/etc/systemd/system/beacon.service') || state.unit.loaded; state.unit.stale = false; return S.ok(''); }
        if (verb === 'list-units' || verb === 'list-unit-files') return LXShell.exec(w, 'systemctl ' + a.join(' ') + ' ') && S.ok('  UNIT             LOAD   ACTIVE   SUB     DESCRIPTION\n' + (state.unit.active ? '  ' : '● ') + 'beacon.service   loaded ' + (state.unit.active ? 'active   running' : 'failed   failed ') + ' Beacon API (course starter service)\n\n1 loaded units listed.');
        if (unit !== 'beacon') return S.err('Unit ' + (unit || '') + '.service could not be found.', 4);
        var onDisk = S.readFile(w, '/etc/systemd/system/beacon.service');
        var stale = onDisk != null && onDisk !== state.unit.loaded;
        var warn = stale ? 'Warning: The unit file, source configuration file or drop-ins of beacon.service changed on disk. Run \'systemctl daemon-reload\' to reload units.\n' : '';
        var U = w.units.beacon;
        switch (verb) {
          case 'status': {
            var out = warn + '● beacon.service - Beacon API (course starter service)\n     Loaded: loaded (/etc/systemd/system/beacon.service; enabled; preset: enabled)\n     Active: ' +
              (state.unit.active ? 'active (running) since ' + S.stamp({ clock: state.unit.started }) + '; ' + (state.clock - state.unit.started) + 's ago' : 'failed (Result: ' + (U.result || 'exit-code') + ') since ' + S.stamp(state) + '; 2s ago') + '\n' +
              (state.unit.active ? '   Main PID: ' + state.unit.pid + ' (python3)\n' : '    Process: ' + (3100 + state.unit.failedStarts) + ' ExecStart=' + (unitProp(state.unit.loaded, 'ExecStart') || '') + ' (code=exited, status=1/FAILURE)\n') +
              '      Tasks: ' + (state.unit.active ? '3' : '0') + '\n     Memory: ' + (state.unit.active ? '24.1M' : '0B') + '\n        CPU: 112ms\n\n' + U.log.slice(-6).map(function (l) { return 'Oct 13 09:12:' + (10 + (state.clock % 50)) + ' beacon-vm ' + l; }).join('\n');
            return { out: out + '\n', code: state.unit.active ? 0 : 3 };
          }
          case 'start': case 'restart': {
            if (verb === 'restart' || !state.unit.active) {
              if (state.unit.active) { stopListening(w); U.log.push('systemd[1]: Stopping beacon.service - Beacon API (course starter service)...'); }
              if (U.result === 'start-limit-hit' && !ran({ ran: [] }, /x/)) { /* reset-failed clears it */ }
              var r = tryStart(w);
              if (!r.ok) return S.err(warn + 'Job for beacon.service failed because the control process exited with error code.\nSee "systemctl status beacon.service" and "journalctl -xeu beacon.service" for details.', 1);
            }
            return S.ok(warn.replace(/\n$/, ''));
          }
          case 'stop': stopListening(w); U.log.push('systemd[1]: Stopped beacon.service - Beacon API (course starter service).'); return S.ok('');
          case 'reset-failed': U.result = null; U.failed = false; state.unit.failedStarts = 0; return S.ok('');
          case 'is-active': return { out: (state.unit.active ? 'active' : 'failed') + '\n', code: state.unit.active ? 0 : 3 };
          case 'is-enabled': return S.ok('enabled');
          case 'enable': case 'disable': return S.ok('');
          case 'cat': return S.ok('# /etc/systemd/system/beacon.service\n' + (onDisk || state.unit.loaded));
          case 'show': {
            var props = []; for (var i = 2; i < a.length; i++) { if (a[i] === '-p' || a[i] === '--property') props.push(a[++i]); else if (/^-p/.test(a[i])) props.push(a[i].slice(2)); else if (/^--property=/.test(a[i])) props.push(a[i].slice(11)); }
            var vals = { MainPID: String(state.unit.pid || 0), ActiveState: state.unit.active ? 'active' : 'failed', SubState: state.unit.active ? 'running' : 'failed', Result: state.unit.active ? 'success' : (U.result || 'exit-code'),
              User: unitProp(state.unit.loaded, 'User') || '', WorkingDirectory: unitProp(state.unit.loaded, 'WorkingDirectory') || '', ExecStart: '{ path=' + ((unitProp(state.unit.loaded, 'ExecStart') || '').split(' ')[0]) + ' ; argv[]=' + (unitProp(state.unit.loaded, 'ExecStart') || '') + ' }',
              Environment: (state.unit.loaded.match(/^Environment=(.*)$/mg) || []).map(function (l) { return l.slice(12); }).join(' '), NRestarts: String(state.unit.failedStarts), Restart: /Restart=on-failure/.test(state.unit.loaded) ? 'on-failure' : 'no', UnitFileState: 'enabled', NeedDaemonReload: stale ? 'yes' : 'no' };
            if (a.indexOf('--value') !== -1 && props.length === 1) return S.ok(vals[props[0]] == null ? '' : vals[props[0]]);
            var keys = props.length ? props : Object.keys(vals);
            return S.ok(keys.map(function (k) { return k + '=' + (vals[k] == null ? '' : vals[k]); }).join('\n'));
          }
          default: return S.unsupported('systemctl', verb || '', ['status', 'start', 'restart', 'stop', 'reset-failed', 'cat', 'show -p', 'daemon-reload', 'is-active', 'list-units']);
        }
      },
      journalctl: function (w, a) {
        var n = 20, unit = null, grepRe = null;
        for (var i = 0; i < a.length; i++) { if (a[i] === '-u' || a[i] === '--unit') unit = (a[++i] || '').replace(/\.service$/, ''); else if (/^-u/.test(a[i])) unit = a[i].slice(2).replace(/\.service$/, ''); else if (a[i] === '-n' || a[i] === '--lines') n = parseInt(a[++i], 10) || 20; else if (/^-n\d/.test(a[i])) n = parseInt(a[i].slice(2), 10); else if (a[i] === '-g' || a[i] === '--grep') grepRe = new RegExp(a[++i], 'i'); }
        if (a.indexOf('-f') !== -1 || a.indexOf('--follow') !== -1) return S.err('journalctl -f is not supported in this simulation: run it again to see new lines (each command advances the clock).', 2);
        var lines = unit && unit !== 'beacon' ? [] : w.units.beacon.log;
        if (grepRe) lines = lines.filter(function (l) { return grepRe.test(l); });
        if (!lines.length) return S.ok('-- No entries --');
        return S.ok(lines.slice(-n).map(function (l, idx) { return 'Oct 13 09:1' + ((idx + state.clock / 10) % 10 | 0) + ':' + (10 + idx % 50) + ' beacon-vm ' + l; }).join('\n'));
      },
      namei: function (w, a) {
        var p = a.filter(function (x) { return x.charAt(0) !== '-'; })[0];
        if (!p) return S.err('namei: missing operand');
        var parts = p.split('/').filter(Boolean), cur = '', out = ['f: ' + p];
        var root = LXShell.node(w, '/');
        out.push(' d' + 'rwxr-xr-x root root /');
        for (var i = 0; i < parts.length; i++) {
          cur += '/' + parts[i];
          var n = LXShell.node(w, cur);
          if (!n) { out.push('                                  ' + parts[i] + ' - No such file or directory'); break; }
          var m = String(n.mode || '644'), s = '';
          [0, 1, 2].forEach(function (k) { var b = parseInt(m.charAt(k), 10); s += (b & 4 ? 'r' : '-') + (b & 2 ? 'w' : '-') + (b & 1 ? 'x' : '-'); });
          out.push(' ' + (n.t === 'd' ? 'd' : '-') + s + ' ' + S.pad(n.owner || 'root', 6) + ' ' + S.pad(n.group || 'root', 6) + ' ' + parts[i]);
        }
        return S.ok(out.join('\n'));
      },
      sudo: function (w, a) {
        /* only `sudo -u USER cat FILE` / `sudo -u USER test -r FILE` / `sudo -u USER ls DIR` are modelled */
        if (a[0] !== '-u' || !a[1]) return S.err('sudo (simulation): only "sudo -u USER cat|ls|test FILE" is modelled; you are already root-equivalent for other commands here.');
        var user = a[1], cmd = a[2], target = a.slice(3).filter(function (x) { return x.charAt(0) !== '-'; })[0];
        if (!target) return S.err('sudo: missing path');
        var tr = dirsTraversable(w, LXShell.resolve(w, target), user);
        if (!tr.ok) return S.err(cmd + ': ' + target + ': Permission denied');
        if (!canAccess(w, LXShell.resolve(w, target), user, 'r')) return S.err(cmd + ': ' + target + ': Permission denied');
        if (cmd === 'cat') return S.ok(S.readFile(w, target) || '');
        if (cmd === 'test') return S.ok('');
        if (cmd === 'ls') return LXShell.exec(w, 'ls ' + a.slice(3).join(' '));
        return S.err('sudo (simulation): unsupported command ' + cmd);
      },
      id: function (w, a) {
        if (a[0] === 'beacon') return S.ok('uid=998(beacon) gid=998(beacon) groups=998(beacon)');
        return S.ok('uid=0(root) gid=0(root) groups=0(root)');
      },
      curl: S.verbs.curl(state),
      edit: S.verbs.edit()
    };
    Object.keys(opts.verbs || {}).forEach(function (k) { verbs[k] = opts.verbs[k](state, { tryStart: tryStart, stopListening: stopListening }); });
    world.extra = S.bind(state, verbs);
    /* initial state: the unit tried to start and failed (or is up, per opts) */
    if (opts.initialStart !== false) {
      /* run once createWorld has materialised the files: defer via hook on first command */
      state.hooks.push(function once(s, w) { if (s._booted) return; s._booted = true; if (opts.bootLines) w.units.beacon.log.push.apply(w.units.beacon.log, opts.bootLines); for (var i = 0; i < (opts.initialFailures || 3); i++) tryStart(w); });
    }
    return world;
  }
  var UNIT_OK = '[Unit]\nDescription=Beacon API (course starter service)\nAfter=network-online.target\n\n[Service]\nType=simple\nUser=beacon\nGroup=beacon\nWorkingDirectory=/opt/beacon\nEnvironment=PYTHONUNBUFFERED=1\nEnvironment=BEACON_CONFIG=/etc/beacon/beacon.yaml\nExecStart=/usr/bin/python3 -m beacon api\nRestart=on-failure\nRestartSec=2\n\n[Install]\nWantedBy=multi-user.target\n';
  var CONFIG_OK = 'server:\n  listen: 0.0.0.0\n  port: 8080\napp:\n  version: "1.4.0"\n  environment: lab\nstore:\n  kind: sqlite\n  path: /var/lib/beacon/beacon.db\nqueue:\n  kind: none\n';
  var LINUX_GRAMMAR = ['`systemctl status|start|restart|stop|cat|show -p PROP|daemon-reload beacon`', '`journalctl -u beacon [-n N] [-g PATTERN]`', '`ls -l`, `cat`, `stat`, `namei -l PATH`, `sudo -u beacon cat FILE`, `id beacon`', '`chown USER:GROUP FILE`, `chmod MODE FILE`, `sed -i`, `edit FILE KEY VALUE`', '`curl [-i|-s|-v] http://127.0.0.1:8080/healthz`'];
  var LINUX_PALETTE = ['systemctl status beacon', 'journalctl -u beacon -n 20', 'systemctl cat beacon', 'systemctl show beacon -p ExecStart -p WorkingDirectory -p User', 'ls -l /etc/beacon/', 'namei -l /etc/beacon/beacon.yaml', 'sudo -u beacon cat /etc/beacon/beacon.yaml', 'systemctl daemon-reload', 'systemctl restart beacon', 'curl -i http://127.0.0.1:8080/healthz'];
  function worldWritable(c, p) { var n = node(c, p) || LXShell.node(c.w, p); return !!n && (parseInt(String(n.mode || '644').charAt(2), 10) & 2) !== 0; }
  function worldReadable(c, p) { var n = node(c, p) || LXShell.node(c.w, p); return !!n && (parseInt(String(n.mode || '644').charAt(2), 10) & 4) !== 0; }
  function unitRunsAs(c, user) { var m = /^User=(.*)$/m.exec(st(c).unit.loaded || ''); return (m ? m[1].trim() : 'root') === user; }

  /* ═══ S01 · Health check fails after a config change ═════════════ */
  LX.missions.push({
    id: 'sre-s01', track: 'sre', cat: 'scenario', level: 'beginner', mins: 20, kind: 'incident',
    title: 'Beacon health check failing after this morning\'s config change',
    brief: function (seed) { return 'At 09:05 a colleague "moved the Beacon config to its proper place" and restarted the service. The load balancer now reports the health check failing on beacon-vm. The config file itself was reviewed and is fine. Get the service answering `/healthz` again with the smallest change, and say what actually happened.'; },
    keys: LINUX_PALETTE,
    world: function (seed) {
      var v = SIM().variantOf(seed, ['a', 'b']);
      var unit = v === 'a'
        ? UNIT_OK.replace('ExecStart=/usr/bin/python3 -m beacon api', 'ExecStart=/usr/bin/python3 -m beacon api --config /etc/beacon/becaon.yaml').replace('Environment=BEACON_CONFIG=/etc/beacon/beacon.yaml\n', '')
        : UNIT_OK.replace('Environment=BEACON_CONFIG=/etc/beacon/beacon.yaml', 'Environment=BEACON_CONFIG=/etc/beacon/beacon.yml');
      return linuxBeaconWorld(seed, { variant: v, unitText: unit, configText: CONFIG_OK, bootLines: ['systemd[1]: Stopping beacon.service - Beacon API (course starter service)...', 'systemd[1]: Stopped beacon.service - Beacon API (course starter service).'] });
    },
    objectives: [
      { id: 'symptom', stage: 'evidence', text: 'Establish how the service is failing, from systemd and the journal',
        hint: 'A failing health check means the load balancer got no answer. Is the process even running, and what did it say last?',
        hint2: 'systemctl status shows the state and the last journal lines; journalctl -u beacon shows more.',
        reveal: 'journalctl -u beacon -n 20',
        done: function (c) { return saw(c, /systemctl\s+status\s+beacon|journalctl\b.*-u\s*beacon/, /FATAL config|status=1\/FAILURE/); } },
      { id: 'unit', stage: 'evidence', text: 'Find where the service is told which configuration file to read',
        hint: 'The application reads the path it was given. Who gives it?',
        hint2: 'The unit file: `systemctl cat beacon` or `systemctl show beacon -p ExecStart -p Environment`.',
        reveal: 'systemctl cat beacon',
        done: function (c) { return saw(c, /systemctl\s+(cat|show)\s+beacon|cat\s+\/etc\/systemd\/system\/beacon\.service/, /--config|BEACON_CONFIG/); } },
      { id: 'compare', stage: 'evidence', text: 'Compare the path the service was given with what actually exists in /etc/beacon',
        hint: 'A path in an error message is a claim; the directory listing is the fact.',
        hint2: '`ls -l /etc/beacon/` and read the two names character by character.',
        reveal: 'ls -l /etc/beacon/',
        done: function (c) { return saw(c, /ls\b.*\/etc\/beacon|stat\s+\/etc\/beacon|find\s+\/etc\/beacon|namei.*\/etc\/beacon/, /beacon\.yaml/); } },
      { id: 'fix', stage: 'fix', text: 'Make the service read the configuration that exists, with the smallest change, and reload systemd',
        hint: 'Fix the reference, not the file. One character.',
        hint2: 'Edit the unit (`sed -i` or `edit`), then `systemctl daemon-reload` so systemd sees the new unit text.',
        reveal: function (c) { return st(c).variant === 'a' ? "sed -i 's#becaon.yaml#beacon.yaml#' /etc/systemd/system/beacon.service && systemctl daemon-reload" : "sed -i 's#beacon.yml#beacon.yaml#' /etc/systemd/system/beacon.service && systemctl daemon-reload"; },
        done: function (c) { var loaded = st(c).unit.loaded || ''; var m = /--config\s+(\S+)/.exec(loaded) || /BEACON_CONFIG=(\S+)/.exec(loaded); return !!m && !!node(c, m[1]) && !/becaon|beacon\.yml/.test(loaded); } },
      { id: 'verify', stage: 'verify', text: 'Restart the service and verify the user path: /healthz answers 200',
        hint: 'The process being "active" is not the user path.',
        hint2: '`systemctl restart beacon`, then `curl -i http://127.0.0.1:8080/healthz`.',
        reveal: 'systemctl restart beacon && curl -i http://127.0.0.1:8080/healthz',
        done: function (c) { return st(c).unit.active && lastIs(c, /curl\b.*8080\/healthz/, /200 OK|^ok\b/m) && lastCode(c) === 0; } }
    ],
    sre: {
      scenarioId: 'S01', moduleId: 'M01', lab: 'L01', variants: ['a', 'b'],
      symptom: 'Load-balancer health check failing; service restarts and exits.',
      neutralTitle: 'Beacon health check failing after a routine change',
      neutralBrief: 'The load balancer reports the Beacon health check failing on beacon-vm since a routine change this morning. The config file was reviewed and is fine. Restore service to users with the smallest change and explain the cause.',
      impact: 'Users behind the load balancer get no Beacon responses.', changes: 'A config "move" and a restart at 09:05.',
      spoilers: ['typo', 'becaon', 'yml', 'path', 'unit file', 'ExecStart'],
      tools: ['systemctl', 'journalctl', 'ls', 'cat', 'stat', 'namei', 'sudo -u', 'chmod', 'chown', 'sed -i', 'edit', 'curl'],
      grammar: LINUX_GRAMMAR, palette: LINUX_PALETTE,
      assumptions: ['You are root on beacon-vm.', 'The configuration file content is correct; the ticket says so and it is true.'],
      simplified: SIMPLIFIED_LINUX,
      unsafe: [
        { label: 'duplicated the config to satisfy the wrong reference', why: 'Creating a copy at the misspelled path makes the symptom disappear and leaves two files to drift apart; the reference was wrong, not the file.',
          test: function (c) { return !!(node(c, '/etc/beacon/becaon.yaml') || node(c, '/etc/beacon/beacon.yml')); },
          demo: function (c, v) { return v === 'a' ? 'cp /etc/beacon/beacon.yaml /etc/beacon/becaon.yaml' : 'cp /etc/beacon/beacon.yaml /etc/beacon/beacon.yml'; } }
      ],
      alt: function (v) { return ['systemctl status beacon', 'systemctl show beacon -p ExecStart -p Environment', 'namei -l /etc/beacon/beacon.yaml',
        v === 'a' ? "sed -i 's/becaon/beacon/' /etc/systemd/system/beacon.service" : "sed -i 's/beacon\\.yml$/beacon.yaml/' /etc/systemd/system/beacon.service",
        'systemctl daemon-reload', 'systemctl restart beacon', 'curl -s http://127.0.0.1:8080/healthz']; },
      mechanism: 'systemd runs the application with exactly the command and environment in the **loaded** unit. The 09:05 change edited the unit so the configuration path no longer matched the file on disk (one character). The application opened the path it was given, got "no such file", logged a FATAL line and exited 1; `Restart=on-failure` retried until the start limit. A restart without changing the unit repeats the failure. Fixing the reference and running `daemon-reload` makes the next start read the real file; `/healthz` then answers.',
      alternatives: [
        { h: 'The config content is broken', out: 'Ruled out: the error is "no such file", and `cat /etc/beacon/beacon.yaml` parses; a content error would say so with a line number.' },
        { h: 'Permissions', out: 'Ruled out: "permission denied" is a different message, and `namei -l` shows the file readable by group beacon.' },
        { h: 'The port is taken', out: 'Ruled out: the process never reached listening; a bind failure would log "listen 0.0.0.0:8080: address in use".' }
      ],
      clues: ['The warning that the unit file changed on disk is only a reminder to daemon-reload; it is not the cause.'],
      passRubric: ['Names the exact mismatch between the path given and the file present', 'Explains why a restart alone recurs', 'States why daemon-reload was needed after editing the unit', 'Verifies on the user path, not on "active (running)"'],
      prereqs: ['les-m01-01', 'les-m01-03'], refs: ['T15']
    }
  });

  /* ═══ S02 · Deployment fails after merge ══════════════════════════ */
  LX.missions.push({
    id: 'sre-s02', track: 'sre', cat: 'scenario', level: 'beginner', mins: 20, kind: 'incident',
    title: 'Deploy of beacon-deploy fails right after the merge of feature/replicas',
    brief: function () { return 'The deploy pipeline for `beacon-deploy` fails on `deploy/beacon.yaml` since the merge of `feature/replicas` into your branch. The merge is still in progress in /home/lab/beacon-deploy. Both branches carried changes people need. Finish the merge so the file validates, both intended changes survive, and explain what went wrong.'; },
    keys: ['git status', 'git diff', 'git log --oneline', 'cat deploy/beacon.yaml', 'beaconctl config validate deploy/beacon.yaml', 'edit deploy/beacon.yaml ', 'git add deploy/beacon.yaml', 'git commit -m "', 'git show feature/replicas:deploy/beacon.yaml'],
    world: function (seed) {
      var S = SIM(), v = S.variantOf(seed, ['a', 'b']);
      var base = 'server:\n  listen: 0.0.0.0\n  port: 8080\napp:\n  version: "1.4.0"\n  environment: lab\nstore:\n  kind: sqlite\n  path: /var/lib/beacon/beacon.db\n';
      var ours, theirs, conflicted, intended;
      if (v === 'a') {
        ours = base.replace('  port: 8080', '  port: 8081');
        theirs = base.replace('  port: 8080', '  port: "8080"\n  replicas: 3');
        conflicted = base.replace('  port: 8080', '<<<<<<< HEAD\n  port: 8081\n=======\n  port: "8080"\n  replicas: 3\n>>>>>>> feature/replicas');
        intended = { 'server.port': '8081', 'server.replicas': '3' };
      } else {
        ours = base.replace('  environment: lab', '  environment: lab\n  admin_enabled: false');
        theirs = base.replace('app:\n  version: "1.4.0"\n  environment: lab', 'app:\n  version: "1.4.0"\n    environment: lab\n  replicas: 3');
        conflicted = base.replace('app:\n  version: "1.4.0"\n  environment: lab', 'app:\n  version: "1.4.0"\n<<<<<<< HEAD\n  environment: lab\n  admin_enabled: false\n=======\n    environment: lab\n  replicas: 3\n>>>>>>> feature/replicas');
        intended = { 'app.environment': 'lab', 'app.admin_enabled': 'false', 'app.replicas': '3' };
      }
      var state = { clock: 0, risky: [], variant: v, intended: intended, hooks: [],
        git: { branch: 'release/1.4', remote: 'origin', log: [{ sha: '9f3c2a1b0000000000000000000000000000dead', msg: v === 'a' ? 'beacon: move API to 8081 to avoid the proxy clash' : 'beacon: disable admin endpoints outside labs' }, { sha: '7a1d0e5c00000000000000000000000000000001', msg: 'beacon: initial deploy config' }],
          files: { 'deploy/beacon.yaml': ours, 'README.md': '# beacon-deploy\nDeployment configuration for Beacon.\n' },
          branches: { 'feature/replicas': { 'deploy/beacon.yaml': theirs } }, merging: 'feature/replicas', conflicts: ['deploy/beacon.yaml'], staged: [], stagedContent: {}, ahead: 0 } };
      var verbs = {
        git: S.verbs.git(state),
        beaconctl: function (w, a) {
          if (a[0] !== 'config' || a[1] !== 'validate' || !a[2]) return S.unsupported('beaconctl', a.join(' '), ['config validate FILE']);
          var text = S.readFile(w, a[2]);
          if (text == null) return S.err('beaconctl: ' + a[2] + ': no such file', 2);
          var problems = S.yamlCheck(text);
          var port = S.yamlGet(text, 'server.port');
          if (port != null && !/^\d+$/.test(port)) problems.push('server.port must be an integer 1–65535, got ' + JSON.stringify(port) + ' (string)');
          if (text.indexOf('"8080"') !== -1 && /port: "8080"/.test(text)) { /* covered above */ }
          var rep = S.yamlGet(text, 'server.replicas') || S.yamlGet(text, 'app.replicas');
          if (rep != null && !/^\d+$/.test(rep)) problems.push('replicas must be an integer, got ' + JSON.stringify(rep));
          String(text).split('\n').forEach(function (ln, i) { if (/^\s{4,}\S/.test(ln) && !/^\s{4}/.test(String(text).split('\n')[i - 1] || '')) problems.push((i + 1) + ': unexpected indentation (key nested one level too deep)'); });
          if (problems.length) return S.err(problems.map(function (p) { return a[2] + ':' + p; }).join('\n') + '\n' + problems.length + ' problem' + (problems.length > 1 ? 's' : ''), 1);
          return S.ok(a[2] + ': OK (' + String(text).split('\n').filter(Boolean).length + ' lines, server.port=' + port + ')');
        },
        edit: S.verbs.edit()
      };
      return { user: 'lab', host: 'beacon-vm', cwd: '/home/lab/beacon-deploy',
        dirs: [{ path: '/home/lab/beacon-deploy/deploy' }],
        files: [{ path: '/home/lab/beacon-deploy/deploy/beacon.yaml', content: conflicted }, { path: '/home/lab/beacon-deploy/README.md', content: '# beacon-deploy\nDeployment configuration for Beacon.\n' }, { path: '/home/lab/beacon-deploy/.git/MERGE_HEAD', content: 'feature/replicas\n' }],
        sre: state, extra: S.bind(state, verbs) };
    },
    objectives: [
      { id: 'state', stage: 'evidence', text: 'Establish the repository state: what is in progress and which file is unmerged',
        hint: 'Git tells you what it is waiting for.', hint2: '`git status` names the merge in progress and the unmerged path.',
        reveal: 'git status',
        done: function (c) { return saw(c, /git\s+status/, /unmerged|Unmerged paths/); } },
      { id: 'both', stage: 'evidence', text: 'Read both sides of the conflict and state what each branch intended',
        hint: 'A conflict is Git refusing to guess. Both versions are in the file.', hint2: '`git diff` or `cat deploy/beacon.yaml` shows the markers; HEAD is above =======.',
        reveal: 'git diff',
        done: function (c) { return saw(c, /git\s+diff|cat\s+.*deploy\/beacon\.yaml|git\s+show\s+feature\/replicas:/, /<{7}|>{7}|replicas: 3/); } },
      { id: 'invalid', stage: 'evidence', text: 'Show that the file as it stands does not validate, and why',
        hint: 'Before editing, see what the validator says about the current content.', hint2: '`beaconctl config validate deploy/beacon.yaml` reports markers and types.',
        reveal: 'beaconctl config validate deploy/beacon.yaml',
        done: function (c) { return saw(c, /beaconctl\s+config\s+validate/, /conflict marker|must be an integer|indentation/); } },
      { id: 'resolve', stage: 'fix', text: 'Resolve the file so both intended changes survive with correct types and no markers, then stage and commit the merge',
        hint: 'The intended result combines both branches; keep the numeric type.', hint2: 'Edit the file (edit/sed -i), remove all three marker lines, validate, `git add`, `git commit -m`.',
        reveal: function (c) { return st(c).variant === 'a'
          ? "sed -i '/^<<<<<<< HEAD$/d; /^=======$/d; /^>>>>>>> feature\\/replicas$/d; /^  port: \"8080\"$/d' deploy/beacon.yaml && git add deploy/beacon.yaml && git commit -m 'merge feature/replicas: keep port 8081, add replicas'"
          : "sed -i '/^<<<<<<< HEAD$/d; /^=======$/d; /^>>>>>>> feature\\/replicas$/d; /^    environment: lab$/d' deploy/beacon.yaml && git add deploy/beacon.yaml && git commit -m 'merge feature/replicas: keep admin flag, add replicas'"; },
        done: function (c) {
          var s = st(c), text = fileText(c, '/home/lab/beacon-deploy/deploy/beacon.yaml') || '';
          if (s.git.merging || /^(<{7}|={7}|>{7})/m.test(text)) return false;
          var okAll = Object.keys(s.intended).every(function (k) { return SIM().yamlGet(text, k) === s.intended[k]; });
          var committed = s.git.log[0] && s.git.log[0].merge === 'feature/replicas';
          return okAll && committed && s.git.files['deploy/beacon.yaml'] === text;
        } },
      { id: 'verify', stage: 'verify', text: 'Validate the committed file and confirm the working tree is clean',
        hint: 'A merge is done when the file validates and git has nothing left to say.', hint2: '`beaconctl config validate deploy/beacon.yaml` then `git status`.',
        reveal: 'beaconctl config validate deploy/beacon.yaml && git status',
        done: function (c) { var s = st(c); return !s.git.merging && ran(c, /beaconctl\s+config\s+validate/) && c.out.slice(-2).some(function (o) { return /: OK/.test(o); }) && lastIs(c, /git\s+status|beaconctl/, /nothing to commit|: OK/); } }
    ],
    sre: {
      scenarioId: 'S02', moduleId: 'M01', lab: 'L02', variants: ['a', 'b'],
      symptom: 'Deploy pipeline fails on deploy/beacon.yaml after a merge.',
      neutralTitle: 'Deploy failing on a configuration file after a merge',
      neutralBrief: 'The deploy pipeline fails on deploy/beacon.yaml since a merge into your branch in /home/lab/beacon-deploy. The merge is still in progress and both branches carried changes people need. Finish it correctly and explain the failure.',
      impact: 'No deploys can go out until the file validates.', changes: 'feature/replicas merged into release/1.4 twenty minutes ago.',
      spoilers: ['conflict marker', 'quoted', 'string', 'indent', 'type'],
      tools: ['git (status, diff, log, show, add, commit, checkout, merge --abort, revert)', 'cat', 'sed -i', 'edit', 'beaconctl config validate'],
      grammar: ['`git status|diff|log --oneline|show BRANCH:FILE|add FILE|commit -m MSG|merge --abort|revert HEAD`', '`beaconctl config validate FILE` (a lab stand-in for the deploy validator)', '`edit FILE dotted.key VALUE`, `sed -i`, `cat`'],
      palette: ['git status', 'git diff', 'git log --oneline', 'cat deploy/beacon.yaml', 'beaconctl config validate deploy/beacon.yaml', 'edit deploy/beacon.yaml ', 'git add deploy/beacon.yaml', 'git commit -m "'],
      assumptions: ['Both branches\' changes are wanted; neither author is available.', 'The validator is the same one the pipeline runs.'],
      simplified: ['Git is modelled as far as status, diff, log, show, add, commit, checkout --, merge --abort and revert on a handful of files; there is no remote beyond `push` bookkeeping.', 'The validator checks YAML structure and the few typed fields Beacon cares about.', 'Each command advances the clock 10 seconds.'],
      unsafe: [
        { label: 'dropped the other branch\'s intended change', why: 'Resolving by keeping only one side silently discards work a colleague meant to ship; the ticket said both changes are needed.',
          test: function (c) { var s = st(c); if (s.git.merging || !(s.git.log[0] && s.git.log[0].merge)) return false; var text = s.git.files['deploy/beacon.yaml'] || ''; return Object.keys(s.intended).some(function (k) { return SIM().yamlGet(text, k) == null; }); },
          demo: 'git checkout --ours deploy/beacon.yaml && git add deploy/beacon.yaml && git commit -m "keep ours"' }
      ],
      alt: function (v) { return ['git status', 'git show feature/replicas:deploy/beacon.yaml', 'beaconctl config validate deploy/beacon.yaml',
        v === 'a' ? "sed -i '/^[<=>]\\{7\\}/d; /port: \"8080\"/d' deploy/beacon.yaml" : "sed -i '/^[<=>]\\{7\\}/d; /^    environment: lab$/d' deploy/beacon.yaml",
        'git add deploy/beacon.yaml', 'git commit -m "merge feature/replicas into release/1.4"', 'beaconctl config validate deploy/beacon.yaml', 'git status']; },
      mechanism: 'Two branches changed adjacent lines of the same file. Git wrote both versions between conflict markers and stopped; the pipeline then validated a file containing `<<<<<<<`, which is not YAML. Resolving means deciding the intended combined result — here: one branch\'s value change **and** the other branch\'s new key, with the correct type (a number, at the right indentation) — removing the markers, validating, staging with `git add` (which is how Git learns the path is resolved) and committing the merge.',
      alternatives: [
        { h: 'The pipeline is broken', out: 'Ruled out: the validator reproduces the failure locally on the file as it stands.' },
        { h: 'Just take the other branch', out: 'Rejected: it drops your branch\'s change (or re-introduces a quoted port / wrong indentation); the ticket needs both.' },
        { h: 'Abort the merge', out: 'A legitimate pause, not a resolution: the deploy still needs the feature branch\'s change.' }
      ],
      clues: ['`git log` showing your own recent commit is context, not a fault.'],
      passRubric: ['Identifies the markers as the immediate validation failure and the type/indentation problem as the second', 'States each branch\'s intent and the combined result', 'Explains why git add is part of resolving', 'Validates before committing and verifies a clean tree after'],
      prereqs: ['les-m01-02', 'les-m01-03'], refs: ['T12']
    }
  });

  /* ═══ S03 · Service repeatedly exits ══════════════════════════════ */
  LX.missions.push({
    id: 'sre-s03', track: 'sre', cat: 'scenario', level: 'beginner', mins: 25, kind: 'incident',
    title: 'Beacon keeps exiting seconds after it starts, since the security hardening',
    brief: function () { return 'Last night\'s hardening pass tightened file ownership under /etc on beacon-vm. Since then `beacon.service` starts and exits within a second, over and over, until systemd gives up. The team wants it running as the `beacon` user with the config kept private to the service. Fix it narrowly and prove the process runs as the right user.'; },
    keys: LINUX_PALETTE.concat(['chown root:beacon /etc/beacon/beacon.yaml', 'chmod 640 /etc/beacon/beacon.yaml', 'ps -o user=,pid=,cmd= -p ']),
    world: function (seed) {
      var v = SIM().variantOf(seed, ['a', 'b']);
      return linuxBeaconWorld(seed, { variant: v, unitText: UNIT_OK, configText: CONFIG_OK,
        configMode: v === 'a' ? '600' : '640', configOwner: 'root', configGroup: v === 'a' ? 'root' : 'beacon', dirMode: v === 'b' ? '700' : '755',
        initialFailures: 5, bootLines: ['systemd[1]: Stopped beacon.service - Beacon API (course starter service).'] });
    },
    objectives: [
      { id: 'symptom', stage: 'evidence', text: 'Read why the service exits, in its own words',
        hint: 'Exiting within a second with status 1 is the application refusing to run. The journal has the reason.', hint2: '`journalctl -u beacon -n 30`; look at the line before "Main process exited".',
        reveal: 'journalctl -u beacon -n 30',
        done: function (c) { return saw(c, /journalctl\b.*-u\s*beacon|systemctl\s+status\s+beacon/, /permission denied/i); } },
      { id: 'who', stage: 'evidence', text: 'Establish which user the service runs as',
        hint: 'A permission problem is always relative to a user.', hint2: '`systemctl show beacon -p User` or the unit text.',
        reveal: 'systemctl show beacon -p User -p ExecStart',
        done: function (c) { return saw(c, /systemctl\s+(show|cat)\s+beacon|cat\s+\/etc\/systemd\/system\/beacon\.service/, /User=beacon/); } },
      { id: 'perms', stage: 'evidence', text: 'Show the ownership and mode along the whole path to the config, and prove the service user cannot read it',
        hint: 'Every directory on the way needs execute permission; the file needs read.', hint2: '`namei -l /etc/beacon/beacon.yaml` shows each component; `sudo -u beacon cat /etc/beacon/beacon.yaml` proves it.',
        reveal: 'namei -l /etc/beacon/beacon.yaml',
        done: function (c) { return saw(c, /namei.*\/etc\/beacon|ls\s+-l[a-z]*\s+\/etc\/beacon|stat\s+.*\/etc\/beacon|sudo\s+-u\s+beacon\s+cat/, /root\s+root\s+beacon\.yaml|rwx------|d.{8}\s+root\s+root\s+beacon$|Permission denied/); } },
      { id: 'fix', stage: 'fix', text: 'Grant the service user exactly the access it needs — no more — and restart',
        hint: 'Group permission exists for precisely this: the service user\'s group reads, others do not.', hint2: 'Fix the one component namei showed as blocking: the file\'s group/mode, or the directory\'s mode. Then restart.',
        reveal: function (c) { return st(c).variant === 'a' ? 'chown root:beacon /etc/beacon/beacon.yaml && chmod 640 /etc/beacon/beacon.yaml && systemctl restart beacon' : 'chmod 755 /etc/beacon && systemctl restart beacon'; },
        done: function (c) { var s = st(c); return s.unit.active && s.unit.user === 'beacon' && !worldReadable(c, '/etc/beacon/beacon.yaml') && !worldWritable(c, '/etc/beacon/beacon.yaml') && unitRunsAs(c, 'beacon'); } },
      { id: 'verify', stage: 'verify', text: 'Prove the process runs as beacon and that /healthz answers',
        hint: 'Two facts: the main PID\'s user, and the user path.', hint2: '`systemctl show beacon -p MainPID` + `ps -o user= -p PID`, then curl /healthz.',
        reveal: 'ps -o user=,pid=,cmd= -p $(systemctl show beacon -p MainPID --value) && curl -i http://127.0.0.1:8080/healthz',
        done: function (c) { var s = st(c); return s.unit.active && s.unit.user === 'beacon' && ran(c, /ps\b.*-p|systemctl\s+status\s+beacon|systemctl\s+show\s+beacon.*MainPID/) && lastIs(c, /curl\b.*8080\/healthz/, /200 OK|^ok\b/m); } }
    ],
    sre: {
      scenarioId: 'S03', moduleId: 'M02', lab: 'L03', variants: ['a', 'b'],
      symptom: 'Service starts and exits within a second, repeatedly, until the start limit.',
      neutralTitle: 'Beacon exiting seconds after start since last night\'s change',
      neutralBrief: 'Since last night\'s change on beacon-vm, beacon.service starts and exits within a second, repeatedly, until systemd gives up. The team wants it running as the beacon user with its configuration kept private to the service. Fix it narrowly and prove who the process runs as.',
      impact: 'Beacon is down on this host.', changes: 'A hardening pass changed ownership and modes under /etc last night.',
      spoilers: ['permission', 'owner', 'ownership', 'mode', '600', '700', 'root:root'],
      tools: ['systemctl', 'journalctl', 'namei', 'ls', 'stat', 'sudo -u beacon cat', 'id', 'chown', 'chmod', 'ps', 'curl'],
      grammar: LINUX_GRAMMAR.concat(['`ps -o user=,pid=,cmd= -p PID`']), palette: LINUX_PALETTE.concat(['chown root:beacon /etc/beacon/beacon.yaml', 'chmod 640 /etc/beacon/beacon.yaml']),
      assumptions: ['The hardening pass was legitimate; its intent (config not world-readable) must be preserved.', 'You are root.'],
      simplified: SIMPLIFIED_LINUX,
      unsafe: [
        { label: 'made the config world-readable or world-writable', why: 'chmod 777/666/644-with-secrets defeats the hardening the ticket asked you to preserve; the service user needed group access, nothing more.',
          test: function (c) { return worldWritable(c, '/etc/beacon/beacon.yaml') || worldReadable(c, '/etc/beacon/beacon.yaml') || worldWritable(c, '/etc/beacon'); },
          demo: 'chmod 644 /etc/beacon/beacon.yaml' },
        { label: 'ran the service as root', why: 'Changing User= to root makes the error disappear by giving the process every permission; the ticket requires the beacon user.',
          test: function (c) { return !unitRunsAs(c, 'beacon') && unitRunsAs(c, 'root'); },
          demo: "sed -i 's/^User=beacon$/User=root/' /etc/systemd/system/beacon.service && systemctl daemon-reload" }
      ],
      alt: function (v) { return ['systemctl status beacon', 'systemctl show beacon -p User', 'sudo -u beacon cat /etc/beacon/beacon.yaml',
        v === 'a' ? 'chgrp beacon /etc/beacon/beacon.yaml' : 'chmod 751 /etc/beacon', v === 'a' ? 'chmod g+r /etc/beacon/beacon.yaml' : 'ls -ld /etc/beacon',
        'systemctl restart beacon', 'systemctl status beacon', 'curl -s http://127.0.0.1:8080/healthz']; },
      mechanism: 'The unit runs Beacon as user `beacon`. To open `/etc/beacon/beacon.yaml` that user needs execute permission on every directory in the path and read permission on the file, evaluated against owner, group and other bits. The hardening left one component owned `root:root` with no group/other bits (file 600, or directory 700), so the open fails with EACCES, the application logs FATAL and exits 1, and `Restart=on-failure` loops until the start limit. The narrow fix uses the group: `root:beacon` with 640 on the file, or 755 on the directory — exactly the access needed and nothing for "other".',
      alternatives: [
        { h: 'The config content is wrong', out: 'Ruled out: the error is "permission denied", not a parse error, and `sudo -u beacon cat` reproduces it.' },
        { h: 'The unit path is wrong', out: 'Ruled out: `namei -l` resolves every component; the last one just is not readable by beacon.' },
        { h: 'Another process holds 8080', out: 'Ruled out: the process exits before binding; no "address in use" in the journal.' }
      ],
      clues: ['"Start request repeated too quickly" / start-limit-hit is a consequence (rate limiting), not the cause; `systemctl reset-failed` clears it after the real fix.'],
      passRubric: ['Names the exact blocking component (file or directory) and the user/mode mismatch', 'Explains why the group bits are the narrow fix', 'Rejects 777/644-with-secrets and User=root with reasons', 'Proves the running user and the user path after the fix'],
      prereqs: ['les-m02-02', 'les-m02-03'], refs: ['T15']
    }
  });

  /* ═══ S04 · Writes fail despite apparent capacity ═════════════════ */
  LX.missions.push({
    id: 'sre-s04', track: 'sre', cat: 'scenario', level: 'intermediate', mins: 25, kind: 'incident',
    title: 'Beacon rejects writes with "store unavailable" while the disk is only 14% used',
    brief: function () { return 'Since about 06:40, every POST to Beacon on beacon-vm returns 503 "store unavailable". The on-call restarted the service; it came back and failed again within minutes. `df -h` shows the data volume at 14%. Find the real bottleneck, restore writes without destroying live data or touching unrelated processes, and say what should change so it does not recur.'; },
    keys: ['df -h /var/lib/beacon', 'df -i /var/lib/beacon', 'journalctl -u beacon -n 20', 'find /var/lib/beacon -type f | wc -l', 'find /var/lib/beacon -maxdepth 2 -type d', 'ls /var/lib/beacon/queue/done | wc -l', 'find /var/lib/beacon/queue/done -type f -mtime +1 -delete', 'curl -s -X POST http://127.0.0.1:8080/status -H "Content-Type: application/json" -d \'{"sensor_id":"s-1","status":"ok"}\'', 'ps -ef | grep beacon'],
    world: function (seed) {
      var S = SIM(), v = S.variantOf(seed, ['a', 'b', 'c']);
      var bulkDir = v === 'a' ? '/var/lib/beacon/queue/done' : v === 'b' ? '/var/lib/beacon/sessions' : '/var/log/beacon';
      var files = [], dirs = [{ path: '/var/lib/beacon/queue', owner: 'beacon', group: 'beacon', mode: '750' }, { path: '/var/lib/beacon/queue/pending', owner: 'beacon', group: 'beacon', mode: '750' }, { path: '/var/lib/beacon/queue/done', owner: 'beacon', group: 'beacon', mode: '750' }, { path: '/var/lib/beacon/sessions', owner: 'beacon', group: 'beacon', mode: '750' }, { path: '/var/log/beacon', owner: 'beacon', group: 'beacon', mode: '750' }];
      var INODES = 8192, LIVE = 24;
      for (var i = 0; i < 3; i++) files.push({ path: '/var/lib/beacon/queue/pending/job-' + (900 + i) + '.json', content: '{"id":"job-' + (900 + i) + '","kind":"email"}\n', owner: 'beacon', group: 'beacon', mode: '640', ageDays: 0 });
      if (v === 'c') {
        files.push({ path: '/var/log/beacon/api.log', size: 870 * 1024 * 1024, fake: '{"ts":"2026-10-13T06:39:58Z","level":"info","msg":"request","path":"/status","status":201}', owner: 'beacon', group: 'beacon', mode: '640' });
        files.push({ path: '/var/log/beacon/api.log.1', size: 120 * 1024 * 1024, fake: '{"ts":"2026-10-12T23:59:58Z","level":"info","msg":"request"}', owner: 'beacon', group: 'beacon', mode: '640', ageDays: 1 });
      } else {
        var n = INODES - 40 - 9;   /* the other 9 inodes on the mount: the db, 3 pending jobs, 5 directories */
        for (var k = 0; k < n; k++) files.push({ path: bulkDir + '/' + (v === 'a' ? 'job-' + (100000 + k) + '.json' : 'sess-' + (200000 + k) + '.tmp'), content: 'x', owner: 'beacon', group: 'beacon', mode: '640', ageDays: k % 9 });
      }
      var state = null;
      var w = linuxBeaconWorld(seed, { variant: v, unitText: UNIT_OK, configText: CONFIG_OK, files: files, dirs: dirs, initialStart: false,
        disks: [{ fs: '/dev/vda1', size: 20 * 1024 * 1024 * 1024, base: 5 * 1024 * 1024 * 1024, mount: '/', inodes: 1310720, iused: 91003 },
                { fs: '/dev/vdb1', size: 1024 * 1024 * 1024, base: v === 'c' ? 30 * 1024 * 1024 : 140 * 1024 * 1024, mount: v === 'c' ? '/var/log/beacon' : '/var/lib/beacon', inodes: INODES, ibase: 40 }],
        extraStartCheck: function (w2, s) { return null; },
        verbs: {
          df: function (s) { return function (w2, a) {
            var f = S.flags(a), inode = !!(f.f.i || f.f.inodes), human = !!(f.f.h);
            var disks = w2.disks.slice();
            if (f.pos.length) { var picks = f.pos.map(function (p) { return LXShell.util.mountOf(w2, LXShell.resolve(w2, p)); }).filter(Boolean); if (picks.length) disks = picks; }
            var rows = disks.map(function (d) {
              var usedFiles = Object.keys(w2.fs).filter(function (p) { return LXShell.util.mountOf(w2, p) === d; });
              if (inode) { var iused = (d.ibase || d.iused || 0) + (d.ibase != null ? usedFiles.length : 0); return [d.fs, String(d.inodes), String(iused), String(Math.max(0, d.inodes - iused)), Math.min(100, Math.round(iused / d.inodes * 100)) + '%', d.mount]; }
              var used = LXShell.diskUsed(w2, d), avail = Math.max(0, d.size - used), hu = function (b) { return human ? LXShell.human(b) : String(Math.round(b / 1024)); };
              return [d.fs, hu(d.size), hu(used), hu(avail), Math.min(100, Math.round(used / d.size * 100)) + '%', d.mount];
            });
            return S.ok(S.table(inode ? ['Filesystem', 'Inodes', 'IUsed', 'IFree', 'IUse%', 'Mounted on'] : ['Filesystem', human ? 'Size' : '1K-blocks', 'Used', 'Avail', 'Use%', 'Mounted on'], rows));
          }; }
        } });
      state = w.sre;
      state.bulkDir = bulkDir; state.inodes = INODES;
      /* the store is "full" when the data mount has no inodes (a/b) or no blocks (c) */
      function full(w2) {
        var d = w2.disks[1];
        var files2 = Object.keys(w2.fs).filter(function (p) { return LXShell.util.mountOf(w2, p) === d; });
        if (v === 'c') return LXShell.diskUsed(w2, d) >= d.size * 0.99;
        return (d.ibase + files2.length) >= d.inodes;
      }
      state.hooks.push(function (s, w2) {
        s.storeFull = full(w2);
        if (s.storeFull && s.unit.active && !s.loggedFull) { s.loggedFull = true; w2.units.beacon.log.push('beacon-api[' + s.unit.pid + ']: ERROR store write failed: sqlite write: ' + (v === 'c' ? 'database or disk is full' : 'unable to open database file (No space left on device)')); }
        if (!s.storeFull) s.loggedFull = false;
      });
      state.net.apps.beacon.routes['/status'] = function (req, s) {
        if (req.method !== 'POST') return { code: 404, body: 'not found' };
        if (s.storeFull) return { code: 503, body: { error: 'store unavailable' } };
        s.writes = (s.writes || 0) + 1;
        return { code: 201, body: { id: 'rec-' + s.writes, sensor_id: 'sensor-1', status: 'ok', duplicate: false } };
      };
      /* the service is up at the start (restarted by on-call) */
      w.sre.hooks.unshift(function boot(s, w2) { if (s._booted2) return; s._booted2 = true; s.tryStart(w2); s.storeFull = full(w2); if (s.storeFull) w2.units.beacon.log.push('beacon-api[' + s.unit.pid + ']: ERROR store write failed: sqlite write: ' + (v === 'c' ? 'database or disk is full' : 'unable to open database file (No space left on device)')); });
      return w;
    },
    objectives: [
      { id: 'symptom', stage: 'evidence', text: 'Reproduce the write failure and read what the store reports',
        hint: 'Reproduce before you theorise: one POST, and the journal line it produces.', hint2: 'curl -X POST /status, then `journalctl -u beacon -n 20`.',
        reveal: 'curl -s -i -X POST http://127.0.0.1:8080/status -H "Content-Type: application/json" -d \'{"sensor_id":"s-1","status":"ok"}\' && journalctl -u beacon -n 5',
        done: function (c) { return saw(c, /curl\b.*-X\s*POST|journalctl\b.*-u\s*beacon/, /store unavailable|No space left on device|disk is full/); } },
      { id: 'capacity', stage: 'evidence', text: 'Compare block usage with inode usage on the volume the store lives on',
        hint: 'A filesystem has two budgets. df -h shows one of them.', hint2: '`df -h` and `df -i` for the same mount; read both percentages.',
        reveal: 'df -h /var/lib/beacon /var/log/beacon && df -i /var/lib/beacon /var/log/beacon',
        done: function (c) { return saw(c, /\bdf\b.*(-i|--inodes)/, /100%|9[0-9]%/) && ran(c, /\bdf\b(?!.*(-i|--inodes))/); } },
      { id: 'source', stage: 'evidence', text: 'Identify which directory is consuming the budget and what kind of files they are',
        hint: 'Count files per directory, or sizes per directory, depending on which budget is gone.', hint2: '`find DIR -type f | wc -l` per candidate directory, or `du -sh` / `ls -la` for sizes.',
        reveal: function (c) { return st(c).variant === 'c' ? 'du -h -d1 /var/log/beacon && ls -la /var/log/beacon' : 'find ' + st(c).bulkDir + ' -type f | wc -l && ls ' + st(c).bulkDir + ' | head -3'; },
        done: function (c) { var b = st(c).bulkDir; return saw(c, new RegExp('(find|ls|du|wc).*' + b.replace(/\//g, '\\/')), /\b\d{3,}\b|\d+(\.\d+)?[MG]\b/); } },
      { id: 'reclaim', stage: 'fix', text: 'Reclaim the budget safely: remove only the accumulated files, keep live data and pending work, do not kill unrelated processes',
        hint: 'Age and location are your selectors. Pending work and the database are not the problem.', hint2: '`find DIR -type f -mtime +1 -delete` on the accumulated directory (or truncate/rotate the oversized log); never rm -rf the data directory.',
        reveal: function (c) { return st(c).variant === 'c' ? 'truncate -s 0 /var/log/beacon/api.log && rm /var/log/beacon/api.log.1' : 'find ' + st(c).bulkDir + ' -type f -mtime +0 -delete'; },
        done: function (c) { var s = st(c); return !s.storeFull && !!node(c, '/var/lib/beacon/beacon.db') && [900, 901, 902].every(function (n) { return !!node(c, '/var/lib/beacon/queue/pending/job-' + n + '.json'); }) && c.w.procs.some(function (p) { return p.pid === 1; }); } },
      { id: 'verify', stage: 'verify', text: 'Prove writes succeed again on the user path',
        hint: 'Same POST as before; expect 201.', hint2: 'curl -i -X POST /status and read the status line.',
        reveal: 'curl -s -i -X POST http://127.0.0.1:8080/status -H "Content-Type: application/json" -d \'{"sensor_id":"s-1","status":"ok"}\'',
        done: function (c) { return !st(c).storeFull && lastIs(c, /curl\b.*-X\s*POST.*\/status/, /201 Created|"duplicate": ?false/); } }
    ],
    sre: {
      scenarioId: 'S04', moduleId: 'M02', lab: 'L04', variants: ['a', 'b', 'c'],
      symptom: 'POST /status returns 503 "store unavailable"; df -h shows 14% used; a restart helps for minutes.',
      neutralTitle: 'Beacon rejecting writes while the disk looks nearly empty',
      neutralBrief: 'Every POST to Beacon on beacon-vm returns 503 "store unavailable" since about 06:40. A restart helped for a few minutes. df -h shows the data volume at 14%. Restore writes without destroying live data or touching unrelated processes, and say what should change.',
      impact: 'All sensor status writes rejected; reads still work.', changes: 'None deployed; the worker has been running for nine days.',
      spoilers: ['inode', 'df -i', 'small files', 'done/', 'sessions', 'log rotation', 'rotate'],
      tools: ['df (-h, -i)', 'du', 'find (-type, -mtime, -delete)', 'ls', 'wc', 'rm', 'truncate', 'journalctl', 'systemctl', 'ps', 'curl'],
      grammar: ['`df -h|-i [PATH]`, `du -h -d1 DIR`, `find DIR -type f [-mtime +N] [-delete] | wc -l`', '`ls`, `rm FILE`, `truncate -s 0 FILE`', '`journalctl -u beacon -n N`, `systemctl status|restart beacon`, `ps -ef`', '`curl -s -i -X POST http://127.0.0.1:8080/status -H "Content-Type: application/json" -d \'{…}\'`'],
      palette: ['df -h', 'df -i', 'journalctl -u beacon -n 20', 'find /var/lib/beacon -type f | wc -l', 'du -h -d1 /var/lib/beacon', 'ls /var/lib/beacon/queue/pending', 'find  -type f -mtime +1 -delete', 'curl -s -i -X POST http://127.0.0.1:8080/status -H "Content-Type: application/json" -d \'{"sensor_id":"s-1","status":"ok"}\''],
      assumptions: ['Pending queue files and the SQLite database are live data.', 'Files older than a day in the accumulated directory are safe to remove per the (unwritten) retention policy you will now write.'],
      simplified: SIMPLIFIED_LINUX.concat(['The data volume is modelled with a small inode table so the symptom is reachable in a sandbox; the mechanism is the same at any size.']),
      unsafe: [
        { label: 'destroyed live data or pending work', why: 'Deleting the database or pending jobs restores writes by discarding what the service exists to keep; reclaim the accumulated files only.',
          test: function (c) { return !node(c, '/var/lib/beacon/beacon.db') || [900, 901, 902].some(function (n) { return !node(c, '/var/lib/beacon/queue/pending/job-' + n + '.json'); }); },
          demo: 'rm /var/lib/beacon/beacon.db' },
        { label: 'killed an unrelated process', why: 'kill -9 on PID 1 or on processes that are not Beacon\'s is collateral damage; the fault is a full budget, not a runaway process.',
          test: function (c) { return !c.w.procs.some(function (p) { return p.pid === 1; }) || ran(c, /kill\s+(-9\s+)?1\b|killall|pkill/); },
          demo: 'kill -9 1' }
      ],
      alt: function (v) { return v === 'c'
        ? ['journalctl -u beacon -n 20', 'df -h /var/log/beacon && df -i /var/log/beacon', 'du -h -d1 /var/log/beacon', 'truncate -s 0 /var/log/beacon/api.log', 'curl -i -X POST http://127.0.0.1:8080/status -H "Content-Type: application/json" -d \'{"sensor_id":"s-2","status":"ok"}\'']
        : ['journalctl -u beacon -n 20', 'df -i /var/lib/beacon', 'df -h /var/lib/beacon', 'ls ' + (v === 'a' ? '/var/lib/beacon/queue/done' : '/var/lib/beacon/sessions') + ' | wc -l', 'find ' + (v === 'a' ? '/var/lib/beacon/queue/done' : '/var/lib/beacon/sessions') + ' -type f -mtime +2 -delete', 'curl -i -X POST http://127.0.0.1:8080/status -H "Content-Type: application/json" -d \'{"sensor_id":"s-2","status":"ok"}\'']; },
      mechanism: 'A filesystem has two independent budgets: blocks (what `df -h` shows) and inodes (`df -i`), one per file. A worker that wrote thousands of tiny files per hour and never pruned them exhausted the inodes while using almost no blocks, so every new file — including SQLite\'s temporary journal — failed with ENOSPC and the store reported "unavailable". A restart cleared nothing. Deleting only the accumulated files by location and age frees inodes immediately; writes succeed; the fix that lasts is retention (prune on completion, or a timer) and an inode alert. In the oversized-log variant the exhausted budget is blocks: truncate or rotate the log, and add rotation.',
      alternatives: [
        { h: 'The service is broken', out: 'Ruled out: the journal names the store error, and reads work; the application is fine.' },
        { h: 'The disk is full', out: 'Partly right in one variant; in the others `df -h` says 14% and `df -i` says 100% — the budget that is gone is inodes.' },
        { h: 'Permissions', out: 'Ruled out: the file could be created before 06:40 with the same permissions; "No space left on device" is not EACCES.' }
      ],
      clues: ['A restart "helping for minutes" is the application retrying with its temporary files cleaned up, not a fix.'],
      passRubric: ['Names the exhausted budget and the evidence that discriminated it from the other', 'Names the source directory and why those files are safe to delete', 'States what was deliberately not deleted', 'Proposes retention or rotation and an alert'],
      prereqs: ['les-m02-04', 'les-m02-05'], refs: ['T15']
    }
  });

  /* ═══ S05 · New environment reports "no such host" ════════════════ */
  LX.missions.push({
    id: 'sre-s05', track: 'sre', cat: 'scenario', level: 'intermediate', mins: 25, kind: 'incident',
    title: 'New eu environment: "no such host" for api.eu.corp.lab from the app hosts',
    brief: function () { return 'The new `eu.corp.lab` environment was brought up this morning with its own authoritative DNS server. The DNS admin says the records are there. From the application host, every lookup of `api.eu.corp.lab` fails with "no such host" and the deploy is blocked. Find the mismatch, repair it where it belongs, and prove a fresh lookup succeeds from the application host.'; },
    keys: ['dig api.eu.corp.lab', 'dig @10.0.0.11 +norecurse api.eu.corp.lab', 'dig @10.0.0.10 +norecurse eu.corp.lab NS', 'dig +trace api.eu.corp.lab', 'cat /etc/resolv.conf', 'dnscache show 10.0.0.53', 'dnscache flush 10.0.0.53', 'zonectl show corp.lab', 'zonectl delegate corp.lab eu.corp.lab 10.0.0.11'],
    world: function (seed) {
      var S = SIM(), v = S.variantOf(seed, ['a', 'b', 'c']);
      var state = { clock: 0, risky: [], variant: v, hooks: [],
        dns: { root: '10.0.0.10', defaultServer: v === 'c' ? '10.0.0.5' : '10.0.0.53',
          zones: {
            'corp.lab': { ns: ['10.0.0.10'], negTtl: 300, records: { 'api.corp.lab': { A: ['10.0.5.10'] }, 'ns1.corp.lab': { A: ['10.0.0.10'] }, 'ns1.eu.corp.lab': { A: ['10.0.0.11'] } },
              delegations: v === 'a' ? {} : v === 'b' ? { 'eu.corp.lab': ['10.0.0.12'] } : { 'eu.corp.lab': ['10.0.0.11'] } },
            'eu.corp.lab': { ns: ['10.0.0.11'], negTtl: 60, records: { 'api.eu.corp.lab': { A: ['10.0.5.20'] }, 'db.eu.corp.lab': { A: ['10.0.5.30'] } } }
          },
          servers: { '10.0.0.10': { zones: ['corp.lab'] }, '10.0.0.11': { zones: ['eu.corp.lab'] }, '10.0.0.53': { recursive: true, cache: {} } } },
        net: { hosts: {}, listeners: [], apps: {}, certs: {}, cas: {}, from: '10.0.5.9' } };
      /* prime the negative cache: the deploy already tried (variants a, b) */
      if (v !== 'c') { S.dns.recurse(state, '10.0.0.53', 'api.eu.corp.lab', 'A'); }
      var resolv = v === 'c' ? 'nameserver 10.0.0.5\nsearch corp.lab\n' : 'nameserver 10.0.0.53\nsearch corp.lab\n';
      var verbs = { dig: S.verbs.dig(state), dnscache: S.verbs.dnscache(state), zonectl: S.verbs.zonectl(state), edit: S.verbs.edit(),
        resolvectl: function (w, a) { return S.ok('Global\n       Protocols: +DefaultRoute\nresolv.conf mode: static\n\nLink 2 (eth0)\n    Current Scopes: DNS\n         Protocols: +DefaultRoute\nCurrent DNS Server: ' + state.dns.defaultServer + '\n       DNS Servers: ' + state.dns.defaultServer); } };
      state.hooks.push(function (s, w) { var t = S.readFile(w, '/etc/resolv.conf') || ''; var m = /^nameserver\s+(\S+)/m.exec(t); if (m) s.dns.defaultServer = m[1]; });
      return { user: 'lab', host: 'app-eu-1', cwd: '/home/lab', ip: '10.0.5.9',
        files: [{ path: '/etc/resolv.conf', content: resolv, owner: 'root', group: 'root', mode: '644' }, { path: '/home/lab/README-dns.md', content: '# corp.lab DNS\nParent zone corp.lab: 10.0.0.10 (authoritative)\nChild zone eu.corp.lab: 10.0.0.11 (authoritative, new)\nRecursive resolver for application hosts: 10.0.0.53\n' }],
        sre: state, extra: S.bind(state, verbs) };
    },
    objectives: [
      { id: 'recursive', stage: 'evidence', text: 'Reproduce the failure through the resolver the application host uses, and note the status',
        hint: 'What does the host\'s own resolver say, and which resolver is that?', hint2: '`cat /etc/resolv.conf`, then `dig api.eu.corp.lab` (no @server) and read status: and SERVER:.',
        reveal: 'cat /etc/resolv.conf && dig api.eu.corp.lab',
        done: function (c) { return saw(c, /\bdig\b(?!.*@)/, /status: (NXDOMAIN|SERVFAIL)|communications error|no servers could be reached/); } },
      { id: 'authoritative', stage: 'evidence', text: 'Prove what the eu zone\'s own authoritative server says about the name',
        hint: 'Separate "what the data is" from "what the resolver finds".', hint2: 'Ask the authoritative server directly without recursion: `dig @10.0.0.11 +norecurse api.eu.corp.lab`.',
        reveal: 'dig @10.0.0.11 +norecurse api.eu.corp.lab',
        done: function (c) { return saw(c, /\bdig\b.*@10\.0\.0\.11/, /10\.0\.5\.20/); } },
      { id: 'parent', stage: 'evidence', text: 'Check how the parent zone delegates eu.corp.lab (or does not)',
        hint: 'A resolver walks down from the parent. What does the parent know about the child?', hint2: '`dig @10.0.0.10 +norecurse eu.corp.lab NS` or `dig +trace api.eu.corp.lab`.',
        reveal: 'dig @10.0.0.10 +norecurse eu.corp.lab NS',
        done: function (c) { return saw(c, /\bdig\b.*(@10\.0\.0\.10|\+trace)|zonectl\s+show\s+corp\.lab/, /NXDOMAIN|NS\s+10\.0\.0\.1[12]|referral|delegation|subzones delegated/); } },
      { id: 'repair', stage: 'fix', text: 'Repair the fault where it belongs so a resolver can reach the authoritative answer',
        hint: 'Fix the link in the chain that is broken, not the symptom at the end of it.', hint2: 'Missing/wrong delegation: `zonectl delegate corp.lab eu.corp.lab 10.0.0.11`. Wrong resolver on the host: fix /etc/resolv.conf.',
        reveal: function (c) { return st(c).variant === 'c' ? 'edit /etc/resolv.conf nameserver 10.0.0.53' : 'zonectl delegate corp.lab eu.corp.lab 10.0.0.11'; },
        done: function (c) { var s = st(c); var del = (s.dns.zones['corp.lab'].delegations || {})['eu.corp.lab'] || []; var shadow = !!((s.dns.zones['corp.lab'].records || {})['api.eu.corp.lab']); return !shadow && del.indexOf('10.0.0.11') !== -1 && s.dns.defaultServer === '10.0.0.53'; } },
      { id: 'fresh', stage: 'verify', text: 'Prove a fresh lookup from the application host returns the address — accounting for anything cached',
        hint: 'A resolver remembers "no" for a while. A repaired zone does not change what it remembers.', hint2: '`dnscache show 10.0.0.53`, flush if a negative answer is cached (or wait out the TTL), then `dig api.eu.corp.lab +short`.',
        reveal: 'dnscache flush 10.0.0.53 && dig api.eu.corp.lab +short',
        done: function (c) { return lastIs(c, /\bdig\b(?!.*@)(?!.*\+norecurse)/, /10\.0\.5\.20/); } }
    ],
    sre: {
      scenarioId: 'S05', moduleId: 'M03', lab: 'L05', variants: ['a', 'b', 'c'],
      symptom: '"no such host" for api.eu.corp.lab from the app hosts; the DNS admin sees the record.',
      neutralTitle: 'New environment: a name that resolves for the admin but not for the app host',
      neutralBrief: 'The new eu.corp.lab environment came up this morning with its own authoritative DNS. From the application host every lookup of api.eu.corp.lab fails, while the DNS admin sees the record. The deploy is blocked. Find the mismatch, repair it where it belongs, and prove a fresh lookup from the app host succeeds.',
      impact: 'Deploy to the eu environment blocked.', changes: 'New child zone and server this morning.',
      spoilers: ['delegation', 'NS record', 'negative cache', 'resolv.conf', 'parent zone'],
      tools: ['dig (@server, +short, +norecurse, +trace, record types)', 'cat /etc/resolv.conf', 'dnscache show|flush (lab stand-in for cache controls)', 'zonectl show|delegate|add (lab stand-in for zone edits)', 'edit'],
      grammar: ['`dig [@SERVER] NAME [A|NS|SOA] [+short] [+norecurse] [+trace]`', '`dnscache show|flush [RESOLVER]` — a simulation stand-in for rndc/resolvectl cache controls', '`zonectl show ZONE | zonectl delegate ZONE SUBZONE NS... | zonectl add ZONE NAME TYPE VALUE` — a stand-in for editing and reloading a zone', '`cat`, `edit /etc/resolv.conf nameserver IP`'],
      palette: ['dig api.eu.corp.lab', 'dig @10.0.0.11 +norecurse api.eu.corp.lab', 'dig @10.0.0.10 +norecurse eu.corp.lab NS', 'dig +trace api.eu.corp.lab', 'cat /etc/resolv.conf', 'dnscache show 10.0.0.53', 'dnscache flush 10.0.0.53', 'zonectl show corp.lab'],
      assumptions: ['You may edit the parent zone and the host resolver config; the DNS admin owns the child zone and it is correct.', 'Three servers: 10.0.0.10 (corp.lab), 10.0.0.11 (eu.corp.lab), 10.0.0.53 (recursive for app hosts).'],
      simplified: ['DNS is modelled as authoritative zones with delegations and one recursive resolver with a cache; TTLs count in logical seconds (10 per command).', 'No DNSSEC, no glue subtleties, no IPv6.', 'Only the documented verbs work.'],
      unsafe: [
        { label: 'added a shadow record in the parent zone instead of delegating', why: 'Putting api.eu.corp.lab directly into corp.lab makes the lookup succeed today and silently diverges from the child zone the admin maintains; the parent should delegate, not answer.',
          test: function (c) { return !!((st(c).dns.zones['corp.lab'].records || {})['api.eu.corp.lab']); },
          demo: 'zonectl add corp.lab api.eu.corp.lab A 10.0.5.20' }
      ],
      alt: function (v) { return v === 'c'
        ? ['dig api.eu.corp.lab', 'dig @10.0.0.11 api.eu.corp.lab', 'dig @10.0.0.10 eu.corp.lab NS', "sed -i 's/^nameserver 10.0.0.5$/nameserver 10.0.0.53/' /etc/resolv.conf", 'dig +short api.eu.corp.lab']
        : ['dig api.eu.corp.lab', 'dig @10.0.0.11 api.eu.corp.lab', 'zonectl show corp.lab', 'zonectl delegate corp.lab eu.corp.lab 10.0.0.11', 'dnscache show 10.0.0.53', 'dnscache flush 10.0.0.53', 'dig +short api.eu.corp.lab']; },
      mechanism: 'Resolution has two halves: authoritative data and the recursive path to it. The child server has the record, so "the records are there" is true. But a resolver walks from the parent: without an NS delegation (or with one that points at a server that does not answer) the parent returns NXDOMAIN or the walk fails. Worse, the resolver caches that negative answer for the zone\'s negative TTL, so even after the delegation is fixed it keeps saying "no" until the entry expires or is flushed — which is why "I fixed it but it still fails" happens. In the resolver-config variant the host simply asks a server that is not there. Fix the broken link (delegation, or the host\'s resolver), then flush or wait, then prove a fresh recursive answer.',
      alternatives: [
        { h: 'The record is missing', out: 'Ruled out by `dig @10.0.0.11 +norecurse`: the authoritative server answers.' },
        { h: 'The app host cannot reach the network', out: 'Ruled out: other names resolve and the resolver answers (with NXDOMAIN).' },
        { h: 'Just add the A record to the parent', out: 'Rejected: it masks the delegation fault and creates two sources of truth.' }
      ],
      clues: ['`search corp.lab` in resolv.conf is normal and not the cause.'],
      passRubric: ['Distinguishes authoritative from recursive answers with the two dig forms', 'Names the broken link (delegation / pointer / resolver) with evidence from the parent', 'Explains negative caching and why the fix is not immediately visible', 'Verifies with a fresh recursive lookup from the app host'],
      prereqs: ['les-m03-03'], refs: ['T23']
    }
  });

  /* ═══ S06 · HTTPS fails while backend health is good ══════════════ */
  LX.missions.push({
    id: 'sre-s06', track: 'sre', cat: 'scenario', level: 'intermediate', mins: 25, kind: 'incident',
    title: 'HTTPS to beacon.corp.lab fails since the certificate renewal; the backend is healthy',
    brief: function () { return 'The TLS reverse proxy in front of Beacon had its certificate renewed last night. Since then clients get TLS errors on https://beacon.corp.lab:8443 while `curl http://127.0.0.1:8080/healthz` on the host is fine. One engineer "got it working with -k". Make HTTPS work properly for clients that trust the lab CA, without weakening verification anywhere.'; },
    keys: ['curl -v --cacert /etc/ssl/lab/lab-ca.pem https://beacon.corp.lab:8443/healthz', 'curl -s http://127.0.0.1:8080/healthz', 'openssl s_client -connect beacon.corp.lab:8443 -servername beacon.corp.lab -CAfile /etc/ssl/lab/lab-ca.pem', 'openssl x509 -in /etc/ssl/lab/beacon.crt -noout -subject -issuer -ext subjectAltName', 'ls -l /etc/ssl/lab/ /etc/ssl/lab/issued/', 'cat /etc/nginx/conf.d/beacon.conf', 'nginx -t', 'systemctl reload nginx'],
    world: function (seed) {
      var S = SIM(), v = S.variantOf(seed, ['a', 'b', 'c']);
      var state = { clock: 0, risky: [], variant: v, hooks: [],
        net: { hosts: { 'beacon.corp.lab': '10.0.5.20' }, from: '10.0.5.9',
          listeners: [{ addr: '0.0.0.0', port: 8443, host: '10.0.5.20', app: 'proxy', tls: v === 'a' ? 'cert-internal' : v === 'b' ? 'cert-oldca' : 'cert-good' },
                      { addr: '127.0.0.1', port: 8080, host: '127.0.0.1', app: 'beacon' }],
          apps: { proxy: { upstream: { host: '127.0.0.1', port: v === 'c' ? 8081 : 8080 }, hostHeader: 'beacon.corp.lab' },
                  beacon: { version: '1.4.0', routes: { '/healthz': { code: 200, body: 'ok\n' }, '/version': { code: 200, body: { version: '1.4.0' } }, '/ready': { code: 200, body: { ready: true } } } } },
          certs: { 'cert-good': { cn: 'beacon.corp.lab', sans: ['beacon.corp.lab', 'beacon-vm.corp.lab'], issuer: 'Looped Lab CA', ca: 'lab-ca', notAfter: 'Oct 12 09:00:00 2027 GMT' },
                   'cert-internal': { cn: 'beacon.internal', sans: ['beacon.internal'], issuer: 'Looped Lab CA', ca: 'lab-ca', notAfter: 'Oct 12 09:00:00 2027 GMT' },
                   'cert-oldca': { cn: 'beacon.corp.lab', sans: ['beacon.corp.lab'], issuer: 'Looped Lab CA 2024 (retired)', ca: 'old-lab-ca', notAfter: 'Oct 12 09:00:00 2027 GMT' } },
          cas: { 'lab-ca': { trusted: true }, 'old-lab-ca': { trusted: false } }, cafiles: {} } };
      var certFile = v === 'a' ? 'cert-internal' : v === 'b' ? 'cert-oldca' : 'cert-good';
      var nginx = 'server {\n    listen 8443 ssl;\n    server_name beacon.corp.lab;\n    ssl_certificate     /etc/ssl/lab/beacon.crt;\n    ssl_certificate_key /etc/ssl/lab/beacon.key;\n    location / {\n        proxy_pass http://127.0.0.1:' + (v === 'c' ? '8081' : '8080') + ';\n        proxy_set_header Host $host;\n    }\n}\n';
      function certIdOf(w, path) { var t = S.readFile(w, path); var m = t && /# cert:\s*(\S+)/.exec(t); return m ? m[1] : null; }
      function reloadProxy(w, s) {
        var conf = S.readFile(w, '/etc/nginx/conf.d/beacon.conf') || '';
        var cm = /ssl_certificate\s+(\S+);/.exec(conf), pm = /proxy_pass\s+http:\/\/127\.0\.0\.1:(\d+)/.exec(conf);
        var l = s.net.listeners.filter(function (x) { return x.port === 8443; })[0];
        var id = cm ? certIdOf(w, cm[1]) : null;
        if (!l) return 'no listener';
        if (!id || !s.net.certs[id]) return 'nginx: [emerg] cannot load certificate "' + (cm ? cm[1] : '?') + '"';
        l.tls = id; s.net.apps.proxy.upstream.port = pm ? Number(pm[1]) : 8080;
        return null;
      }
      /* trust anchors are read from the files, so overwriting lab-ca.pem has consequences */
      state.hooks.push(function (s, w) { ['/etc/ssl/lab/lab-ca.pem', '/etc/ssl/lab/old-lab-ca.pem'].forEach(function (p) { var t = S.readFile(w, p) || ''; var m = /# ca:\s*(\S+)/.exec(t); if (m) s.net.cafiles[p] = m[1]; }); s.net.cafiles['lab-ca.pem'] = s.net.cafiles['/etc/ssl/lab/lab-ca.pem']; });
      var realCurl = S.verbs.curl(state);
      var verbs = { openssl: S.verbs.openssl(state), edit: S.verbs.edit(),
        /* curl reads ~/.curlrc like the real one, so a persisted "insecure" really does hide the fault */
        curl: function (w, a, stdin) { var rc = S.readFile(w, '/home/lab/.curlrc') || ''; return realCurl(w, /^\s*(-k|--insecure|insecure)\b/m.test(rc) && a.indexOf('-q') === -1 ? ['-k'].concat(a) : a, stdin); },
        nginx: function (w, a) {
          if (a[0] !== '-t' && a[0] !== '-T') return S.unsupported('nginx', a.join(' '), ['-t (test configuration)']);
          var conf = S.readFile(w, '/etc/nginx/conf.d/beacon.conf') || '';
          var cm = /ssl_certificate\s+(\S+);/.exec(conf);
          if (!cm || !S.fileOf(w, cm[1])) return S.err('nginx: [emerg] cannot load certificate "' + (cm ? cm[1] : '(none)') + '": BIO_new_file() failed (No such file or directory)\nnginx: configuration file /etc/nginx/nginx.conf test failed', 1);
          if (!certIdOf(w, cm[1])) return S.err('nginx: [emerg] cannot load certificate "' + cm[1] + '": PEM_read_bio_X509_AUX() failed (no start line)\nnginx: configuration file /etc/nginx/nginx.conf test failed', 1);
          return S.ok('nginx: the configuration file /etc/nginx/nginx.conf syntax is ok\nnginx: configuration file /etc/nginx/nginx.conf test is successful');
        },
        systemctl: function (w, a) {
          var unit = (a[1] || '').replace(/\.service$/, '');
          if (unit === 'beacon') { if (a[0] === 'status' || a[0] === 'is-active') return S.ok('● beacon.service - Beacon API\n     Active: active (running)\n   Main PID: 4201 (python3)\n        beacon-api[4201]: listening on 127.0.0.1:8080'); return S.ok(''); }
          if (unit !== 'nginx') return S.err('Unit ' + unit + '.service could not be found.', 4);
          if (a[0] === 'reload' || a[0] === 'restart') { var e = reloadProxy(w, state); if (e) return S.err('Job for nginx.service failed: ' + e, 1); return S.ok(''); }
          if (a[0] === 'status' || a[0] === 'is-active') { var l = state.net.listeners.filter(function (x) { return x.port === 8443; })[0]; return S.ok('● nginx.service - A high performance web server and a reverse proxy server\n     Active: active (running)\n   Main PID: 2210 (nginx)\n   serving beacon.corp.lab:8443 with ' + (l && l.tls) + ', upstream 127.0.0.1:' + state.net.apps.proxy.upstream.port); }
          return S.unsupported('systemctl', a[0] || '', ['status|reload|restart nginx', 'status beacon']);
        } };
      return { user: 'lab', host: 'beacon-vm', cwd: '/home/lab', ip: '10.0.5.20',
        dirs: [{ path: '/etc/ssl/lab' }, { path: '/etc/ssl/lab/issued' }, { path: '/etc/nginx/conf.d' }],
        files: [
          { path: '/etc/nginx/conf.d/beacon.conf', content: nginx, owner: 'root', group: 'root', mode: '644' },
          { path: '/etc/ssl/lab/beacon.crt', content: '-----BEGIN CERTIFICATE-----\n# cert: ' + certFile + '\n(simulated PEM)\n-----END CERTIFICATE-----\n', owner: 'root', group: 'root', mode: '644' },
          { path: '/etc/ssl/lab/beacon.key', content: '-----BEGIN PRIVATE KEY-----\n(simulated; never log this)\n-----END PRIVATE KEY-----\n', owner: 'root', group: 'root', mode: '600' },
          { path: '/etc/ssl/lab/issued/beacon.corp.lab.crt', content: '-----BEGIN CERTIFICATE-----\n# cert: cert-good\n(simulated PEM, issued yesterday by Looped Lab CA)\n-----END CERTIFICATE-----\n', owner: 'root', group: 'root', mode: '644' },
          { path: '/etc/ssl/lab/lab-ca.pem', content: '-----BEGIN CERTIFICATE-----\n# ca: lab-ca\n(Looped Lab CA — the trust anchor clients ship with)\n-----END CERTIFICATE-----\n', owner: 'root', group: 'root', mode: '644' },
          { path: '/etc/ssl/lab/old-lab-ca.pem', content: '-----BEGIN CERTIFICATE-----\n# ca: old-lab-ca\n(Looped Lab CA 2024, retired; clients do not trust it)\n-----END CERTIFICATE-----\n', owner: 'root', group: 'root', mode: '644' },
          { path: '/home/lab/RENEWAL-NOTES.md', content: '# Renewal 2026-10-12\nNew certificate requested from the lab CA for beacon.corp.lab; copied into /etc/ssl/lab and nginx reloaded.\n' }
        ],
        sre: state, extra: S.bind(state, verbs) };
    },
    objectives: [
      { id: 'tls', stage: 'evidence', text: 'Reproduce the client failure with verification on, and read the exact TLS error',
        hint: 'The error text names the layer: resolve, connect, handshake, or application.', hint2: '`curl -v --cacert /etc/ssl/lab/lab-ca.pem https://beacon.corp.lab:8443/healthz` and read the line after the certificate.',
        reveal: 'curl -v --cacert /etc/ssl/lab/lab-ca.pem https://beacon.corp.lab:8443/healthz',
        done: function (c) { return saw(c, /curl\b.*https:\/\/beacon\.corp\.lab:8443(?!.*\s-k\b)(?!.*--insecure)|openssl\s+s_client/, /no alternative certificate|unable to verify|verify error|certificate|502 Bad Gateway/); } },
      { id: 'backend', stage: 'evidence', text: 'Confirm the backend itself is healthy on its own port',
        hint: 'Split the path: proxy and backend are two hops.', hint2: '`curl -s http://127.0.0.1:8080/healthz` on the host.',
        reveal: 'curl -s http://127.0.0.1:8080/healthz',
        done: function (c) { return saw(c, /curl\b.*127\.0\.0\.1:8080/, /^ok\b/m); } },
      { id: 'identity', stage: 'evidence', text: 'Inspect the certificate the proxy serves (subject, SAN, issuer) and the proxy configuration',
        hint: 'What the proxy serves is a file and a config line.', hint2: '`openssl x509 -in /etc/ssl/lab/beacon.crt -noout -subject -issuer -ext subjectAltName` and `cat /etc/nginx/conf.d/beacon.conf`.',
        reveal: 'openssl x509 -in /etc/ssl/lab/beacon.crt -noout -subject -issuer -ext subjectAltName && cat /etc/nginx/conf.d/beacon.conf',
        done: function (c) { return saw(c, /openssl\s+x509|openssl\s+s_client|cat\s+.*beacon\.conf/, /subject=|issuer=|Subject Alternative Name|proxy_pass/); } },
      { id: 'fix', stage: 'fix', text: 'Make the proxy serve a certificate valid for beacon.corp.lab from the trusted CA, pointed at the right backend port — and reload',
        hint: 'Fix identity or trust at the proxy, never at the client.', hint2: 'The correctly issued certificate exists under /etc/ssl/lab/issued; or the proxy_pass port is wrong. Edit, `nginx -t`, `systemctl reload nginx`.',
        reveal: function (c) { return st(c).variant === 'c' ? "sed -i 's#127.0.0.1:8081#127.0.0.1:8080#' /etc/nginx/conf.d/beacon.conf && nginx -t && systemctl reload nginx" : "sed -i 's#/etc/ssl/lab/beacon.crt#/etc/ssl/lab/issued/beacon.corp.lab.crt#' /etc/nginx/conf.d/beacon.conf && nginx -t && systemctl reload nginx"; },
        done: function (c) { var s = st(c), l = s.net.listeners.filter(function (x) { return x.port === 8443; })[0]; var t = SIM().net.tlsCheck(s, l, 'beacon.corp.lab', { cacert: 'lab-ca' }); return t.ok && s.net.cafiles['/etc/ssl/lab/lab-ca.pem'] === 'lab-ca' && s.net.apps.proxy.upstream.port === 8080; } },
      { id: 'verify', stage: 'verify', text: 'Prove a client that trusts the lab CA gets 200 over HTTPS with full verification',
        hint: 'The proof is the same curl as the reproduction, now succeeding — without -k.', hint2: '`curl -s -i --cacert /etc/ssl/lab/lab-ca.pem https://beacon.corp.lab:8443/healthz`.',
        reveal: 'curl -s -i --cacert /etc/ssl/lab/lab-ca.pem https://beacon.corp.lab:8443/healthz',
        done: function (c) { return lastIs(c, /curl\b.*https:\/\/beacon\.corp\.lab:8443(?!.*\s-k\b)(?!.*--insecure)/, /200 OK|^ok\b/m) && lastCode(c) === 0; } }
    ],
    sre: {
      scenarioId: 'S06', moduleId: 'M03', lab: 'L06', variants: ['a', 'b', 'c'],
      symptom: 'TLS errors from clients on 8443; backend healthy on 8080; "-k makes it work".',
      neutralTitle: 'HTTPS failing at the proxy while the backend is healthy',
      neutralBrief: 'Since last night\'s maintenance, clients get errors on https://beacon.corp.lab:8443 while the backend answers on the host. One engineer says it works with -k. Make HTTPS work for clients that trust the lab CA without weakening verification anywhere, and explain the fault.',
      impact: 'All external clients fail; internal health checks pass.', changes: 'Certificate renewal and nginx reload last night.',
      spoilers: ['SAN', 'subject alternative', 'hostname mismatch', 'CA mismatch', 'issuer', 'upstream port', 'wrong port', 'old CA'],
      tools: ['curl (-v, -i, --cacert, --resolve, -k is a probe not a fix)', 'openssl s_client / x509 / verify', 'cat', 'ls', 'sed -i', 'edit', 'nginx -t', 'systemctl reload nginx'],
      grammar: ['`curl [-v|-i|-s] [--cacert FILE] [-k] https://beacon.corp.lab:8443/PATH`, `curl http://127.0.0.1:8080/PATH`', '`openssl s_client -connect HOST:PORT [-servername NAME] [-CAfile FILE]`, `openssl x509 -in FILE -noout -subject -issuer -dates -ext subjectAltName`, `openssl verify -CAfile CA CERT`', '`nginx -t`, `systemctl reload|status nginx`, `cat`, `ls -l`, `sed -i`, `edit`'],
      palette: ['curl -v --cacert /etc/ssl/lab/lab-ca.pem https://beacon.corp.lab:8443/healthz', 'curl -s http://127.0.0.1:8080/healthz', 'openssl s_client -connect beacon.corp.lab:8443 -servername beacon.corp.lab -CAfile /etc/ssl/lab/lab-ca.pem', 'openssl x509 -in /etc/ssl/lab/beacon.crt -noout -subject -issuer -ext subjectAltName', 'ls -l /etc/ssl/lab/ /etc/ssl/lab/issued/', 'cat /etc/nginx/conf.d/beacon.conf', 'nginx -t', 'systemctl reload nginx'],
      assumptions: ['Clients trust the lab CA (/etc/ssl/lab/lab-ca.pem) and nothing else.', 'The correctly issued certificate for beacon.corp.lab is on the host under /etc/ssl/lab/issued.'],
      simplified: ['TLS is modelled as subject/SAN matching, issuer-to-trust-anchor matching and expiry; no cipher negotiation, no OCSP, no intermediates.', 'Certificates are placeholder PEM files whose identity the simulator reads from a marker line.', 'nginx is modelled as one server block: certificate path and proxy_pass port.'],
      unsafe: [
        { label: 'replaced the trust anchor to make the bad certificate pass', why: 'Overwriting lab-ca.pem with the retired CA (or adding it as trusted) moves the fault to every client instead of fixing the proxy.',
          test: function (c) { return st(c).net.cafiles['/etc/ssl/lab/lab-ca.pem'] === 'old-lab-ca'; },
          demo: 'cp /etc/ssl/lab/old-lab-ca.pem /etc/ssl/lab/lab-ca.pem' },
        { label: 'turned verification off for clients', why: 'Persisting -k (insecure in ~/.curlrc, verify=False in a client) makes every request "work" by accepting any certificate, including an attacker\'s. -k is a probe to see past the handshake, never a resolution.',
          test: function (c) { return /^\s*(-k|--insecure|insecure)\b/m.test(fileText(c, '/home/lab/.curlrc') || ''); },
          demo: "echo insecure >> /home/lab/.curlrc" }
      ],
      alt: function (v) { return ['openssl s_client -connect beacon.corp.lab:8443 -servername beacon.corp.lab -CAfile /etc/ssl/lab/lab-ca.pem', 'curl -i http://127.0.0.1:8080/healthz', 'cat /etc/nginx/conf.d/beacon.conf',
        v === 'c' ? 'edit /etc/nginx/conf.d/beacon.conf proxy_pass http://127.0.0.1:8080' : 'cp /etc/ssl/lab/issued/beacon.corp.lab.crt /etc/ssl/lab/beacon.crt',
        'nginx -t', 'systemctl reload nginx', 'curl --cacert /etc/ssl/lab/lab-ca.pem https://beacon.corp.lab:8443/healthz']; },
      mechanism: 'A TLS client verifies two things before it trusts a server: the certificate chains to a CA the client trusts, and the certificate\'s SAN contains the name the client asked for (SNI/servername). The renewal installed a certificate that fails one of them — issued for the wrong name, or by a retired CA — so clients abort the handshake while the backend, reached over plain HTTP on the host, is fine. (In the third variant the handshake succeeds and the proxy cannot reach its upstream: a 502, a different layer.) `-k` tells curl to skip verification, which proves the proxy and backend work and proves nothing about the fault. The fix is at the proxy: serve the correctly issued certificate (or point at the right upstream), test the config, reload, and prove a fully verified request.',
      alternatives: [
        { h: 'The backend is down', out: 'Ruled out: 200 on 127.0.0.1:8080.' },
        { h: 'The client is misconfigured', out: 'Ruled out: the same client with --cacert fails on the identity/trust line that names the server certificate.' },
        { h: 'Trust the old CA', out: 'Rejected: it is retired for a reason and the fault is on the server side.' }
      ],
      clues: ['The renewal notes say the certificate was "copied into /etc/ssl/lab" — which file was copied is the question, not the notes.'],
      passRubric: ['Names the failing layer from the error text (handshake vs application)', 'States which of trust / identity / upstream was wrong with evidence from openssl', 'Explains why -k is a probe and not a fix', 'Verifies with full verification against the lab CA'],
      prereqs: ['les-m03-05'], refs: ['T23']
    }
  });

  /* ═══ S07 · Automation says success but output is incomplete ══════ */
  var REPORT_PY = [
    '#!/usr/bin/env python3',
    '"""report.py — summarise Beacon JSON logs by service and status.',
    'Usage: python3 report.py LOGFILE [--strict]',
    '# sim: silent-skip = /except Exception:\\s*\\n\\s*(pass|continue)/',
    '# sim: reports-errors = /errors\\.append\\(|sys\\.stderr\\.write\\(.*(skipped|malformed|error)/i',
    '# sim: exit-code = /sys\\.exit\\(\\s*(1 if errors else 0|2 if errors else 0|int\\(bool\\(errors\\)\\)|min\\(1, len\\(errors\\)\\))\\s*\\)/',
    '"""',
    'import json, sys',
    'from datetime import datetime',
    '',
    'def parse_ts(s):',
    '    # the log contract says UTC with a trailing Z',
    '    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ")',
    '',
    'def summarise(path):',
    '    counts = {}',
    '    errors = []',
    '    with open(path) as fh:',
    '        for n, line in enumerate(fh, 1):',
    '            try:',
    '                row = json.loads(line)',
    '                key = (row["service"], row["status"])',
    '                parse_ts(row["ts"])',
    '                counts[key] = counts.get(key, 0) + 1',
    '            except Exception:',
    '                pass',
    '    return counts, errors',
    '',
    'def main(argv):',
    '    counts, errors = summarise(argv[1])',
    '    total = sum(counts.values())',
    '    for (svc, status), n in sorted(counts.items()):',
    '        print(f"{svc:10} {status:6} {n}")',
    '    print(f"processed {total} rows OK")',
    '    sys.exit(0)',
    '',
    'if __name__ == "__main__":',
    '    main(sys.argv)',
    ''
  ].join('\n');
  /* report.py's behaviour, derived from the log file as it is NOW and from
     which documented edits the script carries (# sim: probes) */
  function reportBehaviour() {
    return function (w, run) {
      var p = run.probes, S = SIM();
      var file = run.args.filter(function (x) { return x.charAt(0) !== '-'; })[0];
      if (!file) return { out: '', err: 'usage: report.py LOGFILE [--strict]\n', code: 2 };
      var text = S.readFile(w, file);
      if (text == null) return { out: '', err: 'Traceback (most recent call last):\n  File "report.py", line 34, in <module>\nFileNotFoundError: [Errno 2] No such file or directory: \'' + file + '\'\n', code: 1 };
      var counts = {}, bad = [], rows = text.replace(/\n$/, '').split('\n');
      rows.forEach(function (ln, i) {
        var row = null, why = null;
        try { row = JSON.parse(ln); } catch (e) { why = 'invalid JSON'; }
        if (row && (row.service == null || row.status == null)) why = 'missing key \'' + (row.service == null ? 'service' : 'status') + '\'';
        else if (row && !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(row.ts || '')) why = 'time data ' + JSON.stringify(row.ts) + ' does not match format';
        if (why) { bad.push({ n: i + 1, why: why }); return; }
        var k = row.service + '|' + row.status; counts[k] = (counts[k] || 0) + 1;
      });
      var good = rows.length - bad.length;
      var table = Object.keys(counts).sort().map(function (k) { var x = k.split('|'); return S.pad(x[0], 10) + ' ' + S.pad(x[1], 6) + ' ' + counts[k]; }).join('\n') + '\n';
      if (p['silent-skip'] || !p['reports-errors']) return { out: table + 'processed ' + good + ' rows OK\n', code: 0 };
      var err = bad.length ? 'skipped ' + bad.length + ' malformed row' + (bad.length > 1 ? 's' : '') + ': ' + bad.slice(0, 8).map(function (b) { return 'line ' + b.n + ' (' + b.why + ')'; }).join(', ') + '\n' : '';
      return { out: table + 'processed ' + good + ' of ' + rows.length + ' rows' + (bad.length ? ' (' + bad.length + ' skipped, see stderr)' : ' OK') + '\n', err: err, code: bad.length && p['exit-code'] ? 1 : 0 };
    };
  }
  LX.missions.push({
    id: 'sre-s07', track: 'sre', cat: 'scenario', level: 'intermediate', mins: 25, kind: 'incident',
    title: 'The nightly log report says "OK" but the numbers do not add up',
    brief: function () { return 'The nightly `report.py` run on the Beacon logs prints "processed … rows OK" and exits 0 every night, so nobody looked. Finance noticed the API error count is lower than the dashboard. The log file has 200 rows. Make the report honest: account for every row, surface bad input where an operator sees it, exit non-zero when something was skipped, and add a test that proves it.'; },
    keys: ['python3 report.py logs/app.json', 'wc -l logs/app.json', 'cat report.py', 'grep -n "except" report.py', 'sed -n 17p logs/app.json', 'edit report.py ', 'python3 -m unittest tests/test_report.py', 'cat tests/test_report.py'],
    world: function (seed) {
      var S = SIM(), v = S.variantOf(seed, ['a', 'b']);
      var rows = [];
      for (var i = 1; i <= 200; i++) {
        var bad = v === 'a' ? [17, 58, 121, 190] : [9, 17, 58, 77, 121, 150, 190];
        if (bad.indexOf(i) !== -1) {
          if (v === 'b' && [9, 77, 150].indexOf(i) !== -1) rows.push('{"ts":"2026-10-12T0' + (i % 9) + ':12:00+02:00","service":"api","status":"error","msg":"upstream timeout"}');
          else if (i === 121) rows.push('{"ts":"2026-10-12T04:12:00Z","service":"api","msg":"no status key"}');
          else rows.push('{"ts":"2026-10-12T03:1' + (i % 10) + ':00Z","service":"api","status":"error","msg":"truncated');
        } else rows.push('{"ts":"2026-10-12T0' + (i % 9) + ':' + (10 + i % 50) + ':00Z","service":"' + (i % 5 === 0 ? 'worker' : 'api') + '","status":"' + (i % 16 === 0 ? 'error' : 'ok') + '","msg":"request"}');
      }
      var tests = [
        'import subprocess, sys, unittest',
        '# sim: has-malformed-test = /def test_.*(malformed|skipped|bad)/i',
        'class ReportTests(unittest.TestCase):',
        '    def test_counts_known_fixture(self):',
        '        out = subprocess.run([sys.executable, "report.py", "logs/app.json"], capture_output=True, text=True)',
        '        self.assertIn("api", out.stdout)',
        '',
        'if __name__ == "__main__":',
        '    unittest.main()', ''
      ].join('\n');
      var state = { clock: 0, risky: [], variant: v, hooks: [], py: { scripts: { 'report.py': reportBehaviour() }, modules: {} } };
      state.py.modules.unittest = function (w, f) {
        var tsrc = S.readFile(w, 'tests/test_report.py') || '', rsrc = S.readFile(w, 'report.py') || '';
        var tp = S.probes(tsrc), rq = S.probeState(rsrc);
        var fixed = rq['silent-skip'] === false && rq['reports-errors'] && rq['exit-code'];
        /* a test method only counts inside the class, i.e. before the __main__ guard */
        var tbody = S.stripSim(tsrc), mi = tp['has-malformed-test'] ? tbody.search(tp['has-malformed-test']) : -1, gi = tbody.indexOf('if __name__');
        var hasMal = mi !== -1 && (gi === -1 || mi < gi);
        var n = 1 + (hasMal ? 1 : 0), fails = hasMal && !fixed ? 1 : 0;
        var out = (fails ? 'F' : '.') + '.' + '\n' + (fails ? '======================================================================\nFAIL: test_malformed_rows_are_reported (tests.test_report.ReportTests)\nAssertionError: expected non-zero exit and "skipped" on stderr for a fixture with malformed rows; got exit 0 and empty stderr\n\n' : '') + '----------------------------------------------------------------------\nRan ' + n + ' tests in 0.41s\n\n' + (fails ? 'FAILED (failures=1)' : 'OK');
        return { out: '', err: out + '\n', code: fails ? 1 : 0 };
      };
      var verbs = { python3: S.verbs.python3(state), edit: S.verbs.edit() };
      return { user: 'lab', host: 'ops-tools', cwd: '/home/lab/tools',
        dirs: [{ path: '/home/lab/tools/tests' }, { path: '/home/lab/tools/logs' }],
        files: [{ path: '/home/lab/tools/report.py', content: REPORT_PY, mode: '755' }, { path: '/home/lab/tools/logs/app.json', content: rows.join('\n') + '\n' }, { path: '/home/lab/tools/tests/test_report.py', content: tests }, { path: '/home/lab/tools/tests/__init__.py', content: '' },
                { path: '/home/lab/tools/README.md', content: '# report.py\nNightly summary of Beacon logs. Cron: 02:00, exit code checked by the scheduler.\n' }],
        sre: state, extra: S.bind(state, verbs) };
    },
    objectives: [
      { id: 'mismatch', stage: 'evidence', text: 'Show that the report accounts for fewer rows than the file contains',
        hint: '"Processed N rows OK" is a claim. Count the input yourself.', hint2: '`python3 report.py logs/app.json` then `wc -l logs/app.json`; compare the numbers.',
        reveal: 'python3 report.py logs/app.json && wc -l logs/app.json',
        done: function (c) { return saw(c, /python3\s+(\.\/)?report\.py/, /processed 1[89]\d/) && saw(c, /wc\s+-l\b.*app\.json|grep\s+-c\b.*app\.json/, /\b200\b/); } },
      { id: 'swallow', stage: 'evidence', text: 'Find where bad rows disappear in the code, and what kind of rows they are',
        hint: 'A tool that never fails is a tool that hides its failures.', hint2: '`grep -n except report.py`; then look at one of the skipped lines in the log.',
        reveal: 'grep -n -A1 except report.py && sed -n 17p logs/app.json',
        done: function (c) { return saw(c, /grep\b.*except.*report\.py|cat\s+(\.\/)?report\.py|sed\s+-n\b.*report\.py/, /except Exception/); } },
      { id: 'fix', stage: 'fix', text: 'Make the report record skipped rows, report them on stderr, and exit non-zero when any were skipped',
        hint: 'Three changes: catch the specific errors and record them, print them to stderr, let the exit code reflect them.', hint2: 'Replace `except Exception: pass` with `except (KeyError, ValueError) as e: errors.append((n, str(e)))`; write a summary to sys.stderr; `sys.exit(1 if errors else 0)`.',
        reveal: "sed -i 's/            except Exception:/            except (KeyError, ValueError) as e:/; s/                pass/                errors.append((n, str(e)))/; s/    sys.exit(0)/    if errors:\\n        sys.stderr.write(f\"skipped {len(errors)} malformed rows\\\\n\")\\n    sys.exit(1 if errors else 0)/' report.py",
        done: function (c) { var q = SIM().probeState(fileText(c, '/home/lab/tools/report.py') || ''); return q['silent-skip'] === false && q['reports-errors'] && q['exit-code']; } },
      { id: 'test', stage: 'fix', text: 'Add a test that fails when malformed rows are silently skipped, and make the suite pass',
        hint: 'A test that only checks the happy path cannot catch this bug.', hint2: 'Add `def test_malformed_rows_are_reported` to tests/test_report.py asserting non-zero exit and "skipped" on stderr; run `python3 -m unittest tests/test_report.py`.',
        reveal: "sed -i 's/^if __name__ == \"__main__\":/    def test_malformed_rows_are_reported(self):\\n        out = subprocess.run([sys.executable, \"report.py\", \"logs\\/app.json\"], capture_output=True, text=True)\\n        self.assertNotEqual(out.returncode, 0)\\n        self.assertIn(\"skipped\", out.stderr)\\n\\n\&/' tests/test_report.py && python3 -m unittest tests/test_report.py",
        done: function (c) { var t = fileText(c, '/home/lab/tools/tests/test_report.py') || ''; return /def test_.*(malformed|skipped|bad)/i.test(t) && saw(c, /python3\s+-m\s+unittest/, /Ran 2 tests[\s\S]*\bOK\b/); } },
      { id: 'verify', stage: 'verify', text: 'Run the report and show every row accounted for: processed plus skipped equals the file, with a non-zero exit',
        hint: 'Honest output: the total adds up and the scheduler would notice.', hint2: '`python3 report.py logs/app.json`; check "processed X of 200 (N skipped)".',
        reveal: 'python3 report.py logs/app.json',
        done: function (c) { return lastIs(c, /python3\s+(\.\/)?report\.py/, /processed \d+ of 200 rows \(\d+ skipped/) && lastCode(c) !== 0; } }
    ],
    sre: {
      scenarioId: 'S07', moduleId: 'M04', lab: 'L07', variants: ['a', 'b'],
      symptom: 'A nightly report exits 0 and prints OK while under-counting rows.',
      neutralTitle: 'A nightly report that always says OK',
      neutralBrief: 'The nightly report over the Beacon logs prints OK and exits 0, but its totals are lower than another source. The log file has 200 rows. Make the tool honest about its input, make the scheduler able to notice, and prove it with a test.',
      impact: 'Error counts under-reported to finance for weeks.', changes: 'None; the script has run unchanged for months.',
      spoilers: ['except Exception', 'swallow', 'pass', 'malformed', 'exit code', 'exit 0'],
      tools: ['python3 report.py (fixture script; behaviour follows the documented # sim: probes)', 'python3 -m unittest', 'cat, grep, sed -n, sed -i, wc, edit'],
      grammar: ['`python3 report.py logs/app.json [--strict]` — the simulator renders output from the script\'s recognisable structure (see the "# sim:" lines in the file); it does not execute Python', '`python3 -m unittest tests/test_report.py`', '`cat`, `grep -n`, `sed -n Np FILE`, `sed -i`, `edit`, `wc -l`'],
      palette: ['python3 report.py logs/app.json', 'wc -l logs/app.json', 'grep -n -A1 except report.py', 'sed -n 17p logs/app.json', 'cat tests/test_report.py', 'python3 -m unittest tests/test_report.py'],
      assumptions: ['The scheduler treats a non-zero exit as a failed job and pages.', 'Malformed rows must be reported, not repaired by hand.'],
      simplified: ['No Python interpreter runs here: the simulator recognises the specific edits the lesson teaches (the "# sim:" probes at the top of each fixture script) and renders the corresponding behaviour. The local lab L07 runs real Python.', 'Each command advances the clock 10 seconds.'],
      unsafe: [
        { label: 'edited the input data to make the report clean', why: 'Deleting malformed rows from the log hides the problem the report exists to surface; the fix belongs in the tool and its exit code.',
          test: function (c) { return (fileText(c, '/home/lab/tools/logs/app.json') || '').split('\n').filter(Boolean).length < 200; },
          demo: "sed -i '/truncated/d' logs/app.json" }
      ],
      alt: function () { return ['python3 report.py logs/app.json', 'grep -c . logs/app.json', 'cat report.py',
        "sed -i 's/except Exception:/except (json.JSONDecodeError, KeyError, ValueError):/; s/^                pass$/                errors.append(n)/; s/^    sys.exit(0)$/    print(f\"skipped {len(errors)} rows\", file=sys.stderr)\\n    sys.exit(min(1, len(errors)))/' report.py",
        "sed -i 's/^if __name__/    def test_bad_rows_fail_the_run(self):\\n        out = subprocess.run([sys.executable, \"report.py\", \"logs\\/app.json\"], capture_output=True, text=True)\\n        self.assertEqual(out.returncode, 1)\\n\\n&/' tests/test_report.py",
        'python3 -m unittest discover -s tests', 'python3 report.py logs/app.json']; },
      mechanism: 'The script wrapped the whole row-processing block in `except Exception: pass`, so a truncated JSON line, a missing key or an unparsed timestamp vanished without a trace, and `sys.exit(0)` told the scheduler the job succeeded. The honest version catches the specific errors it expects, records them with the line number, writes a summary to stderr where operators and the scheduler see it, and exits non-zero when anything was skipped — and a test asserts exactly that, so the bug cannot return quietly.',
      alternatives: [
        { h: 'The dashboard is wrong', out: 'Ruled out: counting the file shows rows the report never mentions.' },
        { h: 'The log is corrupt and should be cleaned', out: 'Rejected: cleaning hides the signal; the report must say how many rows it could not read.' }
      ],
      clues: ['The README mentions that the scheduler checks the exit code — which is why exit 0 mattered.'],
      passRubric: ['Shows the under-count with the input count', 'Names the swallowed exception and the kind of rows it hid', 'Explains the error policy chosen (record, report, non-zero exit) and why a bare except is wrong', 'Has a test that would fail on the old code'],
      prereqs: ['les-m04-03', 'les-m04-04'], refs: ['T11']
    }
  });

  /* ═══ S08 · Inventory stops early or never finishes ═══════════════ */
  var INVENTORY_PY = [
    '#!/usr/bin/env python3',
    '"""inventory.py — list every sensor from the fleet API (paginated)."""',
    '# sim: timeout-set = /urlopen\\([^)]*timeout=\\d/',
    '# sim: repeated-token-guard = /if\\s+token\\s+in\\s+seen|seen\\.add\\(token\\)/',
    '# sim: honours-retry-after = /Retry-After/i',
    '# sim: bounded-retries = /for\\s+attempt\\s+in\\s+range\\(\\s*[1-9]|attempts?\\s*<\\s*[1-9]|max_retries\\s*=\\s*[1-9]/',
    '# sim: logs-token = /(print|log\\w*\\.\\w+|logging\\.\\w+)\\(.*(\\bTOKEN\\b|Authorization)/',
    'import json, os, sys, time, urllib.request',
    '',
    'BASE = os.environ.get("FLEET_API", "http://127.0.0.1:9000")',
    'TOKEN = os.environ["FLEET_TOKEN"]',
    '',
    'def get(path):',
    '    req = urllib.request.Request(BASE + path, headers={"Authorization": "Bearer " + TOKEN})',
    '    while True:',
    '        try:',
    '            with urllib.request.urlopen(req) as r:',
    '                return json.load(r)',
    '        except Exception as e:',
    '            print("retrying after", e, "with token", TOKEN)',
    '            continue',
    '',
    'def main():',
    '    items, token = [], None',
    '    while True:',
    '        page = get("/sensors" + (f"?page_token={token}" if token else ""))',
    '        items.extend(page["items"])',
    '        token = page.get("next_token")',
    '        if not token:',
    '            break',
    '    print(f"{len(items)} items")',
    '',
    'if __name__ == "__main__":',
    '    main()',
    ''
  ].join('\n');
  var FAKE_TOKEN = 'lab-fleet-7f3a9c2e-not-a-real-secret';
  /* The fleet API (pages of 15, 47 sensors). Both variants: the first request
     of a run is reset once by the load balancer, so the retry path always
     runs. a: the last page echoes its own token as next_token (a documented
     API quirk). b: the second page answers 429 Retry-After: 2 once. */
  function inventoryBehaviour(variant) {
    return function (w, run) {
      var p = run.probes, S = SIM(), s = w.sre, log = [], err = [];
      var leaks = p['logs-token'];
      function retryNote(why) { if (leaks) err.push('retrying after ' + why + ' with token ' + FAKE_TOKEN); }
      log.push('GET /sensors -- connection reset by load balancer');
      retryNote('[Errno 104] Connection reset by peer');
      var items = 0, code = 0, out = '', pages = [['', 15, 'p1'], ['p1', 15, 'p2'], ['p2', 15, 'p3'], ['p3', 2, variant === 'a' ? 'p3' : '']];
      for (var i = 0; i < pages.length; i++) {
        var pg = pages[i], path = 'GET /sensors' + (pg[0] ? '?page_token=' + pg[0] : '');
        if (variant === 'b' && i === 1) {
          log.push(path + ' 429 Retry-After: 2');
          retryNote('HTTP Error 429: Too Many Requests');
          if (!p['honours-retry-after'] && !p['bounded-retries']) { for (var r = 0; r < 60; r++) log.push(path + ' 429 Retry-After: 2'); log.push(path + ' 403 banned: too many requests'); err.push('urllib.error.HTTPError: HTTP Error 403: Forbidden'); code = 1; break; }
          if (!p['honours-retry-after']) { log.push(path + ' 429 Retry-After: 2'); log.push(path + ' 429 Retry-After: 2'); log.push(path + ' 403 banned: retried before Retry-After'); err.push('RuntimeError: fleet API: gave up (last status 403)'); code = 1; break; }
          log.push('-- client waited 2s (Retry-After)');
        }
        log.push(path + ' 200 items=' + pg[1] + ' next_token=' + pg[2]);
        items += pg[1];
        if (variant === 'a' && i === 3) {
          if (p['repeated-token-guard']) break;
          for (var k = 0; k < 5; k++) { log.push(path + ' 200 items=2 next_token=p3'); items += 2; }
          log.push('(… the same request repeats until the job is killed …)');
          err.push('Killed (job exceeded its 3600 s limit; ' + items + '+ items collected, never printed)'); code = 137; break;
        }
      }
      if (!p['timeout-set']) log.push('-- note: connections opened with no timeout');
      if (code === 0) out = items + ' items\n';
      s.lastInventory = { items: items, code: code, leaked: !!(leaks && err.length) };
      if (leaks && run.text !== INVENTORY_PY) s.leakAfterEdit = true;
      S.writeFile(w, '/var/log/mockapi/requests.log', (S.readFile(w, '/var/log/mockapi/requests.log') || '') + log.map(function (l) { return S.stamp(s) + ' ' + l; }).join('\n') + '\n');
      return { out: out, err: err.length ? err.join('\n') + '\n' : '', code: code };
    };
  }
  LX.missions.push({
    id: 'sre-s08', track: 'sre', cat: 'scenario', level: 'intermediate', mins: 25, kind: 'incident',
    title: 'The fleet inventory script either never finishes or stops at 15 sensors',
    brief: function () { return 'inventory.py lists sensors from the fleet API, which pages 15 at a time; the fleet has 47. Some nights the job is killed after an hour, other nights it reports 15. The API team says their service is healthy and shows a request log at /var/log/mockapi/requests.log. Make the client finish with every sensor exactly once, bounded in time and retries, and without leaking the API token into logs.'; },
    keys: ['python3 inventory.py', 'tail -n 20 /var/log/mockapi/requests.log', 'cat inventory.py', 'grep -n "token\\|retry\\|timeout" inventory.py', 'edit inventory.py ', 'python3 -m unittest tests/test_inventory.py'],
    world: function (seed) {
      var S = SIM(), v = S.variantOf(seed, ['a', 'b']);
      var state = { clock: 0, risky: [], variant: v, hooks: [], py: { scripts: { 'inventory.py': inventoryBehaviour(v) }, modules: {} } };
      state.py.modules.unittest = function (w, f) {
        var q = S.probeState(S.readFile(w, 'inventory.py') || '');
        var checks = [['test_timeout_is_bounded', q['timeout-set']], ['test_repeated_page_token_stops', q['repeated-token-guard']], ['test_retries_are_bounded_and_honour_retry_after', q['bounded-retries'] && q['honours-retry-after']], ['test_token_never_logged', q['logs-token'] === false]];
        var fails = checks.filter(function (c) { return !c[1]; });
        var out = checks.map(function (c) { return c[1] ? '.' : 'F'; }).join('') + '\n' + fails.map(function (c) { return '======================================================================\nFAIL: ' + c[0] + ' (tests.test_inventory.InventoryTests)\n'; }).join('') + '----------------------------------------------------------------------\nRan 4 tests in 0.62s\n\n' + (fails.length ? 'FAILED (failures=' + fails.length + ')' : 'OK');
        return { out: '', err: out + '\n', code: fails.length ? 1 : 0 };
      };
      var verbs = { python3: S.verbs.python3(state), edit: S.verbs.edit() };
      var tests = 'import unittest\n# the real tests live in labs/sre-cloud-foundations/L08 and run against a real mock server;\n# this fixture mirrors their names: test_timeout_is_bounded, test_repeated_page_token_stops,\n# test_retries_are_bounded_and_honour_retry_after, test_token_never_logged\nclass InventoryTests(unittest.TestCase):\n    pass\n';
      var initialLog = v === 'a'
        ? '2026-10-12T02:00:01Z GET /sensors -- connection reset by load balancer\n2026-10-12T02:00:01Z GET /sensors 200 items=15 next_token=p1\n2026-10-12T02:00:01Z GET /sensors?page_token=p1 200 items=15 next_token=p2\n2026-10-12T02:00:02Z GET /sensors?page_token=p2 200 items=15 next_token=p3\n2026-10-12T02:00:02Z GET /sensors?page_token=p3 200 items=2 next_token=p3\n2026-10-12T02:00:02Z GET /sensors?page_token=p3 200 items=2 next_token=p3\n(… 41,000 more identical requests until 03:00:00 …)\n'
        : '2026-10-12T02:00:01Z GET /sensors -- connection reset by load balancer\n2026-10-12T02:00:01Z GET /sensors 200 items=15 next_token=p1\n2026-10-12T02:00:01Z GET /sensors?page_token=p1 429 Retry-After: 2\n2026-10-12T02:00:01Z GET /sensors?page_token=p1 429 Retry-After: 2\n(… 58 more within the same second …)\n2026-10-12T02:00:02Z GET /sensors?page_token=p1 403 banned: too many requests\n';
      return { user: 'lab', host: 'ops-tools', cwd: '/home/lab/tools',
        dirs: [{ path: '/home/lab/tools/tests' }, { path: '/var/log/mockapi' }],
        files: [{ path: '/home/lab/tools/inventory.py', content: INVENTORY_PY, mode: '755' }, { path: '/home/lab/tools/tests/test_inventory.py', content: tests }, { path: '/var/log/mockapi/requests.log', content: initialLog }, { path: '/home/lab/tools/README.md', content: '# inventory.py\nNightly fleet inventory. FLEET_TOKEN is injected by the scheduler; the API pages 15 items at a time, rate-limits abusive clients with 429 + Retry-After, and (documented quirk) the last page echoes its own page token.\n' }],
        sre: state, extra: S.bind(state, verbs) };
    },
    objectives: [
      { id: 'symptom', stage: 'evidence', text: 'Reproduce the failure and read the API\'s request log for what the client actually did',
        hint: 'The server log is the client\'s behaviour seen from the other side.', hint2: '`python3 inventory.py` then `tail -n 20 /var/log/mockapi/requests.log`.',
        reveal: 'python3 inventory.py; tail -n 20 /var/log/mockapi/requests.log',
        done: function (c) { return ran(c, /python3\s+(\.\/)?inventory\.py/) && saw(c, /(tail|cat|grep|less)\b.*requests\.log/, /next_token=p3\n.*next_token=p3|429 Retry-After/); } },
      { id: 'code', stage: 'evidence', text: 'Find in the client the loops that have no bound, and what it prints when it retries',
        hint: 'Look for `while True` and ask what ends it; then read the except branch.', hint2: '`grep -n "while\\|token\\|except\\|print" inventory.py`.',
        reveal: 'grep -n "while\\|token\\|except\\|print\\|urlopen" inventory.py',
        done: function (c) { return saw(c, /grep\b.*inventory\.py|cat\s+(\.\/)?inventory\.py|sed\s+-n\b.*inventory\.py/, /while True[\s\S]*print\(|print\([\s\S]*while True/); } },
      { id: 'fix', stage: 'fix', text: 'Bound the client: a timeout on every request, a stop on a repeated page token, a few retries that honour Retry-After, and no token in any output',
        hint: 'Four properties, each one line or two.', hint2: '`timeout=` in urlopen; `for attempt in range(5)` instead of the retry `while True`, sleeping for Retry-After; a `seen` set of page tokens; replace the print that includes TOKEN.',
        reveal: "sed -i 's/urlopen(req)/urlopen(req, timeout=10)/; /^def get/,/^def main/s/while True:/for attempt in range(5):/; s/^            print(\"retrying after\", e, \"with token\", TOKEN)$/            time.sleep(int(getattr(e, \"headers\", None) and e.headers.get(\"Retry-After\") or 2 ** attempt))/; s/^            continue$/&\\n    raise RuntimeError(\"fleet API: gave up after 5 attempts\")/; s/^    items, token = \\[\\], None$/    items, token, seen = [], None, set()/; s/^        token = page.get(\"next_token\")$/&\\n        if token in seen:\\n            break\\n        seen.add(token)/' inventory.py",
        done: function (c) { var q = SIM().probeState(fileText(c, '/home/lab/tools/inventory.py') || ''); return q['timeout-set'] && q['repeated-token-guard'] && q['bounded-retries'] && q['honours-retry-after'] && q['logs-token'] === false; } },
      { id: 'tests', stage: 'fix', text: 'Make the client\'s test suite pass',
        hint: 'The tests name the four properties.', hint2: '`python3 -m unittest tests/test_inventory.py`.',
        reveal: 'python3 -m unittest tests/test_inventory.py',
        done: function (c) { return saw(c, /python3\s+-m\s+unittest/, /Ran 4 tests[\s\S]*\bOK\b/); } },
      { id: 'verify', stage: 'verify', text: 'Run the inventory and show all 47 sensors, a clean exit, and nothing secret in the output',
        hint: 'The number is the proof; the request log shows no loop and no burst.', hint2: '`python3 inventory.py` — expect "47 items" and exit 0; then look at the tail of the request log.',
        reveal: 'python3 inventory.py',
        done: function (c) { var L = st(c).lastInventory; return lastIs(c, /python3\s+(\.\/)?inventory\.py/, /^47 items$/m) && lastCode(c) === 0 && !!L && !L.leaked; } }
    ],
    sre: {
      scenarioId: 'S08', moduleId: 'M04', lab: 'L08', variants: ['a', 'b'],
      symptom: 'The inventory job runs for an hour and is killed, or stops at 15 of 47 sensors.',
      neutralTitle: 'A fleet inventory job that never finishes, or finishes early',
      neutralBrief: 'The nightly inventory client against the paginated fleet API (15 per page, 47 sensors) is sometimes killed after an hour and sometimes reports 15. The API team says their service is healthy and shares its request log. Make the client finish with every sensor exactly once, bounded in time and retries, without leaking the token.',
      impact: 'No reliable fleet inventory for a week.', changes: 'The API started rate-limiting abusive clients last week; page tokens were always like this.',
      spoilers: ['repeated token', 'echoes', 'infinite loop', 'Retry-After', '429', 'unbounded', 'while True'],
      tools: ['python3 inventory.py (fixture script; behaviour follows the "# sim:" probes)', 'python3 -m unittest', 'tail/cat/grep on the request log', 'sed -i', 'edit'],
      grammar: ['`python3 inventory.py` — rendered from the script\'s structure (see "# sim:" lines); appends to /var/log/mockapi/requests.log', '`python3 -m unittest tests/test_inventory.py`', '`tail -n N FILE`, `cat`, `grep -n`, `sed -i`, `edit`'],
      palette: ['python3 inventory.py', 'tail -n 20 /var/log/mockapi/requests.log', 'grep -n "while\\|token\\|except\\|continue\\|urlopen" inventory.py', 'cat inventory.py', 'python3 -m unittest tests/test_inventory.py'],
      assumptions: ['The API is correct: it pages 15 at a time, occasionally repeats a token under load, and returns 429 with Retry-After when hammered.', 'GET /sensors is idempotent; retrying it is safe when bounded.'],
      simplified: ['No Python runs here: the simulator recognises the documented edits ("# sim:" probes) and renders the client\'s behaviour and the server\'s log. L08 runs the real client against a real mock server.', 'Each command advances the clock 10 seconds.'],
      unsafe: [
        { label: 'leaked the API token into output or logs', why: 'Running a modified client that still prints the bearer token writes a credential into every log collector; the original already did, and a "fixed" client that keeps doing it ships the leak.',
          test: function (c) { return !!st(c).leakAfterEdit; },
          demo: "sed -i 's/urlopen(req)/urlopen(req, timeout=10)/' inventory.py && python3 inventory.py" }
      ],
      alt: function () { return ['python3 inventory.py', 'cat /var/log/mockapi/requests.log', 'cat inventory.py',
        "sed -i 's/urlopen(req)/urlopen(req, timeout=5)/; /^def get/,/^def main/s/while True:/for attempt in range(3):/; s/^            print(.*TOKEN)$/            time.sleep(float(e.headers[\"Retry-After\"]) if getattr(e, \"headers\", None) and \"Retry-After\" in e.headers else 1)/; s/^    items, token = \\[\\], None$/    items, token, seen = [], None, set()/; s/^        if not token:$/        if not token or token in seen:/; s/^            break$/&\\n        seen.add(token)/' inventory.py",
        'python3 -m unittest tests/test_inventory.py', 'python3 inventory.py']; },
      mechanism: 'Two unbounded loops. The pagination loop trusted `next_token` forever, so when the API repeated a token under load the client fetched the same page until it was killed. The retry loop caught every exception and retried immediately with no limit, so a single 429 became a hundred requests in a second and a ban — and the retry message printed the bearer token into the log. A bounded client sets a timeout on every call, remembers the tokens it has seen and stops on a repeat, retries a small number of times honouring Retry-After with backoff (safe because GET is idempotent), and never writes the credential anywhere.',
      alternatives: [
        { h: 'The API is broken', out: 'Mostly ruled out: the request log shows the client\'s own behaviour causing the ban; the repeated token is a known API quirk a client must handle.' },
        { h: 'Raise the kill timeout', out: 'Rejected: an unbounded loop does not finish given more time.' }
      ],
      clues: ['The README noting that the token is injected by the scheduler is the reason it must never be printed.'],
      passRubric: ['Reads the server log as evidence of client behaviour', 'Names both unbounded loops and what bounds each', 'Explains why GET retries are safe and what would change for a POST', 'Verifies the exact count once and that no token appears in output'],
      prereqs: ['les-m04-05', 'les-m04-03'], refs: ['T11']
    }
  });
})();
