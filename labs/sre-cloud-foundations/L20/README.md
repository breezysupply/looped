# L20 — A gated pipeline, one digest through two environments, and a reconciler

Module M10 · ~150 min practical across sessions (weeks 30–31, three checkpoints) · profiles
`workstation` (Docker, git, Python) + `kind-basic` (cluster `looped-foundations`, namespace
`beacon`) · **local only; hosted CI is optional and labelled**

## Ticket

> Beacon's delivery is being rebuilt around three rules: a failing gate blocks a release; an
> environment runs a **digest** that a pipeline published, never "whatever the tag means
> today"; and the cluster runs what git says, enforced by a reconciler. You own the pipeline
> (`pipeline/workflows/beacon-ci.yml` and its local executable equivalent `ci-local.sh`), the
> GitOps repository (`work/gitops`) and the reconciler (`reconciler/`). Four tickets arrive in
> `work/TICKETS.md`: a 1.5.0 merge, an overnight manual fix, a prod promotion request phrased
> as a tag, and an urgent rollback request.

## Objectives

- `obj-m10-02` author a pipeline whose failing test or scan blocks publication, with a local
  executable equivalent
- `obj-m10-03` promote one digest through environments and roll back without changing artifact
  identity
- `obj-m10-04` explain why a manual fix disappears under GitOps and make a safe source-of-truth
  or documented-pause change
- supporting `obj-m10-05` keep secrets out of git, images and logs; recognise an unsafe schema
  rollback

## What you work with

| Path | What it is |
|---|---|
| `pipeline/workflows/beacon-ci.yml` | GitHub Actions workflow: test → build (OCI archive) → scan (Trivy, pinned) → publish (push the scanned bytes, capture digest) → promote staging → promote prod (protected environment). Stored in the lab, **not** in any `.github/`; nothing runs it here. |
| `ci-local.sh` → `pipeline/ci_local.py` | The same stages locally: unit tests, `docker build`, scan, push to the lab registry and capture the digest from the registry API, promotion commits to `work/gitops` |
| `pipeline/scan_stub.py` | **SCAN STUB — policy checks only, NOT a vulnerability scan** (non-root user, no credential-like env, revision label, base pinned by digest, no remote ADD). `LOOPED_SCAN=trivy` uses a real offline Trivy if you have one with a cached DB. |
| `reconciler/reconcile.py` (`run.sh`) | Applies git HEAD of `work/gitops/envs/` with server-side apply; verifies artifact identity before applying; detects and corrects drift; honours a documented pause file |
| `work/app` (git) | Beacon source, Dockerfile, `release.json` (version, schema range, migrations), tests |
| `work/gitops` (git) | `envs/{staging,prod}/*.json` (Deployment, Service, schema ConfigMap) and `promotions/<env>.json` |
| `looped-l20-registry` | `registry:2.8.3` (pinned by digest) on **127.0.0.1:5020**, volume `looped-l20-registry-data` |

Manifests are JSON (valid Kubernetes syntax) so all course tooling stays standard-library
Python. Images: `looped-l20-beacon:sha-<commit>` locally and
`127.0.0.1:5020/looped-l20/beacon:sha-<commit>` in the registry; kind cannot pull from that
loopback registry, so the reconciler loads the **verified** image into the nodes with
`kind load docker-image` and the Deployment carries the digest as an annotation.

## Safety and scope

- `ci-local.sh` touches only `work/` and `looped-l20-*` images; it never talks to the cluster.
  `reconciler/run.sh` runs `require_kind_context kind-looped-foundations looped-foundations`
  and the Python guard again before applying anything, and only ever to namespace `beacon`.
- Secrets: the Deployments reference `beacon-<env>-db` by name; `setup.sh` creates them in the
  cluster with placeholder values (`lab-l20-<env>-db-not-a-real-secret`). They are never in git,
  the image or CI logs — the validator checks all three.
- Docker objects are named `looped-l20-*`; `teardown.sh` removes exactly those (keeping the
  shared `registry:2.8.3` and Python base images).

## Steps and checkpoints

```sh
bash labs/sre-cloud-foundations/L20/setup.sh           # baseline 1.4.0 built, published, promoted to staging AND prod, reconciled
bash labs/sre-cloud-foundations/L20/reconciler/run.sh  # second terminal: the reconciler loop (Ctrl-C stops it)
alias kb='kubectl --context kind-looped-foundations -n beacon'
```

**Checkpoint c1 — the gate (CHG-4101).** `git -C labs/sre-cloud-foundations/L20/work/app log
--oneline`, then `bash labs/sre-cloud-foundations/L20/ci-local.sh run`. Read the stage lines and
`work/ci/runs/<run>/test.log`. Write **Gate**: which commit, which test, which assertion, why. Fix
the code (not the tests), commit, run the pipeline again until staging gets 1.5.0. Read
`pipeline/workflows/beacon-ci.yml` and map every local stage to its hosted job.

**Checkpoint c2 — promotion and reconciliation (INC-77, CHG-4102).**

1. `bash labs/sre-cloud-foundations/L20/inject.sh drift`. Watch the reconciler terminal (or run
   `reconciler/run.sh --once`). Quote the `DRIFT` and `CORRECTED`/`REPLACED` events. Try
   reproducing the manual change and see it disappear. Write **Reconciler**: why, and the two
   legitimate ways to make an emergency change stick (commit it to git; or a documented pause:
   `echo "<who, why, until>" > work/reconciler/PAUSED`, removed afterwards).
2. `bash labs/sre-cloud-foundations/L20/inject.sh retag`, read CHG-4102, then try what the
   release manager asked. Use `ci-local.sh verify-tag <tag>` and `reconciler/run.sh
   --verify-only` to find out what the tag holds now. Restore integrity where it was broken
   (pull the recorded digest: `docker pull 127.0.0.1:5020/looped-l20/beacon@<digest>`, re-tag),
   then promote prod **by record**: `ci-local.sh promote prod --from staging --approve "<you>"`.
   Write **Promotion**.

**Checkpoint c3 — schema and secrets (INC-81).** `bash labs/sre-cloud-foundations/L20/inject.sh
rollback-request`, read INC-81, try the rollback it asks for, and decide. Write **Schema**
(the gate's reason in your words, what expand/contract would have allowed, what you do for the
customers instead, where the secrets live). Then:

```sh
python3 labs/sre-cloud-foundations/L20/validate.py --explanation-file labs/sre-cloud-foundations/L20/evidence/L20-notes.md
```

## What you should observe

- A failing test ends the run with `GATE: blocked at test — nothing was published or promoted`;
  the registry has no tag for that commit.
- The publish stage reports `127.0.0.1:5020/looped-l20/beacon@sha256:…`; staging's and prod's
  `promotions/*.json` carry the same digest, and `/version` in both environments reports the
  same commit.
- Server-side apply restores fields the reconciler owns (replicas, image) but leaves fields
  another field manager added (an extra env var from `kubectl set env`); the reconciler detects
  the remaining drift and replaces the object from git.
- A tag can be re-pushed; a digest cannot change. Verification by digest catches it; promotion
  by tag would have shipped an unreviewed build.

## What the validator checks

Locally: the workflow's job chain, promotion by digest and protected prod; unchanged test files
and passing tests; all four faults injected; a run blocked at `test` for the regression with no
image published; staging's 1.5.0 artifact from a passed run after the regression; prod on the
same digest with a human approval; tag and local image still holding that digest; the prod
rollback refused by the schema gate and no commit lowering a schema; no secret material in git
history, CI records or the image; a staging drift correction in the reconciler log. In the
cluster: reconciler status for git HEAD, not paused, no live-vs-git differences; both
environments ready and serving 1.5.0 at the promoted commit. Unsafe shortcuts fail: editing or
deleting a test (`tests-intact`), promoting by the re-pushed tag (`one-digest`,
`tag-integrity`), lowering the schema to force the rollback (`schema-gate`), leaving the
reconciler paused or a manual change in place (`reconciled`).

## Pause / resume

Everything persists in `work/` and the registry volume; restart the reconciler with
`reconciler/run.sh` after a break (the cluster must be running). `setup.sh` is idempotent.
`reset.sh` keeps a git bundle of both repositories in `.work-previous/`, tears down and starts
again (same variant unless `LOOPED_VARIANT` says otherwise).

## Hosted CI (optional, labelled)

To run the hosted workflow, copy it into **your own** repository as described in its header.
Record the run URL in your notes and set `LOOPED_HOSTED_RUN_URL=<url>` when you validate; the
evidence then says `ci: hosted+local`. Without it the evidence says **local-only**, which is
the default and fully passes this lab. Never paste registry tokens into notes or evidence.

## Lab versus production

- Real registries can make tags immutable and sign artifacts (M13); here the registry is a
  plain local `registry:2.8.3` so you can see why that matters.
- Real GitOps controllers (Argo CD, Flux) add health assessment, pruning, multi-tenancy and
  RBAC; the 200-line reconciler here shows the core loop and the field-ownership subtlety.
- A real schema gate reads the migration state from the database; here the schema version is a
  ConfigMap updated by promotion, a model of expand/contract, not a database.

## Limits — what this lab does not prove

It proves a gated local pipeline with real tests, a real image build, digest capture from a real
registry, refusal of mutable-tag promotion, a reconciler that restores declared state, and a
modelled schema-compatibility gate. It does not prove a hosted CI run (unless you do one), a
vulnerability scan (the default scan is a labelled stub), image signing or provenance
verification, registry authentication, multi-cluster delivery, or a real database migration.
Local-only evidence is labelled as such.

## References

- T13 Helm documentation (release history and rollback, for comparison) · T06 Docker
  multi-platform builds (digests, OCI archives) · T12 Git documentation (history as the source
  of truth) · T21 Sigstore cosign (what the next step after digests is)
