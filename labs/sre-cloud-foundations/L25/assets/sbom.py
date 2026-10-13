#!/usr/bin/env python3
"""Write a small CycloneDX 1.5 SBOM (JSON) for beacon-report from its
hash-pinned requirements file.

    python3 assets/sbom.py work/patch/report/requirements.txt \
        --name beacon-report --version 0.9.1 -o work/patch/sbom.cdx.json

What it covers: the Python packages pinned in the lock (name, version,
purl, the wheel hashes the build accepts). What it does NOT cover: the base
image's Debian packages, the Python interpreter, or anything a build step
installs outside the lock — a full image SBOM comes from an image scanner
or BuildKit's SBOM attestation. An SBOM generated from the lock is only true
for the image if the image was built from that same lock: compare them.
Standard library only.
"""
import argparse
import datetime
import hashlib
import json
import re
import sys
import uuid

PIN = re.compile(r"^([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?==([A-Za-z0-9.+!_-]+)$")


def norm(name):
    return re.sub(r"[-_.]+", "-", name).lower()


def parse_lock(text):
    """Join backslash continuations; return [(name, version, [sha256...])]."""
    logical, cur = [], ""
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].rstrip() if not raw.strip().startswith("--hash") else raw.rstrip()
        if not line.strip():
            if cur:
                logical.append(cur)
                cur = ""
            continue
        if line.endswith("\\"):
            cur += line[:-1] + " "
            continue
        cur += line
        logical.append(cur)
        cur = ""
    if cur:
        logical.append(cur)
    out = []
    for ent in logical:
        parts = ent.split()
        if not parts:
            continue
        m = PIN.match(parts[0])
        if not m:
            raise ValueError(f"not an exact pin (name==version): {parts[0]!r}")
        hashes = [p.split("sha256:", 1)[1] for p in parts[1:] if p.startswith("--hash=sha256:")]
        out.append((norm(m.group(1)), m.group(3), hashes))
    return out


def main():
    p = argparse.ArgumentParser(description="CycloneDX 1.5 JSON from a hash-pinned requirements file")
    p.add_argument("lock")
    p.add_argument("--name", default="beacon-report")
    p.add_argument("--version", required=True, help="version of the application you are releasing")
    p.add_argument("-o", "--out", required=True)
    a = p.parse_args()
    with open(a.lock, "rb") as fh:
        raw = fh.read()
    try:
        pins = parse_lock(raw.decode("utf-8"))
    except ValueError as e:
        sys.stderr.write(f"{a.lock}: {e}\n")
        return 2
    comps = []
    for name, ver, hashes in sorted(pins):
        c = {"type": "library", "bom-ref": f"pkg:pypi/{name}@{ver}", "name": name, "version": ver, "purl": f"pkg:pypi/{name}@{ver}"}
        if hashes:
            c["hashes"] = [{"alg": "SHA-256", "content": h} for h in hashes]
        comps.append(c)
    bom = {
        "bomFormat": "CycloneDX", "specVersion": "1.5", "version": 1,
        "serialNumber": "urn:uuid:" + str(uuid.uuid4()),
        "metadata": {
            "timestamp": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "tools": {"components": [{"type": "application", "name": "looped-l25-sbom.py", "version": "1.0"}]},
            "component": {"type": "application", "bom-ref": f"{a.name}@{a.version}", "name": a.name, "version": a.version},
            "properties": [{"name": "looped:lock-sha256", "value": hashlib.sha256(raw).hexdigest()},
                           {"name": "looped:scope", "value": "python dependencies from the lock only; base image packages not included"}],
        },
        "components": comps,
        "dependencies": [{"ref": f"{a.name}@{a.version}", "dependsOn": [c["bom-ref"] for c in comps]}],
    }
    with open(a.out, "w", encoding="utf-8") as fh:
        json.dump(bom, fh, indent=2)
        fh.write("\n")
    print(f"wrote {a.out}: {len(comps)} components from {a.lock} (lock sha256 {hashlib.sha256(raw).hexdigest()[:12]})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
