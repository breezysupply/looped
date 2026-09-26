"""Behavioural tests for pod_health.

These tests describe *what* the tool must report for realistic kubectl
output, not *how* it computes it. They only use the public API: load(),
summarize(), main() and MalformedInput.

Which implementation is tested is chosen by PYTHONPATH (see ../README.md):
    PYTHONPATH=.          the starter you are writing
    PYTHONPATH=solution   the reference solution
    PYTHONPATH=broken/X   a deliberately broken variant
"""
import contextlib
import copy
import io
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

# `python -m unittest` (and pytest) put the current directory at the front of
# sys.path, ahead of PYTHONPATH. The exercise directory contains the starter
# pod_health.py, so without this it would shadow solution/ and broken/*/.
# Re-inserting the PYTHONPATH entries at the front makes PYTHONPATH win.
for _entry in reversed(os.environ.get("PYTHONPATH", "").split(os.pathsep)):
    if _entry:
        sys.path.insert(0, os.path.abspath(_entry))

import pod_health  # noqa: E402  (must come after the sys.path fix above)

# Fixtures live next to the tests, never next to the module under test.
FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"


def summary_of(name):
    return pod_health.summarize(pod_health.load(str(FIXTURES / name)))


def pods_in(summary):
    """Flatten groups into {pod name: (group key, pod report)}."""
    return {pod["name"]: (key, pod) for key, pods in summary["groups"].items() for pod in pods}


def only_reason(pod, kind=None):
    """The pod must have exactly one reason (optionally of a given kind)."""
    reasons = pod["reasons"]
    if kind is not None:
        reasons = [r for r in reasons if r["kind"] == kind]
    assert len(reasons) == 1, f"expected one {kind or ''} reason for {pod['name']}, got {pod['reasons']}"
    return reasons[0]


def minimal_pod(name, namespace=None, owners=None, labels=None, phase="Pending"):
    meta = {"name": name}
    if namespace:
        meta["namespace"] = namespace
    if owners is not None:
        meta["ownerReferences"] = owners
    if labels is not None:
        meta["labels"] = labels
    return {"metadata": meta, "status": {"phase": phase}}


class Classification(unittest.TestCase):
    def test_all_healthy_and_empty(self):
        # healthy.json includes a pod with a restart: still healthy.
        for name, total in (("healthy.json", 4), ("empty.json", 0)):
            with self.subTest(name):
                s = summary_of(name)
                self.assertEqual((s["total"], s["healthy"], s["completed"], s["unhealthy"]), (total, total, 0, 0))
                self.assertEqual(s["groups"], {})

    def test_running_but_not_ready_is_unhealthy(self):
        s = summary_of("not-ready.json")
        self.assertEqual((s["healthy"], s["unhealthy"]), (1, 1))
        key, pod = pods_in(s)["web-6d4cf56db6-k4j7s"]
        self.assertEqual(pod["phase"], "Running")
        r = only_reason(pod)
        self.assertEqual(r["kind"], "not-ready")
        self.assertEqual(r["container"], "web")

    def test_succeeded_job_pods_are_completed_failed_are_not(self):
        s = summary_of("completed-jobs.json")
        self.assertEqual((s["completed"], s["unhealthy"], s["healthy"]), (2, 1, 0))
        names = pods_in(s)
        self.assertNotIn("nightly-report-29312640-9rx2c", names)
        self.assertNotIn("nightly-report-29311200-hk5mt", names)
        # ...but a Failed job pod is unhealthy, with its exit code.
        key, pod = names["invoice-export-29312700-d7lqz"]
        self.assertEqual(key, "batch/Job/invoice-export-29312700")
        r = only_reason(pod)
        self.assertEqual((r["kind"], r["reason"], r["exit_code"]), ("terminated", "Error", 2))


class Reasons(unittest.TestCase):
    def test_crashloop_uses_last_terminated_state(self):
        s = summary_of("crashloop.json")
        self.assertEqual((s["healthy"], s["unhealthy"]), (1, 2))
        _, pod = pods_in(s)["api-5f7b9c8d4-7xk2d"]
        self.assertEqual(pod["restarts"], 12)
        r = only_reason(pod)
        self.assertEqual((r["kind"], r["reason"], r["container"]), ("waiting", "CrashLoopBackOff", "api"))
        self.assertEqual((r["last_reason"], r["last_exit_code"]), ("Error", 1))
        self.assertEqual(r["restarts"], 12)

    def test_oomkilled_is_reported_from_reason(self):
        _, pod = pods_in(summary_of("oomkilled.json"))["worker-84c6d9f7b5-vx5qp"]
        r = only_reason(pod)
        self.assertEqual((r["reason"], r["last_reason"], r["last_exit_code"]), ("CrashLoopBackOff", "OOMKilled", 137))

    def test_exit_137_without_oomkilled_reason_is_not_oom(self):
        # Liveness-probe kills are SIGKILL too (128 + 9 = 137). Only the
        # reason field can say the kernel OOM killer did it.
        _, pod = pods_in(summary_of("oomkilled.json"))["report-api-c7f9b6d48-h2rwn"]
        r = only_reason(pod)
        self.assertEqual(r["last_exit_code"], 137)
        self.assertEqual(r["last_reason"], "Error")
        self.assertNotIn("OOM", json.dumps(pod))

    def test_waiting_reasons_keep_their_message(self):
        pods = pods_in(summary_of("imagepull.json"))
        r1 = only_reason(pods["ledger-7d8f6b5c9-fn4ks"][1])
        r2 = only_reason(pods["ledger-7d8f6b5c9-zr7tx"][1])
        self.assertEqual((r1["kind"], r1["reason"]), ("waiting", "ImagePullBackOff"))
        self.assertEqual((r2["kind"], r2["reason"]), ("waiting", "ErrImagePull"))
        self.assertIn("ledger:2.4.0-rc1", r1["message"])
        _, pod = pods_in(summary_of("config-error.json"))["checkout-66b5c8d97f-p8d2l"]
        r = only_reason(pod)
        self.assertEqual(r["reason"], "CreateContainerConfigError")
        self.assertIn("checkout-db-creds", r["message"])

    def test_pending_unschedulable_uses_scheduler_message(self):
        s = summary_of("pending-unschedulable.json")
        key, pod = pods_in(s)["indexer-5c9f7d8b6-wq4ht"]
        self.assertEqual(pod["phase"], "Pending")
        r = only_reason(pod, "unschedulable")
        self.assertIn("Insufficient memory", r["message"])

    def test_init_container_failure_is_the_reason_not_podinitializing(self):
        _, pod = pods_in(summary_of("init-failure.json"))["orders-6b8d5f9c7-jn2vd"]
        r = only_reason(pod)
        self.assertTrue(r["init"])
        self.assertEqual((r["container"], r["reason"], r["last_exit_code"]), ("migrate", "CrashLoopBackOff", 1))
        self.assertEqual(pod["restarts"], 4)
        self.assertNotIn("PodInitializing", json.dumps(pod))


class Grouping(unittest.TestCase):
    def test_replicaset_pods_group_under_their_deployment(self):
        s = summary_of("mixed.json")
        api = s["groups"]["payments/Deployment/api"]
        self.assertEqual([p["name"] for p in api], ["api-5f7b9c8d4-7xk2d", "api-5f7b9c8d4-b8wq4"])
        self.assertIn("search/Deployment/indexer", s["groups"])
        self.assertIn("shop/Deployment/web", s["groups"])
        self.assertEqual((s["total"], s["healthy"], s["completed"], s["unhealthy"]), (18, 5, 2, 11))
        grouped = [p for pods in s["groups"].values() for p in pods]
        self.assertEqual(len(grouped), s["unhealthy"])
        for pod in grouped:
            self.assertTrue(pod["reasons"], f"{pod['name']} is unhealthy with no reason")

    def test_owner_fallbacks(self):
        doc = {"items": [
            # ReplicaSet without a pod-template-hash label: stays a ReplicaSet.
            minimal_pod("legacy-abcde", "ops", [{"kind": "ReplicaSet", "name": "legacy", "controller": True}]),
            # Label present but the name does not end with it: do not strip.
            minimal_pod("odd-x1", "ops", [{"kind": "ReplicaSet", "name": "odd-rs", "controller": True}],
                        labels={"pod-template-hash": "7f9c"}),
            # Bare pod, no namespace: grouped under itself in "default".
            minimal_pod("debug-shell"),
            # Two owners: the controller one wins.
            minimal_pod("db-1", "data", [{"kind": "ConfigMap", "name": "x"},
                                         {"kind": "StatefulSet", "name": "db", "controller": True}]),
        ]}
        keys = set(pod_health.summarize(doc)["groups"])
        self.assertEqual(keys, {"ops/ReplicaSet/legacy", "ops/ReplicaSet/odd-rs",
                                "default/Pod/debug-shell", "data/StatefulSet/db"})

    def test_output_does_not_depend_on_input_order(self):
        doc = pod_health.load(str(FIXTURES / "mixed.json"))
        reversed_doc = copy.deepcopy(doc)
        reversed_doc["items"].reverse()
        a, b = pod_health.summarize(doc), pod_health.summarize(reversed_doc)
        self.assertEqual(a, b)
        self.assertEqual(list(a["groups"]), sorted(a["groups"]))


class MalformedInputs(unittest.TestCase):
    def test_malformed_fixtures(self):
        self.assertTrue(issubclass(pod_health.MalformedInput, ValueError))
        for name in ("malformed-invalid-json.json", "malformed-missing-items.json", "malformed-wrong-types.json"):
            with self.subTest(name):
                # assertRaises(MalformedInput), not ValueError: json's own
                # JSONDecodeError is also a ValueError and must not leak out.
                with self.assertRaises(pod_health.MalformedInput) as ctx:
                    summary_of(name)
                if "missing-items" in name:
                    self.assertIn("items", str(ctx.exception))

    def test_item_missing_status_names_the_pod(self):
        with self.assertRaises(pod_health.MalformedInput) as ctx:
            summary_of("malformed-item-missing-status.json")
        self.assertIn("web-6d4cf56db6-t9vbn", str(ctx.exception))

    def test_structural_type_errors(self):
        good = minimal_pod("p")
        cases = {
            "top level list": [good],
            "items not a list": {"items": {"p": good}},
            "item is a string": {"items": ["p"]},
            "metadata missing": {"items": [{"status": {"phase": "Running"}}]},
            "status not an object": {"items": [{"metadata": {"name": "p"}, "status": "Running"}]},
            "phase missing": {"items": [{"metadata": {"name": "p"}, "status": {}}]},
            "conditions not a list": {"items": [{"metadata": {"name": "p"},
                                                 "status": {"phase": "Running", "conditions": "Ready"}}]},
            "containerStatuses not a list": {"items": [{"metadata": {"name": "p"},
                                                        "status": {"phase": "Running", "containerStatuses": "web"}}]},
        }
        for label, doc in cases.items():
            with self.subTest(label):
                with self.assertRaises(pod_health.MalformedInput):
                    pod_health.summarize(doc)

    def test_missing_file_is_not_malformed_input(self):
        with self.assertRaises(OSError):
            pod_health.load(str(FIXTURES / "does-not-exist.json"))


class Cli(unittest.TestCase):
    def run_main(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = pod_health.main([str(a) for a in args])
        return code, out.getvalue(), err.getvalue()

    def test_exit_codes(self):
        cases = [
            ("healthy.json", 0), ("completed-jobs.json", 1), ("mixed.json", 1),
            ("malformed-invalid-json.json", 2), ("malformed-missing-items.json", 2),
            ("malformed-wrong-types.json", 2), ("does-not-exist.json", 2),
        ]
        for name, expected in cases:
            with self.subTest(name):
                code, _, _ = self.run_main(FIXTURES / name)
                self.assertEqual(code, expected)

    def test_report_names_workload_pod_and_cause(self):
        code, out, err = self.run_main(FIXTURES / "oomkilled.json")
        self.assertEqual(code, 1)
        self.assertIn("batch/Deployment/worker", out)
        self.assertIn("worker-84c6d9f7b5-vx5qp", out)
        self.assertIn("OOMKilled", out)
        self.assertIn("137", out)

    def test_errors_go_to_stderr(self):
        code, out, err = self.run_main(FIXTURES / "malformed-missing-items.json")
        self.assertEqual(code, 2)
        self.assertEqual(out, "")
        self.assertIn("items", err)
        code, _, err = self.run_main()  # no argument: usage error
        self.assertEqual(code, 2)
        self.assertTrue(err)

    def test_runs_as_a_script(self):
        script = pod_health.__file__
        for name, expected in (("healthy.json", 0), ("mixed.json", 1), ("malformed-missing-items.json", 2)):
            with self.subTest(name):
                proc = subprocess.run([sys.executable, script, str(FIXTURES / name)],
                                      capture_output=True, text=True, timeout=60)
                self.assertEqual(proc.returncode, expected, proc.stderr)


if __name__ == "__main__":
    unittest.main()
