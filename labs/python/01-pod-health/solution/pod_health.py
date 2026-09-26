"""Summarise pod health from `kubectl get pods -o json` output.

Reference solution for labs/python/01-pod-health. Read EXPLANATION.md next to
this file for the walkthrough; the comments below explain the *why* of each
step as you read the code top to bottom.

Usage:
    python3 pod_health.py pods.json

Exit codes:
    0  every pod is healthy (or completed)
    1  at least one pod is unhealthy
    2  the input could not be read or is not pod-list JSON
"""

# `from __future__ import annotations` lets us write type hints such as
# `dict | None` on Python 3.9, where that syntax is otherwise 3.10+ only.
# The hints are documentation; Python does not enforce them at runtime.
from __future__ import annotations

import json
import sys
from typing import Any, Iterator

# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class MalformedInput(ValueError):
    """The input is not a usable pod list.

    Subclassing ValueError means callers who only know "bad value" can still
    catch it with `except ValueError`, while callers who care can catch this
    precise type. The message always says *where* the problem is (for example
    `items[3] (pod 'web-1'): status is missing`) so a human can find it.
    """


# ---------------------------------------------------------------------------
# Vocabulary
# ---------------------------------------------------------------------------

# Waiting reasons that are a normal step on the way to Running. They are not
# evidence of a fault by themselves: a container waits in PodInitializing
# while its init containers run, and in ContainerCreating while the image
# is unpacked and volumes are mounted. We leave them out of the reasons so
# the report points at the cause (a failing init container, say) and not at
# its symptom. If a pod has *nothing but* these, the generic phase fallback
# below still reports it, so it is never silently dropped.
BENIGN_WAITING = {"ContainerCreating", "PodInitializing"}


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------


def load(path: str) -> dict:
    """Read a JSON file and return the parsed document.

    Raises MalformedInput if the file is not valid JSON or its top level is
    not a JSON object. OSError (file missing, permission denied) is allowed
    to propagate unchanged: that is a problem with the path, not with the
    content, and the caller should be able to tell the two apart.
    """
    # Opening with an explicit encoding avoids depending on the machine's
    # locale; kubectl always writes UTF-8.
    with open(path, encoding="utf-8") as fh:
        try:
            doc = json.load(fh)
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            # `from exc` keeps the original error attached as __cause__, so a
            # traceback still shows the exact line/column json complained about.
            raise MalformedInput(f"{path}: not valid JSON: {exc}") from exc
    if not isinstance(doc, dict):
        raise MalformedInput(
            f"{path}: top level must be a JSON object, got {type(doc).__name__}"
        )
    return doc


# ---------------------------------------------------------------------------
# Validation helpers
#
# The Kubernetes API is well-behaved, but files on disk are not: they get
# hand-edited, truncated, or produced by a different command. Rather than let
# a KeyError or TypeError escape from deep inside the logic (which tells the
# operator nothing), we check each field as we read it and raise one clear
# MalformedInput naming the path to the bad field.
# ---------------------------------------------------------------------------


def _type_name(value: Any) -> str:
    return type(value).__name__


def _field(obj: dict, key: str, kind: type, where: str, required: bool = False) -> Any:
    """Return obj[key] after checking its type.

    Missing optional fields return None. `kind` may be a type or a tuple of
    types, exactly as isinstance() accepts.
    """
    if key not in obj or obj[key] is None:
        if required:
            raise MalformedInput(f"{where}: '{key}' is missing")
        return None
    value = obj[key]
    # bool is a subclass of int in Python (True == 1), so a naive
    # isinstance(value, int) would accept `"restartCount": true`. Reject it.
    if kind is int and isinstance(value, bool):
        raise MalformedInput(f"{where}: '{key}' must be int, got bool")
    if not isinstance(value, kind):
        expected = kind.__name__ if isinstance(kind, type) else "/".join(k.__name__ for k in kind)
        raise MalformedInput(f"{where}: '{key}' must be {expected}, got {_type_name(value)}")
    return value


def _list_of_dicts(obj: dict, key: str, where: str) -> list:
    """An optional list whose elements must all be objects; [] if absent."""
    value = _field(obj, key, list, where)
    if value is None:
        return []
    for i, entry in enumerate(value):
        if not isinstance(entry, dict):
            raise MalformedInput(
                f"{where}: {key}[{i}] must be an object, got {_type_name(entry)}"
            )
    return value


def _iter_pods(doc: Any) -> Iterator[tuple]:
    """Yield (where, metadata, status) for each pod, validating as we go.

    `where` is a human-readable location string used in error messages.
    """
    if not isinstance(doc, dict):
        raise MalformedInput(f"top level must be a JSON object, got {_type_name(doc)}")
    if "items" not in doc:
        # The most common mistake: feeding a single pod (`kubectl get pod x
        # -o json`) or some other object. Say what we expected.
        raise MalformedInput(
            "missing 'items': expected the output of `kubectl get pods -o json` (a List)"
        )
    items = doc["items"]
    if not isinstance(items, list):
        raise MalformedInput(f"'items' must be a list, got {_type_name(items)}")

    for index, item in enumerate(items):
        where = f"items[{index}]"
        if not isinstance(item, dict):
            raise MalformedInput(f"{where}: must be an object, got {_type_name(item)}")
        meta = _field(item, "metadata", dict, where, required=True)
        name = _field(meta, "name", str, where + ".metadata", required=True)
        # From here on the error messages can name the pod, which is far more
        # useful to a human than an index.
        where = f"{where} (pod {name!r})"
        _field(meta, "namespace", str, where + ".metadata")
        _field(meta, "labels", dict, where + ".metadata")
        for ref in _list_of_dicts(meta, "ownerReferences", where + ".metadata"):
            _field(ref, "kind", str, where + ".ownerReferences[]", required=True)
            _field(ref, "name", str, where + ".ownerReferences[]", required=True)

        status = _field(item, "status", dict, where, required=True)
        _field(status, "phase", str, where + ".status", required=True)
        for cond in _list_of_dicts(status, "conditions", where + ".status"):
            _field(cond, "type", str, where + ".status.conditions[]", required=True)
            _field(cond, "status", str, where + ".status.conditions[]", required=True)
        for key in ("initContainerStatuses", "containerStatuses"):
            for cs in _list_of_dicts(status, key, where + ".status"):
                cwhere = f"{where}.status.{key}[]"
                _field(cs, "name", str, cwhere, required=True)
                _field(cs, "restartCount", int, cwhere)
                _field(cs, "ready", bool, cwhere)
                for state_key in ("state", "lastState"):
                    state = _field(cs, state_key, dict, cwhere)
                    if state and isinstance(state.get("terminated"), dict):
                        _field(state["terminated"], "exitCode", int, f"{cwhere}.{state_key}.terminated")
        yield where, meta, status


# ---------------------------------------------------------------------------
# Ownership: which workload does this pod belong to?
# ---------------------------------------------------------------------------


def owner_key(meta: dict) -> str:
    """Return 'namespace/Kind/name' for the workload that owns this pod.

    Pods carry `metadata.ownerReferences`. The entry with `controller: true`
    is the one that manages the pod; if none is flagged we take the first.

    Deployments do not own pods directly: a Deployment owns ReplicaSets, and
    each ReplicaSet owns pods. The ReplicaSet is named
    `<deployment>-<pod-template-hash>`, and the Deployment controller also
    stamps that hash onto the pod as the `pod-template-hash` label. So when
    the owner is a ReplicaSet *and* its name ends with `-<that label>`, we
    strip the suffix and report the Deployment instead.

    Limits of the heuristic (see EXPLANATION.md): the authoritative answer is
    the ReplicaSet's own ownerReferences, which are not in a pod listing. A
    bare ReplicaSet that happens to carry the label would be mislabelled as
    a Deployment, and a ReplicaSet without the label stays a ReplicaSet.
    """
    namespace = meta.get("namespace") or "default"
    refs = meta.get("ownerReferences") or []
    # next(generator, default) returns the first match or the default.
    ref = next((r for r in refs if r.get("controller") is True), refs[0] if refs else None)
    if ref is None:
        # A bare pod: nothing will recreate it if it dies. Group it under itself.
        return f"{namespace}/Pod/{meta['name']}"

    kind, name = ref["kind"], ref["name"]
    if kind == "ReplicaSet":
        pod_hash = (meta.get("labels") or {}).get("pod-template-hash")
        if isinstance(pod_hash, str) and pod_hash and name.endswith("-" + pod_hash):
            return f"{namespace}/Deployment/{name[: -len(pod_hash) - 1]}"
    return f"{namespace}/{kind}/{name}"


# ---------------------------------------------------------------------------
# Health: is this pod OK, and if not, why?
# ---------------------------------------------------------------------------


def _condition(status: dict, cond_type: str) -> dict | None:
    """Return the pod condition of the given type, or None."""
    for cond in status.get("conditions") or []:
        if cond.get("type") == cond_type:
            return cond
    return None


def _is_ready(status: dict) -> bool:
    """True if the pod is Ready.

    The pod-level Ready condition is authoritative: it already accounts for
    every container's readiness probe and for readiness gates. Only if that
    condition is absent (a hand-trimmed file, say) do we fall back to "every
    container reports ready", and an empty container list is *not* ready.
    """
    cond = _condition(status, "Ready")
    if cond is not None:
        return cond.get("status") == "True"  # the API uses the strings "True"/"False"
    containers = status.get("containerStatuses") or []
    return bool(containers) and all(cs.get("ready") is True for cs in containers)


def _reason(kind: str, **fields: Any) -> dict:
    """Build a reason dict with every key present (None when not applicable).

    A fixed shape means consumers (the CLI, the tests, a future JSON output)
    can read reason["exit_code"] without first checking the key exists.
    """
    base = {
        "kind": kind,
        "container": None,
        "init": False,
        "reason": None,
        "message": None,
        "exit_code": None,
        "last_reason": None,
        "last_exit_code": None,
        "restarts": None,
    }
    base.update(fields)
    return base


def _container_reasons(cs: dict, init: bool) -> list:
    """Evidence of trouble for one container status (may be empty)."""
    state = cs.get("state") or {}
    last = (cs.get("lastState") or {}).get("terminated") or {}
    common = {
        "container": cs["name"],
        "init": init,
        "restarts": cs.get("restartCount") or 0,
        # lastState.terminated is the *previous* run. For a crash-looping
        # container this is where the real cause lives: the current state is
        # just "waiting to be restarted".
        #
        # We copy Kubernetes' reason verbatim. Exit code 137 means "killed by
        # SIGKILL" (128 + 9). The kernel OOM killer sends SIGKILL, but so does
        # the kubelet when a liveness probe fails past its grace period, and so
        # does `kill -9`. Only reason == "OOMKilled" says it was memory.
        "last_reason": last.get("reason"),
        "last_exit_code": last.get("exitCode"),
    }

    waiting = state.get("waiting")
    if isinstance(waiting, dict):
        reason = waiting.get("reason")
        if reason in BENIGN_WAITING:
            return []
        # CrashLoopBackOff, ImagePullBackOff, ErrImagePull,
        # CreateContainerConfigError, ... all land here with their own name.
        return [_reason("waiting", reason=reason, message=waiting.get("message"), **common)]

    terminated = state.get("terminated")
    if isinstance(terminated, dict):
        code = terminated.get("exitCode")
        if code == 0:
            # A clean exit is fine: init containers are meant to finish, and
            # so are Job containers.
            return []
        return [
            _reason(
                "terminated",
                reason=terminated.get("reason"),
                message=terminated.get("message"),
                exit_code=code,
                **common,
            )
        ]

    # Running (or no state at all). A running *app* container that is not
    # ready is failing its readiness probe - the classic "pod is Running but
    # gets no traffic". Init containers have no readiness, so skip them.
    if not init and cs.get("ready") is False and "running" in state:
        return [_reason("not-ready", message="running but not ready (readiness probe failing?)", **common)]
    return []


def pod_report(meta: dict, status: dict) -> dict:
    """Classify one (already validated) pod.

    Returns a dict with a 'state' of 'healthy', 'completed' or 'unhealthy',
    plus name/namespace/phase/restarts and, for unhealthy pods, 'reasons'.
    """
    phase = status["phase"]
    init_statuses = status.get("initContainerStatuses") or []
    app_statuses = status.get("containerStatuses") or []
    report = {
        "namespace": meta.get("namespace") or "default",
        "name": meta["name"],
        "phase": phase,
        # Total restarts across every container, init containers included.
        "restarts": sum((cs.get("restartCount") or 0) for cs in init_statuses + app_statuses),
        "reasons": [],
    }

    # 1. Finished successfully (Job pods). Not running, but not a problem -
    #    counting these as unhealthy is a classic source of false alarms.
    if phase == "Succeeded":
        report["state"] = "completed"
        return report

    # 2. Healthy means Running AND Ready. Running alone only says a container
    #    process exists; Ready says the pod passes its readiness checks and is
    #    in the Service endpoints. A pod in CrashLoopBackOff is usually in
    #    phase Running, which is exactly why phase alone is not enough.
    if phase == "Running" and _is_ready(status):
        report["state"] = "healthy"
        return report

    # 3. Everything else is unhealthy. Gather the evidence, init containers
    #    first because a failing init container blocks everything after it.
    reasons = []
    for cs in init_statuses:
        reasons.extend(_container_reasons(cs, init=True))
    for cs in app_statuses:
        reasons.extend(_container_reasons(cs, init=False))

    # 4. The scheduler could not place the pod. There are no container
    #    statuses at all yet, so the condition is the only evidence. Its
    #    message is the useful part ("0/3 nodes are available: 3 Insufficient
    #    memory.").
    scheduled = _condition(status, "PodScheduled")
    if scheduled and scheduled.get("status") == "False" and scheduled.get("reason") == "Unschedulable":
        reasons.append(_reason("unschedulable", reason="Unschedulable", message=scheduled.get("message")))

    # 5. Never return an unhealthy pod with no explanation. Pod-level
    #    status.reason covers things like Evicted; otherwise say what we know.
    if not reasons or status.get("reason"):
        ready = _condition(status, "Ready") or {}
        reasons.append(
            _reason(
                "phase",
                reason=status.get("reason") or ready.get("reason"),
                message=status.get("message") or ready.get("message") or f"phase {phase}, not ready",
            )
        )

    report["state"] = "unhealthy"
    report["reasons"] = reasons
    return report


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def summarize(doc: dict) -> dict:
    """Summarise a `kubectl get pods -o json` document.

    Returns:
        {
          "total": int, "healthy": int, "completed": int, "unhealthy": int,
          "groups": {"<namespace>/<Kind>/<name>": [pod_report, ...], ...}
        }

    Only unhealthy pods appear in "groups". Groups are sorted by key and pods
    by name, so the same input always gives the same output (important for
    diffs, tests and alert deduplication).

    Raises MalformedInput if the document is not a pod list. The whole
    document is validated before anything is returned: a partial summary
    that silently skipped a bad item would under-report problems.
    """
    counts = {"healthy": 0, "completed": 0, "unhealthy": 0}
    groups: dict = {}
    # list() forces the generator to run to the end, so validation of every
    # item happens before we build any output.
    for _where, meta, status in list(_iter_pods(doc)):
        report = pod_report(meta, status)
        counts[report.pop("state")] += 1
        if report["reasons"]:
            groups.setdefault(owner_key(meta), []).append(report)

    return {
        "total": sum(counts.values()),
        **counts,
        "groups": {key: sorted(pods, key=lambda p: p["name"]) for key, pods in sorted(groups.items())},
    }


def describe(reason: dict) -> str:
    """One line of human text for a reason dict."""
    who = ""
    if reason["container"]:
        who = ("init container " if reason["init"] else "container ") + reason["container"] + ": "
    kind = reason["kind"]
    if kind == "not-ready":
        text = "running but not Ready (check the readiness probe)"
    elif kind == "unschedulable":
        text = f"Unschedulable: {reason['message']}"
    elif kind == "terminated":
        text = f"terminated {reason['reason'] or 'Error'} (exit code {reason['exit_code']})"
    elif kind == "waiting":
        text = reason["reason"] or "waiting"
        # CrashLoopBackOff's message is just the back-off timer; the useful
        # part is the last run, added below. Other waiting messages (image
        # not found, secret missing) are the diagnosis, so keep them.
        if reason["message"] and reason["reason"] != "CrashLoopBackOff":
            text += f": {reason['message']}"
    else:
        text = reason["reason"] or "unhealthy"
        if reason["message"]:
            text += f": {reason['message']}"
    if reason["last_reason"] or reason["last_exit_code"] is not None:
        text += f" [last run: {reason['last_reason'] or '?'}, exit code {reason['last_exit_code']}]"
    if reason["restarts"]:
        text += f" [restarts: {reason['restarts']}]"
    return who + text


def format_summary(summary: dict) -> str:
    """Render the summary as a short human-readable report."""
    lines = [
        f"{summary['total']} pods: {summary['healthy']} healthy, "
        f"{summary['completed']} completed, {summary['unhealthy']} unhealthy"
    ]
    for key, pods in summary["groups"].items():
        lines.append("")
        lines.append(f"{key} ({len(pods)} unhealthy)")
        for pod in pods:
            lines.append(f"  {pod['name']}  phase={pod['phase']} restarts={pod['restarts']}")
            for reason in pod["reasons"]:
                lines.append(f"    - {describe(reason)}")
    return "\n".join(lines)


def main(argv: list | None = None) -> int:
    """CLI entry point. Returns the exit code instead of calling sys.exit,
    so tests can call it directly."""
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 1:
        print("usage: pod_health.py PODS_JSON", file=sys.stderr)
        return 2
    try:
        summary = summarize(load(args[0]))
    except MalformedInput as exc:
        # Errors go to stderr, so stdout stays clean for the report.
        print(f"error: malformed input: {exc}", file=sys.stderr)
        return 2
    except OSError as exc:
        print(f"error: cannot read {args[0]}: {exc}", file=sys.stderr)
        return 2
    print(format_summary(summary))
    return 1 if summary["unhealthy"] else 0


# This block runs only when the file is executed as a script, not when it
# is imported by the tests.
if __name__ == "__main__":
    sys.exit(main())
