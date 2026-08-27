const H = require('../helpers');
/* Solve every mission headlessly with its own reveal commands. */
H.loadContent({ shell: true });

var only = process.argv[2];
var bad = 0;
LX.missions.forEach(function (m) {
  if (!m.objectives.length) return;
  if (only && m.id !== only) return;
  var w = LXShell.createWorld(m.world);
  var ctx = { w: w, ran: [], out: [], code: [], last: null };
  var met = {}, order = [];
  function check() {
    m.objectives.forEach(function (o) {
      if (met[o.id]) return;
      var p = false;
      try { p = !!o.done(ctx); } catch (e) { p = 'ERR ' + e.message; }
      if (p === true) { met[o.id] = true; order.push(o.id); }
      else if (typeof p === 'string') { console.log('   ' + m.id + '/' + o.id + ' threw: ' + p); }
    });
  }
  m.objectives.forEach(function (o) {
    if (met[o.id]) return;
    var line = o.reveal;
    var r;
    try { r = LXShell.run(w, line); }
    catch (e) { r = { out:'', err:'THREW ' + e.message, code:1 }; }
    ctx.ran.push(line);
    ctx.out.push((r.out || '') + (r.err || ''));
    ctx.code.push(r.code || 0);
    ctx.last = { cmd: line, out: (r.out || '') + (r.err || '') };
    if (process.env.V) console.log('$ ' + line + '\n' + ((r.out||'') + (r.err ? '[err] '+r.err : '')));
    check();
  });
  check();
  var missing = m.objectives.filter(function (o) { return !met[o.id]; }).map(function (o) { return o.id; });
  var n = m.objectives.length;
  var range = n >= 5 && n <= 6 ? '' : '  <-- ' + n + ' objectives, outside 5-6';
  if (missing.length) { bad++; console.log('FAIL ' + m.id + ' (' + n + ') unmet: ' + missing.join(', ')); }
  else console.log('ok   ' + m.id + ' — ' + n + '/' + n + ' via reveals' + range);
});
console.log(bad ? '\n' + bad + ' mission(s) not solvable by their own reveals' : '\nall missions solvable');
process.exit(bad ? 1 : 0);
