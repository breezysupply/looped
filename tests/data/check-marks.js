const H = require('../helpers');
/* Every mark must appear in its output, exactly once, and be specific enough
   to be unambiguous — a highlight in the wrong place teaches the wrong thing. */
global.window = global;
global.LX = { commands: [], scenarios: [], drills: [] };
['playbooks','playbooks-more','playbook-outputs'].forEach(function (f) {
  require(H.repoFile('assets/js/data/') + f + '.js');
});
function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
var bad = 0, marks = 0, repeats = [];
LX.playbooks.forEach(function (pb) {
  (LX.pbOut[pb.id] || []).forEach(function (x, i) {
    if (!x) return;
    var body = esc(x.out);
    var list = (x.mark || []).slice().sort(function (a, b) { return b.length - a.length; });
    if (!list.length) return;
    var alt = list.map(function (m) { return esc(m).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|');
    var rx = new RegExp('(' + alt + ')(?!\\w)', 'gm');
    var hits = {};
    body.replace(rx, function (hit) { hits[hit] = (hits[hit] || 0) + 1; return hit; });
    /* a mark that only ever lands mid-token highlights the wrong thing */
    list.forEach(function (m) {
      var e = esc(m);
      if (!/^\w/.test(e)) return;
      var mid = new RegExp('\\w' + e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'm');
      if (mid.test(body)) { console.log('LANDS MID-TOKEN ' + pb.id + '[' + i + ']  ' + JSON.stringify(m)); bad++; }
    });
    list.forEach(function (m) {
      marks++;
      var e = esc(m), n = hits[e] || 0;
      if (n === 0) { console.log('NEVER MATCHES  ' + pb.id + '[' + i + ']  ' + JSON.stringify(m)); bad++; }
      else if (m.replace(/\s/g, '').length < 3) {
        /* a one- or two-character mark lands on unrelated digits */
        console.log('TOO SHORT      ' + pb.id + '[' + i + ']  ' + JSON.stringify(m)); bad++;
      } else if (n > 1) { repeats.push(pb.id + '[' + i + '] ' + JSON.stringify(m) + ' x' + n); }
    });
    if (/<mark>[^<]*<mark>/.test(body)) { console.log('NESTED  ' + pb.id + '[' + i + ']'); bad++; }
  });
});
if (repeats.length) {
  console.log('\nmarks highlighting more than one place (intended where the repetition is the point):');
  repeats.forEach(function (r) { console.log('  ' + r); });
}
console.log('\n' + marks + ' marks checked, ' + bad + ' problems');
process.exit(bad ? 1 : 0);
