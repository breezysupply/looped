# L28 hints (four rungs; rungs 3–4 end independent credit for this attempt)

1. **Boundary.** Two jobs run at once: communicating (roles, scope, impact, next update) and
   recovering (what do we have, what does each option lose, how do we prove it). Write Update 1
   before you are sure of anything; say what you do not know.
2. **Evidence source.** `docker logs looped-l28-db` for the primary. For backups: `CATALOG.json`
   (what the jobs meant to produce) against `sha256sum`, `pg_restore --list` and a trial restore
   into `scratch` (what you actually have). Count records and look at the newest one.
3. **Discriminating check.** For each candidate: does the checksum match the catalog? Does a
   trial restore finish, and what is `max(created_at)`? Which source took it? The best recovery
   point is the valid backup with the newest data, not the newest file name.
4. **Root cause and fix.** The primary lost `global/pg_control`; do not repair it in place or wipe
   it. Variant-a: the 13:00 file is truncated → restore 12:00. Variant-b: the 13:30 file came from
   a lagging standby (newest 10:35) → restore 13:00. Restore into `restore`, set `DB_HOST=restore`,
   recreate `api`, validate, then write the recovery point, data loss, validation and a resolved update.
