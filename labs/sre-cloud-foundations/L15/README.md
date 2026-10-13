# L15 — Desired state: Deployment, ReplicaSet, Pod

Module M08 · ~120 min practical · profile `kind-basic` · cluster `looped-foundations`, namespace `beacon`

## Ticket

> Beacon runs on the team's local kind cluster from `L15/work/deployment.yaml`. Change request
> **CR-1042** is approved: every Beacon pod must carry the label `tier: api` (the observability
> team selects on it) and report `environment: kind-lab-l15` from `/version`
> (`BEACON_APP_ENVIRONMENT`). Three replicas, as today. The cluster is shared and "someone has
> been helping". Ship CR-1042 the desired-state way — the file is the source of truth, the
> cluster is made to match it — and explain how the controllers got from your file to running
> pods.

## Objectives

- `obj-m08-01` explain Kubernetes desired state: control plane, controllers, the spec/status gap read from events
- `obj-m08-02` operate Deployments and rollouts: Deployment → ReplicaSet → Pod, self-healing, rollout

## Before you start

`profiles/kind-basic/setup.sh` must have created the cluster (kind v0.29.0, node image
`kindest/node:v1.33.1` pinned by digest), the namespace `beacon` (Pod Security `restricted`
enforced) and loaded the image `registry.lab/beacon:1.4.0` into the nodes. `registry.lab` is an
invented name: the manifests use `imagePullPolicy: IfNotPresent`, so nothing is pulled.

Every command names the context and namespace explicitly. Set
`K="kubectl --context kind-looped-foundations -n beacon"` and never rely on your current context.

## What is fixture-controlled

`setup.sh` deploys the baseline from `manifests/` (three replicas, no CR-1042 yet), copies it to
`work/deployment.yaml` for you to edit, and `inject.sh` adds one of three interferences
(`LOOPED_VARIANT=variant-a|variant-b|variant-c`). The validator records the variant but does
not say what it was.

## Steps and checkpoints

**Checkpoint c1 — map the objects, watch self-healing (week 22, session 1).**

1. `bash labs/sre-cloud-foundations/L15/setup.sh` (writes `evidence/L15-inventory.txt` and a notes file).
2. `$K get deploy,rs,pods -l app.kubernetes.io/name=beacon -o wide`. For one pod, follow
   `metadata.ownerReferences` up to the Deployment (`$K get pod <name> -o jsonpath='{.metadata.ownerReferences}'`)
   and note the `pod-template-hash` label. Write the chain into your notes as
   `deploy/beacon -> rs/<name> -> pods`.
3. Delete one pod (`$K delete pod <name>`), then `$K get pods -w` until three are Ready again.
   `$K get events --sort-by=.lastTimestamp | tail` — which controller created the replacement?

**Checkpoint c2 — ship CR-1042 (session 2).**

4. Compare what the file says with what the cluster has: `$K get deploy beacon -o yaml`,
   `kubectl --context kind-looped-foundations diff -f labs/sre-cloud-foundations/L15/work/deployment.yaml`,
   `$K rollout status deploy/beacon`, `$K describe deploy beacon` (Conditions and Events).
   Quote the first gap you see. Two hypotheses, one discriminating check.
5. Edit `work/deployment.yaml` for CR-1042 and apply it:
   `kubectl --context kind-looped-foundations apply -f labs/sre-cloud-foundations/L15/work/deployment.yaml`.
   If the API server rejects it, read the whole error: it names the field and the rule.
6. Watch the rollout: `$K rollout status deploy/beacon`, `$K get rs -l app.kubernetes.io/name=beacon`
   (a new ReplicaSet appears; the old one scales to zero and stays as history),
   `$K rollout history deploy/beacon`.
7. Prove it: pods carry `tier=api` (`$K get pods -L tier`), `/version` reports the new environment
   (`$K exec deploy/beacon -- python3 -c "import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:8080/version').read().decode())"`),
   and `kubectl diff` prints nothing.
8. `python3 labs/sre-cloud-foundations/L15/validate.py --explanation-file labs/sre-cloud-foundations/L15/evidence/L15-notes.md`
   and paste `evidence/latest.json` into the app.

## Validation (what `validate.py` measures, and what it changes)

Only through `kubectl --context kind-looped-foundations` (refused if that context is missing,
not local, or its nodes are not `looped-foundations-*`): the file is accepted by a server-side
dry run; CR-1042 is in the file **and** on every live pod with the selector unchanged;
`kubectl diff` is empty; three replicas ready; the rollout is complete and not paused;
Deployment → one active ReplicaSet → exactly three pods, no strays. It then **deletes one Beacon
pod** and waits up to two minutes for the ReplicaSet to replace it.

## Pause / resume

State is the cluster plus `work/`. `reset.sh` rebuilds the baseline and re-injects the same
variant (or `LOOPED_VARIANT=…`), replacing `work/`; `evidence/` is kept. `teardown.sh` removes
only `looped.lab/id=L15` objects in `beacon` and `work/`; the cluster stays for L16.
`profiles/kind-basic/teardown.sh` deletes the cluster.

## Lab versus production

- In production the file lives in Git and a pipeline or GitOps controller applies it (M10);
  `kubectl scale` and `rollout pause` by hand are exactly the out-of-band changes that make a
  cluster drift from its source of truth.
- kind runs every node as a container on one machine: no cloud load balancer, no zones, no
  managed control plane. Self-healing here is the ReplicaSet controller replacing a pod, not a
  node or zone failure.

## Limits

This lab proves you can read and drive Deployment → ReplicaSet → Pod reconciliation, ship a
template change through a rollout and recognise an invalid or immutable-field change. It does
**not** prove scheduling, resource pressure or node failure handling (L17), Services and probes
(L16), or anything about managed Kubernetes. The authoring environment could not start a kind
cluster, so this lab's scripts were checked statically (see the lab record's limits).

## References

- T04 kind quick start · T02 Kubernetes: Debug Services (read ahead to L16) · T22 probes (the readiness probe in the manifest)
