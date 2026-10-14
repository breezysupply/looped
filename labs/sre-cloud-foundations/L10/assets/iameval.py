#!/usr/bin/env python3
"""iameval — an INCOMPLETE IAM request evaluator for the L10 fixtures.

*** This is a teaching model, not AWS IAM. It is deliberately small and it
*** says "Unsupported" rather than guessing. Never use it to approve a real
*** policy; use the IAM policy simulator or Access Analyzer in a sandbox.

What it models (single account 111122223333, one region):
  - authentication first: a role session past its expiry is rejected with
    ExpiredToken before any policy is read
  - identity policies attached to the role (see world.json)
  - a resource-based policy for S3 buckets (applies to the bucket ARN and
    its objects) and a key policy for KMS keys
  - the decision order: any explicit Deny wins; otherwise an Allow is
    needed; otherwise implicit deny
  - KMS: the key policy must allow, either naming the role directly or by
    delegating to the account (Principal arn:aws:iam::<acct>:root), and in
    the delegated case an identity policy must also allow
  - same-account S3: an Allow in EITHER the identity policy or the bucket
    policy (naming the role) is enough
  - Action matching is case-insensitive with * and ?; Resource matching is
    case-sensitive with * and ?
  - Condition operators: StringEquals, StringNotEquals, StringLike,
    StringNotLike, DateLessThan, DateGreaterThan, Bool. A key missing from
    the request context makes a positive operator false and a negated
    operator true (as in IAM), so watch StringNotEquals.

What it does NOT model (returns Unsupported, exit 3): NotAction,
NotResource, NotPrincipal, ForAnyValue/ForAllValues, ...IfExists, policy
variables like ${aws:username}, any other operator. Also silently out of
scope: SCPs/RCPs, permission boundaries, session policies, cross-account
access, ACLs, VPC endpoint policies, KMS grants, service-specific
authorisation and every global key it is not given in the case context.

Usage:
  iameval.py eval CASE.json [--explain]          one request
  iameval.py run FILE_OR_DIR... [--explain]      many; compares "expect" when present
                                                 ("deny" accepts any of ExplicitDeny, ImplicitDeny, ExpiredToken)
  iameval.py assume ROLE --at TIME --duration SECONDS --out FILE   write a fixture session
Paths inside cases and world.json are relative to the lab directory (the
parent of assets/), or set LOOPED_L10_ROOT.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
from typing import Any, Dict, List, Optional, Tuple

ROOT = os.environ.get("LOOPED_L10_ROOT") or os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
WORLD = os.path.join(os.path.dirname(os.path.abspath(__file__)), "world.json")
DECISIONS = ("Allow", "ExplicitDeny", "ImplicitDeny", "ExpiredToken", "Unsupported")
DENIES = ("ExplicitDeny", "ImplicitDeny", "ExpiredToken")
OPERATORS = ("StringEquals", "StringNotEquals", "StringLike", "StringNotLike", "DateLessThan", "DateGreaterThan", "Bool")


class Unsupported(Exception):
    pass


def _path(p: str) -> str:
    return p if os.path.isabs(p) else os.path.join(ROOT, p)


def load_json(p: str) -> Any:
    with open(_path(p), "r", encoding="utf-8") as fh:
        return json.load(fh)


def ts(s: str) -> dt.datetime:
    s = s.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    t = dt.datetime.fromisoformat(s)
    if t.tzinfo is None:
        raise ValueError(f"timestamp without timezone: {s}")
    return t


def as_list(v: Any) -> List[Any]:
    return v if isinstance(v, list) else [v]


def wild(pattern: str, value: str, case: bool) -> bool:
    if not case:
        pattern, value = pattern.lower(), value.lower()
    rx = "^" + "".join(".*" if ch == "*" else "." if ch == "?" else re.escape(ch) for ch in pattern) + "$"
    return re.match(rx, value, re.S) is not None


def check_supported(st: Dict[str, Any], where: str) -> None:
    for k in ("NotAction", "NotResource", "NotPrincipal"):
        if k in st:
            raise Unsupported(f"{where}: {k} is not modelled")
    for op, block in (st.get("Condition") or {}).items():
        if op.startswith("ForAnyValue:") or op.startswith("ForAllValues:") or op.endswith("IfExists"):
            raise Unsupported(f"{where}: condition operator {op} is not modelled")
        if op not in OPERATORS:
            raise Unsupported(f"{where}: condition operator {op} is not modelled")
        if not isinstance(block, dict):
            raise Unsupported(f"{where}: malformed condition block for {op}")
    blob = json.dumps(st)
    if "${" in blob:
        raise Unsupported(f"{where}: policy variables are not modelled")


def cond_ok(cond: Dict[str, Any], ctx: Dict[str, Any]) -> Tuple[bool, str]:
    for op, block in (cond or {}).items():
        for key, want in block.items():
            wants = [str(w) for w in as_list(want)]
            have = ctx.get(key)
            if have is None:
                if op in ("StringNotEquals", "StringNotLike"):
                    continue  # negated operator, key absent: true (IAM semantics)
                return False, f"{op} {key}: key absent from request context"
            have_s = str(have)
            if op == "StringEquals":
                ok = have_s in wants
            elif op == "StringNotEquals":
                ok = have_s not in wants
            elif op == "StringLike":
                ok = any(wild(w, have_s, True) for w in wants)
            elif op == "StringNotLike":
                ok = not any(wild(w, have_s, True) for w in wants)
            elif op == "Bool":
                ok = have_s.lower() in [w.lower() for w in wants]
            elif op in ("DateLessThan", "DateGreaterThan"):
                t = ts(have_s)
                ok = any((t < ts(w)) if op == "DateLessThan" else (t > ts(w)) for w in wants)
            else:  # pragma: no cover - guarded by check_supported
                raise Unsupported(op)
            if not ok:
                return False, f"{op} {key}={have_s} vs {wants}"
    return True, ""


def principal_ok(st: Dict[str, Any], role_arn: str) -> bool:
    p = st.get("Principal")
    if p == "*":
        return True
    if isinstance(p, dict):
        return any(wild(a, role_arn, True) for a in as_list(p.get("AWS", [])))
    return False


def matches(st: Dict[str, Any], action: str, resource: str, ctx: Dict[str, Any], role_arn: Optional[str]) -> Tuple[bool, str]:
    if not any(wild(a, action, False) for a in as_list(st.get("Action", []))):
        return False, "action"
    if not any(wild(r, resource, True) for r in as_list(st.get("Resource", []))):
        return False, "resource"
    if role_arn is not None and not principal_ok(st, role_arn):
        return False, "principal"
    ok, why = cond_ok(st.get("Condition") or {}, ctx)
    return (ok, why or "matched") if ok else (False, "condition: " + why)


def statements(policy: Dict[str, Any], label: str) -> List[Tuple[str, Dict[str, Any]]]:
    out = []
    for i, st in enumerate(as_list(policy.get("Statement", []))):
        where = f"{label}#{st.get('Sid', i)}"
        check_supported(st, where)
        if st.get("Effect") not in ("Allow", "Deny"):
            raise Unsupported(f"{where}: Effect must be Allow or Deny")
        out.append((where, st))
    return out


def evaluate(case: Dict[str, Any], world: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    world = world or load_json(WORLD)
    req = case["request"]
    role_name = req["principal"]
    role = world["roles"].get(role_name)
    trace: List[str] = []
    if not role:
        return {"decision": "ImplicitDeny", "trace": [f"unknown principal {role_name}"]}
    ctx = dict(req.get("context", {}))
    now = ts(ctx["aws:CurrentTime"])
    sess = req.get("session")
    if isinstance(sess, str):
        try:
            sess = load_json(sess)
        except FileNotFoundError:
            return {"decision": "ExpiredToken", "trace": [f"no session file {req['session']}: no credentials"]}
    if sess:
        if sess.get("role") not in (None, role_name):
            return {"decision": "ImplicitDeny", "trace": [f"session belongs to {sess.get('role')}, not {role_name}"]}
        if now >= ts(sess["expires"]):
            return {"decision": "ExpiredToken", "trace": [f"session expired at {sess['expires']}; request at {ctx['aws:CurrentTime']} (authentication fails before any policy is evaluated)"]}
        if now < ts(sess["issued"]):
            return {"decision": "ExpiredToken", "trace": [f"session issued at {sess['issued']} is not valid yet at {ctx['aws:CurrentTime']}"]}
        trace.append(f"session valid until {sess['expires']}")
    action, resource = req["action"], req["resource"]
    role_arn = role["arn"]

    ident: List[Tuple[str, Dict[str, Any]]] = []
    for p in role.get("policies", []):
        try:
            ident += statements(load_json(p), os.path.basename(p))
        except FileNotFoundError:
            trace.append(f"policy file {p} missing (treated as no statements)")
    res_stmts: List[Tuple[str, Dict[str, Any]]] = []
    service = action.split(":", 1)[0].lower()
    res_kind = ""
    if service == "s3":
        bucket = "arn:aws:s3:::" + resource[len("arn:aws:s3:::"):].split("/", 1)[0]
        bp = world.get("bucket_policies", {}).get(bucket)
        if bp:
            res_stmts = statements(load_json(bp), os.path.basename(bp))
            res_kind = "bucket policy"
    elif service == "kms":
        kp = world.get("key_policies", {}).get(resource)
        if not kp:
            return {"decision": "ImplicitDeny", "trace": trace + [f"no key policy for {resource}: unknown key"]}
        res_stmts = statements(load_json(kp), os.path.basename(kp))
        res_kind = "key policy"

    def scan(stmts: List[Tuple[str, Dict[str, Any]]], effect: str, with_principal: bool) -> List[str]:
        hits = []
        for where, st in stmts:
            if st["Effect"] != effect:
                continue
            ok, why = matches(st, action, resource, ctx, role_arn if with_principal else None)
            if ok:
                hits.append(where)
            elif why.startswith("condition"):
                trace.append(f"{where} ({effect}) not applied: {why}")
        return hits

    denies = scan(ident, "Deny", False) + scan(res_stmts, "Deny", True)
    if denies:
        return {"decision": "ExplicitDeny", "trace": trace + [f"explicit Deny in {', '.join(denies)} — an Allow anywhere cannot override it"]}
    ident_allow = scan(ident, "Allow", False)
    if service == "kms":
        direct = scan(res_stmts, "Allow", True)
        account_root = f"arn:aws:iam::{world['account']}:root"
        delegated = []
        for where, st in res_stmts:
            if st["Effect"] == "Allow" and isinstance(st.get("Principal"), dict) and account_root in as_list(st["Principal"].get("AWS", [])):
                ok, _ = matches(dict(st, Principal={"AWS": "*"}), action, resource, ctx, role_arn)
                if ok:
                    delegated.append(where)
        if direct:
            return {"decision": "Allow", "trace": trace + [f"key policy names the role directly: {', '.join(direct)}"]}
        if delegated and ident_allow:
            return {"decision": "Allow", "trace": trace + [f"key policy delegates to the account ({', '.join(delegated)}) and identity policy allows ({', '.join(ident_allow)})"]}
        if delegated:
            return {"decision": "ImplicitDeny", "trace": trace + ["key policy delegates to IAM, but no identity policy allows this action on this key"]}
        why = "key policy neither names the role nor delegates to the account"
        if ident_allow:
            why += f" (identity policy {', '.join(ident_allow)} allows, which is not enough for KMS)"
        return {"decision": "ImplicitDeny", "trace": trace + [why]}
    res_allow = scan(res_stmts, "Allow", True)
    if ident_allow or res_allow:
        src = [f"identity: {', '.join(ident_allow)}"] if ident_allow else []
        src += [f"{res_kind}: {', '.join(res_allow)}"] if res_allow else []
        return {"decision": "Allow", "trace": trace + ["allowed by " + "; ".join(src)]}
    return {"decision": "ImplicitDeny", "trace": trace + [f"no statement allows {action} on {resource} (implicit deny)"]}


def safe_eval(case: Dict[str, Any], world: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    try:
        return evaluate(case, world)
    except Unsupported as e:
        return {"decision": "Unsupported", "trace": [f"not modelled: {e}"]}
    except (KeyError, ValueError, TypeError) as e:
        return {"decision": "Unsupported", "trace": [f"malformed case or policy: {e!r}"]}


def load_cases(paths: List[str]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for p in paths:
        p = os.path.abspath(p) if os.path.exists(p) else _path(p)
        files = sorted(os.path.join(p, f) for f in os.listdir(p) if f.endswith(".json")) if os.path.isdir(p) else [p]
        for f in files:
            data = load_json(f)
            for c in (data if isinstance(data, list) else [data]):
                c.setdefault("id", os.path.basename(f))
                out.append(c)
    return out


def cmd_assume(a: argparse.Namespace) -> int:
    world = load_json(WORLD)
    role = world["roles"].get(a.role)
    if not role:
        print(f"no such role {a.role}", file=sys.stderr)
        return 2
    mx = int(role.get("max_session_seconds", 3600))
    if not (900 <= a.duration <= mx):
        print(f"DurationSeconds {a.duration} is outside 900..{mx} for {a.role} (fixture MaxSessionDuration)", file=sys.stderr)
        return 2
    issued = ts(a.at)
    sess = {"role": a.role, "issued": issued.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "expires": (issued + dt.timedelta(seconds=a.duration)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "source": "iameval assume (fixture; no STS call was made)",
            "credentials": "lab-session-not-a-real-secret"}
    with open(os.path.abspath(a.out), "w", encoding="utf-8") as fh:
        json.dump(sess, fh, indent=2)
        fh.write("\n")
    print(f"wrote {a.out}: {a.role} valid {sess['issued']} .. {sess['expires']}")
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(description="INCOMPLETE IAM evaluator for L10 fixtures (teaching model, not AWS)")
    sub = p.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("eval")
    e.add_argument("case")
    e.add_argument("--explain", action="store_true")
    r = sub.add_parser("run")
    r.add_argument("paths", nargs="+")
    r.add_argument("--explain", action="store_true")
    s = sub.add_parser("assume")
    s.add_argument("role")
    s.add_argument("--at", required=True, help="issue time, e.g. 2026-10-13T14:55:00Z")
    s.add_argument("--duration", type=int, default=3600)
    s.add_argument("--out", required=True)
    a = p.parse_args(argv)
    if a.cmd == "assume":
        return cmd_assume(a)
    cases = load_cases([a.case] if a.cmd == "eval" else a.paths)
    bad = unsupported = 0
    for c in cases:
        res = safe_eval(c)
        exp = c.get("expect")
        mark = ""
        if exp:
            hit = res["decision"] == exp or (exp == "deny" and res["decision"] in DENIES)
            bad += 0 if hit else 1
            mark = "  [expected " + exp + (": ok]" if hit else ": MISMATCH]")
        unsupported += res["decision"] == "Unsupported"
        rq = c["request"]
        print(f"{c['id']}: {res['decision']}{mark}  ({rq['principal']} {rq['action']} {rq['resource']})")
        if a.explain or res["decision"] == "Unsupported":
            for t in res["trace"]:
                print("    " + t)
    if unsupported:
        return 3
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
