/* Shared helpers for sandbox mission objectives, loaded before any mission file.

   The rule they exist to enforce: an objective is met by evidence, not by a
   string that was typed. See tests/data/test-strict.js, which asserts the
   inverse — fragments and typos must leave their objective unmet. */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };

window.GB = 1024 * 1024 * 1024;
window.MB = 1024 * 1024;

/* An objective is met by evidence, not by a string that was typed.
   did(cmdRe, outRe): some command matching cmdRe produced output of its own
   matching outRe. A half-typed command fails on the output, not the name —
   `systemctl cat` alone prints "Unit .service could not be found", which
   does not contain a heap setting, so it does not count.
   ranOk(cmdRe): matched and exited 0 — for the few commands that correctly
   print nothing at all. ranRe stays string-only for the rare objective whose
   evidence is genuinely that the command was attempted. */
window.did = function (ctx, cmdRe, outRe) {
  return ctx.ran.some(function (c, i) {
    if (!cmdRe.test(c)) return false;
    if (!outRe) return true;
    return outRe.test(((ctx.out || [])[i]) || '');
  });
};
window.ranOk = function (ctx, cmdRe) {
  return ctx.ran.some(function (c, i) {
    return cmdRe.test(c) && ((ctx.code || [])[i] || 0) === 0;
  });
};
window.ranRe = function (ctx, re) { return ctx.ran.some(function (c) { return re.test(c); }); };
window.outHas = function (ctx, re) { return ctx.last && re.test(ctx.last.out || ''); };
