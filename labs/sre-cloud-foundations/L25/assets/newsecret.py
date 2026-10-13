#!/usr/bin/env python3
"""Write a new synthetic credential to a file and print only its fingerprint.

    python3 assets/newsecret.py work/secrets/db-next.txt

The value looks like `lab-<32 hex>-not-a-real-secret`: random enough to be a
real test of rotation, obviously fake if it ever leaks into a paste. The file
is created with mode 0600 (umask-independent) and is never printed; the
fingerprint (first 12 hex of its SHA-256) is what you compare in logs and
notes. Refuses to overwrite an existing file unless --force.
"""
import argparse
import hashlib
import os
import secrets
import sys


def fingerprint(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:12]


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("path")
    p.add_argument("--force", action="store_true", help="overwrite an existing file")
    a = p.parse_args()
    if os.path.exists(a.path) and not a.force:
        sys.stderr.write(f"{a.path} exists; pass --force to replace it (the old value is then gone)\n")
        return 1
    value = "lab-" + secrets.token_hex(16) + "-not-a-real-secret"
    d = os.path.dirname(os.path.abspath(a.path))
    os.makedirs(d, mode=0o700, exist_ok=True)
    tmp = a.path + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(value + "\n")
    os.chmod(tmp, 0o600)
    os.replace(tmp, a.path)
    print(f"wrote a new credential to {a.path} (mode 0600, fingerprint {fingerprint(value)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
