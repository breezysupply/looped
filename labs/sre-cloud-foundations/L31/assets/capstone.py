#!/usr/bin/env python3
"""capstone.py — shared logic for the L31 rebuild (rebuild.sh) and its validator.

    python3 capstone.py env    [--release DIR]   validated KEY=VALUE lines for rebuild.sh
    python3 capstone.py check  [--release DIR]   the "fresh checkout" dry check: configuration,
                                                 pins and every prerequisite artifact; no cluster,
                                                 no Docker, no network. Exit 1 on any FAIL.
    python3 capstone.py verify [--release DIR] [--out FILE]
                                                 live checks against the rebuilt namespace

The release directory (default labs/sre-cloud-foundations/L31/release) is YOUR checked-in
bundle: rebuild.env, REBUILD.md, slo/ (rules and tests from L22) and dashboard.json (from L21).
Standard library only. Every cluster call names --context kind-<CLUSTER> and -n <NAMESPACE>.
"""
from __future__ import annotations

import argparse
import contextlib
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Dict, Iterator, List, Optional, Tuple

HERE = os.path.dirname(os.path.abspath(__file__))
L31 = os.path.dirname(HERE)
SRE = os.path.dirname(L31)
REPO = os.path.abspath(os.path.join(SRE, "..", ".."))
DEFAULT_RELEASE = os.path.join(L31, "release")
WORK = os.path.join(L31, "work")

KEYS = {
    "NAMESPACE": r"beacon-[a-z0-9-]{1,40}",
    "CLUSTER": r"looped-foundations|looped-policy",
    "ENVIRONMENT": r"dev|staging|prod",
    "RELEASE": r"[a-z][a-z0-9-]{0,30}",
    "IMAGE_REPO": r"[a-z0-9][a-z0-9._/-]*",
    "IMAGE_TAG": r"\d+\.\d+\.\d+",
    "IMAGE_SOURCE": r"build|preloaded",
    "DB_SECRET_SOURCE": r"generate|existing:[a-z0-9-]+",
    "SEED_RECORDS": r"[1-9]\d{1,4}",
    "CHART": r"labs/sre-cloud-foundations/[\w./-]+",
    "CHART_VERSION": r"\d+\.\d+\.\d+",
    "POSTGRES_IMAGE": r"[a-z0-9./-]+:[\w.-]+(@sha256:[0-9a-f]{64})?",
    "REDIS_IMAGE": r"[a-z0-9./-]+:[\w.-]+(@sha256:[0-9a-f]{64})?",
    "PROMTOOL_IMAGE": r"[a-z0-9./-]+:[\w.-]+(@sha256:[0-9a-f]{64})?",
    "SLO_DIR": r"labs/sre-cloud-foundations/[\w./-]+",
    "DASHBOARD": r"labs/sre-cloud-foundations/[\w./-]+",
}
ALLOWED_ENV = {"L31_RELEASE"}
# artifacts reused from earlier labs (by reference, never copied into the image or edited)
PREREQS = [
    ("L13/starter/Dockerfile", "L13 image recipe: pinned base digest, UID 10001, exec-form entry point"),
    ("L13/starter/requirements.lock", "L13 hash-pinned psycopg/redis wheels"),
    ("L13/starter/.dockerignore", "L13 build-context exclusions"),
    ("L13/starter/conf/beacon.yaml", "L13 baked-in configuration"),
    ("beacon/beacon/api.py", "the Beacon package the image is built from"),
    ("L19/chart/Chart.yaml", "L19 Helm chart (reused unchanged)"),
    ("L19/chart/values.schema.json", "L19 values schema"),
    ("L18/manifests/20-rbac.yaml", "L18 least-privilege Role/RoleBinding for beacon-deployer"),
    ("L18/manifests/30-netpol.yaml", "L18 default-deny, DNS and api->db NetworkPolicies"),
    ("L24/assets/verify_restore.py", "L24 restore verifier (counts, checksums, samples, sequences)"),
    ("L24/assets/pgmini.py", "L24 standard-library PostgreSQL client used by verify_restore.py"),
    ("profiles/kind-basic/kind-config.yaml", "kind-basic cluster definition (pinned node image)"),
    ("L31/assets/postrender.py", "post-renderer wiring the chart to PostgreSQL and Redis"),
    ("L31/assets/seed.sql", "deterministic seed data"),
]
SOURCE_ALLOW = re.compile(r"^labs/sre-cloud-foundations/")


class ConfigError(Exception):
    pass


def release_dir(arg: Optional[str]) -> str:
    return os.path.abspath(arg or os.environ.get("L31_RELEASE") or DEFAULT_RELEASE)


def unknown_env() -> List[str]:
    return sorted(k for k in os.environ if k.startswith("L31_") and k not in ALLOWED_ENV)


def load_env(rel: str) -> Dict[str, str]:
    path = os.path.join(rel, "rebuild.env")
    try:
        with open(path, encoding="utf-8") as fh:
            lines = fh.read().splitlines()
    except OSError as e:
        raise ConfigError(f"{path}: {e.strerror}") from e
    cfg: Dict[str, str] = {}
    for n, raw in enumerate(lines, 1):
        line = raw.split("#", 1)[0].strip() if not raw.strip().startswith("#") else ""
        if not line:
            continue
        m = re.fullmatch(r"([A-Z_]+)=(\S*)", line)
        if not m:
            raise ConfigError(f"rebuild.env:{n}: expected KEY=VALUE without spaces or quotes")
        k, v = m.groups()
        if k not in KEYS:
            raise ConfigError(f"rebuild.env:{n}: unknown key {k} (allowed: {', '.join(KEYS)})")
        if k in cfg:
            raise ConfigError(f"rebuild.env:{n}: duplicate key {k}")
        if not re.fullmatch(KEYS[k], v):
            raise ConfigError(f"rebuild.env:{n}: {k}={v!r} does not match {KEYS[k]}")
        cfg[k] = v
    missing = [k for k in KEYS if k not in cfg]
    if missing:
        raise ConfigError(f"rebuild.env: missing keys {missing}")
    return cfg


def fullname(release: str, chart: str = "beacon") -> str:
    return release if chart in release else f"{release}-{chart}"[:63].rstrip("-")


def chart_version(chart_dir: str) -> str:
    try:
        with open(os.path.join(chart_dir, "Chart.yaml"), encoding="utf-8") as fh:
            m = re.search(r"(?m)^version:\s*\"?([\w.+-]+)\"?", fh.read())
            return m.group(1) if m else ""
    except OSError:
        return ""


def git_ignored(path: str) -> Optional[bool]:
    """True/False inside a git work tree; None when git cannot answer (e.g. an exported copy)."""
    if not shutil.which("git"):
        return None
    r = subprocess.run(["git", "-C", REPO, "rev-parse", "--is-inside-work-tree"], capture_output=True, text=True)
    if r.returncode != 0:
        return None
    r = subprocess.run(["git", "-C", REPO, "check-ignore", "-q", os.path.relpath(path, REPO)], capture_output=True, text=True)
    return r.returncode == 0


def static_check(rel: str) -> List[Tuple[str, bool, str]]:
    """The fresh-checkout dry check. Returns (id, ok, observation) rows."""
    out: List[Tuple[str, bool, str]] = []
    bad_env = unknown_env()
    out.append(("environment", not bad_env, "no unknown L31_* variables" if not bad_env else f"unknown environment variables {bad_env}: refusing (only {sorted(ALLOWED_ENV)})"))
    try:
        cfg = load_env(rel)
        out.append(("config", True, f"rebuild.env: namespace {cfg['NAMESPACE']}, cluster {cfg['CLUSTER']}, environment {cfg['ENVIRONMENT']}"))
    except ConfigError as e:
        out.append(("config", False, str(e)))
        return out
    probs = []
    if cfg["NAMESPACE"] == "beacon":
        probs.append("NAMESPACE must be a new namespace, not the labs' shared 'beacon'")
    if cfg["IMAGE_SOURCE"] != "build":
        probs.append("IMAGE_SOURCE=preloaded relies on an image some earlier lab left in the nodes; a clean cluster has none")
    if cfg["DB_SECRET_SOURCE"] != "generate":
        probs.append(f"DB_SECRET_SOURCE={cfg['DB_SECRET_SOURCE']} relies on a Secret created outside this rebuild")
    out.append(("hidden-prerequisites", not probs, "image built from L13 sources; database secret generated by the rebuild" if not probs else "; ".join(probs)))
    pins = []
    chart_dir = os.path.join(REPO, cfg["CHART"])
    cv = chart_version(chart_dir)
    if cv != cfg["CHART_VERSION"]:
        pins.append(f"CHART_VERSION {cfg['CHART_VERSION']} but {cfg['CHART']}/Chart.yaml says {cv or 'nothing'}")
    for k in ("POSTGRES_IMAGE", "REDIS_IMAGE"):
        if "@sha256:" not in cfg[k]:
            pins.append(f"{k} must be pinned by digest")
    for k in ("POSTGRES_IMAGE", "REDIS_IMAGE", "PROMTOOL_IMAGE"):
        if re.search(r":(latest|stable|main)\b", cfg[k]):
            pins.append(f"{k} uses a moving tag")
    df = read(os.path.join(SRE, "L13", "starter", "Dockerfile"))
    if not re.search(r"(?m)^FROM\s+\S+@sha256:[0-9a-f]{64}", df):
        pins.append("L13 Dockerfile base is not pinned by digest")
    lock = read(os.path.join(SRE, "L13", "starter", "requirements.lock"))
    if "--hash=sha256:" not in lock:
        pins.append("L13 requirements.lock has no hashes")
    kc = read(os.path.join(SRE, "profiles", "kind-basic", "kind-config.yaml"))
    if not re.search(r"kindest/node:v[\d.]+@sha256:[0-9a-f]{64}", kc):
        pins.append("kind node image not pinned by digest")
    if cfg["ENVIRONMENT"] != "dev" and not os.path.isfile(os.path.join(chart_dir, f"values-{cfg['ENVIRONMENT']}.yaml")):
        pins.append(f"chart has no values-{cfg['ENVIRONMENT']}.yaml")
    out.append(("pins", not pins, "chart, base image, wheels, node image, PostgreSQL and Redis pinned" if not pins else "; ".join(pins)))
    missing, ignored = [], []
    paths = [(os.path.join(SRE, p), why) for p, why in PREREQS]
    slo = os.path.join(REPO, cfg["SLO_DIR"])
    paths += [(chart_dir, "CHART"), (os.path.join(slo, "rules", "beacon-slo.rules.yml"), "SLO rules (from your L22)"),
              (os.path.join(slo, "tests", "beacon-slo.test.yml"), "SLO rule tests (from your L22)"),
              (os.path.join(REPO, cfg["DASHBOARD"]), "dashboard (from your L21)"), (os.path.join(rel, "REBUILD.md"), "your runbook")]
    for p, why in paths:
        if not os.path.exists(p):
            missing.append(f"{os.path.relpath(p, REPO)} ({why})")
        elif git_ignored(p):
            ignored.append(f"{os.path.relpath(p, REPO)} ({why}) is git-ignored: a fresh clone will not have it")
    out.append(("artifacts", not missing and not ignored, f"{len(paths)} prerequisite artifacts present and checked in" if not (missing or ignored) else "; ".join((missing + ignored)[:5])))
    dash = read(os.path.join(REPO, cfg["DASHBOARD"]))
    try:
        json.loads(dash)
        names = sorted(set(re.findall(r"beacon_[a-z0-9_]+", dash)))
        okd = bool(names)
    except ValueError:
        names, okd = [], False
    out.append(("dashboard", okd, f"dashboard JSON queries {names[:4]}" if okd else "dashboard missing, not JSON, or queries no beacon_* metric"))
    fams = exported_families()
    used = referenced_families(read(os.path.join(slo, "rules", "beacon-slo.rules.yml")) + dash)
    unknown = [n for n in used if n not in fams]
    m = re.search(r"BUCKETS\s*=\s*\(([^)]*)\)", read(os.path.join(SRE, "beacon", "beacon", "telemetry.py")))
    buckets = {float(x) for x in re.findall(r"[\d.]+", m.group(1))} if m else set()
    les = sorted({x for x in re.findall(r'le\s*=\s*"([\d.]+)"', read(os.path.join(slo, "rules", "beacon-slo.rules.yml")) + dash)})
    unknown += [f'le="{x}" (not a bucket of the build; it has {sorted(buckets)})' for x in les if float(x) not in buckets]
    out.append(("telemetry-names", bool(used) and not unknown,
                f"SLO rules and dashboard use {used} — all exported by the Beacon build" if used and not unknown
                else f"SLO rules/dashboard use {unknown or 'no beacon_* metric'}, which the Beacon build you ship does not export (it exports {sorted(fams)})"))
    return out


def exported_families() -> Dict[str, str]:
    """Metric families the Beacon package registers (name -> inc|set|observe), read from its source."""
    fams: Dict[str, str] = {}
    pkg = os.path.join(SRE, "beacon", "beacon")
    for name in sorted(os.listdir(pkg)) if os.path.isdir(pkg) else []:
        if name.endswith(".py"):
            for kind, fam in re.findall(r"METRICS\.(inc|set|observe)\(\s*\"(beacon_[a-z0-9_]+)\"", read(os.path.join(pkg, name))):
                fams[fam] = kind
    return fams


def referenced_families(text: str) -> List[str]:
    names = set(re.findall(r"\bbeacon_[a-z0-9_]+", text))
    return sorted({re.sub(r"_(bucket|count|sum)$", "", n) for n in names})


def read(path: str) -> str:
    try:
        with open(path, encoding="utf-8") as fh:
            return fh.read()
    except OSError:
        return ""


# ── live checks ───────────────────────────────────────────────────────────

def sh(cmd: List[str], timeout: float = 60, input_text: Optional[str] = None) -> Tuple[int, str, str]:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, input=input_text)
        return r.returncode, r.stdout, r.stderr
    except FileNotFoundError:
        return 127, "", f"{cmd[0]}: not found"
    except subprocess.TimeoutExpired:
        return 124, "", "timed out"


class Cluster:
    def __init__(self, cfg: Dict[str, str]) -> None:
        self.cfg = cfg
        self.ctx = "kind-" + cfg["CLUSTER"]
        self.ns = cfg["NAMESPACE"]

    def reachable(self) -> Tuple[bool, str]:
        code, out, err = sh(["kubectl", "--context", self.ctx, "config", "view", "--minify", "-o", "jsonpath={.clusters[0].cluster.server}"], 15)
        if code != 0 or not out:
            return False, f"context {self.ctx} not found ({err.strip()[:80]})"
        host = out.split("://", 1)[-1].split(":")[0].strip("[]")
        if host not in ("127.0.0.1", "localhost", "::1", "0.0.0.0"):
            return False, f"context {self.ctx} points at {out}; refusing"
        code, out, err = sh(["kubectl", "--context", self.ctx, "get", "nodes", "-o", "jsonpath={.items[*].metadata.name}", "--request-timeout=15s"], 30)
        if code != 0:
            return False, f"cannot list nodes through {self.ctx}: {err.strip()[:80]}"
        names = out.split()
        if not names or any(not n.startswith(self.cfg["CLUSTER"] + "-") for n in names):
            return False, f"nodes {names} are not {self.cfg['CLUSTER']}-*; refusing"
        return True, f"{self.ctx}: nodes {names}"

    def k(self, args: List[str], ns: bool = True, timeout: float = 60, input_text: Optional[str] = None) -> Tuple[int, str, str]:
        return sh(["kubectl", "--context", self.ctx] + (["-n", self.ns] if ns else []) + args, timeout, input_text)

    def kjson(self, args: List[str], ns: bool = True) -> Optional[Any]:
        code, out, _ = self.k(args + ["-o", "json"], ns)
        try:
            return json.loads(out) if code == 0 else None
        except ValueError:
            return None

    def can_i(self, verb: str, resource: str, ns: Optional[str] = None) -> bool:
        code, out, _ = sh(["kubectl", "--context", self.ctx, "auth", "can-i", verb, resource, "-n", ns or self.ns,
                           "--as", f"system:serviceaccount:{self.ns}:beacon-deployer"], 20)
        return out.strip() == "yes"

    def psql(self, sql: str) -> Tuple[int, str]:
        code, out, err = self.k(["exec", "-i", "beacon-db-0", "--", "psql", "-U", "beacon", "-d", "beacon", "-At", "-v", "ON_ERROR_STOP=1", "-f", "-"], input_text=sql)
        return code, (out if code == 0 else err).strip()

    @contextlib.contextmanager
    def port_forward(self, target: str, remote: int) -> Iterator[int]:
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
        p = subprocess.Popen(["kubectl", "--context", self.ctx, "-n", self.ns, "port-forward", "--address", "127.0.0.1", target, f"{port}:{remote}"],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            for _ in range(40):
                with contextlib.suppress(OSError):
                    socket.create_connection(("127.0.0.1", port), 0.3).close()
                    break
                time.sleep(0.25)
            yield port
        finally:
            p.terminate()
            with contextlib.suppress(Exception):
                p.wait(5)


OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def http(url: str, method: str = "GET", body: Optional[dict] = None, headers: Optional[dict] = None) -> Tuple[int, str]:
    req = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(), method=method,
                                 headers=dict({"Content-Type": "application/json"}, **(headers or {})))
    try:
        with OPENER.open(req, timeout=5) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        return 0, repr(e)


SEED_FINGERPRINT_SQL = "SELECT count(*) || ' ' || coalesce(md5(string_agg(id || ':' || status, ',' ORDER BY id)), '-') FROM records WHERE id LIKE 'seed-%';"


def expected_fingerprint(n: int) -> str:
    """Recompute what seed.sql inserts, without a database."""
    import hashlib  # noqa: PLC0415
    rows = []
    for i in range(1, n + 1):
        st = "fault" if i % 17 == 0 else ("degraded" if i % 5 == 0 else "ok")
        rows.append((f"seed-{i:05d}", st))
    rows.sort()
    return f"{n} " + hashlib.md5(",".join(f"{a}:{b}" for a, b in rows).encode()).hexdigest()


def exported_in(metrics_text: str) -> set:
    return {re.sub(r"_(bucket|count|sum)$", "", m) for m in re.findall(r"(?m)^(beacon_[a-z0-9_]+)(?:\{| )", metrics_text)}


def live_checks(cfg: Dict[str, str], rel: str) -> List[Tuple[str, bool, str]]:
    c = Cluster(cfg)
    out: List[Tuple[str, bool, str]] = []
    ok, why = c.reachable()
    out.append(("cluster", ok, why))
    if not ok:
        return out
    ns = c.kjson(["get", "namespace", c.ns], ns=False)
    owned = bool(ns) and (ns.get("metadata", {}).get("labels", {}) or {}).get("looped.lab/id") == "L31"
    out.append(("namespace", owned, f"namespace {c.ns} exists and is labelled looped.lab/id=L31" if owned else f"namespace {c.ns} missing or not created by this rebuild"))
    if not owned:
        return out
    # health: every workload available, API ready and serving the release tag
    fn = fullname(cfg["RELEASE"])
    notready = []
    for kind, name in (("deployment", fn), ("deployment", "beacon-worker"), ("deployment", "beacon-queue"), ("statefulset", "beacon-db")):
        o = c.kjson(["get", kind, name]) or {}
        want, have = (o.get("spec") or {}).get("replicas", 1), (o.get("status") or {}).get("readyReplicas", 0) or 0
        if not o or have < want:
            notready.append(f"{kind}/{name} {have}/{want}")
    version = metrics = ""
    rec_ok = False
    with c.port_forward(f"svc/{fn}", 8080) as port:
        base = f"http://127.0.0.1:{port}"
        rs, _ = http(base + "/ready")
        vs, version = http(base + "/version")
        key = f"l31-verify-{int(time.time())}"
        ps, pb = http(base + "/status", "POST", {"sensor_id": "cap-verify", "status": "ok"}, {"Idempotency-Key": key})
        gs, gb = http(base + "/status/cap-verify")
        rec_ok = ps in (200, 201) and gs == 200 and "cap-verify" in gb
        ms, metrics = http(base + "/metrics")
    tag_ok = cfg["IMAGE_TAG"] in version
    out.append(("health", not notready and rs == 200 and tag_ok and rec_ok,
                f"workloads ready{'' if not notready else ' except ' + ', '.join(notready)}; /ready {rs}; /version reports {cfg['IMAGE_TAG'] if tag_ok else version[:60]}; write+read through the API {'ok' if rec_ok else 'failed'}"))
    # image identity: the nodes hold exactly the image ID rebuild.sh recorded
    rel_json = json.loads(read(os.path.join(WORK, "release.json")) or "{}")
    want_id = rel_json.get("image_id", "")
    ref = f"{cfg['IMAGE_REPO']}:{cfg['IMAGE_TAG']}"
    seen = []
    code, nodes, _ = sh(["kind", "get", "nodes", "--name", cfg["CLUSTER"]], 30)
    for node in nodes.split():
        code, out_i, _ = sh(["docker", "exec", node, "crictl", "images", "-o", "json"], 30)
        try:
            imgs = json.loads(out_i).get("images", []) if code == 0 else []
        except ValueError:
            imgs = []
        ids = [i.get("id") for i in imgs if any(t.endswith("/" + ref) or t == ref for t in i.get("repoTags", []))]
        seen.append(f"{node}:{(ids or ['none'])[0][:19]}")
    match = bool(want_id) and all(want_id[:19] in s for s in seen if not s.endswith(":none")) and any(not s.endswith(":none") for s in seen)
    out.append(("image-identity", match, f"recorded {want_id[:19] or 'nothing (run rebuild.sh image)'}; nodes {seen}"))
    # least privilege for the deploy bot, and no token on workloads
    must = [("patch", "deployments.apps"), ("get", "pods/log"), ("list", "pods")]
    never = [("delete", "deployments.apps"), ("get", "secrets"), ("create", "pods/exec"), ("create", "rolebindings.rbac.authorization.k8s.io"), ("delete", "namespaces")]
    granted = [f"{v} {r}" for v, r in must if c.can_i(v, r)]
    leaks = [f"{v} {r}" for v, r in never if c.can_i(v, r)] + [f"{v} {r} in beacon" for v, r in must[:1] if c.can_i(v, r, ns="beacon")]
    pods = (c.kjson(["get", "pods"]) or {}).get("items", [])
    tokened = [p["metadata"]["name"] for p in pods if (p.get("spec") or {}).get("automountServiceAccountToken") is not False]
    crb = c.kjson(["get", "clusterrolebindings", "-l", "looped.lab/id=L31"], ns=False) or {}
    out.append(("least-privilege", len(granted) == len(must) and not leaks and not tokened and not crb.get("items"),
                f"deployer may {granted}; must not, but may: {leaks or 'none'}; pods with an API token: {tokened or 'none'}; cluster-wide bindings: {len(crb.get('items', []))}"))
    pol = [p["metadata"]["name"] for p in (c.kjson(["get", "networkpolicies"]) or {}).get("items", [])]
    need = {"default-deny", "allow-dns-egress", "api-egress-to-db", "db-ingress-from-api", "api-egress-to-queue", "worker-egress-to-queue", "queue-ingress"}
    out.append(("network-policies", need <= set(pol), f"{len(pol)} policies present{'' if need <= set(pol) else ', missing ' + str(sorted(need - set(pol)))}"
                + ("; enforced (Calico)" if cfg["CLUSTER"] == "looped-policy" else "; NOT enforced on kind-basic (kindnet): presence only")))
    code, fp = c.psql(SEED_FINGERPRINT_SQL)
    want = expected_fingerprint(int(cfg["SEED_RECORDS"]))
    out.append(("seeded-data", code == 0 and fp == want, f"seed rows/fingerprint {fp[:50]} (expected {want[:50]})"))
    rules = read(os.path.join(REPO, cfg["SLO_DIR"], "rules", "beacon-slo.rules.yml")) + read(os.path.join(REPO, cfg["DASHBOARD"]))
    used = referenced_families(rules)
    exported = exported_in(metrics)
    absent = [m for m in used if m not in exported]
    out.append(("metrics", bool(exported) and not absent, f"/metrics exports {len(exported)} beacon_* families; SLO rules and dashboard use {used[:4]}{'; absent: ' + str(absent) if absent else ''}"))
    hist = json.loads(sh(["helm", "--kube-context", c.ctx, "-n", c.ns, "history", cfg["RELEASE"], "-o", "json"], 30)[1] or "[]")
    rolled = [h for h in hist if "rollback" in (h.get("description") or "").lower()]
    out.append(("rollback", bool(rolled) and hist[-1].get("status") == "deployed", f"{len(hist)} revisions; rollbacks: {[h.get('revision') for h in rolled]}; current {hist[-1].get('revision') if hist else '-'} {hist[-1].get('status') if hist else ''}"))
    return out


def proof_checks() -> List[Tuple[str, bool, str]]:
    out = []
    rep = json.loads(read(os.path.join(WORK, "proof", "restore.json")) or "{}")
    tables = [f"{t.get('table')}:{t.get('status')}" for t in rep.get("tables", []) if isinstance(t, dict)]
    ok = rep.get("ok") is True and bool(tables)
    out.append(("restore-proof", ok, f"verify_restore.py report: ok={rep.get('ok')} tables {tables[:3]} differences {len(rep.get('differences', []))}" if rep else "no work/proof/restore.json (run rebuild.sh restore-drill)"))
    runs = []
    for line in read(os.path.join(WORK, "proof", "runs.jsonl")).splitlines():
        with contextlib.suppress(ValueError):
            runs.append(json.loads(line))
    seq = [(r.get("action"), bool(r.get("ok"))) for r in runs]
    want, i = [("all", True), ("down", True), ("all", True)], 0
    for step in seq:
        if i < len(want) and step == want[i]:
            i += 1
    out.append(("rebuild-proof", i == len(want), f"runs recorded (latest 6): {seq[-6:]}; need a successful all, then down, then all"))
    return out


def main(argv: List[str]) -> int:
    p = argparse.ArgumentParser(prog="capstone.py")
    p.add_argument("cmd", choices=["env", "check", "verify"])
    p.add_argument("--release")
    p.add_argument("--out")
    a = p.parse_args(argv)
    rel = release_dir(a.release)
    if a.cmd == "env":
        bad = unknown_env()
        if bad:
            sys.stderr.write(f"ERROR: unknown environment variables {bad}; refusing\n")
            return 2
        try:
            cfg = load_env(rel)
        except ConfigError as e:
            sys.stderr.write(f"ERROR: {e}\n")
            return 2
        for k, v in cfg.items():
            print(f"{k}={v}")
        return 0
    rows = static_check(rel) if a.cmd == "check" else live_checks(load_env(rel), rel)
    for cid, ok, obs in rows:
        print(f"{'PASS' if ok else 'FAIL'} {cid}: {obs}")
    if a.out:
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        with open(a.out, "w", encoding="utf-8") as fh:
            json.dump([{"id": i, "passed": o, "observed": s} for i, o, s in rows], fh, indent=2)
    return 0 if rows and all(ok for _, ok, _ in rows) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
