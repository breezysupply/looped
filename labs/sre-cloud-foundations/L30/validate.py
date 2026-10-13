#!/usr/bin/env python3
"""L30 validator: runs YOUR work/repro.py against the local summaries fixture in
every mode, judges it by what the fixture saw on the wire, then checks your
customer reply for the ticket's mode.

Checks (critical unless noted):
  fixture           the fixture answers on 127.0.0.1:8130 and the ticket's mode is known
  repro-contract    every run ends with one JSON line holding category, http_status,
                    request_id, attempts and next_action (exit 0 for ok, 3 otherwise)
  classification    ok, auth_invalid, not_entitled, rate_limited, timeout and
                    stream_interrupted reported for the six fixture modes
  request-ids       each reported request_id is one the fixture issued in that run
  attempts-honest   the reported attempts equal the requests the fixture received
  caller-errors     401 and 403 are not retried (exactly one request)
  retry-after       429: 2-3 attempts, each retry at least Retry-After seconds after the previous
  bounded           at most 3 attempts in every mode; the stalled mode ends in < 20 s and
                    every stalled attempt is abandoned well before the 8 s stall ends
  idempotent        every retried run sent one non-empty Idempotency-Key on every attempt
  sanitised         no key, Authorization header or customer document text in any output,
                    in repro.py itself, in the reply or in the notes
  reply             work/customer-reply.md: five sections with substance, a request id the
                    fixture issued in the ticket's mode, and the evidence for that mode
  notes             evidence/L30-notes.md has Reproduction, Isolation and Retry policy (advisory)
Exit 1 if a critical check fails. The fixture is left in the ticket's mode afterwards.
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
import labcheck as L  # noqa: E402

BASE = "http://127.0.0.1:8130"
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
MODE_OF = {"variant-a": "auth-rotated", "variant-b": "rate-limited", "variant-c": "stream-cut", "variant-d": "timeout", "variant-e": "not-entitled"}
EXPECT = [("ok", "ok"), ("auth-rotated", "auth_invalid"), ("not-entitled", "not_entitled"),
          ("rate-limited", "rate_limited"), ("timeout", "timeout"), ("stream-cut", "stream_interrupted")]
CUSTOMER_MARKER = "dispatch@halyard.lab"
SECTIONS = ["Summary", "What we saw", "What it means", "Next steps", "Retry guidance"]
# what a reply must show for each ticket mode (any one term per group)
EVIDENCE_TERMS = {
    "auth-rotated": [["401"], ["rotat", "new key", "current key", "revoked", "replaced"]],
    "not-entitled": [["403"], ["entitle", "plan", "not enabled", "access to stream", "streaming access"]],
    "rate-limited": [["429"], ["retry-after"], ["quota", "rate limit", "concurren"]],
    "timeout": [["timeout", "timed out"], ["first byte", "no response", "stall", "8 s", "8 seconds", "deadline"]],
    "stream-cut": [["done", "terminal", "final event", "end event"], ["incomplete", "interrupted", "cut", "truncat"]],
}


def mode_tag(mode):
    return hashlib.sha256(("looped-l30:" + mode).encode()).hexdigest()[:8]


def fixture(path, body=None):
    req = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(),
                                 method="GET" if body is None else "POST", headers={"Content-Type": "application/json"})
    with OPENER.open(req, timeout=5) as r:
        return json.loads(r.read())


def run_repro(work, limit=40):
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1", NO_PROXY="*", no_proxy="*")
    t0 = time.monotonic()
    try:
        r = subprocess.run([sys.executable, os.path.join(work, "repro.py"), "--base-url", BASE,
                            "--key-file", os.path.join(work, ".secrets", "customer-key"),
                            "--request-file", os.path.join(work, "customer-request.json")],
                           cwd=work, capture_output=True, text=True, timeout=limit, env=env)
        return r.returncode, r.stdout, r.stderr, time.monotonic() - t0
    except subprocess.TimeoutExpired as e:
        out = e.stdout.decode() if isinstance(e.stdout, bytes) else (e.stdout or "")
        return 124, out, f"killed after {limit}s", time.monotonic() - t0


def last_json(stdout):
    for line in reversed(stdout.strip().splitlines()):
        line = line.strip()
        if line.startswith("{"):
            try:
                obj = json.loads(line)
                return obj if isinstance(obj, dict) else None
            except ValueError:
                return None
        if line:
            return None
    return None


def issued_ids(work):
    res = []
    try:
        with open(os.path.join(work, ".run", "issued.jsonl"), encoding="utf-8") as fh:
            for line in fh:
                try:
                    res.append(json.loads(line))
                except ValueError:
                    pass
    except OSError:
        pass
    return res


def main() -> int:
    args = L.standard_args("L30")
    r = L.Report("L30", "workstation")
    L.apply_args(r, args)
    work = os.path.abspath(os.environ.get("L30_WORK") or os.path.join(HERE, "work"))
    variant = (L.read_text(os.path.join(work, ".variant")) or "").strip()
    if not args.variant:
        r.seed = variant or "unknown"
    ticket_mode = MODE_OF.get(variant)

    try:
        st = fixture("/_fixture/stats")
        up = True
    except Exception as e:  # noqa: BLE001
        st, up = {"error": repr(e)}, False
    r.check("fixture", up and ticket_mode is not None, f"fixture answering; ticket variant {variant or 'missing'}" if up else f"fixture not reachable on {BASE}: {st['error'][:120]} (run setup.sh)")
    if not up or ticket_mode is None or not os.path.isfile(os.path.join(work, "repro.py")):
        if up and not os.path.isfile(os.path.join(work, "repro.py")):
            r.check("repro-contract", False, f"{work}/repro.py missing")
        return r.finish(args.out, args.explanation, {"variant_file": variant})
    retry_after = float(st.get("retry_after_s", 2))
    stall = float(st.get("stall_s", 8))
    keys = [v for v in ((L.read_text(os.path.join(work, ".secrets", k)) or "").strip() for k in ("customer-key", "new-key")) if v]

    runs = {}
    try:
        for mode, _want in EXPECT:
            fixture("/_fixture/scenario", {"mode": mode})
            rc, out, err, secs = run_repro(work)
            time.sleep(0.3)
            events = fixture("/_fixture/stats").get("events", [])
            runs[mode] = {"rc": rc, "out": out, "err": err, "secs": secs, "res": last_json(out), "events": events}
    finally:
        try:
            fixture("/_fixture/scenario", {"mode": ticket_mode})
        except Exception:  # noqa: BLE001
            r.note("could not put the fixture back in the ticket's mode; run reset.sh")

    # contract
    bad = []
    for mode, run in runs.items():
        res = run["res"]
        if not res or not all(k in res for k in ("category", "http_status", "request_id", "attempts", "next_action")):
            bad.append(f"{mode}: rc={run['rc']} last line={(run['out'].strip().splitlines() or [''])[-1][:80]!r}{' ' + run['err'][-60:] if run['rc'] == 124 else ''}")
        elif (res.get("category") == "ok") != (run["rc"] == 0) or run["rc"] not in (0, 3):
            bad.append(f"{mode}: category {res.get('category')} with exit {run['rc']}")
    r.check("repro-contract", not bad, "six runs, each ends with the JSON result line and the documented exit code" if not bad else "; ".join(bad)[:500])

    # classification
    got = {m: (runs[m]["res"] or {}).get("category") for m, _ in EXPECT}
    wrong = [f"{m}: got {got[m]} want {w}" for m, w in EXPECT if got[m] != w]
    r.check("classification", not wrong, "; ".join(f"{m}->{got[m]}" for m, _ in EXPECT) if not wrong else "; ".join(wrong))

    # request ids issued in that run
    bad = []
    for m, _ in EXPECT:
        res, ids = runs[m]["res"] or {}, [e.get("request_id") for e in runs[m]["events"] if e.get("request_id")]
        if m == "timeout" and res.get("request_id") is None:
            continue  # no header ever arrived; null is the honest answer
        if res.get("request_id") not in ids:
            bad.append(f"{m}: reported {res.get('request_id')!r}, fixture issued {ids[:3]}")
    r.check("request-ids", not bad, "every reported request id was issued by the fixture in that run" if not bad else "; ".join(bad)[:400])

    # attempts honest
    bad = [f"{m}: reported {(runs[m]['res'] or {}).get('attempts')} fixture saw {len(runs[m]['events'])}" for m, _ in EXPECT
           if (runs[m]["res"] or {}).get("attempts") != len(runs[m]["events"])]
    r.check("attempts-honest", not bad, "reported attempts match the fixture in every mode" if not bad else "; ".join(bad))

    # caller errors not retried
    n401, n403 = len(runs["auth-rotated"]["events"]), len(runs["not-entitled"]["events"])
    r.check("caller-errors", n401 == 1 and n403 == 1, f"requests: 401 mode={n401}, 403 mode={n403} (want 1 each)")

    # 429 honoured
    ev = runs["rate-limited"]["events"]
    gaps = [round(ev[i + 1]["t"] - ev[i]["t"], 2) for i in range(len(ev) - 1)]
    ok429 = 2 <= len(ev) <= 3 and all(g >= retry_after - 0.05 for g in gaps)
    r.check("retry-after", ok429, f"{len(ev)} requests, gaps {gaps} s, Retry-After {retry_after:g} s")

    # bounded
    most = max(len(run["events"]) for run in runs.values())
    tev = runs["timeout"]["events"]
    tgaps = [round(tev[i + 1]["t"] - tev[i]["t"], 2) for i in range(len(tev) - 1)]
    tsecs = runs["timeout"]["secs"]
    okb = most <= 3 and tsecs < 20 and all(g < stall - 1 for g in tgaps) and runs["timeout"]["rc"] != 124
    r.check("bounded", okb, f"max requests in one run {most}; stalled mode: {len(tev)} requests, gaps {tgaps} s, run {tsecs:.1f} s (stall {stall:g} s)")

    # idempotency
    bad = []
    for m, run in runs.items():
        keys_seen = [e.get("idempotency_key", "") for e in run["events"]]
        if len(keys_seen) > 1 and (len(set(keys_seen)) != 1 or not keys_seen[0]):
            bad.append(f"{m}: {len(keys_seen)} requests with {len(set(keys_seen))} distinct key(s){' (none sent)' if not any(keys_seen) else ''}")
    retried = [m for m, run in runs.items() if len(run["events"]) > 1]
    r.check("idempotent", not bad, f"retried modes {retried}: same Idempotency-Key on every attempt" if not bad else "; ".join(bad))

    # sanitised
    texts = {f"{m} output": run["out"] + run["err"] for m, run in runs.items()}
    for name in ("repro.py", "customer-reply.md"):
        texts[name] = L.read_text(os.path.join(work, name), 200000) or ""
    texts["notes"] = L.read_text(os.path.join(HERE, "evidence", "L30-notes.md"), 200000) or ""
    leaks = []
    for name, t in texts.items():
        if any(k and k in t for k in keys):
            leaks.append(f"{name}: API key")
        if name != "repro.py" and re.search(r"Authorization['\"]?\s*[:=]|Bearer\s+lab-", t):
            leaks.append(f"{name}: Authorization header")
        if CUSTOMER_MARKER in t or "SYNTHETIC CUSTOMER CONTENT" in t:
            leaks.append(f"{name}: customer document text")
        if L.contains_secret(t):
            leaks.append(f"{name}: credential-shaped string")
    r.check("sanitised", not leaks, "no key, Authorization header or customer text in outputs, repro.py, reply or notes" if not leaks else "; ".join(sorted(set(leaks)))[:400])

    # reply
    reply = texts["customer-reply.md"]
    tmpl = L.read_text(os.path.join(HERE, "assets", "reply-template.md")) or ""
    tmpl_lines = {ln.strip() for ln in tmpl.splitlines() if ln.strip()}
    missing = []
    for s in SECTIONS:
        m = re.search(r"^##\s+" + re.escape(s) + r"\s*$(.*?)(?=^##\s|\Z)", reply, re.M | re.S | re.I)
        body = "\n".join(ln for ln in (m.group(1).splitlines() if m else []) if ln.strip() and ln.strip() not in tmpl_lines).strip()
        if len(body) < 60:
            missing.append(s)
    tag = mode_tag(ticket_mode)
    ticket_ids = {i["request_id"] for i in issued_ids(work) if i.get("mode_tag") == tag}
    quoted = set(re.findall(r"req_[0-9a-f]{16}", reply))
    low = reply.lower()
    terms_missing = [" / ".join(g) for g in EVIDENCE_TERMS[ticket_mode] if not any(t in low for t in g)]
    ok_reply = reply.strip() != tmpl.strip() and not missing and bool(quoted & ticket_ids) and not terms_missing
    obs = f"sections thin/missing: {missing or 'none'}; request ids quoted {sorted(quoted)[:3]} ({len(quoted & ticket_ids)} issued in the ticket's mode)"
    if terms_missing:
        obs += f"; the reply does not yet state the decisive evidence for this ticket ({len(terms_missing)} item(s): status, what it means, what to do)"
    r.check("reply", ok_reply, obs)

    notes = texts["notes"]
    have = [s for s in ("Reproduction", "Isolation", "Retry policy") if re.search(r"^##\s+" + s, notes, re.M | re.I)]
    r.check("notes", len(have) == 3 and len(notes) > 700, f"sections {have}, chars={len(notes)}", critical=False)

    return r.finish(args.out, args.explanation, {"variant_file": variant})


if __name__ == "__main__":
    sys.exit(main())
