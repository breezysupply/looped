-- Beacon schema 1: status records (fixture migration; L20 models schema versions, it does not run a database)
CREATE TABLE records (
  id          text PRIMARY KEY,
  sensor_id   text NOT NULL,
  status      text NOT NULL,
  status_text text,
  ts          timestamptz NOT NULL,
  idem_key    text UNIQUE
);
