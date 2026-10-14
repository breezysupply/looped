"""Shared validation and evidence library for the SRE & Cloud Deployment
Foundations labs.

A validator is a small Python script that:
  1. builds a Report for its lab,
  2. queries REAL state (files, processes, sockets, HTTP, docker, kubectl,
     terraform, psql ...) through the helpers here,
  3. records each check with the observation that justifies it,
  4. writes the evidence JSON and exits non-zero when a required check fails.

Printing a predefined "all green" JSON is never validation; every check
below carries the observed value it was judged on, so a reader can see what
was measured. Reports are learner evidence, not attested execution.

Standard library only. Python 3.9+.
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import socket
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

SCHEMA_VERSION = "1.0"
TRACK_ID = "sre-cloud-foundations"
CONTENT_VERSION = "1.0"

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
REPO = os.path.abspath(os.path.join(ROOT, "..", ".."))

# Names every lab scopes itself to. Scripts refuse anything else.
VM_NAME = "looped-foundations"
KIND_BASIC = "looped-foundations"
KIND_POLICY = "looped-policy"
KIND_CONTEXTS = ("kind-looped-foundations", "kind-looped-policy")
COMPOSE_PREFIX = "looped-"
NAMESPACE = "beacon"


class Report:
    def __init__(self, lab_id: str, profile: str, execution_mode: str = "local") -> None:
        self.lab_id = lab_id
        self.profile = profile
        self.execution_mode = execution_mode
        self.started = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        self.checks: List[Dict[str, Any]] = []
        self.required: Dict[str, bool] = {}
        self.notes: List[str] = []
        self.seed = os.environ.get("LOOPED_SEED", "variant-a")
        self.assistance = os.environ.get("LOOPED_ASSISTANCE", "independent")
        self.cleanup = os.environ.get("LOOPED_CLEANUP", "pending")

    def check(self, cid: str, passed: bool, observed: Any, critical: bool = True) -> bool:
        obs = str(observed)
        self.checks.append({"id": cid, "passed": bool(passed), "observed": obs[:600], "critical": bool(critical)})
        self.required[cid] = bool(critical)
        mark = "PASS" if passed else "FAIL"
        sys.stdout.write(f"{mark} {cid}: {obs[:200]}\n")
        return bool(passed)

    def note(self, text: str) -> None:
        self.notes.append(text)
        sys.stdout.write(f"note {text}\n")

    def environment(self, extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        env: Dict[str, Any] = {
            "profile": self.profile,
            "arch": platform.machine(),
            "os": platform.system(),
            "release": platform.release(),
            "python": platform.python_version(),
        }
        if os.path.exists("/etc/os-release"):
            try:
                with open("/etc/os-release", "r", encoding="utf-8") as fh:
                    for line in fh:
                        if line.startswith("PRETTY_NAME="):
                            env["distro"] = line.split("=", 1)[1].strip().strip('"')
            except OSError:
                pass
        for tool in ("docker", "kind", "kubectl", "helm", "terraform"):
            v = tool_version(tool)
            if v:
                env[tool] = v
        if extra:
            env.update(extra)
        return env

    def passed(self) -> bool:
        # the lab passes on its required (critical) checks; advisory checks are
        # reported and kept in the evidence but do not fail the run
        return bool(self.checks) and all(c["passed"] for c in self.checks if c["critical"])

    def required_passed(self) -> bool:
        return all(c["passed"] for c in self.checks if c["critical"])

    def to_json(self, explanation: str = "", extra_env: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return {
            "schemaVersion": SCHEMA_VERSION,
            "trackId": TRACK_ID,
            "activityId": self.lab_id,
            "contentVersion": CONTENT_VERSION,
            "executionMode": self.execution_mode,
            "assistance": self.assistance,
            "seed": self.seed,
            "startedAt": self.started,
            "completedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "environment": self.environment(extra_env),
            "checks": [{"id": c["id"], "passed": c["passed"], "observed": c["observed"]} for c in self.checks],
            "explanation": explanation,
            "cleanupStatus": self.cleanup,
            "notes": self.notes,
            "evidenceRefs": [],
        }

    def finish(self, out_path: Optional[str], explanation: str = "", extra_env: Optional[Dict[str, Any]] = None) -> int:
        doc = self.to_json(explanation, extra_env)
        if out_path:
            os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
            with open(out_path, "w", encoding="utf-8") as fh:
                json.dump(doc, fh, indent=2)
            sys.stdout.write(f"evidence written to {out_path}\n")
        ok = self.passed()
        n_fail = sum(1 for c in self.checks if not c["passed"])
        sys.stdout.write(("PASS" if ok else "FAIL") + f" {self.lab_id}: {len(self.checks) - n_fail}/{len(self.checks)} checks passed\n")
        if not ok:
            sys.stdout.write("Not all checks passed. Paste the evidence anyway if you want the attempt recorded as failed; it never counts as a pass.\n")
        return 0 if ok else 1


def standard_args(lab_id: str, description: str = "") -> argparse.Namespace:
    p = argparse.ArgumentParser(prog=f"validate.py ({lab_id})", description=description or f"Validate lab {lab_id} against real state and write evidence")
    p.add_argument("--out", default=os.path.join(ROOT, lab_id, "evidence", "latest.json"), help="evidence JSON path")
    p.add_argument("--explanation", default="", help="your written diagnosis (or read from --explanation-file)")
    p.add_argument("--explanation-file", default="", help="file with your explanation")
    p.add_argument("--variant", default=os.environ.get("LOOPED_VARIANT", ""), help="variant seed used for this run")
    p.add_argument("--assistance", default=os.environ.get("LOOPED_ASSISTANCE", "independent"), choices=["guided", "assisted", "independent", "self-reported"])
    p.add_argument("--cleanup", default=os.environ.get("LOOPED_CLEANUP", "pending"), choices=["verified", "reported", "pending", "not-applicable"])
    args = p.parse_args()
    if args.explanation_file:
        with open(args.explanation_file, "r", encoding="utf-8") as fh:
            args.explanation = fh.read()
    return args


def apply_args(report: Report, args: argparse.Namespace) -> None:
    if args.variant:
        report.seed = args.variant
    report.assistance = args.assistance
    report.cleanup = args.cleanup


# ── real-state helpers ────────────────────────────────────────────────────

def sh(cmd: Sequence[str], timeout: float = 60.0, env: Optional[Dict[str, str]] = None, input_text: Optional[str] = None) -> Tuple[int, str, str]:
    """Run a command (no shell). Returns (code, stdout, stderr); never raises on non-zero."""
    try:
        r = subprocess.run(list(cmd), capture_output=True, text=True, timeout=timeout, env=env, input=input_text)
        return r.returncode, r.stdout, r.stderr
    except FileNotFoundError:
        return 127, "", f"{cmd[0]}: not found"
    except subprocess.TimeoutExpired:
        return 124, "", f"{' '.join(cmd)}: timed out after {timeout}s"


def tool_version(tool: str) -> Optional[str]:
    if not shutil.which(tool):
        return None
    flags = {"docker": ["--version"], "kind": ["version"], "kubectl": ["version", "--client", "-o", "json"], "helm": ["version", "--short"], "terraform": ["version", "-json"]}
    code, out, _ = sh([tool] + flags.get(tool, ["--version"]), timeout=15)
    if code != 0:
        return None
    out = out.strip()
    if tool == "kubectl":
        try:
            return json.loads(out)["clientVersion"]["gitVersion"]
        except (ValueError, KeyError):
            return out[:40]
    if tool == "terraform":
        try:
            return json.loads(out)["terraform_version"]
        except (ValueError, KeyError):
            return out[:40]
    return out.splitlines()[0][:60]


def http(url: str, method: str = "GET", body: Optional[bytes] = None, headers: Optional[Dict[str, str]] = None, timeout: float = 3.0) -> Tuple[int, str, Dict[str, str]]:
    """(status, body, headers); status 0 on connection failure/timeout, with the error in body."""
    req = urllib.request.Request(url, data=body, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace"), {k.lower(): v for k, v in r.headers.items()}
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace"), {k.lower(): v for k, v in e.headers.items()}
    except Exception as e:  # noqa: BLE001
        return 0, repr(e), {}


def tcp_open(host: str, port: int, timeout: float = 2.0) -> Tuple[bool, str]:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True, f"connected to {host}:{port}"
    except OSError as e:
        return False, f"{host}:{port}: {e}"


def file_info(path: str) -> Optional[Dict[str, Any]]:
    try:
        st = os.stat(path)
    except OSError:
        return None
    import pwd  # noqa: PLC0415 - unix only, imported lazily
    import grp  # noqa: PLC0415
    try:
        owner = pwd.getpwuid(st.st_uid).pw_name
    except KeyError:
        owner = str(st.st_uid)
    try:
        group = grp.getgrgid(st.st_gid).gr_name
    except KeyError:
        group = str(st.st_gid)
    return {"mode": oct(stat.S_IMODE(st.st_mode)), "owner": owner, "group": group, "size": st.st_size}


def world_writable(path: str) -> bool:
    fi = file_info(path)
    return bool(fi) and int(fi["mode"], 8) & 0o002 != 0


def systemd_show(unit: str, props: Sequence[str]) -> Dict[str, str]:
    code, out, _ = sh(["systemctl", "show", unit] + [f"-p{p}" for p in props], timeout=15)
    res: Dict[str, str] = {}
    if code != 0:
        return res
    for line in out.splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            res[k] = v
    return res


def journal_tail(unit: str, lines: int = 20) -> str:
    code, out, err = sh(["journalctl", "-u", unit, "-n", str(lines), "--no-pager", "-o", "cat"], timeout=15)
    return out if code == 0 else err


def listening(port: int) -> List[Dict[str, str]]:
    """Listening sockets on a port from `ss -ltnp` (Linux)."""
    code, out, _ = sh(["ss", "-ltnpH"], timeout=10)
    res = []
    if code != 0:
        return res
    for line in out.splitlines():
        parts = line.split()
        if len(parts) < 4:
            continue
        local = parts[3]
        if local.rsplit(":", 1)[-1] == str(port):
            res.append({"local": local, "process": parts[-1] if parts[-1].startswith("users:") else ""})
    return res


def require_kube_context(context: str) -> Tuple[bool, str]:
    """Refuse to touch anything but the lab clusters. Returns (ok, why)."""
    if context not in KIND_CONTEXTS:
        return False, f"context {context} is not a lab cluster ({', '.join(KIND_CONTEXTS)})"
    code, out, err = sh(["kubectl", "--context", context, "config", "view", "--minify", "-o", "jsonpath={.clusters[0].cluster.server}"], timeout=15)
    if code != 0:
        return False, f"context {context} not found: {err.strip()}"
    host = out.replace("https://", "").split(":")[0].strip("[]")
    if host not in ("127.0.0.1", "localhost", "::1", "0.0.0.0"):
        return False, f"context {context} points at {out}, not a local API server; refusing"
    return True, out


def kubectl(context: str, args: Sequence[str], timeout: float = 60.0, ns: Optional[str] = NAMESPACE) -> Tuple[int, str, str]:
    ok, why = require_kube_context(context)
    if not ok:
        return 2, "", why
    cmd = ["kubectl", "--context", context]
    if ns:
        cmd += ["-n", ns]
    return sh(cmd + list(args), timeout=timeout)


def kget(context: str, args: Sequence[str], ns: Optional[str] = NAMESPACE) -> Optional[Any]:
    code, out, _ = kubectl(context, list(args) + ["-o", "json"], ns=ns)
    if code != 0:
        return None
    try:
        return json.loads(out)
    except ValueError:
        return None


def docker(args: Sequence[str], timeout: float = 60.0) -> Tuple[int, str, str]:
    return sh(["docker"] + list(args), timeout=timeout)


def docker_json(args: Sequence[str]) -> Optional[Any]:
    code, out, _ = docker(list(args) + ["--format", "{{json .}}"])
    if code != 0:
        return None
    items = []
    for line in out.splitlines():
        line = line.strip()
        if line:
            try:
                items.append(json.loads(line))
            except ValueError:
                pass
    return items


def compose(project: str, args: Sequence[str], cwd: Optional[str] = None, timeout: float = 120.0) -> Tuple[int, str, str]:
    if not project.startswith(COMPOSE_PREFIX):
        return 2, "", f"compose project {project} is not a lab project ({COMPOSE_PREFIX}*)"
    try:
        r = subprocess.run(["docker", "compose", "-p", project] + list(args), capture_output=True, text=True, timeout=timeout, cwd=cwd)
        return r.returncode, r.stdout, r.stderr
    except FileNotFoundError:
        return 127, "", "docker: not found"
    except subprocess.TimeoutExpired:
        return 124, "", "docker compose timed out"


def wait_until(pred: Callable[[], bool], timeout_s: float = 60.0, every_s: float = 2.0) -> bool:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            if pred():
                return True
        except Exception:  # noqa: BLE001
            pass
        time.sleep(every_s)
    return False


def read_text(path: str, limit: int = 20000) -> Optional[str]:
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            return fh.read(limit)
    except OSError:
        return None


def contains_secret(text: str) -> bool:
    import re  # noqa: PLC0415
    return bool(re.search(r"(AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer [A-Za-z0-9._-]{20,}|password=\S{6,})", text))
