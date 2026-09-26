# 01 · Pod health summariser

**Time:** about 45 minutes. **You edit:** `pod_health.py`.

## The task

You are on call. Someone pastes the output of `kubectl get pods -A -o json`
into the incident channel and asks "what's broken?". Scrolling through 3,000
lines of JSON is not an answer. Write a small tool that reads that JSON and
prints a short report saying:

- how many pods are healthy, completed and unhealthy;
- for the unhealthy ones, **which workload** they belong to (a Deployment
  with 12 crashing replicas is one problem, not 12);
- for each unhealthy pod, **why**, using the evidence Kubernetes already
  recorded, not a guess.

It must never crash with a Python traceback on bad input. A truncated file,
or the output of a different command, should produce one clear error line
and exit code 2.

Implement four things in `pod_health.py`. Their signatures and docstrings are
already there:

| Function | Does |
|---|---|
| `load(path) -> dict` | Read and parse the JSON file |
| `summarize(doc) -> dict` | Classify pods and group unhealthy ones by owner (the data the tests check) |
| `format_summary(summary) -> str` | Human-readable report |
| `main(argv) -> int` | CLI: `python3 pod_health.py FILE`, returns the exit code |

## Expected behaviour

### Healthy, completed or unhealthy

- **Healthy:** `status.phase == "Running"` **and** the pod's `Ready`
  condition is `"True"`. Restarts in the past do not make a Ready pod
  unhealthy.
- **Completed:** `status.phase == "Succeeded"` (a finished Job pod). These
  are **not** unhealthy.
- **Unhealthy:** everything else, including `Running` pods that are not Ready,
  `Pending`, `Failed` and `Unknown`.

### Why a pod is unhealthy: `reasons`

Every unhealthy pod gets a non-empty list of reason dicts. Each reason has
all of these keys, with `None` where a key does not apply: `kind`,
`container`, `init`, `reason`, `message`, `exit_code`, `last_reason`,
`last_exit_code`, `restarts`. The docstring in `pod_health.py` lists them.

| Evidence in the JSON | `kind` | Notes |
|---|---|---|
| container `state.waiting.reason` (CrashLoopBackOff, ImagePullBackOff, ErrImagePull, CreateContainerConfigError, ...) | `waiting` | Copy `reason` and `message` verbatim. Also copy `lastState.terminated.reason` / `.exitCode` into `last_reason` / `last_exit_code`, because for a crash loop that is where the cause is. |
| container `state.terminated` with a non-zero `exitCode` | `terminated` | `exit_code` and `reason` (e.g. `Error`, `OOMKilled`) |
| container running, `ready: false` (not an init container) | `not-ready` | The readiness probe is failing |
| `PodScheduled` condition `False` with reason `Unschedulable` | `unschedulable` | `message` is the scheduler's explanation |
| none of the above | `phase` | Fallback, so no unhealthy pod goes unexplained. Use `status.reason` (e.g. `Evicted`) if present. |

Rules that trip people up:

- **Exit code 137 is not the same as OOMKilled.** 137 = 128 + 9: the process
  was sent SIGKILL. The kernel OOM killer does that, and so does the
  kubelet when a liveness probe fails. Report `OOMKilled` only when the
  `reason` field says `OOMKilled`.
- **Init containers** are checked too (`status.initContainerStatuses`), with
  `init: True`. When an init container fails, the app container sits in
  `waiting: PodInitializing`. That is a symptom, so do not report it.
  `ContainerCreating` is treated the same way.
- A **clean exit** (`exitCode: 0`) is not a problem.

### Grouping by owner

`groups` maps `"<namespace>/<Kind>/<name>"` to that owner's unhealthy pods:

- Use `metadata.ownerReferences`: the entry with `controller: true`, or else
  the first entry.
- **ReplicaSet to Deployment:** if the owner is a ReplicaSet whose name ends
  with `-<pod-template-hash label>`, strip that suffix and use
  `Deployment`. For example, owner `ReplicaSet/api-5f7b9c8d4` with label
  `pod-template-hash: 5f7b9c8d4` becomes `payments/Deployment/api`.
  Otherwise keep `ReplicaSet/<name>`.
- No owner means `"<namespace>/Pod/<pod name>"`. A missing namespace means
  `default`.
- Sort the keys, and sort the pods in each group by name. The same input
  must always give the same output, whatever order the pods arrive in.

### Malformed input: raise `MalformedInput`

`MalformedInput` is a `ValueError` subclass. Raise it with a message that
says where the problem is, for example
`items[1] (pod 'web-6d4cf56db6-t9vbn'): 'status' is missing`, when:

- the file is not valid JSON (do not let `json.JSONDecodeError` escape);
- the top level is not an object, `items` is missing, or `items` is not a
  list;
- an item is not an object, or has no `metadata.name`, no `status` or no
  `status.phase`;
- a field has the wrong type: `conditions`, `containerStatuses` or
  `initContainerStatuses` that is not a list of objects, a `restartCount`
  or `exitCode` that is not an int, and so on.

A **missing file** is not malformed input. `load()` lets the `OSError`
propagate, and the CLI reports it and exits 2.

### CLI

`python3 pod_health.py FILE`: the report goes to stdout and errors to stderr.
Exit codes: **0** all healthy or completed, **1** anything unhealthy,
**2** malformed or unreadable input, or a usage error.

## Example

```
$ python3 pod_health.py fixtures/oomkilled.json
2 pods: 0 healthy, 0 completed, 2 unhealthy

batch/Deployment/report-api (1 unhealthy)
  report-api-c7f9b6d48-h2rwn  phase=Running restarts=3
    - container report-api: CrashLoopBackOff [last run: Error, exit code 137] [restarts: 3]

batch/Deployment/worker (1 unhealthy)
  worker-84c6d9f7b5-vx5qp  phase=Running restarts=5
    - container worker: CrashLoopBackOff [last run: OOMKilled, exit code 137] [restarts: 5]
$ echo $?
1
```

Both containers exited 137. Only one ran out of memory.

The text format is up to you. The tests only check that it names the
workload, the pod and the evidence.

## Fixtures

| File | Contents |
|---|---|
| `healthy.json` | 2 web Deployment pods (one restarted once), a StatefulSet pod, a DaemonSet pod: all Running + Ready |
| `crashloop.json` | `api` Deployment: 2 pods in CrashLoopBackOff (last exit `Error`/1, 11 and 12 restarts), 1 healthy |
| `oomkilled.json` | `worker`: CrashLoopBackOff, last state `OOMKilled`/137. `report-api`: CrashLoopBackOff, last state `Error`/137 (killed after its liveness probe failed) |
| `imagepull.json` | `ledger` pods in `ImagePullBackOff` and `ErrImagePull` (tag not found) |
| `config-error.json` | `checkout` in `CreateContainerConfigError` (secret not found) |
| `pending-unschedulable.json` | `indexer` Pending: PodScheduled False / Unschedulable, "Insufficient memory", no container statuses |
| `not-ready.json` | `web` pod Running but its readiness probe fails, next to a healthy sibling |
| `completed-jobs.json` | Two Succeeded Job pods and one Failed Job pod (exit 2) |
| `init-failure.json` | `orders` Pending: init container `migrate` crash-looping, app container `PodInitializing` |
| `mixed.json` | Everything above in one list (18 pods) |
| `empty.json` | A List with no items |
| `malformed-invalid-json.json` | Truncated JSON |
| `malformed-missing-items.json` | A single Pod object (`kubectl get pod NAME -o json`), not a List |
| `malformed-item-missing-status.json` | Second item has no `status` |
| `malformed-wrong-types.json` | `restartCount` is the string `"12"` |

## Running the tests

Run these from this directory (`labs/python/01-pod-health`):

```sh
# your starter implementation
PYTHONPATH=. python3 -m unittest discover -s tests -t .

# the reference solution (should be all green)
PYTHONPATH=solution python3 -m unittest discover -s tests -t .

# a single test
PYTHONPATH=. python3 -m unittest tests.test_pod_health.Reasons.test_oomkilled_is_reported_from_reason
```

When you start, every test errors with `NotImplementedError`. That is
expected. To see output while you work:
`python3 pod_health.py fixtures/mixed.json`.

## Broken variants

`broken/*/pod_health.py` are believable wrong implementations. Before you run
the tests against one, read it and find the bug:

- `running-is-healthy`: trusts `phase == "Running"`
- `exit137-is-oom`: infers OOM from the exit code
- `crashes-on-malformed`: no validation

Then run `PYTHONPATH=broken/<variant> python3 -m unittest discover -s tests -t .`
and see which test catches it.

## Hints

Reveal these one at a time.

<details><summary>Hint 1: the order of work</summary>

Get `load()` and the validation working first, then counts only
(healthy/completed/unhealthy), then grouping, then reasons. Run the tests
after each step. The class names in the test file follow the same order.
</details>

<details><summary>Hint 2: validating without a mess</summary>

Write one helper, something like `_field(obj, key, type, where, required)`,
that returns `obj[key]` or raises `MalformedInput(f"{where}: ...")`. Watch
out: `isinstance(True, int)` is `True` in Python. Use `dict.get()` with a
default for optional fields: `(status.get("conditions") or [])`.
</details>

<details><summary>Hint 3: finding the reasons</summary>

Loop over `initContainerStatuses + containerStatuses`. For each container:
if `state` has `waiting`, emit its reason (skip ContainerCreating and
PodInitializing). If it has `terminated` with a non-zero exit, emit that. If
it is running and `ready` is False, emit not-ready. Always take
`last_reason`/`last_exit_code` from `lastState.terminated`. Then check the
`PodScheduled` condition. If you still have nothing, emit a `phase` reason.
</details>

<details><summary>Hint 4: the Deployment name</summary>

`name.endswith("-" + h)` and then `name[: -(len(h) + 1)]`. Only strip when the
pod's `pod-template-hash` label matches. Never cut at the last dash blindly:
`my-app-v2` would become `my-app`.
</details>
