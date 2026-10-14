/* Storage schema v3 (the SRE track) in plain node: the migration snapshots
   every existing key before changing anything, creates lx.sre only when
   absent, is idempotent, and rollback() restores the exact pre-migration
   store. The browser-level version of this check lives in
   tests/ui/test-store.js. */
const H = require('../helpers');
let fails = 0, passes = 0;
function ok(cond, label, detail) { if (cond) { passes++; return; } fails++; console.log('FAIL ' + label + (detail ? '\n  ' + String(detail).slice(0, 300) : '')); }

function fresh(initial) {
  const store = Object.assign({}, initial || {});
  global.window = global;
  global.localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  };
  delete require.cache[require.resolve(H.repoFile('assets/js/store.js'))];
  require(H.repoFile('assets/js/store.js'));
  return store;
}

/* an install with real v2 progress */
const v2 = {
  'lx.schema': '2',
  'lx.cards': JSON.stringify({ 'c:truncate~abc123': { front: 'x', back: 'y', ivl: 6 } }),
  'lx.saved': JSON.stringify(['c:truncate~abc123']),
  'lx.onsite': JSON.stringify({ lessons: { 'les-reconcile': true }, real: { 'ons-real-01': { status: 'verified' } } }),
  'lx.sandbox': JSON.stringify({ 'ons-lab-01': { done: true, modes: { guided: { done: true } } } }),
  'lx.streak': JSON.stringify({ last: '2026-10-01', days: 3 })
};
let s = fresh(v2);
ok(LXStore.SCHEMA === 3 && LXStore.migrated.from === 2 && LXStore.migrated.ran.join() === '3', 'v2 install migrates to v3 running migration 3', JSON.stringify(LXStore.migrated));
ok(s['lx.sre'] === JSON.stringify({ v: 1 }), 'lx.sre created on migration');
Object.keys(v2).filter(k => k !== 'lx.schema').forEach(k => ok(s[k] === v2[k], 'existing key untouched: ' + k));
const backup = JSON.parse(s['lx.backup']);
ok(backup.schema === 2 && Object.keys(backup.data).length === Object.keys(v2).length && backup.data['lx.cards'] === v2['lx.cards'], 'backup snapshot holds every pre-migration key');
ok(LXStore.KEYS.indexOf('lx.sre') !== -1 && LXStore.KEYS.indexOf('lx.backup') !== -1, 'new keys are owned (exported, reset)');

/* progress after the migration, then a second run must change nothing */
s['lx.sre'] = JSON.stringify({ v: 1, attempts: { a1: { activityId: 'L01', outcome: 'passed' } } });
const again = LXStore.migrate();
ok(again.ran.length === 0 && JSON.parse(s['lx.sre']).attempts.a1.activityId === 'L01', 'second migrate is a no-op and keeps attempts');
ok(JSON.parse(s['lx.backup']).data['lx.cards'] === v2['lx.cards'] && !('lx.sre' in JSON.parse(s['lx.backup']).data), 'backup is not overwritten by later state');

/* rollback restores the snapshot exactly and removes keys the migration added */
const rb = LXStore.rollback();
ok(rb.ok && rb.schema === 2 && s['lx.schema'] === '2' && !('lx.sre' in s), 'rollback restores schema 2 and removes lx.sre', JSON.stringify(rb));
Object.keys(v2).forEach(k => ok(s[k] === v2[k], 'rollback restored ' + k));
ok('lx.backup' in s, 'backup kept so rollback can repeat');
const re = LXStore.migrate();
ok(re.ran.join() === '3' && s['lx.sre'] === JSON.stringify({ v: 1 }), 'migrating again after rollback works');

/* fresh install: no migration, no backup needed */
s = fresh({});
ok(LXStore.migrated.from === 3 && LXStore.migrated.ran.length === 0 && !('lx.backup' in s), 'fresh install does not migrate or snapshot');
ok(LXStore.rollback().ok === false, 'rollback without a backup is refused');

/* export / import round trip includes lx.sre and brings the schema forward */
s = fresh(v2);
s['lx.sre'] = JSON.stringify({ v: 1, attempts: { a2: { activityId: 'S01' } } });
const exported = LXStore.exportAll();
const s2 = fresh({});
const r = LXStore.importAll(exported);
ok(r.ok && JSON.parse(s2['lx.sre']).attempts.a2.activityId === 'S01' && s2['lx.schema'] === '3', 'export/import round-trips lx.sre', JSON.stringify(r));
ok(LXStore.importAll('{"data":{"lx.evil":"1"}}').ok && !('lx.evil' in s2), 'import ignores keys it does not own');

console.log((fails ? fails + ' failed, ' : '') + passes + ' store checks passed');
process.exit(fails ? 1 : 0);
