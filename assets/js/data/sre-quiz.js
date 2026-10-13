/* SRE & Cloud Deployment Foundations — maps the module question banks into the
   app-wide pools so the Quiz page, stars and spaced review work unchanged.
   Must load after every sre-questions-*.js file.

   Only bank items go to the generic Quiz: gate variants stay out so a repeat
   gate attempt is not something you have already seen in a quiz round. */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.quiz = LX.quiz || [];
LX.drills = LX.drills || [];
(function () {
  var LEVEL = { 1: 'beginner', 2: 'intermediate', 3: 'advanced' };
  var mods = {};
  (LX.sreModules || []).forEach(function (m) { mods[m.id] = m; });
  (LX.sreQuestions || []).forEach(function (q) {
    if (q.pool !== 'bank') return;
    var cat = (mods[q.moduleId] || {}).cat || 'scenario';
    if ((q.type === 'mcq' || q.type === 'predict' || q.type === 'diagnose') && q.choices && q.choices.length >= 3) {
      LX.quiz.push({ track: 'sre', cat: cat, level: LEVEL[q.difficulty] || 'intermediate', sreId: q.id,
        q: (q.context ? q.context + '\n\n' : '') + q.q, choices: q.choices.slice(), a: q.a || 0, why: q.rationale });
    } else if (q.type === 'explain') {
      LX.drills.push({ track: 'sre', cat: cat, level: LEVEL[q.difficulty] || 'intermediate', sreId: q.id,
        q: q.q, a: q.answer || q.rationale, points: (q.rubric || []).slice(0, 5) });
    }
  });
})();
