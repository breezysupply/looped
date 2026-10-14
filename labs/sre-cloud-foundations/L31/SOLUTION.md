# L31 worked solution

## 1. The dry check, per variant

`rebuild.sh check` fails on the colleague's draft:

- **A:** `hidden-prerequisites: IMAGE_SOURCE=preloaded relies on an image some earlier lab left in
  the nodes`. The draft also points `IMAGE_REPO` at `looped-l19-beacon`, L19's standard-library
  image, which has no PostgreSQL driver: even on the colleague's cluster the API would only have
  worked with the memory store. Fix: `IMAGE_SOURCE=build`, `IMAGE_REPO=looped-l31-beacon`.
- **B:** `DB_SECRET_SOURCE=existing:beacon-db-auth relies on a Secret created outside this
  rebuild` — L18 created it in namespace `beacon`; the new namespace has none, so PostgreSQL would
  sit in `CreateContainerConfigError`. Fix: `generate`.
- **C:** `artifacts: labs/sre-cloud-foundations/L22/work/rules/... missing` (or, on a machine
  where L22 was done, "is git-ignored: a fresh clone will not have it"). Fix:
  `SLO_DIR=labs/sre-cloud-foundations/L31/release/slo`, the copies `setup.sh` made.

## 2. The reused telemetry does not fit the build (all variants)

`telemetry-names` fails even after the hidden prerequisite is fixed: L22's rules were written
for a fixture metric `beacon_http_requests_total` and L21's dashboard for L21's own
`beacon_l21_*` metrics, while the image you build exports `beacon_requests_total{route,method,code}`
and `beacon_request_duration_seconds` with buckets 0.005 … 10 s (no 0.3). Adapt the copies in
`release/`, not the originals:

```sh
cd labs/sre-cloud-foundations/L31/release
sed -i.bak 's/beacon_http_requests_total/beacon_requests_total/g; s/beacon_http_request_duration_seconds/beacon_request_duration_seconds/g; s/le="0.3"/le="0.25"/g' \
  slo/rules/beacon-slo.rules.yml slo/tests/beacon-slo.test.yml
bash ../rebuild.sh slo        # promtool: SUCCESS
```

In `dashboard.json` replace `beacon_l21_requests_total` with `beacon_requests_total`,
`status_class="5xx"` with `code=~"5.."`, the latency metric and route (`/status`), the job label
(`beacon`), and remove the dependency-latency panel — the shipped build has no such histogram.
Record the threshold change (300 ms → 250 ms, the nearest bucket below) in the runbook: it makes
the latency SLI stricter, and a reviewer should agree to it.

## 3. The rebuild

`rebuild.sh proof` on a clean cluster runs: check → image (L13 recipe, image ID in
`work/release.json`, `kind load`) → deploy (namespace with restricted Pod Security, generated
Secrets, token-less service accounts, PostgreSQL StatefulSet, Redis, worker, L18 RBAC and
NetworkPolicies re-namespaced, `helm upgrade --install` with the post-renderer) → seed (240
records, fingerprint `240 2281018160bb2c736124981dbf0919d1`) → backup → restore drill (L24
verifier reports `match public.records`) → rollback drill (a 250 ms delay release, then
`helm rollback`) → promtool → verify.

Expected `verify` (abbreviated): `PASS health: workloads ready; /ready 200; /version reports
1.4.0; write+read through the API ok`, `PASS least-privilege: deployer may ['patch
deployments.apps', 'get pods/log', 'list pods']; must not, but may: none; pods with an API token:
none`, `PASS seeded-data`, `PASS metrics: ... use ['beacon_request_duration_seconds',
'beacon_requests_total']`, `PASS rollback: ... rollbacks: [3]`.

## 4. Runbook points a reviewer looks for

Configuration explains the namespace and why it is new; Deploy explains the order (Secrets
before PostgreSQL, PostgreSQL before the API's readiness); Rollback says a Helm rollback restores
the Deployment and ConfigMap but not data or schema; Rebuild proof quotes both `all` durations and
what differed (wheel download cached, image layers cached); Limits says NetworkPolicy is not
enforced on kind-basic.
