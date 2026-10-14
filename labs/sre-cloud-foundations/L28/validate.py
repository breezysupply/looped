#!/usr/bin/env python3
"""L28 validator: checks the restored service, the data behind it, and the
incident record you kept. Read-only apart from one test record written
through the API (sensor `l28-validate`) and the evidence JSON.

Checks (critical unless noted):
  service-restored   the status API answers /ready and accepts a write, on the database it is configured for
  recovery-point     the records of the synthetic day on that database are EXACTLY the content of the
                     valid backup with the least data loss (count + checksum against the setup oracle)
  primary-preserved  the damaged primary's volume still exists (kept for the postmortem, not wiped)
  update-log         3+ updates in work/incident/updates.md: UTC timestamps after the incident started,
                     increasing, <= 30 min apart; each with Status, Impact, Scope and a Next update time
                     <= 30 min ahead (except the final, resolved one); roles named in the first
  recovery-decision  an update names the recovery point actually restored, the data-loss window and
                     how the restored data was validated
  followups          2+ follow-ups in work/incident/followups.md, each with an owner and a due date
  recovery-interval  time from incident start to the resolved update (advisory, reported)
"""
import datetime as dt
import json
import os
import re
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
import labcheck as L  # noqa: E402

WORK = os.path.join(HERE, "work")
EV = os.path.join(HERE, "evidence")
PROJECT = "looped-l28"
API = "http://127.0.0.1:18028"
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
POOL_TO_FILE = {"nightly-0200.dump": "T0200Z", "standby-1040.dump": "T1330Z", "hourly-1200.dump": "T1200Z", "hourly-1300.dump": "T1300Z"}
TS = re.compile(r"(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?Z")


def read(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return fh.read()
    except OSError:
        return None


def http(method, path, body=None):
    req = urllib.request.Request(API + path, method=method, data=body, headers={"Content-Type": "application/json"})
    try:
        with OPENER.open(req, timeout=5) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
    except Exception as e:  # noqa: BLE001
        return 0, repr(e)


def parse_ts(s):
    m = TS.search(s or "")
    if not m:
        return None
    return dt.datetime.strptime(m.group(1) + m.group(2) + m.group(3) + (m.group(4) or "00"), "%Y-%m-%d%H%M%S").replace(tzinfo=dt.timezone.utc)


def field(block, name):
    m = re.search(r"(?mi)^\s*\**" + re.escape(name) + r"\**\s*:\s*(.+)$", block)
    return m.group(1).strip() if m else ""


def main():
    args = L.standard_args("L28")
    r = L.Report("L28", "compose")
    L.apply_args(r, args)
    variant = (read(os.path.join(WORK, ".variant")) or "variant-a").strip()
    if not args.variant:
        r.seed = variant
    if not os.path.isdir(WORK):
        r.check("service-restored", False, "no work/ directory: run setup.sh first")
        return r.finish(args.out, args.explanation)
    fault_at = parse_ts((read(os.path.join(WORK, ".l28", "fault-at")) or "").strip())
    choice = (read(os.path.join(WORK, ".l28", "choice")) or "").strip()
    try:
        expected = json.loads(read(os.path.join(WORK, ".l28", "expected.json")) or "{}")
    except ValueError:
        expected = {}

    # ── service and data ──────────────────────────────────────────────
    code, body = http("GET", "/ready")
    try:
        db_host = json.loads(body).get("db_host", "")
    except ValueError:
        db_host = ""
    wcode, wbody = http("POST", "/status", json.dumps({"sensor_id": "l28-validate", "status": "ok"}).encode())
    r.check("service-restored", code == 200 and wcode == 201, f"/ready {code} (db_host={db_host or '?'}); test write {wcode}" + ("" if code == 200 else f": {body[:150]}"))

    restored_name = None
    c, out, _ = L.docker(["ps", "-q", "--filter", f"label=com.docker.compose.project={PROJECT}", "--filter", f"label=com.docker.compose.service={db_host}"]) if re.fullmatch(r"[a-z0-9_-]+", db_host or "") else (1, "", "")
    cid = (out.split() or [None])[0]
    if not cid:
        r.check("recovery-point", False, f"no running container for the API's database service '{db_host}'")
    else:
        sql = ("SELECT count(*) || '|' || coalesce(md5(string_agg(sensor_id || '/' || status || '/' || to_char(created_at AT TIME ZONE 'UTC', 'HH24:MI'), ',' "
               "ORDER BY created_at, sensor_id)), '-') || '|' || coalesce(to_char(max(created_at) AT TIME ZONE 'UTC', 'HH24:MI'), '-') FROM records WHERE created_at < timestamptz '2025-03-12 00:00+00'")
        c2, o2, e2 = L.sh(["docker", "exec", cid, "psql", "-X", "-At", "-U", "beacon", "-d", "beacon", "-c", sql], timeout=30)
        parts = o2.strip().split("|")
        if c2 != 0 or len(parts) != 3:
            r.check("recovery-point", False, f"cannot read records on '{db_host}': {e2.strip()[:150]}")
        else:
            n, md5, newest = int(parts[0]), parts[1], parts[2]
            match = [k for k, v in expected.items() if v.get("md5") == md5 and v.get("count") == n]
            if match and match[0] in POOL_TO_FILE:
                suffix = POOL_TO_FILE[match[0]]
                restored_name = next((f for f in [choice] + os.listdir(os.path.join(WORK, "backups")) if suffix in f), None)
            good = bool(match) and (restored_name == choice or match[0] == "primary-at-fault")
            lost = expected.get("primary-at-fault", {}).get("count", 0) - n
            best = next((v for k, v in expected.items() if POOL_TO_FILE.get(k, "#") in choice), {})
            r.check("recovery-point", good,
                    f"'{db_host}' holds {n} records of {expected.get('primary-at-fault', {}).get('count', '?')} (newest {newest}, {lost} lost); "
                    + (f"identical to {restored_name or match[0]}" if match else "matches NO backup exactly (partial or mixed restore?)")
                    + ("" if good else f"; the valid backup with the least loss holds {best.get('count', '?')} records (newest {best.get('newest', '?')})"))

    c3, o3, _ = L.docker(["volume", "inspect", "looped-l28-primary"])
    r.check("primary-preserved", c3 == 0, "looped-l28-primary " + ("still exists for the postmortem" if c3 == 0 else "was removed: the damaged primary is gone, with whatever it could still tell you"))

    # ── incident record ───────────────────────────────────────────────
    text = re.sub(r"(?s)<!--.*?-->", "", read(os.path.join(WORK, "incident", "updates.md")) or "")
    blocks = re.split(r"(?m)^##\s+", text)[1:]
    ups = []
    for b in blocks:
        head = b.splitlines()[0] if b.splitlines() else ""
        ups.append({"t": parse_ts(head), "head": head.strip(), "b": b})
    probs = []
    if len(ups) < 3:
        probs.append(f"{len(ups)} updates (need 3+)")
    for i, u in enumerate(ups):
        tag = f"update {i + 1}"
        if not u["t"]:
            probs.append(f"{tag}: no UTC timestamp in the heading")
            continue
        if fault_at and u["t"] < fault_at - dt.timedelta(minutes=2):
            probs.append(f"{tag}: {u['t']:%H:%MZ} is before the incident started ({fault_at:%H:%MZ})")
        if i and ups[i - 1]["t"]:
            gap = (u["t"] - ups[i - 1]["t"]).total_seconds() / 60
            if gap <= 0:
                probs.append(f"{tag}: not later than the previous update")
            elif gap > 30:
                probs.append(f"{tag}: {gap:.0f} min after the previous one (> 30)")
        for f in ("Status", "Impact", "Scope"):
            if len(field(u["b"], f)) < (3 if f == "Status" else 15):
                probs.append(f"{tag}: no {f}")
        final = field(u["b"], "Status").lower().startswith("resolved")
        nxt = parse_ts(field(u["b"], "Next update"))
        if not final:
            if not nxt:
                probs.append(f"{tag}: no Next update time")
            elif not (u["t"] < nxt <= u["t"] + dt.timedelta(minutes=30)):
                probs.append(f"{tag}: Next update {nxt:%H:%MZ} not within 30 min after {u['t']:%H:%MZ}")
    if ups and "ic" not in field(ups[0]["b"], "Roles").lower():
        probs.append("update 1: no Roles line naming the IC")
    if ups and not field(ups[-1]["b"], "Status").lower().startswith("resolved"):
        probs.append("the last update is not Status: resolved")
    r.check("update-log", not probs, f"{len(ups)} updates" + (", " + ", ".join(u["t"].strftime("%H:%MZ") for u in ups if u["t"]) if ups else "") + ("; " + "; ".join(probs[:5]) if probs else "; structure, timing and next-update promises OK"))

    rp = " ".join(field(u["b"], "Recovery point") for u in ups)
    loss = " ".join(field(u["b"], "Data loss") for u in ups)
    val = " ".join(field(u["b"], "Validation") for u in ups)
    named = restored_name and restored_name in rp
    r.check("recovery-decision", bool(named) and len(loss) >= 15 and len(val) >= 20,
            f"recovery point stated: {('names ' + restored_name) if named else ('does not name the restored backup ' + str(restored_name))}; data loss {len(loss)} chars; validation {len(val)} chars")

    fu = read(os.path.join(WORK, "incident", "followups.md")) or ""
    items = []
    for line in fu.splitlines():
        m = re.match(r"^\s*[-*]\s+(.{10,}?)\s+[—-]+\s*owner:\s*(\S.*?)\s+[—-]+\s*due:\s*(\d{4}-\d{2}-\d{2})\s*$", line, re.I)
        if m and "<" not in line:
            items.append(m.groups())
    late = [d for a, o, d in items if fault_at and d < fault_at.strftime("%Y-%m-%d")]
    r.check("followups", len(items) >= 2 and not late, f"{len(items)} follow-ups with owner and due date" + (f"; due dates in the past: {late}" if late else "") + (": " + "; ".join(f"{a[:40]} ({o})" for a, o, d in items[:3]) if items else ""))

    resolved = [u for u in ups if u["t"] and field(u["b"], "Status").lower().startswith("resolved")]
    if fault_at and resolved:
        mins = (resolved[-1]["t"] - fault_at).total_seconds() / 60
        r.check("recovery-interval", True, f"incident start {fault_at:%H:%M:%SZ} to resolved update {resolved[-1]['t']:%H:%MZ}: {mins:.0f} min", critical=False)
    else:
        r.check("recovery-interval", False, "no resolved update to measure the recovery interval", critical=False)

    return r.finish(args.out, args.explanation, {"variant_file": variant, "compose_project": PROJECT, "api_db_host": db_host})


if __name__ == "__main__":
    sys.exit(main())
