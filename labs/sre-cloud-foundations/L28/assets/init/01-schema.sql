-- L28 database fixture (runs once on an empty volume: primary, restore target, scratch).
CREATE TABLE IF NOT EXISTS records (
  id         bigserial PRIMARY KEY,
  sensor_id  text        NOT NULL,
  status     text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS records_created_at ON records (created_at);
