-- L25 database fixture: runs once, when the looped-l25-pgdata volume is empty.
-- beacon_app is created WITHOUT a password; setup.sh sets one from
-- work/secrets/db.txt with a SCRAM verifier (assets/scram.py).
CREATE ROLE beacon_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

CREATE TABLE heartbeats (
  id            bigserial PRIMARY KEY,
  consumer      text        NOT NULL,
  db_user       text        NOT NULL,
  credential_fp text        NOT NULL,
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX heartbeats_consumer_at ON heartbeats (consumer, at DESC);

-- synthetic records the consumers do NOT need (least privilege: no grant)
CREATE TABLE records (
  id        bigserial PRIMARY KEY,
  sensor_id text NOT NULL,
  status    text NOT NULL,
  ts        timestamptz NOT NULL DEFAULT now()
);
INSERT INTO records (sensor_id, status) SELECT 'sensor-' || g, 'ok' FROM generate_series(1, 20) g;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO beacon_app;
GRANT INSERT, SELECT ON heartbeats TO beacon_app;
GRANT USAGE ON SEQUENCE heartbeats_id_seq TO beacon_app;
