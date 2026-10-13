# L10 worked solution

## c1 — predictions

| Case | Decision | Why |
|---|---|---|
| P1 | Allow | worker.json allows PutObject on `processed/*`; the guardrail's StringNotEquals is false because the request came through the Beacon endpoint |
| P2 | ExplicitDeny | same request through another endpoint: the guardrail Deny matches, and an explicit deny beats the identity Allow |
| P3 | ImplicitDeny | api.json grants GetObject on `arn:aws:s3:::beacon-archive-lab` (the bucket), but objects are `…/exports/…`; nothing allows the object ARN |
| P4 | ExpiredToken | the session expired at 14:00; the request at 15:00 fails authentication before any policy is read |
| P5 | ImplicitDeny | the identity policy allows kms:Decrypt on the ops key, but that key policy names only `beacon-ops` and does not delegate to the account — for KMS the key policy must allow |
| P6 | Allow | no identity policy, but the bucket policy names the auditor role for `audit/*`; same account, so either side allowing is enough |
| P7 | ExplicitDeny | not "no permission": the bucket policy explicitly denies DeleteObject before 2027-01-01 (aws:CurrentTime), and deny is evaluated first |

## c2 — the ticket

Reproduce with `iameval.py run assets/cases/ticket --explain`, then decide whether it is the
policy, the session or both.

**Variant A (explicit deny).** T1 is `ExplicitDeny` with the trace naming
`exporter-policy.json#FreezeExportsDuringMigration`. It is the role's own leftover statement,
not the guardrail. Remove that statement; nothing else changes. Adding an Allow cannot help
(explicit deny wins) and editing `guardrail.json` is outside your authority — the validator
fails both.

**Variant B (incorrect resource ARN).** T1 `ImplicitDeny` (the Allow names `export/*`, singular)
and T3 `ImplicitDeny` (the key policy delegates to IAM, but the identity statement names the
database key `0b1e…`, not the archive key `7f3c…`). Correct both ARNs. Probe N08 (decrypt with
the database key) fails before the fix, which is how you know the wrong key was also a
least-privilege problem, not just an availability one.

**Variant C (expired session).** All three are `ExpiredToken`: the session ran 13:30–14:30 and
the job runs at 15:00. Someone answered the access error by allowing `s3:*` and `kms:*` on `*`,
which changed nothing (authentication fails first) and broke least privilege. Fix both:

```sh
python3 assets/iameval.py assume beacon-exporter --at 2026-10-13T14:55:00Z --duration 3600 --out work/session.json
```

and replace the broad statement with the narrow policy below.

## The narrow policy (all variants end here)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {"Sid": "ReadExports", "Effect": "Allow", "Action": "s3:GetObject",
     "Resource": "arn:aws:s3:::beacon-archive-lab/exports/*"},
    {"Sid": "ListExports", "Effect": "Allow", "Action": "s3:ListBucket",
     "Resource": "arn:aws:s3:::beacon-archive-lab",
     "Condition": {"StringLike": {"s3:prefix": "exports/*"}}},
    {"Sid": "DecryptArchive", "Effect": "Allow", "Action": "kms:Decrypt",
     "Resource": "arn:aws:kms:us-west-2:111122223333:key/7f3c2a10-5b4e-4d6f-9a8b-1c2d3e4f5a6b"}
  ]
}
```

Why each piece is the minimum: ListBucket is a bucket-level action, so it needs the bucket ARN
and a prefix condition to stay inside `exports/`; GetObject is object-level, so it needs the
object ARN pattern; SSE-KMS downloads need kms:Decrypt on that one key, and the archive key
policy delegates to IAM so the identity statement is what grants it. No endpoint condition is
needed in the role policy: the guardrail already denies anything outside the endpoint.

## Own tests (example)

Two or three Allow cases (T1–T3 with inline valid sessions) and deny cases for `processed/`
(ImplicitDeny), the other endpoint (ExplicitDeny), an expired inline session (ExpiredToken)
and ListBucket with prefix `audit/` (deny).
