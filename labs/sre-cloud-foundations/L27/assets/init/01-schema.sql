-- L27 database fixture (runs once, on an empty looped-l27-pgdata volume).
CREATE TABLE records (
  id          bigserial PRIMARY KEY,
  request_key text        NOT NULL,           -- the client's logical request (one per user action)
  idem_key    text        UNIQUE,             -- Idempotency-Key header (or a server-generated one)
  sensor_id   text        NOT NULL,
  status      text        NOT NULL,
  server      text        NOT NULL,           -- which API replica wrote it
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX records_request_key ON records (request_key);

-- the running total Beacon shows on its status page: ONE row, updated by every write
CREATE TABLE ledger (
  id         int PRIMARY KEY,
  n          bigint      NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO ledger (id, n) VALUES (1, 0);

-- used only by WRITE_PATH=append-only: one row per write, summed on read
CREATE TABLE ledger_events (
  record_id bigint PRIMARY KEY,
  at        timestamptz NOT NULL DEFAULT now()
);
