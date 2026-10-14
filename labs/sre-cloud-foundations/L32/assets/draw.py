#!/usr/bin/env python3
"""draw.py — the seeded fault draw for the L32 final assessment.

    python3 draw.py --seed SEED --out report/draw.json     draw and record (refuses to overwrite)
    python3 draw.py --check report/draw.json                recompute from the recorded seed and
                                                            exclusions; exit 1 if it differs

Draws, from assets/catalogue.json:
  - two single faults, from two different domains and labs, that you have NOT seen: every
    (lab, variant) recorded as the seed of any evidence file under labs/sre-cloud-foundations/
    LNN/evidence/ at draw time is excluded (the exclusion list is written into the draw so it
    can be re-checked later, after new evidence exists);
  - one bounded two-fault incident on your L31 rebuild, which always includes a data/recovery
    decision.
The same seed and exclusions always give the same draw (random.Random seeded with a string).
The draw names lab and variant (you need them to start each fault), not the root cause.
"""
from __future__ import annotations

import argparse
import glob
import hashlib
import json
import os
import random
import re
import sys
import time
from typing import Any, Dict, List

HERE = os.path.dirname(os.path.abspath(__file__))
SRE = os.path.abspath(os.path.join(HERE, "..", ".."))
CATALOGUE = os.path.join(HERE, "catalogue.json")


def load_catalogue() -> Dict[str, Any]:
    with open(CATALOGUE, encoding="utf-8") as fh:
        return json.load(fh)


def catalogue_sha() -> str:
    with open(CATALOGUE, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def seen_variants() -> List[str]:
    """'Lnn:variant-x' for every evidence file the learner has for labs L01–L31."""
    seen = set()
    for path in glob.glob(os.path.join(SRE, "L[0-3][0-9]", "evidence", "*.json")):
        lab = os.path.basename(os.path.dirname(os.path.dirname(path)))
        if lab == "L32":
            continue
        try:
            with open(path, encoding="utf-8") as fh:
                doc = json.load(fh)
        except (OSError, ValueError):
            continue
        seed = str(doc.get("seed", ""))
        if doc.get("activityId") == lab and re.fullmatch(r"variant-[a-z]", seed):
            seen.add(f"{lab}:{seed}")
    return sorted(seen)


def draw(seed: str, excluded: List[str]) -> Dict[str, Any]:
    cat = load_catalogue()
    rng = random.Random("looped-l32:" + seed)
    pool = sorted((s for s in cat["singles"] if f"{s['lab']}:{s['variant']}" not in set(excluded)), key=lambda s: s["id"])
    if not pool:
        raise SystemExit("no unseen single fault left in the catalogue")
    first = rng.choice(pool)
    rest = [s for s in pool if s["domain"] != first["domain"] and s["lab"] != first["lab"]]
    if not rest:
        raise SystemExit("no unseen fault in a second domain; ask a mentor for a hand-picked fault")
    second = rng.choice(rest)
    incident = rng.choice(sorted(cat["combined"], key=lambda c: c["id"]))
    return {"singles": [first["id"], second["id"]], "incident": incident["id"]}


def main(argv: List[str]) -> int:
    p = argparse.ArgumentParser(prog="draw.py")
    p.add_argument("--seed")
    p.add_argument("--out")
    p.add_argument("--check")
    a = p.parse_args(argv)
    if a.check:
        with open(a.check, encoding="utf-8") as fh:
            rec = json.load(fh)
        again = draw(str(rec.get("seed", "")), rec.get("excluded", []))
        same = again["singles"] == rec.get("singles") and again["incident"] == rec.get("incident")
        sha_ok = rec.get("catalogue_sha256") == catalogue_sha()
        print(f"{'REPRODUCED' if same and sha_ok else 'DIFFERENT'}: seed {rec.get('seed')!r} -> {again}; recorded {rec.get('singles')} {rec.get('incident')}; catalogue {'unchanged' if sha_ok else 'CHANGED'}")
        return 0 if same and sha_ok else 1
    if not a.seed or not re.fullmatch(r"[A-Za-z0-9._-]{4,64}", a.seed):
        p.error("--seed is required: 4-64 characters of [A-Za-z0-9._-]")
    excluded = seen_variants()
    res = draw(a.seed, excluded)
    cat = {s["id"]: s for s in load_catalogue()["singles"]}
    rec = {"seed": a.seed, "drawn_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "catalogue_sha256": catalogue_sha(),
           "excluded": excluded, "singles": res["singles"], "incident": res["incident"],
           "single_details": [{k: cat[i][k] for k in ("id", "lab", "variant", "domain", "profile", "area", "start", "validate", "teardown")} for i in res["singles"]]}
    if a.out:
        if os.path.exists(a.out):
            print(f"{a.out} exists: a draw is recorded once. Delete it only if a mentor agrees to a redraw.", file=sys.stderr)
            return 1
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        with open(a.out, "w", encoding="utf-8") as fh:
            json.dump(rec, fh, indent=2)
            fh.write("\n")
    print(json.dumps({k: rec[k] for k in ("seed", "singles", "incident")}))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
