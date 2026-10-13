#!/usr/bin/env python3
"""L07 validator: runs YOUR tests and YOUR CLI (labs/sre-cloud-foundations/L07/work
by default; --work DIR or L07_WORK to change) against fixtures and against a
reference implementation. Nothing here trusts what the code says about itself.

Checks (critical unless noted):
  tests-pass         your unittest suite passes on your logsummary.py (at least 8 tests)
  tests-are-fair     your suite also passes on the reference implementation (it tests the contract)
  tests-catch-bugs   your suite FAILS on every deliberately broken variant in broken/mutants.json
  edge-cases         your CLI matches the reference on generated edge-case files: exit code, --json
                     summary, nothing on stdout and a file:line message on stderr for bad input
  incident           your CLI's result for the variant's incident log matches the reference
  deterministic      byte-identical output across runs with different hash seeds (text and --json)
  bounded-memory     peak memory does not grow with file size (10x more rows) (advisory)
  notes              evidence/L07-notes.md explains complexity and memory (advisory)
Exit 1 if any check fails.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
import labcheck as L  # noqa: E402

REF = os.path.join(HERE, "solution", "logsummary.py")
GEN = os.path.join(HERE, "assets", "gen_logs.py")
EV = os.path.join(HERE, "evidence")


def run_tests(workdir, impl_src, tmp_root):
    """Copy the workspace, swap in an implementation, run unittest. Returns (rc, ran, tail)."""
    d = tempfile.mkdtemp(dir=tmp_root)
    for name in os.listdir(workdir):
        p = os.path.join(workdir, name)
        if name in ("data", "out", "__pycache__", ".variant"):
            continue
        (shutil.copytree if os.path.isdir(p) else shutil.copy2)(p, os.path.join(d, name))
    with open(os.path.join(d, "logsummary.py"), "w", encoding="utf-8") as fh:
        fh.write(impl_src)
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1", PYTHONHASHSEED="0")
    try:
        r = subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", ".", "-p", "test*.py"], cwd=d, capture_output=True, text=True, timeout=120, env=env)
        out = r.stdout + r.stderr
        rc = r.returncode
    except subprocess.TimeoutExpired:
        out, rc = "timed out after 120 s", 124
    m = re.search(r"Ran (\d+) tests?", out)
    tail = out.strip().splitlines()[-1] if out.strip() else ""
    return rc, int(m.group(1)) if m else 0, tail


def cli(impl, path, *extra, hashseed="0"):
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1", PYTHONHASHSEED=hashseed)
    try:
        r = subprocess.run([sys.executable, impl, path] + list(extra), capture_output=True, text=True, timeout=60, env=env)
        return r.returncode, r.stdout, r.stderr
    except subprocess.TimeoutExpired:
        return 124, "", "timed out"


def peak_kib(impl, path):
    probe = ("import resource, subprocess, sys\n"
             "rc = subprocess.run(sys.argv[1:], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=300).returncode\n"
             "print(rc, resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss)")
    code, out, _ = L.sh([sys.executable, "-c", probe, sys.executable, impl, path, "--json"], timeout=320)
    try:
        rc, kib = (int(x) for x in out.split())
    except ValueError:
        return None
    return kib if rc in (0, 1) else None


def same(a, b):
    """Compare two CLI results the way the contract defines them."""
    (ca, oa, ea), (cb, ob, eb) = a, b
    if ca != cb:
        return False, f"exit {ca} (reference {cb})"
    if cb == 2:
        if oa.strip():
            return False, "printed to stdout on bad input"
        line = re.search(r":(\d+)", eb)
        if not ea.strip():
            return False, "no message on stderr"
        if line and not re.search(r"(:|line\s*)" + line.group(1) + r"\b", ea):
            return False, f"stderr does not name line {line.group(1)}: {ea.strip()[:80]}"
        if "Traceback" in ea:
            return False, "traceback instead of a message"
        return True, "exit 2 with a file:line message"
    try:
        ja, jb = json.loads(oa), json.loads(ob)
    except ValueError:
        return False, "--json output is not JSON"
    if ja != jb:
        diff = sorted(k for k in set(ja) | set(jb) if ja.get(k) != jb.get(k))
        return False, f"--json differs in {diff}"
    return True, f"exit {ca}, summary equal"


def main() -> int:
    args = L.standard_args("L07")
    work = os.path.abspath(os.environ.get("L07_WORK") or os.path.join(HERE, "work"))
    r = L.Report("L07", "linux-arm64")
    L.apply_args(r, args)
    variant = (L.read_text(os.path.join(work, ".variant")) or "").strip() or "variant-a"
    if not args.variant:
        r.seed = variant
    mine = os.path.join(work, "logsummary.py")
    if not os.path.exists(mine):
        r.check("tests-pass", False, f"{mine} missing; run setup.sh")
        return r.finish(args.out, args.explanation)
    ref_src = open(REF, encoding="utf-8").read()
    my_src = open(mine, encoding="utf-8").read()
    tmp = tempfile.mkdtemp(prefix="looped-l07-")
    try:
        rc, ran, tail = run_tests(work, my_src, tmp)
        r.check("tests-pass", rc == 0 and ran >= 8, f"your suite on your code: ran {ran}, {tail}" + ("" if ran >= 8 else " (write at least 8 tests)"))

        rc, ran_ref, tail = run_tests(work, ref_src, tmp)
        r.check("tests-are-fair", rc == 0 and ran_ref > 0, f"your suite on the reference implementation: ran {ran_ref}, {tail}" + ("" if rc == 0 else " — a test depends on something outside the contract"))

        spec = json.load(open(os.path.join(HERE, "broken", "mutants.json"), encoding="utf-8"))
        killed, survived = [], []
        for m in spec["mutants"]:
            if ref_src.count(m["find"]) != 1:
                survived.append(m["id"] + "(patch did not apply)")
                continue
            rc, _, _ = run_tests(work, ref_src.replace(m["find"], m["replace"]), tmp)
            (killed if rc != 0 else survived).append(m["id"])
        r.check("tests-catch-bugs", not survived and ran_ref > 0,
                f"broken variants caught by your tests: {len(killed)}/{len(spec['mutants'])}" + (f"; not caught: {', '.join(survived)}" if survived else ""))

        cases_dir = os.path.join(tmp, "cases")
        _, listing, err = L.sh([sys.executable, GEN, "cases", "--out-dir", cases_dir])
        bad = []
        names = listing.split()
        for name in names:
            p = os.path.join(cases_dir, name)
            ok, why = same(cli(mine, p, "--json"), cli(REF, p, "--json"))
            if ok:
                ok, why = same(cli(mine, p, "--json", "--top", "2"), cli(REF, p, "--json", "--top", "2"))
            if not ok:
                bad.append(f"{name}: {why}")
        missing = cli(mine, os.path.join(cases_dir, "no-such-file.jsonl"))
        if missing[0] != 2 or missing[1].strip() or not missing[2].strip():
            bad.append(f"missing file: exit {missing[0]}, stdout {'empty' if not missing[1].strip() else 'not empty'}")
        n_cases = len(names) + 1
        r.check("edge-cases", bool(names) and not bad, f"{n_cases - len(bad)}/{n_cases} generated cases match the reference" + (": " + "; ".join(bad[:4]) if bad else "") if names else f"case generation failed: {err.strip()[:120]}")

        inc = os.path.join(tmp, f"incident-{variant}.jsonl")
        L.sh([sys.executable, GEN, "incident", "--variant", variant, "--out", inc])
        ok, why = same(cli(mine, inc, "--json"), cli(REF, inc, "--json"))
        r.check("incident", ok, f"incident-{variant}.jsonl: {why}")

        det_file = inc if variant == "variant-a" else os.path.join(cases_dir, "normal.jsonl")
        outs = [cli(mine, det_file, *extra, hashseed=seed) for extra in ((), ("--json",)) for seed in ("1", "2", "3")]
        text_same = outs[0] == outs[1] == outs[2]
        json_same = outs[3] == outs[4] == outs[5]
        produced = all(o[0] in (0, 1) and o[1].strip() for o in outs)
        r.check("deterministic", text_same and json_same and produced,
                f"{os.path.basename(det_file)}: text output identical across 3 hash seeds: {text_same}; --json identical: {json_same}; summaries produced: {produced}")

        small, large = os.path.join(tmp, "small.jsonl"), os.path.join(tmp, "large.jsonl")
        L.sh([sys.executable, GEN, "big", "--lines", "30000", "--out", small], timeout=120)
        L.sh([sys.executable, GEN, "big", "--lines", "300000", "--out", large], timeout=300)
        try:
            works = json.loads(cli(mine, small, "--json")[1]).get("total") == 30000
        except (ValueError, AttributeError):
            works = False
        ps, pl = (peak_kib(mine, small), peak_kib(mine, large)) if works else (None, None)
        size_mib = os.path.getsize(large) / 1048576
        grew = (pl - ps) / 1024 if ps and pl else None
        r.check("bounded-memory", grew is not None and grew < 25,
                f"peak RSS {ps} KiB for 30k rows, {pl} KiB for 300k rows ({size_mib:.0f} MiB file): grew {grew:.1f} MiB" if grew is not None else "not measured: the tool does not yet summarise a well-formed 30k-row file", critical=False)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    notes = re.sub(r"<!--.*?-->", "", L.read_text(os.path.join(EV, "L07-notes.md")) or "", flags=re.S)
    good = bool(re.search(r"O\(n\)", notes)) and bool(re.search(r"memory|RAM|stream", notes, re.I)) and len(notes) > 400
    r.check("notes", good, f"evidence/L07-notes.md: {len(notes)} chars; O(n) {'explained' if 'O(n)' in notes else 'not mentioned'}", critical=False)
    return r.finish(args.out, args.explanation, {"workspace": work, "variant_file": variant})


if __name__ == "__main__":
    sys.exit(main())
