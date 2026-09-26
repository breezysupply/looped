# Walkthrough: `pod_health.py`

Read this next to `pod_health.py` in this directory. It follows the same
order as the file.

## 1. Shape of the program

```
load(path) ──► summarize(doc) ──► format_summary(summary) ──► print
   │               │
   │               ├─ _iter_pods(doc)    validate while iterating
   │               ├─ pod_report(...)    healthy / completed / unhealthy + reasons
   │               └─ owner_key(meta)    which workload to blame
   └─ MalformedInput on bad JSON
main(argv) wires these together and turns outcomes into exit codes.
```

Each function has one job, and **only `main` does I/O or picks exit codes**.
That is why the tests can call `summarize()` on a dict built in the test,
without a file, and check `main()`'s return value without starting a
process. When you are asked to write a script in an interview, this split is
the thing that makes it testable, and interviewers notice it.

## 2. `MalformedInput(ValueError)`

A custom exception class does two jobs:

1. **Precision.** `json.JSONDecodeError`, `KeyError` and `TypeError` can all
   come from bugs in *our* code. If the CLI caught all of them it would hide
   our own bugs behind "malformed input". Catching only `MalformedInput`
   keeps the two apart.
2. **Compatibility.** Subclassing `ValueError` means generic callers can
   still use `except ValueError`.

`load()` uses `raise MalformedInput(...) from exc`. That sets `__cause__`, so
a traceback still shows the original JSON error with its line and column.
Leave `from exc` out and Python still chains the exceptions ("During handling
of the above exception..."), but it reads like a second, unrelated failure.

`OSError` (missing file) is deliberately **not** turned into
`MalformedInput`. "Your path is wrong" and "your file is garbage" need
different fixes, so the messages should differ, even though both exit 2.

## 3. Validation as you read: `_field`, `_list_of_dicts` and `_iter_pods`

Everything the program later assumes is checked once, here. Once
`_iter_pods` has passed an item, `pod_report` can write `status["phase"]` and
`cs["name"]` without defensive code.

Points worth noticing:

- **`where` strings** grow as we go deeper:
  `items[1] (pod 'web-...').status.containerStatuses[]`. An error that names
  the pod is one the operator can act on.
- **`bool` is an `int`.** `isinstance(True, int)` is `True`, so
  `"restartCount": true` would slip through a naive check. `_field`
  special-cases it.
- **`None` is treated as absent** (`"lastState": null` does occur in the
  wild). For optional fields the idiom is `(status.get("conditions") or [])`,
  which covers both a missing key and an explicit null.
- **Validate everything before reporting anything.** `summarize` calls
  `list(_iter_pods(doc))`, which runs the generator to the end. If item 900
  is broken, you get an error, not a report that quietly left 100 pods out.
  For a health check, under-reporting is the dangerous failure.

What is *not* validated: fields we never read. Being strict about things
you do not use makes a tool brittle when the API adds fields.

## 4. Healthy means Running **and** Ready

```python
if phase == "Succeeded": completed
elif phase == "Running" and _is_ready(status): healthy
else: unhealthy
```

- `phase` is a coarse summary. A pod whose container is in
  **CrashLoopBackOff is normally in phase `Running`**, because the pod is
  bound and at least one container has started before. A pod that is
  Running but failing its readiness probe gets no Service traffic. So
  "Running" alone does not mean "working". The `broken/running-is-healthy`
  variant makes exactly this mistake, and several tests catch it.
- The pod-level **Ready condition** is the authoritative signal. It combines
  every container's readiness and any readiness gates. `_is_ready` only
  falls back to "all containers ready" when the condition is missing.
- **Succeeded is not unhealthy.** Job pods finish. Alerting on them is the
  classic false positive that teaches people to ignore the alert.

## 5. Reasons: report the evidence Kubernetes recorded

`_container_reasons` looks at one container status:

| `state` | Result |
|---|---|
| `waiting` with a benign reason (`ContainerCreating`, `PodInitializing`) | nothing, because this is a symptom |
| `waiting` with any other reason | `kind: waiting`, reason and message verbatim |
| `terminated` with exit 0 | nothing, because a clean exit is normal for init and Job containers |
| `terminated` with exit ≠ 0 | `kind: terminated` with `exit_code` |
| `running` but `ready: false` (app container only) | `kind: not-ready` |

Every reason also carries **`lastState.terminated`** as `last_reason` /
`last_exit_code`. For a crash loop, the current state is only "waiting to be
restarted". The previous run's exit is the diagnosis.

**Exit code 137 vs OOMKilled.** An exit code above 128 means "killed by
signal (code − 128)", and 137 − 128 = 9, which is SIGKILL. The kernel OOM
killer sends SIGKILL, but so do the kubelet (liveness probe failed, then the
grace period ran out), the container runtime, and `kill -9`. The kubelet
records `reason: OOMKilled` only when the cgroup reports an OOM kill. So the
solution copies `reason` verbatim and never infers it from the code. The
`broken/exit137-is-oom` variant infers it and sends the on-call engineer off
raising memory limits for a pod whose real problem is a hung health endpoint.

Then pod-level evidence:

- **Unschedulable:** a Pending pod the scheduler could not place has no
  container statuses at all. The `PodScheduled` condition's message
  ("0/3 nodes are available: 3 Insufficient memory") is the diagnosis.
- **Fallback:** if nothing matched, or `status.reason` is set (e.g.
  `Evicted`), add a `phase` reason. An unhealthy pod with an empty reason
  list would be a bug in the report.

**A fixed shape for reasons.** `_reason()` always fills every key and uses
`None` where a key does not apply. Code that consumes the result (the
formatter, the tests, a future `--json` flag) can then read
`r["exit_code"]` without checking whether the key exists. Fixed shapes make
downstream code simpler.

## 6. Owner grouping and the ReplicaSet heuristic

Twelve crash-looping replicas of one Deployment are **one** problem. Grouping
by owner turns a wall of pod names into a list of workloads.

- `metadata.ownerReferences` can list several owners. The one with
  `controller: true` manages the pod, so prefer it.
- Deployments own **ReplicaSets**, which own pods. The Deployment
  controller names each ReplicaSet `<deployment>-<pod-template-hash>` and
  also puts `pod-template-hash=<hash>` on each pod's labels. So:
  owner kind is ReplicaSet, *and* the name ends with `-<that label>`, means
  strip the suffix and call it a Deployment.

**Limits of the heuristic** (say these out loud in an interview):

- It is inference, not fact. The authoritative link is the **ReplicaSet's**
  own `ownerReferences`, and that is not in a pod listing. To be certain you
  would also run `kubectl get rs -o json` and join on it.
- A bare ReplicaSet created by hand that happens to have a matching
  `pod-template-hash` label would be misreported as a Deployment.
- Other controllers use the same pattern (Argo Rollouts, for one, creates
  ReplicaSets with a hash label), so the "Deployment" label might really
  be a Rollout.
- Never "strip after the last dash" without the label: `my-app-v2` would
  become `my-app`.
- CronJob → Job → Pod has the same two-level problem. The solution
  reports the Job (e.g. `nightly-report-29312640`), not the CronJob.

The key includes the **namespace**, because `web` in `staging` and `web` in
`prod` are different workloads.

## 7. Deterministic output

Groups are sorted by key and pods by name. The test
`test_output_does_not_depend_on_input_order` reverses the input and expects
an identical result. Determinism matters for diffs between runs, for tests,
and for alert de-duplication. Python dicts keep insertion order, so
`{k: ... for k, ... in sorted(groups.items())}` gives a sorted dict.

## 8. CLI and exit codes

`main(argv=None) -> int` returns the code instead of calling `sys.exit()`,
and the `if __name__ == "__main__": sys.exit(main())` line is the only place
that exits. Tests call `main([...])` directly, and one test also runs the
file as a real subprocess to check that wiring.

Exit codes follow the Nagios/monitoring convention: 0 OK, 1 problem found,
2 cannot tell. A cron job or CI step can then tell "the cluster is sick"
apart from "the check itself is broken", which call for different
responses.

## 9. What would come next

- `--json` output (the summary dict is already JSON-serialisable).
- Reading from stdin (`kubectl get pods -A -o json | pod_health.py -`).
- Flagging *healthy* pods with a high restart count as "flapping".
- Accepting a single Pod object as well as a List. The solution rejects it
  deliberately, so that the error stays precise.
