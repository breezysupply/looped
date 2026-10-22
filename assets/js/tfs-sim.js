/* A simulated Terraform command line for the Terraform + AWS tech-screen
   course (window.LXTfSim).

   What it is: a small state machine that teaches command order and what
   each command is for. It reads the learner's files with the practice HCL
   parser (LXHcl), so its plans follow what was actually typed: add a
   resource and the plan shows it; change a CIDR and the plan shows an update
   or a replacement; run plan before init and it refuses.

   What it is not: Terraform. It never downloads providers, never calls AWS,
   cannot check provider schemas (unknown arguments slip through), and
   models replacement only for a short list of common arguments. Every
   output starts with "(simulated)" and the UI labels it the same way. The
   real commands are in each lab's "Local Terraform" panel. */
(function (root) {
  'use strict';
  function H() { return root.LXHcl; }

  /* arguments whose change forces replacement, for the resources the course
     uses (a real plan is authoritative; this list is deliberately short) */
  var FORCE_NEW = {
    terraform_data: ['triggers_replace'],
    aws_vpc: ['cidr_block'],
    aws_subnet: ['vpc_id', 'cidr_block', 'availability_zone'],
    aws_internet_gateway: [],
    aws_route_table: ['vpc_id'],
    aws_route: ['route_table_id', 'destination_cidr_block'],
    aws_route_table_association: ['subnet_id'],
    aws_security_group: ['name', 'name_prefix', 'description', 'vpc_id'],
    aws_vpc_security_group_ingress_rule: ['security_group_id'],
    aws_vpc_security_group_egress_rule: ['security_group_id'],
    aws_instance: ['ami', 'subnet_id', 'availability_zone', 'associate_public_ip_address'],
    aws_eip: ['domain'],
    aws_nat_gateway: ['allocation_id', 'subnet_id', 'connectivity_type'],
    aws_s3_bucket: ['bucket'],
    aws_s3_bucket_public_access_block: ['bucket'],
    aws_s3_bucket_versioning: ['bucket'],
    aws_s3_bucket_server_side_encryption_configuration: ['bucket'],
    aws_lb: ['name', 'name_prefix', 'internal', 'load_balancer_type'],
    aws_lb_target_group: ['name', 'name_prefix', 'port', 'protocol', 'vpc_id'],
    aws_lb_listener: ['load_balancer_arn'],
    aws_lb_target_group_attachment: ['target_group_arn', 'target_id', 'port']
  };
  var META = { count: 1, for_each: 1, depends_on: 1, provider: 1, lifecycle: 1, provisioner: 1, connection: 1 };
  /* the one resource whose schema the simulator knows, so Build 0's
     attribute typos fail the way Terraform fails them */
  var TERRAFORM_DATA = { args: ['input', 'triggers_replace'], attrs: ['id', 'input', 'output', 'triggers_replace'] };
  var KAA = '(known after apply)';

  function create() { return { v: 1, initialized: false, providers: [], state: {}, outputs: {}, pending: null, serial: 0, applied: 0 }; }

  /* ── command-line parsing ──────────────────────────────────────── */
  function tokens(line) {
    var out = [], cur = '', q = null, had = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (q) { if (c === q) q = null; else cur += c; continue; }
      if (c === '"' || c === "'") { q = c; had = true; continue; }
      if (/\s/.test(c)) { if (cur || had) out.push(cur); cur = ''; had = false; continue; }
      cur += c;
    }
    if (cur || had) out.push(cur);
    return out;
  }
  function flags(args) {
    var f = { vars: {}, auto: false, check: false, rest: [], bad: null };
    for (var i = 0; i < args.length; i++) {
      var a = args[i];
      if (a === '-auto-approve') f.auto = true;
      else if (a === '-check') f.check = true;
      else if (a === '-var' || a === '--var') { var kv = args[++i] || ''; var eq = kv.indexOf('='); if (eq < 1) { f.bad = 'the -var option requires name=value'; } else f.vars[kv.slice(0, eq)] = kv.slice(eq + 1); }
      else if (/^-var=/.test(a)) { var kv2 = a.slice(5), eq2 = kv2.indexOf('='); if (eq2 < 1) f.bad = 'the -var option requires name=value'; else f.vars[kv2.slice(0, eq2)] = kv2.slice(eq2 + 1); }
      else if (/^-(backend|input|no-color|refresh|out|compact-warnings|lock)/.test(a)) { if (a === '-out') i++; }
      else f.rest.push(a);
    }
    return f;
  }

  /* ── values, as Terraform prints them ──────────────────────────── */
  function isUnknown(v) { return v && typeof v === 'object' && v.unknown; }
  /* col: the indentation of the line the value starts on */
  function show(v, col) {
    col = col || '';
    if (isUnknown(v) || v === KAA) return KAA;
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'string') return v.indexOf('\n') !== -1 ? '<<-EOT\n' + v.replace(/\n$/, '').split('\n').map(function (l) { return col + '    ' + l; }).join('\n') + '\n' + col + 'EOT' : JSON.stringify(v);
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) return v.length ? '[\n' + v.map(function (x) { return col + '    ' + show(x, col + '    ') + ','; }).join('\n') + '\n' + col + ']' : '[]';
    var ks = Object.keys(v).sort(); if (!ks.length) return '{}';
    var w = Math.max.apply(null, ks.map(function (k) { return k.length; }));
    return '{\n' + ks.map(function (k) { return col + '    ' + pad(k, w) + ' = ' + show(v[k], col + '    '); }).join('\n') + '\n' + col + '}';
  }
  function pad(s, n) { while (s.length < n) s += ' '; return s; }
  function norm(v) {
    if (isUnknown(v)) return KAA;
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') { var o = {}; Object.keys(v).sort().forEach(function (k) { o[k] = norm(v[k]); }); return o; }
    return v === undefined ? null : v;
  }

  /* ── the desired state from the files ──────────────────────────── */
  function addressOf(res, key) { return res.rtype + '.' + res.name + (key === null || key === undefined ? '' : typeof key === 'number' ? '[' + key + ']' : '["' + key + '"]'); }
  function snapshot(M, block, each) {
    var o = {};
    Object.keys(block.attrs).forEach(function (k) { if (!META[k]) o[k] = norm(M.evalIn(block.attrs[k].ast, each)); });
    (block.blocks || []).forEach(function (b) { if (META[b.type]) return; (o[b.type] = o[b.type] || []).push(snapshot(M, b, each)); });
    return o;
  }
  function desired(M) {
    var out = {}, errs = [];
    M.resources.forEach(function (res) {
      var inst = M.instancesOf(res);
      if (!inst) { errs.push('Error: Invalid ' + (res.attrs.for_each ? 'for_each' : 'count') + ' argument\n\n  on ' + res.file + ' line ' + res.line + ', in resource "' + res.rtype + '" "' + res.name + '":\n\nThe ' + (res.attrs.for_each ? 'for_each' : 'count') + ' value depends on values that cannot be determined until apply (or could not be evaluated by this simulator).'); return; }
      inst.forEach(function (i) { var each = i.key === null ? null : i; out[addressOf(res, i.key)] = { type: res.rtype, name: res.name, key: i.key, attrs: snapshot(M, res, each), block: res }; });
    });
    Object.keys(out).forEach(function (a) { out[a].M = M; });
    return { want: out, errs: errs };
  }

  /* ── checks before planning ────────────────────────────────────── */
  function needsAws(M) {
    return M.resources.concat(M.data).some(function (r) { return /^aws_/.test(r.rtype); }) || M.providers.some(function (p) { return p.labels[0] === 'aws'; });
  }
  function providerSet(M) { return needsAws(M) ? ['hashicorp/aws'] : []; }
  function staticErrors(M) {
    var out = [];
    M.errors.forEach(function (e) { out.push('Error: ' + e.message + '\n\n  on ' + e.file + ' line ' + e.line + '\n\n(practice parser message — terraform validate words this differently)'); });
    if (out.length) return out;
    M.dangling().forEach(function (d) {
      var kind = /^var\./.test(d) ? 'Reference to undeclared input variable' : /^local\./.test(d) ? 'Reference to undeclared local value' : 'Reference to undeclared resource';
      out.push('Error: ' + kind + '\n\n  ' + d);
    });
    /* terraform_data is the only schema the simulator knows */
    M.resources.filter(function (r) { return r.rtype === 'terraform_data'; }).forEach(function (r) {
      Object.keys(r.attrs).forEach(function (k) { if (!META[k] && TERRAFORM_DATA.args.indexOf(k) === -1) out.push('Error: Unsupported argument\n\n  on ' + r.file + ' line ' + r.attrs[k].line + ', in resource "terraform_data" "' + r.name + '":\n\nAn argument named "' + k + '" is not expected here.'); });
    });
    var all = M.resources.concat(M.outputs.map(function (o) { return { attrs: o.attrs, blocks: [] }; }));
    all.forEach(function (b) {
      Object.keys(b.attrs).forEach(function (k) {
        M.refsOf(b.attrs[k].ast).forEach(function (ref) {
          if (ref.kind === 'resource' && ref.type === 'terraform_data' && ref.attr && TERRAFORM_DATA.attrs.indexOf(ref.attr) === -1) {
            out.push('Error: Unsupported attribute\n\n  terraform_data.' + ref.name + '.' + ref.attr + '\n\nThis object has no argument, nested block, or exported attribute named "' + ref.attr + '".' + (ref.attr === 'outputs' ? ' Did you mean "output"?' : ''));
          }
        });
      });
    });
    return out;
  }
  function variableErrors(M, given) {
    var out = [];
    Object.keys(given).forEach(function (k) { if (!M.variables[k]) out.push('Error: Value for undeclared variable\n\nA variable named "' + k + '" was assigned on the command line, but the root module does not declare a variable of that name.'); });
    Object.keys(M.variables).forEach(function (name) {
      var v = M.variables[name], has = Object.prototype.hasOwnProperty.call(given, name);
      if (!has && !v.attrs['default']) { out.push('Error: No value for required variable\n\n  on ' + v.file + ' line ' + v.line + ':\n\nThe root module input variable "' + name + '" is not set, and has no default value. Use a -var or -var-file command line argument to provide a value for this variable.'); return; }
      var type = v.attrs.type ? v.attrs.type.raw : '';
      if (has && type === 'number' && isNaN(Number(given[name]))) { out.push('Error: Invalid value for input variable\n\nThe given value is not suitable for var.' + name + ': a number is required.'); return; }
      M.sub(v, 'validation').forEach(function (val) {
        if (!val.attrs.condition) return;
        var ok = M.eval(val.attrs.condition.ast, 0);
        if (ok === false) out.push('Error: Invalid value for variable\n\n  on ' + v.file + ' line ' + val.line + ':\n\n' + (val.attrs.error_message ? M.eval(val.attrs.error_message.ast, 0) : 'Validation failed.') + '\n\nThis was checked by the validation rule at ' + v.file + ':' + val.line + '.');
      });
    });
    return out;
  }

  /* ── plan ──────────────────────────────────────────────────────── */
  function diff(sim, want) {
    var acts = [];
    Object.keys(want).sort().forEach(function (a) {
      var cur = sim.state[a], w = want[a];
      if (!cur) { acts.push({ op: 'create', addr: a, want: w }); return; }
      var changed = Object.keys(w.attrs).concat(Object.keys(cur.attrs)).filter(function (k, i, arr) { return arr.indexOf(k) === i && JSON.stringify(w.attrs[k]) !== JSON.stringify(cur.attrs[k]); });
      if (!changed.length) return;
      var forced = changed.filter(function (k) { return (FORCE_NEW[w.type] || []).indexOf(k) !== -1; });
      acts.push({ op: forced.length ? 'replace' : 'update', addr: a, want: w, cur: cur, changed: changed, forced: forced });
    });
    Object.keys(sim.state).sort().forEach(function (a) { if (!want[a]) acts.push({ op: 'delete', addr: a, cur: sim.state[a] }); });
    /* a replaced object gets new IDs, so whatever references it changes too */
    for (var guard = 0; guard < 20; guard++) {
      var replaced = {}, grew = false;
      acts.forEach(function (a) { if (a.op === 'replace') replaced[a.want.type + '.' + a.want.name] = 1; });
      Object.keys(want).sort().forEach(function (addr) {
        var w = want[addr], cur = sim.state[addr]; if (!cur || !w.block) return;
        var act = acts.filter(function (a) { return a.addr === addr; })[0];
        if (act && act.op === 'replace') return;
        var hit = Object.keys(w.block.attrs).filter(function (k) { return !META[k] && w.M.refsOf(w.block.attrs[k].ast).some(function (r) { return r.kind === 'resource' && replaced[r.type + '.' + r.name]; }); });
        if (!hit.length) return;
        var forced = hit.filter(function (k) { return (FORCE_NEW[w.type] || []).indexOf(k) !== -1; });
        if (!act) { act = { op: 'update', addr: addr, want: w, cur: cur, changed: [], forced: [], via: [] }; acts.push(act); grew = true; }
        hit.forEach(function (k) { if (act.changed.indexOf(k) === -1) { act.changed.push(k); act.via = (act.via || []).concat([k]); grew = true; } });
        if (forced.length && act.op !== 'replace') { act.op = 'replace'; act.forced = act.forced.concat(forced); grew = true; }
      });
      if (!grew) break;
    }
    acts.sort(function (x, y) { return x.addr < y.addr ? -1 : 1; });
    return acts;
  }
  function body(attrs, sign, ind) {
    var ks = Object.keys(attrs).sort(), w = Math.max.apply(null, ks.map(function (k) { return k.length; }).concat([2]));
    var lines = [ind + '      ' + sign + ' ' + pad('id', w) + ' = ' + (sign === '-' ? '(simulated)' : KAA)];
    ks.forEach(function (k) { var v = attrs[k]; if (Array.isArray(v) && v.length && v[0] && typeof v[0] === 'object') { v.forEach(function (b) { lines.push(ind + '      ' + sign + ' ' + k + ' {'); Object.keys(b).sort().forEach(function (bk) { lines.push(ind + '          ' + sign + ' ' + bk + ' = ' + show(b[bk], ind + '            ')); }); lines.push(ind + '        }'); }); return; } lines.push(ind + '      ' + sign + ' ' + pad(k, w) + ' = ' + show(v, ind + '        ')); });
    return lines.join('\n');
  }
  function planText(acts, M, opts) {
    if (!acts.length) return 'No changes. Your infrastructure matches the configuration.\n\nTerraform has compared your real infrastructure against your configuration\nand found no differences, so no changes are needed.' + (opts.aws ? '\n\n(simulated: compared with this simulator\'s own state, not with AWS)' : '');
    var n = { create: 0, update: 0, delete: 0, replace: 0 }, out = [];
    var syms = [];
    acts.forEach(function (a) { n[a.op]++; });
    if (n.create) syms.push('  + create'); if (n.update) syms.push('  ~ update in-place'); if (n.delete) syms.push('  - destroy'); if (n.replace) syms.push('-/+ destroy and then create replacement');
    out.push('Terraform will perform the following actions:', '');
    acts.forEach(function (a) {
      var t = a.addr.split('.')[0], nm = a.addr.slice(t.length + 1).replace(/\[.*$/, '');
      if (a.op === 'create') out.push('  # ' + a.addr + ' will be created', '  + resource "' + t + '" "' + nm + '" {', body(a.want.attrs, '+', ''), '    }', '');
      else if (a.op === 'delete') out.push('  # ' + a.addr + ' will be destroyed', '  - resource "' + t + '" "' + nm + '" {', body(a.cur.attrs, '-', ''), '    }', '');
      else {
        out.push('  # ' + a.addr + (a.op === 'replace' ? ' must be replaced' : ' will be updated in-place'), (a.op === 'replace' ? '-/+' : '  ~') + ' resource "' + t + '" "' + nm + '" {');
        a.changed.forEach(function (k) { var via = (a.via || []).indexOf(k) !== -1; out.push('      ~ ' + k + ' = ' + (via ? '(old value)' : show(a.cur.attrs[k], '        ')) + ' -> ' + (via ? KAA : show(a.want.attrs[k], '        ')) + (a.forced.indexOf(k) !== -1 ? ' # forces replacement' : '')); });
        out.push('        # (unchanged attributes hidden)', '    }', '');
      }
    });
    out.push('Plan: ' + (n.create + n.replace) + ' to add, ' + n.update + ' to change, ' + (n.delete + n.replace) + ' to destroy.');
    var outs = M.outputs.filter(function (o) { return o.attrs.value; });
    if (outs.length) {
      out.push('', 'Changes to Outputs:');
      outs.forEach(function (o) { out.push('  ' + (opts.prevOutputs && Object.prototype.hasOwnProperty.call(opts.prevOutputs, o.name) ? '~' : '+') + ' ' + o.name + ' = ' + KAA); });
    }
    return syms.length ? 'Terraform used the selected providers to generate the following execution\nplan. Resource actions are indicated with the following symbols:\n' + syms.join('\n') + '\n\n' + out.join('\n') : out.join('\n');
  }

  /* ── one command line ──────────────────────────────────────────── */
  function run(sim, files, line) {
    var t = tokens(String(line || '').trim());
    if (!t.length) return { out: '', code: 0 };
    var r = exec(sim, files, t);
    r.out = '(simulated)\n' + r.out;
    return r;
  }
  function model(files, vars) { return new (H().Model)(files, { vars: vars || {} }); }
  function fail(text) { return { out: text, code: 1 }; }
  function exec(sim, files, t) {
    if (sim.pending) {
      var p = sim.pending; sim.pending = null;
      if (t.join(' ') !== 'yes') return { out: (p.kind === 'destroy' ? 'Destroy' : 'Apply') + ' cancelled.', code: 1 };
      return p.kind === 'destroy' ? doDestroy(sim, files) : doApply(sim, files, p.vars);
    }
    if (t[0] === 'help') return { out: HELP, code: 0 };
    if (t[0] === 'ls') return { out: Object.keys(files).sort().join('  ') + (sim.applied ? '  terraform.tfstate' : ''), code: 0 };
    if (t[0] === 'cat') { var f = t[1]; if (f === 'terraform.tfstate') return { out: sim.applied ? stateJson(sim) : 'cat: terraform.tfstate: No such file or directory', code: sim.applied ? 0 : 1 }; return files[f] != null ? { out: files[f], code: 0 } : fail('cat: ' + f + ': No such file or directory'); }
    if (t[0] !== 'terraform') return fail('This simulated terminal only understands terraform commands, ls, cat and help.');
    var cmd = t[1], f2 = flags(t.slice(2));
    if (f2.bad) return fail('Error: Invalid -var option\n\n' + f2.bad);
    switch (cmd) {
      case undefined: case '-help': return { out: HELP, code: 0 };
      case 'version': case '-version': return { out: 'This simulator is not a Terraform binary. The course was checked with Terraform v1.13.3 and hashicorp/aws v6.69.1; run `terraform version` locally to see yours.', code: 0 };
      case 'init': return doInit(sim, files);
      case 'fmt': return { out: 'The browser does not run terraform fmt, so formatting was not checked.\nLocally: `terraform fmt` rewrites files to the canonical style; `terraform fmt -check` changes nothing and exits non-zero if any file needs formatting. Formatting says nothing about whether the configuration is correct.', code: 0 };
      case 'validate': return doValidate(sim, files);
      case 'plan': return doPlan(sim, files, f2.vars);
      case 'apply':
        var pl = doPlan(sim, files, f2.vars);
        if (pl.code) return pl;
        if (!pl.acts.length) return { out: pl.out + '\n\nApply complete! Resources: 0 added, 0 changed, 0 destroyed.', code: 0 };
        if (f2.auto) { var ap = doApply(sim, files, f2.vars); return { out: pl.out + '\n\n' + ap.out, code: ap.code }; }
        sim.pending = { kind: 'apply', vars: f2.vars };
        return { out: pl.out + '\n\nDo you want to perform these actions?\n  Terraform will perform the actions described above.\n  Only \'yes\' will be accepted to approve.\n\n  Enter a value: (type yes)', code: 0, prompt: true };
      case 'destroy':
        if (!sim.initialized) return notInit();
        if (!Object.keys(sim.state).length) return { out: 'No changes. No objects need to be destroyed.\n\nDestroy complete! Resources: 0 destroyed.', code: 0 };
        var dl = Object.keys(sim.state).sort().map(function (a) { return '  # ' + a + ' will be destroyed'; }).join('\n') + '\n\nPlan: 0 to add, 0 to change, ' + Object.keys(sim.state).length + ' to destroy.';
        if (f2.auto) { var dd = doDestroy(sim, files); return { out: dl + '\n\n' + dd.out, code: 0 }; }
        sim.pending = { kind: 'destroy' };
        return { out: dl + '\n\nDo you really want to destroy all resources?\n  Only \'yes\' will be accepted to confirm.\n\n  Enter a value: (type yes)', code: 0, prompt: true };
      case 'output':
        if (!sim.applied) return { out: 'Warning: No outputs found\n\nThe state file either has no outputs defined, or all the defined outputs\nare empty. Apply a configuration that defines outputs first.', code: 0 };
        var names = f2.rest.length ? f2.rest : Object.keys(sim.outputs).sort();
        var miss = names.filter(function (n2) { return !Object.prototype.hasOwnProperty.call(sim.outputs, n2); });
        if (miss.length) return fail('Error: Output "' + miss[0] + '" not found');
        return { out: names.map(function (n2) { return (f2.rest.length ? '' : n2 + ' = ') + sim.outputs[n2]; }).join('\n'), code: 0 };
      case 'state':
        if (f2.rest[0] === 'list') return { out: Object.keys(sim.state).sort().join('\n') || '(no resources in state)', code: 0 };
        if (f2.rest[0] === 'show') { var s = sim.state[f2.rest[1]]; if (!s) return fail('Error: No instance found for the given address!'); return { out: '# ' + f2.rest[1] + ':\nresource "' + s.type + '" "' + s.name + '" {\n' + body(s.attrs, ' ', '').replace(/^ {4} {2}/gm, '    ') + '\n}', code: 0 }; }
        return fail('Usage (simulated subset): terraform state list | terraform state show ADDRESS');
      case 'show': return { out: sim.applied ? Object.keys(sim.state).sort().map(function (a) { return '# ' + a + ':'; }).join('\n') + '\n\n' + Object.keys(sim.outputs).sort().map(function (n3) { return n3 + ' = ' + sim.outputs[n3]; }).join('\n') : 'No state.', code: 0 };
      default: return fail('Terraform has no command named "' + cmd + '" in this simulator. Try: init, validate, plan, apply, destroy, output, state list, show, fmt.');
    }
  }
  function notInit() { return fail('Error: this working directory has not been initialized.\n\nRun `terraform init` first. Real Terraform needs it before validate, plan and apply whenever providers or modules are involved: it installs them under .terraform/ and records versions in .terraform.lock.hcl.'); }
  function doInit(sim, files) {
    var M = model(files);
    if (!M.ok) return fail(staticErrors(M).join('\n\n'));
    var prov = providerSet(M), lines = ['Initializing the backend...'];
    if (prov.length) {
      var pin = M.providerPin(), c = pin && pin.version ? pin.version : '(none — any version)';
      lines.push('Initializing provider plugins...', '- Finding hashicorp/aws versions matching "' + c + '"...', '  (simulated: nothing was downloaded. Locally this step downloads the provider into .terraform/ and writes .terraform.lock.hcl, which you commit.)');
      if (!pin || !pin.version) lines.push('', 'Warning: no version constraint for hashicorp/aws — a later init could pick a newer major version. Add one in required_providers.');
    } else lines.push('Initializing provider plugins...', '- terraform_data is built into Terraform, so there is nothing to download.', '  (Locally no .terraform.lock.hcl is written for a configuration that uses only built-in resources.)');
    lines.push('', 'Terraform has been successfully initialized!');
    sim.initialized = true; sim.providers = prov;
    return { out: lines.join('\n'), code: 0 };
  }
  function providersChanged(sim, M) { var p = providerSet(M); return p.some(function (x) { return sim.providers.indexOf(x) === -1; }); }
  function doValidate(sim, files) {
    if (!sim.initialized) return notInit();
    var M = model(files);
    if (M.ok && providersChanged(sim, M)) return fail('Error: Missing required provider\n\nThis configuration requires provider registry.terraform.io/hashicorp/aws, but that provider isn\'t available. Run terraform init.');
    var e = staticErrors(M);
    if (e.length) return fail(e.join('\n\n'));
    return { out: 'No structural errors found by the practice parser.\n\nThis is NOT `terraform validate`: the simulator does not load provider schemas, so misspelled arguments and wrong types on AWS resources are not caught here. Run `terraform validate` locally for that.', code: 0 };
  }
  function doPlan(sim, files, vars) {
    if (!sim.initialized) return notInit();
    var M = model(files, vars);
    if (M.ok && providersChanged(sim, M)) return fail('Error: Inconsistent dependency lock file\n\nThe configuration now requires hashicorp/aws, which was not installed when you ran init. Run terraform init.');
    var e = staticErrors(M);
    if (e.length) return fail(e.join('\n\n'));
    var ve = variableErrors(M, vars || {});
    if (ve.length) return fail(ve.join('\n\n'));
    var d = desired(M);
    if (d.errs.length) return fail(d.errs.join('\n\n'));
    var acts = diff(sim, d.want), aws = needsAws(M);
    var note = aws ? '\n\nNote (simulated): a real plan calls AWS APIs to refresh existing objects' + (M.data.length ? ' and to read data sources (' + M.data.map(function (x) { return 'data.' + x.rtype + '.' + x.name; }).join(', ') + ')' : '') + ', so it needs credentials. Nothing was sent to AWS. Replacement markers here are modelled for common arguments only.' : '';
    return { out: planText(acts, M, { aws: aws, prevOutputs: sim.applied ? sim.outputs : null }) + note, code: 0, acts: acts };
  }
  function doApply(sim, files, vars) {
    var M = model(files, vars), d = desired(M), acts = diff(sim, d.want), lines = [], n = { add: 0, change: 0, destroy: 0 };
    acts.forEach(function (a) {
      if (a.op === 'create') { sim.state[a.addr] = clean(a.want); lines.push(a.addr + ': Creating...', a.addr + ': Creation complete (simulated)'); n.add++; }
      else if (a.op === 'update') { sim.state[a.addr] = clean(a.want); lines.push(a.addr + ': Modifying...', a.addr + ': Modifications complete (simulated)'); n.change++; }
      else if (a.op === 'replace') { sim.state[a.addr] = clean(a.want); lines.push(a.addr + ': Destroying...', a.addr + ': Destruction complete (simulated)', a.addr + ': Creating...', a.addr + ': Creation complete (simulated)'); n.add++; n.destroy++; }
      else { delete sim.state[a.addr]; lines.push(a.addr + ': Destroying...', a.addr + ': Destruction complete (simulated)'); n.destroy++; }
    });
    sim.outputs = {};
    M.outputs.forEach(function (o) { if (!o.attrs.value) return; var v = M.eval(o.attrs.value.ast, 0); sim.outputs[o.name] = isUnknown(v) ? '(no value: a real apply would fill this in; nothing exists in AWS)' : show(norm(v), ''); });
    sim.applied = 1; sim.serial++;
    var aws = needsAws(M);
    lines.push('', 'Apply complete! Resources: ' + n.add + ' added, ' + n.change + ' changed, ' + n.destroy + ' destroyed.' + (aws ? '\n\n(simulated: no AWS resources exist. This models what Terraform would record in state.)' : ''));
    var on = Object.keys(sim.outputs).sort();
    if (on.length) lines.push('', 'Outputs:', '', on.map(function (k) { return k + ' = ' + sim.outputs[k]; }).join('\n'));
    return { out: lines.join('\n'), code: 0 };
  }
  function clean(w) { return { type: w.type, name: w.name, key: w.key, attrs: w.attrs }; }
  function doDestroy(sim) {
    var n = Object.keys(sim.state).length, lines = Object.keys(sim.state).sort().map(function (a) { return a + ': Destruction complete (simulated)'; });
    sim.state = {}; sim.outputs = {}; sim.serial++;
    lines.push('', 'Destroy complete! Resources: ' + n + ' destroyed.');
    return { out: lines.join('\n'), code: 0 };
  }
  function stateJson(sim) {
    return JSON.stringify({ version: 4, serial: sim.serial, note: 'simulated state: real state also stores every attribute AWS returns, including sensitive values in plain text', resources: Object.keys(sim.state).sort().map(function (a) { var s = sim.state[a]; return { address: a, type: s.type, attributes: s.attrs }; }), outputs: sim.outputs }, null, 2);
  }
  var HELP = 'Simulated commands (no Terraform binary, no AWS):\n  terraform init | validate | plan [-var name=value] | apply [-auto-approve] [-var …]\n  terraform destroy [-auto-approve] | output [NAME] | state list | state show ADDRESS | show | fmt\n  ls, cat FILE (cat terraform.tfstate after an apply), help\nApply and destroy ask for confirmation: type yes.';

  root.LXTfSim = { create: create, run: run, tokens: tokens, FORCE_NEW: FORCE_NEW };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.LXTfSim;
})(typeof window !== 'undefined' ? window : globalThis);
