# L10 — IAM by hand: evaluate requests, then write the narrowest fix

Module M05 · ~90 min practical · profile `workstation` · **fixtures only: no AWS account, no cost**

## Ticket

> **BEACON-OPS-1142 — exporter cannot read today's export.** The `beacon-exporter` role
> (fictional account `111122223333`) runs a nightly job that lists `exports/` in the
> `beacon-archive-lab` bucket, downloads the files and decrypts them (the objects use SSE-KMS
> with `alias/beacon-archive`). Since this afternoon it gets access errors at 15:00 UTC. Someone
> already "tried a few things". Requirements: the exporter must be able to do exactly that job,
> through the Beacon S3 VPC endpoint, and nothing else. The organisation guardrail and the bucket
> policy are owned by another team and are **not** yours to change.

The three requests the job makes are `assets/cases/ticket/T1.json` … `T3.json`.

## Objectives

- `obj-m05-02` predict allow/deny for policy and request fixtures, and propose a least-privilege
  change that preserves the other boundaries
- `obj-m05-01` place STS sessions and KMS key policies on the identity path

## The evaluator is incomplete — on purpose

`assets/iameval.py` is a **small, labelled-incomplete model of IAM evaluation**, not AWS. It
models: session expiry checked before any policy (ExpiredToken); identity policies; a same-account
bucket policy and KMS key policies (including "the key policy must allow, directly or by
delegating to the account"); explicit deny beats allow; Action wildcards (case-insensitive),
Resource wildcards (case-sensitive); the condition operators StringEquals/NotEquals,
StringLike/NotLike, DateLessThan/GreaterThan and Bool over keys such as `aws:CurrentTime`,
`aws:SourceVpce` and `s3:prefix`. It answers **Unsupported** (exit 3) for NotAction,
NotResource, NotPrincipal, ForAnyValue/ForAllValues, IfExists and policy variables, and it
ignores SCPs, permission boundaries, session policies, endpoint policies, KMS grants and
cross-account rules. Read its docstring before trusting a result.

## What is fixture-controlled

`work/exporter-policy.json` and `work/session.json` are written by `inject.sh` for one of three
variants (`LOOPED_VARIANT=variant-a|variant-b|variant-c`): an explicit deny, an incorrect
resource ARN, or an expired session. Which one you have is for you to find. Everything under
`assets/` is shipped fixture; the validator checks it is unchanged.

## Steps and checkpoints

**Checkpoint c1 — predict, then evaluate (week 14, session 1).**

1. `bash labs/sre-cloud-foundations/L10/setup.sh` (creates `work/` and the templates).
2. Read `assets/world.json` and every file in `assets/policies/`. For each case in
   `assets/cases/predict/`, write your predicted decision and one line of why into
   `work/predictions.json` **before running anything**.
3. Run `python3 labs/sre-cloud-foundations/L10/assets/iameval.py run labs/sre-cloud-foundations/L10/assets/cases/predict --explain`.
   For every case you got wrong, write the rule you missed in `evidence/L10-notes.md`, then
   correct the prediction.

**Checkpoint c2 — the ticket (week 14, session 2).**

4. Reproduce: `python3 labs/sre-cloud-foundations/L10/assets/iameval.py run labs/sre-cloud-foundations/L10/assets/cases/ticket --explain`.
   Quote the trace line for each failure in your notes. Decide: policy problem, session problem
   or both?
5. Patch `work/exporter-policy.json` to the least privilege that makes T1–T3 pass. If the session
   is the problem, get a new one the fixture way:
   `python3 labs/sre-cloud-foundations/L10/assets/iameval.py assume beacon-exporter --at 2026-10-13T14:55:00Z --duration 3600 --out labs/sre-cloud-foundations/L10/work/session.json`
   (durations above the role's MaxSessionDuration are refused, as STS would).
6. Write at least five of your own cases in `work/tests.json` (two or more expected Allow,
   three or more expected deny) and run them with `iameval.py run labs/sre-cloud-foundations/L10/work/tests.json`.
7. `python3 labs/sre-cloud-foundations/L10/validate.py --explanation-file labs/sre-cloud-foundations/L10/evidence/L10-notes.md`
   and import `evidence/latest.json`.

## What the validator checks

Your predictions against the evaluator; T1–T3 allowed by the policy alone and again with your
session; twelve probe requests (other prefixes, other buckets, write/delete, other keys,
out-of-endpoint, secrets, PassRole) all denied — the out-of-endpoint read must still be an
**explicit** deny, which proves the guardrail still applies; no Allow with a wildcard action,
`Resource: "*"`, a whole-bucket object ARN or a `key/*`; your own tests pass; fixtures unchanged.
Broadening a policy until the error goes away fails on purpose.

## Optional: real IAM simulation in your own sandbox (disabled by default)

This is separate from the lab and not part of its evidence. If, and only if, you have your own
sandbox account and choose to, the IAM policy simulator can evaluate the same identity policy
(it is an API call, not a resource, but it still needs credentials, so it is opt-in):

```sh
# NOT run by any lab script. Your account, your credentials, your decision.
aws iam simulate-custom-policy \
  --policy-input-list file://labs/sre-cloud-foundations/L10/work/exporter-policy.json \
  --action-names s3:GetObject s3:PutObject \
  --resource-arns arn:aws:s3:::beacon-archive-lab/exports/2026/10/13/export.csv
```

The simulator does not know this lab's bucket policy, key policy or guardrail unless you supply
them, and the fictional account and ARNs here do not exist; expect differences and write them
down rather than "fixing" either side.

## Pause / resume

State is `work/` and `evidence/`. `setup.sh` keeps your files; `reset.sh` restores the starting
policy and session (your policy is saved as `work/exporter-policy.json.bak`).

## Lab versus production

- Real evaluation adds SCPs/RCPs, permission boundaries, session policies, endpoint policies, KMS
  grants and encryption context; any of them can turn an Allow here into a deny there.
- In production the session comes from STS (`AssumeRole`), and "expired" shows up as
  `ExpiredToken`/`RequestExpired` in the SDK error, not as an AccessDenied. Refreshing
  credentials is a client fix, not a policy fix.

## Limits — what this lab does not prove

It proves you can predict a decision from policies and request context, tell an authentication
failure from an authorisation failure, and write a narrow, tested change. It does not prove the
policy works in AWS, does not cover SCPs, boundaries, cross-account access or KMS grants, and
the evaluator is incomplete by design.

## References

- T18 AWS IAM policy evaluation logic · T08 Well-Architected Reliability Pillar (identity as a dependency)
