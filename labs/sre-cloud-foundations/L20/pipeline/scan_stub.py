#!/usr/bin/env python3
"""SCAN STUB — policy checks only. THIS IS NOT A VULNERABILITY SCAN.

The hosted workflow runs a real scanner (Trivy, pinned image). Locally, a real scan needs a
scanner and its vulnerability database; set LOOPED_SCAN=trivy if you have trivy with a cached DB
(`trivy image --download-db-only` once, online). Without that, this stub keeps the stage in the
pipeline and fails the gate on things it CAN check deterministically:

  - the image runs as a non-root user
  - no environment variable whose name looks like a credential carries a value
  - the image's revision label equals the commit being built (traceability)
  - the Dockerfile's FROM line pins the base image by digest
  - the Dockerfile does not ADD remote URLs

    scan_stub.py IMAGE DOCKERFILE COMMIT      → JSON report on stdout, exit 1 on any finding
"""
import json
import re
import subprocess
import sys

image, dockerfile, commit = sys.argv[1:4]
findings = []
r = subprocess.run(["docker", "image", "inspect", image], capture_output=True, text=True)
if r.returncode != 0:
    print(json.dumps({"tool": "stub", "vulnerability_scan": False, "findings": ["image %s not found" % image]}))
    sys.exit(1)
cfg = json.loads(r.stdout)[0].get("Config", {})
user = (cfg.get("User") or "").split(":")[0]
if user in ("", "0", "root"):
    findings.append("runs as root (User=%r)" % cfg.get("User"))
for e in cfg.get("Env") or []:
    name, _, value = e.partition("=")
    if re.search(r"(PASSWORD|SECRET|TOKEN|PRIVATE_KEY|API_KEY)", name, re.I) and value:
        findings.append("credential-like environment variable baked into the image: %s" % name)
labels = cfg.get("Labels") or {}
if labels.get("org.opencontainers.image.revision") != commit:
    findings.append("revision label %r != commit %s" % (labels.get("org.opencontainers.image.revision"), commit))
src = open(dockerfile, encoding="utf-8").read()
for line in re.findall(r"^\s*FROM\s+(\S+)", src, re.M | re.I):
    if "@sha256:" not in line:
        findings.append("base image not pinned by digest: %s" % line)
if re.search(r"^\s*ADD\s+https?://", src, re.M | re.I):
    findings.append("ADD of a remote URL")
print(json.dumps({"tool": "stub", "vulnerability_scan": False,
                  "label": "SCAN STUB - policy checks only, NOT a vulnerability scan",
                  "image": image, "user": cfg.get("User"), "findings": findings}, indent=1))
sys.exit(1 if findings else 0)
