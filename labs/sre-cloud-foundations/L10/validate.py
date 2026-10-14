#!/usr/bin/env python3
"""L10 validator: runs the shipped fixtures, your predictions, your patched
exporter policy, your session and your own tests through the INCOMPLETE
evaluator in assets/iameval.py. No AWS call is made.

Checks (critical unless noted):
  fixtures-intact   the evaluator, world, guardrail, bucket/key policies and case files are the shipped versions
  predictions       work/predictions.json matches the evaluator for every case in cases/predict
  policy-supported  work/exporter-policy.json parses and uses only what the evaluator models
  ticket-policy     T1–T3 are allowed by the policy (evaluated with a fresh, valid session)
  ticket-session    T1–T3 are allowed with YOUR work/session.json (not expired; duration within MaxSessionDuration)
  probes-denied     every probe in cases/probes is denied (the out-of-endpoint read must be an explicit deny)
  no-broadening     no Allow statement uses a wildcard action, Resource "*", a whole-bucket object ARN or a key/* ARN
  own-tests         work/tests.json: 5+ cases for beacon-exporter, 2+ expect Allow, 3+ expect a deny, all pass
  notes             evidence/L10-notes.md has substance (advisory; graded by rubric)
Exit 1 if any critical check fails. Writes the evidence JSON for the app.
"""
import copy
import hashlib
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import labcheck as L  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "assets")
WORK = os.path.join(HERE, "work")
EV = os.path.join(HERE, "evidence")
os.environ["LOOPED_L10_ROOT"] = HERE
sys.path.insert(0, ASSETS)
import iameval as I  # noqa: E402

# sha256 over the shipped fixture files (sorted relative paths); a fix never edits these
FIXTURE_DIGEST = "cfd568b337f127e4854c429d267fabea4f6928f47ff6cc2a144a825dd4b2954d"
FIXTURE_FILES = ["iameval.py", "world.json", "policies", "cases"]
VALID_SESSION = {"role": "beacon-exporter", "issued": "2026-10-13T14:30:00Z", "expires": "2026-10-13T15:30:00Z"}
ARCHIVE = "arn:aws:s3:::beacon-archive-lab"


def fixture_digest():
    h = hashlib.sha256()
    files = []
    for name in FIXTURE_FILES:
        p = os.path.join(ASSETS, name)
        if os.path.isdir(p):
            for root, _, fs in os.walk(p):
                files += [os.path.join(root, f) for f in fs if not f.endswith(".pyc")]
        else:
            files.append(p)
    for f in sorted(files):
        h.update(os.path.relpath(f, ASSETS).encode())
        try:
            with open(f, "rb") as fh:
                h.update(fh.read())
        except OSError:
            h.update(b"missing")
    return h.hexdigest()


def load(path, default=None):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError) as e:
        return default if default is not None else e


def with_session(case, session):
    c = copy.deepcopy(case)
    c["request"]["session"] = session
    return c


def is_deny(d):
    return d in I.DENIES


def main():
    args = L.standard_args("L10")
    r = L.Report("L10", "workstation")
    L.apply_args(r, args)
    variant = (L.read_text(os.path.join(WORK, ".variant")) or "").strip() or "unknown"
    if not args.variant:
        r.seed = variant
    world = I.load_json(I.WORLD)

    dig = fixture_digest()
    r.check("fixtures-intact", dig == FIXTURE_DIGEST, "shipped fixtures unchanged" if dig == FIXTURE_DIGEST else "a shipped fixture changed (evaluator, world, guardrail, bucket/key policy or a case); restore it with git checkout — the fix belongs in work/")

    preds = load(os.path.join(WORK, "predictions.json"), {})
    wrong, total = [], 0
    for c in I.load_cases([os.path.join(ASSETS, "cases", "predict")]):
        total += 1
        got = I.safe_eval(c, world)["decision"]
        p = preds.get(c["id"]) if isinstance(preds, dict) else None
        said = p.get("decision") if isinstance(p, dict) else p
        if said != got:
            wrong.append(f"{c['id']} predicted {said or '-'}")
    r.check("predictions", not wrong and total == 7, f"{total - len(wrong)}/{total} predictions match the evaluator" + ("" if not wrong else "; wrong: " + ", ".join(wrong)))

    pol_path = os.path.join(WORK, "exporter-policy.json")
    pol = load(pol_path)
    supported, why = True, "parsed"
    if not isinstance(pol, dict):
        supported, why = False, f"cannot read {pol_path}: {pol}"
    else:
        try:
            n = len(I.statements(pol, "exporter-policy.json"))
            why = f"{n} statement(s), all modelled"
        except I.Unsupported as e:
            supported, why = False, f"uses something the evaluator does not model: {e}"
    r.check("policy-supported", supported, why)

    ticket = I.load_cases([os.path.join(ASSETS, "cases", "ticket")])
    res_pol = [(c["id"], I.safe_eval(with_session(c, VALID_SESSION), world)) for c in ticket]
    bad = [f"{cid}={res['decision']} ({res['trace'][-1][:90]})" for cid, res in res_pol if res["decision"] != "Allow"]
    r.check("ticket-policy", not bad and len(ticket) == 3, "T1–T3 allowed by the policy" if not bad else "; ".join(bad))

    sess = load(os.path.join(WORK, "session.json"), {})
    res_sess = [(c["id"], I.safe_eval(c, world)) for c in ticket]
    bad = [f"{cid}={res['decision']}" for cid, res in res_sess if res["decision"] != "Allow"]
    dur_ok, dur_obs = False, "no session"
    if isinstance(sess, dict) and sess.get("issued") and sess.get("expires"):
        try:
            dur = (I.ts(sess["expires"]) - I.ts(sess["issued"])).total_seconds()
            mx = world["roles"]["beacon-exporter"]["max_session_seconds"]
            dur_ok = 900 <= dur <= mx
            dur_obs = f"session {sess['issued']}..{sess['expires']} ({int(dur)}s, max {mx})"
        except ValueError as e:
            dur_obs = f"bad timestamps: {e}"
    r.check("ticket-session", not bad and dur_ok, dur_obs + ("; T1–T3 allowed with it" if not bad else "; " + ", ".join(bad)))

    probes = I.load_cases([os.path.join(ASSETS, "cases", "probes")])
    leaks = []
    for c in probes:
        d = I.safe_eval(with_session(c, VALID_SESSION), world)["decision"]
        exp = c.get("expect", "deny")
        if (exp == "deny" and not is_deny(d)) or (exp != "deny" and d != exp):
            leaks.append(f"{c['id']}={d} ({c['description']})")
    r.check("probes-denied", not leaks and len(probes) >= 10, f"{len(probes) - len(leaks)}/{len(probes)} probes denied" + ("" if not leaks else "; " + "; ".join(leaks[:4])))

    broad = []
    if isinstance(pol, dict):
        for st in I.as_list(pol.get("Statement", [])):
            if st.get("Effect") != "Allow":
                continue
            for a in I.as_list(st.get("Action", [])):
                if "*" in str(a) or "?" in str(a):
                    broad.append(f"wildcard action {a}")
            for res in I.as_list(st.get("Resource", [])):
                res = str(res)
                if res == "*" or res.startswith("arn:aws:s3:::*") or res == ARCHIVE + "/*" or re.search(r":key/\*?$|:key/\*", res) or res.endswith(":*"):
                    broad.append(f"broad resource {res}")
            if "NotAction" in st or "NotResource" in st:
                broad.append("NotAction/NotResource in an Allow")
    else:
        broad.append("policy unreadable")
    r.check("no-broadening", not broad, "every Allow names exact actions and scoped resources" if not broad else "; ".join(broad[:5]))

    tests = load(os.path.join(WORK, "tests.json"), [])
    t_ok, t_obs = False, "work/tests.json missing or not a list"
    if isinstance(tests, list):
        mism, allow_n, deny_n, other = [], 0, 0, []
        for c in tests:
            if not isinstance(c, dict) or "request" not in c:
                other.append("malformed case")
                continue
            if c["request"].get("principal") != "beacon-exporter":
                other.append(f"{c.get('id')}: principal is not beacon-exporter")
            exp = c.get("expect", "")
            allow_n += exp == "Allow"
            deny_n += exp in ("deny",) + I.DENIES
            d = I.safe_eval(c, world)["decision"]
            if not (d == exp or (exp == "deny" and is_deny(d))):
                mism.append(f"{c.get('id')}: expected {exp or '-'} got {d}")
        t_ok = len(tests) >= 5 and allow_n >= 2 and deny_n >= 3 and not mism and not other
        t_obs = f"{len(tests)} cases ({allow_n} allow, {deny_n} deny)" + ("; " + "; ".join((mism + other)[:4]) if (mism or other) else "; all pass")
    r.check("own-tests", t_ok, t_obs)

    notes = L.read_text(os.path.join(EV, "L10-notes.md")) or ""
    body = re.sub(r"^#.*$|^>.*$", "", notes, flags=re.M).strip()
    r.check("notes", len(body) >= 300, f"{len(body)} chars of your own notes", critical=False)

    return r.finish(args.out, args.explanation or notes[:4000], {"variant_file": variant, "evaluator": "iameval (incomplete IAM model)"})


if __name__ == "__main__":
    sys.exit(main())
