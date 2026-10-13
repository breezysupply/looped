-- L17 known dataset: 480 synthetic Beacon readings (fictional sensors, no real data).
-- Restored with assets/restore-dataset.sh; verified with assets/checksum.sql against
-- assets/dataset.checksum. Deterministic: the same rows on every PostgreSQL 16 server.
\set ON_ERROR_STOP on
BEGIN;
CREATE TABLE IF NOT EXISTS readings (
  id          integer      PRIMARY KEY,
  sensor_id   text         NOT NULL,
  status      text         NOT NULL CHECK (status IN ('ok', 'warn', 'fail')),
  reading     numeric(6,2) NOT NULL,
  recorded_at timestamptz  NOT NULL
);
TRUNCATE readings;
INSERT INTO readings (id, sensor_id, status, reading, recorded_at)
SELECT g,
       's-' || lpad((g % 24)::text, 3, '0'),
       (ARRAY['ok', 'warn', 'fail'])[1 + (g * 7) % 3],
       round((15 + (g * 37 % 200) / 10.0)::numeric, 2),
       timestamptz '2026-01-05 00:00:00+00' + make_interval(mins => g)
FROM generate_series(1, 480) AS g;
COMMIT;
