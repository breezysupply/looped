#!/usr/bin/env python3
"""A Beacon database consumer for L25 (the `ingest` and `exporter` services).

Every BEACON_INTERVAL_S seconds it reads its credential, opens a NEW
connection to PostgreSQL as BEACON_DB_USER and inserts one heartbeat row.
Re-reading the credential on every connection is deliberate: a file-based
secret can be rotated without restarting the consumer. Where the password
comes from:

  BEACON_DB_PASSWORD_FILE   path of a mounted secret file (preferred)
  BEACON_DB_PASSWORD        the password itself in the environment (legacy;
                            visible in `docker inspect` and the compose files)

Logs one JSON line per attempt with the result, the SQLSTATE on failure and
the credential's fingerprint (first 12 hex of SHA-256) — never the value.
Standard library + pgmini (mounted read-only from assets/).
"""
import hashlib
import json
import os
import sys
import time

import pgmini


def credential():
    path = os.environ.get("BEACON_DB_PASSWORD_FILE", "")
    if path:
        with open(path, "r", encoding="utf-8") as fh:
            return fh.read().strip(), "file:" + path
    value = os.environ.get("BEACON_DB_PASSWORD", "")
    return value, "env:BEACON_DB_PASSWORD"


def log(**kv):
    kv["ts"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    sys.stdout.write(json.dumps(kv, sort_keys=True) + "\n")
    sys.stdout.flush()


def main():
    name = os.environ.get("BEACON_CONSUMER", "consumer")
    user = os.environ.get("BEACON_DB_USER", "beacon_app")
    host = os.environ.get("BEACON_DB_HOST", "db")
    interval = max(1.0, float(os.environ.get("BEACON_INTERVAL_S", "2")))
    while True:
        try:
            pw, source = credential()
        except OSError as e:
            log(consumer=name, result="no-credential", error=e.strerror, source=os.environ.get("BEACON_DB_PASSWORD_FILE", ""))
            time.sleep(interval)
            continue
        fp = hashlib.sha256(pw.encode("utf-8")).hexdigest()[:12] if pw else "none"
        try:
            conn = pgmini.connect(f"host={host} port=5432 user={user} dbname=beacon sslmode=disable password={pw}", connect_timeout=3, application_name=name)
            try:
                conn.execute("INSERT INTO heartbeats (consumer, db_user, credential_fp) VALUES ("
                             + pgmini.literal(name) + ", current_user, " + pgmini.literal(fp) + ")")
            finally:
                conn.close()
            log(consumer=name, result="ok", db_user=user, source=source, credential_fp=fp)
        except pgmini.PgError as e:
            log(consumer=name, result="auth-failed" if e.code in ("28P01", "28000") else "error", sqlstate=e.code, message=e.message, db_user=user, source=source, credential_fp=fp)
        except (pgmini.PgConnectionError, OSError) as e:
            log(consumer=name, result="unreachable", error=str(e)[:120], db_user=user)
        time.sleep(interval)


if __name__ == "__main__":
    main()
