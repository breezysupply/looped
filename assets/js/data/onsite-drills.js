/* Onsite track — every onsite question also becomes a drill, so the existing
   Drills list, stars, spaced review and mastery bars work on it unchanged.
   The Prep hub shows the full question (context, follow-ups, rubric); a drill
   card shows the spoken answer and the strong-answer criteria. */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.drills = LX.drills || [];
(function () {
  var LEVEL = { 1: 'beginner', 2: 'intermediate', 3: 'advanced' };
  (LX.onsiteQ || []).forEach(function (q) {
    LX.drills.push({
      track: 'onsite', cat: q.topic, level: LEVEL[q.level] || 'intermediate', onsiteId: q.id,
      q: q.q, a: q.spoken, points: ((q.rubric || {}).strong || []).slice(0, 5)
    });
  });
})();
