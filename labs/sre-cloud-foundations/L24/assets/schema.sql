-- L24 Beacon data (deterministic). public: what a restore must bring back.
-- queue / ledger: the job queue and the downstream "delivery" side effect (checkpoint c2).
SET client_min_messages = warning;
SET lock_timeout = '15s';
DROP SCHEMA IF EXISTS queue CASCADE;
DROP SCHEMA IF EXISTS ledger CASCADE;
DROP TABLE IF EXISTS public.audit_log, public.records, public.sensors CASCADE;

CREATE TABLE public.sensors (
  id    text PRIMARY KEY,
  site  text NOT NULL,
  model text NOT NULL
);
INSERT INTO public.sensors
SELECT 's-' || lpad(n::text, 4, '0'), 'site-' || lpad((n % 20)::text, 2, '0'), (ARRAY['bx-100', 'bx-200', 'kx-7'])[1 + n % 3]
FROM generate_series(0, 399) AS n;

-- Beacon's records table (same shape as beacon/beacon/store.py)
CREATE TABLE public.records (
  id         text PRIMARY KEY,
  sensor_id  text NOT NULL REFERENCES public.sensors(id),
  status     text NOT NULL,
  ts         text NOT NULL,
  request_id text,
  idem_key   text UNIQUE
);
CREATE INDEX records_sensor ON public.records(sensor_id);

CREATE TABLE public.audit_log (
  id   bigserial PRIMARY KEY,
  at   timestamptz NOT NULL,
  note text NOT NULL
);

-- first 50 000 records and 400 audit rows: "up to last night"
INSERT INTO public.records
SELECT md5('rec-' || i), 's-' || lpad(((i * 7919) % 400)::text, 4, '0'),
       CASE WHEN (i * 31) % 100 < 3 THEN 'fault' WHEN (i * 31) % 100 < 9 THEN 'degraded' ELSE 'ok' END,
       to_char(timestamp '2026-09-01 00:00:00' + i * interval '37 seconds', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
       'req-' || substr(md5('req-' || i), 1, 16), 'idem-' || i
FROM generate_series(1, 50000) AS i;
INSERT INTO public.audit_log (at, note)
SELECT timestamptz '2026-09-01T00:00:00Z' + i * interval '3 hours', 'config change #' || i FROM generate_series(1, 400) AS i;

-- c2: a Redis-free queue in PostgreSQL and the downstream ledger
CREATE SCHEMA queue;
CREATE TABLE queue.jobs (
  id              bigserial PRIMARY KEY,
  idempotency_key text NOT NULL,          -- producers retry: the same key may be enqueued twice
  kind            text NOT NULL DEFAULT 'deliver',
  sensor_id       text NOT NULL,
  state           text NOT NULL DEFAULT 'ready' CHECK (state IN ('ready', 'leased', 'done')),
  attempts        int NOT NULL DEFAULT 0,
  leased_until    timestamptz,
  enqueued_at     timestamptz NOT NULL DEFAULT now(),
  done_at         timestamptz
);
-- fixture-controlled crashes: the worker exits before or after the side effect for this key, once
CREATE TABLE queue.faults (
  idempotency_key text PRIMARY KEY,
  mode            text NOT NULL CHECK (mode IN ('before-effect', 'after-effect')),
  used            boolean NOT NULL DEFAULT false
);
CREATE SCHEMA ledger;
-- the side effect: one row = one notification delivered downstream
CREATE TABLE ledger.deliveries (
  id              bigserial PRIMARY KEY,
  idempotency_key text NOT NULL,
  job_id          bigint NOT NULL,
  sensor_id       text NOT NULL,
  delivered_at    timestamptz NOT NULL DEFAULT now()
);
ANALYZE;
