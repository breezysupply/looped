/* Anduril Round 1 prep — maps the retrieval items into the app-wide pools so
   the Quiz and Drills pages and their spaced review work unchanged for this
   track. Must load after ar1-items.js.

   Only the practice items go to the generic pools: the diagnostic and the
   traffic-path exercises stay in the hub. */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.quiz = LX.quiz || [];
LX.drills = LX.drills || [];
(function () {
  var CAT = { A: 'net', B: 'awsnet', C: 'tf', D: 'bash' };
  var LEVEL = { recall: 'beginner', compute: 'beginner', explain: 'intermediate', interpret: 'intermediate', order: 'intermediate', troubleshoot: 'advanced' };
  (LX.ar1Items || []).forEach(function (q) {
    var cat = CAT[q.module] || 'net', level = LEVEL[q.kind] || 'intermediate';
    /* the shared Quiz page renders inline code only; multi-line evidence stays in the hub */
    if (/```/.test(q.q)) return;
    if (q.type === 'mcq' && q.choices && q.choices.length >= 3) {
      LX.quiz.push({ track: 'anduril', cat: cat, level: level, ar1Id: q.id, q: q.q, choices: q.choices.slice(), a: q.a, why: q.why });
    } else if (q.type === 'self') {
      LX.drills.push({ track: 'anduril', cat: cat, level: level, ar1Id: q.id, q: q.q, a: q.a, points: (q.points || []).slice(0, 5) });
    }
  });
})();
