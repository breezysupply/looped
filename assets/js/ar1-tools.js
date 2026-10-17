/* Tools for the Anduril Round 1 VPC scenarios (window.LXNet.tools / world).

   Every command reads the LXNet model, so outputs are derived from state:
   fixing a route or a rule changes what nc, curl, ssh and the flow logs
   show on the next command. Command set (and nothing else — anything else
   says it is not modelled):

   from the laptop (macOS):  ssh, nc -vz, curl, ping, dig
   on an instance (console): curl, nc -vz, dig, ip route, ss -ltn, cat
   both:                     aws ec2 describe-* / mutations listed below,
                             aws logs filter-log-events (VPC flow logs),
                             note (hypothesis / interpretation log)

   `console INSTANCE_ID` is an out-of-band shell (like the EC2 serial
   console) so that testing a path never depends on the path under test.
   Outputs imitate real tools but are SIMULATED; nothing here calls AWS. */
(function (root) {
  'use strict';
  var N = function () { return root.LXNet; };
  var X = function () { return root.LXSim; };

  function J(x) { return JSON.stringify(x, null, 4); }
  function tag(name) { return name ? [{ Key: 'Name', Value: name }] : []; }
  function argMap(a) {
    var m = { _: [] };
    for (var i = 0; i < a.length; i++) {
      var k = a[i];
      if (/^--[a-z]/.test(k)) {
        var eq = k.indexOf('=');
        if (eq !== -1) { m[k.slice(2, eq)] = k.slice(eq + 1); continue; }
        var nx = a[i + 1];
        if (nx === undefined || /^--[a-z]/.test(nx)) m[k.slice(2)] = true; else { m[k.slice(2)] = nx; i++; }
      } else m._.push(k);
    }
    return m;
  }
  function filterVal(m, name) {
    var f = m.filters; if (!f || f === true) return null;
    var r = new RegExp('Name=' + name.replace(/\./g, '\\.') + ',Values=([^ ]+)').exec(f);
    return r ? r[1].split(',') : null;
  }
  function protoOf(p) { p = String(p == null ? '' : p).toLowerCase(); return p === '6' ? 'tcp' : p === '17' ? 'udp' : p === '1' ? 'icmp' : (p === 'all' || p === '-1') ? '-1' : p; }
  function portsOf(v) { var m = /^(-?\d+)(?:-(\d+))?$/.exec(String(v || '')); return m ? { from: +m[1], to: m[2] ? +m[2] : +m[1] } : null; }

  /* ── aws ec2 / logs ──────────────────────────────────────────────── */
  function awsVerb(st) {
    return function (w, a) {
      var t = st.net, S = X();
      if (a[0] === 'sts' && a[1] === 'get-caller-identity') return S.ok(J({ UserId: 'AIDALAB0000000000000', Account: '123456789012', Arn: 'arn:aws:iam::123456789012:user/brett-lab' }));
      if (a[0] === 'logs' && a[1] === 'filter-log-events') {
        var lm = argMap(a.slice(2));
        if (!lm['log-group-name']) return S.err('aws: error: the following arguments are required: --log-group-name', 252);
        if (lm['log-group-name'] !== t.flowLogGroup) return S.err('An error occurred (ResourceNotFoundException) when calling the FilterLogEvents operation: The specified log group does not exist.', 254);
        var pat = typeof lm['filter-pattern'] === 'string' ? lm['filter-pattern'].replace(/^["']|["']$/g, '') : '';
        var words = pat.replace(/[\[\]]/g, ' ').split(/\s+/).filter(Boolean);
        var ev = (t.flows || []).filter(function (f) { return words.every(function (wd) { return f.indexOf(wd) !== -1; }); }).slice(-40);
        return S.ok(J({ events: ev.map(function (m, i) { return { logStreamName: m.split(' ')[2] + '-all', timestamp: 1760430000000 + i * 1000, message: m, eventId: String(38000000000000 + i) }; }), searchedLogStreams: [] }));
      }
      if (a[0] === 'route53') return S.unsupported('aws route53', a[1] || '', ['(not used in this scenario)']);
      if (a[0] !== 'ec2') return S.unsupported('aws', a[0] || '', ['ec2 describe-*/modify subset', 'logs filter-log-events', 'sts get-caller-identity']);
      var op = a[1], m = argMap(a.slice(2));
      if (m.query) st.queryNote = true;
      var note = m.query ? '\n(simulation: --query is not evaluated here; full JSON shown)' : '';
      function out(x) { return S.ok(J(x) + note); }
      function needs(k) { return m[k] && m[k] !== true; }
      function notFound(kind, id) { return S.err('An error occurred (Invalid' + kind + '.NotFound) when calling the operation: The ' + kind.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase() + ' ID \'' + id + '\' does not exist', 254); }
      var ids = function (k) { return needs(k) ? String(m[k]).split(/[\s,]+/).filter(Boolean) : null; };
      switch (op) {
        case 'describe-instances': {
          var want = ids('instance-ids'), nameF = filterVal(m, 'tag:Name');
          var list = Object.keys(t.instances).filter(function (id) { return (!want || want.indexOf(id) !== -1) && (!nameF || nameF.indexOf(t.instances[id].name) !== -1); });
          if (want) for (var wi = 0; wi < want.length; wi++) if (!t.instances[want[wi]]) return notFound('InstanceID', want[wi]);
          return out({ Reservations: list.map(function (id) { var i = t.instances[id], sn = t.subnets[i.subnet];
            var o = { InstanceId: id, InstanceType: 't3.micro', State: { Code: 16, Name: 'running' }, PrivateIpAddress: i.privateIp };
            if (i.publicIp) o.PublicIpAddress = i.publicIp;
            o.SubnetId = i.subnet; o.VpcId = sn.vpc; o.SecurityGroups = (i.sgs || []).map(function (g) { return { GroupId: g, GroupName: (t.sgs[g] || {}).name }; });
            o.NetworkInterfaces = [{ NetworkInterfaceId: i.eni, PrivateIpAddress: i.privateIp, Association: i.publicIp ? { PublicIp: i.publicIp, IpOwnerId: 'amazon' } : undefined }];
            o.Tags = tag(i.name);
            return { ReservationId: 'r-0' + id.slice(3, 15), Instances: [o] }; }) });
        }
        case 'describe-security-groups': {
          var g = ids('group-ids');
          if (g) for (var gi = 0; gi < g.length; gi++) if (!t.sgs[g[gi]]) return notFound('GroupId', g[gi]);
          var perm = function (r) { var o = { IpProtocol: r.proto }; if (r.proto !== '-1') { o.FromPort = r.from; o.ToPort = r.to; } o.IpRanges = r.cidr ? [{ CidrIp: r.cidr, Description: r.desc }] : []; o.UserIdGroupPairs = r.sg ? [{ GroupId: r.sg, UserId: '123456789012' }] : []; return o; };
          return out({ SecurityGroups: Object.keys(t.sgs).filter(function (id) { return !g || g.indexOf(id) !== -1; }).map(function (id) { var s = t.sgs[id];
            return { GroupId: id, GroupName: s.name, Description: s.desc || s.name, VpcId: s.vpc, IpPermissions: s.ingress.map(perm), IpPermissionsEgress: s.egress.map(perm) }; }) });
        }
        case 'describe-route-tables': {
          var rIds = ids('route-table-ids'), subF = filterVal(m, 'association.subnet-id'), vpcF = filterVal(m, 'vpc-id'), mainF = filterVal(m, 'association.main');
          var rt = Object.keys(t.rtbs).filter(function (id) {
            var r = t.rtbs[id];
            if (rIds && rIds.indexOf(id) === -1) return false;
            if (vpcF && vpcF.indexOf(r.vpc) === -1) return false;
            if (mainF && String(!!r.main) !== mainF[0]) return false;
            /* like AWS: this filter matches EXPLICIT associations only */
            if (subF && !Object.keys(t.assoc).some(function (sn) { return subF.indexOf(sn) !== -1 && t.assoc[sn].rtb === id; })) return false;
            return true;
          });
          return out({ RouteTables: rt.map(function (id) { var r = t.rtbs[id];
            var as = Object.keys(t.assoc).filter(function (sn) { return t.assoc[sn].rtb === id; }).map(function (sn) { return { Main: false, RouteTableAssociationId: t.assoc[sn].id, RouteTableId: id, SubnetId: sn, AssociationState: { State: 'associated' } }; });
            if (r.main) as.unshift({ Main: true, RouteTableAssociationId: 'rtbassoc-0main' + id.slice(4, 12), RouteTableId: id, AssociationState: { State: 'associated' } });
            return { RouteTableId: id, VpcId: r.vpc, Associations: as, Routes: r.routes.map(function (x) {
              var o = x.dest.indexOf('pl-') === 0 ? { DestinationPrefixListId: x.dest } : { DestinationCidrBlock: x.dest };
              if (x.target === 'local' || /^igw-|^vpce-/.test(x.target)) o.GatewayId = x.target; else if (/^nat-/.test(x.target)) o.NatGatewayId = x.target; else o.GatewayId = x.target;
              var dead = /^nat-/.test(x.target) ? !(t.nats[x.target] && t.nats[x.target].state === 'available') : /^igw-/.test(x.target) ? !t.igws[x.target] : false;
              o.Origin = x.target === 'local' ? 'CreateRouteTable' : 'CreateRoute'; o.State = dead ? 'blackhole' : 'active';
              return o; }), Tags: tag(r.name) }; }) });
        }
        case 'describe-network-acls': {
          var nIds = ids('network-acl-ids'), nsub = filterVal(m, 'association.subnet-id');
          var all = Object.keys(t.nacls || {}).map(function (k) { return t.nacls[k]; });
          var dflt = { id: 'acl-0default0000000a', isDefault: true, subnets: Object.keys(t.subnets).filter(function (sn) { return !all.some(function (x) { return x.subnets.indexOf(sn) !== -1; }); }), entries: [] };
          all.push(dflt);
          var sel = all.filter(function (x) { return (!nIds || nIds.indexOf(x.id) !== -1) && (!nsub || x.subnets.some(function (sn) { return nsub.indexOf(sn) !== -1; })); });
          return out({ NetworkAcls: sel.map(function (x) {
            var es = x.isDefault ? [{ n: 100, proto: '-1', cidr: '0.0.0.0/0', action: 'allow', egress: false }, { n: 100, proto: '-1', cidr: '0.0.0.0/0', action: 'allow', egress: true }] : x.entries;
            es = es.concat([{ n: 32767, proto: '-1', cidr: '0.0.0.0/0', action: 'deny', egress: false }, { n: 32767, proto: '-1', cidr: '0.0.0.0/0', action: 'deny', egress: true }]);
            return { NetworkAclId: x.id, IsDefault: !!x.isDefault, VpcId: Object.keys(t.vpcs)[0],
              Associations: x.subnets.map(function (sn, i) { return { NetworkAclAssociationId: 'aclassoc-0' + i + x.id.slice(4, 12), NetworkAclId: x.id, SubnetId: sn }; }),
              Entries: es.slice().sort(function (p, q) { return (p.egress === q.egress ? 0 : p.egress ? 1 : -1) || p.n - q.n; }).map(function (e) {
                var o = { CidrBlock: e.cidr, Egress: !!e.egress, Protocol: e.proto === 'tcp' ? '6' : e.proto === 'udp' ? '17' : e.proto === 'icmp' ? '1' : '-1', RuleAction: e.action, RuleNumber: e.n };
                if (o.Protocol === '6' || o.Protocol === '17') o.PortRange = { From: e.from, To: e.to };
                return o; }), Tags: tag(x.name) }; }) });
        }
        case 'describe-subnets': {
          return out({ Subnets: Object.keys(t.subnets).filter(function (id) { var s = ids('subnet-ids'); return !s || s.indexOf(id) !== -1; }).map(function (id) { var s = t.subnets[id], c = N().parseCidr(s.cidr);
            return { SubnetId: id, VpcId: s.vpc, CidrBlock: s.cidr, AvailabilityZone: s.az, MapPublicIpOnLaunch: !!s.mapPublic, AvailableIpAddressCount: c.size - 5 - Object.keys(t.instances).filter(function (k) { return t.instances[k].subnet === id; }).length, Tags: tag(s.name) }; }) });
        }
        case 'describe-internet-gateways':
          return out({ InternetGateways: Object.keys(t.igws || {}).map(function (id) { return { InternetGatewayId: id, Attachments: [{ State: 'available', VpcId: t.igws[id].vpc }], Tags: tag(t.igws[id].name) }; }) });
        case 'describe-nat-gateways':
          return out({ NatGateways: Object.keys(t.nats || {}).map(function (id) { var n = t.nats[id]; return { NatGatewayId: id, SubnetId: n.subnet, VpcId: t.subnets[n.subnet].vpc, State: n.state, ConnectivityType: 'public', NatGatewayAddresses: [{ AllocationId: 'eipalloc-0' + id.slice(4, 14), PublicIp: n.eip, PrivateIp: n.privateIp, IsPrimary: true, Status: 'succeeded' }], Tags: tag(n.name) }; }) });
        case 'describe-vpc-endpoints':
          return out({ VpcEndpoints: Object.keys(t.endpoints || {}).map(function (id) { var e = t.endpoints[id]; return { VpcEndpointId: id, VpcEndpointType: e.type, ServiceName: e.service, State: 'available', RouteTableIds: e.rtbs || [], PrivateDnsEnabled: e.type === 'Interface' ? !!e.privateDns : undefined, PolicyDocument: e.policy || '{"Version":"2008-10-17","Statement":[{"Effect":"Allow","Principal":"*","Action":"*","Resource":"*"}]}' }; }) });
        case 'describe-vpcs':
          return out({ Vpcs: Object.keys(t.vpcs).map(function (id) { return { VpcId: id, CidrBlock: t.vpcs[id].cidr, State: 'available', Tags: tag(t.vpcs[id].name) }; }) });

        /* ── mutations ── */
        case 'authorize-security-group-ingress': case 'authorize-security-group-egress':
        case 'revoke-security-group-ingress': case 'revoke-security-group-egress': {
          if (m['ip-permissions']) return S.err('simulation: --ip-permissions JSON is not parsed here; use --protocol --port --cidr (one rule per command)', 2);
          if (!needs('group-id')) return S.err('aws: error: the following arguments are required: --group-id', 252);
          var sg = t.sgs[m['group-id']]; if (!sg) return notFound('GroupId', m['group-id']);
          var pr = protoOf(m.protocol), pp = pr === '-1' ? { from: -1, to: -1 } : portsOf(m.port);
          if (!pr || !pp) return S.err('simulation: give --protocol tcp|udp|icmp|-1 and --port N or N-M (and --cidr X/Y or --source-group sg-…)', 2);
          if (!needs('cidr') && !needs('source-group')) return S.err('simulation: give --cidr X/Y or --source-group sg-…', 2);
          if (needs('cidr') && !N().parseCidr(m.cidr)) return S.err('An error occurred (InvalidParameterValue) when calling the AuthorizeSecurityGroupIngress operation: CIDR block ' + m.cidr + ' is malformed', 254);
          var arr = /egress/.test(op) ? sg.egress : sg.ingress;
          var rule = { proto: pr, from: pp.from, to: pp.to, cidr: needs('cidr') ? m.cidr : undefined, sg: needs('source-group') ? m['source-group'] : undefined };
          var same = function (r) { return r.proto === rule.proto && r.from === rule.from && r.to === rule.to && r.cidr === rule.cidr && r.sg === rule.sg; };
          if (/^authorize/.test(op)) {
            if (arr.some(same)) return S.err('An error occurred (InvalidPermission.Duplicate) when calling the ' + (/egress/.test(op) ? 'AuthorizeSecurityGroupEgress' : 'AuthorizeSecurityGroupIngress') + ' operation: the specified rule already exists', 254);
            arr.push(rule);
            if (rule.cidr === '0.0.0.0/0' && /ingress/.test(op)) st.risky.push({ cmd: 'authorize ' + rule.proto + '/' + rule.from + ' from 0.0.0.0/0', why: 'Opens the port to the whole internet.' });
            return out({ Return: true, SecurityGroupRules: [{ SecurityGroupRuleId: 'sgr-0' + (arr.length * 7919).toString(16) + 'ab12cd', GroupId: sg.id, IsEgress: /egress/.test(op), IpProtocol: pr, FromPort: pp.from, ToPort: pp.to, CidrIpv4: rule.cidr }] });
          }
          var idx = -1; arr.forEach(function (r, i) { if (same(r)) idx = i; });
          if (idx === -1) return S.err('An error occurred (InvalidPermission.NotFound) when calling the Revoke operation: The specified rule does not exist in this security group.', 254);
          arr.splice(idx, 1);
          return out({ Return: true });
        }
        case 'create-route': case 'replace-route': case 'delete-route': {
          var rt2 = t.rtbs[m['route-table-id']]; if (!rt2) return notFound('RouteTableID', m['route-table-id'] || '');
          var dest = m['destination-cidr-block'];
          if (!dest || !N().parseCidr(dest)) return S.err('simulation: give --destination-cidr-block X/Y', 2);
          var tgt = m['gateway-id'] || m['nat-gateway-id'] || m['vpc-endpoint-id'];
          var exist = rt2.routes.filter(function (x) { return x.dest === dest; })[0];
          if (op === 'delete-route') { if (!exist) return S.err('An error occurred (InvalidRoute.NotFound) when calling the DeleteRoute operation: no route with destination-cidr-block ' + dest + ' in route table ' + rt2.id, 254); if (exist.target === 'local') return S.err('An error occurred (InvalidParameterValue) when calling the DeleteRoute operation: cannot remove local route', 254); rt2.routes.splice(rt2.routes.indexOf(exist), 1); return S.ok(''); }
          if (!tgt || tgt === true) return S.err('simulation: give --gateway-id igw-… or --nat-gateway-id nat-…', 2);
          if (/^igw-/.test(tgt) && !t.igws[tgt]) return notFound('InternetGatewayID', tgt);
          if (/^nat-/.test(tgt) && !t.nats[tgt]) return notFound('NatGatewayID', tgt);
          if (op === 'create-route') { if (exist) return S.err('An error occurred (RouteAlreadyExists) when calling the CreateRoute operation: The route identified by ' + dest + ' already exists.', 254); rt2.routes.push({ dest: dest, target: tgt }); return out({ Return: true }); }
          if (!exist) return S.err('An error occurred (InvalidParameterValue) when calling the ReplaceRoute operation: There is no route defined for \'' + dest + '\' in the route table. Please use AddRoute instead.', 254);
          exist.target = tgt; return S.ok('');
        }
        case 'associate-route-table': {
          var sub = m['subnet-id'], rtid = m['route-table-id'];
          if (!t.subnets[sub]) return notFound('SubnetID', sub || '');
          if (!t.rtbs[rtid]) return notFound('RouteTableID', rtid || '');
          if (t.assoc[sub]) return S.err('An error occurred (Resource.AlreadyAssociated) when calling the AssociateRouteTable operation: the specified association for route table ' + t.assoc[sub].rtb + ' conflicts with an existing association', 254);
          var aid = 'rtbassoc-0' + (sub.slice(7, 13) + rtid.slice(4, 10));
          t.assoc[sub] = { rtb: rtid, id: aid };
          return out({ AssociationId: aid, AssociationState: { State: 'associated' } });
        }
        case 'replace-route-table-association': {
          var hit = Object.keys(t.assoc).filter(function (sn) { return t.assoc[sn].id === m['association-id']; })[0];
          if (!hit) return S.err('An error occurred (InvalidAssociationID.NotFound) when calling the ReplaceRouteTableAssociation operation: The association ID \'' + m['association-id'] + '\' does not exist', 254);
          if (!t.rtbs[m['route-table-id']]) return notFound('RouteTableID', m['route-table-id'] || '');
          t.assoc[hit] = { rtb: m['route-table-id'], id: t.assoc[hit].id + 'r' };
          return out({ NewAssociationId: t.assoc[hit].id, AssociationState: { State: 'associated' } });
        }
        case 'disassociate-route-table': {
          var h2 = Object.keys(t.assoc).filter(function (sn) { return t.assoc[sn].id === m['association-id']; })[0];
          if (!h2) return S.err('An error occurred (InvalidAssociationID.NotFound) when calling the DisassociateRouteTable operation', 254);
          delete t.assoc[h2]; return S.ok('');
        }
        case 'create-network-acl-entry': case 'replace-network-acl-entry': case 'delete-network-acl-entry': {
          var acl = (t.nacls || {})[m['network-acl-id']]; if (!acl) return notFound('NetworkAclID', m['network-acl-id'] || '');
          var eg = !!m.egress && !m.ingress, n = +m['rule-number'];
          if (!(n >= 1 && n <= 32766)) return S.err('An error occurred (InvalidParameterValue) when calling the operation: rule number must be 1-32766', 254);
          var cur = acl.entries.filter(function (e) { return e.n === n && !!e.egress === eg; })[0];
          if (op === 'delete-network-acl-entry') { if (!cur) return S.err('An error occurred (InvalidNetworkAclEntry.NotFound) when calling the DeleteNetworkAclEntry operation', 254); acl.entries.splice(acl.entries.indexOf(cur), 1); return S.ok(''); }
          var p2 = protoOf(m.protocol), rng = /From=(\d+),To=(\d+)/.exec(String(m['port-range'] || ''));
          if (!p2 || !needs('cidr-block') || !/^(allow|deny)$/.test(m['rule-action'] || '')) return S.err('simulation: give --protocol tcp|-1 --port-range From=N,To=M --cidr-block X/Y --rule-action allow|deny and --ingress or --egress', 2);
          if ((p2 === 'tcp' || p2 === 'udp') && !rng) return S.err('An error occurred (InvalidParameterValue) when calling the operation: --port-range is required for TCP and UDP', 254);
          var e = { n: n, proto: p2, from: rng ? +rng[1] : 0, to: rng ? +rng[2] : 65535, cidr: m['cidr-block'], action: m['rule-action'], egress: eg };
          if (op === 'create-network-acl-entry') { if (cur) return S.err('An error occurred (NetworkAclEntryAlreadyExists) when calling the CreateNetworkAclEntry operation: The network acl entry identified by ' + n + ' already exists.', 254); acl.entries.push(e); return S.ok(''); }
          if (!cur) return S.err('An error occurred (InvalidNetworkAclEntry.NotFound) when calling the ReplaceNetworkAclEntry operation', 254);
          acl.entries[acl.entries.indexOf(cur)] = e; return S.ok('');
        }
        case 'allocate-address':
          st.eips = st.eips || []; var ip = '203.0.113.' + (200 + st.eips.length); st.eips.push(ip);
          return out({ PublicIp: ip, AllocationId: 'eipalloc-0lab' + st.eips.length, Domain: 'vpc' });
        case 'associate-address': {
          var inst = t.instances[m['instance-id']]; if (!inst) return notFound('InstanceID', m['instance-id'] || '');
          var alloc = String(m['allocation-id'] || ''), k = +(alloc.replace(/\D+/g, '') || 0);
          if (!st.eips || !st.eips[k - 1]) return S.err('An error occurred (InvalidAllocationID.NotFound) when calling the AssociateAddress operation', 254);
          inst.publicIp = st.eips[k - 1]; return out({ AssociationId: 'eipassoc-0lab' + k });
        }
        default:
          return S.unsupported('aws ec2', op || '', ['describe-instances|security-groups|route-tables|network-acls|subnets|internet-gateways|nat-gateways|vpc-endpoints|vpcs', 'authorize/revoke-security-group-ingress|egress (--protocol --port --cidr)', 'create/replace/delete-route', 'associate-route-table, replace-route-table-association, disassociate-route-table', 'create/replace/delete-network-acl-entry']);
      }
    };
  }

  /* ── connectivity tools ──────────────────────────────────────────── */
  /* every connectivity test is remembered with its vantage point, so an objective can ask "was this tested FROM the instance?" */
  function probe(st, p) { p.clock = st.clock; st.lastProbe = p; st.probes = st.probes || []; st.probes.push(p); }
  function where(st) { return st.at === 'laptop' ? 'client' : st.at; }
  function resolve(st, name) {
    var t = st.net;
    if (N().ip2n(name) != null) return name;
    return (t.dns || {})[name] || null;
  }
  function svc(port) { return { 22: 'ssh', 80: 'http', 443: 'https', 5432: 'postgresql' }[port] || '*'; }

  function ncVerb(st) {
    return function (w, a) {
      var S = X();
      var host = a.filter(function (x, i) { return x.charAt(0) !== '-' && !(a[i - 1] === '-w' || a[i - 1] === '-G'); })[0];
      var port = +a.filter(function (x, i) { return /^\d+$/.test(x) && !(a[i - 1] === '-w' || a[i - 1] === '-G'); }).pop();
      if (!host || !port) return S.err('usage: nc -vz [-w SECONDS] HOST PORT  (simulation: TCP connect test only)', 2);
      var ip = resolve(st, host);
      var mac = st.at === 'laptop';
      if (!ip) return S.err(mac ? 'nc: getaddrinfo: nodename nor servname provided, or not known' : 'Ncat: Could not resolve hostname "' + host + '": Name or service not known. QUITTING.', 1);
      var r = N().connect(st.net, where(st), ip, port, a.indexOf('-u') !== -1 ? 'udp' : 'tcp');
      probe(st, { tool: 'nc', ip: ip, port: port, result: r.result, at: st.at });
      if (mac) {
        if (r.result === 'ok') return S.ok('Connection to ' + host + ' port ' + port + ' [tcp/' + svc(port) + '] succeeded!');
        return S.err('nc: connectx to ' + host + ' port ' + port + ' (tcp) failed: ' + (r.result === 'refused' ? 'Connection refused' : 'Operation timed out'), 1);
      }
      if (r.result === 'ok') return S.ok('Ncat: Version 7.93 ( https://nmap.org/ncat )\nNcat: Connected to ' + ip + ':' + port + '.\nNcat: 0 bytes sent, 0 bytes received in 0.02 seconds.');
      return S.err('Ncat: Version 7.93 ( https://nmap.org/ncat )\nNcat: ' + (r.result === 'refused' ? 'Connection refused.' : 'TIMEOUT.'), 1);
    };
  }
  function sshVerb(st) {
    return function (w, a) {
      var S = X(), tgt = a.filter(function (x, i) { return x.charAt(0) !== '-' && a[i - 1] !== '-i' && a[i - 1] !== '-p' && a[i - 1] !== '-o'; })[0];
      if (!tgt) return S.err('usage: ssh [-i KEY] user@host', 255);
      if (st.at !== 'laptop') return S.err('simulation: ssh is modelled from the laptop only', 2);
      var host = tgt.split('@').pop(), ip = resolve(st, host), pi = a.indexOf('-p'), port = pi !== -1 ? +a[pi + 1] : 22;
      if (!ip) return S.err('ssh: Could not resolve hostname ' + host + ': nodename nor servname provided, or not known', 255);
      var r = N().connect(st.net, 'client', ip, port, 'tcp');
      probe(st, { tool: 'ssh', ip: ip, port: port, result: r.result, at: st.at });
      if (r.result === 'ok') return S.ok('(simulated session) Amazon Linux 2023 — ' + (r.inst ? r.inst.id : ip) + '\n[ec2-user@ip-' + (r.inst ? r.inst.privateIp.replace(/\./g, '-') : 'x') + ' ~]$ logout\nConnection to ' + host + ' closed.');
      return S.err('ssh: connect to host ' + host + ' port ' + port + ': ' + (r.result === 'refused' ? 'Connection refused' : 'Operation timed out'), 255);
    };
  }
  function pingVerb(st) {
    return function (w, a) {
      var S = X(), host = a.filter(function (x, i) { return x.charAt(0) !== '-' && !/^-c$/.test(a[i - 1] || ''); })[0];
      if (!host) return S.err('usage: ping [-c N] host', 64);
      var ip = resolve(st, host);
      if (!ip) return S.err('ping: cannot resolve ' + host + ': Unknown host', 68);
      var r = N().connect(st.net, where(st), ip, 0, 'icmp');
      if (r.result === 'ok') return S.ok('PING ' + host + ' (' + ip + '): 56 data bytes\n64 bytes from ' + ip + ': icmp_seq=0 ttl=52 time=31.2 ms\n64 bytes from ' + ip + ': icmp_seq=1 ttl=52 time=30.8 ms\n\n--- ' + host + ' ping statistics ---\n2 packets transmitted, 2 packets received, 0.0% packet loss');
      return S.err('PING ' + host + ' (' + ip + '): 56 data bytes\nRequest timeout for icmp_seq 0\nRequest timeout for icmp_seq 1\n\n--- ' + host + ' ping statistics ---\n3 packets transmitted, 0 packets received, 100.0% packet loss\n(note: ICMP is a different protocol from your service; many security groups do not allow it, so this alone proves nothing about TCP)', 2);
    };
  }
  function curlVerb(st) {
    return function (w, a) {
      var S = X(), t = st.net, v = a.indexOf('-v') !== -1, I = a.indexOf('-I') !== -1, k = a.indexOf('-k') !== -1 || a.indexOf('--insecure') !== -1;
      var mt = a.indexOf('--max-time'); var maxT = mt !== -1 ? +a[mt + 1] : (a.indexOf('-m') !== -1 ? +a[a.indexOf('-m') + 1] : null);
      var url = a.filter(function (x) { return /^https?:\/\//.test(x); })[0];
      if (!url) return S.err('curl: try \'curl --help\' (simulation: give an http:// or https:// URL)', 2);
      var m = /^(https?):\/\/([^/:]+)(?::(\d+))?(\/.*)?$/.exec(url); if (!m) return S.err('curl: (3) URL rejected: Malformed input to a URL function', 3);
      var host = m[2], port = +(m[3] || (m[1] === 'https' ? 443 : 80)), path = m[4] || '/';
      var ip = resolve(st, host), lines = [];
      if (!ip) return S.err('curl: (6) Could not resolve host: ' + host, 6);
      if (v) lines.push('*   Trying ' + ip + ':' + port + '...');
      var r = N().connect(t, where(st), ip, port, 'tcp');
      probe(st, { tool: 'curl', ip: ip, port: port, result: r.result, at: st.at, host: host });
      if (r.result === 'timeout') { var ms = maxT ? maxT * 1000 + 2 : 130021; return { out: '', err: (v ? lines.join('\n') + '\n' : '') + 'curl: (28) Failed to connect to ' + host + ' port ' + port + ' after ' + ms + ' ms: ' + (maxT ? 'Timeout was reached' : 'Couldn\'t connect to server') + '\n', code: maxT ? 28 : 28 }; }
      if (r.result === 'refused') return { out: '', err: (v ? lines.join('\n') + '\n' : '') + 'curl: (7) Failed to connect to ' + host + ' port ' + port + ' after 3 ms: Couldn\'t connect to server\n', code: 7 };
      if (v) lines.push('* Connected to ' + host + ' (' + ip + ') port ' + port);
      var ext = r.ext || r.inst || {}, tls = ext.tls || {};
      if (m[1] === 'https') {
        if (tls.error && !k) { if (v) lines.push('* TLSv1.3 (OUT), TLS handshake, Client hello (1):'); return { out: '', err: (v ? lines.join('\n') + '\n' : '') + 'curl: (60) ' + tls.error + '\nMore details here: https://curl.se/docs/sslcerts.html\n', code: 60 }; }
        if (v) lines.push('* SSL connection using TLSv1.3 / TLS_AES_128_GCM_SHA256', '* Server certificate:', '*  subject: CN=' + (tls.cn || host), '*  issuer: ' + (tls.issuer || 'C=US; O=Example Public CA; CN=Example TLS RSA CA 1'), '*  SSL certificate verify ' + (tls.error ? 'result: ' + tls.error + ', continuing anyway.' : 'ok.'));
      }
      var http = ext.http || { status: 200, body: 'ok' };
      var body = typeof http.body === 'function' ? http.body(st, r) : http.body;
      if (v) lines.push('> ' + (I ? 'HEAD' : 'GET') + ' ' + path + ' HTTP/1.1', '> Host: ' + host, '>', '< HTTP/1.1 ' + http.status + ' ' + ({ 200: 'OK', 403: 'Forbidden', 404: 'Not Found', 503: 'Service Unavailable' }[http.status] || ''), '<');
      var outTxt = (I ? 'HTTP/1.1 ' + http.status + '\n' : body + '\n');
      return { out: outTxt, err: v ? lines.join('\n') + '\n' : '', code: 0 };
    };
  }
  function digVerb(st) {
    return function (w, a) {
      var S = X(), name = a.filter(function (x) { return x.charAt(0) !== '+' && x.charAt(0) !== '@' && x.charAt(0) !== '-' && !/^(A|AAAA|NS|SOA|CNAME|TXT)$/.test(x); })[0];
      if (!name) return S.err('usage: dig [+short] NAME', 1);
      var ip = (st.net.dns || {})[name], short = a.indexOf('+short') !== -1;
      probe(st, { tool: 'dig', name: name, ip: ip, result: ip ? 'ok' : 'nxdomain', at: st.at });
      var server = st.at === 'laptop' ? '192.168.1.1' : st.net.vpcResolver || '10.20.0.2';
      if (short) return S.ok(ip || '');
      return S.ok('; <<>> DiG 9.18 (simulated) <<>> ' + name + '\n;; ->>HEADER<<- opcode: QUERY, status: ' + (ip ? 'NOERROR' : 'NXDOMAIN') + ', id: 4242\n;; flags: qr rd ra; QUERY: 1, ANSWER: ' + (ip ? 1 : 0) + '\n\n;; QUESTION SECTION:\n;' + name + '.\t\t\tIN\tA\n' + (ip ? '\n;; ANSWER SECTION:\n' + name + '.\t\t60\tIN\tA\t' + ip + '\n' : '') + '\n;; SERVER: ' + server + '#53(' + server + ') (UDP)\n');
    };
  }
  function ipVerb(st) {
    return function (w, a) {
      var S = X(), t = st.net;
      if (st.at === 'laptop') return S.err('simulation: this is macOS; use `netstat -rn` on a real Mac. In this scenario, inspect instance routes from the console (`console i-…`) or the VPC route tables with aws ec2 describe-route-tables.', 2);
      if (a[0] !== 'route' && a[0] !== 'r') return S.unsupported('ip', a[0] || '', ['route']);
      var i = t.instances[st.at], sn = t.subnets[i.subnet], c = N().parseCidr(sn.cidr), gw = N().n2ip(c.base + 1), vc = N().parseCidr(t.vpcs[sn.vpc].cidr);
      return S.ok('default via ' + gw + ' dev ens5 proto dhcp src ' + i.privateIp + ' metric 512\n' + N().n2ip(vc.base + 2) + ' via ' + gw + ' dev ens5 proto dhcp src ' + i.privateIp + ' metric 512\n' + sn.cidr + ' dev ens5 proto kernel scope link src ' + i.privateIp + ' metric 512\n' + gw + ' dev ens5 proto dhcp scope link src ' + i.privateIp + ' metric 512\n(note: the instance only knows "send everything to the VPC router"; where that router sends it is decided by the subnet\'s route table in AWS)');
    };
  }
  function ssVerb(st) {
    return function (w, a) {
      var S = X(), t = st.net;
      if (st.at === 'laptop') return S.err('simulation: ss is a Linux tool; on macOS use `lsof -nP -iTCP -sTCP:LISTEN`. Open an instance console first.', 2);
      var i = t.instances[st.at];
      return S.ok('State  Recv-Q Send-Q Local Address:Port Peer Address:Port Process\n' + (i.listeners || []).map(function (l) { return 'LISTEN 0      128          ' + (l.addr || '0.0.0.0') + ':' + l.port + '          0.0.0.0:*     users:(("' + (l.proc || 'sshd') + '",pid=' + (900 + l.port % 97) + ',fd=3))'; }).join('\n'));
    };
  }
  function consoleVerb(st) {
    return function (w, a) {
      var S = X(), id = a.filter(function (x) { return x.charAt(0) !== '-'; })[0];
      if (!id || !st.net.instances[id]) return S.err('usage: console INSTANCE_ID   (simulated out-of-band shell, like the EC2 serial console; instances: ' + Object.keys(st.net.instances).join(', ') + ')', 2);
      st.at = id; var i = st.net.instances[id];
      w.user = 'ec2-user'; w.host = 'ip-' + i.privateIp.replace(/\./g, '-');
      return S.ok('(simulated out-of-band console on ' + id + ' — ' + (i.name || '') + '; `exit` returns to your laptop)');
    };
  }
  function exitVerb(st) { return function (w) { if (st.at === 'laptop') return X().ok('(already on the laptop)'); st.at = 'laptop'; w.user = st.laptopUser || 'brett'; w.host = 'macbook'; return X().ok('(back on the laptop)'); }; }
  function noteVerb(st) {
    return function (w, a) {
      var txt = a.join(' ').replace(/^["']|["']$/g, '');
      var m = /^(hypothesis|interpretation|fix|verify)\s*:\s*(.+)$/i.exec(txt);
      if (!m) return X().err('usage: note hypothesis: … | note interpretation: … (kept with your attempt; self-reviewed)', 2);
      st.notes = st.notes || []; st.notes.push({ kind: m[1].toLowerCase(), text: m[2], at: st.clock });
      return X().ok('noted (' + m[1].toLowerCase() + ', ' + m[2].split(/\s+/).length + ' words)');
    };
  }
  function tracerouteVerb() { return function () { return X().err('simulation: traceroute is not modelled. In a VPC it mostly shows "* * *" because the VPC router does not answer like a hop; use the route tables, flow logs and a TCP test (nc -vz) instead.', 2); }; }

  function tools(st) {
    return { aws: awsVerb(st), nc: ncVerb(st), ssh: sshVerb(st), ping: pingVerb(st), curl: curlVerb(st), dig: digVerb(st), ip: ipVerb(st), ss: ssVerb(st),
      console: consoleVerb(st), exit: exitVerb(st), note: noteVerb(st), traceroute: tracerouteVerb(st), tracepath: tracerouteVerb(st), mtr: tracerouteVerb(st) };
  }

  /* World for a scenario: topology `net` (already cloned per seed), extra verbs */
  function world(seed, net, opts) {
    opts = opts || {};
    var st = { clock: 0, risky: [], hooks: [], seed: seed, variant: opts.variant, net: net, at: 'laptop', notes: [], laptopUser: 'brett' };
    net.clockRef = st;
    var verbs = tools(st);
    Object.keys(opts.verbs || {}).forEach(function (k) { verbs[k] = opts.verbs[k](st); });
    (opts.prime || []).forEach(function (p) { N().connect(net, p[0], p[1], p[2], p[3] || 'tcp'); });
    net._eph = 0;
    return { user: 'brett', host: 'macbook', cwd: '/Users/brett', files: (opts.files || []).concat([{ path: '/etc/resolv.conf', content: 'nameserver ' + (net.vpcResolver || '10.20.0.2') + '\nsearch us-west-2.compute.internal\n' }]),
      dirs: [{ path: '/Users/brett' }], sre: st, extra: X().bind(st, verbs) };
  }

  root.LXNet = root.LXNet || {};
  root.LXNet.tools = tools;
  root.LXNet.world = world;
  root.LXNet.argMap = argMap;
  if (typeof module !== 'undefined' && module.exports) module.exports = root.LXNet;
})(typeof window !== 'undefined' ? window : globalThis);
