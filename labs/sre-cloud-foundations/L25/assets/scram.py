#!/usr/bin/env python3
"""Print an `ALTER ROLE ... PASSWORD 'SCRAM-SHA-256$...'` statement for a
password read from a file, so the plaintext never reaches the server, the
server log, `pg_stat_activity` or your shell history.

    python3 assets/scram.py --role beacon_app work/secrets/db.txt \
      | docker exec -i looped-l25-db psql -X -q -U postgres -d beacon -v ON_ERROR_STOP=1

PostgreSQL accepts a pre-computed SCRAM-SHA-256 verifier as the password and
stores it unchanged (password_encryption only applies to plaintext). The
verifier is still sensitive — it allows an offline guessing attack — so it is
piped, not saved. `--create` emits CREATE ROLE ... LOGIN instead of ALTER.
Standard library only (RFC 5802 / RFC 7677).
"""
import argparse
import base64
import hashlib
import hmac
import os
import re
import sys

ITERATIONS = 4096  # PostgreSQL's default scram_iterations


def verifier(password: str, salt: bytes, iterations: int = ITERATIONS) -> str:
    salted = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    client_key = hmac.new(salted, b"Client Key", hashlib.sha256).digest()
    stored_key = hashlib.sha256(client_key).digest()
    server_key = hmac.new(salted, b"Server Key", hashlib.sha256).digest()
    b64 = lambda b: base64.b64encode(b).decode("ascii")  # noqa: E731
    return f"SCRAM-SHA-256${iterations}:{b64(salt)}${b64(stored_key)}:{b64(server_key)}"


def main() -> int:
    p = argparse.ArgumentParser(description="SCRAM verifier SQL for a password file")
    p.add_argument("--role", required=True)
    p.add_argument("--create", action="store_true", help="CREATE ROLE <role> LOGIN instead of ALTER ROLE")
    p.add_argument("password_file")
    a = p.parse_args()
    if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", a.role):
        sys.stderr.write("role names here are lower-case identifiers (a-z, 0-9, _)\n")
        return 2
    with open(a.password_file, "r", encoding="utf-8") as fh:
        pw = fh.read().strip()
    if len(pw) < 16:
        sys.stderr.write(f"{a.password_file}: password shorter than 16 characters; generate one with assets/newsecret.py\n")
        return 2
    v = verifier(pw, os.urandom(16))
    verb = "CREATE ROLE" if a.create else "ALTER ROLE"
    extra = " LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS" if a.create else ""
    sys.stdout.write(f"{verb} \"{a.role}\"{extra} PASSWORD '{v}';\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
