"""Summarise pod health from `kubectl get pods -o json` output.

STARTER FILE: replace every `raise NotImplementedError` with your code.
Read README.md first; it defines the exact behaviour the tests check.

Usage:
    python3 pod_health.py pods.json

Exit codes:
    0  every pod is healthy (or completed)
    1  at least one pod is unhealthy
    2  the input could not be read or is not pod-list JSON
"""
from __future__ import annotations

import json  # noqa: F401  (you will need these)
import sys


class MalformedInput(ValueError):
    """The input is not a usable pod list.

    Raise this (never a bare KeyError/TypeError/JSONDecodeError) whenever the
    document does not have the shape described in README.md. Put the
    location in the message, e.g. "items[3] (pod 'web-1'): 'status' is missing".
    """


def load(path: str) -> dict:
    """Read the JSON file at `path` and return the parsed document.

    - Invalid JSON                    -> raise MalformedInput
    - Top level is not a JSON object  -> raise MalformedInput
    - File missing / unreadable       -> let the OSError propagate
    """
    raise NotImplementedError("load")


def summarize(doc: dict) -> dict:
    """Classify every pod in `doc` and group the unhealthy ones by owner.

    Returns:
        {
          "total": int,        # number of pods
          "healthy": int,      # phase Running AND Ready condition True
          "completed": int,    # phase Succeeded (finished Job pods)
          "unhealthy": int,    # everything else
          "groups": {          # unhealthy pods only, keys sorted
              "<namespace>/<OwnerKind>/<owner name>": [   # pods sorted by name
                  {
                    "namespace": str, "name": str, "phase": str,
                    "restarts": int,          # sum over all containers, init included
                    "reasons": [reason, ...], # never empty for an unhealthy pod
                  },
              ],
          },
        }

    Each reason is a dict with ALL of these keys (None when not applicable):
        kind            "waiting" | "terminated" | "not-ready" | "unschedulable" | "phase"
        container       container name, or None for pod-level reasons
        init            True if the container is an init container
        reason          Kubernetes' own reason string, verbatim
        message         Kubernetes' message, verbatim
        exit_code       current state's exit code (kind == "terminated")
        last_reason     lastState.terminated.reason
        last_exit_code  lastState.terminated.exitCode
        restarts        that container's restartCount

    Raises MalformedInput if `doc` is not a pod list (see README.md).
    """
    raise NotImplementedError("summarize")


def format_summary(summary: dict) -> str:
    """Render the dict from summarize() as a short human-readable report.

    Must mention, for each unhealthy pod, its group key, its name and the
    evidence (reason strings and exit codes).
    """
    raise NotImplementedError("format_summary")


def main(argv: list | None = None) -> int:
    """CLI entry point: `pod_health.py FILE`.

    `argv` excludes the program name (defaults to sys.argv[1:]). Print the
    report to stdout and errors to stderr. Return the exit code (0/1/2)
    rather than calling sys.exit(), so tests can call main() directly.
    Wrong number of arguments -> usage message on stderr, return 2.
    """
    raise NotImplementedError("main")


if __name__ == "__main__":
    sys.exit(main())
