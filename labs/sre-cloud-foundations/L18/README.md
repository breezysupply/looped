# L18 — Least privilege for a deploy bot, and segmentation you can prove

Module M09 · ~120 min practical (week 27, two checkpoints) · profile **`kind-policy`** (cluster
`looped-policy`, Calico enforcing NetworkPolicy, namespace `beacon`) · **local only**

## Ticket

> Two tickets, in `work/TICKETS.md`. **BEACON-OPS-1401:** the deploy bot (ServiceAccount
> `beacon-deployer`) stops part-way through every release run; give it exactly what its four
> steps need and prove what it still cannot do. **SEC-212:** security review requires
> default-deny segmentation for namespace `beacon`; a teammate prepared the policies. Apply them
> and prove — from inside the real pods — that the API resolves and reaches PostgreSQL, that
> nothing else reaches the database, and that the API reaches nothing else.

## Objectives

- `obj-m09-04` create least-privilege Roles and bindings for a service account and verify with
  `kubectl auth can-i` and real API calls
- `obj-m09-03` write default-deny plus allow rules on a policy-enabled cluster and prove allowed
  and denied traffic, including DNS egress

## Before you start: the policy cluster

```sh
labs/sre-cloud-foundations/profiles/kind-policy/setup.sh      # creates looped-policy, installs Calico, runs the self-test
```

The profile disables kind's default CNI and installs Calico v3.30.3 from a checksum-verified
manifest; its self-test must print `PASS enforcement self-test` before this lab means anything.
kindnet's own policy support is not relied on. Stop the core cluster first if Docker is short of
memory.

## Safety and scope

- Every command names `--context kind-looped-policy` and `-n beacon`; scripts run
  `require_kind_context kind-looped-policy looped-policy` first. L18 objects are labelled
  `looped.lab/id=L18` and deleted only by that label.
- Workload ServiceAccounts mount no API token. The deploy bot is exercised by impersonation
  (`--as system:serviceaccount:beacon:beacon-deployer`): the API server authorises each request
  as that identity, so the result is the same decision a token would get. To try with a real
  token: `kubectl --context kind-looped-policy -n beacon create token beacon-deployer --duration 10m`.
- Image `looped-l18-beacon:1.4.0` (built and `kind load`ed by setup), `postgres:16.4` pinned by
  digest; the database password is `lab-l18-db-password-not-a-real-secret`.

## What is fixture-controlled

`setup.sh` copies `manifests/` to `work/manifests/`, lets `inject.sh` change **one RBAC rule and
one policy rule** for the variant, applies the workloads and RBAC (not the policies), and runs
`assets/deploy-bot.sh` once into `work/deploy-bot.log`. Beacon runs with its in-memory store in
this lab, so the API→DB path is proven with a PostgreSQL protocol handshake from the API pod
(`assets/probe.py`) — the same network path Beacon's postgres store uses.

## Steps and checkpoints

```sh
bash labs/sre-cloud-foundations/L18/setup.sh
alias kp='kubectl --context kind-looped-policy -n beacon'
```

**Checkpoint c1 — least privilege (BEACON-OPS-1401).**

1. Read `work/deploy-bot.log`. Quote the Forbidden line: which verb, resource and API group?
2. `kp auth can-i --list --as system:serviceaccount:beacon:beacon-deployer` and the single
   checks for each of the bot's steps. Write the **RBAC** section: what is missing, what the bot
   must never get.
3. Change the smallest thing in `work/manifests/20-rbac.yaml`, `kp apply -f` it, and re-run
   `bash labs/sre-cloud-foundations/L18/assets/deploy-bot.sh` until `release run complete`.
4. Prove the negatives: `delete deployments`, `get secrets`, `create pods/exec`,
   `create rolebindings`, `list pods -n kube-system`, `list nodes` → `no`.

**Checkpoint c2 — deny and allow (SEC-212).**

5. Before applying anything: `bash labs/sre-cloud-foundations/L18/assets/netcheck.sh`. Every
   "deny" row is currently open — the baseline is flat.
6. `kp apply -f work/manifests/30-netpol.yaml`, run `netcheck.sh` again. Compare each row with
   its "want". Write **Policy**: which row is wrong and what evidence points at the cause (a
   failed name lookup and a TCP timeout are different symptoms).
7. Fix the policy file (not by deleting default-deny, not by allowing all egress), apply, run
   `netcheck.sh` until every row matches. Paste it into **Proof** with the CNI line.
8. `python3 labs/sre-cloud-foundations/L18/validate.py --explanation-file labs/sre-cloud-foundations/L18/evidence/L18-notes.md`
   and import `evidence/latest.json`.

## What you should observe

- RBAC refusals name the exact request: `User "system:serviceaccount:beacon:beacon-deployer"
  cannot patch resource "deployments" in API group "apps" in the namespace "beacon"`.
- A policy drop is a **timeout** (`"tcp": "timeout"`), not `connection refused`. A blocked DNS
  path shows as `"dns": "fail:gaierror"` after several seconds, before any TCP attempt.
- With default-deny applied, nothing changes for pods that are already connected until they
  open new connections; Calico applies the rules within seconds.

## What the validator checks

Calico ready on every node and kindnet absent; workloads ready; the deployer's allowed and
denied `auth can-i` answers; the Role/binding shape (no wildcards, a namespaced Role, no
ClusterRoleBinding for beacon ServiceAccounts); the bot's four real calls succeed as the
ServiceAccount and a real `get secrets` is Forbidden; a default-deny policy and no allow-all
rule; API DNS and API→DB (PostgreSQL answers); report→DB, API→report and API→kube-API time out;
your notes. Binding `edit`/`admin`, a `*` verb, deleting default-deny or `egress: [{}]` each fail
a named check — the shortcuts are detected, not trusted.

## Pause / resume

Everything stays in `looped-policy` between sessions. `setup.sh` reuses `work/`. `reset.sh`
deletes every L18 object, keeps your manifests in `.work-previous/manifests` and sets up the
same variant (or `LOOPED_VARIANT`). `teardown.sh` removes L18's objects and image; the cluster
is removed by `profiles/kind-policy/teardown.sh`.

## Lab versus production

- Impersonation is an admin convenience; production bots authenticate with short-lived tokens
  (projected ServiceAccount tokens, or workload identity in a cloud) and their permissions are
  reviewed as code, like here.
- Calico enforces Kubernetes NetworkPolicy here exactly as it would in many self-managed
  clusters; a managed provider's CNI may differ in defaults, logging and support for policy
  features. Cloud security groups and VPC routing are a separate layer this lab does not touch.

## Limits — what this lab does not prove

It proves namespace-scoped RBAC with real authorisation decisions and NetworkPolicy enforcement
with real negative connectivity tests on a local two-node kind cluster running Calico. It does
not prove cloud identity (IRSA/workload identity), admission policy, egress to the internet,
L7 policy, encryption in transit, or any accreditation boundary; and it does not prove that a
different CNI would behave the same.

## References

- T05 Kubernetes NetworkPolicy (default deny, DNS egress, enforcement depends on the plugin)
- T04 kind quick start (cluster configuration) · T02 Kubernetes: debug services
