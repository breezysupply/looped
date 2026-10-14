# L28 worked solution (instructor copy — open only after an honest attempt)

```sh
cd labs/sre-cloud-foundations/L28
P="docker compose -p looped-l28 -f work/compose.yaml"
docker logs --tail 3 looped-l28-db     # could not open file ".../global/pg_control": No such file or directory
```

The primary's control file is gone: it will not start, and recreating pg_control by hand
(`pg_resetwal` with guessed values) risks silent corruption. Leave the volume alone (postmortem
evidence) and restore into a new server.

## Choosing the recovery point

```sh
cd work/backups && sha256sum *.dump && python3 -m json.tool CATALOG.json; cd ../..
$P --profile scratch up -d scratch
docker exec looped-l28-scratch pg_restore -U beacon -d beacon --no-owner /backups/<file>
docker exec looped-l28-scratch psql -U beacon -d beacon -c "SELECT count(*), max(created_at), count(DISTINCT sensor_id) FROM records"
$P --profile scratch rm -sf scratch     # tmpfs: gone, ready for the next candidate
```

- **variant-a:** `beacon-20250311T1300Z.dump` does not match its catalog sha256 (the upload was
  cut short). `pg_restore --list` still works (TOC is at the front) but a restore stops with
  `could not read from input file: end of file` and leaves 0 rows. Recovery point:
  **`beacon-20250311T1200Z.dump`** — 2880 records, newest 11:55; loss 12:00–13:40 (400 records).
- **variant-b:** `beacon-20250311T1330Z.dump` is the newest name and its checksum is fine, but the
  catalog says it came from `standby-2 (asynchronous replica)` and a trial restore shows the newest
  record is 10:35 — the standby was lagging. Recovery point: **`beacon-20250311T1300Z.dump`** —
  3120 records, newest 12:55; loss 13:00–13:40 (160 records). Restoring 13:30 would lose 720.

## Restore and switch

```sh
$P --profile restore up -d restore
docker exec looped-l28-restore pg_restore -U beacon -d beacon --no-owner /backups/<chosen file>
sed -i 's/^DB_HOST=.*/DB_HOST=restore/' work/api.env && $P up -d api
curl -s --noproxy '*' 127.0.0.1:18028/ready; curl -s --noproxy '*' 127.0.0.1:18028/summary
```

## Update log shape (one of three or more)

```
## Update 2 — 2026-10-14T12:47Z
Status: identified
Impact: no submissions accepted since 12:32Z; status page empty.
Scope: primary database data directory damaged; API and sensors fine. Out of scope: cause of the damage (postmortem).
Actions: restoring into a new server; primary volume preserved.
Recovery point: beacon-20250311T1200Z.dump — the 13:00 file fails its catalog checksum and does not restore.
Data loss: records 12:00–13:40 of 2025-03-11 (400 records) are not in any valid backup.
Next update: 2026-10-14T13:07Z
```

The final update has `Status: resolved`, a `Validation:` line (counts, sensors, newest record,
test write) and `Next update: none — final`. Follow-ups such as: verify every backup against its
checksum after upload (owner, due date); a monthly restore drill; move hourly backups back to the
primary or alert on replica lag; postmortem from the preserved volume.

## Unsafe shortcuts (each fails a named check)

- Restoring the newest file without checking it → `recovery-point` (variant-a: empty table;
  variant-b: 720 records lost instead of 160).
- Wiping the damaged primary volume and re-initialising `db` → `primary-preserved`.
- Writing the update log afterwards with invented early times → timestamps before the incident
  start or gaps > 30 min fail `update-log`.
