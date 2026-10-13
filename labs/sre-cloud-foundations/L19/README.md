# L19 — Package Beacon as a Helm chart: render, lint, install, upgrade, roll back

Module M10 · ~120 min practical · profile `kind-basic` (cluster `looped-foundations`, namespace
`beacon`) · Helm 3.18 · **local only: no registry, no cloud**

## Ticket

> Beacon now ships as a Helm chart (`chart/`, copied to `work/chart/` for you to work in) with
> per-environment values and a values schema. Staging runs 1.4.0 after your first install. Change
> request **CHG-3104** (in `work/TICKET.md`, written at setup) moves staging to 1.5.0 using the
> approved change values in `work/change/values-1.5.0.yaml`. Staging must keep serving
> throughout. Before closing the change you must show the release history and prove that a
> rollback restores a working, compatible build.

## Objectives

- `obj-m10-01` render, lint, install, upgrade and roll back the Beacon chart, and read release
  history to say which build is serving and why
- supporting `obj-m08-05` (probes stay correct through every revision) and the M10 habit of
  catching bad values before they reach the cluster

## The chart (this exact path is used again by cloud extension C03)

```
chart/
  Chart.yaml              apiVersion v2, chart version 0.4.0, appVersion 1.4.0 (pinned)
  values.yaml             defaults = dev
  values-staging.yaml     2 replicas, environment staging
  values-prod.yaml        3 replicas, PDB minAvailable 2, more memory, admin off
  values.schema.json      types, enums, pinned MAJOR.MINOR.PATCH tags, memory units, no unknown keys,
                          prod rules (replicas >= 2, admin false)
  templates/              Deployment (apps/v1), Service, ConfigMap, PodDisruptionBudget (policy/v1),
                          startup/readiness/liveness probes, checksum/config annotation, NOTES.txt,
                          tests/test-smoke.yaml (helm test)
assets/render_assert.py   render assertions for dev/staging/prod + proof the schema refuses
                          every file in assets/invalid/
```

Images: setup builds `looped-l19-beacon:1.4.0` and `looped-l19-beacon:1.5.0` from
`assets/Dockerfile` (stdlib Beacon, UID 10001, base image pinned by digest) and loads them into
the kind nodes with `kind load docker-image`. Nothing is pulled from a registry for Beacon; the
`/version` endpoint reports which build answered.

## Safety and scope

- Every command names the context: `helm --kube-context kind-looped-foundations -n beacon …`
  and `kubectl --context kind-looped-foundations -n beacon …`. The scripts run
  `require_kind_context` first and refuse a context that is not a local kind cluster with
  `looped-foundations-*` nodes.
- The only release is `beacon` in namespace `beacon`; scripts uninstall it only when its values
  carry `commonLabels.looped.lab/id=L19`. Images are `looped-l19-beacon:*` only.
- `reset.sh` uninstalls this release and rebuilds `work/` (your chart is kept in
  `.work-previous/chart`); `teardown.sh` also removes the lab images from the nodes and Docker.

## Steps and checkpoints

**Checkpoint c1 — render before you install (week 29, session 1).**

1. `bash labs/sre-cloud-foundations/L19/setup.sh` (kind-basic cluster running; see
   `profiles/kind-basic/README.md`).
2. Read `work/chart/values.schema.json` and `templates/deployment.yaml`. Predict: what happens if
   someone writes `memory: 256` in a values file without a schema? (Write it in Render.)
3. Lint and render:
   ```sh
   C=labs/sre-cloud-foundations/L19/work/chart
   helm lint $C -f $C/values-staging.yaml && helm lint $C -f $C/values-prod.yaml
   helm template beacon $C -n beacon -f $C/values-prod.yaml | less
   python3 labs/sre-cloud-foundations/L19/assets/render_assert.py $C   # or L19/.venv/bin/python
   helm template beacon $C -n beacon -f labs/sre-cloud-foundations/L19/assets/invalid/memory-bytes.yaml
   ```
4. Install staging and smoke-test it:
   ```sh
   helm --kube-context kind-looped-foundations upgrade --install beacon $C -n beacon \
     -f $C/values-staging.yaml --wait --timeout 3m
   helm --kube-context kind-looped-foundations test beacon -n beacon --logs
   helm --kube-context kind-looped-foundations history beacon -n beacon
   ```

**Checkpoint c2 — the change, the recovery and the rollback drill (week 29, session 2).**

5. Read `work/TICKET.md` and the change file. Write a **prediction** in your notes, then apply:
   ```sh
   helm --kube-context kind-looped-foundations upgrade beacon $C -n beacon \
     -f $C/values-staging.yaml -f labs/sre-cloud-foundations/L19/work/change/values-1.5.0.yaml \
     --wait --timeout 2m
   ```
6. If it does not go cleanly, quote the first error line (Helm's, or the first Warning event
   from `kubectl describe pod`), keep staging serving (`kubectl get pods,endpointslices`), and
   decide whether to roll back first. Correct the change file, not the schema and not the
   chart's guard rails, and apply it again.
7. Rollback drill: `helm history`, `helm rollback beacon <last 1.4.0 revision> --wait`, prove
   1.4.0 answers `/version`, then return to 1.5.0 (`helm rollback` to the 1.5.0 revision or the
   corrected upgrade). Run `helm test` again.
8. `python3 labs/sre-cloud-foundations/L19/validate.py --explanation-file labs/sre-cloud-foundations/L19/evidence/L19-notes.md`
   and import `evidence/latest.json`.

## What you should observe

- A schema failure happens on your laptop, before any API call: Helm prints
  `values don't meet the specifications of the schema(s)` and the JSON path. No revision is
  created.
- A values file that is valid but names an image the nodes cannot get produces a revision
  that Helm marks `failed` after `--timeout`; the pods show `ErrImagePull`/`ImagePullBackOff`.
  Because `maxUnavailable: 0`, the old pods keep serving and the Service keeps its endpoints.
- `helm rollback` creates a **new** revision ("Rollback to N"); history is never rewritten.
- A config-only change rolls pods because of the `checksum/config` annotation.

## What the validator checks

Lint for staging and prod; all render assertions and every schema refusal on `work/chart`; the
corrected change file renders to `looped-l19-beacon:1.5.0` within the staging contract; release
`beacon` is `deployed`; history contains a rollback; the current revision pins 1.5.0 on staging
values; 2/2 ready pods all on 1.5.0 with none waiting on a pull; a GET through the Service from
inside a pod returns ready and `1.5.0`/`staging`; your notes. Deleting `values.schema.json` or
loosening it so an invalid fixture renders fails `render-assertions` — the shortcut is detected.

## Pause / resume

The release and images survive between sessions while the cluster runs. After a laptop restart,
start Docker; kind restarts the nodes. `setup.sh` is idempotent (keeps `work/chart` and the
ticket). `reset.sh` uninstalls only this release and starts the same variant again.

## Lab versus production

- A real pipeline pushes to a registry and the chart pins `image.digest` (supported here: a
  digest wins over the tag). L20 does digest promotion; here `kind load` stands in for the
  registry.
- Release history lives in Secrets in the release namespace; whoever can read them can read
  your values. Keep credentials out of values files (reference an existing Secret instead).
- `helm rollback` restores manifests and values only. It does not undo a database migration,
  data written by the new version, or anything outside the release — the subject of L20 and
  D02.

## Limits — what this lab does not prove

It proves chart structure, schema validation, render assertions, release history, upgrade
failure handling and rollback on one local kind cluster. It does not prove registry
authentication, chart signing/provenance (`helm package --sign`), multi-cluster promotion,
admission policy, or behaviour under real traffic; Beacon here uses the in-memory store, so no
data survives a rollout and none needs migrating.

## References

- T13 Helm documentation (charts, values files, schema files, upgrade, rollback, history, tests)
- T22 Kubernetes probes · T04 kind quick start (`kind load docker-image`)
