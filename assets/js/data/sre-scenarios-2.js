/* SRE & Cloud Deployment Foundations — simulated incidents S09–S12 (M05–M06).

   Same contract as sre-scenarios-1.js: each mission's `world(seed)` builds a
   fresh LXShell world (state in `sre`, bounded verbs in `extra`, bound with
   LXSim.bind so every command advances the logical clock). Objectives check
   evidence AND state; `sre.unsafe` lists the documented shortcuts that fail
   the attempt; `sre.alt(variant)` is a second valid path.

   S09  private network path model: subnets, route tables, gateway/interface
        endpoints, security groups, the VPC resolver and a worker whose
        start-up checks run over that model.
   S10  IAM evaluation model: identity policy, permissions boundary, bucket
        policy, SCP and request context, evaluated the documented way
        (explicit deny → allows → boundary), with `iamsim explain`.
   S11  Terraform plan model: HCL subset parsed from the .tf files, diffed
        against state with per-type replacement (ForceNew) fields, moved
        blocks, lifecycle prevent_destroy/ignore_changes, plan/apply/show/state.
   S12  the same Terraform model behind an S3 backend with use_lockfile: a
        lock object, CI runs on the logical clock, force-unlock.

   Everything here is a bounded simulation. Names, IDs and addresses are
   invented (account 111122223333 is the AWS documentation example; public
   addresses are in TEST-NET ranges). Anything outside the documented grammar
   says so instead of pretending. */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.missions = LX.missions || [];

(function () {
  function SIM() { return window.LXSim; }
  function st(c) { return c.w.sre; }
  function ran(c, re) { return SIM().ran(c, re); }
  function saw(c, re, outRe) { return SIM().saw(c, re, outRe); }
  function lastIs(c, cmdRe, outRe) { return SIM().lastIs(c, cmdRe, outRe); }

  /* ═══ shared helpers: AWS CLI argument and output conventions ═══ */
  var ACCT = '111122223333', REGION = 'us-east-2';
  function J(x) { return JSON.stringify(x, null, 4); }
  function has(a, name) { return a.indexOf(name) !== -1; }
  function argVal(a, name) {
    for (var i = 0; i < a.length; i++) {
      if (a[i] === name) return a[i + 1] == null ? '' : a[i + 1];
      if (a[i].indexOf(name + '=') === 0) return a[i].slice(name.length + 1);
    }
    return null;
  }
  /* list-valued options: `--route-table-ids rtb-1 rtb-2` */
  function argList(a, name) {
    var out = [];
    for (var i = 0; i < a.length; i++) {
      if (a[i].indexOf(name + '=') === 0) out.push(a[i].slice(name.length + 1));
      if (a[i] !== name) continue;
      for (var j = i + 1; j < a.length && a[j].indexOf('--') !== 0; j++) out.push(a[j]);
    }
    return out;
  }
  function filters(a) {
    return argList(a, '--filters').map(function (t) {
      var m = /^Name=([^,]+),Values=(.+)$/.exec(t);
      return m ? { name: m[1], values: m[2].split(',') } : { bad: t };
    });
  }
  /* --query: a small JMESPath subset (dotted names, [] / [*] projections, [N]) */
  function jpath(obj, q) {
    var vals = [obj], proj = false;
    String(q).split('.').forEach(function (seg) {
      var m = /^([A-Za-z0-9_:-]*)((?:\[\*?\d*\])*)$/.exec(seg);
      if (!m || (!m[1] && !m[2])) throw new Error('unsupported');
      if (m[1]) vals = vals.map(function (v) { return v != null && typeof v === 'object' ? v[m[1]] : undefined; }).filter(function (v) { return v !== undefined; });
      (m[2].match(/\[[^\]]*\]/g) || []).forEach(function (b) {
        if (b === '[]' || b === '[*]') { proj = true; var flat = []; vals.forEach(function (v) { if (Array.isArray(v)) flat = flat.concat(v); }); vals = flat; }
        else { var n = parseInt(b.slice(1), 10); vals = vals.map(function (v) { return Array.isArray(v) ? v[n] : undefined; }).filter(function (v) { return v !== undefined; }); }
      });
    });
    return proj ? vals : (vals.length ? vals[0] : null);
  }
  function scalar(v) { return v == null || typeof v !== 'object'; }
  function awsOut(a, obj) {
    var S = SIM(), q = argVal(a, '--query'), o = argVal(a, '--output') || 'json', v = obj;
    if (q) {
      try { v = jpath(obj, q); } catch (e) { return S.err('aws: --query "' + q + '" is not supported in this simulation (simple dotted paths with [] or [N], e.g. RouteTables[].Routes)', 252); }
    }
    if (o === 'text') {
      if (scalar(v)) return S.ok(v == null ? 'None' : String(v));
      if (Array.isArray(v) && v.every(scalar)) return S.ok(v.join('\t'));
      return S.ok(J(v));
    }
    if (o !== 'json') return S.err('aws: --output ' + o + ' is not modelled here; json (the default) and text work', 252);
    return S.ok(v === undefined ? 'null' : J(v));
  }
  function awsErr(op, code, msg) { return SIM().err('\nAn error occurred (' + code + ') when calling the ' + op + ' operation: ' + msg, 254); }
  function fileArg(w, v) {
    if (v == null) return null;
    if (v.indexOf('file://') === 0) { var t = SIM().readFile(w, v.slice(7)); return t == null ? { missing: v.slice(7) } : { text: t }; }
    return { text: v };
  }
  function stripGlobal(a) {
    var out = [];
    for (var i = 0; i < a.length; i++) {
      if (a[i] === '--region' || a[i] === '--profile') { i++; continue; }
      if (/^--(region|profile)=/.test(a[i]) || a[i] === '--no-cli-pager') continue;
      out.push(a[i]);
    }
    return out;
  }
  function ip2n(ip) { var p = String(ip).split('.'); return (+p[0]) * 16777216 + (+p[1]) * 65536 + (+p[2]) * 256 + (+p[3]); }
  function inCidr(ip, cidr) {
    var s = String(cidr).split('/'), bits = +s[1];
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;
    var sh = Math.pow(2, 32 - bits);
    return Math.floor(ip2n(ip) / sh) === Math.floor(ip2n(s[0]) / sh);
  }
  /* a tiny unified-ish line diff for the git wrappers */
  function lineDiff(a, b) {
    var al = String(a).split('\n'), bl = String(b).split('\n'), out = [], i = 0, j = 0;
    while (i < al.length || j < bl.length) {
      if (i < al.length && j < bl.length && al[i] === bl[j]) { out.push(' ' + al[i]); i++; j++; continue; }
      var k = bl.indexOf(al[i], j), l = al.indexOf(bl[j], i);
      if (i < al.length && (k === -1 || (l !== -1 && l - i <= k - j))) { out.push('-' + al[i]); i++; }
      else if (j < bl.length) { out.push('+' + bl[j]); j++; }
    }
    return out.filter(function (x, n) {
      /* keep three lines of context around changes */
      for (var d = -3; d <= 3; d++) { var y = out[n + d]; if (y && y.charAt(0) !== ' ') return true; }
      return false;
    });
  }
  function hex(seed, n) { var s = ''; var k = 0; while (s.length < n) s += SIM().fnv(seed + ':' + (k++)).toString(16); return s.slice(0, n); }

  /* ═══ S09 · Private app cannot reach a required service ═════════════ */
  var N9 = {
    vpc: 'vpc-0c4e1a7d93b5f2e10', cidr: '10.20.0.0/16',
    sub: { appA: 'subnet-0a4d2e6f81c3b5a01', appB: 'subnet-0b7e3c9a12d4f6b02', pub: 'subnet-0c1f5a8e37b2d9c03', ops: 'subnet-0d2a6b9f48c3e0d04' },
    rtb: { appA: 'rtb-0a1b2c3d4e5f6a7b1', appB: 'rtb-0b2c3d4e5f6a7b8c2', pub: 'rtb-0c3d4e5f6a7b8c9d3', ops: 'rtb-0d4e5f6a7b8c9d0e4' },
    igw: 'igw-0e5f6a7b8c9d0e1f5', nat: 'nat-0f6a7b8c9d0e1f2a6', pl: 'pl-0f3a9c2e5b7d1a4c8', plCidrs: ['198.51.100.0/25'],
    sg: { app: 'sg-0a2b4c6d8e0f1a2b3', db: 'sg-0b3c5d7e9f1a2b3c4', vpceApp: 'sg-0c4d6e8f0a2b3c4d5', vpceMgmt: 'sg-0d5e7f9a1b3c4d5e6' },
    vpce: { s3: 'vpce-0a7c3e9b51d2f4806', sm: 'vpce-0b8d4f0c62e3a5917', ssm: 'vpce-0c9e5a1d73f4b6a28', ssmm: 'vpce-0d0f6b2e84a5c7b39', ec2: 'vpce-0e1a7c3f95b6d8c4a' },
    inst: { a: 'i-0a1b2c3d4e5f60789', b: 'i-0b2c3d4e5f6a70891' },
    db: 'beacon-db.cx7lab2qk9ab.us-east-2.rds.amazonaws.com', bucket: 'beacon-archive-lab'
  };
  var S09_PUBLIC = { secretsmanager: '198.51.100.200', ssm: '198.51.100.201', ssmmessages: '198.51.100.202', ec2: '198.51.100.203' };

  function s09World(seed) {
    var S = SIM(), v = S.variantOf(seed, ['a', 'b', 'c']);
    var s = { clock: 0, risky: [], hooks: [], variant: v, ruleN: 0,
      subnets: [
        { id: N9.sub.appA, name: 'beacon-app-a', cidr: '10.20.1.0/24', az: 'us-east-2a', rtb: N9.rtb.appA, mapPublic: false },
        { id: N9.sub.appB, name: 'beacon-app-b', cidr: '10.20.2.0/24', az: 'us-east-2b', rtb: N9.rtb.appB, mapPublic: false },
        { id: N9.sub.pub, name: 'edge-public-a', cidr: '10.20.101.0/24', az: 'us-east-2a', rtb: N9.rtb.pub, mapPublic: true },
        { id: N9.sub.ops, name: 'ops-tools-a', cidr: '10.20.50.0/24', az: 'us-east-2a', rtb: N9.rtb.ops, mapPublic: false }
      ],
      rtbs: [
        { id: N9.rtb.appA, name: 'beacon-app-a', routes: [] },
        { id: N9.rtb.appB, name: 'beacon-app-b', routes: [] },
        { id: N9.rtb.pub, name: 'edge-public', routes: [{ dest: '0.0.0.0/0', target: N9.igw }] },
        { id: N9.rtb.ops, name: 'ops-tools', routes: [{ dest: '0.0.0.0/0', target: N9.nat }] }
      ],
      endpoints: [], sgs: [],
      bucket: { name: N9.bucket, pab: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true }, acl: 'private', publicPolicy: false },
      worker: { active: false, pid: 0, starts: 0, since: 0, log: [] }
    };
    function rid() { s.ruleN++; return 'sgr-0' + hex('S09-rule-' + s.ruleN, 16); }
    function rule(proto, from, to, kind, val, desc) { var r = { id: rid(), proto: proto, from: from, to: to }; r[kind] = val; if (desc) r.desc = desc; return r; }
    var appEgress = [rule('tcp', 5432, 5432, 'sg', N9.sg.db, 'postgres'), rule('tcp', 443, 443, 'pl', N9.pl, 's3 via gateway endpoint'), rule('tcp', 443, 443, 'sg', N9.sg.vpceMgmt, 'ssm/ec2 endpoints')];
    if (v !== 'c') appEgress.push(rule('tcp', 443, 443, 'sg', N9.sg.vpceApp, 'app interface endpoints'));
    s.sgs = [
      { id: N9.sg.app, name: 'beacon-app', desc: 'Beacon API and worker instances', ingress: [rule('tcp', 8080, 8080, 'cidr', '10.20.0.0/16', 'api from inside the VPC')], egress: appEgress },
      { id: N9.sg.db, name: 'beacon-db', desc: 'Beacon PostgreSQL', ingress: [rule('tcp', 5432, 5432, 'sg', N9.sg.app)], egress: [rule('-1', 0, 65535, 'cidr', '0.0.0.0/0')] },
      { id: N9.sg.vpceApp, name: 'beacon-vpce', desc: 'Interface endpoints used by Beacon', ingress: [rule('tcp', 443, 443, 'sg', N9.sg.app)], egress: [rule('-1', 0, 65535, 'cidr', '0.0.0.0/0')] },
      { id: N9.sg.vpceMgmt, name: 'mgmt-vpce', desc: 'SSM and EC2 API endpoints', ingress: [rule('tcp', 443, 443, 'cidr', '10.20.0.0/16')], egress: [rule('-1', 0, 65535, 'cidr', '0.0.0.0/0')] }
    ];
    function iface(id, svc, name, ips, sg, suffix) {
      return { id: id, type: 'Interface', service: 'com.amazonaws.' + REGION + '.' + svc, short: svc, name: name, privateDns: true, sgs: [sg], rtbs: [],
        enis: [{ subnet: N9.sub.appA, ip: ips[0], eni: 'eni-0' + hex(id + 'a', 16) }, { subnet: N9.sub.appB, ip: ips[1], eni: 'eni-0' + hex(id + 'b', 16) }],
        dnsName: id + '-' + suffix + '.' + svc + '.' + REGION + '.vpce.amazonaws.com' };
    }
    var fullPolicy = '{"Version":"2008-10-17","Statement":[{"Effect":"Allow","Principal":"*","Action":"*","Resource":"*"}]}';
    s.endpoints = [
      { id: N9.vpce.s3, type: 'Gateway', service: 'com.amazonaws.' + REGION + '.s3', short: 's3', name: 'beacon-s3', privateDns: false, sgs: [], enis: [], rtbs: v === 'a' ? [N9.rtb.appB] : [N9.rtb.appA, N9.rtb.appB], policy: fullPolicy },
      iface(N9.vpce.sm, 'secretsmanager', 'beacon-secretsmanager', ['10.20.1.37', '10.20.2.41'], N9.sg.vpceApp, '4kq2m7xd'),
      iface(N9.vpce.ssm, 'ssm', 'mgmt-ssm', ['10.20.1.38', '10.20.2.42'], N9.sg.vpceMgmt, '9tw3n1pb'),
      iface(N9.vpce.ssmm, 'ssmmessages', 'mgmt-ssmmessages', ['10.20.1.39', '10.20.2.43'], N9.sg.vpceMgmt, '2hc8v5rz'),
      iface(N9.vpce.ec2, 'ec2', 'mgmt-ec2', ['10.20.1.40', '10.20.2.44'], N9.sg.vpceMgmt, '7ds4k6qf')
    ];
    if (v === 'b') s.endpoints[1].privateDns = false;
    s.endpoints.forEach(function (e) { if (e.type === 'Interface') e.policy = fullPolicy; });

    var SRC = { ip: '10.20.1.15', subnet: N9.sub.appA, sgs: [N9.sg.app] };
    function byId(list, id) { return list.filter(function (x) { return x.id === id; })[0] || null; }
    function names() {
      var m = {};
      m['s3.' + REGION + '.amazonaws.com'] = ['198.51.100.80'];
      m[N9.bucket + '.s3.' + REGION + '.amazonaws.com'] = ['198.51.100.80'];
      m[N9.db] = ['10.20.2.80'];
      s.endpoints.forEach(function (e) {
        if (e.type !== 'Interface') return;
        var ips = e.enis.map(function (x) { return x.ip; });
        m[e.dnsName] = ips;
        m[e.short + '.' + REGION + '.amazonaws.com'] = e.privateDns ? ips : [S09_PUBLIC[e.short]];
      });
      return m;
    }
    function routesOf(rtbId) {
      var t = byId(s.rtbs, rtbId);
      if (!t) return [];
      var out = [{ dest: N9.cidr, target: 'local', origin: 'CreateRouteTable' }];
      s.endpoints.forEach(function (e) { if (e.type === 'Gateway' && e.rtbs.indexOf(rtbId) !== -1) out.push({ pl: N9.pl, target: e.id, origin: 'CreateRoute' }); });
      return out.concat(t.routes.map(function (r) { return { dest: r.dest, target: r.target, origin: 'CreateRoute' }; }));
    }
    function bestRoute(rtbId, ip) {
      var best = null, bl = -1;
      routesOf(rtbId).forEach(function (r) {
        (r.pl ? N9.plCidrs : [r.dest]).forEach(function (cidr) {
          if (inCidr(ip, cidr)) { var l = +cidr.split('/')[1]; if (l > bl) { bl = l; best = r; } }
        });
      });
      return best;
    }
    function eniAt(ip) {
      if (ip === '10.20.1.15' || ip === '10.20.2.15') return { sgs: [N9.sg.app], what: 'instance' };
      if (ip === '10.20.2.80') return { sgs: [N9.sg.db], what: 'rds' };
      for (var i = 0; i < s.endpoints.length; i++) {
        var e = s.endpoints[i];
        for (var k = 0; k < e.enis.length; k++) if (e.enis[k].ip === ip) return { sgs: e.sgs.slice(), what: 'endpoint', ep: e };
      }
      return null;
    }
    function ruleMatch(r, ip, port, peerSgs) {
      if (r.proto !== '-1' && !(r.proto === 'tcp' && port >= r.from && port <= r.to)) return false;
      if (r.cidr) return inCidr(ip, r.cidr);
      if (r.sg) return peerSgs.indexOf(r.sg) !== -1;
      if (r.pl) return N9.plCidrs.some(function (c) { return inCidr(ip, c); });
      return false;
    }
    /* the path a TCP connection from app-a takes: route table → SG egress →
       (local: destination SG ingress) | gateway endpoint | NAT | IGW */
    function reach(ip, port) {
      var sub = byId(s.subnets, SRC.subnet), rt = bestRoute(sub.rtb, ip);
      if (!rt) return { ok: false, hop: 'route' };
      var dst = eniAt(ip), peer = dst ? dst.sgs : [];
      var eg = SRC.sgs.some(function (id) { var g = byId(s.sgs, id); return g && g.egress.some(function (r) { return ruleMatch(r, ip, port, peer); }); });
      if (!eg) return { ok: false, hop: 'sg-egress' };
      if (rt.target === 'local') {
        if (!dst) return { ok: false, hop: 'no-host' };
        var ing = dst.sgs.some(function (id) { var g = byId(s.sgs, id); return g && g.ingress.some(function (r) { return ruleMatch(r, SRC.ip, port, SRC.sgs); }); });
        return ing ? { ok: true, via: 'local' } : { ok: false, hop: 'sg-ingress' };
      }
      if (/^vpce-|^nat-/.test(rt.target)) return { ok: true, via: rt.target };
      return { ok: false, hop: 'no-public-ip' };   /* an IGW route without a public IP goes nowhere */
    }
    function resolveName(host) {
      if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return [host];
      return names()[host] || null;
    }
    function workerDeps(w) {
      var env = S.readFile(w, '/etc/beacon/worker.env') || '';
      var smUrl = S.kvGet(env, 'AWS_ENDPOINT_URL_SECRETS_MANAGER');
      var smHost = smUrl ? smUrl.replace(/^https?:\/\//, '').replace(/[\/:].*$/, '') : 'secretsmanager.' + REGION + '.amazonaws.com';
      var bucket = S.kvGet(env, 'ARCHIVE_BUCKET') || N9.bucket, db = S.kvGet(env, 'DB_HOST') || N9.db;
      return [{ id: 'secretsmanager', host: smHost, port: 443, aws: true }, { id: 's3', host: bucket + '.s3.' + REGION + '.amazonaws.com', port: 443, aws: true }, { id: 'postgres', host: db, port: 5432 }];
    }
    function depCheck(d) {
      var ips = resolveName(d.host);
      if (!ips) return { ok: false, msg: 'could not resolve host ' + d.host };
      var r = reach(ips[0], d.port);
      if (r.ok) return { ok: true, ip: ips[0] };
      return { ok: false, ip: ips[0], msg: d.aws ? 'Connect timeout on endpoint URL: "https://' + d.host + '/"' : 'connection to ' + d.host + ':' + d.port + ' timed out after 10s' };
    }
    function workerStart(w) {
      var W = s.worker; W.starts++;
      var pid = 2300 + W.starts, px = 'beacon-worker[' + pid + ']: ', bad = null;
      W.log.push('systemd[1]: Started beacon-worker.service - Beacon worker (archive and queue consumer).');
      W.log.push(px + 'beacon-worker 1.5.0 starting (region ' + REGION + ', host ip-10-20-1-15)');
      workerDeps(w).forEach(function (d) {
        if (bad) return;
        var r = depCheck(d);
        if (r.ok) W.log.push(px + 'dependency ' + d.id + ' ok (' + r.ip + ':' + d.port + ')');
        else { bad = d; W.log.push(px + 'ERROR dependency ' + d.id + ': ' + r.msg); }
      });
      if (bad) {
        W.active = false; W.pid = 0;
        W.log.push(px + 'exiting: required dependency ' + bad.id + ' unavailable');
        W.log.push('systemd[1]: beacon-worker.service: Main process exited, code=exited, status=1/FAILURE');
        W.log.push('systemd[1]: beacon-worker.service: Failed with result \'exit-code\'.');
        return false;
      }
      W.active = true; W.pid = pid; W.since = s.clock;
      W.log.push(px + 'all dependency checks passed; consuming queue beacon-jobs');
      return true;
    }
    function exposure() {
      var out = [];
      [N9.sub.appA, N9.sub.appB].forEach(function (sid) {
        var sub = byId(s.subnets, sid);
        if (sub.mapPublic) out.push('public-ip');
        byId(s.rtbs, sub.rtb).routes.forEach(function (r) { if (/^(igw|nat)-/.test(r.target)) out.push('route'); });
      });
      s.sgs.forEach(function (g) { g.ingress.forEach(function (r) { if (r.cidr === '0.0.0.0/0' || r.cidr === '::/0') out.push('sg'); }); });
      var b = s.bucket;
      if (!b.pab.BlockPublicAcls || !b.pab.IgnorePublicAcls || !b.pab.BlockPublicPolicy || !b.pab.RestrictPublicBuckets || b.acl !== 'private' || b.publicPolicy) out.push('bucket');
      return out;
    }
    s.api = {
      depsOk: function (w) { return workerDeps(w).every(function (d) { return depCheck(d).ok; }); },
      exposure: exposure
    };

    /* ── rendering ── */
    function tags(name) { return [{ Key: 'Name', Value: name }]; }
    function rtJson(t) {
      var assoc = s.subnets.filter(function (x) { return x.rtb === t.id; }).map(function (x) {
        return { Main: false, RouteTableAssociationId: 'rtbassoc-0' + hex(t.id + x.id, 16), RouteTableId: t.id, SubnetId: x.id, AssociationState: { State: 'associated' } };
      });
      return { Associations: assoc, PropagatingVgws: [], RouteTableId: t.id,
        Routes: routesOf(t.id).map(function (r) {
          var o = r.pl ? { DestinationPrefixListId: r.pl } : { DestinationCidrBlock: r.dest };
          if (/^nat-/.test(r.target)) o.NatGatewayId = r.target; else o.GatewayId = r.target;
          o.Origin = r.origin; o.State = 'active';
          return o;
        }), Tags: tags(t.name), VpcId: N9.vpc, OwnerId: ACCT };
    }
    function permJson(r) {
      var o = { IpProtocol: r.proto };
      if (r.proto !== '-1') { o.FromPort = r.from; o.ToPort = r.to; }
      o.IpRanges = r.cidr ? [r.desc ? { CidrIp: r.cidr, Description: r.desc } : { CidrIp: r.cidr }] : [];
      o.Ipv6Ranges = [];
      o.PrefixListIds = r.pl ? [r.desc ? { PrefixListId: r.pl, Description: r.desc } : { PrefixListId: r.pl }] : [];
      o.UserIdGroupPairs = r.sg ? [r.desc ? { GroupId: r.sg, UserId: ACCT, Description: r.desc } : { GroupId: r.sg, UserId: ACCT }] : [];
      return o;
    }
    function sgJson(g) { return { Description: g.desc, GroupName: g.name, IpPermissions: g.ingress.map(permJson), OwnerId: ACCT, GroupId: g.id, IpPermissionsEgress: g.egress.map(permJson), Tags: tags(g.name), VpcId: N9.vpc }; }
    function epJson(e) {
      var dns = e.type === 'Interface' ? [{ DnsName: e.dnsName, HostedZoneId: 'Z0LABVPCE00001' }] : [];
      if (e.type === 'Interface' && e.privateDns) dns.push({ DnsName: e.short + '.' + REGION + '.amazonaws.com', HostedZoneId: 'Z0LABPRIVATE01' });
      return { VpcEndpointId: e.id, VpcEndpointType: e.type, VpcId: N9.vpc, ServiceName: e.service, State: 'available', PolicyDocument: e.policy,
        RouteTableIds: e.rtbs.slice(), SubnetIds: e.enis.map(function (x) { return x.subnet; }),
        Groups: e.sgs.map(function (id) { var g = byId(s.sgs, id); return { GroupId: id, GroupName: g ? g.name : '?' }; }),
        IpAddressType: 'ipv4', PrivateDnsEnabled: e.privateDns, RequesterManaged: false,
        NetworkInterfaceIds: e.enis.map(function (x) { return x.eni; }), DnsEntries: dns,
        CreationTimestamp: '2026-10-09T14:02:11+00:00', Tags: tags(e.name), OwnerId: ACCT };
    }
    function filt(list, a, getters) {
      var fs = filters(a);
      var bad = fs.filter(function (f) { return f.bad || !getters[f.name]; })[0];
      if (bad) return { error: 'this simulation supports --filters Name=' + Object.keys(getters).join('|Name=') + ',Values=...' };
      return { list: list.filter(function (x) { return fs.every(function (f) { var got = [].concat(getters[f.name](x)); return f.values.some(function (v) { return got.indexOf(v) !== -1; }); }); }) };
    }
    function parsePerms(a) {
      var spec = argVal(a, '--ip-permissions'), out = [];
      if (spec) {
        var list = null;
        if (/^\s*[\[{]/.test(spec)) { try { var j = JSON.parse(spec); list = Array.isArray(j) ? j : [j]; } catch (e) { list = null; } }
        if (list) {
          list.forEach(function (p) {
            var base = { proto: String(p.IpProtocol), from: p.FromPort == null ? 0 : +p.FromPort, to: p.ToPort == null ? 65535 : +p.ToPort };
            (p.IpRanges || []).forEach(function (x) { out.push(Object.assign({ cidr: x.CidrIp }, base)); });
            (p.UserIdGroupPairs || []).forEach(function (x) { out.push(Object.assign({ sg: x.GroupId }, base)); });
            (p.PrefixListIds || []).forEach(function (x) { out.push(Object.assign({ pl: x.PrefixListId }, base)); });
          });
        } else {
          var pm = /IpProtocol=(-?\w+)/.exec(spec), fm = /FromPort=(-?\d+)/.exec(spec), tm = /ToPort=(-?\d+)/.exec(spec);
          if (!pm) return { error: 'could not read IpProtocol from --ip-permissions' };
          var b2 = { proto: pm[1], from: fm ? +fm[1] : 0, to: tm ? +tm[1] : 65535 };
          (spec.match(/CidrIp=[\d.\/]+/g) || []).forEach(function (x) { out.push(Object.assign({ cidr: x.slice(7) }, b2)); });
          (spec.match(/GroupId=sg-[0-9a-f]+/g) || []).forEach(function (x) { out.push(Object.assign({ sg: x.slice(8) }, b2)); });
          (spec.match(/PrefixListId=pl-[0-9a-f]+/g) || []).forEach(function (x) { out.push(Object.assign({ pl: x.slice(13) }, b2)); });
        }
      } else {
        var proto = argVal(a, '--protocol'), port = argVal(a, '--port'), cidr = argVal(a, '--cidr'), src = argVal(a, '--source-group');
        if (!proto) return { error: 'give --ip-permissions (or --protocol P --port N --cidr C|--source-group SG)' };
        var pr = String(port || '0-65535').split('-');
        var b3 = { proto: proto === 'all' ? '-1' : proto, from: +pr[0], to: +(pr[1] || pr[0]) };
        if (cidr) out.push(Object.assign({ cidr: cidr }, b3));
        if (src) out.push(Object.assign({ sg: src }, b3));
      }
      if (!out.length) return { error: 'no CIDR, security group or prefix list named in the permission' };
      return { perms: out };
    }
    function sameRule(r, p) { return r.proto === p.proto && r.from === p.from && r.to === p.to && r.cidr === p.cidr && r.sg === p.sg && r.pl === p.pl; }

    function awsVerb(w, a0) {
      var a = stripGlobal(a0), svc = a[0], op = a[1], r = a.slice(2);
      var DATA_TIMEOUT = function (host, path) { return S.err('\nConnect timeout on endpoint URL: "https://' + host + (path || '/') + '"', 255); };
      if (!svc || svc === 'help') return S.ok('aws (simulation): sts get-caller-identity · ec2 describe-vpcs|describe-subnets|describe-route-tables|describe-vpc-endpoints|describe-security-groups|describe-instances|describe-prefix-lists|describe-nat-gateways|describe-internet-gateways · ec2 modify-vpc-endpoint|create-route|delete-route|authorize-/revoke-security-group-egress|-ingress|modify-subnet-attribute · s3 ls|cp · s3api get-/put-/delete-public-access-block|put-bucket-acl|head-bucket · secretsmanager describe-secret|get-secret-value');
      if (svc === 'sts' && op === 'get-caller-identity') return awsOut(r, { UserId: 'AROAEXAMPLELAB0WORKER:' + N9.inst.a, Account: ACCT, Arn: 'arn:aws:sts::' + ACCT + ':assumed-role/beacon-worker/' + N9.inst.a });
      if (svc === 'ec2') {
        if (op === 'describe-vpcs') return awsOut(r, { Vpcs: [{ CidrBlock: N9.cidr, DhcpOptionsId: 'dopt-0a1b2c3d4e5f6a7b8', State: 'available', VpcId: N9.vpc, OwnerId: ACCT, InstanceTenancy: 'default', IsDefault: false, Tags: tags('beacon-lab') }] });
        if (op === 'describe-subnets') {
          var ids = argList(r, '--subnet-ids'), fs = filt(s.subnets, r, { 'vpc-id': function () { return N9.vpc; }, 'subnet-id': function (x) { return x.id; }, 'tag:Name': function (x) { return x.name; } });
          if (fs.error) return S.err('aws ec2 describe-subnets: ' + fs.error, 252);
          var subs = fs.list.filter(function (x) { return !ids.length || ids.indexOf(x.id) !== -1; });
          if (ids.length && !subs.length) return awsErr('DescribeSubnets', 'InvalidSubnetID.NotFound', 'The subnet ID \'' + ids[0] + '\' does not exist');
          return awsOut(r, { Subnets: subs.map(function (x) { return { AvailabilityZone: x.az, CidrBlock: x.cidr, MapPublicIpOnLaunch: x.mapPublic, State: 'available', SubnetId: x.id, VpcId: N9.vpc, OwnerId: ACCT, Tags: tags(x.name) }; }) });
        }
        if (op === 'describe-route-tables') {
          var rids = argList(r, '--route-table-ids');
          var f2 = filt(s.rtbs, r, { 'association.subnet-id': function (t) { return s.subnets.filter(function (x) { return x.rtb === t.id; }).map(function (x) { return x.id; }); }, 'vpc-id': function () { return N9.vpc; }, 'route-table-id': function (t) { return t.id; }, 'tag:Name': function (t) { return t.name; } });
          if (f2.error) return S.err('aws ec2 describe-route-tables: ' + f2.error, 252);
          var ts = f2.list.filter(function (t) { return !rids.length || rids.indexOf(t.id) !== -1; });
          if (rids.length && !ts.length) return awsErr('DescribeRouteTables', 'InvalidRouteTableID.NotFound', 'The routeTable ID \'' + rids[0] + '\' does not exist');
          return awsOut(r, { RouteTables: ts.map(rtJson) });
        }
        if (op === 'describe-vpc-endpoints') {
          var eids = argList(r, '--vpc-endpoint-ids');
          var f3 = filt(s.endpoints, r, { 'service-name': function (e) { return e.service; }, 'vpc-endpoint-type': function (e) { return e.type; }, 'vpc-id': function () { return N9.vpc; }, 'vpc-endpoint-id': function (e) { return e.id; } });
          if (f3.error) return S.err('aws ec2 describe-vpc-endpoints: ' + f3.error, 252);
          var es = f3.list.filter(function (e) { return !eids.length || eids.indexOf(e.id) !== -1; });
          if (eids.length && !es.length) return awsErr('DescribeVpcEndpoints', 'InvalidVpcEndpointId.NotFound', 'The Vpc Endpoint Id \'' + eids[0] + '\' does not exist');
          return awsOut(r, { VpcEndpoints: es.map(epJson) });
        }
        if (op === 'describe-security-groups') {
          var gids = argList(r, '--group-ids');
          var f4 = filt(s.sgs, r, { 'group-name': function (g) { return g.name; }, 'group-id': function (g) { return g.id; }, 'vpc-id': function () { return N9.vpc; } });
          if (f4.error) return S.err('aws ec2 describe-security-groups: ' + f4.error, 252);
          var gs = f4.list.filter(function (g) { return !gids.length || gids.indexOf(g.id) !== -1; });
          if (gids.length && !gs.length) return awsErr('DescribeSecurityGroups', 'InvalidGroup.NotFound', 'The security group \'' + gids[0] + '\' does not exist');
          return awsOut(r, { SecurityGroups: gs.map(sgJson) });
        }
        if (op === 'describe-instances') {
          var inst = [{ id: N9.inst.a, ip: '10.20.1.15', sub: N9.sub.appA, az: 'us-east-2a', name: 'beacon-app-a' }, { id: N9.inst.b, ip: '10.20.2.15', sub: N9.sub.appB, az: 'us-east-2b', name: 'beacon-app-b' }];
          var iids = argList(r, '--instance-ids');
          return awsOut(r, { Reservations: inst.filter(function (x) { return !iids.length || iids.indexOf(x.id) !== -1; }).map(function (x) {
            return { Instances: [{ InstanceId: x.id, InstanceType: 't4g.small', ImageId: 'ami-0a1b2c3d4e5f6a7b8', Placement: { AvailabilityZone: x.az }, PrivateIpAddress: x.ip, SubnetId: x.sub, VpcId: N9.vpc,
              SecurityGroups: [{ GroupId: N9.sg.app, GroupName: 'beacon-app' }], IamInstanceProfile: { Arn: 'arn:aws:iam::' + ACCT + ':instance-profile/beacon-worker' }, State: { Code: 16, Name: 'running' }, Tags: tags(x.name) }] };
          }) });
        }
        if (op === 'describe-prefix-lists') return awsOut(r, { PrefixLists: [{ PrefixListId: N9.pl, PrefixListName: 'com.amazonaws.' + REGION + '.s3', Cidrs: N9.plCidrs.slice() }] });
        if (op === 'describe-nat-gateways') return awsOut(r, { NatGateways: [{ NatGatewayId: N9.nat, SubnetId: N9.sub.pub, VpcId: N9.vpc, State: 'available', ConnectivityType: 'public', Tags: tags('ops-egress') }] });
        if (op === 'describe-internet-gateways') return awsOut(r, { InternetGateways: [{ InternetGatewayId: N9.igw, Attachments: [{ State: 'available', VpcId: N9.vpc }], Tags: tags('beacon-lab-igw') }] });
        if (op === 'modify-vpc-endpoint') {
          var e = byId(s.endpoints, argVal(r, '--vpc-endpoint-id'));
          if (!e) return awsErr('ModifyVpcEndpoint', 'InvalidVpcEndpointId.NotFound', 'The Vpc Endpoint Id \'' + argVal(r, '--vpc-endpoint-id') + '\' does not exist');
          var addR = argList(r, '--add-route-table-ids'), remR = argList(r, '--remove-route-table-ids'), addG = argList(r, '--add-security-group-ids'), remG = argList(r, '--remove-security-group-ids');
          var pdOn = has(r, '--private-dns-enabled'), pdOff = has(r, '--no-private-dns-enabled');
          if (e.type === 'Gateway' && (pdOn || pdOff || addG.length)) return awsErr('ModifyVpcEndpoint', 'InvalidParameter', 'PrivateDnsEnabled and security groups apply to Interface endpoints; ' + e.id + ' is a Gateway endpoint');
          if (e.type === 'Interface' && (addR.length || remR.length)) return awsErr('ModifyVpcEndpoint', 'InvalidParameter', 'Route tables apply to Gateway endpoints; ' + e.id + ' is an Interface endpoint');
          var badR = addR.concat(remR).filter(function (x) { return !byId(s.rtbs, x); })[0];
          if (badR) return awsErr('ModifyVpcEndpoint', 'InvalidRouteTableId.NotFound', 'The routeTable ID \'' + badR + '\' does not exist');
          addR.forEach(function (x) { if (e.rtbs.indexOf(x) === -1) e.rtbs.push(x); });
          e.rtbs = e.rtbs.filter(function (x) { return remR.indexOf(x) === -1; });
          addG.forEach(function (x) { if (e.sgs.indexOf(x) === -1) e.sgs.push(x); });
          e.sgs = e.sgs.filter(function (x) { return remG.indexOf(x) === -1; });
          if (pdOn) e.privateDns = true;
          if (pdOff) e.privateDns = false;
          if (!addR.length && !remR.length && !addG.length && !remG.length && !pdOn && !pdOff) return S.err('aws ec2 modify-vpc-endpoint: nothing to change (simulation supports --add-/--remove-route-table-ids, --add-/--remove-security-group-ids, --[no-]private-dns-enabled)', 252);
          return awsOut(r, { Return: true });
        }
        if (op === 'create-route' || op === 'delete-route') {
          var t = byId(s.rtbs, argVal(r, '--route-table-id')), dest = argVal(r, '--destination-cidr-block');
          var OP = op === 'create-route' ? 'CreateRoute' : 'DeleteRoute';
          if (!t) return awsErr(OP, 'InvalidRouteTableID.NotFound', 'The routeTable ID \'' + argVal(r, '--route-table-id') + '\' does not exist');
          if (!dest) return S.err('aws ec2 ' + op + ': --destination-cidr-block is required here (prefix-list routes to a gateway endpoint are created by associating the route table with the endpoint)', 252);
          if (op === 'delete-route') {
            var before = t.routes.length; t.routes = t.routes.filter(function (x) { return x.dest !== dest; });
            if (before === t.routes.length) return awsErr(OP, 'InvalidRoute.NotFound', 'no route with destination-cidr-block ' + dest + ' in the route table ' + t.id);
            return S.ok('');
          }
          var gw = argVal(r, '--gateway-id'), nat = argVal(r, '--nat-gateway-id'), vpe = argVal(r, '--vpc-endpoint-id');
          if (vpe) return awsErr(OP, 'InvalidParameterValue', 'route target ' + vpe + ' is not a Gateway Load Balancer endpoint (simulation note: routes to an S3/DynamoDB gateway endpoint are managed with modify-vpc-endpoint --add-route-table-ids)');
          var target = gw || nat;
          if (!target || (target !== N9.igw && target !== N9.nat)) return awsErr(OP, 'InvalidParameterValue', 'unknown route target ' + (target || '(none)') + ' (this VPC has ' + N9.igw + ' and ' + N9.nat + ')');
          if (t.routes.some(function (x) { return x.dest === dest; })) return awsErr(OP, 'RouteAlreadyExists', 'The route identified by ' + dest + ' already exists.');
          t.routes.push({ dest: dest, target: target });
          return awsOut(r, { Return: true });
        }
        if (/^(authorize|revoke)-security-group-(egress|ingress)$/.test(op)) {
          var g = byId(s.sgs, argVal(r, '--group-id')), egress = /egress$/.test(op), auth = /^authorize/.test(op);
          var OP2 = (auth ? 'Authorize' : 'Revoke') + 'SecurityGroup' + (egress ? 'Egress' : 'Ingress');
          if (!g) return awsErr(OP2, 'InvalidGroup.NotFound', 'The security group \'' + argVal(r, '--group-id') + '\' does not exist');
          var pp = parsePerms(r);
          if (pp.error) return S.err('aws ec2 ' + op + ': ' + pp.error, 252);
          var list = egress ? g.egress : g.ingress, added = [];
          for (var k = 0; k < pp.perms.length; k++) {
            var p = pp.perms[k], hit = list.filter(function (x) { return sameRule(x, p); })[0];
            if (auth) {
              if (hit) return awsErr(OP2, 'InvalidPermission.Duplicate', 'the specified rule already exists');
              if (p.sg && !byId(s.sgs, p.sg)) return awsErr(OP2, 'InvalidGroup.NotFound', 'The security group \'' + p.sg + '\' does not exist');
              var nr = Object.assign({ id: rid() }, p); list.push(nr); added.push(nr);
            } else {
              if (!hit) return awsErr(OP2, 'InvalidPermission.NotFound', 'The specified rule does not exist in this security group.');
              list.splice(list.indexOf(hit), 1);
            }
          }
          if (!auth) return awsOut(r, { Return: true });
          return awsOut(r, { Return: true, SecurityGroupRules: added.map(function (x) {
            var o = { SecurityGroupRuleId: x.id, GroupId: g.id, GroupOwnerId: ACCT, IsEgress: egress, IpProtocol: x.proto, FromPort: x.proto === '-1' ? -1 : x.from, ToPort: x.proto === '-1' ? -1 : x.to };
            if (x.cidr) o.CidrIpv4 = x.cidr; if (x.pl) o.PrefixListId = x.pl; if (x.sg) o.ReferencedGroupInfo = { GroupId: x.sg, UserId: ACCT };
            return o;
          }) });
        }
        if (op === 'modify-subnet-attribute') {
          var sb = byId(s.subnets, argVal(r, '--subnet-id'));
          if (!sb) return awsErr('ModifySubnetAttribute', 'InvalidSubnetID.NotFound', 'The subnet ID \'' + argVal(r, '--subnet-id') + '\' does not exist');
          if (has(r, '--map-public-ip-on-launch')) sb.mapPublic = true;
          else if (has(r, '--no-map-public-ip-on-launch')) sb.mapPublic = false;
          else return S.err('aws ec2 modify-subnet-attribute: simulation supports --[no-]map-public-ip-on-launch', 252);
          return S.ok('');
        }
        return S.unsupported('aws ec2', op || '', ['describe-vpcs', 'describe-subnets', 'describe-route-tables', 'describe-vpc-endpoints', 'describe-security-groups', 'describe-instances', 'describe-prefix-lists', 'describe-nat-gateways', 'describe-internet-gateways', 'modify-vpc-endpoint', 'create-route', 'delete-route', 'authorize-/revoke-security-group-egress|ingress', 'modify-subnet-attribute']);
      }
      if (svc === 's3' && (op === 'ls' || op === 'cp')) {
        var host = N9.bucket + '.s3.' + REGION + '.amazonaws.com', path = '/?list-type=2&prefix=&delimiter=%2F&encoding-type=url';
        if (op === 'ls' && !r.filter(function (x) { return /^s3:\/\//.test(x); }).length) { host = 's3.' + REGION + '.amazonaws.com'; path = '/'; }
        var rr = reach(resolveName(host)[0], 443);
        if (!rr.ok) return DATA_TIMEOUT(host, op === 'cp' ? '/' : path);
        if (op === 'ls') {
          if (host.indexOf(N9.bucket) !== 0) return S.ok('2025-11-03 10:12:44 ' + N9.bucket + '\n2025-11-03 10:13:02 looped-tfstate-lab');
          return S.ok('                           PRE records/');
        }
        var srcF = r[0], dstK = r[1] || '';
        if (!srcF || S.readFile(w, srcF) == null) return S.err('The user-provided path ' + (srcF || '') + ' does not exist.', 255);
        return S.ok('upload: ' + srcF + ' to ' + dstK);
      }
      if (svc === 's3api') {
        var bkt = argVal(r, '--bucket');
        if (/public-access-block|bucket-acl|head-bucket/.test(op || '') && bkt !== N9.bucket) return awsErr(op, 'NoSuchBucket', 'The specified bucket does not exist');
        if (op === 'get-public-access-block') return awsOut(r, { PublicAccessBlockConfiguration: Object.assign({}, s.bucket.pab) });
        if (op === 'delete-public-access-block') { Object.keys(s.bucket.pab).forEach(function (k) { s.bucket.pab[k] = false; }); return S.ok(''); }
        if (op === 'put-public-access-block') {
          var cfg = argVal(r, '--public-access-block-configuration') || '';
          Object.keys(s.bucket.pab).forEach(function (k) { var m = new RegExp(k + '\\W+(true|false)', 'i').exec(cfg); if (m) s.bucket.pab[k] = m[1].toLowerCase() === 'true'; });
          return S.ok('');
        }
        if (op === 'put-bucket-acl') { s.bucket.acl = argVal(r, '--acl') || 'private'; return S.ok(''); }
        if (op === 'head-bucket') {
          var hb = reach('198.51.100.80', 443);
          if (!hb.ok) return DATA_TIMEOUT(N9.bucket + '.s3.' + REGION + '.amazonaws.com', '/');
          return awsOut(r, { BucketRegion: REGION, AccessPointAlias: false });
        }
        return S.unsupported('aws s3api', op || '', ['get-public-access-block', 'put-public-access-block', 'delete-public-access-block', 'put-bucket-acl', 'head-bucket']);
      }
      if (svc === 'secretsmanager' && (op === 'describe-secret' || op === 'get-secret-value')) {
        var url = argVal(r, '--endpoint-url'), smh = url ? url.replace(/^https?:\/\//, '').replace(/[\/:].*$/, '') : 'secretsmanager.' + REGION + '.amazonaws.com';
        var ips2 = resolveName(smh);
        if (!ips2) return S.err('\nCould not connect to the endpoint URL: "https://' + smh + '/"', 255);
        if (!reach(ips2[0], 443).ok) return DATA_TIMEOUT(smh, '/');
        var sid = argVal(r, '--secret-id');
        if (sid !== 'beacon/worker-db') return awsErr(op === 'describe-secret' ? 'DescribeSecret' : 'GetSecretValue', 'ResourceNotFoundException', 'Secrets Manager can\'t find the specified secret.');
        var meta = { ARN: 'arn:aws:secretsmanager:' + REGION + ':' + ACCT + ':secret:beacon/worker-db-Lb7x2Q', Name: 'beacon/worker-db', Description: 'Beacon worker database credentials (lab fixture)', LastChangedDate: '2026-10-01T09:00:00+00:00' };
        if (op === 'get-secret-value') return awsOut(r, { ARN: meta.ARN, Name: meta.Name, VersionId: '7f0c2a9e-lab0-4c1d-9e2f-000000000001', SecretString: '{"username":"beacon","password":"lab-db-password-not-a-real-secret"}', VersionStages: ['AWSCURRENT'] });
        return awsOut(r, meta);
      }
      return S.unsupported('aws', [svc, op].filter(Boolean).join(' '), ['sts get-caller-identity', 'ec2 describe-*/modify-vpc-endpoint/create-route/delete-route/authorize-/revoke-security-group-*/modify-subnet-attribute', 's3 ls|cp', 's3api get-/put-/delete-public-access-block|put-bucket-acl|head-bucket', 'secretsmanager describe-secret|get-secret-value']);
    }

    var verbs = {
      aws: awsVerb,
      dig: function (w, a) {
        var name = null, short = false;
        a.forEach(function (t) { if (t === '+short') short = true; else if (t.charAt(0) === '@' || t.charAt(0) === '+' || /^(A|AAAA)$/i.test(t)) { /* accepted */ } else if (!name) name = t.replace(/\.$/, ''); });
        if (!name) return S.ok('dig (simulation): dig [@10.20.0.2] NAME [A] [+short] — answered by the VPC resolver (AmazonProvidedDNS, 10.20.0.2)');
        var ips = resolveName(name);
        if (short) return S.ok(ips ? ips.join('\n') : '');
        var out = '; <<>> DiG 9.18 (simulated) <<>> ' + a.join(' ') + '\n;; ->>HEADER<<- opcode: QUERY, status: ' + (ips ? 'NOERROR' : 'NXDOMAIN') + ', id: ' + (S.fnv(name + s.clock) % 65535) + '\n;; flags: qr rd ra; QUERY: 1, ANSWER: ' + (ips ? ips.length : 0) + '\n\n;; QUESTION SECTION:\n;' + name + '.\t\tIN\tA\n';
        if (ips) out += '\n;; ANSWER SECTION:\n' + ips.map(function (ip) { return name + '.\t60\tIN\tA\t' + ip; }).join('\n') + '\n';
        return S.ok(out + '\n;; Query time: 1 msec\n;; SERVER: 10.20.0.2#53(10.20.0.2) (UDP)\n');
      },
      nslookup: function (w, a) {
        var name = a.filter(function (x) { return x.charAt(0) !== '-'; })[0];
        if (!name) return S.err('nslookup (simulation): nslookup NAME');
        var ips = resolveName(name);
        if (!ips) return { out: 'Server:\t\t10.20.0.2\nAddress:\t10.20.0.2#53\n\n** server can\'t find ' + name + ': NXDOMAIN\n', code: 1 };
        return S.ok('Server:\t\t10.20.0.2\nAddress:\t10.20.0.2#53\n\nNon-authoritative answer:\n' + ips.map(function (ip) { return 'Name:\t' + name + '\nAddress: ' + ip; }).join('\n'));
      },
      curl: function (w, a) {
        var f = S.flags(a, ['m', 'max-time', 'connect-timeout', 'o', 'H', 'X', 'w']);
        var url = f.pos.filter(function (x) { return /^https?:\/\//.test(x); })[0];
        if (!url) return S.err('curl (simulation): curl [-v] [-I] [-m N] https://HOST/ — only http(s) URLs to the names this VPC resolves');
        var m = /^(https?):\/\/([^\/:]+)(?::(\d+))?/.exec(url), host = m[2], port = m[3] ? +m[3] : (m[1] === 'https' ? 443 : 80);
        var verbose = !!(f.f.v || f.f.verbose), tmo = +(f.f.m || f.f['max-time'] || f.f['connect-timeout'] || 0);
        var ips = resolveName(host);
        if (!ips) return S.err('curl: (6) Could not resolve host: ' + host, 6);
        var lines = verbose ? ['*   Trying ' + ips[0] + ':' + port + '...'] : [];
        var rr = reach(ips[0], port);
        if (!rr.ok) return { out: '', err: (lines.length ? lines.join('\n') + '\n' : '') + (tmo ? 'curl: (28) Connection timed out after ' + (tmo * 1000 + 2) + ' milliseconds\n' : 'curl: (28) Failed to connect to ' + host + ' port ' + port + ' after 130012 ms: Couldn\'t connect to server\n'), code: 28 };
        if (verbose) lines.push('* Connected to ' + host + ' (' + ips[0] + ') port ' + port, '* SSL connection using TLSv1.3 / TLS_AES_128_GCM_SHA256', '* Server certificate: *.' + host.split('.').slice(1).join('.') + ' (verify ok)');
        var resp;
        if (/\.s3\./.test(host) || /^s3\./.test(host)) resp = 'HTTP/1.1 403 Forbidden\nx-amz-request-id: LAB0REQ0S3000001\nContent-Type: application/xml\n\n<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>';
        else if (port === 5432) return S.err('curl: (52) Empty reply from server', 52);
        else resp = 'HTTP/1.1 400 Bad Request\nx-amzn-RequestId: 0d9b7a1e-lab0-4e2f-8c3d-000000000001\nContent-Type: application/x-amz-json-1.1\n\n{"__type":"MissingAuthenticationTokenException","message":"Missing Authentication Token"}';
        if (!(f.f.I || f.f.i || verbose)) resp = resp.replace(/^[\s\S]*?\n\n/, '');
        return S.ok((lines.length ? lines.join('\n') + '\n' : '') + resp);
      },
      nc: function (w, a) {
        var v = false, z = false, pos = [];
        for (var i = 0; i < a.length; i++) {
          var t = a[i];
          if (/^-[a-zA-Z]+$/.test(t)) { if (t.indexOf('v') !== -1) v = true; if (t.indexOf('z') !== -1) z = true; if (t.indexOf('w') !== -1 && /^\d+$/.test(a[i + 1] || '')) i++; continue; }
          if (/^-w\d+$/.test(t)) continue;
          pos.push(t);
        }
        if (!z || pos.length < 2) return S.err('nc (simulation): only the port probe form is modelled: nc -vz [-w SECONDS] HOST PORT');
        var host = pos[0], port = +pos[1], ips = resolveName(host);
        if (!ips) return { out: '', err: v ? 'nc: getaddrinfo for host "' + host + '" port ' + port + ': Name or service not known\n' : '', code: 1 };
        var rr = reach(ips[0], port), svcName = port === 443 ? 'tcp/https' : port === 5432 ? 'tcp/postgresql' : 'tcp/*';
        if (rr.ok) return { out: '', err: v ? 'Connection to ' + host + ' (' + ips[0] + ') ' + port + ' port [' + svcName + '] succeeded!\n' : '', code: 0 };
        return { out: '', err: v ? 'nc: connect to ' + host + ' (' + ips[0] + ') port ' + port + ' (tcp) timed out: Operation now in progress\n' : '', code: 1 };
      },
      ip: function (w, a) {
        if (a[0] === 'route' || a[0] === 'r') return S.ok('default via 10.20.1.1 dev ens5 proto dhcp src 10.20.1.15 metric 512\n10.20.0.2 via 10.20.1.1 dev ens5 proto dhcp src 10.20.1.15 metric 512\n10.20.1.0/24 dev ens5 proto kernel scope link src 10.20.1.15 metric 512\n# every packet leaves through the VPC router (10.20.1.1); the subnet\'s route table decides where it goes next');
        if (a[0] === 'addr' || a[0] === 'a' || a[0] === '-4') return S.ok('2: ens5: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 9001\n    inet 10.20.1.15/24 metric 512 brd 10.20.1.255 scope global dynamic ens5');
        return S.unsupported('ip', a.join(' '), ['ip route', 'ip addr']);
      },
      systemctl: function (w, a) {
        var verb = a[0], unit = (a[1] || '').replace(/\.service$/, ''), W = s.worker;
        if (unit !== 'beacon-worker') return S.err('Unit ' + (unit || '(none)') + '.service could not be found. (This host runs beacon-worker.)', 4);
        if (verb === 'status') {
          var head = '● beacon-worker.service - Beacon worker (archive and queue consumer)\n     Loaded: loaded (/etc/systemd/system/beacon-worker.service; enabled; preset: enabled)\n     Active: ' +
            (W.active ? 'active (running) since ' + S.stamp({ clock: W.since }) + '; ' + (s.clock - W.since) + 's ago\n   Main PID: ' + W.pid + ' (python3)' : 'failed (Result: exit-code) since ' + S.stamp(s) + '; 3s ago');
          return { out: head + '\n\n' + W.log.slice(-6).map(function (l) { return 'Oct 13 ip-10-20-1-15 ' + l; }).join('\n') + '\n', code: W.active ? 0 : 3 };
        }
        if (verb === 'restart' || verb === 'start') {
          if (verb === 'start' && W.active) return S.ok('');
          if (W.active) W.log.push('systemd[1]: Stopping beacon-worker.service...');
          return workerStart(w) ? { out: '', code: 0 } : S.err('Job for beacon-worker.service failed because the control process exited with error code.\nSee "systemctl status beacon-worker.service" and "journalctl -xeu beacon-worker.service" for details.', 1);
        }
        if (verb === 'stop') { W.active = false; W.pid = 0; W.log.push('systemd[1]: Stopped beacon-worker.service.'); return S.ok(''); }
        if (verb === 'is-active') return { out: (W.active ? 'active' : 'failed') + '\n', code: W.active ? 0 : 3 };
        if (verb === 'cat') return S.ok('# /etc/systemd/system/beacon-worker.service\n[Unit]\nDescription=Beacon worker (archive and queue consumer)\nAfter=network-online.target\n\n[Service]\nUser=beacon\nEnvironmentFile=/etc/beacon/worker.env\nExecStart=/usr/bin/python3 -m beacon worker\nRestart=on-failure\nRestartSec=5\n\n[Install]\nWantedBy=multi-user.target');
        return S.unsupported('systemctl', verb || '', ['status', 'start', 'restart', 'stop', 'is-active', 'cat']);
      },
      journalctl: function (w, a) {
        var n = 20, unit = null;
        for (var i = 0; i < a.length; i++) { if (a[i] === '-u') unit = (a[++i] || '').replace(/\.service$/, ''); else if (a[i] === '-n') n = parseInt(a[++i], 10) || 20; else if (/^-xeu/.test(a[i])) unit = (a[++i] || '').replace(/\.service$/, ''); }
        if (unit && unit !== 'beacon-worker') return S.ok('-- No entries --');
        return S.ok(s.worker.log.slice(-n).map(function (l) { return 'Oct 13 ip-10-20-1-15 ' + l; }).join('\n') || '-- No entries --');
      },
      edit: S.verbs.edit()
    };
    /* boot: the worker has already tried (and, with the fault, failed) three times */
    s.hooks.push(function (x, w) { if (x._booted) return; x._booted = true; for (var i = 0; i < 3; i++) { if (workerStart(w)) break; x.worker.log.push('systemd[1]: beacon-worker.service: Scheduled restart job, restart counter is at ' + (i + 1) + '.'); } });
    var readme = '# Beacon network (lab inventory)\n\n' +
      'VPC ' + N9.vpc + ' 10.20.0.0/16 (us-east-2)\n' +
      '- subnet beacon-app-a ' + N9.sub.appA + ' 10.20.1.0/24 (this host: app-a, 10.20.1.15)\n' +
      '- subnet beacon-app-b ' + N9.sub.appB + ' 10.20.2.0/24\n' +
      '- subnet edge-public-a ' + N9.sub.pub + ' (load balancers only)\n' +
      '- subnet ops-tools-a ' + N9.sub.ops + ' (build runners; egress via NAT)\n\n' +
      'Security groups: beacon-app ' + N9.sg.app + ', beacon-db ' + N9.sg.db + ', beacon-vpce ' + N9.sg.vpceApp + ', mgmt-vpce ' + N9.sg.vpceMgmt + '\n\n' +
      'Design rule: the app subnets have no internet egress (no NAT, no IGW route) and no public addresses.\n' +
      'AWS services are reached privately through VPC endpoints. The archive bucket is never public.\n\n' +
      'Worker dependencies (checked at start-up): Secrets Manager secret beacon/worker-db, S3 bucket ' + N9.bucket + ', PostgreSQL ' + N9.db + ':5432.\n';
    return { user: 'ssm-user', host: 'ip-10-20-1-15', cwd: '/home/ssm-user', ip: '10.20.1.15',
      files: [
        { path: '/etc/resolv.conf', content: 'nameserver 10.20.0.2\nsearch us-east-2.compute.internal\n', owner: 'root', group: 'root', mode: '644' },
        { path: '/etc/beacon/worker.env', content: 'AWS_REGION=us-east-2\nBEACON_SECRET_ID=beacon/worker-db\nARCHIVE_BUCKET=' + N9.bucket + '\nDB_HOST=' + N9.db + '\n', owner: 'root', group: 'beacon', mode: '644' },
        { path: '/home/ssm-user/NETWORK.md', content: readme }
      ],
      sre: s, extra: S.bind(s, verbs) };
  }

  var S09_PALETTE = ['systemctl status beacon-worker', 'journalctl -u beacon-worker -n 20', 'cat NETWORK.md', 'dig secretsmanager.us-east-2.amazonaws.com', 'dig beacon-archive-lab.s3.us-east-2.amazonaws.com', 'nc -vz -w 3 secretsmanager.us-east-2.amazonaws.com 443', 'curl -v -m 5 https://beacon-archive-lab.s3.us-east-2.amazonaws.com/', 'aws ec2 describe-vpc-endpoints', 'aws ec2 describe-route-tables --filters Name=association.subnet-id,Values=' + N9.sub.appA, 'aws ec2 describe-security-groups --group-ids ' + N9.sg.app, 'aws ec2 describe-prefix-lists', 'systemctl restart beacon-worker'];
  function s09Unexposed(c) { return st(c).api.exposure().length === 0; }

  LX.missions.push({
    id: 'sre-s09', track: 'sre', cat: 'scenario', level: 'intermediate', mins: 25, kind: 'incident',
    title: 'The Beacon worker on app-a cannot reach something it needs',
    brief: function () { return 'Since this week\'s network tidy-up, the Beacon worker on app-a (private subnet, 10.20.1.15) fails at start-up: one of its dependencies times out. You have a Session Manager shell on app-a and read/write access to the VPC configuration. The design rule stands: the app tier has no path to the internet and nothing about it is public. Find where the private path breaks, repair exactly that, and prove the worker starts.'; },
    keys: S09_PALETTE,
    world: s09World,
    objectives: [
      { id: 'symptom', stage: 'evidence', text: 'Reproduce the failure from app-a and name the dependency that times out',
        hint: 'Start from what the worker itself says, then repeat its connection by hand.', hint2: '`journalctl -u beacon-worker -n 20` shows which dependency failed and the URL it tried; `nc -vz -w 3 HOST 443` repeats the connection.',
        reveal: 'journalctl -u beacon-worker -n 20',
        done: function (c) { return saw(c, /systemctl\s+status\s+beacon-worker|journalctl\b|curl\b|nc\b|aws\s+(s3|s3api|secretsmanager)\b/, /timed out|timeout|Couldn't connect|required dependency/i); } },
      { id: 'name', stage: 'evidence', text: 'Find which address the failing service name resolves to from app-a, and whether that address is a private one',
        hint: 'A connection goes to an address, not a name. Which address did the worker actually try?', hint2: '`dig NAME` against the VPC resolver; compare the answer with the subnet ranges in NETWORK.md and the endpoint addresses.',
        reveal: function (c) { return st(c).variant === 'a' ? 'dig ' + N9.bucket + '.s3.us-east-2.amazonaws.com' : 'dig secretsmanager.us-east-2.amazonaws.com'; },
        done: function (c) { return saw(c, /(dig|nslookup|getent\s+hosts)\b.*amazonaws\.com/, /ANSWER SECTION|^\d+\.\d+\.\d+\.\d+\s*$|^Address: \d+\.\d+\.\d+\.\d+\s*$/m); } },
      { id: 'path', stage: 'evidence', text: 'Trace the private path hop by hop: the VPC endpoint for that service, and the route table or security groups it depends on',
        hint: 'A private path to an AWS service has a few links: an endpoint, how traffic is steered to it, and what each side allows.', hint2: '`aws ec2 describe-vpc-endpoints`, then `aws ec2 describe-route-tables --filters Name=association.subnet-id,Values=SUBNET` or `aws ec2 describe-security-groups --group-ids SG`.',
        reveal: function (c) { var v = st(c).variant;
          return v === 'a' ? 'aws ec2 describe-vpc-endpoints --vpc-endpoint-ids ' + N9.vpce.s3 + ' && aws ec2 describe-route-tables --filters Name=association.subnet-id,Values=' + N9.sub.appA
            : v === 'b' ? 'aws ec2 describe-vpc-endpoints --vpc-endpoint-ids ' + N9.vpce.sm + ' && aws ec2 describe-security-groups --group-ids ' + N9.sg.vpceApp
            : 'aws ec2 describe-vpc-endpoints --vpc-endpoint-ids ' + N9.vpce.sm + ' && aws ec2 describe-security-groups --group-ids ' + N9.sg.app; },
        done: function (c) { return saw(c, /aws\s+ec2\s+describe-vpc-endpoints/, /"VpcEndpoints"/) && (saw(c, /aws\s+ec2\s+describe-route-tables/, /"RouteTables"/) || saw(c, /aws\s+ec2\s+describe-security-groups/, /"SecurityGroups"/)); } },
      { id: 'fix', stage: 'fix', text: 'Repair the one broken link so every worker dependency is reachable privately — with no public exposure anywhere',
        hint: 'Change the link you proved broken; leave the design rule intact.', hint2: 'Missing route-table association: `aws ec2 modify-vpc-endpoint --add-route-table-ids`. Name resolving publicly: `--private-dns-enabled` on the interface endpoint. Blocked egress: `aws ec2 authorize-security-group-egress` to the endpoint\'s group.',
        reveal: function (c) { var v = st(c).variant;
          return v === 'a' ? 'aws ec2 modify-vpc-endpoint --vpc-endpoint-id ' + N9.vpce.s3 + ' --add-route-table-ids ' + N9.rtb.appA
            : v === 'b' ? 'aws ec2 modify-vpc-endpoint --vpc-endpoint-id ' + N9.vpce.sm + ' --private-dns-enabled'
            : 'aws ec2 authorize-security-group-egress --group-id ' + N9.sg.app + ' --ip-permissions IpProtocol=tcp,FromPort=443,ToPort=443,UserIdGroupPairs=[{GroupId=' + N9.sg.vpceApp + '}]'; },
        done: function (c) { return st(c).api.depsOk(c.w) && s09Unexposed(c); } },
      { id: 'verify', stage: 'verify', text: 'Restart the worker and show it running with every dependency check passing',
        hint: 'A successful probe by hand is not the worker starting.', hint2: '`systemctl restart beacon-worker && systemctl status beacon-worker` — expect "active (running)" and "all dependency checks passed".',
        reveal: 'systemctl restart beacon-worker && systemctl status beacon-worker',
        done: function (c) { return st(c).worker.active && s09Unexposed(c) && lastIs(c, /systemctl\s+(status|restart|start)\s+beacon-worker|journalctl\b/, /active \(running\)|all dependency checks passed/); } }
    ],
    sre: {
      scenarioId: 'S09', moduleId: 'M05', lab: 'L09', variants: ['a', 'b', 'c'],
      symptom: 'beacon-worker on app-a exits at start-up: a required AWS dependency times out.',
      neutralTitle: 'A private worker cannot reach a service it depends on',
      neutralBrief: 'Since a network tidy-up this week, the Beacon worker on app-a fails at start-up because one of its dependencies times out. The app tier must stay private: no path to the internet, nothing public. Find where the private path breaks, repair exactly that link, and prove the worker starts.',
      impact: 'Archive uploads and queued jobs stop on app-a; app-b carries the load alone.',
      changes: 'This week: a network tidy-up touched route tables, VPC endpoints and security group rules.',
      spoilers: ['route table', 'private DNS', 'security group', 'egress', 'prefix list', 'association', 'gateway endpoint'],
      tools: ['journalctl / systemctl (beacon-worker)', 'dig, nslookup (VPC resolver 10.20.0.2)', 'nc -vz, curl -v (from app-a)', 'aws ec2 describe-* and the mutation subset', 'aws s3 / s3api / secretsmanager (data calls from app-a)'],
      grammar: ['`systemctl status|restart|stop|cat beacon-worker`, `journalctl -u beacon-worker [-n N]`', '`dig NAME [+short]`, `nslookup NAME`', '`nc -vz [-w S] HOST PORT`, `curl [-v] [-I] [-m S] https://HOST/`', '`aws ec2 describe-vpcs|describe-subnets|describe-route-tables|describe-vpc-endpoints|describe-security-groups|describe-instances|describe-prefix-lists [--…-ids ID…] [--filters Name=…,Values=…] [--query PATH] [--output json|text]`', '`aws ec2 modify-vpc-endpoint --vpc-endpoint-id ID [--add-|--remove-route-table-ids RTB…] [--[no-]private-dns-enabled] [--add-|--remove-security-group-ids SG…]`', '`aws ec2 create-route|delete-route --route-table-id RTB --destination-cidr-block CIDR [--nat-gateway-id|--gateway-id ID]`', '`aws ec2 authorize-|revoke-security-group-egress|ingress --group-id SG --ip-permissions IpProtocol=tcp,FromPort=N,ToPort=N,UserIdGroupPairs=[{GroupId=SG}]|IpRanges=[{CidrIp=C}]|PrefixListIds=[{PrefixListId=PL}]` (JSON form too; the simulation also accepts --protocol/--port/--cidr|--source-group)', '`aws s3 ls|cp`, `aws s3api head-bucket|get-/put-/delete-public-access-block|put-bucket-acl`, `aws secretsmanager describe-secret|get-secret-value --secret-id ID [--endpoint-url URL]`', '`edit FILE KEY VALUE` (e.g. /etc/beacon/worker.env)'],
      palette: S09_PALETTE,
      assumptions: ['You are in a Session Manager shell on app-a; data calls (aws s3, aws secretsmanager, curl, nc, dig) travel app-a\'s real network path.', 'aws ec2 and bucket-configuration calls are answered from your operator access, not over app-a\'s path (in AWS they would reach the EC2/S3 APIs through endpoints of their own).', 'The design rule in NETWORK.md is a requirement, not a preference.'],
      simplified: ['One VPC, four subnets, five endpoints; NACLs, IPv6, Transit Gateway and Route 53 Resolver rules are not modelled.', 'Reachability is decided by route table → source security group egress → destination security group ingress (or a gateway endpoint); responses are allowed back (stateful). Endpoint policies are shown but always allow.', 'Public AWS addresses are drawn from TEST-NET ranges; HTTP responses from services are illustrative.', 'Endpoint changes take effect immediately; in AWS, enabling private DNS takes a short while to propagate.', 'Every command advances a logical clock by 10 seconds.'],
      unsafe: [
        { label: 'gave the app subnets an internet route', why: 'A 0.0.0.0/0 route to a NAT or internet gateway from the app tier breaks the stated design rule: the dependency answers, but every process on those hosts now has general internet egress and the private path is still broken.',
          test: function (c) { return st(c).api.exposure().some(function (x) { return x === 'route' || x === 'public-ip'; }); },
          demo: 'aws ec2 create-route --route-table-id ' + N9.rtb.appA + ' --destination-cidr-block 0.0.0.0/0 --nat-gateway-id ' + N9.nat },
        { label: 'opened a security group to 0.0.0.0/0', why: 'Inbound from anywhere on the app, database or endpoint groups widens exposure and fixes nothing: the failing direction was outbound from app-a.',
          test: function (c) { return st(c).api.exposure().indexOf('sg') !== -1; },
          demo: 'aws ec2 authorize-security-group-ingress --group-id ' + N9.sg.vpceApp + ' --protocol tcp --port 443 --cidr 0.0.0.0/0' },
        { label: 'made the archive bucket publicly accessible', why: 'Removing Block Public Access (or a public ACL/policy) cannot repair a private network path and exposes archived records.',
          test: function (c) { return st(c).api.exposure().indexOf('bucket') !== -1; },
          demo: 'aws s3api delete-public-access-block --bucket ' + N9.bucket }
      ],
      alt: function (v) {
        if (v === 'a') return ['systemctl status beacon-worker', 'nc -vz -w 3 ' + N9.bucket + '.s3.us-east-2.amazonaws.com 443', 'dig +short ' + N9.bucket + '.s3.us-east-2.amazonaws.com', 'aws ec2 describe-prefix-lists',
          'aws ec2 describe-vpc-endpoints --filters Name=service-name,Values=com.amazonaws.us-east-2.s3', 'aws ec2 describe-route-tables --route-table-ids ' + N9.rtb.appA + ' ' + N9.rtb.appB,
          'aws ec2 modify-vpc-endpoint --vpc-endpoint-id ' + N9.vpce.s3 + ' --add-route-table-ids ' + N9.rtb.appA, 'aws s3 ls s3://' + N9.bucket + '/', 'systemctl restart beacon-worker', 'systemctl status beacon-worker'];
        if (v === 'b') return ['systemctl status beacon-worker', 'nslookup secretsmanager.us-east-2.amazonaws.com', 'curl -v -m 5 https://secretsmanager.us-east-2.amazonaws.com/',
          'aws ec2 describe-vpc-endpoints --filters Name=vpc-endpoint-type,Values=Interface', 'aws ec2 describe-security-groups --group-ids ' + N9.sg.app + ' ' + N9.sg.vpceApp,
          'aws secretsmanager describe-secret --secret-id beacon/worker-db --endpoint-url https://' + N9.vpce.sm + '-4kq2m7xd.secretsmanager.us-east-2.vpce.amazonaws.com',
          'echo AWS_ENDPOINT_URL_SECRETS_MANAGER=https://' + N9.vpce.sm + '-4kq2m7xd.secretsmanager.us-east-2.vpce.amazonaws.com >> /etc/beacon/worker.env',
          'systemctl restart beacon-worker', 'journalctl -u beacon-worker -n 6'];
        return ['journalctl -u beacon-worker -n 12', 'dig +short secretsmanager.us-east-2.amazonaws.com', 'nc -vz -w 3 secretsmanager.us-east-2.amazonaws.com 443',
          'aws ec2 describe-vpc-endpoints --filters Name=service-name,Values=com.amazonaws.us-east-2.secretsmanager', 'aws ec2 describe-security-groups --filters Name=group-name,Values=beacon-app,beacon-vpce',
          'aws ec2 authorize-security-group-egress --group-id ' + N9.sg.app + ' --ip-permissions \'[{"IpProtocol":"tcp","FromPort":443,"ToPort":443,"UserIdGroupPairs":[{"GroupId":"' + N9.sg.vpceApp + '","Description":"app interface endpoints"}]}]\'',
          'nc -vz -w 3 secretsmanager.us-east-2.amazonaws.com 443', 'systemctl restart beacon-worker', 'systemctl status beacon-worker'];
      },
      mechanism: 'A private workload reaches an AWS service over a chain of links, and each variant breaks a different one. **Gateway endpoints** (S3) do not change DNS: the bucket name still resolves to a public S3 address, and only a prefix-list route in the subnet\'s route table — added by associating that route table with the endpoint — steers it to the endpoint; app-a\'s route table had lost its association, so the packets had no route and timed out. **Interface endpoints** (Secrets Manager) are ENIs with private addresses; with **private DNS** off, the regional service name still resolves to the public address, which the private subnet cannot reach; enabling private DNS (or pointing the SDK at the endpoint-specific name) fixes the name-to-address step. **Security groups** apply to the endpoint path too: the tidy-up replaced a broad rule with specific ones and missed 443 from the app group to the endpoint group, so the name resolved privately and the SYN was dropped at app-a\'s egress. Adding a NAT/IGW route or opening groups to the world makes the symptom move without repairing the private path, and breaks the design rule.',
      alternatives: [
        { h: 'The service (S3 / Secrets Manager) is down', out: 'Ruled out: app-b, using the same services through the same endpoints, is healthy; the failure is a connect timeout from app-a, not an HTTP error from the service.' },
        { h: 'IAM is denying the worker', out: 'Ruled out: a denial is an HTTP 403/400 response after a connection; here no TCP connection completes.' },
        { h: 'Give app-a a NAT route', out: 'Rejected: it bypasses the endpoint design, gives the whole host internet egress, and violates the stated requirement.' }
      ],
      clues: ['The S3 address being "public" is normal for a gateway endpoint; the route table decides where it goes.', 'NETWORK.md names the design rule; it is a constraint on the fix, not a hint at the cause.'],
      passRubric: ['Names the broken link (association, private DNS, or egress rule) with the describe output that proves it', 'Explains how gateway and interface endpoints differ in DNS and routing', 'States why a NAT/IGW route or 0.0.0.0/0 rule is not an acceptable fix here', 'Verifies with the worker\'s own start-up checks, not only a hand probe'],
      prereqs: ['les-m05-01', 'les-m05-03'], refs: ['T08']
    }
  });

  /* ═══ S10 · AccessDenied despite an allow policy ═════════════════════ */
  var I10 = {
    roleArn: function (n) { return 'arn:aws:iam::' + ACCT + ':role/' + n; },
    polArn: function (n) { return 'arn:aws:iam::' + ACCT + ':policy/' + n; },
    session: 'arn:aws:sts::' + ACCT + ':assumed-role/beacon-worker/i-0a1b2c3d4e5f60789',
    bucket: 'beacon-archive-lab', keyArn: 'arn:aws:kms:' + REGION + ':' + ACCT + ':key/0d5e2c7a-4b1f-4e8a-9c3d-6f2a1b8e7c90',
    obj: 'records/2026/10/13/batch-0042.json'
  };
  var B10 = 'arn:aws:s3:::' + I10.bucket;
  function s10WorkerDoc(variant, version) {
    var write = { Sid: 'WriteRecords', Effect: 'Allow', Action: 's3:PutObject', Resource: (version === 3 && variant === 'c') ? B10 : B10 + '/records/*' };
    var read = { Sid: 'ReadArchive', Effect: 'Allow', Action: ['s3:GetObject', 's3:ListBucket'], Resource: [B10, B10 + '/*'] };
    var kms = { Sid: 'UseArchiveKey', Effect: 'Allow', Action: ['kms:GenerateDataKey', 'kms:Decrypt'], Resource: I10.keyArn };
    if (version === 1) return { Version: '2012-10-17', Statement: [read, write] };
    if (version === 2) return { Version: '2012-10-17', Statement: [read, write, kms] };
    return { Version: '2012-10-17', Statement: [read, write, kms] };
  }
  function s10BucketDoc(variant) {
    var except = [I10.roleArn('beacon-ingest'), variant === 'b' ? 'arn:aws:sts::' + ACCT + ':assumed-role/beacon-worker/*' : I10.roleArn('beacon-worker')];
    return { Version: '2012-10-17', Statement: [
      { Sid: 'DenyUnencryptedUploads', Effect: 'Deny', Principal: '*', Action: 's3:PutObject', Resource: B10 + '/*', Condition: { StringNotEquals: { 's3:x-amz-server-side-encryption': 'aws:kms' } } },
      { Sid: 'DenyWritesExceptPipeline', Effect: 'Deny', Principal: '*', Action: ['s3:PutObject', 's3:DeleteObject'], Resource: B10 + '/*', Condition: { ArnNotLike: { 'aws:PrincipalArn': except } } },
      { Sid: 'DenyInsecureTransport', Effect: 'Deny', Principal: '*', Action: 's3:*', Resource: [B10, B10 + '/*'], Condition: { Bool: { 'aws:SecureTransport': 'false' } } }
    ] };
  }
  function arrOf(x) { return x == null ? [] : Array.isArray(x) ? x : [x]; }
  function globRe(p, ci) { return new RegExp('^' + String(p).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', ci ? 'i' : ''); }
  function condEval(cond, ctx) {
    var ok = true, notes = [];
    Object.keys(cond || {}).forEach(function (op) {
      Object.keys(cond[op]).forEach(function (key) {
        var vals = arrOf(cond[op][key]).map(String), present = ctx[key] != null, cv = present ? String(ctx[key]) : null, res;
        var eq = function (v) { return v === cv; }, gl = function (v) { return globRe(v).test(cv); };
        switch (op) {
          case 'StringEquals': res = present && vals.some(eq); break;
          case 'StringNotEquals': res = !present || !vals.some(eq); break;
          case 'StringLike': res = present && vals.some(gl); break;
          case 'StringNotLike': res = !present || !vals.some(gl); break;
          case 'ArnEquals': case 'ArnLike': res = present && vals.some(gl); break;
          case 'ArnNotEquals': case 'ArnNotLike': res = !present || !vals.some(gl); break;
          case 'Bool': res = present && vals.some(function (v) { return v.toLowerCase() === cv.toLowerCase(); }); break;
          case 'Null': res = (vals[0] === 'true') ? !present : present; break;
          default: res = false; notes.push(op + ' is not modelled in this simulation (treated as not matching)');
        }
        notes.push(op + ' ' + key + ' ' + JSON.stringify(vals.length === 1 ? vals[0] : vals) + ' vs ' + (present ? cv : '(absent)') + ' -> ' + res);
        ok = ok && res;
      });
    });
    return { ok: ok, notes: notes };
  }

  function s10World(seed) {
    var S = SIM(), v = S.variantOf(seed, ['a', 'b', 'c']);
    var s = { clock: 0, risky: [], hooks: [], variant: v, probes: 0, boundaryProved: false, explained: [],
      roles: {
        'beacon-worker': { boundary: I10.polArn('beacon-boundary'), attached: [I10.polArn('beacon-worker-archive')], id: 'AROAEXAMPLELAB0WORKER' },
        'beacon-ingest': { boundary: null, attached: [I10.polArn('beacon-ingest-write')], id: 'AROAEXAMPLELAB0INGEST' },
        'beacon-analyst': { boundary: null, attached: [I10.polArn('beacon-analyst-access')], id: 'AROAEXAMPLELAB0ANALYS' }
      },
      policies: {},
      bucketPolicy: JSON.stringify(s10BucketDoc(v))
    };
    function pol(name, versions, def) { s.policies[I10.polArn(name)] = { name: name, versions: versions.map(function (d, i) { return { id: 'v' + (i + 1), doc: d, created: ['2026-03-10T10:00:00Z', '2026-06-11T10:00:00Z', '2026-10-12T16:20:00Z'][i] }; }), def: def }; }
    pol('beacon-worker-archive', [s10WorkerDoc(v, 1), s10WorkerDoc(v, 2), s10WorkerDoc(v, 3)], 'v3');
    pol('beacon-boundary', [{ Version: '2012-10-17', Statement: [{ Sid: 'BeaconServiceCeiling', Effect: 'Allow', Action: ['s3:GetObject', 's3:PutObject', 's3:ListBucket', 'kms:GenerateDataKey', 'kms:Decrypt', 'secretsmanager:GetSecretValue', 'sqs:*'], Resource: '*' }] }], 'v1');
    pol('beacon-ingest-write', [{ Version: '2012-10-17', Statement: [{ Sid: 'IngestWrites', Effect: 'Allow', Action: 's3:PutObject', Resource: B10 + '/incoming/*' }, { Sid: 'UseArchiveKey', Effect: 'Allow', Action: 'kms:GenerateDataKey', Resource: I10.keyArn }] }], 'v1');
    pol('beacon-analyst-access', [{ Version: '2012-10-17', Statement: [{ Sid: 'AnalystBuckets', Effect: 'Allow', Action: ['s3:GetObject', 's3:ListBucket', 's3:PutObject'], Resource: ['arn:aws:s3:::beacon-*', 'arn:aws:s3:::beacon-*/*'] }, { Sid: 'UseArchiveKey', Effect: 'Allow', Action: 'kms:GenerateDataKey', Resource: I10.keyArn }] }], 'v1');
    var AWS_MANAGED = {
      'arn:aws:iam::aws:policy/AdministratorAccess': { name: 'AdministratorAccess', doc: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: '*', Resource: '*' }] } },
      'arn:aws:iam::aws:policy/AmazonS3FullAccess': { name: 'AmazonS3FullAccess', doc: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: ['s3:*', 's3-object-lambda:*'], Resource: '*' }] } }
    };
    function docOf(arn) {
      if (AWS_MANAGED[arn]) return AWS_MANAGED[arn].doc;
      var p = s.policies[arn]; if (!p) return null;
      return p.versions.filter(function (x) { return x.id === p.def; })[0].doc;
    }
    function nameOf(arn) { return AWS_MANAGED[arn] ? AWS_MANAGED[arn].name : (s.policies[arn] || {}).name || arn; }
    function bucketDoc() { try { return JSON.parse(s.bucketPolicy); } catch (e) { return null; } }

    /* ── evaluation: the documented order for a same-account request ── */
    function matchStmt(stmt, req, resourcePolicy) {
      var acts = arrOf(stmt.Action), res = arrOf(stmt.Resource);
      var aOk = acts.some(function (x) { return globRe(x, true).test(req.action); });
      var rOk = res.some(function (x) { return globRe(x).test(req.resource); });
      var pOk = true;
      if (resourcePolicy) {
        var pr = stmt.Principal;
        pOk = pr === '*' || (pr && arrOf(pr.AWS).some(function (x) { return x === '*' || globRe(x).test(req.roleArn) || globRe(x).test(req.session) || x === 'arn:aws:iam::' + ACCT + ':root'; }));
      }
      var ce = aOk && rOk && pOk ? condEval(stmt.Condition, req.ctx) : { ok: false, notes: [] };
      return { match: aOk && rOk && pOk && ce.ok, aOk: aOk, rOk: rOk, pOk: pOk, notes: ce.notes };
    }
    function evaluate(roleName, action, resource, sse, secure) {
      var role = s.roles[roleName], req = { action: action, resource: resource, roleArn: I10.roleArn(roleName),
        session: 'arn:aws:sts::' + ACCT + ':assumed-role/' + roleName + '/' + (roleName === 'beacon-worker' ? 'i-0a1b2c3d4e5f60789' : roleName + '-session'),
        ctx: { 'aws:PrincipalArn': I10.roleArn(roleName), 'aws:SecureTransport': secure === false ? 'false' : 'true' } };
      if (sse) req.ctx['s3:x-amz-server-side-encryption'] = sse;
      var sets = [{ kind: 'scp', label: 'SCP FullAWSAccess', doc: { Statement: [{ Effect: 'Allow', Action: '*', Resource: '*' }] } }];
      if (role.boundary) sets.push({ kind: 'boundary', label: 'permissions boundary ' + nameOf(role.boundary), doc: docOf(role.boundary) });
      role.attached.forEach(function (arn) { sets.push({ kind: 'identity', label: 'identity policy ' + nameOf(arn) + (s.policies[arn] ? ' ' + s.policies[arn].def : ''), doc: docOf(arn) }); });
      if (/^arn:aws:s3:::beacon-archive-lab(\/|$)/.test(resource)) { var bd = bucketDoc(); if (bd) sets.push({ kind: 'resource', label: 'bucket policy ' + I10.bucket, doc: bd }); }
      var trace = [], deny = null, allow = { scp: false, boundary: false, identity: false, resource: false };
      sets.forEach(function (set) {
        trace.push('  ' + set.label);
        arrOf(set.doc && set.doc.Statement).forEach(function (stmt, i) {
          var m = matchStmt(stmt, req, set.kind === 'resource');
          var sid = stmt.Sid || ('#' + (i + 1));
          var line = '    ' + S.pad(stmt.Effect + ' ' + sid, 34) + 'action ' + (m.aOk ? 'yes' : 'no ') + '  resource ' + (m.rOk ? 'yes' : 'no') + (set.kind === 'resource' ? '  principal ' + (m.pOk ? 'yes' : 'no') : '');
          trace.push(line + (m.match ? '  => MATCH' : ''));
          m.notes.forEach(function (n) { trace.push('        condition ' + n); });
          if (!m.aOk && stmt.Effect === 'Allow' && set.kind === 'identity') { /* nothing */ }
          if (m.aOk && !m.rOk) trace.push('        resource ' + JSON.stringify(stmt.Resource) + ' does not match ' + resource);
          if (m.match && stmt.Effect === 'Deny' && !deny) deny = { set: set, sid: sid };
          if (m.match && stmt.Effect === 'Allow') allow[set.kind] = true;
        });
      });
      var decision, why;
      if (deny) { decision = 'explicit'; why = 'EXPLICIT DENY (' + deny.set.label + ', statement ' + deny.sid + ')'; }
      else if (!allow.scp) { decision = 'implicit'; why = 'IMPLICIT DENY (no SCP allows ' + action + ')'; }
      else if (!allow.identity && !allow.resource) { decision = 'implicit-identity'; why = 'IMPLICIT DENY (no identity-based policy statement allows ' + action + ' on ' + resource + ')'; }
      else if (role.boundary && !allow.boundary) { decision = 'implicit-boundary'; why = 'IMPLICIT DENY (the permissions boundary does not allow ' + action + ')'; }
      else { decision = 'allow'; why = 'ALLOW'; }
      return { decision: decision, why: why, trace: trace, req: req, deny: deny };
    }
    function workerSse(w) {
      var env = S.readFile(w, '/etc/beacon/worker.env') || '', v2 = S.kvGet(env, 'ARCHIVE_SSE');
      return v2 && v2 !== 'none' ? v2 : null;
    }
    function deniedMsg(ev) {
      var base = 'User: ' + ev.req.session + ' is not authorized to perform: ' + ev.req.action + ' on resource: "' + ev.req.resource + '"';
      if (ev.decision === 'explicit') return base + ' with an explicit deny in a ' + (ev.deny.set.kind === 'resource' ? 'resource-based' : ev.deny.set.kind === 'boundary' ? 'permissions boundary' : ev.deny.set.kind === 'scp' ? 'service control' : 'identity-based') + ' policy';
      if (ev.decision === 'implicit-boundary') return base + ' because no permissions boundary allows the ' + ev.req.action + ' action';
      return base + ' because no identity-based policy allows the ' + ev.req.action + ' action';
    }
    /* what the worker actually sends: PutObject with its configured SSE, plus a KMS data key when SSE is aws:kms */
    function workerPut(w, key, sseOverride) {
      var sse = sseOverride !== undefined ? sseOverride : workerSse(w);
      var ev = evaluate('beacon-worker', 's3:PutObject', B10 + '/' + key, sse, true);
      if (ev.decision !== 'allow') return ev;
      if (sse === 'aws:kms') { var k = evaluate('beacon-worker', 'kms:GenerateDataKey', I10.keyArn, null, true); if (k.decision !== 'allow') return k; }
      return ev;
    }
    function broadDoc(doc) {
      return arrOf(doc && doc.Statement).some(function (x) {
        if (x.Effect !== 'Allow') return false;
        return arrOf(x.Action).some(function (a) { return a === '*' || /^s3:\*$/i.test(a); }) || arrOf(x.Resource).some(function (r) { return r === '*' || r === 'arn:aws:s3:::*' || r === 'arn:aws:s3:::*/*'; });
      });
    }
    function workerNarrow() {
      var r = s.roles['beacon-worker'];
      if (r.boundary !== I10.polArn('beacon-boundary')) return false;
      var bdoc = docOf(r.boundary);
      if (arrOf(bdoc && bdoc.Statement).some(function (x) { return x.Effect === 'Allow' && arrOf(x.Action).some(function (a) { return a === '*'; }); })) return false;
      return !r.attached.some(function (arn) { return broadDoc(docOf(arn)); });
    }
    function bucketGuards() {
      var a1 = evaluate('beacon-analyst', 's3:PutObject', B10 + '/records/x.json', 'aws:kms', true);
      var a2 = evaluate('beacon-ingest', 's3:PutObject', B10 + '/incoming/x.json', null, true);
      return a1.decision === 'explicit' && a1.deny.set.kind === 'resource' && a2.decision === 'explicit' && a2.deny.set.kind === 'resource';
    }
    function fixed(w) { return workerPut(w, I10.obj).decision === 'allow' && workerNarrow() && bucketGuards(); }
    s.api = { fixed: fixed, workerNarrow: workerNarrow, bucketGuards: bucketGuards, workerPut: workerPut };

    function roleJson(n) {
      var r = s.roles[n], o = { Path: '/', RoleName: n, RoleId: r.id, Arn: I10.roleArn(n), CreateDate: '2026-03-02T10:14:00+00:00',
        AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'ec2.amazonaws.com' }, Action: 'sts:AssumeRole' }] }, MaxSessionDuration: 3600 };
      if (r.boundary) o.PermissionsBoundary = { PermissionsBoundaryType: 'Policy', PermissionsBoundaryArn: r.boundary };
      return { Role: o };
    }
    function parseDoc(text) {
      try { var d = JSON.parse(text); if (!d || typeof d !== 'object' || !d.Statement) return null; return d; } catch (e) { return null; }
    }
    function roleArg(x) {
      if (!x) return 'beacon-worker';
      var m = /^arn:aws:(?:iam::\d+:role\/(?:.*\/)?|sts::\d+:assumed-role\/)([A-Za-z0-9+=,.@_-]+)/.exec(x);
      var n = m ? m[1] : x.replace(/^role\//, '');
      if (/^(worker|ingest|analyst)$/.test(n)) n = 'beacon-' + n;
      return s.roles[n] ? n : null;
    }
    function logLine(w, line) { S.writeFile(w, '/var/log/beacon/worker.log', (S.readFile(w, '/var/log/beacon/worker.log') || '') + S.stamp(s) + ' ' + line + '\n'); }

    function awsVerb(w, a0) {
      var a = stripGlobal(a0), svc = a[0], op = a[1], r = a.slice(2);
      if (svc === 'sts' && op === 'get-caller-identity') return awsOut(r, { UserId: 'AROAEXAMPLELAB0WORKER:i-0a1b2c3d4e5f60789', Account: ACCT, Arn: I10.session });
      if (svc === 'iam') {
        var rn = argVal(r, '--role-name'), parn = argVal(r, '--policy-arn');
        var needRole = ['get-role', 'list-attached-role-policies', 'list-role-policies', 'attach-role-policy', 'detach-role-policy', 'put-role-permissions-boundary', 'delete-role-permissions-boundary'].indexOf(op) !== -1;
        var needPol = ['get-policy', 'list-policy-versions', 'get-policy-version', 'create-policy-version', 'set-default-policy-version'].indexOf(op) !== -1;
        if (needRole && !s.roles[rn]) return awsErr(op, 'NoSuchEntity', 'The role with name ' + rn + ' cannot be found.');
        if (needPol && !s.policies[parn] && !(op === 'get-policy' && AWS_MANAGED[parn])) return awsErr(op, 'NoSuchEntity', 'Policy ' + parn + ' does not exist or is not attachable' + (AWS_MANAGED[parn] ? ' (AWS managed policy versions are not modelled here)' : '') + '.');
        switch (op) {
          case 'get-role': return awsOut(r, roleJson(rn));
          case 'list-roles': return awsOut(r, { Roles: Object.keys(s.roles).map(function (n) { return roleJson(n).Role; }) });
          case 'list-attached-role-policies': return awsOut(r, { AttachedPolicies: s.roles[rn].attached.map(function (x) { return { PolicyName: nameOf(x), PolicyArn: x }; }) });
          case 'list-role-policies': return awsOut(r, { PolicyNames: [] });
          case 'get-policy': {
            if (AWS_MANAGED[parn]) return awsOut(r, { Policy: { PolicyName: AWS_MANAGED[parn].name, Arn: parn, DefaultVersionId: 'v1', IsAttachable: true } });
            var p = s.policies[parn];
            return awsOut(r, { Policy: { PolicyName: p.name, PolicyId: 'ANPAEXAMPLE' + hex(parn, 10).toUpperCase(), Arn: parn, Path: '/', DefaultVersionId: p.def, AttachmentCount: 1, PermissionsBoundaryUsageCount: p.name === 'beacon-boundary' ? 1 : 0, IsAttachable: true, UpdateDate: '2026-10-12T16:20:00+00:00' } });
          }
          case 'list-policy-versions': return awsOut(r, { Versions: s.policies[parn].versions.slice().reverse().map(function (x) { return { VersionId: x.id, IsDefaultVersion: x.id === s.policies[parn].def, CreateDate: x.created }; }) });
          case 'get-policy-version': {
            var vid = argVal(r, '--version-id'), pv = s.policies[parn].versions.filter(function (x) { return x.id === vid; })[0];
            if (!pv) return awsErr('GetPolicyVersion', 'NoSuchEntity', 'Policy ' + parn + ' version ' + vid + ' does not exist or is not attachable.');
            return awsOut(r, { PolicyVersion: { Document: JSON.parse(JSON.stringify(pv.doc)), VersionId: pv.id, IsDefaultVersion: pv.id === s.policies[parn].def, CreateDate: pv.created } });
          }
          case 'create-policy-version': {
            var fa = fileArg(w, argVal(r, '--policy-document'));
            if (!fa) return S.err('aws iam create-policy-version: --policy-document is required', 252);
            if (fa.missing) return S.err('\nError parsing parameter \'--policy-document\': Unable to load paramfile file://' + fa.missing + ': [Errno 2] No such file or directory', 252);
            var d = parseDoc(fa.text);
            if (!d) return awsErr('CreatePolicyVersion', 'MalformedPolicyDocument', 'Syntax errors in policy.');
            var P = s.policies[parn];
            if (P.versions.length >= 5) return awsErr('CreatePolicyVersion', 'LimitExceeded', 'A managed policy can have up to 5 versions. Before you create a new version, you must delete an existing version.');
            var nid = 'v' + (+P.versions[P.versions.length - 1].id.slice(1) + 1);
            P.versions.push({ id: nid, doc: d, created: S.stamp(s) });
            if (has(r, '--set-as-default')) P.def = nid;
            return awsOut(r, { PolicyVersion: { VersionId: nid, IsDefaultVersion: P.def === nid, CreateDate: S.stamp(s) } });
          }
          case 'set-default-policy-version': {
            var sv = argVal(r, '--version-id');
            if (!s.policies[parn].versions.some(function (x) { return x.id === sv; })) return awsErr('SetDefaultPolicyVersion', 'NoSuchEntity', 'Policy ' + parn + ' version ' + sv + ' does not exist.');
            s.policies[parn].def = sv; return S.ok('');
          }
          case 'attach-role-policy': case 'detach-role-policy': {
            var R = s.roles[rn];
            if (!s.policies[parn] && !AWS_MANAGED[parn]) return awsErr(op, 'NoSuchEntity', 'Policy ' + parn + ' does not exist or is not attachable.');
            if (op === 'attach-role-policy') { if (R.attached.indexOf(parn) === -1) R.attached.push(parn); }
            else R.attached = R.attached.filter(function (x) { return x !== parn; });
            return S.ok('');
          }
          case 'put-role-permissions-boundary': { var pb = argVal(r, '--permissions-boundary'); if (!s.policies[pb] && !AWS_MANAGED[pb]) return awsErr('PutRolePermissionsBoundary', 'NoSuchEntity', 'Policy ' + pb + ' does not exist.'); s.roles[rn].boundary = pb; return S.ok(''); }
          case 'delete-role-permissions-boundary': s.roles[rn].boundary = null; return S.ok('');
          case 'simulate-principal-policy': case 'simulate-custom-policy':
            return S.err('aws iam ' + op + ' is not modelled here. Use `iamsim explain` (a stand-in that also evaluates the bucket policy and boundary).', 2);
          default: return S.unsupported('aws iam', op || '', ['get-role', 'list-roles', 'list-attached-role-policies', 'list-role-policies', 'get-policy', 'list-policy-versions', 'get-policy-version', 'create-policy-version', 'set-default-policy-version', 'attach-/detach-role-policy', 'put-/delete-role-permissions-boundary']);
        }
      }
      if (svc === 's3api') {
        var bk = argVal(r, '--bucket');
        if (bk !== I10.bucket) return awsErr(op || '', 'NoSuchBucket', 'The specified bucket does not exist');
        if (op === 'get-bucket-policy') { if (!s.bucketPolicy) return awsErr('GetBucketPolicy', 'NoSuchBucketPolicy', 'The bucket policy does not exist'); return awsOut(r, { Policy: s.bucketPolicy }); }
        if (op === 'put-bucket-policy') {
          var pf = fileArg(w, argVal(r, '--policy'));
          if (!pf) return S.err('aws s3api put-bucket-policy: --policy is required', 252);
          if (pf.missing) return S.err('\nError parsing parameter \'--policy\': Unable to load paramfile file://' + pf.missing + ': [Errno 2] No such file or directory', 252);
          if (!parseDoc(pf.text)) return awsErr('PutBucketPolicy', 'MalformedPolicy', 'Policies must be valid JSON and the first byte must be \'{\'');
          s.bucketPolicy = JSON.stringify(JSON.parse(pf.text)); return S.ok('');
        }
        if (op === 'delete-bucket-policy') { s.bucketPolicy = null; return S.ok(''); }
        if (op === 'put-object') {
          var key = argVal(r, '--key'), body = argVal(r, '--body');
          if (body && S.readFile(w, body) == null) return S.err('\nError parsing parameter \'--body\': Blob values must be a path to a file.', 252);
          var ev = workerPut(w, key || 'x', argVal(r, '--server-side-encryption') || null);
          if (ev.decision !== 'allow') return awsErr('PutObject', 'AccessDenied', deniedMsg(ev));
          return awsOut(r, { ETag: '"' + hex(key + s.clock, 32) + '"', ServerSideEncryption: argVal(r, '--server-side-encryption') || 'AES256' });
        }
        return S.unsupported('aws s3api', op || '', ['get-bucket-policy', 'put-bucket-policy --policy file://F', 'delete-bucket-policy', 'put-object --bucket B --key K --body F [--server-side-encryption aws:kms]']);
      }
      if (svc === 's3' && op === 'cp') {
        var src = r[0], dst = r[1] || '', m = /^s3:\/\/([^\/]+)\/(.+)$/.exec(dst);
        if (!src || S.readFile(w, src) == null) return S.err('The user-provided path ' + (src || '') + ' does not exist.', 255);
        if (!m || m[1] !== I10.bucket) return S.err('aws s3 cp (simulation): only uploads to s3://' + I10.bucket + '/KEY are modelled', 252);
        var ev2 = workerPut(w, m[2], argVal(r, '--sse') || null);
        if (ev2.decision !== 'allow') return S.err('upload failed: ' + src + ' to ' + dst + ' An error occurred (AccessDenied) when calling the PutObject operation: ' + deniedMsg(ev2), 1);
        return S.ok('upload: ' + src + ' to ' + dst);
      }
      if (svc === 's3' && op === 'ls') {
        var ls = evaluate('beacon-worker', 's3:ListBucket', B10, null, true);
        if (ls.decision !== 'allow') return awsErr('ListObjectsV2', 'AccessDenied', deniedMsg(ls));
        return S.ok('                           PRE incoming/\n                           PRE records/');
      }
      return S.unsupported('aws', [svc, op].filter(Boolean).join(' '), ['sts get-caller-identity', 'iam get-role|list-attached-role-policies|get-policy|list-policy-versions|get-policy-version|create-policy-version|set-default-policy-version|attach-/detach-role-policy|put-/delete-role-permissions-boundary', 's3api get-/put-/delete-bucket-policy|put-object', 's3 cp|ls']);
    }
    var verbs = {
      aws: awsVerb,
      iamsim: function (w, a) {
        if (a[0] !== 'explain') return S.ok('iamsim is a SIMULATION stand-in for the IAM policy simulator: it evaluates the policies stored in this lab (SCP, permissions boundary, identity policies, bucket policy) for one request and prints the decision path.\nUsage: iamsim explain [--principal ROLE|ARN] [--action ACTION] [--resource ARN|KEY] [--sse aws:kms|AES256|none] [--secure-transport false]\nDefault request: what beacon-worker sends for ' + I10.obj + ' with its configured ARCHIVE_SSE.');
        var role = roleArg(argVal(a, '--principal'));
        if (!role) return S.err('iamsim: unknown principal ' + argVal(a, '--principal') + ' (roles here: ' + Object.keys(s.roles).join(', ') + ')', 2);
        var action = argVal(a, '--action') || 's3:PutObject', res = argVal(a, '--resource') || (B10 + '/' + I10.obj);
        if (!/^arn:/.test(res)) res = B10 + '/' + res.replace(/^\//, '');
        var sseArg = argVal(a, '--sse'), sse = sseArg == null ? (role === 'beacon-worker' ? workerSse(w) : 'aws:kms') : (sseArg === 'none' ? null : sseArg);
        var ev = evaluate(role, action, res, sse, argVal(a, '--secure-transport') !== 'false');
        var out = ['iamsim (simulation of IAM policy evaluation for one same-account request)', 'Request',
          '  principal (session)              ' + ev.req.session, '  aws:PrincipalArn                 ' + ev.req.roleArn, '  action                           ' + action, '  resource                         ' + res,
          '  s3:x-amz-server-side-encryption  ' + (sse || '(absent)'), '  aws:SecureTransport              ' + ev.req.ctx['aws:SecureTransport'], '',
          'Order: 1) any matching Deny anywhere decides; 2) the SCP must allow; 3) an identity (or resource) policy must allow; 4) the permissions boundary must allow.', 'Policies in scope:'].concat(ev.trace).concat(['', 'Decision: ' + ev.why]);
        s.explained.push({ role: role, decision: ev.decision });
        if (role !== 'beacon-worker' || !sse) { if (ev.decision === 'explicit' && fixed(w)) s.boundaryProved = true; }
        return S.ok(out.join('\n'));
      },
      beaconctl: function (w, a) {
        if (a[0] !== 'archive' || a[1] !== 'put-test') return S.ok('beaconctl (course CLI, simulated): beaconctl archive put-test — performs one archive upload exactly as the worker does (its role, its ARCHIVE_SSE setting).');
        s.probes++;
        var key = 'records/2026/10/13/probe-' + ('000' + s.probes).slice(-4) + '.json', sse = workerSse(w);
        var ev = workerPut(w, key);
        var head = 'PUT s3://' + I10.bucket + '/' + key + ' (as beacon-worker, SSE: ' + (sse || 'none requested') + ')';
        if (ev.decision !== 'allow') { logLine(w, 'ERROR archive upload ' + key + ' failed: AccessDenied: ' + deniedMsg(ev)); return { out: head + '\n', err: 'ERROR AccessDenied: ' + deniedMsg(ev) + '\n', code: 1 }; }
        logLine(w, 'archive upload ' + key + ' ok');
        return S.ok(head + '\nupload ok (ETag "' + hex(key, 32) + '"' + (sse === 'aws:kms' ? ', SSE-KMS alias/beacon-archive' : '') + ')');
      },
      edit: S.verbs.edit()
    };
    var envText = 'AWS_REGION=us-east-2\nARCHIVE_BUCKET=beacon-archive-lab\nARCHIVE_PREFIX=records/\n# server-side encryption requested on upload: aws:kms | AES256 | none\nARCHIVE_SSE=' + (v === 'a' ? 'none' : 'aws:kms') + '\nARCHIVE_KMS_KEY_ID=alias/beacon-archive\n';
    var world = { user: 'lab', host: 'beacon-worker-1', cwd: '/home/lab',
      dirs: [{ path: '/var/log/beacon' }, { path: '/etc/beacon' }],
      files: [
        { path: '/etc/beacon/worker.env', content: envText, owner: 'root', group: 'beacon', mode: '644' },
        { path: '/home/lab/probe.json', content: '{"probe": true}\n' },
        { path: '/home/lab/ACCESS.md', content: '# Beacon archive access (lab inventory)\n\nRole beacon-worker (instance profile on beacon-worker-1), permissions boundary beacon-boundary,\nmanaged policy beacon-worker-archive. Other writers: role beacon-ingest (incoming/). Analysts: role beacon-analyst.\nBucket beacon-archive-lab has a bucket policy owned by the security team; its deny statements protect the archive\nfor every principal, not just the worker. KMS key alias/beacon-archive.\n\nYour shell: default AWS credentials are the worker\'s instance-role session.\n' }
      ],
      sre: s, extra: S.bind(s, verbs) };
    /* the log the worker wrote this morning, derived from the same evaluator */
    var first = workerPut({ fs: {} }, 'records/2026/10/13/batch-0041.json', v === 'a' ? null : 'aws:kms');
    var logText = '2026-10-13T08:02:11Z beacon-worker 1.5.0 started (archive bucket beacon-archive-lab, prefix records/)\n' +
      ['0041', '0042'].map(function (n, i) { return '2026-10-13T08:0' + (2 + i * 5) + ':14Z ERROR archive upload records/2026/10/13/batch-' + n + '.json failed: AccessDenied: ' + deniedMsg(Object.assign({}, first, { req: Object.assign({}, first.req, { resource: B10 + '/records/2026/10/13/batch-' + n + '.json' }) })) + '\n2026-10-13T08:0' + (2 + i * 5) + ':14Z batch-' + n + ' kept in local spool /var/spool/beacon/archive (will retry)'; }).join('\n') + '\n';
    world.files.push({ path: '/var/log/beacon/worker.log', content: logText });
    return world;
  }
  var S10_POL = I10.polArn('beacon-worker-archive');
  var S10_PALETTE = ['beaconctl archive put-test', 'tail -n 5 /var/log/beacon/worker.log', 'aws sts get-caller-identity', 'aws iam get-role --role-name beacon-worker', 'aws iam list-attached-role-policies --role-name beacon-worker', 'aws iam get-policy --policy-arn ' + S10_POL, 'aws iam get-policy-version --policy-arn ' + S10_POL + ' --version-id v3', 'aws s3api get-bucket-policy --bucket beacon-archive-lab --query Policy --output text', 'iamsim explain', 'cat /etc/beacon/worker.env'];

  LX.missions.push({
    id: 'sre-s10', track: 'sre', cat: 'scenario', level: 'intermediate', mins: 30, kind: 'incident',
    title: 'Archive uploads from the Beacon worker are denied, and the role has an allow policy',
    brief: function () { return 'Every archive upload from the Beacon worker has failed with AccessDenied since this morning. The worker\'s role has a managed policy that allows writing to beacon-archive-lab, and the security team says the bucket\'s own policy "only blocks what it should". Find exactly which part of the evaluation denies the request, make the narrowest change that lets the worker write, and show the bucket\'s protections still hold for everyone else.'; },
    keys: S10_PALETTE,
    world: s10World,
    objectives: [
      { id: 'symptom', stage: 'evidence', text: 'Reproduce the denial exactly as the worker makes the request, and keep the full error text',
        hint: 'The error message says more than "AccessDenied" — read it to the end.', hint2: '`beaconctl archive put-test` (or the worker log) — note the principal, the action, the resource and how the message ends.',
        reveal: 'beaconctl archive put-test',
        done: function (c) { return saw(c, /beaconctl\s+archive\s+put-test|aws\s+s3\s+cp|aws\s+s3api\s+put-object|(cat|tail|grep|less)\b.*worker\.log/, /AccessDenied/); } },
      { id: 'principal', stage: 'evidence', text: 'Establish which principal is calling: the session, and the role (and boundary) behind it',
        hint: 'The policy is written about a role; the request is made by a session of it.', hint2: '`aws sts get-caller-identity` and `aws iam get-role --role-name beacon-worker`.',
        reveal: 'aws sts get-caller-identity && aws iam get-role --role-name beacon-worker',
        done: function (c) { return saw(c, /aws\s+sts\s+get-caller-identity/, /assumed-role\/beacon-worker/) && saw(c, /aws\s+iam\s+get-role\b/, /"Arn": "arn:aws:iam::\d+:role\/beacon-worker"/); } },
      { id: 'policies', stage: 'evidence', text: 'Read the policies that apply: the identity policy version in force and the bucket policy',
        hint: 'Two documents decide this request; read the live versions, not what someone remembers.', hint2: '`aws iam get-policy` (default version), `aws iam get-policy-version --version-id vN`, `aws s3api get-bucket-policy --bucket beacon-archive-lab --query Policy --output text`.',
        reveal: 'aws iam get-policy-version --policy-arn ' + S10_POL + ' --version-id v3 && aws s3api get-bucket-policy --bucket beacon-archive-lab --query Policy --output text',
        done: function (c) { return saw(c, /aws\s+iam\s+get-policy-version/, /"Statement"/) && saw(c, /aws\s+s3api\s+get-bucket-policy/, /Statement/); } },
      { id: 'decision', stage: 'evidence', text: 'Walk the evaluation for the worker\'s request and pin the decision to a statement, a non-matching element, or a condition',
        hint: 'Explicit deny first, then the allows, then the boundary.', hint2: '`iamsim explain` evaluates the worker\'s real request and prints which statement matched or why none did.',
        reveal: 'iamsim explain',
        done: function (c) { return saw(c, /iamsim\s+explain/, /Decision: /); } },
      { id: 'fix', stage: 'fix', text: 'Make the narrowest change that lets the worker\'s request through, without loosening any other principal\'s limits or the worker\'s own',
        hint: 'Change the element that is wrong for this request; do not remove a guard that protects something else.', hint2: 'Depending on what you found: the request (the worker\'s ARCHIVE_SSE), the principal named in the bucket policy\'s exception list, or the resource ARN in the identity policy.',
        reveal: function (c) { var v = st(c).variant;
          if (v === 'a') return 'edit /etc/beacon/worker.env ARCHIVE_SSE aws:kms';
          if (v === 'b') return 'aws s3api get-bucket-policy --bucket beacon-archive-lab --query Policy --output text > bucket-policy.json && sed -i \'s#arn:aws:sts::111122223333:assumed-role/beacon-worker/\\*#arn:aws:iam::111122223333:role/beacon-worker#\' bucket-policy.json && aws s3api put-bucket-policy --bucket beacon-archive-lab --policy file://bucket-policy.json';
          return 'aws iam get-policy-version --policy-arn ' + S10_POL + ' --version-id v3 --query PolicyVersion.Document > worker-archive.json && sed -i \'s#"Resource": "arn:aws:s3:::beacon-archive-lab"#"Resource": "arn:aws:s3:::beacon-archive-lab/records/*"#\' worker-archive.json && aws iam create-policy-version --policy-arn ' + S10_POL + ' --policy-document file://worker-archive.json --set-as-default'; },
        done: function (c) { return st(c).api.fixed(c.w); } },
      { id: 'verify', stage: 'verify', text: 'Repeat the worker\'s own upload and show it succeeds',
        hint: 'A manual upload with different flags is not the worker\'s request.', hint2: '`beaconctl archive put-test` — expect "upload ok".',
        reveal: 'beaconctl archive put-test',
        done: function (c) { return st(c).api.fixed(c.w) && lastIs(c, /beaconctl\s+archive\s+put-test/, /upload ok/); } },
      { id: 'boundary', stage: 'verify', text: 'After the change, show that a protection the bucket policy enforces for others still denies',
        hint: 'Prove the guard you did not remove still works.', hint2: '`iamsim explain --principal arn:aws:iam::111122223333:role/beacon-analyst` (another writer) or `iamsim explain --sse none` (an unencrypted upload) — expect an explicit deny.',
        reveal: 'iamsim explain --principal arn:aws:iam::111122223333:role/beacon-analyst',
        done: function (c) { return !!st(c).boundaryProved && st(c).api.fixed(c.w); } }
    ],
    sre: {
      scenarioId: 'S10', moduleId: 'M05', lab: 'L10', variants: ['a', 'b', 'c'],
      symptom: 'Every PutObject from the worker returns AccessDenied although its role policy allows s3:PutObject.',
      neutralTitle: 'Uploads denied although the role has an allow policy',
      neutralBrief: 'Since this morning every archive upload from the Beacon worker is denied, although its role has a policy allowing writes to the archive bucket. Find exactly which part of the evaluation denies the request, make the narrowest change that lets the worker write, and show the bucket\'s other protections still hold.',
      impact: 'Archive batches pile up in the worker\'s local spool; nothing reaches the archive.',
      changes: 'This week: worker 1.5.0 rolled out with a new env-file template, and the archive bucket policy and worker policy were tidied up.',
      spoilers: ['explicit deny', 'encryption', 'PrincipalArn', 'assumed-role', 'object ARN', 'condition', 'StringNotEquals', 'session ARN'],
      tools: ['beaconctl archive put-test (the worker\'s request)', 'aws sts / iam / s3api subset', 'iamsim explain (stand-in for the IAM policy simulator)', 'sed -i, edit, cat, tail'],
      grammar: ['`beaconctl archive put-test`', '`aws sts get-caller-identity`', '`aws iam get-role|list-attached-role-policies --role-name R`, `aws iam get-policy|list-policy-versions --policy-arn ARN`, `aws iam get-policy-version --policy-arn ARN --version-id vN [--query PolicyVersion.Document]`', '`aws iam create-policy-version --policy-arn ARN --policy-document file://F [--set-as-default]`, `set-default-policy-version`, `attach-/detach-role-policy`, `put-/delete-role-permissions-boundary`', '`aws s3api get-bucket-policy --bucket B [--query Policy --output text]`, `put-bucket-policy --bucket B --policy file://F`, `delete-bucket-policy`, `put-object …`; `aws s3 cp FILE s3://B/KEY [--sse aws:kms]`', '`iamsim explain [--principal ROLE|ARN] [--action A] [--resource ARN|KEY] [--sse aws:kms|AES256|none]`', '`edit /etc/beacon/worker.env KEY VALUE`, `sed -i`, `cat`, `tail`'],
      palette: S10_PALETTE,
      assumptions: ['Your shell is on the worker host; the AWS CLI\'s default credentials are the worker\'s instance-role session.', 'IAM and bucket-policy reads and edits are answered as if run with your platform-admin access (one shell for both, a simplification).', 'The bucket policy\'s deny statements exist for good reasons; the security team owns them.'],
      simplified: ['One account; the SCP is FullAWSAccess; the KMS key policy is assumed to delegate to IAM, so only the identity policy decides kms:GenerateDataKey.', 'Condition operators modelled: String(Not)Equals/Like, Arn(Not)Equals/Like, Bool, Null; IfExists, NotAction/NotResource/NotPrincipal and session policies are not.', 'AccessDenied messages follow the current S3 style for same-account requests (they name the policy type, not the statement).', 'Policy changes apply immediately; IAM is eventually consistent in AWS.', 'Every command advances a logical clock by 10 seconds.'],
      unsafe: [
        { label: 'broadened the worker\'s permissions', why: 'Allowing "*" actions or resources (or detaching the permissions boundary) does not get past an explicit deny, and where it "works" it gives the worker far more than one prefix in one bucket.',
          test: function (c) { return !st(c).api.workerNarrow(); },
          demo: ['printf \'{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"*","Resource":"*"}]}\' > wide.json', 'aws iam create-policy-version --policy-arn ' + S10_POL + ' --policy-document file://wide.json --set-as-default'] },
        { label: 'removed or loosened the bucket\'s guard for other principals', why: 'Deleting the bucket policy, a deny statement, or widening its exception list lets analysts write to the archive or unencrypted uploads through; those guards protect more than this worker.',
          test: function (c) { return !st(c).api.bucketGuards(); },
          demo: 'aws s3api delete-bucket-policy --bucket beacon-archive-lab' }
      ],
      alt: function (v) {
        if (v === 'a') return ['tail -n 5 /var/log/beacon/worker.log', 'aws sts get-caller-identity', 'aws iam get-role --role-name beacon-worker', 'aws iam list-attached-role-policies --role-name beacon-worker',
          'aws iam get-policy-version --policy-arn ' + S10_POL + ' --version-id v3', 'aws s3api get-bucket-policy --bucket beacon-archive-lab', 'iamsim explain --principal beacon-worker --sse none', 'cat /etc/beacon/worker.env',
          "sed -i 's/^ARCHIVE_SSE=.*/ARCHIVE_SSE=aws:kms/' /etc/beacon/worker.env", 'iamsim explain --sse none', 'beaconctl archive put-test'];
        if (v === 'b') return ['aws s3 cp probe.json s3://beacon-archive-lab/records/probe.json --sse aws:kms', 'aws sts get-caller-identity --query Arn --output text', 'aws iam get-role --role-name beacon-worker',
          'aws iam get-policy-version --policy-arn ' + S10_POL + ' --version-id v3 --query PolicyVersion.Document', 'aws s3api get-bucket-policy --bucket beacon-archive-lab --query Policy --output text', 'aws s3api get-bucket-policy --bucket beacon-archive-lab --query Policy --output text > bp.json',
          'iamsim explain --principal ' + I10.session, "sed -i 's#\"arn:aws:sts::111122223333:assumed-role/beacon-worker/\\*\"#\"arn:aws:iam::111122223333:role/beacon-worker\"#' bp.json",
          'aws s3api put-bucket-policy --bucket beacon-archive-lab --policy file://bp.json', 'iamsim explain --principal beacon-ingest --resource incoming/x.json --sse none', 'beaconctl archive put-test'];
        return ['beaconctl archive put-test', 'aws sts get-caller-identity', 'aws iam get-role --role-name beacon-worker', 'aws iam get-policy --policy-arn ' + S10_POL, 'aws iam list-policy-versions --policy-arn ' + S10_POL,
          'aws iam get-policy-version --policy-arn ' + S10_POL + ' --version-id v3', 'aws iam get-policy-version --policy-arn ' + S10_POL + ' --version-id v2', 'aws s3api get-bucket-policy --bucket beacon-archive-lab --query Policy --output text',
          'iamsim explain --action s3:PutObject --resource ' + I10.obj, 'aws iam set-default-policy-version --policy-arn ' + S10_POL + ' --version-id v2', 'iamsim explain --principal beacon-analyst', 'beaconctl archive put-test'];
      },
      mechanism: 'IAM evaluates a request in a fixed order: **any matching explicit Deny anywhere wins**; otherwise the SCP must allow, an identity (or resource) policy must allow, and the permissions boundary must allow — anything not allowed is an implicit deny. The three variants fail at different steps. (a) The bucket policy denies PutObject unless the request carries `s3:x-amz-server-side-encryption = aws:kms`; worker 1.5.0\'s env template set `ARCHIVE_SSE=none`, so the header was absent and the negated condition (StringNotEquals with a missing key) evaluated true — the bucket encrypts by default, but the policy checks the request. The fix is the request, not the deny. (b) The bucket policy\'s "only pipeline roles may write" deny lists the worker by its **session** ARN (`arn:aws:sts::…:assumed-role/beacon-worker/*`), but `aws:PrincipalArn` for a role session is the **role** ARN, so the exception never matched; replace that entry with the role ARN. (c) The tidy-up in policy v3 wrote the PutObject resource as the **bucket** ARN; object actions match object ARNs (`bucket/records/*`), so no identity statement allowed the request — an implicit deny; restore the object ARN (or roll back to v2). In every case the guards protecting others stay.',
      alternatives: [
        { h: 'The role has no allow at all', out: 'Ruled out by get-policy-version: there is an allow for s3:PutObject; the question is whether it matches this request.' },
        { h: 'KMS is denying', out: 'Ruled out: the message names s3:PutObject, and iamsim shows the KMS allow in the identity policy.' },
        { h: 'Delete the bucket policy / add Action "*"', out: 'Rejected: an explicit deny beats any allow, and removing the deny opens the archive to other writers and unencrypted uploads.' }
      ],
      clues: ['"with an explicit deny in a resource-based policy" and "because no identity-based policy allows" point at different steps of the evaluation.', 'ReadArchive in the identity policy is unrelated to the failing write.'],
      passRubric: ['States the evaluation order and where this request stopped', 'Names the exact element (condition key, principal ARN form, resource ARN) and why it did not match', 'Explains why the chosen change is narrower than the alternatives and what it preserves', 'Verifies the worker\'s own request and that another principal or unencrypted upload is still denied'],
      prereqs: ['les-m05-02'], refs: ['T18']
    }
  });

  /* ═══ Terraform model shared by S11 and S12 ═════════════════════════
     A bounded HCL subset (blocks, labels, key = value with nested braces and
     brackets, comments) parsed from the .tf files on disk, diffed against a
     state whose attributes are stored as the raw HCL values that produced
     them. Replacement is decided per resource type by a fixed ForceNew list. */
  var TF_FORCE_NEW = {
    aws_db_instance: ['identifier', 'engine', 'availability_zone', 'storage_encrypted', 'kms_key_id', 'username', 'db_subnet_group_name'],
    aws_s3_bucket: ['bucket']
  };
  var TF_META = ['lifecycle', 'depends_on', 'provider', 'count', 'for_each'];
  function hclParse(text) {
    var i = 0, n = text.length, line = 1;
    function fail(msg) { var e = new Error(msg); e.line = line; throw e; }
    function ws(nl) {
      while (i < n) {
        var ch = text.charAt(i);
        if (ch === '\n') { if (!nl) return; line++; i++; continue; }
        if (ch === ' ' || ch === '\t' || ch === '\r') { i++; continue; }
        if (ch === '#' || (ch === '/' && text.charAt(i + 1) === '/')) { while (i < n && text.charAt(i) !== '\n') i++; continue; }
        if (ch === '/' && text.charAt(i + 1) === '*') { var e = text.indexOf('*/', i + 2); if (e === -1) fail('Unterminated comment'); line += (text.slice(i, e).match(/\n/g) || []).length; i = e + 2; continue; }
        return;
      }
    }
    function ident() { var m = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(text.slice(i, i + 200)); if (!m) return null; i += m[0].length; return m[0]; }
    function str() {
      var s0 = i; i++;
      while (i < n && text.charAt(i) !== '"') { if (text.charAt(i) === '\\') i++; if (text.charAt(i) === '\n') fail('Unterminated template string'); i++; }
      if (i >= n) fail('Unterminated template string');
      i++; return text.slice(s0 + 1, i - 1);
    }
    function value() {
      var s0 = i, depth = 0, start = line;
      while (i < n) {
        var ch = text.charAt(i);
        if (ch === '"') { str(); continue; }
        if (ch === '#' || (ch === '/' && text.charAt(i + 1) === '/')) { if (depth === 0) break; while (i < n && text.charAt(i) !== '\n') i++; continue; }
        if (ch === '{' || ch === '[' || ch === '(') depth++;
        else if (ch === '}' || ch === ']' || ch === ')') { if (depth === 0) break; depth--; }
        else if (ch === '\n') { if (depth === 0) break; line++; }
        i++;
      }
      if (depth > 0) { line = start; fail('Unclosed bracket in the value starting on this line'); }
      var raw = text.slice(s0, i).trim();
      if (!raw) fail('Invalid expression: expected the start of an expression');
      return raw;
    }
    function body(top) {
      var b = { attrs: {}, order: [], blocks: [], lines: {} };
      for (;;) {
        ws(true);
        if (i >= n) { if (top) return b; fail('Unclosed configuration block: there is no closing brace for a block opened earlier'); }
        if (text.charAt(i) === '}') { if (top) fail('Argument or block definition required (unexpected "}")'); i++; return b; }
        var at = line, name = ident();
        if (!name) fail('Argument or block definition required');
        ws(false);
        if (text.charAt(i) === '=' && text.charAt(i + 1) !== '=') {
          i++; ws(false);
          var raw = value();
          if (Object.prototype.hasOwnProperty.call(b.attrs, name)) fail('Attribute redefined: the argument "' + name + '" was already set');
          b.attrs[name] = raw; b.order.push(name); b.lines[name] = at;
          continue;
        }
        var labels = [];
        while (text.charAt(i) === '"' || /[A-Za-z_]/.test(text.charAt(i))) { labels.push(text.charAt(i) === '"' ? str() : ident()); ws(false); }
        if (text.charAt(i) !== '{') fail('Invalid block definition: a block definition must have block content delimited by "{" and "}"');
        i++;
        b.blocks.push({ type: name, labels: labels, body: body(false), line: at });
      }
    }
    try { return { root: body(true) }; } catch (e) { return { error: { msg: e.message, line: e.line } }; }
  }
  function tfMapPairs(raw) {
    var out = {}, re = /"?([A-Za-z0-9_-]+)"?\s*=\s*("[^"]*"|[^\s,}]+)/g, m;
    String(raw).replace(/^\{|\}$/g, '').replace(re, function (all, k, v) { out[k] = v; return all; });
    return out;
  }
  function tfNorm(raw) {
    raw = String(raw).trim();
    if (raw.charAt(0) === '{') { var p = tfMapPairs(raw); return '{' + Object.keys(p).sort().map(function (k) { return k + '=' + p[k]; }).join(',') + '}'; }
    return raw.replace(/\s+/g, ' ').replace(/\s*([\[\],=])\s*/g, '$1');
  }
  function tfBox(title, lines) { return '╷\n│ Error: ' + title + '\n│\n' + lines.map(function (l) { return '│ ' + l; }).join('\n') + '\n╵'; }

  /* opts: { dir, state, lock, lockOwnerActive(st), onUnlock(st, w, how) } */
  function makeTf(s) {
    var S = SIM();
    function config(w) {
      var dir = s.tf.dir, files = LXShell.children(w, dir).filter(function (p) { return /\.tf$/.test(p) && LXShell.node(w, p).t === 'f'; });
      var res = {}, moved = [], errors = [];
      if (!files.length) errors.push(tfBox('No configuration files', ['Apply requires configuration to be present. The directory ' + dir + ' has no .tf files.']));
      files.forEach(function (p) {
        var fname = p.slice(p.lastIndexOf('/') + 1), text = S.readFile(w, p) || '', parsed = hclParse(text);
        if (parsed.error) { errors.push(tfBox(parsed.error.msg.split(':')[0], ['', '  on ' + fname + ' line ' + parsed.error.line + ':', '', parsed.error.msg])); return; }
        parsed.root.blocks.forEach(function (b) {
          if (b.type === 'resource' && b.labels.length === 2) {
            var addr = b.labels[0] + '.' + b.labels[1];
            if (res[addr]) { errors.push(tfBox('Duplicate resource "' + b.labels[0] + '" configuration', ['', '  on ' + fname + ' line ' + b.line + ':', '', 'A ' + b.labels[0] + ' resource named "' + b.labels[1] + '" was already declared at ' + res[addr].file + ':' + res[addr].line + '.'])); return; }
            var lc = b.body.blocks.filter(function (x) { return x.type === 'lifecycle'; })[0];
            var ign = lc && lc.body.attrs.ignore_changes ? lc.body.attrs.ignore_changes.replace(/[\[\]\s]/g, '').split(',').filter(Boolean) : [];
            res[addr] = { addr: addr, type: b.labels[0], name: b.labels[1], attrs: b.body.attrs, order: b.body.order, blocks: b.body.blocks, file: fname, line: b.line,
              prevent: !!(lc && /^true$/.test(String(lc.body.attrs.prevent_destroy || '').trim())), ignore: ign };
          } else if (b.type === 'moved') {
            moved.push({ from: String(b.body.attrs.from || '').trim(), to: String(b.body.attrs.to || '').trim(), file: fname, line: b.line });
          }
        });
      });
      return { res: res, moved: moved, errors: errors };
    }
    function stateRes() { return s.tf.stateDeleted ? {} : s.tf.state.resources; }
    function plan(w) {
      var cfg = config(w), errors = cfg.errors.slice(), actions = [], moves = [];
      if (errors.length) return { errors: errors, actions: [], moves: [] };
      var state = {};
      Object.keys(stateRes()).forEach(function (k) { state[k] = stateRes()[k]; });
      cfg.moved.forEach(function (m) {
        if (cfg.res[m.from]) { errors.push(tfBox('Moved object still exists', ['', '  on ' + m.file + ' line ' + m.line + ':', '', 'This statement declares a move from ' + m.from + ', but that resource is still declared in the configuration.'])); return; }
        if (state[m.from] && !state[m.to]) { state[m.to] = state[m.from]; delete state[m.from]; moves.push(m); }
      });
      Object.keys(cfg.res).sort().forEach(function (addr) {
        var r = cfg.res[addr], cur = state[addr], mv = moves.filter(function (x) { return x.to === addr; })[0];
        if (!cur) { actions.push({ addr: addr, kind: 'create', type: r.type, name: r.name, cfg: r }); return; }
        var changes = [];
        r.order.forEach(function (k) {
          if (TF_META.indexOf(k) !== -1 || r.ignore.indexOf(k) !== -1) return;
          var from = cur.attrs[k], to = r.attrs[k];
          if (from != null && tfNorm(from) === tfNorm(to)) return;
          changes.push({ k: k, from: from == null ? 'null' : from, to: to, force: (TF_FORCE_NEW[r.type] || []).indexOf(k) !== -1 });
        });
        var kind = changes.some(function (x) { return x.force; }) ? 'replace' : changes.length ? 'update' : 'noop';
        actions.push({ addr: addr, kind: kind, type: r.type, name: r.name, cfg: r, cur: cur, changes: changes, moved: mv ? mv.from : null });
        if (kind === 'replace' && r.prevent) errors.push(tfBox('Instance cannot be destroyed', ['', '  on ' + r.file + ' line ' + r.line + ':', '  ' + r.line + ': resource "' + r.type + '" "' + r.name + '" {', '', 'Resource ' + addr + ' has lifecycle.prevent_destroy set, but the plan calls for', 'this resource to be destroyed. To avoid this error and continue with the', 'plan, either disable lifecycle.prevent_destroy or reduce the scope of the', 'plan using the -target option.']));
      });
      Object.keys(state).sort().forEach(function (addr) { if (!cfg.res[addr]) actions.push({ addr: addr, kind: 'delete', type: state[addr].type, name: state[addr].name, cur: state[addr] }); });
      actions.sort(function (x, y) { return x.addr < y.addr ? -1 : x.addr > y.addr ? 1 : 0; });
      return { errors: errors, actions: actions, moves: moves };
    }
    function counts(p) {
      var c = { add: 0, change: 0, destroy: 0 };
      p.actions.forEach(function (a) { if (a.kind === 'create') c.add++; if (a.kind === 'update') c.change++; if (a.kind === 'delete') c.destroy++; if (a.kind === 'replace') { c.add++; c.destroy++; } });
      return c;
    }
    function changed(p) { return p.actions.some(function (a) { return a.kind !== 'noop'; }) || p.moves.length > 0; }
    function computedOf(type, cur) {
      if (type === 'aws_db_instance') return ['address', 'arn', 'endpoint', 'id', 'resource_id'].map(function (k) { return [k, cur ? cur.computed[k] : null]; });
      return ['arn', 'bucket_domain_name', 'id'].map(function (k) { return [k, cur ? cur.computed[k] : null]; });
    }
    function renderAttrs(sym, pairs) {
      var wdt = pairs.reduce(function (m, p) { return Math.max(m, p[0].length); }, 0);
      return pairs.map(function (p) { return '      ' + sym + ' ' + S.pad(p[0], wdt) + ' = ' + p[1]; }).join('\n');
    }
    function renderMapChange(k, from, to, wdt) {
      var a = tfMapPairs(from), b = tfMapPairs(to), lines = ['      ~ ' + S.pad(k, wdt) + ' = {'], same = 0;
      Object.keys(b).sort().forEach(function (x) { if (a[x] == null) lines.push('          + "' + x + '" = ' + b[x]); else if (a[x] !== b[x]) lines.push('          ~ "' + x + '" = ' + a[x] + ' -> ' + b[x]); else same++; });
      Object.keys(a).sort().forEach(function (x) { if (b[x] == null) lines.push('          - "' + x + '" = ' + a[x] + ' -> null'); });
      if (same) lines.push('            # (' + same + ' unchanged element' + (same === 1 ? '' : 's') + ' hidden)');
      lines.push('        }');
      return lines.join('\n');
    }
    function renderPlan(p) {
      var out = [];
      Object.keys(stateRes()).sort().forEach(function (addr) { out.push(addr + ': Refreshing state... [id=' + stateRes()[addr].id + ']'); });
      if (p.errors.length) { out.push(''); return out.concat(p.errors).join('\n'); }
      if (!changed(p)) return out.concat(['', 'No changes. Your infrastructure matches the configuration.', '', 'Terraform has compared your real infrastructure against your configuration', 'and found no differences, so no changes are needed.']).join('\n');
      var kinds = p.actions.map(function (a) { return a.kind; });
      out.push('', 'Terraform used the selected providers to generate the following execution', 'plan. Resource actions are indicated with the following symbols:');
      if (kinds.indexOf('create') !== -1) out.push('  + create');
      if (kinds.indexOf('update') !== -1) out.push('  ~ update in-place');
      if (kinds.indexOf('delete') !== -1) out.push('  - destroy');
      if (kinds.indexOf('replace') !== -1) out.push('-/+ destroy and then create replacement');
      out.push('', 'Terraform will perform the following actions:');
      p.actions.forEach(function (a) {
        var head = 'resource "' + a.type + '" "' + a.name + '" {';
        if (a.kind === 'create') {
          var cp = a.cfg.order.filter(function (k) { return TF_META.indexOf(k) === -1; }).map(function (k) { return [k, a.cfg.attrs[k].charAt(0) === '{' ? '{ ' + Object.keys(tfMapPairs(a.cfg.attrs[k])).sort().map(function (x) { return '"' + x + '" = ' + tfMapPairs(a.cfg.attrs[k])[x]; }).join(', ') + ' }' : a.cfg.attrs[k]]; })
            .concat(computedOf(a.type).map(function (x) { return [x[0], '(known after apply)']; }));
          out.push('', '  # ' + a.addr + ' will be created', '  + ' + head, renderAttrs('+', cp), '    }');
        } else if (a.kind === 'delete') {
          var dp = Object.keys(a.cur.attrs).map(function (k) { return [k, (a.cur.attrs[k].charAt(0) === '{' ? '{...}' : a.cur.attrs[k]) + ' -> null']; });
          out.push('', '  # ' + a.addr + ' will be destroyed', '  # (because ' + a.addr + ' is not in configuration)', '  - ' + head, renderAttrs('-', dp), '    }');
        } else if (a.kind === 'noop' && a.moved) {
          out.push('', '  # ' + a.moved + ' has moved to ' + a.addr, '    ' + head, '        id = "' + a.cur.id + '"', '        # (' + (Object.keys(a.cur.attrs).length + 4) + ' unchanged attributes hidden)', '    }');
        } else if (a.kind === 'update' || a.kind === 'replace') {
          var wdt = a.changes.reduce(function (m, x) { return Math.max(m, x.k.length); }, a.kind === 'replace' ? 11 : 2);
          var lines = [];
          if (a.kind === 'update') lines.push('        ' + S.pad('id', wdt) + ' = "' + a.cur.id + '"');
          a.changes.forEach(function (x) {
            if (String(x.to).charAt(0) === '{') lines.push(renderMapChange(x.k, x.from, x.to, wdt));
            else lines.push('      ~ ' + S.pad(x.k, wdt) + ' = ' + x.from + ' -> ' + x.to + (x.force && a.kind === 'replace' ? ' # forces replacement' : ''));
          });
          if (a.kind === 'replace') computedOf(a.type, a.cur).forEach(function (c2) { lines.push('      ~ ' + S.pad(c2[0], wdt) + ' = ' + c2[1] + ' -> (known after apply)'); });
          var hidden = Object.keys(a.cur.attrs).length - a.changes.length + (a.kind === 'replace' ? 0 : 4);
          lines.push('        # (' + hidden + ' unchanged attributes hidden)');
          out.push('', '  # ' + a.addr + (a.kind === 'replace' ? ' must be replaced' : ' will be updated in-place') + (a.moved ? '\n  # (moved from ' + a.moved + ')' : ''), (a.kind === 'replace' ? '-/+ ' : '  ~ ') + head, lines.join('\n'), '    }');
        }
      });
      var c = counts(p);
      out.push('', 'Plan: ' + c.add + ' to add, ' + c.change + ' to change, ' + c.destroy + ' to destroy.');
      return out.join('\n');
    }
    function newId(type, cfg) {
      s.tf.idN = (s.tf.idN || 0) + 1;
      return type === 'aws_db_instance' ? 'db-' + hex('newdb' + s.tf.idN, 26).toUpperCase() : String(cfg.attrs.bucket || '"x"').replace(/"/g, '');
    }
    function computedFor(type, attrs, id) {
      if (type === 'aws_db_instance') {
        var ident = String(attrs.identifier || '"db"').replace(/"/g, '');
        return { address: '"' + ident + '.cx7lab2qk9ab.us-east-2.rds.amazonaws.com"', arn: '"arn:aws:rds:us-east-2:' + ACCT + ':db:' + ident + '"', endpoint: '"' + ident + '.cx7lab2qk9ab.us-east-2.rds.amazonaws.com:5432"', id: '"' + id + '"', resource_id: '"' + id + '"' };
      }
      return { arn: '"arn:aws:s3:::' + id + '"', bucket_domain_name: '"' + id + '.s3.amazonaws.com"', id: '"' + id + '"' };
    }
    function attrsOf(cfg) { var o = {}; cfg.order.forEach(function (k) { if (TF_META.indexOf(k) === -1) o[k] = cfg.attrs[k]; }); return o; }
    function execute(p) {
      var out = [], c = { add: 0, change: 0, destroy: 0 }, R = s.tf.state.resources;
      if (s.tf.stateDeleted) { R = s.tf.state.resources = {}; s.tf.stateDeleted = false; }
      p.moves.forEach(function (m) { if (R[m.from] && !R[m.to]) { R[m.to] = R[m.from]; R[m.to].name = m.to.split('.')[1]; delete R[m.from]; } });
      p.actions.forEach(function (a) {
        if (a.kind === 'delete' || a.kind === 'replace') {
          var oldAddr = a.kind === 'delete' ? a.addr : a.addr, old = R[oldAddr];
          out.push(oldAddr + ': Destroying... [id=' + (old ? old.id : '?') + ']', oldAddr + ': Destruction complete after ' + (a.type === 'aws_db_instance' ? '5m12s' : '2s'));
          if (a.type === 'aws_db_instance') { s.tf.dataLost = true; s.tf.dbRecords = 0; }
          delete R[oldAddr]; c.destroy++;
        }
        if (a.kind === 'create' || a.kind === 'replace') {
          var id = newId(a.type, a.cfg), at = attrsOf(a.cfg);
          out.push(a.addr + ': Creating...', a.addr + ': Creation complete after ' + (a.type === 'aws_db_instance' ? '6m48s' : '3s') + ' [id=' + id + ']');
          R[a.addr] = { type: a.type, name: a.name, id: id, attrs: at, computed: computedFor(a.type, at, id), created: S.stamp(s) };
          c.add++;
        }
        if (a.kind === 'update') {
          out.push(a.addr + ': Modifying... [id=' + a.cur.id + ']', a.addr + ': Modifications complete after ' + (a.type === 'aws_db_instance' ? '41s' : '1s') + ' [id=' + a.cur.id + ']');
          a.changes.forEach(function (x) { R[a.addr].attrs[x.k] = x.to; });
          c.change++;
        }
      });
      s.tf.state.serial++; s.tf.stateModified = S.stamp(s);
      out.push('', 'Apply complete! Resources: ' + c.add + ' added, ' + c.change + ' changed, ' + c.destroy + ' destroyed.');
      return out.join('\n');
    }
    function lockErr() {
      var L = s.tf.lock;
      return tfBox('Error acquiring the state lock', ['', 'Error message: operation error S3: PutObject, https response error', 'StatusCode: 412, RequestID: LAB0REQ412000001, HostID: lab-host-id, api error', 'PreconditionFailed: At least one of the pre-conditions you specified did', 'not hold', 'Lock Info:', '  ID:        ' + L.ID, '  Path:      ' + L.Path, '  Operation: ' + L.Operation, '  Who:       ' + L.Who, '  Version:   ' + L.Version, '  Created:   ' + L.Created.replace('T', ' ').replace('Z', ' +0000 UTC'), '  Info:      ' + L.Info, '', '', 'Terraform acquires a state lock to protect the state from being written', 'by multiple users at the same time. Please resolve the issue above and try', 'again. For most commands, you can disable locking with the "-lock=false"', 'flag, but this is not recommended.']);
    }
    function parseDur(x) { var m = /^(\d+)(s|m)?$/.exec(String(x || '')); return m ? (+m[1]) * (m[2] === 'm' ? 60 : 1) : 0; }
    function advance(w, secs) { for (var t = 0; t < secs; t += 10) { s.clock += 10; (s.hooks || []).forEach(function (h) { try { h(s, w); } catch (e) {} }); if (s.stopWaiting && s.stopWaiting()) break; } }
    /* returns null when the lock is (now) ours to take, or an error result */
    function acquire(w, fl) {
      if (fl.lock === 'false') { if (s.tf.lock && fl.write) s.tf.bypassedLock = true; return null; }
      if (!s.tf.lock) return null;
      var wait = parseDur(fl['lock-timeout']);
      if (wait) { s.stopWaiting = function () { return !s.tf.lock; }; advance(w, wait); s.stopWaiting = null; }
      return s.tf.lock ? lockErr() : null;
    }
    function tfFlags(a) {
      var f = {}, pos = [];
      a.forEach(function (t) {
        var m = /^--?([a-z-]+)(?:=(.*))?$/.exec(t);
        if (m && t.charAt(0) === '-') f[m[1]] = m[2] == null ? true : m[2]; else pos.push(t);
      });
      return { f: f, pos: pos };
    }
    function stateBlock(addr, r) {
      var all = {}; Object.keys(r.attrs).forEach(function (k) { all[k] = r.attrs[k]; }); Object.keys(r.computed).forEach(function (k) { all[k] = r.computed[k]; });
      var keys = Object.keys(all).sort(), wdt = keys.reduce(function (m, k) { return Math.max(m, k.length); }, 0);
      return '# ' + addr + ':\nresource "' + r.type + '" "' + r.name + '" {\n' + keys.map(function (k) {
        var v2 = all[k];
        if (String(v2).charAt(0) === '{') { var mp = tfMapPairs(v2); return '    ' + S.pad(k, wdt) + ' = {\n' + Object.keys(mp).sort().map(function (x) { return '        "' + x + '" = ' + mp[x]; }).join('\n') + '\n    }'; }
        return '    ' + S.pad(k, wdt) + ' = ' + v2;
      }).join('\n') + '\n}';
    }
    var LOCK_NOTE = function (body) { return 'Acquiring state lock. This may take a few moments...\n' + body + '\nReleasing state lock. This may take a few moments...'; };
    function verb(w, a0, stdin) {
      var a = a0.slice(), chdir = null;
      if (a[0] && /^-chdir=/.test(a[0])) { chdir = a.shift().slice(7); }
      var cwd = chdir ? LXShell.resolve(w, chdir) : w.cwd;
      var sub = a[0], fl = tfFlags(a.slice(1));
      if (!sub || sub === '-help' || sub === '--help') return S.ok('Usage: terraform [-chdir=DIR] <subcommand> (simulation)\n  init, validate, fmt, plan [-out=FILE] [-detailed-exitcode] [-lock=false] [-lock-timeout=DUR], apply [-auto-approve] [PLANFILE], show [PLANFILE],\n  state list|show ADDR|mv SRC DST, force-unlock [-force] LOCK_ID, version');
      if (sub === 'version' || sub === '-version' || sub === '--version') return S.ok('Terraform v1.13.3\non linux_arm64');
      if (cwd !== s.tf.dir) return S.err(tfBox('No configuration files', ['Plan requires configuration to be present. Planning without a configuration would', 'mark everything for destruction, which is normally not what is desired. (This', 'simulation\'s workspace is ' + s.tf.dir + ' — cd there or use -chdir.)']), 1);
      if (sub === 'init') return S.ok('Initializing the backend...\n\nSuccessfully configured the backend "s3"! Terraform will automatically\nuse this backend unless the backend configuration changes.\nInitializing provider plugins...\n- Reusing previous version of hashicorp/aws from the dependency lock file\n- Using previously-installed hashicorp/aws\n\nTerraform has been successfully initialized!');
      if (sub === 'fmt') return S.ok('');
      if (sub === 'validate') { var cv = config(w); return cv.errors.length ? S.err(cv.errors.join('\n'), 1) : S.ok('Success! The configuration is valid.'); }
      if (sub === 'plan') {
        var bad = Object.keys(fl.f).filter(function (k) { return ['out', 'detailed-exitcode', 'lock', 'lock-timeout', 'input', 'no-color', 'refresh'].indexOf(k) === -1; });
        if (bad.length) return S.err('terraform plan: option -' + bad[0] + ' is not modelled in this simulation (supported: -out, -detailed-exitcode, -lock, -lock-timeout, -input, -no-color)', 1);
        var le = acquire(w, { lock: fl.f.lock, 'lock-timeout': fl.f['lock-timeout'] });
        if (le) return S.err(le, 1);
        var p = plan(w), body = renderPlan(p), locked = fl.f.lock !== 'false';
        if (p.errors.length) return S.err(locked ? LOCK_NOTE(body) : body, 1);
        if (typeof fl.f.out === 'string') {
          s.tf.plans[LXShell.resolve(w, fl.f.out)] = { plan: JSON.parse(JSON.stringify({ actions: p.actions, moves: p.moves, errors: [] })), serial: s.tf.state.serial, text: body };
          S.writeFile(w, LXShell.resolve(w, fl.f.out), '(binary Terraform plan file in the real tool; inspect with: terraform show ' + fl.f.out + ')\n');
          body += '\n\n─────────────────────────────────────────────────────────────────────────────\n\nSaved the plan to: ' + fl.f.out + '\n\nTo perform exactly these actions, run the following command to apply:\n    terraform apply "' + fl.f.out + '"';
        } else if (changed(p)) body += '\n\n─────────────────────────────────────────────────────────────────────────────\n\nNote: You didn\'t use the -out option to save this plan, so Terraform can\'t\nguarantee to take exactly these actions if you run "terraform apply" now.';
        s.tf.lastPlan = { at: s.clock, counts: counts(p), changed: changed(p) };
        return { out: (locked ? LOCK_NOTE(body) : body) + '\n', code: fl.f['detailed-exitcode'] && changed(p) ? 2 : 0 };
      }
      if (sub === 'apply') {
        var bad2 = Object.keys(fl.f).filter(function (k) { return ['auto-approve', 'lock', 'lock-timeout', 'input', 'no-color'].indexOf(k) === -1; });
        if (bad2.length) return S.err('terraform apply: option -' + bad2[0] + ' is not modelled in this simulation (supported: -auto-approve, -lock, -lock-timeout, -input, PLANFILE)', 1);
        var le2 = acquire(w, { lock: fl.f.lock, 'lock-timeout': fl.f['lock-timeout'], write: true });
        if (le2) return S.err(le2, 1);
        var pf = fl.pos[0], p2, shown;
        if (pf) {
          var saved = s.tf.plans[LXShell.resolve(w, pf)];
          if (!saved) return S.err(tfBox('Failed to load "' + pf + '" as a plan file', ['', 'The file is not a plan this simulation saved (use terraform plan -out=' + pf + ').']), 1);
          if (saved.serial !== s.tf.state.serial) return S.err(tfBox('Saved plan is stale', ['', 'The given plan file can no longer be applied because the state was changed', 'by another operation after the plan was created.']), 1);
          p2 = JSON.parse(JSON.stringify(saved.plan)); shown = '';
        } else {
          p2 = plan(w); shown = renderPlan(p2) + '\n';
          if (p2.errors.length) return S.err(LOCK_NOTE(shown), 1);
          if (!changed(p2)) return S.ok(LOCK_NOTE(shown + '\nApply complete! Resources: 0 added, 0 changed, 0 destroyed.'));
          var yes = fl.f['auto-approve'] || /^\s*yes\s*$/m.test(stdin || '');
          if (!yes) return S.err(LOCK_NOTE(shown + '\nDo you want to perform these actions?\n  Terraform will perform the actions described above.\n  Only \'yes\' will be accepted to approve.\n\n  Enter a value: \n\nApply cancelled.'), 1);
        }
        return S.ok(LOCK_NOTE(shown + execute(p2)));
      }
      if (sub === 'show') {
        if (fl.pos[0]) { var sp = s.tf.plans[LXShell.resolve(w, fl.pos[0])]; if (!sp) return S.err(tfBox('Failed to read the given file as a state or plan file', ['', 'This simulation only reads plan files saved with terraform plan -out.']), 1); return S.ok(sp.text.replace(/^[^\n]*Refreshing state[^\n]*\n/mg, '')); }
        var R = stateRes(), ks = Object.keys(R).sort();
        return S.ok(ks.length ? ks.map(function (k) { return stateBlock(k, R[k]); }).join('\n\n') : 'The state file is empty. No resources are represented.');
      }
      if (sub === 'state') {
        var op = a[1], rest = tfFlags(a.slice(2)), R2 = stateRes();
        if (op === 'list') return S.ok(Object.keys(R2).sort().join('\n'));
        if (op === 'show') { var ad = rest.pos[0]; if (!R2[ad]) return S.err('No instance found for the given address!\n\nThis command requires that the address references one specific instance.\nTo view the available instances, use "terraform state list". Please modify\nthe address to reference a specific instance.', 1); return S.ok(stateBlock(ad, R2[ad])); }
        if (op === 'mv') {
          var src = rest.pos[0], dst = rest.pos[1];
          var le3 = acquire(w, { lock: rest.f.lock, 'lock-timeout': rest.f['lock-timeout'], write: true });
          if (le3) return S.err(le3, 1);
          if (!src || !dst) return S.err('Exactly two arguments expected.', 1);
          if (!R2[src]) return S.err(tfBox('Invalid source address', ['', 'Cannot move ' + src + ': does not match anything in the current state.']), 1);
          if (R2[dst]) return S.err(tfBox('Invalid target address', ['', 'Cannot move to ' + dst + ': there is already a resource instance at that address in the current state.']), 1);
          if (src.split('.')[0] !== dst.split('.')[0]) return S.err(tfBox('Invalid state move request', ['', 'Cannot move ' + src + ' to ' + dst + ': resource types do not match.']), 1);
          R2[dst] = R2[src]; R2[dst].name = dst.split('.')[1]; delete R2[src]; s.tf.state.serial++;
          return S.ok('Move "' + src + '" to "' + dst + '"\nSuccessfully moved 1 object(s).');
        }
        return S.unsupported('terraform state', op || '', ['list', 'show ADDR', 'mv SRC DST']);
      }
      if (sub === 'force-unlock') {
        var id = fl.pos[0];
        if (!id) return S.err('Expected a single argument: LOCK_ID', 1);
        if (!s.tf.lock) return S.err('Failed to unlock state: no lock found at s3://' + s.tf.bucket + '/' + s.tf.key + '.tflock', 1);
        if (id !== s.tf.lock.ID) return S.err('Failed to unlock state: lock ID "' + id + '" does not match existing lock ID "' + s.tf.lock.ID + '"', 1);
        if (!fl.f.force && !/^\s*yes\s*$/m.test(stdin || '')) return S.err('Do you really want to force-unlock?\n  Terraform will remove the lock on the remote state.\n  This will allow local Terraform commands to modify this state, even though it\n  may still be in use. Only \'yes\' will be accepted to confirm.\n\n  Enter a value: \n\nforce-unlock cancelled.', 1);
        if (s.tf.onUnlock) s.tf.onUnlock(w, 'force-unlock');
        s.tf.lock = null;
        return S.ok('Terraform state has been successfully unlocked!\n\nThe state has been unlocked, and Terraform commands should now be able to\nobtain a new lock on the remote state.');
      }
      if (sub === 'import') return S.err('terraform import is not modelled in this simulation (L12 practises it against real local resources).', 2);
      return S.unsupported('terraform', sub, ['init', 'validate', 'fmt', 'plan', 'apply', 'show', 'state list|show|mv', 'force-unlock', 'version']);
    }
    return { verb: verb, plan: plan, config: config, advance: advance, counts: counts };
  }
  /* the state a configuration text produces when applied */
  function tfStateFrom(text, ids) {
    var p = hclParse(text), res = {};
    p.root.blocks.forEach(function (b) {
      if (b.type !== 'resource') return;
      var attrs = {}; b.body.order.forEach(function (k) { if (TF_META.indexOf(k) === -1) attrs[k] = b.body.attrs[k]; });
      var id = ids[b.labels[0]], addr = b.labels[0] + '.' + b.labels[1];
      var ident = String(attrs.identifier || attrs.bucket || '').replace(/"/g, '');
      res[addr] = { type: b.labels[0], name: b.labels[1], id: id, attrs: attrs, created: '2025-03-02T10:14:00Z',
        computed: b.labels[0] === 'aws_db_instance'
          ? { address: '"' + ident + '.cx7lab2qk9ab.us-east-2.rds.amazonaws.com"', arn: '"arn:aws:rds:us-east-2:' + ACCT + ':db:' + ident + '"', endpoint: '"' + ident + '.cx7lab2qk9ab.us-east-2.rds.amazonaws.com:5432"', id: '"' + id + '"', resource_id: '"' + id + '"' }
          : { arn: '"arn:aws:s3:::' + ident + '"', bucket_domain_name: '"' + ident + '.s3.amazonaws.com"', id: '"' + ident + '"' } };
    });
    return res;
  }
  function tfDbBlock(o) {
    var rows = [['identifier', '"' + o.identifier + '"'], ['engine', '"postgres"'], ['engine_version', '"16.4"'], ['instance_class', '"' + (o.cls || 'db.t4g.micro') + '"'], ['allocated_storage', '20'],
      ['storage_encrypted', o.enc ? 'true' : 'false'], ['availability_zone', '"us-east-2a"'], ['db_subnet_group_name', '"beacon-private"'], ['username', '"beacon"'], ['manage_master_user_password', 'true'],
      ['backup_retention_period', String(o.ret || 7)], ['deletion_protection', 'false'], ['skip_final_snapshot', 'true']];
    var wdt = 27, tagRows = [['Service', '"beacon"'], ['Env', '"lab"']].concat(o.tags || []);
    var tw = tagRows.reduce(function (m, r) { return Math.max(m, r[0].length); }, 0);
    return 'resource "aws_db_instance" "' + (o.name || 'beacon') + '" {\n' + rows.map(function (r) { return '  ' + SIM().pad(r[0], wdt) + ' = ' + r[1]; }).join('\n') +
      '\n\n  tags = {\n' + tagRows.map(function (r) { return '    ' + SIM().pad(r[0], tw) + ' = ' + r[1]; }).join('\n') + '\n  }\n}\n';
  }
  function tfBucketBlock(owner) {
    return 'resource "aws_s3_bucket" "archive" {\n  bucket = "beacon-archive-lab"\n\n  tags = {\n    Service = "beacon"' + (owner ? '\n    Owner   = "data-team"' : '') + '\n  }\n}\n';
  }
  var TF_VERSIONS = 'terraform {\n  required_version = ">= 1.11"\n\n  required_providers {\n    aws = {\n      source  = "hashicorp/aws"\n      version = "~> 6.0"\n    }\n  }\n}\n\nprovider "aws" {\n  region = "us-east-2"\n}\n';
  var TF_BACKEND = 'terraform {\n  backend "s3" {\n    bucket       = "looped-tfstate-lab"\n    key          = "beacon/data/terraform.tfstate"\n    region       = "us-east-2"\n    encrypt      = true\n    use_lockfile = true\n  }\n}\n';
  var TF_DIR = '/home/lab/infra/beacon-data';
  var TF_DBID = 'db-K7Q2M4X9LABR3T6V8W1Y5Z0NPC';
  function tfBaseState(s, mainText) {
    s.tf = { dir: TF_DIR, bucket: 'looped-tfstate-lab', key: 'beacon/data/terraform.tfstate', plans: {}, lock: null, dataLost: false, stateDeleted: false, bypassedLock: false, unsafeUnlock: false, dbRecords: 18243,
      state: { serial: 41, lineage: '3c1e9f2a-lab0-4d7b-8e6a-5f0c2b9d1a47', resources: tfStateFrom(mainText, { aws_db_instance: TF_DBID, aws_s3_bucket: 'beacon-archive-lab' }) },
      stateModified: '2026-10-12T15:02:44Z' };
  }

  /* ═══ S11 · Plan wants to replace database/storage ═══════════════════ */
  function s11World(seed) {
    var S = SIM(), v = S.variantOf(seed, ['a', 'b', 'c']);
    var base = tfDbBlock({ identifier: 'beacon-db' }) + '\n' + tfBucketBlock(false);
    var dbNew = v === 'a' ? tfDbBlock({ identifier: 'beacon-db', name: 'primary' }) : v === 'b' ? tfDbBlock({ identifier: 'beacon-lab-db' }) : tfDbBlock({ identifier: 'beacon-db', enc: true });
    var head = '# Beacon data tier (lab fixture: fictional account, nothing here is real)\n\n';
    var baseMain = head + base, main = head + dbNew + '\n' + tfBucketBlock(true);
    var s = { clock: 0, risky: [], hooks: [], variant: v, snapshots: [] };
    tfBaseState(s, baseMain);
    var tf = makeTf(s);
    var msg = v === 'a' ? 'refactor(data): follow the resource naming guide; add Owner tag to the archive (#318)'
      : v === 'b' ? 'chore(data): apply <service>-<env>-<component> naming to identifiers; add Owner tag (#318)'
      : 'security(data): enable storage encryption for the database (SEC-114); add Owner tag (#318)';
    s.git = { branch: 'main', files: { 'main.tf': main, 'versions.tf': TF_VERSIONS, 'backend.tf': TF_BACKEND }, staged: [], stagedContent: {}, conflicts: [],
      log: [{ sha: hex('S11-' + v + '-head', 40), msg: msg, author: 'dana <dana@corp.lab>', before: { 'main.tf': baseMain } }, { sha: hex('S11-base', 40), msg: 'feat(data): beacon database and archive bucket (#301)', author: 'sam <sam@corp.lab>' }],
      branches: { 'HEAD~1': { 'main.tf': baseMain, 'versions.tf': TF_VERSIONS, 'backend.tf': TF_BACKEND } } };
    var gitBase = S.verbs.git(s);
    function dbAddrInState() { return Object.keys(s.tf.state.resources).filter(function (k) { return /^aws_db_instance\./.test(k); })[0]; }
    s.api = {
      safe: function (w) {
        var p = tf.plan(w);
        return !p.errors.length && !s.tf.dataLost && !p.actions.some(function (x) { return x.type === 'aws_db_instance' && (x.kind === 'replace' || x.kind === 'delete'); });
      },
      guarded: function (w) {
        var cfg = tf.config(w);
        return !cfg.errors.length && Object.keys(cfg.res).some(function (k) { var r = cfg.res[k]; return r.type === 'aws_db_instance' && (r.prevent || /^true$/.test(String(r.attrs.deletion_protection || '').trim())); });
      }
    };
    var verbs = {
      terraform: tf.verb,
      git: function (w, a) {
        if (a[0] === 'show' && (!a[1] || a[1] === 'HEAD')) {
          var c0 = s.git.log[0], d = Object.keys(c0.before || {}).map(function (p) { return 'diff --git a/' + p + ' b/' + p + '\n--- a/' + p + '\n+++ b/' + p + '\n@@ @@\n' + lineDiff(c0.before[p], s.git.files[p]).join('\n'); }).join('\n');
          return S.ok('commit ' + c0.sha + '\nAuthor: ' + c0.author + '\n\n    ' + c0.msg + '\n\n' + d);
        }
        if (a[0] === 'diff' && /^(HEAD~1|HEAD\^)$/.test(a[1] || '')) {
          var old = s.git.branches['HEAD~1'], files = Object.keys(old).filter(function (p) { var cur = S.readFile(w, p); return cur != null && cur !== old[p]; });
          return S.ok(files.map(function (p) { return 'diff --git a/' + p + ' b/' + p + '\n--- a/' + p + '\n+++ b/' + p + '\n@@ @@\n' + lineDiff(old[p], S.readFile(w, p)).join('\n'); }).join('\n'));
        }
        return gitBase(w, a);
      },
      aws: function (w, a0) {
        var a = stripGlobal(a0), svc = a[0], op = a[1], r = a.slice(2);
        if (svc === 'rds' && op === 'describe-db-instances') {
          var addr = dbAddrInState(), d = addr && s.tf.state.resources[addr];
          if (!d) return awsOut(r, { DBInstances: [] });
          var ident = String(d.attrs.identifier).replace(/"/g, '');
          var want = argVal(r, '--db-instance-identifier');
          if (want && want !== ident) return awsErr('DescribeDBInstances', 'DBInstanceNotFound', 'DBInstance ' + want + ' not found.');
          return awsOut(r, { DBInstances: [{ DBInstanceIdentifier: ident, DBInstanceClass: String(d.attrs.instance_class).replace(/"/g, ''), Engine: 'postgres', EngineVersion: '16.4', DBInstanceStatus: 'available',
            AvailabilityZone: String(d.attrs.availability_zone).replace(/"/g, ''), StorageEncrypted: /true/.test(d.attrs.storage_encrypted), DeletionProtection: /true/.test(d.attrs.deletion_protection), BackupRetentionPeriod: +d.attrs.backup_retention_period,
            DbiResourceId: d.id, InstanceCreateTime: d.created, LatestRestorableTime: S.stamp(s) }] });
        }
        if (svc === 'rds' && op === 'create-db-snapshot') {
          var di = argVal(r, '--db-instance-identifier'), sn = argVal(r, '--db-snapshot-identifier'), addr2 = dbAddrInState();
          var live = addr2 && String(s.tf.state.resources[addr2].attrs.identifier).replace(/"/g, '');
          if (!sn) return S.err('aws rds create-db-snapshot: --db-snapshot-identifier is required', 252);
          if (di !== live) return awsErr('CreateDBSnapshot', 'DBInstanceNotFound', 'DBInstance ' + di + ' not found.');
          if (s.snapshots.some(function (x) { return x.id === sn; })) return awsErr('CreateDBSnapshot', 'DBSnapshotAlreadyExists', 'Cannot create the snapshot because a snapshot with the identifier ' + sn + ' already exists.');
          s.snapshots.push({ id: sn, db: di, at: S.stamp(s), records: s.tf.dbRecords });
          return awsOut(r, { DBSnapshot: { DBSnapshotIdentifier: sn, DBInstanceIdentifier: di, SnapshotType: 'manual', Status: 'creating', Encrypted: false, SnapshotCreateTime: S.stamp(s) } });
        }
        if (svc === 'rds' && op === 'describe-db-snapshots') return awsOut(r, { DBSnapshots: s.snapshots.map(function (x) { return { DBSnapshotIdentifier: x.id, DBInstanceIdentifier: x.db, SnapshotType: 'manual', Status: 'available', Encrypted: false, SnapshotCreateTime: x.at }; }) });
        return S.unsupported('aws', [svc, op].filter(Boolean).join(' '), ['rds describe-db-instances [--db-instance-identifier ID]', 'rds create-db-snapshot --db-instance-identifier ID --db-snapshot-identifier NAME', 'rds describe-db-snapshots']);
      },
      edit: S.verbs.edit()
    };
    return { user: 'lab', host: 'ops-1', cwd: TF_DIR,
      dirs: [{ path: '/home/lab/infra' }, { path: TF_DIR }],
      files: [{ path: TF_DIR + '/main.tf', content: main }, { path: TF_DIR + '/versions.tf', content: TF_VERSIONS }, { path: TF_DIR + '/backend.tf', content: TF_BACKEND },
        { path: TF_DIR + '/README.md', content: '# beacon-data\n\nTerraform for the Beacon data tier (PostgreSQL on RDS, archive bucket). State: s3://looped-tfstate-lab/beacon/data/terraform.tfstate (use_lockfile).\nThe database holds every Beacon record since March 2025. CI runs `terraform plan` on merge and waits for a human to approve the apply.\n' }],
      sre: s, extra: S.bind(s, verbs) };
  }
  var S11_PALETTE = ['terraform plan', 'terraform state list', 'terraform state show aws_db_instance.beacon', 'git log --oneline', 'git show', 'git diff HEAD~1', 'cat main.tf', 'terraform validate', 'aws rds describe-db-instances', 'terraform plan -out=review.tfplan'];
  var S11_GUARD = "sed -i 's/^  skip_final_snapshot .*$/&\\n\\n  lifecycle {\\n    prevent_destroy = true\\n  }/' main.tf";

  LX.missions.push({
    id: 'sre-s11', track: 'sre', cat: 'scenario', level: 'intermediate', mins: 25, kind: 'incident',
    title: 'PR #318 to beacon-data is waiting for apply approval',
    brief: function () { return 'PR #318 to the beacon-data Terraform (the Beacon database and archive bucket) merged an hour ago and CI is holding its plan for a human to approve. The author says it is "a small tidy-up". You are on ops-1 in /home/lab/infra/beacon-data with the merged code and the shared state. Read what the plan does, find what in the change causes anything risky, and get the workspace to a plan that is safe to approve — without applying anything that loses data.'; },
    keys: S11_PALETTE,
    world: s11World,
    objectives: [
      { id: 'plan', stage: 'evidence', text: 'Run the plan and read what it would do to the database, not just the summary line',
        hint: 'The summary counts resources; the body says which ones and how.', hint2: '`terraform plan` — look for "must be replaced" or "will be destroyed" against aws_db_instance.',
        reveal: 'terraform plan',
        done: function (c) { return saw(c, /terraform\s+(-chdir=\S+\s+)?plan\b/, /aws_db_instance\.\w+ (must be replaced|will be destroyed)/); } },
      { id: 'cause', stage: 'evidence', text: 'Compare what state records with what the configuration now says, and find the change that introduced the difference',
        hint: 'Terraform plans from the difference between state and configuration. Look at both, and at the commit.', hint2: '`terraform state list` / `terraform state show aws_db_instance.beacon`, then `git show` or `git diff HEAD~1`.',
        reveal: 'terraform state show aws_db_instance.beacon && git show',
        done: function (c) { return saw(c, /terraform\s+(state\s+(list|show)|show)\b/, /aws_db_instance\.beacon/) && saw(c, /git\s+(log|show|diff)\b|cat\s+\S*main\.tf\b|grep\b.*\.tf\b/, /\S/); } },
      { id: 'fix', stage: 'fix', text: 'Change the configuration (or the state addressing) so the plan no longer destroys or replaces the database',
        hint: 'A renamed address is not a new database; an immutable attribute cannot be changed in place.', hint2: 'Renamed address: a `moved { from = … to = … }` block (or `terraform state mv`). Immutable attribute: back that attribute out and plan the real migration separately.',
        reveal: function (c) { var v = st(c).variant;
          return v === 'a' ? "printf 'moved {\\n  from = aws_db_instance.beacon\\n  to   = aws_db_instance.primary\\n}\\n' > moved.tf"
            : v === 'b' ? "edit main.tf identifier '\"beacon-db\"'" : 'edit main.tf storage_encrypted false'; },
        done: function (c) { return st(c).api.safe(c.w); } },
      { id: 'guard', stage: 'fix', text: 'Add a guard so a future plan cannot silently destroy the database',
        hint: 'Terraform and RDS each have a switch for this.', hint2: '`lifecycle { prevent_destroy = true }` in the database resource (or `deletion_protection = true`).',
        reveal: S11_GUARD,
        done: function (c) { return st(c).api.guarded(c.w); } },
      { id: 'verify', stage: 'verify', text: 'Show a plan that keeps the database and destroys nothing',
        hint: 'Read the new plan as carefully as the first one.', hint2: '`terraform plan` — expect 0 to destroy and no replacement; the archive tag change may remain.',
        reveal: 'terraform plan',
        done: function (c) { return st(c).api.safe(c.w) && lastIs(c, /terraform\s+(-chdir=\S+\s+)?plan\b/, /No changes\.|Plan: \d+ to add, \d+ to change, 0 to destroy\./); } }
    ],
    sre: {
      scenarioId: 'S11', moduleId: 'M06', lab: 'L11', variants: ['a', 'b', 'c'],
      symptom: 'A "small tidy-up" PR produces a plan waiting for approval; its summary shows a destroy.',
      neutralTitle: 'A routine Terraform change is waiting for apply approval',
      neutralBrief: 'A merged change to the Terraform for the Beacon database and archive bucket is waiting for a human to approve its apply. The author calls it a small tidy-up. Read what the plan would do, find what in the change causes anything risky, and reach a plan that is safe to approve without applying anything that loses data.',
      impact: 'If approved as planned, the Beacon database (every record since March 2025) is destroyed and recreated empty.',
      changes: 'PR #318 merged an hour ago; nothing has been applied since.',
      spoilers: ['immutable', 'forces replacement', 'moved block', 'storage_encrypted', 'rename', 'ForceNew', 'identifier'],
      tools: ['terraform plan|apply|show|state list|show|mv|validate|init', 'git log|show|diff HEAD~1|revert', 'cat, sed -i, printf > FILE, edit', 'aws rds describe-db-instances|create-db-snapshot|describe-db-snapshots'],
      grammar: ['`terraform plan [-out=FILE] [-detailed-exitcode]`, `terraform apply [-auto-approve] [PLANFILE]` (stdin "yes" approves), `terraform show [PLANFILE]`', '`terraform state list`, `terraform state show ADDR`, `terraform state mv SRC DST`, `terraform validate`', '`git log [--oneline]`, `git show [HEAD]`, `git diff HEAD~1`, `git show HEAD~1:main.tf`, `git revert HEAD`', 'HCL subset: resource and moved blocks, key = value (strings, numbers, bools, maps), lifecycle { prevent_destroy, ignore_changes }', '`edit main.tf KEY VALUE`, `sed -i`, `printf \'…\' > moved.tf`', '`aws rds describe-db-instances`, `aws rds create-db-snapshot --db-instance-identifier ID --db-snapshot-identifier NAME`'],
      palette: S11_PALETTE,
      assumptions: ['Real infrastructure matches state (no drift); the plan is computed from the .tf files and state only.', 'Approving the plan means `terraform apply`; nobody else is running Terraform here.', 'The requirement behind the change (naming, encryption) is legitimate; the question is how to deliver it safely.'],
      simplified: ['Terraform is modelled as a bounded HCL subset (no variables, expressions, modules, count/for_each or data sources) and a fixed list of replacement-forcing arguments per resource type.', 'Refresh never finds drift; computed attributes are illustrative.', 'apply runs instantly; durations printed are illustrative.', 'The AWS provider version is not modelled beyond its documented ForceNew behaviour for these arguments.', 'Every command advances a logical clock by 10 seconds.'],
      unsafe: [
        { label: 'applied a plan that destroys the database', why: 'Approving while the plan destroys or replaces aws_db_instance deletes the instance (skip_final_snapshot = true, so no final snapshot) and creates an empty one: the records are gone.',
          test: function (c) { return !!st(c).tf.dataLost; },
          demo: 'terraform apply -auto-approve' }
      ],
      alt: function (v) {
        if (v === 'a') return ['terraform plan -out=review.tfplan', 'terraform show', 'cat main.tf', 'terraform state mv aws_db_instance.beacon aws_db_instance.primary', 'edit main.tf deletion_protection true', 'terraform plan -detailed-exitcode'];
        if (v === 'b') return ['terraform plan -detailed-exitcode', 'terraform state list', 'git diff HEAD~1', 'aws rds describe-db-instances', "sed -i 's/\"beacon-lab-db\"/\"beacon-db\"/' main.tf", S11_GUARD, 'terraform validate', 'terraform plan'];
        return ['terraform plan -out=review.tfplan', 'terraform state show aws_db_instance.beacon', 'git log --oneline', 'git show HEAD~1:main.tf', 'aws rds create-db-snapshot --db-instance-identifier beacon-db --db-snapshot-identifier beacon-db-pre-sec114',
          'git revert HEAD', 'edit main.tf deletion_protection true', 'terraform plan'];
      },
      mechanism: 'Terraform plans the difference between **state** (what it manages, at which address) and **configuration**. Some arguments cannot change on a live object; the provider marks them as forcing replacement, and the plan says `must be replaced` with `# forces replacement` beside the cause. For a database that means destroy-then-create: a new, empty instance. (a) The PR renamed the resource block: to Terraform a new address is a different object, so the old one "is not in configuration" and is destroyed while a new one is created — a `moved` block (or `terraform state mv`) tells Terraform it is the same object. Note that `prevent_destroy` on the new block does not protect the orphaned old address. (b) The PR changed `identifier`, and (c) set `storage_encrypted = true`; both force replacement of an RDS instance. The safe move is to back out the immutable change, keep the harmless one (the bucket tag), add a guard (`prevent_destroy` or `deletion_protection`), and deliver the real requirement as a planned migration: snapshot, restore or copy (encrypted) to a new instance, cut over, then bring it under Terraform with an import or moved/removed blocks.',
      alternatives: [
        { h: 'The plan is wrong / provider bug', out: 'Ruled out: state show and the commit diff explain every line of the plan.' },
        { h: 'Apply now, restore from backups', out: 'Rejected: skip_final_snapshot = true, and a restore is an outage with a recovery point in the past; the plan was avoidable.' },
        { h: 'lifecycle ignore_changes on the attribute', out: 'Possible but weak: it hides the difference between config and reality instead of resolving it; acceptable only with a documented follow-up.' }
      ],
      clues: ['The Owner tag on the bucket is an in-place update and harmless.', 'versions.tf and backend.tf did not change.'],
      passRubric: ['Reads the plan body and names the line that forces replacement or the orphaned address', 'Explains why that argument or address change means destroy-and-create', 'Chooses a fix that preserves the data and explains how the real requirement would be delivered', 'Adds a guard and verifies a plan with 0 to destroy'],
      prereqs: ['les-m06-02', 'les-m06-04'], refs: ['T17']
    }
  });

  /* ═══ S12 · State lock blocks deployment ═════════════════════════════ */
  function uuidFrom(seed) { var h = hex(seed, 32); return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-a' + h.slice(17, 20) + '-' + h.slice(20, 32); }
  function s12World(seed) {
    var S = SIM(), v = S.variantOf(seed, ['a', 'b']);
    var head = '# Beacon data tier (lab fixture: fictional account, nothing here is real)\n\n';
    /* config on your branch: PR #312 (retention 14) on top of main */
    var main = head + tfDbBlock(v === 'a' ? { identifier: 'beacon-db', cls: 'db.t4g.small', ret: 14 } : { identifier: 'beacon-db', ret: 14, tags: [['CostCenter', '"ops-lab"']] }) + '\n' + tfBucketBlock(false);
    var applied = head + tfDbBlock({ identifier: 'beacon-db' }) + '\n' + tfBucketBlock(false);
    var s = { clock: 0, risky: [], hooks: [], variant: v, ownerChecked: false, watched: false };
    tfBaseState(s, applied);
    var tf = makeTf(s);
    var lockId = uuidFrom(seed + '-lock');
    var owner = v === 'a'
      ? { run: 1842, runner: 'ci-runner-07', trigger: 'merge of PR #311 (dana): db.t4g.micro -> db.t4g.small', started: '2026-10-13T08:41:02Z', created: '2026-10-13T08:41:07.418230Z', status: 'running', finishAt: 220 }
      : { run: 1839, runner: 'ci-runner-03', trigger: 'merge of PR #309 (sam): add CostCenter tag', started: '2026-10-13T07:09:58Z', created: '2026-10-13T07:10:04.902117Z', status: 'failed', endedAt: '2026-10-13T07:12:31Z' };
    s.owner = owner;
    s.tf.lock = { ID: lockId, Operation: 'OperationTypeApply', Info: '', Who: 'runner@' + owner.runner, Version: '1.13.3', Created: owner.created, Path: 'looped-tfstate-lab/beacon/data/terraform.tfstate' };
    s.tf.stateModified = v === 'a' ? '2026-10-13T07:15:02Z' : '2026-10-13T06:58:40Z';
    s.runs = v === 'a'
      ? [{ id: 1842, pipeline: 'beacon-data', trigger: owner.trigger, runner: 'ci-runner-07', status: 'running', started: '08:41:02' },
         { id: 1841, pipeline: 'beacon-web', trigger: 'merge of PR #77 (lee)', runner: 'ci-runner-03', status: 'success', started: '08:12:40', duration: '4m02s' },
         { id: 1839, pipeline: 'beacon-data', trigger: 'merge of PR #309 (sam): add CostCenter tag', runner: 'ci-runner-03', status: 'success', started: '07:09:58', duration: '5m04s' }]
      : [{ id: 1844, pipeline: 'beacon-web', trigger: 'merge of PR #79 (lee)', runner: 'ci-runner-07', status: 'running', started: '08:55:12' },
         { id: 1841, pipeline: 'beacon-web', trigger: 'merge of PR #77 (lee)', runner: 'ci-runner-07', status: 'success', started: '08:12:40', duration: '4m02s' },
         { id: 1839, pipeline: 'beacon-data', trigger: owner.trigger, runner: 'ci-runner-03', status: 'failed', started: '07:09:58', duration: '2m33s', note: 'runner lost contact' }];
    s.runners = v === 'a'
      ? [{ name: 'ci-runner-03', status: 'online', job: '-', note: 'idle' }, { name: 'ci-runner-07', status: 'online', job: '1842', note: 'heartbeat 3s ago' }]
      : [{ name: 'ci-runner-03', status: 'offline', job: '-', note: 'since 07:12:31Z: instance terminated (spot interruption)' }, { name: 'ci-runner-07', status: 'online', job: '1844', note: 'heartbeat 2s ago' }];
    function ownerRun() { return s.runs.filter(function (r) { return r.id === owner.run; })[0]; }
    function ownerActive() { var r = ownerRun(); return !!r && r.status === 'running'; }
    s.tf.onUnlock = function (w, how) { if (ownerActive() || !s.ownerChecked) s.tf.unsafeUnlock = true; s.tf.unlockedBy = how; };
    /* the competing apply finishes on the logical clock (variant a) */
    s.hooks.push(function (x, w) {
      var r = ownerRun();
      if (v !== 'a' || !r || r.status !== 'running' || x.clock < owner.finishAt) return;
      r.status = 'success'; r.duration = Math.floor((owner.finishAt + 1140) / 60) + 'm' + ((owner.finishAt + 1140) % 60) + 's';
      var db = x.tf.state.resources['aws_db_instance.beacon'];
      if (db) db.attrs.instance_class = '"db.t4g.small"';
      x.tf.state.serial++; x.tf.stateModified = S.stamp(x);
      if (x.tf.lock && x.tf.lock.ID === lockId) x.tf.lock = null;
      else x.ownerLostLock = true;
      x.runners[1].job = '-'; x.runners[1].note = 'idle';
    });
    function runLog(r) {
      if (r.id === 1842) {
        var el = 1140 + s.clock, done = r.status !== 'running';
        var L = ['+ terraform apply -input=false tfplan', 'Acquiring state lock. This may take a few moments...', 'aws_db_instance.beacon: Modifying... [id=' + TF_DBID + ']'];
        for (var t = 600; t < Math.min(el, 1140 + owner.finishAt); t += 300) L.push('aws_db_instance.beacon: Still modifying... [id=' + TF_DBID + ', ' + Math.floor(t / 60) + 'm' + (t % 60) + 's elapsed]');
        if (!done) L.push('aws_db_instance.beacon: Still modifying... [id=' + TF_DBID + ', ' + Math.floor(el / 60) + 'm' + (el % 60) + 's elapsed]');
        else L.push('aws_db_instance.beacon: Modifications complete after ' + r.duration + ' [id=' + TF_DBID + ']', '', 'Apply complete! Resources: 0 added, 1 changed, 0 destroyed.', s.ownerLostLock ? 'Error releasing the state lock: the lock object was removed or replaced by someone else' : 'Releasing state lock. This may take a few moments...');
        return L;
      }
      if (r.id === 1839 && v === 'b') return ['+ terraform apply -input=false tfplan', 'Acquiring state lock. This may take a few moments...', 'aws_db_instance.beacon: Modifying... [id=' + TF_DBID + ']', '(log ends 07:12:31Z — controller: runner ci-runner-03 lost contact; job marked failed)'];
      return ['+ ' + (r.pipeline === 'beacon-data' ? 'terraform apply -input=false tfplan' : 'helm upgrade --install beacon-web …'), '(completed: ' + r.status + ')'];
    }
    function noteOwner(text) { if (text.indexOf(String(owner.run)) !== -1 || text.indexOf(owner.runner) !== -1) s.ownerChecked = true; }
    var verbs = {
      terraform: tf.verb,
      cictl: function (w, a) {
        var sub = a[0];
        if (sub === 'runs') {
          var rows = s.runs.map(function (r) { return [String(r.id), r.pipeline, r.runner, r.status + (r.note ? ' (' + r.note + ')' : ''), '2026-10-13 ' + r.started, r.status === 'running' ? Math.floor(sinceStart(r.started) / 60) + 'm (running)' : r.duration, r.trigger]; });
          var out = S.table(['RUN', 'PIPELINE', 'RUNNER', 'STATUS', 'STARTED (UTC)', 'DURATION', 'TRIGGER'], rows);
          noteOwner(out); return S.ok(out.replace(/\n$/, ''));
        }
        if (sub === 'show' || sub === 'logs') {
          var r = s.runs.filter(function (x) { return String(x.id) === String(a[1]); })[0];
          if (!r) return S.err('cictl: run ' + (a[1] || '(none)') + ' not found', 1);
          var lines = runLog(r), runner = s.runners.filter(function (x) { return x.name === r.runner; })[0];
          if (sub === 'logs') { if (r.id === owner.run) s.ownerChecked = true; return S.ok(lines.join('\n')); }
          var txt = ['run ' + r.id + ' · ' + r.pipeline + ' · ' + r.trigger, 'status:   ' + r.status + (r.note ? ' — ' + r.note + (r.id === 1839 && v === 'b' ? ' at 07:12:31Z; no heartbeat since' : '') : r.status === 'running' ? ' (step 4/5 "terraform apply")' : ''),
            'runner:   ' + r.runner + ' (' + runner.status + (runner.status === 'online' ? ', ' + runner.note : ' ' + runner.note) + ')', 'started:  2026-10-13T' + r.started + 'Z', 'state:    s3://looped-tfstate-lab/beacon/data/terraform.tfstate', 'last log lines:'].concat(lines.slice(-4).map(function (l) { return '  ' + l; }));
          if (r.id === owner.run) s.ownerChecked = true;
          return S.ok(txt.join('\n'));
        }
        if (sub === 'runners') { var t2 = S.table(['RUNNER', 'STATUS', 'JOB', 'NOTE'], s.runners.map(function (x) { return [x.name, x.status, x.job, x.note]; })); noteOwner(t2); return S.ok(t2.replace(/\n$/, '')); }
        if (sub === 'watch') {
          var wr = s.runs.filter(function (x) { return String(x.id) === String(a[1]); })[0];
          if (!wr) return S.err('cictl: run ' + (a[1] || '(none)') + ' not found', 1);
          if (wr.status !== 'running') return S.ok('run ' + wr.id + ' is not running (status: ' + wr.status + '); nothing to wait for');
          if (wr.id !== 1842) return S.ok('run ' + wr.id + ' (' + wr.pipeline + ') is running; it does not touch the beacon-data state. Stopped watching.');
          var t0 = s.clock;
          s.stopWaiting = function () { return wr.status !== 'running'; };
          tf.advance(w, 900); s.stopWaiting = null; s.watched = true;
          if (wr.id === owner.run) s.ownerChecked = true;
          return S.ok('watching run ' + wr.id + ' (' + (s.clock - t0) + 's)…\n' + runLog(wr).slice(-4).join('\n') + '\nrun ' + wr.id + ' finished: ' + wr.status);
        }
        if (sub === 'cancel') return S.err('cictl cancel is not modelled: interrupting someone else\'s apply mid-flight can leave a half-applied change; coordinate with the run\'s owner instead.', 2);
        return S.ok('cictl (course CI stand-in, simulated): cictl runs | cictl show RUN | cictl logs RUN | cictl runners | cictl watch RUN (waits until RUN finishes; advances the clock)');
      },
      sleep: function (w, a) { var n = Math.min(600, parseInt(a[0], 10) || 0); tf.advance(w, n); return { out: '', code: 0 }; },
      aws: function (w, a0) {
        var a = stripGlobal(a0), svc = a[0], op = a[1], r = a.slice(2), B = 'looped-tfstate-lab', K = 'beacon/data/terraform.tfstate';
        function objects() {
          var o = [];
          if (!s.tf.stateDeleted) o.push({ Key: K, LastModified: s.tf.stateModified.replace('Z', '+00:00'), Size: 18234 + s.tf.state.serial, ETag: '"' + hex('state' + s.tf.state.serial, 32) + '"' });
          if (s.tf.lock) o.push({ Key: K + '.tflock', LastModified: s.tf.lock.Created.replace(/\.\d+Z$/, '+00:00'), Size: 223, ETag: '"' + hex('lock' + s.tf.lock.ID, 32) + '"' });
          return o;
        }
        function lockText() { return JSON.stringify(s.tf.lock); }
        function remove(key) {
          if (key === K) { s.tf.stateDeleted = true; return true; }
          if (key === K + '.tflock' && s.tf.lock) { s.tf.onUnlock(w, 'deleted lock object'); s.tf.lock = null; return true; }
          return false;
        }
        if (svc === 's3' && op === 'ls') {
          var u = /^s3:\/\/([^\/]+)\/?(.*)$/.exec(r[0] || '');
          if (!u || u[1] !== B) return S.err('aws s3 ls (simulation): only s3://' + B + '/beacon/data/ is modelled', 252);
          return S.ok(objects().filter(function (x) { return x.Key.indexOf(u[2]) === 0; }).map(function (x) { return x.LastModified.slice(0, 19).replace('T', ' ') + ' ' + S.pad(String(x.Size), 10).replace(/(\S+)(\s*)/, '$2$1') + ' ' + x.Key.slice(x.Key.lastIndexOf('/') + 1); }).join('\n'));
        }
        if (svc === 's3' && op === 'cp') {
          var m = /^s3:\/\/([^\/]+)\/(.+)$/.exec(r[0] || '');
          if (!m || m[1] !== B) return S.err('aws s3 cp (simulation): only downloads from s3://' + B + '/… are modelled', 252);
          var body = m[2] === K + '.tflock' && s.tf.lock ? lockText() : (m[2] === K && !s.tf.stateDeleted ? '{"version": 4, "terraform_version": "1.13.3", "serial": ' + s.tf.state.serial + ', "lineage": "' + s.tf.state.lineage + '", "...": "(state body elided in this simulation; use terraform state list/show)"}' : null);
          if (body == null) return S.err('fatal error: An error occurred (404) when calling the HeadObject operation: Key "' + m[2] + '" does not exist', 1);
          if (r[1] === '-') return S.ok(body);
          S.writeFile(w, r[1] || m[2].slice(m[2].lastIndexOf('/') + 1), body + '\n');
          return S.ok('download: ' + r[0] + ' to ' + (r[1] || m[2].slice(m[2].lastIndexOf('/') + 1)));
        }
        if (svc === 's3' && op === 'rm') {
          var mr = /^s3:\/\/([^\/]+)\/(.+)$/.exec(r[0] || '');
          if (!mr || mr[1] !== B || !remove(mr[2])) return S.err('delete failed: ' + (r[0] || '') + ' (no such object in this simulation)', 1);
          return S.ok('delete: ' + r[0]);
        }
        if (svc === 's3api') {
          if (argVal(r, '--bucket') !== B) return awsErr(op || '', 'NoSuchBucket', 'The specified bucket does not exist');
          var key = argVal(r, '--key'), ob = objects().filter(function (x) { return x.Key === key; })[0];
          if (op === 'list-objects-v2') { var pre = argVal(r, '--prefix') || ''; return awsOut(r, { Contents: objects().filter(function (x) { return x.Key.indexOf(pre) === 0; }).map(function (x) { return { Key: x.Key, LastModified: x.LastModified, ETag: x.ETag, Size: x.Size, StorageClass: 'STANDARD' }; }), RequestCharged: null, Prefix: pre }); }
          if (op === 'head-object' || op === 'get-object') {
            if (!ob) return awsErr(op === 'head-object' ? 'HeadObject' : 'GetObject', op === 'head-object' ? '404' : 'NoSuchKey', op === 'head-object' ? 'Not Found' : 'The specified key does not exist.');
            var meta = { AcceptRanges: 'bytes', LastModified: ob.LastModified, ContentLength: ob.Size, ETag: ob.ETag, ContentType: 'application/json', ServerSideEncryption: 'AES256', Metadata: {} };
            if (op === 'get-object') { var outF = r.filter(function (x, i) { return x.indexOf('--') !== 0 && (i === 0 || r[i - 1].indexOf('--') !== 0); })[0]; if (!outF) return S.err('aws s3api get-object: an outfile is required', 252); S.writeFile(w, outF, (key === K + '.tflock' ? lockText() : '{"serial": ' + s.tf.state.serial + '}') + '\n'); }
            return awsOut(r, meta);
          }
          if (op === 'delete-object') { if (!remove(key)) return awsErr('DeleteObject', 'NoSuchKey', 'The specified key does not exist.'); return awsOut(r, {}); }
          return S.unsupported('aws s3api', op || '', ['list-objects-v2 --bucket B [--prefix P]', 'head-object --bucket B --key K', 'get-object --bucket B --key K OUTFILE', 'delete-object --bucket B --key K']);
        }
        if (svc === 'sts' && op === 'get-caller-identity') return awsOut(r, { UserId: 'AROAEXAMPLELAB0OPS:lab', Account: ACCT, Arn: 'arn:aws:sts::' + ACCT + ':assumed-role/platform-ops/lab' });
        return S.unsupported('aws', [svc, op].filter(Boolean).join(' '), ['s3 ls|cp|rm s3://looped-tfstate-lab/…', 's3api list-objects-v2|head-object|get-object|delete-object', 'sts get-caller-identity']);
      },
      edit: S.verbs.edit()
    };
    function sinceStart(hms) { var p = hms.split(':'); return 32400 + s.clock - ((+p[0]) * 3600 + (+p[1]) * 60 + (+p[2])); }
    s.api = {
      released: function () { return !s.tf.lock && !s.tf.stateDeleted && !s.tf.unsafeUnlock && !s.tf.bypassedLock && s.ownerChecked && !ownerActive(); }
    };
    return { user: 'lab', host: 'ops-1', cwd: TF_DIR,
      dirs: [{ path: '/home/lab/infra' }, { path: TF_DIR }],
      files: [{ path: TF_DIR + '/main.tf', content: main }, { path: TF_DIR + '/versions.tf', content: TF_VERSIONS }, { path: TF_DIR + '/backend.tf', content: TF_BACKEND },
        { path: TF_DIR + '/README.md', content: '# beacon-data\n\nState: s3://looped-tfstate-lab/beacon/data/terraform.tfstate, S3 backend with use_lockfile = true (the lock is an object next to the state: terraform.tfstate.tflock).\nCI (cictl) applies merged changes from runners ci-runner-03 and ci-runner-07 as user "runner".\nYour branch: PR #312 (backup retention 7 -> 14 days), rebased on main.\n' }],
      sre: s, extra: S.bind(s, verbs) };
  }
  var S12_PALETTE = ['terraform plan', 'cat backend.tf', 'aws s3 ls s3://looped-tfstate-lab/beacon/data/', 'aws s3 cp s3://looped-tfstate-lab/beacon/data/terraform.tfstate.tflock -', 'aws s3api head-object --bucket looped-tfstate-lab --key beacon/data/terraform.tfstate.tflock', 'cictl runs', 'cictl runners', 'cictl show ', 'cictl watch ', 'terraform plan -lock-timeout=10m', 'terraform force-unlock '];

  LX.missions.push({
    id: 'sre-s12', track: 'sre', cat: 'scenario', level: 'intermediate', mins: 25, kind: 'incident',
    title: 'terraform plan for beacon-data fails: the state is locked',
    brief: function () { return 'Your change to beacon-data (PR #312: backup retention 7 → 14 days) is ready, but every `terraform plan` in /home/lab/infra/beacon-data fails because it cannot acquire the state lock. The release window closes this afternoon. Find out who holds the lock and whether they are still working, take the action that is safe for that situation, and get a successful plan for your change.'; },
    keys: S12_PALETTE,
    world: s12World,
    objectives: [
      { id: 'lockerr', stage: 'evidence', text: 'Reproduce the error and read the lock information Terraform prints',
        hint: 'The error names the lock\'s ID, owner and age.', hint2: '`terraform plan` — read Lock Info: ID, Who, Operation, Created.',
        reveal: 'terraform plan',
        done: function (c) { return saw(c, /terraform\s+(-chdir=\S+\s+)?(plan|apply)\b/, /Error acquiring the state lock/); } },
      { id: 'lockinfo', stage: 'evidence', text: 'Find the lock where the backend keeps it and confirm its owner and age there',
        hint: 'With use_lockfile the lock is an object beside the state.', hint2: '`aws s3 ls s3://looped-tfstate-lab/beacon/data/` and `aws s3 cp s3://looped-tfstate-lab/beacon/data/terraform.tfstate.tflock -`.',
        reveal: 'aws s3 ls s3://looped-tfstate-lab/beacon/data/ && aws s3 cp s3://looped-tfstate-lab/beacon/data/terraform.tfstate.tflock -',
        done: function (c) { return saw(c, /aws\s+s3(api)?\s/, /tflock|"Who"|LastModified/); } },
      { id: 'owner', stage: 'evidence', text: 'Establish whether the lock\'s owner is still working',
        hint: 'The lock says who; the CI system says whether that process is alive.', hint2: '`cictl runs`, then `cictl show RUN` for the run on the lock owner\'s runner, and `cictl runners`.',
        reveal: function (c) { return st(c).variant === 'a' ? 'cictl runs && cictl show 1842' : 'cictl show 1839 && cictl runners'; },
        done: function (c) { return !!st(c).ownerChecked && saw(c, /cictl\s+(runs|show|logs|runners|watch)\b/, /running|failed|offline|online|finished/); } },
      { id: 'release', stage: 'fix', text: 'Get the lock released in the way that is safe for what you found',
        hint: 'An active owner finishes and releases its own lock; only a proven-dead owner\'s lock is yours to remove.', hint2: 'Active run: wait (`cictl watch RUN`, or `terraform plan -lock-timeout=10m`). Dead run: `terraform force-unlock LOCK_ID` with the exact ID.',
        reveal: function (c) { return st(c).variant === 'a' ? 'cictl watch 1842' : 'terraform force-unlock -force ' + st(c).tf.lock.ID; },
        done: function (c) { return st(c).api.released(); } },
      { id: 'verify', stage: 'verify', text: 'Run a plan that acquires the lock and shows your change',
        hint: 'Read the plan: is it only what you expect?', hint2: '`terraform plan` — expect backup_retention_period 7 -> 14 and 0 to destroy.',
        reveal: 'terraform plan',
        done: function (c) { return st(c).api.released() && lastIs(c, /terraform\s+(-chdir=\S+\s+)?plan\b/, /backup_retention_period[\s\S]*Plan: 0 to add, \d+ to change, 0 to destroy\./); } }
    ],
    sre: {
      scenarioId: 'S12', moduleId: 'M06', lab: 'L12', variants: ['a', 'b'],
      symptom: '`terraform plan` fails with "Error acquiring the state lock" (412 PreconditionFailed on the lock object).',
      neutralTitle: 'A deployment is blocked by the Terraform state lock',
      neutralBrief: 'Your change to the beacon-data Terraform is ready, but every plan fails because it cannot acquire the state lock, and the release window closes this afternoon. Find out who holds the lock and whether they are still working, take the action that is safe for that situation, and get a successful plan for your change.',
      impact: 'No change to beacon-data can be planned or applied until the lock is released.',
      changes: 'CI applies merged beacon-data changes; two merges landed this morning; PR #312 is yours.',
      spoilers: ['stale', 'crashed', 'force-unlock', 'still running', 'spot', 'terminated', 'dead'],
      tools: ['terraform plan|apply|force-unlock|state list|show', 'aws s3 ls|cp|rm, aws s3api list-objects-v2|head-object|get-object|delete-object (state bucket)', 'cictl runs|show|logs|runners|watch (CI stand-in)', 'sleep N (advances the logical clock)'],
      grammar: ['`terraform plan [-lock-timeout=DUR] [-lock=false] [-out=F]`, `terraform apply [-auto-approve]`, `terraform force-unlock [-force] LOCK_ID` (stdin "yes" confirms)', '`aws s3 ls s3://looped-tfstate-lab/beacon/data/`, `aws s3 cp s3://…/terraform.tfstate.tflock -`, `aws s3api head-object|get-object|delete-object --bucket B --key K`, `aws s3api list-objects-v2 --bucket B --prefix P`', '`cictl runs`, `cictl show RUN`, `cictl logs RUN`, `cictl runners`, `cictl watch RUN`', '`sleep N` (≤ 600)'],
      palette: S12_PALETTE,
      assumptions: ['The backend is S3 with use_lockfile = true: Terraform creates terraform.tfstate.tflock with a conditional write and deletes it when done. No DynamoDB table is involved (DynamoDB locking is deprecated).', 'CI runs Terraform as user "runner" on its runners; cictl is the source of truth for whether a run is alive.', 'Your branch already contains everything merged to main.'],
      simplified: ['Time is logical: every command advances 10 seconds; `cictl watch`, `sleep` and `-lock-timeout` advance it further.', 'The competing apply\'s progress and the crashed run are scripted per variant; there is no real CI or S3.', 'State bodies are not shown; terraform state list/show read the modelled state.', 'Terraform is the bounded subset described in S11.'],
      unsafe: [
        { label: 'forced the lock without proving its owner had stopped', why: 'force-unlock (or deleting the .tflock object) while the owning apply is still writing, or without checking, lets two writers race on one state file: the later write silently discards the other\'s changes.',
          test: function (c) { return !!st(c).tf.unsafeUnlock; },
          demo: function (c) { return 'terraform force-unlock -force ' + c.w.sre.tf.lock.ID; } },
        { label: 'deleted the state file', why: 'Removing terraform.tfstate does not remove the lock problem; it makes Terraform forget every resource, so the next plan proposes to create the database and bucket again.',
          test: function (c) { return !!st(c).tf.stateDeleted; },
          demo: 'aws s3 rm s3://looped-tfstate-lab/beacon/data/terraform.tfstate' },
        { label: 'wrote state with locking disabled', why: '-lock=false on a write bypasses the very protection that stopped you; with an active owner it is a guaranteed race.',
          test: function (c) { return !!st(c).tf.bypassedLock; },
          demo: 'terraform apply -lock=false -auto-approve' }
      ],
      alt: function (v) {
        if (v === 'a') return ['terraform plan', 'aws s3api head-object --bucket looped-tfstate-lab --key beacon/data/terraform.tfstate.tflock', 'cictl runners', 'cictl logs 1842', 'terraform plan -lock-timeout=10m'];
        return ['terraform plan -no-color', 'aws s3api list-objects-v2 --bucket looped-tfstate-lab --prefix beacon/data/', 'aws s3api get-object --bucket looped-tfstate-lab --key beacon/data/terraform.tfstate.tflock lock.json', 'cat lock.json',
          'cictl runs', 'cictl logs 1839', 'cictl runners', function (c) { return 'echo yes | terraform force-unlock ' + c.w.sre.tf.lock.ID; }, 'terraform plan -out=pr312.tfplan'];
      },
      mechanism: 'With the S3 backend and `use_lockfile = true`, Terraform takes the lock by writing `terraform.tfstate.tflock` with a conditional put; a second writer gets 412 PreconditionFailed and Terraform prints the Lock Info (ID, Who, Operation, Created). A lock is a claim, not proof of activity, so the owner must be checked where activity is visible — here, the CI system. (a) Run 1842 on ci-runner-07 is mid-apply on the database: its lock is legitimate. The safe action is to wait (or plan with `-lock-timeout`) and coordinate; when the apply finishes it releases its own lock and your plan then reflects its change too. Forcing the lock would let two applies write one state file. (b) Run 1839 died with its runner (spot interruption) two hours ago and can never release its lock. After confirming the run is failed and the runner offline, `terraform force-unlock LOCK_ID` with the exact ID is the controlled recovery. Its plan then shows your change plus the crashed run\'s never-recorded change, which is why you read it before applying. Deleting the state or using `-lock=false` for a write are never the fix.',
      alternatives: [
        { h: 'The state bucket or permissions are broken', out: 'Ruled out: the error is 412 PreconditionFailed on the lock object, and reading the state works.' },
        { h: 'A DynamoDB lock table is stuck', out: 'Not applicable: this backend uses use_lockfile; the lock is the .tflock object (DynamoDB locking is deprecated).' },
        { h: 'Force-unlock immediately to meet the window', out: 'Rejected unless the owner is proven gone: a live apply would race with yours.' }
      ],
      clues: ['Another pipeline\'s running job on the same runner pool is not the lock owner; the lock\'s Who and Created identify it.', 'The Operation (apply vs plan) tells you whether the owner may be writing.'],
      passRubric: ['Reads Lock Info and finds the lock object on the backend', 'Decides active versus stale from CI evidence, not from the lock\'s age alone', 'Chooses wait/coordinate or a controlled force-unlock with the exact ID, and says why', 'Verifies with a plan that acquires the lock and reads its contents'],
      prereqs: ['les-m06-03'], refs: ['T03', 'T17']
    }
  });
})();
