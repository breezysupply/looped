#!/usr/bin/env python3
"""L22 validator: runs promtool (in the pinned Prometheus image, no network)
over YOUR rules and tests, runs the lab's acceptance tests against your rules,
runs your tests against the original draft (they must catch its defect), and
recomputes the error budget from work/month.json.

Checks (critical unless noted):
  promtool          the pinned image runs promtool
  rules-check       promtool check rules accepts work/rules/beacon-slo.rules.yml
  rule-names        every recording rule and alert named in the README exists
  acceptance        assets/acceptance/acceptance.test.yml passes against your rules
                    (numerator/denominator values, no-data vs healthy, spike, fast and slow burn, zero traffic)
  own-tests-pass    promtool test rules passes on every work/tests/*.test.yml
  own-tests-cover   your test groups cover the four scenarios (names contain missing, spike, burn, zero)
  own-tests-catch   your tests FAIL against the original draft for your variant (they would have caught it)
  budget            eligible, bad, allowed_bad, consumed_pct, remaining_bad match work/month.json
  sli-definition    numerator, denominator and exclusions written; exclusions name health checks and 4xx
  decision          the worksheet's decision is written (advisory)
Exit 1 if any critical check fails. Writes the evidence JSON.
"""
import json
import os
import re
import shutil
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import labcheck as L  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, "work")
EV = os.path.join(HERE, "evidence")
IMAGE = os.environ.get("LOOPED_PROM_IMAGE", "prom/prometheus:v3.5.0")
RECORDS = ["beacon:sli_eligible:rate5m", "beacon:sli_eligible:rate30m", "beacon:sli_eligible:rate1h", "beacon:sli_eligible:rate6h",
           "beacon:sli_errors:rate5m", "beacon:sli_errors:rate30m", "beacon:sli_errors:rate1h", "beacon:sli_errors:rate6h",
           "beacon:sli_error_ratio:rate5m", "beacon:sli_error_ratio:rate30m", "beacon:sli_error_ratio:rate1h", "beacon:sli_error_ratio:rate6h",
           "beacon:sli_latency_good_ratio:rate5m"]
ALERTS = ["BeaconErrorBudgetBurnFast", "BeaconErrorBudgetBurnSlow", "BeaconSLINoData"]
SCENARIOS = ["missing", "spike", "burn", "zero"]


def promtool(*args):
    return L.sh(["docker", "run", "--rm", "--network", "none", "--name", "looped-l22-promtool-%d" % os.getpid(),
                 "-v", WORK + ":/w:ro", "--entrypoint", "promtool", IMAGE] + list(args), timeout=180)


def failures(out):
    lines = [x.strip() for x in out.splitlines() if x.strip().startswith(("expr:", "alertname:", "FAILED", "group", "name:")) or "error" in x.lower()]
    return "; ".join(lines[:4])[:400]


def stage(name, rules_src, tests):
    """work/.check/<name>/{rules/beacon-slo.rules.yml, tests/*.test.yml} (rule_files: ../rules/...)."""
    base = os.path.join(WORK, ".check", name)
    if os.path.isdir(base):
        shutil.rmtree(base)
    os.makedirs(os.path.join(base, "rules"))
    os.makedirs(os.path.join(base, "tests"))
    shutil.copy(rules_src, os.path.join(base, "rules", "beacon-slo.rules.yml"))
    out = []
    for t in tests:
        dst = os.path.join(base, "tests", os.path.basename(t))
        shutil.copy(t, dst)
        out.append("/w/.check/%s/tests/%s" % (name, os.path.basename(t)))
    for root, dirs, files in os.walk(base):
        for d in dirs:
            os.chmod(os.path.join(root, d), 0o755)
        for f in files:
            os.chmod(os.path.join(root, f), 0o644)
    os.chmod(os.path.join(WORK, ".check"), 0o755)
    return out


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def close(got, want, rel=0.005, absolute=1.0):
    return got is not None and abs(got - want) <= max(absolute, abs(want) * rel)


def main():
    args = L.standard_args("L22", "Validate L22 (SLIs, SLOs and alert rules) with promtool")
    r = L.Report("L22", "workstation")
    L.apply_args(r, args)
    variant = (L.read_text(os.path.join(WORK, ".variant")) or "variant-a").strip()
    if not args.variant:
        r.seed = variant
    rules = os.path.join(WORK, "rules", "beacon-slo.rules.yml")
    tests = sorted(os.path.join(WORK, "tests", f) for f in os.listdir(os.path.join(WORK, "tests")) if f.endswith((".yml", ".yaml"))) if os.path.isdir(os.path.join(WORK, "tests")) else []

    code, out, err = promtool("--version")
    version = (out or err).splitlines()[0] if (out or err) else ""
    r.check("promtool", code == 0, version or f"cannot run promtool from {IMAGE}: {err.strip()[:200]}")
    if code != 0:
        return r.finish(args.out, args.explanation, {"variant_file": variant, "promtool_image": IMAGE})

    if os.path.isfile(rules):
        os.chmod(rules, 0o644)
    code, out, err = promtool("check", "rules", "/w/rules/beacon-slo.rules.yml")
    r.check("rules-check", code == 0, (out + err).strip().replace("\n", " ")[:300])

    src = L.read_text(rules) or ""
    missing = [n for n in RECORDS if not re.search(r"^\s*-?\s*record:\s*%s\s*$" % re.escape(n), src, re.M)]
    missing += [n for n in ALERTS if not re.search(r"^\s*-?\s*alert:\s*%s\s*$" % re.escape(n), src, re.M)]
    r.check("rule-names", not missing, "all 13 recording rules and 3 alerts present" if not missing else "missing: " + ", ".join(missing))

    acc = stage("acceptance", rules, [os.path.join(HERE, "assets", "acceptance", "acceptance.test.yml")]) if os.path.isfile(rules) else []
    if acc:
        code, out, err = promtool("test", "rules", *acc)
        r.check("acceptance", code == 0, "SUCCESS: numerator/denominator, no-data, spike, fast and slow burn, zero traffic" if code == 0 else "FAILED " + failures(out + err))
    else:
        r.check("acceptance", False, "work/rules/beacon-slo.rules.yml missing")

    if tests:
        own = stage("own", rules, tests)
        code, out, err = promtool("test", "rules", *own)
        r.check("own-tests-pass", code == 0, f"{len(tests)} file(s): SUCCESS" if code == 0 else "FAILED " + failures(out + err))
        text = "\n".join(L.read_text(t) or "" for t in tests)
        names = re.findall(r"^\s*-\s*name:\s*(.+)$", text, re.M)
        groups = len(re.findall(r"^\s*-\s*(?:name|interval):", text, re.M))
        covered = {s: any(s in n.lower() for n in names) for s in SCENARIOS}
        has_alert_checks = len(re.findall(r"ALERTS\{|alert_rule_test", text)) >= 3
        r.check("own-tests-cover", all(covered.values()) and len(names) >= 5 and has_alert_checks,
                f"{len(names)} named groups ({groups} total); scenarios " + ", ".join(f"{k}={'yes' if v else 'no'}" for k, v in covered.items()) + f"; alert-state checks: {has_alert_checks}")
        draft = os.path.join(HERE, "assets", "drafts", variant + ".rules.yml")
        mut = stage("against-draft", draft, tests)
        code, out, err = promtool("test", "rules", *mut)
        r.check("own-tests-catch", code != 0, "your tests fail against the original draft (they catch it)" if code != 0 else "your tests PASS against the original draft: they would not have caught its defect")
    else:
        for cid in ("own-tests-pass", "own-tests-cover", "own-tests-catch"):
            r.check(cid, False, "no test files in work/tests/")

    month = {}
    try:
        with open(os.path.join(WORK, "month.json"), "r", encoding="utf-8") as fh:
            month = json.load(fh)
    except (OSError, ValueError):
        pass
    slo = {}
    try:
        with open(os.path.join(WORK, "slo.json"), "r", encoding="utf-8") as fh:
            slo = json.load(fh)
    except (OSError, ValueError) as e:
        slo = {"_error": str(e)}
    counts = month.get("counts", [])
    eligible = sum(c["n"] for c in counts if c["route"] not in ("/healthz", "/metrics") and not str(c["code"]).startswith("4"))
    bad = sum(c["n"] for c in counts if c["route"] not in ("/healthz", "/metrics") and str(c["code"]).startswith("5"))
    allowed = (1 - 0.995) * eligible
    want = {"eligible": eligible, "bad": bad, "allowed_bad": allowed, "consumed_pct": 100.0 * bad / allowed if allowed else None, "remaining_bad": allowed - bad}
    b = slo.get("budget") or {}
    wrong = []
    for k, v in want.items():
        got = num(b.get(k))
        tol_abs = 0.1 if k == "consumed_pct" else 1.0
        if v is None or not close(got, v, rel=0.002, absolute=tol_abs):
            wrong.append(f"{k}={b.get(k)}")
    r.check("budget", bool(counts) and not wrong, f"eligible {b.get('eligible')}, bad {b.get('bad')}, consumed {b.get('consumed_pct')}%" + (f"; not matching the month fixture: {', '.join(wrong)}" if wrong else "; matches the month fixture"))

    av = slo.get("availability_sli") or {}
    excl = " ".join(av.get("exclusions") or []).lower()
    filled = all(isinstance(av.get(k), str) and len(av.get(k)) >= 15 and not av.get(k).startswith("WRITE") for k in ("numerator", "denominator"))
    names_health = "healthz" in excl or "health" in excl
    names_4xx = "4xx" in excl or "4.." in excl or "client error" in excl
    r.check("sli-definition", filled and names_health and names_4xx, f"numerator/denominator written: {filled}; exclusions name health checks: {names_health}, 4xx: {names_4xx}")
    dec = slo.get("decision") or ""
    r.check("decision", isinstance(dec, str) and len(dec) >= 60 and not dec.startswith("WRITE"), f"{len(dec)} chars", critical=False)

    explanation = args.explanation or (dec if isinstance(dec, str) else "")
    return r.finish(args.out, explanation, {"variant_file": variant, "promtool_image": IMAGE, "promtool": version})


if __name__ == "__main__":
    sys.exit(main())
