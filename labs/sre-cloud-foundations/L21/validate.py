#!/usr/bin/env python3
"""L21 validator: drives a few real requests through the lab's Beacon and reads
the result back from every signal — the API's /metrics, Prometheus (targets,
queries, exemplars), Jaeger (traces by id), and the containers' JSON logs —
then evaluates your dashboard's queries with promtool against supplied data.
Touches only looped-l21-* containers; sends bounded traffic to 127.0.0.1:18521.

Checks (critical unless noted):
  profile-up          Prometheus ready and Jaeger's query API reachable (observability profile)
  targets-up          Prometheus scrapes beacon-l21-api, -worker and -registry
  bounded-labels      after 60 requests from 60 different users, beacon_l21_requests_total has <= 30 series
                      and only the labels route, method, status_class
  labels-useful       those three labels are present; status_class is Nxx; route values are templates
  log-correlation     the API's JSON log line for a traced POST /jobs carries its trace id
  trace-propagation   the worker's "job processed" log line carries the SAME trace id
  trace-stored        Jaeger holds that trace with spans from beacon-l21-api and beacon-l21-worker,
                      the worker span a child of an API span
  metric-exemplar     Prometheus stored an exemplar with that trace id on the request-latency histogram
  dashboard-expected  each required panel's query gives the expected value on the supplied fixture (promtool)
  dashboard-live      each required panel's query returns data from the live Prometheus
  latency-diagnosis   work/diagnosis.json names the right source and a real slow trace that shows it
  latency-fixed       p95 of 30 sensor requests < 300 ms, by the change that fits the cause
  notes               evidence/L21-notes.md sections have substance (advisory)
Exit 1 if any critical check fails. Writes the evidence JSON.
"""
import json
import os
import re
import secrets
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import labcheck as L  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, "work")
EV = os.path.join(HERE, "evidence")
API, PROM, JAEGER = "http://127.0.0.1:18521", "http://127.0.0.1:19090", "http://127.0.0.1:16686"
IMAGE = os.environ.get("LOOPED_PROM_IMAGE", "prom/prometheus:v3.5.0")
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # local endpoints: never via a proxy
ROUTES = {"/healthz", "/metrics", "/jobs", "/sensors/{id}", "/other"}
PANELS = ["Request rate", "Error ratio", "p95 latency /sensors", "Dependency p95", "API CPU"]


def http(url, method="GET", body=None, headers=None, timeout=10):
    req = urllib.request.Request(url, data=body, headers=headers or {}, method=method)
    try:
        with OPENER.open(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace"), {k.lower(): v for k, v in r.headers.items()}
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace"), {}
    except Exception as e:  # noqa: BLE001
        return 0, repr(e), {}


def prom(path, **params):
    code, body, _ = http(PROM + path + ("?" + urllib.parse.urlencode(params) if params else ""))
    try:
        return json.loads(body) if code == 200 else None
    except ValueError:
        return None


def jaeger_trace(tid):
    code, body, _ = http(f"{JAEGER}/api/traces/{tid}")
    if code != 200:
        return None
    try:
        data = json.loads(body).get("data") or []
    except ValueError:
        return None
    if not data:
        return None
    t = data[0]
    procs = {k: v.get("serviceName") for k, v in (t.get("processes") or {}).items()}
    spans = []
    for s in t.get("spans", []):
        parent = next((r.get("spanID") for r in s.get("references", []) if r.get("refType") == "CHILD_OF"), None)
        spans.append({"id": s.get("spanID"), "name": s.get("operationName"), "service": procs.get(s.get("processID")),
                      "parent": parent, "duration_s": s.get("duration", 0) / 1e6})
    return spans


def docker_logs(name, since="15m"):
    code, out, err = L.docker(["logs", "--since", since, name], timeout=30)
    lines = []
    for line in (out + "\n" + err).splitlines():
        try:
            lines.append(json.loads(line))
        except ValueError:
            continue
    return lines


def parse_metrics(text, name):
    series = []
    for line in text.splitlines():
        if line.startswith(name + "{") or line.startswith(name + " "):
            m = re.match(r"^[^{]+\{(.*)\}\s", line)
            labels = dict(re.findall(r'(\w+)="((?:[^"\\]|\\.)*)"', m.group(1))) if m else {}
            series.append(labels)
    return series


def load_json(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def dashboard_exprs(dash):
    out = {}
    for p in (dash or {}).get("panels", []) or []:
        title = (p.get("title") or "").strip()
        for want in PANELS:
            if title.lower().startswith(want.lower()) and want not in out:
                exprs = [t.get("expr") for t in p.get("targets", []) if t.get("expr")]
                if exprs:
                    out[want] = exprs[0]
    return out


def promtool_dashboard(exprs):
    fx = load_json(os.path.join(HERE, "assets", "expected", "dashboard-fixture.json"))
    base = os.path.join(WORK, ".check")
    if os.path.isdir(base):
        shutil.rmtree(base)
    os.makedirs(base)
    lines = ["rule_files: [check.rules.yml]", "evaluation_interval: 1m", "tests:", "  - interval: %s" % fx["interval"], "    input_series:"]
    for s in fx["input_series"]:
        lines += ["      - series: %s" % json.dumps(s["series"]), "        values: %s" % json.dumps(s["values"])]
    lines.append("    promql_expr_test:")
    for p in fx["panels"]:
        e = exprs.get(p["title"], "vector(-1)")
        lines += ["      - expr: %s" % json.dumps("round(sum(%s) * 1000)" % e), "        eval_time: %s" % fx["eval_time"],
                  "        exp_samples:", "          - value: %s" % p["expect"]]
    with open(os.path.join(base, "dashboard.test.yml"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    with open(os.path.join(base, "check.rules.yml"), "w", encoding="utf-8") as fh:
        fh.write("groups:\n  - name: looped-dashboard-check\n    rules:\n      - record: looped:dashboard_check\n        expr: vector(1)\n")
    os.chmod(base, 0o755)
    for f in os.listdir(base):
        os.chmod(os.path.join(base, f), 0o644)
    return L.sh(["docker", "run", "--rm", "--network", "none", "--name", "looped-l21-promtool-%d" % os.getpid(),
                 "-v", base + ":/w:ro", "--entrypoint", "promtool", IMAGE, "test", "rules", "/w/dashboard.test.yml"], timeout=180)


def p95(samples):
    s = sorted(samples)
    return s[min(len(s) - 1, int(0.95 * len(s)))] if s else None


def main():
    args = L.standard_args("L21", "Validate L21 (metrics, logs, traces, dashboard) against the running lab and profile")
    r = L.Report("L21", "observability")
    L.apply_args(r, args)
    inj = load_json(os.path.join(WORK, ".l21-inject.json")) or {}
    variant = inj.get("variant") or (L.read_text(os.path.join(WORK, ".variant")) or "variant-a").strip()
    if not args.variant:
        r.seed = variant
    notes = L.read_text(os.path.join(EV, "L21-notes.md")) or ""

    code, body, _ = http(PROM + "/-/ready")
    jcode, jbody, _ = http(JAEGER + "/api/services")
    r.check("profile-up", code == 200 and jcode == 200, f"Prometheus {code}, Jaeger {jcode}" + ("" if code == 200 and jcode == 200 else " — start profiles/observability/setup.sh"))
    if code != 200 or jcode != 200:
        return r.finish(args.out, args.explanation or notes[:4000], {"variant_file": variant})

    t = prom("/api/v1/targets", state="active") or {}
    jobs = {x["labels"].get("job"): x["health"] for x in (t.get("data") or {}).get("activeTargets", [])}
    need = ["beacon-l21-api", "beacon-l21-worker", "beacon-l21-registry"]
    r.check("targets-up", all(jobs.get(j) == "up" for j in need), ", ".join(f"{j}={jobs.get(j, 'absent')}" for j in need))

    # ── cardinality ─────────────────────────────────────────────────
    tag = secrets.token_hex(3)
    for i in range(60):
        http(API + "/healthz", headers={"X-User-Id": f"u-check-{tag}-{i:03d}"}, timeout=5)
    code, text, _ = http(API + "/metrics")
    series = parse_metrics(text, "beacon_l21_requests_total") if code == 200 else []
    names = set().union(*[set(s) for s in series]) if series else set()
    extra = sorted(names - {"route", "method", "status_class"})
    r.check("bounded-labels", code == 200 and 0 < len(series) <= 30 and not extra,
            f"{len(series)} series of beacon_l21_requests_total after 60 users; labels {sorted(names)}" + (f"; unbounded/extra: {extra}" if extra else ""))
    sc = {s.get("status_class") for s in series}
    routes = {s.get("route") for s in series}
    useful = {"route", "method", "status_class"} <= names and all(re.fullmatch(r"[1-5]xx", x or "") for x in sc) and routes <= ROUTES
    r.check("labels-useful", useful, f"status_class {sorted(x for x in sc if x)}; routes {sorted(x for x in routes if x)}")
    n_prom, deadline = None, time.time() + 15  # wait for a scrape: series that left the target are marked stale then
    while time.time() < deadline:
        pc = prom("/api/v1/query", query="count(beacon_l21_requests_total)")
        n_prom = int(float(pc["data"]["result"][0]["value"][1])) if pc and pc["data"]["result"] else None
        if n_prom is not None and n_prom <= 30:
            break
        time.sleep(3)
    r.check("prometheus-series", n_prom is not None and n_prom <= 30, f"Prometheus currently holds {n_prom} live series of beacon_l21_requests_total (stale series drop out after the next scrape)", critical=False)

    # ── one request across the signals ──────────────────────────────
    tid, parent = secrets.token_hex(16), secrets.token_hex(8)
    t0 = time.time()
    code, body, hdrs = http(API + "/jobs", "POST", json.dumps({"sensor_id": "s-0042"}).encode(),
                            {"Content-Type": "application/json", "traceparent": f"00-{tid}-{parent}-01", "X-User-Id": "u-check-trace"})
    api_line, worker_line, spans = None, None, None
    deadline = time.time() + 25
    while time.time() < deadline and not (api_line and worker_line and spans and len({s["service"] for s in spans}) >= 2):
        time.sleep(2)
        api_line = api_line or next((x for x in docker_logs("looped-l21-api", "3m") if x.get("trace_id") == tid and x.get("msg") == "request"), None)
        worker_line = worker_line or next((x for x in docker_logs("looped-l21-worker", "3m") if x.get("trace_id") == tid and x.get("msg") == "job processed"), None)
        spans = jaeger_trace(tid)
    r.check("log-correlation", code == 202 and bool(api_line), f"POST /jobs {code}; API log line: route={api_line.get('route')} status={api_line.get('status')} trace_id={tid[:12]}…" if api_line else f"POST /jobs {code}; no API log line with trace_id {tid}")
    r.check("trace-propagation", bool(worker_line), f"worker logged job {worker_line.get('job_id')} with trace_id {tid[:12]}…" if worker_line else f"no worker 'job processed' line with trace_id {tid[:12]}… (the worker starts its own trace)")
    services = sorted({s["service"] for s in spans or [] if s["service"]})
    api_ids = {s["id"] for s in spans or [] if s["service"] == "beacon-l21-api"}
    wk = [s for s in spans or [] if s["service"] == "beacon-l21-worker"]
    linked = any(s["parent"] in api_ids for s in wk)
    r.check("trace-stored", bool(spans) and "beacon-l21-api" in services and bool(wk) and linked,
            f"trace {tid[:12]}… in Jaeger: {len(spans or [])} spans from {services}; worker span child of an API span: {linked}" if spans else f"trace {tid[:12]}… not found in Jaeger")
    found_ex = False
    deadline = time.time() + 20
    while time.time() < deadline and not found_ex:
        ex = prom("/api/v1/query_exemplars", query="beacon_l21_request_duration_seconds_bucket", start=str(t0 - 60), end=str(time.time() + 5)) or {}
        found_ex = any(e.get("labels", {}).get("trace_id") == tid for s in ex.get("data") or [] for e in s.get("exemplars", []))
        if not found_ex:
            time.sleep(2)
    r.check("metric-exemplar", found_ex, f"exemplar trace_id={tid[:12]}… stored on beacon_l21_request_duration_seconds_bucket" if found_ex else "no exemplar with this trace id on the request-latency histogram")

    # ── dashboard ───────────────────────────────────────────────────
    dash = load_json(os.path.join(WORK, "dashboard.json"))
    exprs = dashboard_exprs(dash)
    missing = [p for p in PANELS if p not in exprs]
    code, out, err = promtool_dashboard(exprs)
    fails = re.findall(r'expr: "round\(sum\((.*?)\) \* 1000\)"', out + err)
    bad_titles = [p for p in PANELS if p in missing or any(exprs.get(p) and exprs[p] in f.replace('\\"', '"') for f in fails)]
    r.check("dashboard-expected", code == 0 and not missing, "all five panels give the expected values on the supplied fixture" if code == 0 and not missing else f"missing panels: {missing}; wrong on the fixture: {bad_titles}")
    live = {}
    for p, e in exprs.items():
        res = prom("/api/v1/query", query=e)
        live[p] = len(res["data"]["result"]) if res and res.get("status") == "success" else -1
    r.check("dashboard-live", not missing and all(v > 0 for v in live.values()), "; ".join(f"{k}: {v} series" for k, v in live.items()) or "no panels")
    pushed = L.sh([sys.executable, os.path.join(HERE, "assets", "grafana_push.py"), os.path.join(WORK, "dashboard.json")], timeout=30)
    r.check("dashboard-loads", pushed[0] == 0, (pushed[1] or pushed[2]).strip()[:200], critical=False)

    # ── latency: diagnosis and fix ──────────────────────────────────
    diag = load_json(os.path.join(WORK, "diagnosis.json")) or {}
    want = "dependency" if variant == "variant-a" else "local-cpu"
    claimed = str(diag.get("latency_source", "")).strip().lower()
    dtid = str(diag.get("trace_id", "")).strip().lower()
    dspans = jaeger_trace(dtid) if re.fullmatch(r"[0-9a-f]{32}", dtid) else None
    slow = [s for s in dspans or [] if (s["name"].startswith("registry") if claimed == "dependency" else s["name"] == "checksum") and s["duration_s"] >= 0.2]
    r.check("latency-diagnosis", claimed == want and bool(slow),
            f"claimed {claimed if claimed in ('dependency', 'local-cpu') else 'nothing yet'}; trace {dtid[:12] if re.fullmatch(r'[0-9a-f]{32}', dtid) else '-'}: " + (f"slow span {slow[0]['name']} {slow[0]['duration_s'] * 1000:.0f} ms" if slow else ("not in Jaeger" if not dspans else "no span ≥200 ms of the claimed kind")) + ("" if claimed == want else "; the evidence points elsewhere"))
    lat = []
    for i in range(30):
        s0 = time.monotonic()
        http(f"{API}/sensors/s-{(i * 37) % 400:04d}", headers={"X-User-Id": "u-check-latency"}, timeout=10)
        lat.append(time.monotonic() - s0)
    q95 = p95(lat)
    cfg = load_json(os.path.join(WORK, "config", "config.json")) or {}
    reg = load_json(os.path.join(WORK, "fixture", "registry.json")) or {}
    if variant == "variant-a":
        fits = int(cfg.get("registry_timeout_ms", 99999)) <= 250 and reg.get("delay_ms") == inj.get("registry_delay_ms")
        how = f"registry_timeout_ms={cfg.get('registry_timeout_ms')}, registry fixture delay {reg.get('delay_ms')} ms (as injected: {reg.get('delay_ms') == inj.get('registry_delay_ms')})"
    else:
        fits = int(cfg.get("checksum_rounds", 10 ** 9)) <= 5000
        how = f"checksum_rounds={cfg.get('checksum_rounds')}"
    r.check("latency-fixed", q95 is not None and q95 < 0.3 and fits, f"p95 of 30 GET /sensors/{{id}} = {q95 * 1000:.0f} ms; {how}")

    template = set(x.strip() for x in (L.read_text(os.path.join(HERE, "assets", "notes-template.md")) or "").splitlines())
    nbody = "\n".join(x for x in notes.splitlines() if x.strip() not in template and not x.startswith(("#", ">")))
    secs = [s for s in ("Signals", "Latency source", "Cardinality", "Correlation", "Dashboard") if re.search(r"^## " + s, notes, re.M)]
    r.check("notes", len(secs) == 5 and len(nbody.strip()) >= 800, f"{len(secs)}/5 sections, {len(nbody.strip())} chars", critical=False)

    extra_env = {"variant_file": variant, "p95_ms": round((q95 or 0) * 1000, 1), "requests_series": len(series)}
    return r.finish(args.out, args.explanation or notes[:4000], extra_env)


if __name__ == "__main__":
    sys.exit(main())
