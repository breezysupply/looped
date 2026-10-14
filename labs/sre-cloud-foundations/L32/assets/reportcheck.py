#!/usr/bin/env python3
"""reportcheck.py — structure checks for the L32 deliverables (no cluster needed).

    python3 reportcheck.py [REPORT_DIR]      default labs/sre-cloud-foundations/L32/report

Checks the incident report, the design defence, the rubric scores, the fresh Python change and
the Terraform plan reading, plus sanitisation and honesty. Structure is necessary, not
sufficient: a mentor (or you, honestly) grades content against assets/rubric.json.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from typing import Any, Dict, List, Tuple

HERE = os.path.dirname(os.path.abspath(__file__))
L32 = os.path.dirname(HERE)
SRE = os.path.dirname(L32)
REPO = os.path.abspath(os.path.join(SRE, "..", ".."))
REPORT_SECTIONS = ["Summary", "Timeline", "Fault 1", "Fault 2", "Combined incident", "Data and recovery decision",
                   "Verification", "Least privilege", "Cleanup", "Follow-ups"]
CLAIM = re.compile(r"\bproduction experience\b|\byears of (hands-on )?experience\b|\bin production at\b|\b(i|we) (have )?(operated|ran|run|managed) [^.\n]{0,40}\bat (production )?scale\b|\bon-call for (a|the|our) (real|production)\b", re.I)
NEGATION = re.compile(r"\bnot\b|\bno\b|n't\b|\bnever\b|\bwithout\b", re.I)
SECRETISH = re.compile(r"not-a-real-secret|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer [A-Za-z0-9._-]{20,}|password\s*[=:]\s*\S{6,}|postgresql://[^:\s]+:[^@\s]+@", re.I)
Row = Tuple[str, bool, str]


def read(path: str) -> str:
    try:
        with open(path, encoding="utf-8") as fh:
            return fh.read()
    except OSError:
        return ""


def sections(text: str, template: str) -> Dict[str, str]:
    tl = {ln.strip() for ln in template.splitlines() if ln.strip()}
    out = {}
    for m in re.finditer(r"^##\s+(.+?)\s*$(.*?)(?=^##\s|\Z)", text, re.M | re.S):
        body = "\n".join(ln for ln in m.group(2).splitlines() if ln.strip() and ln.strip() not in tl and not re.fullmatch(r"\s*\[.*\]\s*", ln))
        out[m.group(1).strip().lower()] = body
    return out


def refs(text: str, report_dir: str) -> List[str]:
    found = []
    for p in re.findall(r"(?:labs/sre-cloud-foundations/|report/)[\w./-]+[\w/]", text):
        cand = [os.path.join(REPO, p), os.path.join(L32, p), os.path.join(report_dir, p[len("report/"):]) if p.startswith("report/") else ""]
        if any(c and os.path.exists(c) for c in cand):
            found.append(p)
    return found


def check_report(rd: str, draw: Dict[str, Any]) -> List[Row]:
    text = read(os.path.join(rd, "incident-report.md"))
    secs = sections(text, read(os.path.join(HERE, "report-template.md")))
    thin = [s for s in REPORT_SECTIONS if len(secs.get(s.lower(), "")) < 150]
    stamps = re.findall(r"\b20\d\d-\d\d-\d\dT\d\d:\d\d(?::\d\d)?Z\b", secs.get("timeline", ""))
    rows: List[Row] = [("report-structure", bool(text) and not thin and len(stamps) >= 6,
                        f"sections thin/missing: {thin or 'none'}; timeline timestamps: {len(stamps)} (need 6)")]
    singles = draw.get("single_details") or []
    bad = []
    for n, s in enumerate(singles[:2], 1):
        body = secs.get(f"fault {n}", "")
        r = refs(body, rd)
        if s.get("lab", "?") not in body or s.get("variant", "?") not in body:
            bad.append(f"Fault {n}: does not name {s.get('lab')} {s.get('variant')}")
        if not r or "```" not in body:
            bad.append(f"Fault {n}: needs an existing evidence path and quoted output (```)")
    comb = secs.get("combined incident", "") + secs.get("data and recovery decision", "")
    if "```" not in comb or not refs(comb, rd):
        bad.append("Combined incident/data decision: needs quoted output and an evidence path")
    dd = secs.get("data and recovery decision", "").lower()
    if not ("backup" in dd and re.search(r"\b(selective|partial|full restore|accept)", dd) and re.search(r"\d", dd)):
        bad.append("Data decision: name the backup, the option chosen versus the alternatives, and record counts")
    rows.append(("diagnosis-evidence", bool(singles) and not bad, "each fault names its lab/variant with evidence paths and quoted output" if not bad else "; ".join(bad)))
    return rows


def check_defense(rd: str) -> List[Row]:
    text = read(os.path.join(rd, "design-defense.md"))
    secs = sections(text, read(os.path.join(HERE, "defense-template.md")))
    bad = []
    for i in range(1, 6):
        b = secs.get(f"decision {i}", "")
        if len(b) < 120 or not re.search(r"rejected alternative:\s*\S{3,}", b, re.I) or not re.search(r"evidence:\s*\S{3,}", b, re.I):
            bad.append(f"Decision {i}")
    upd = secs.get("three-minute update", "")
    words = len(upd.split())
    if not (80 <= words <= 450) or not re.search(r"\d\d:\d\d", upd):
        bad.append(f"Three-minute update ({words} words, needs 80-450 and a next-update time)")
    if len(re.findall(r"^\s*[-*]\s+\S", secs.get("ten-minute defence outline", secs.get("ten-minute defense outline", "")), re.M)) < 5:
        bad.append("Ten-minute outline (5+ bullets)")
    if len(secs.get("gaps", "")) < 150:
        bad.append("Gaps")
    return [("design-defense", bool(text) and not bad, "five decisions with rejected alternatives and evidence, update, outline, gaps" if not bad else "thin or missing: " + ", ".join(bad))]


def check_rubric(rd: str) -> List[Row]:
    rub = json.loads(read(os.path.join(HERE, "rubric.json")) or "{}")
    try:
        sc = json.loads(read(os.path.join(rd, "rubric-scores.json")) or "{}")
    except ValueError:
        return [("rubric", False, "report/rubric-scores.json is not valid JSON")]
    doms = sc.get("domains") or {}
    low, noev = [], []
    for d in rub.get("domains", []):
        mine = doms.get(d["id"]) or {}
        valid = {c["id"] for c in d["criteria"]}
        met = [m for m in mine.get("met", []) if m in valid]
        if len(set(met)) < rub.get("pass_per_domain", 3):
            low.append(f"{d['id']} {len(set(met))}/4")
        ev = [e for e in mine.get("evidence", []) if refs(e, rd)]
        if not ev:
            noev.append(d["id"])
    ok = sc.get("reviewer") in ("self", "mentor") and not low and not noev
    return [("rubric", ok, f"reviewer {sc.get('reviewer')}; below 3/4: {low or 'none'}; domains without an existing evidence path: {noev or 'none'}")]


def check_python_change(rd: str) -> List[Row]:
    d = os.path.join(rd, "python-change")
    tests = [f for f in os.listdir(d)] if os.path.isdir(d) else []
    tests = [f for f in tests if f.startswith("test_") and f.endswith(".py")]
    if not tests:
        return [("python-change", False, "report/python-change/ needs your change and at least one test_*.py")]
    try:
        r = subprocess.run([sys.executable, "-I", "-m", "unittest", "discover", "-s", ".", "-p", "test_*.py"], cwd=d, capture_output=True, text=True, timeout=120,
                           env={"PATH": os.environ.get("PATH", ""), "PYTHONDONTWRITEBYTECODE": "1"})
        out, rc = r.stdout + r.stderr, r.returncode
    except subprocess.TimeoutExpired:
        out, rc = "timed out", 124
    m = re.search(r"Ran (\d+) tests?", out)
    n = int(m.group(1)) if m else 0
    return [("python-change", rc == 0 and n >= 3, f"unittest in report/python-change: exit {rc}, {n} tests (need 3+ passing)")]


def check_terraform(rd: str) -> List[Row]:
    plan = read(os.path.join(rd, "terraform-plan.txt"))
    forced = set(re.findall(r"^\s*[~+-]+\s+\"?([\w.\-\[\]\"]+?)\"?\s*=.*#\s*forces replacement", plan, re.M))
    secs = sections(read(os.path.join(rd, "design-defense.md")), read(os.path.join(HERE, "defense-template.md")))
    body = secs.get("terraform replacement plan", "")
    named = [f for f in forced if f.strip('"') in body]
    ok = "must be replaced" in plan and bool(forced) and bool(named) and len(body) >= 150
    return [("terraform-plan", ok, f"plan has {len(forced)} forcing attribute(s) {sorted(forced)[:3]}; named in the defence: {named or 'none'}")]


def check_honesty(rd: str) -> List[Row]:
    texts = {n: read(os.path.join(rd, n)) for n in ("incident-report.md", "design-defense.md", "rubric-scores.json")}
    leaks = [n for n, t in texts.items() if SECRETISH.search(t)]
    claims = [s.strip()[:80] for t in texts.values() for s in re.split(r"[.\n]", t) if CLAIM.search(s) and not NEGATION.search(s)]
    return [("sanitised-honest", not leaks and not claims, f"secret-shaped strings in: {leaks or 'none'}; production-experience claims: {claims[:2] or 'none'}")]


def all_checks(rd: str, draw: Dict[str, Any]) -> List[Row]:
    return check_report(rd, draw) + check_defense(rd) + check_rubric(rd) + check_python_change(rd) + check_terraform(rd) + check_honesty(rd)


def main(argv: List[str]) -> int:
    rd = os.path.abspath(argv[0]) if argv else os.path.join(L32, "report")
    draw = json.loads(read(os.path.join(rd, "draw.json")) or "{}")
    rows = all_checks(rd, draw)
    for cid, ok, obs in rows:
        print(f"{'PASS' if ok else 'FAIL'} {cid}: {obs}")
    return 0 if all(ok for _, ok, _ in rows) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
