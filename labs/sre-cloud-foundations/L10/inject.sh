#!/usr/bin/env bash
# L10 fault injection: write the exporter role's current identity policy
# (work/exporter-policy.json) and its role session (work/session.json) for
# the chosen variant. The validator reads work/.variant only to label the
# evidence; nothing prints what was changed.
#   LOOPED_VARIANT=variant-a | variant-b | variant-c   (default variant-a)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_workstation python3
V="${LOOPED_VARIANT:-${1:-variant-a}}"
case "$V" in variant-a|variant-b|variant-c) ;; *) die "unknown variant $V (variant-a | variant-b | variant-c)" ;; esac
WORK="$HERE/work"
mkdir -p "$WORK"
python3 - "$WORK" "$V" <<'PY'
import json, os, sys
work, v = sys.argv[1:3]
B = "arn:aws:s3:::beacon-archive-lab"
KA = "arn:aws:kms:us-west-2:111122223333:key/7f3c2a10-5b4e-4d6f-9a8b-1c2d3e4f5a6b"
KD = "arn:aws:kms:us-west-2:111122223333:key/0b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
read = {"Sid": "ReadExports", "Effect": "Allow", "Action": "s3:GetObject", "Resource": B + "/exports/*"}
lst = {"Sid": "ListExports", "Effect": "Allow", "Action": "s3:ListBucket", "Resource": B, "Condition": {"StringLike": {"s3:prefix": "exports/*"}}}
dec = {"Sid": "DecryptArchive", "Effect": "Allow", "Action": "kms:Decrypt", "Resource": KA}
session = {"role": "beacon-exporter", "issued": "2026-10-13T14:30:00Z", "expires": "2026-10-13T15:30:00Z",
           "source": "iameval assume (fixture; no STS call was made)", "credentials": "lab-session-not-a-real-secret"}
if v == "variant-a":
    stmts = [read, lst, dec, {"Sid": "FreezeExportsDuringMigration", "Effect": "Deny", "Action": "s3:GetObject", "Resource": B + "/exports/*"}]
elif v == "variant-b":
    stmts = [dict(read, Resource=B + "/export/*"), lst, dict(dec, Resource=KD)]
else:
    stmts = [{"Sid": "TemporaryUnblock", "Effect": "Allow", "Action": ["s3:*", "kms:*"], "Resource": "*"}]
    session.update(issued="2026-10-13T13:30:00Z", expires="2026-10-13T14:30:00Z")
with open(os.path.join(work, "exporter-policy.json"), "w", encoding="utf-8") as fh:
    json.dump({"Version": "2012-10-17", "Statement": stmts}, fh, indent=2)
    fh.write("\n")
with open(os.path.join(work, "session.json"), "w", encoding="utf-8") as fh:
    json.dump(session, fh, indent=2)
    fh.write("\n")
PY
printf '%s\n' "$V" > "$WORK/.variant"
info "work/exporter-policy.json and work/session.json written ($V)"
info "reproduce the ticket: python3 $HERE/assets/iameval.py run $HERE/assets/cases/ticket --explain"
