SET client_min_messages = warning;
SET lock_timeout = '15s';
-- L23 synthetic dataset for Beacon (deterministic: same rows, same checksum, every run).
-- 400 sensors on 20 sites; 200 000 readings, one every 40 s from 2026-01-01 (about 92 days).
-- No randomness: every value is a function of the row number.
-- Re-running this file drops and recreates the lab tables (reset.sh does exactly that).

DROP TABLE IF EXISTS status_events CASCADE;
DROP TABLE IF EXISTS readings CASCADE;
DROP TABLE IF EXISTS sensors CASCADE;

CREATE TABLE sensors (
  id          text PRIMARY KEY,
  site        text NOT NULL,
  model       text NOT NULL,
  last_status text NOT NULL DEFAULT 'unknown',
  updated_at  timestamptz NOT NULL DEFAULT '2026-01-01T00:00:00Z'
);

INSERT INTO sensors (id, site, model)
SELECT 's-' || lpad(n::text, 4, '0'),
       'site-' || lpad((n % 20)::text, 2, '0'),
       (ARRAY['bx-100', 'bx-200', 'kx-7'])[1 + n % 3]
FROM generate_series(0, 399) AS n;

CREATE TABLE readings (
  id        bigint PRIMARY KEY,
  sensor_id text NOT NULL REFERENCES sensors(id),
  site      text NOT NULL,
  ts        timestamptz NOT NULL,
  status    text NOT NULL,
  value     numeric(8,2) NOT NULL
);

INSERT INTO readings (id, sensor_id, site, ts, status, value)
SELECT i,
       's-' || lpad(((i * 7919) % 400)::text, 4, '0'),
       'site-' || lpad((((i * 7919) % 400) % 20)::text, 2, '0'),
       timestamptz '2026-01-01T00:00:00Z' + i * interval '40 seconds',
       CASE WHEN (i * 31) % 100 < 2 THEN 'fault' WHEN (i * 31) % 100 < 7 THEN 'degraded' ELSE 'ok' END,
       ((i * 2654435761) % 10000) / 100.0
FROM generate_series(1, 200000) AS i;

-- What the API writes during the incident (checkpoint c2). The idempotency key makes a
-- retried write harmless: a second INSERT with the same key does nothing.
CREATE TABLE status_events (
  id         bigserial PRIMARY KEY,
  idem_key   text NOT NULL UNIQUE,
  sensor_id  text NOT NULL REFERENCES sensors(id),
  status     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Deliberately no index on readings beyond the primary key: that is checkpoint c1.
ANALYZE sensors;
ANALYZE readings;
