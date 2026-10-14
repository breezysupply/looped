#!/usr/bin/env python3
"""L29 validator: runs YOUR worksheet through the shipped checker (assets/xlate.py)
against the curated claims, the scope facts and the L09 inventory, then checks
your notes.

Checks (critical unless noted):
  fixtures-intact   xlate.py, claims.json, facts.json and variants.json are the shipped versions
  worksheet-parses  work/translation.yaml reads as the YAML subset with schema looped.xlate/v1
  rows              Azure and GCP rows for all eleven concepts, each with target, difference and an
                    aws_ref that exists in L09's inventory
  scopes            the unambiguous scope facts (network, subnet, NAT, resource scope) are right
  diagrams          an Azure and a GCP diagram (Mermaid text is fine) with the required parts
  matrix            the access/network responsibility matrix covers all eight concerns, three
                    providers and both owners
  claims            every curated claim judged correctly, with a difference that names the deciding
                    fact and a source id from LX.sreSources the claim can be checked against
  phrasing          no known wrong-equivalence phrasing left in rows or matrix
  honesty           a limits statement and no claim of hands-on cloud proficiency
  notes             evidence/L29-notes.md has Fault found, Identity scopes, Network and Managed
                    Kubernetes sections with substance (advisory)
Exit 1 if any critical check fails. No cloud API is called.
"""
import hashlib
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
import labcheck as L  # noqa: E402

ASSETS = os.path.join(HERE, "assets")
WORK = os.path.join(HERE, "work")
sys.path.insert(0, ASSETS)
import xlate as X  # noqa: E402

# sha256 of the shipped checker and reference data; editing them is not a fix
SHIPPED = {
    "xlate.py": "a1c3daba6c0be3367d9e401dc02a4903d54753485ec119248240ffe7034025fe",
    "claims.json": "3801e944de4d3d0bc1925356e052459037f6f35d9d205b7e01934824fa2428f8",
    "facts.json": "34d5a45b56e0b6d160d845e9d37a4d2b5d1f8d6854c93878a862f76c368dd90f",
    "variants.json": "a5ad3754a0eda20bf0a592c6aebebfd4956f20068878bc9057115eba20899074",
}


def sha(path):
    try:
        with open(path, "rb") as fh:
            return hashlib.sha256(fh.read()).hexdigest()
    except OSError:
        return "missing"


def show(items, ok_text, n=4):
    return ok_text if not items else "; ".join(items[:n]) + (f" (+{len(items) - n} more)" if len(items) > n else "")


def main():
    args = L.standard_args("L29")
    r = L.Report("L29", "workstation")
    L.apply_args(r, args)
    variant = (L.read_text(os.path.join(WORK, ".variant")) or "").strip() or "unknown"
    if not args.variant:
        r.seed = variant

    changed = [n for n, h in SHIPPED.items() if sha(os.path.join(ASSETS, n)) != h]
    r.check("fixtures-intact", not changed, "shipped checker and reference data unchanged" if not changed else "changed: " + ", ".join(changed) + " (restore with git checkout; fix the worksheet, not the checker)")

    path = os.path.join(WORK, "translation.yaml")
    try:
        with open(path, encoding="utf-8") as fh:
            ws = X.load_yaml_subset(fh.read())
        parsed = isinstance(ws, dict) and ws.get("schema") == "looped.xlate/v1"
        why = "schema looped.xlate/v1" if parsed else "top level must be a map with schema: looped.xlate/v1"
    except (OSError, X.XlateError) as e:
        parsed, why = False, str(e)
    r.check("worksheet-parses", parsed, why)
    if not parsed:
        return r.finish(args.out, args.explanation, {"variant_file": variant})

    res = X.check(ws)
    rows = res["structure"] + res["references"]
    r.check("rows", not rows, show(rows, "22 rows (11 concepts x Azure, GCP) with targets, differences and L09 references"))
    r.check("scopes", not res["scopes"], show(res["scopes"], "network, subnet, NAT and resource-scope facts stated correctly"))
    r.check("diagrams", not res["diagrams"], show(res["diagrams"], "Azure and GCP diagrams with every required part"))
    r.check("matrix", not res["matrix"], show(res["matrix"], "8 concerns x 3 providers with provider and operator ownership"))
    n_claims = len(X.load_json("claims.json")["claims"])
    r.check("claims", not res["claims"], show(res["claims"], f"{n_claims} curated claims judged, each with the deciding difference and a register source"))
    r.check("phrasing", not res["phrasing"], show(res["phrasing"], "no known wrong-equivalence phrasing in rows or matrix", 3))
    r.check("honesty", not res["honesty"], show(res["honesty"], "limits stated; no claim of live cloud proficiency"))

    notes = L.read_text(os.path.join(HERE, "evidence", "L29-notes.md"), 100000) or ""
    tmpl = L.read_text(os.path.join(ASSETS, "notes-template.md")) or ""
    have = [s for s in ("Fault found", "Identity scopes", "Network", "Managed Kubernetes") if re.search(r"^##\s+" + s, notes, re.M | re.I)]
    r.check("notes", len(have) == 4 and len(notes) - len(tmpl) > 600, f"sections {have}, chars added {len(notes) - len(tmpl)}", critical=False)

    return r.finish(args.out, args.explanation, {"variant_file": variant})


if __name__ == "__main__":
    sys.exit(main())
