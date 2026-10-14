-- L31 seed: a deterministic synthetic dataset in Beacon's records table (same shape as
-- beacon/beacon/store.py creates). Idempotent: re-running inserts nothing new.
--   psql -v n=240 -f seed.sql      (rebuild.sh passes n from SEED_RECORDS)
SET client_min_messages = warning;
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY, sensor_id TEXT NOT NULL, status TEXT NOT NULL, ts TEXT NOT NULL,
  request_id TEXT, idem_key TEXT UNIQUE);
CREATE INDEX IF NOT EXISTS records_sensor ON records(sensor_id);
INSERT INTO records (id, sensor_id, status, ts, request_id, idem_key)
SELECT 'seed-' || lpad(i::text, 5, '0'),
       'cap-' || lpad((i % 24)::text, 3, '0'),
       CASE WHEN i % 17 = 0 THEN 'fault' WHEN i % 5 = 0 THEN 'degraded' ELSE 'ok' END,
       to_char(timestamp '2026-10-01 00:00:00' + i * interval '90 seconds', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
       'seed-req-' || i, 'seed-idem-' || i
FROM generate_series(1, :n) AS i
ON CONFLICT (id) DO NOTHING;
-- the fingerprint the validator recomputes: count and md5 over ids and statuses in id order
SELECT count(*) AS seeded, md5(string_agg(id || ':' || status, ',' ORDER BY id)) AS fingerprint
FROM records WHERE id LIKE 'seed-%';
