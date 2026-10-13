#!/usr/bin/env python3
"""L08 validator: runs YOUR unit tests (on your client, on a reference client and on
deliberately broken clients), then runs YOUR CLI against the local inventory
fixture and judges it by what the fixture saw on the wire.

Checks (critical unless noted):
  unit-tests-pass      your suite passes on your invclient.py (at least 8 tests)
  tests-are-fair       your suite passes on the reference client (it tests the contract)
  tests-catch-bugs     your suite fails on every broken client in broken/mutants.json
  integration-list     faults mode: `list` exits 0 and returns every item exactly once
  retry-after          every 429 was followed by a wait of at least Retry-After before the retry
  bounded-time         the stalled page was abandoned and retried well before the stall ended; request count bounded
  pagination-loop      loop mode: `list` stops with exit 3 within a bounded number of requests
  post-policy          refresh without a key is not retried (exit 3, one side effect); with a key it is retried with the same key (exit 0, one side effect)
  no-secret-leak       the token appears in no output, log, result file or workspace file
  notes                evidence/L08-notes.md explains the policy (advisory)
Exit 1 if any check fails.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
import labcheck as L  # noqa: E402

REF = os.path.join(HERE, "solution", "invclient.py")
EV = os.path.join(HERE, "evidence")
BASE = "http://127.0.0.1:8098"
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def fixture(path, body=None):
    req = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(), method="GET" if body is None else "POST")
    with OPENER.open(req, timeout=5) as r:
        return json.loads(r.read())


def run_tests(work, impl_src, tmp_root):
    d = tempfile.mkdtemp(dir=tmp_root)
    for name in os.listdir(work):
        if name in (".run", ".secrets", "out", "__pycache__", ".variant"):
            continue
        p = os.path.join(work, name)
        (shutil.copytree if os.path.isdir(p) else shutil.copy2)(p, os.path.join(d, name))
    with open(os.path.join(d, "invclient.py"), "w", encoding="utf-8") as fh:
        fh.write(impl_src)
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    env.pop("LOOPED_L08_TOKEN", None)
    try:
        r = subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", ".", "-p", "test*.py"], cwd=d, capture_output=True, text=True, timeout=120, env=env)
        out, rc = r.stdout + r.stderr, r.returncode
    except subprocess.TimeoutExpired:
        out, rc = "timed out after 120 s (a test waited for real or looped)", 124
    m = re.search(r"Ran (\d+) tests?", out)
    return rc, int(m.group(1)) if m else 0, (out.strip().splitlines() or [""])[-1]


def cli(work, token_file, args, limit=60):
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    env.pop("LOOPED_L08_TOKEN", None)
    t0 = time.monotonic()
    try:
        r = subprocess.run([sys.executable, os.path.join(work, "invclient.py"), "--base-url", BASE, "--token-file", token_file] + args,
                           cwd=work, capture_output=True, text=True, timeout=limit, env=env)
        return r.returncode, r.stdout, r.stderr, time.monotonic() - t0
    except subprocess.TimeoutExpired as e:
        return 124, (e.stdout or b"").decode() if isinstance(e.stdout, bytes) else (e.stdout or ""), "killed after %ds" % limit, time.monotonic() - t0


def main() -> int:
    args = L.standard_args("L08")
    work = os.path.abspath(os.environ.get("L08_WORK") or os.path.join(HERE, "work"))
    r = L.Report("L08", "linux-arm64")
    L.apply_args(r, args)
    variant = (L.read_text(os.path.join(work, ".variant")) or "").strip() or "variant-a"
    if not args.variant:
        r.seed = variant
    mine = os.path.join(work, "invclient.py")
    token_file = os.path.join(work, ".secrets", "l08-token")
    token = (L.read_text(token_file) or "").strip()
    if not os.path.exists(mine) or not token:
        r.check("unit-tests-pass", False, f"{mine} or the lab token missing; run setup.sh")
        return r.finish(args.out, args.explanation)
    ref_src = open(REF, encoding="utf-8").read()
    tmp = tempfile.mkdtemp(prefix="looped-l08-")
    captured = []
    try:
        rc, ran, tail = run_tests(work, open(mine, encoding="utf-8").read(), tmp)
        r.check("unit-tests-pass", rc == 0 and ran >= 8, f"your suite on your client: ran {ran}, {tail}" + ("" if ran >= 8 else " (write at least 8 tests)"))
        rc, ran_ref, tail = run_tests(work, ref_src, tmp)
        r.check("tests-are-fair", rc == 0 and ran_ref > 0, f"your suite on the reference client: ran {ran_ref}, {tail}")
        spec = json.load(open(os.path.join(HERE, "broken", "mutants.json"), encoding="utf-8"))
        survived = []
        for m in spec["mutants"]:
            if ref_src.count(m["find"]) != 1:
                survived.append(m["id"] + "(patch did not apply)")
                continue
            if run_tests(work, ref_src.replace(m["find"], m["replace"]), tmp)[0] == 0:
                survived.append(m["id"])
        n = len(spec["mutants"])
        r.check("tests-catch-bugs", not survived and ran_ref > 0, f"broken clients caught by your tests: {n - len(survived)}/{n}" + (f"; not caught: {', '.join(survived)}" if survived else ""))

        try:
            fixture("/_fixture/scenario", {"mode": "faults"})
        except OSError as e:
            r.check("integration-list", False, f"fixture not reachable at {BASE} ({e}); run reset.sh")
            return r.finish(args.out, args.explanation)

        # 1. faults mode, list
        out_file = os.path.join(tmp, "inventory.json")
        code, so, se, took = cli(work, token_file, ["list", "--out", out_file])
        captured += [so, se, L.read_text(out_file, limit=2_000_000) or ""]
        st = fixture("/_fixture/stats")
        total = st["total_items"]
        try:
            ids = [i["id"] for i in json.loads(L.read_text(out_file, limit=2_000_000) or "{}").get("items", [])]
        except (ValueError, AttributeError, TypeError, KeyError):
            ids = []
        want = [f"sensor-{i + 1:04d}" for i in range(total)]
        r.check("integration-list", code == 0 and sorted(ids) == want and len(ids) == len(set(ids)),
                f"faults mode: exit {code} in {took:.1f}s; items {len(ids)} (unique {len(set(ids))}) of {total}" + ("" if "Traceback" not in se else "; traceback on stderr"))
        gets = [e for e in st["events"] if e["method"] == "GET"]
        ra_obs, ra_ok = [], True
        for i, e in enumerate(gets):
            if e["status"] == 429:
                nxt = next((x for x in gets[i + 1:] if x.get("page") == e["page"]), None)
                gap = (nxt["t"] - e["t"]) if nxt else None
                good = gap is not None and gap >= e["retry_after"] - 0.05
                ra_ok &= good
                ra_obs.append(f"page {e['page']}: Retry-After {e['retry_after']}s, retried after {gap:.2f}s" if gap is not None else f"page {e['page']}: never retried")
        r.check("retry-after", bool(ra_obs) and ra_ok, "; ".join(ra_obs) or "no 429 observed (did the client reach that page?)")
        stall = next((e for e in gets if e.get("stalled_s")), None)
        retry = next((x for x in gets if stall and x.get("page") == stall["page"] and x["t"] > stall["t"]), None)
        n_faults = sum(1 for e in gets if e["status"] != 200 or e.get("stalled_s") or e.get("truncated"))
        pages = -(-total // 10)
        bounded = len(gets) <= pages + n_faults + 2
        tgap = (retry["t"] - stall["t"]) if (stall and retry) else None
        r.check("bounded-time", tgap is not None and tgap < stall["stalled_s"] - 2 and bounded and took < 40,
                (f"stalled page {stall['page']} ({stall['stalled_s']:g}s): retried after {tgap:.1f}s; " if tgap is not None else "the stalled page was never retried; ")
                + f"{len(gets)} GETs for {pages} pages and {n_faults} injected faults; run took {took:.1f}s")

        # 2. loop mode
        fixture("/_fixture/scenario", {"mode": "loop"})
        code, so, se, took = cli(work, token_file, ["list", "--out", os.path.join(tmp, "loop.json")], limit=30)
        captured += [so, se]
        st = fixture("/_fixture/stats")
        n_get = sum(1 for e in st["events"] if e["method"] == "GET")
        r.check("pagination-loop", code == 3 and n_get <= pages + 2 and "Traceback" not in se and bool(se.strip()),
                f"loop mode: exit {code} after {n_get} GETs in {took:.1f}s; stderr: {se.strip().splitlines()[-1][:120] if se.strip() else '(empty)'}")

        # 3. POST policy
        fixture("/_fixture/scenario", {"mode": "faults"})
        c1, so, se, _ = cli(work, token_file, ["refresh"], limit=30)
        captured += [so, se]
        s1 = fixture("/_fixture/stats")
        fixture("/_fixture/scenario", {"mode": "faults"})
        key = "validate-" + uuid.uuid4().hex[:12]
        c2, so2, se2, _ = cli(work, token_file, ["refresh", "--idempotency-key", key], limit=30)
        captured += [so2, se2]
        s2 = fixture("/_fixture/stats")
        posts2 = [e for e in s2["events"] if e["method"] == "POST"]
        ok1 = c1 == 3 and s1["refresh_attempts"] == 1 and s1["refreshes"] == 1
        ok2 = c2 == 0 and s2["refreshes"] == 1 and len(posts2) >= 2 and all(e.get("idempotency_key") for e in posts2)
        r.check("post-policy", ok1 and ok2,
                f"without key: exit {c1}, {s1['refresh_attempts']} POST(s), {s1['refreshes']} refresh(es) performed; "
                f"with key: exit {c2}, {len(posts2)} POST(s){' all keyed' if posts2 and all(e.get('idempotency_key') for e in posts2) else ''}, {s2['refreshes']} refresh(es) performed")
    finally:
        try:
            fixture("/_fixture/scenario", {"mode": "faults"})
        except OSError:
            pass
        shutil.rmtree(tmp, ignore_errors=True)

    leaks = [f"CLI output #{i + 1}" for i, text in enumerate(captured) if token in text]
    for root, dirs, files in os.walk(work):
        dirs[:] = [d for d in dirs if d not in (".secrets", "__pycache__")]
        for f in files:
            p = os.path.join(root, f)
            if token in (L.read_text(p, limit=5_000_000) or ""):
                leaks.append(os.path.relpath(p, work))
    for f in os.listdir(EV) if os.path.isdir(EV) else []:
        if token in (L.read_text(os.path.join(EV, f), limit=5_000_000) or ""):
            leaks.append("evidence/" + f)
    r.check("no-secret-leak", not leaks, "token found in: " + ", ".join(leaks[:5]) if leaks else f"token absent from {len(captured)} captured outputs, the workspace (outside .secrets/) and evidence/")

    notes = re.sub(r"<!--.*?-->", "", L.read_text(os.path.join(EV, "L08-notes.md")) or "", flags=re.S)
    good = len(notes) > 400 and bool(re.search(r"idempot", notes, re.I)) and bool(re.search(r"Retry-After", notes, re.I))
    r.check("notes", good, f"evidence/L08-notes.md: {len(notes)} chars; idempotency and Retry-After {'discussed' if good else 'not yet discussed'}", critical=False)
    return r.finish(args.out, args.explanation, {"workspace": work, "variant_file": variant})


if __name__ == "__main__":
    sys.exit(main())
