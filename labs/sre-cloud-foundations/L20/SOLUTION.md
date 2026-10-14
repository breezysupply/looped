# L20 worked solution

## c1 — the gate

```
$ bash labs/sre-cloud-foundations/L20/ci-local.sh run
pipeline run-…-3809678dfbee for commit 3809678dfbee (Beacon 1.5.0, schema 3–3)
── stage test
   FAILED: 16 tests, exit 1 (FAILED (failures=1))
GATE: blocked at test — nothing was published or promoted from 3809678dfbee
```

`work/ci/runs/<run>/test.log` (variant A): `FAIL: test_status_roundtrip_and_idempotency …
AssertionError: 500 != 200`. `git -C work/app show HEAD` shows the lookup now also matches
`request_id`; a retry carries a new request id, misses the stored record and the INSERT hits the
unique key → 500. Variant B fails `test_metrics_are_prometheus_text_with_route_labels` (raw path
as a label: unbounded cardinality); variant C fails `test_yaml_subset_and_validation` (quoted
port accepted). Fix: `git -C work/app revert --no-edit HEAD` (the 1.5.0 release commit stays),
run again → all stages pass, `publish` prints `…@sha256:<B>`, staging promoted (schema 2 → 3).
Deleting or editing the test would make the gate meaningless (and fails `tests-intact`).

## c2 — drift

The reconciler loop prints, for variant A (`kubectl scale … --replicas=0`):
`DRIFT staging Deployment beacon-staging: replicas differs from git …` then `CORRECTED`. Variant
B (`kubectl set env … BEACON_INJECT_DELAY_MS=750`): server-side apply leaves the extra env var
(owned by the `kubectl-set` field manager), so the reconciler logs `REPLACED … (containers held by
another field manager)` and the object is rebuilt from git. Variant C (`kubectl set image …
:hotfix-unreviewed`): apply takes the image field back. A manual fix disappears because git is
the desired state; to keep one, commit it to `work/gitops` (reviewed like any change), or pause
with a reason (`work/reconciler/PAUSED`), fix, commit, and remove the pause.

## c2 — the tag

Variant A: `ci-local.sh promote prod --tag 1.5.0 …` → `REFUSED … tag 1.5.0 now resolves to
sha256:52f6…, which is not the digest staging verified (sha256:89ba…)`; `verify-tag 1.5.0` →
`NOT a CI-published artifact`. Variant B: the reconciler refuses both environments
(`registry tag sha-… now points to …`; `local image … is not the published artifact`) and keeps
the running pods. Variant C: only the local tag moved. Restore from the immutable reference:

```sh
D=$(python3 -c 'import json;print(json.load(open("labs/sre-cloud-foundations/L20/work/gitops/promotions/staging.json"))["digest"])')
C=$(python3 -c 'import json;print(json.load(open("labs/sre-cloud-foundations/L20/work/gitops/promotions/staging.json"))["commit"])')
docker pull 127.0.0.1:5020/looped-l20/beacon@$D
docker tag 127.0.0.1:5020/looped-l20/beacon@$D looped-l20-beacon:sha-$C
docker tag 127.0.0.1:5020/looped-l20/beacon@$D 127.0.0.1:5020/looped-l20/beacon:sha-$C && docker push 127.0.0.1:5020/looped-l20/beacon:sha-$C
bash labs/sre-cloud-foundations/L20/reconciler/run.sh --verify-only     # VERIFIED prod, VERIFIED staging
bash labs/sre-cloud-foundations/L20/ci-local.sh promote prod --from staging --approve "<you>"
```

## c3 — the rollback request

```
$ ci-local.sh rollback prod --to 1.4.0 --approve "<you>"
REFUSED rollback prod: refused by schema gate: artifact 1.4.0 (sha256:ac45…) supports database
schema 1–2, but prod is at schema 3 (0002_status_index.sql, 0003_contract_status_text.sql
applied); migrations never run backwards …
```

Decision: refuse. 1.4.0 reads `status_text`, which migration 0003 dropped; rolling the code back
would turn a cosmetic complaint into an outage. Fix forward (1.5.1 that derives the text from
`status`) and, next time, ship 0003 as expand (add/keep) in 1.5.0 and contract only in a later
release once no deployed build reads the column — then a rollback to the previous release stays
compatible. Do not edit `schema.json` down to make the gate pass; it changes the record, not the
database. Secrets: only in the cluster (`beacon-<env>-db`), referenced by name; nothing in git,
image env or CI logs.
