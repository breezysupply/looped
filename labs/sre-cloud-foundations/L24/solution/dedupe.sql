-- L24 worked solution, c2: keep the first delivery per key (moving the rest to an audit table
-- the downstream team can reconcile), then make a second delivery impossible.
BEGIN;
CREATE TABLE IF NOT EXISTS ledger.removed_duplicates AS SELECT * FROM ledger.deliveries WHERE false;
WITH d AS (
  DELETE FROM ledger.deliveries x USING ledger.deliveries y
  WHERE x.idempotency_key = y.idempotency_key AND x.id > y.id
  RETURNING x.*
)
INSERT INTO ledger.removed_duplicates SELECT * FROM d;
ALTER TABLE ledger.deliveries ADD CONSTRAINT deliveries_idempotency_key_key UNIQUE (idempotency_key);
COMMIT;
