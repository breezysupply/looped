#!/usr/bin/env python3
"""L09 validator: runs YOUR inventory through the shipped checker and the
customer constraints, then checks the analysis you wrote.

Checks (critical unless noted):
  fixtures-intact     archcheck.py, prices.json and customer-needs.md are the shipped versions
  inventory-parses    work/inventory.json loads and matches schema looped.archinv/v1
  all-scenarios       every component serves at baseline and with each AZ unavailable
  hygiene             no exposure / identity findings from the checker
  constraints         C-1 API tier has no default route; C-2 worker NAT in the same AZ; only the LB is public
  spof-stated         every single point of failure the checker computes is listed in failure_analysis,
                      each with a mitigation or an accepted_because (20+ chars); az_loss explained
  cost                network_fixed_monthly_usd within 15% of the model; model <= USD 200 (B-1);
                      monthly_estimate_usd, drivers (NAT, endpoints) and assumptions present
  recovery            RPO <= 15, RTO <= 60, database PITR on with >= 7 days retention, backup,
                      restore procedure and region-loss statement written
  explanation         evidence/L09-explanation.md has Request path, Identity, Failure domains and
                      Fault found sections with substance (content is rubric-graded, not by this script)
Exit 1 if any check fails. Writes the evidence JSON for the app. Never calls AWS.
"""
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
sys.path.insert(0, ASSETS)
import archcheck as A  # noqa: E402

# sha256 of the shipped fixtures; editing the checker or the prices is not a fix
SHIPPED = {
    "archcheck.py": "716a92a38449b0d72d6b31e2439a53ab4c1a52427a81efb5517998cdc343a416",
    "prices.json": "84956bb3b16824338802b6efd5b7d20bbed4283772ff057fee3d6de19bc49e6a",
    "customer-needs.md": "bee51a65d5c537deee6137bef6ab512e29730a8155a22d45a885f2b9b17b829e",
}
BUDGET_NETWORK_FIXED = 200.0


def sha(path):
    try:
        with open(path, "rb") as fh:
            return hashlib.sha256(fh.read()).hexdigest()
    except OSError:
        return "missing"


def text(v, n):
    return isinstance(v, str) and len(v.strip()) >= n


def num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def main():
    args = L.standard_args("L09")
    r = L.Report("L09", "workstation")
    L.apply_args(r, args)
    variant = (L.read_text(os.path.join(WORK, ".variant")) or "").strip() or "unknown"
    if not args.variant:
        r.seed = variant

    changed = [n for n, h in SHIPPED.items() if sha(os.path.join(ASSETS, n)) != h]
    r.check("fixtures-intact", not changed, "shipped fixtures unchanged" if not changed else "changed: " + ", ".join(changed) + " (restore with git checkout; fix the inventory, not the model)")

    path = os.path.join(WORK, "inventory.json")
    try:
        inv = A.load(path)
    except A.InventoryError as e:
        r.check("inventory-parses", False, str(e))
        return r.finish(args.out, args.explanation, {"variant_file": variant})
    r.check("inventory-parses", True, f"{len(inv['subnets'])} subnets, {len(inv['components'])} components, {len(inv['endpoints'])} endpoints")

    results = [A.run_scenario(inv, n) for n in A.scenarios(inv)]
    down = [f"{res['scenario']}: {cid}" for res in results for cid, v in res["components"].items() if not v["serving"]]
    r.check("all-scenarios", not down, "every component serves in " + ", ".join(x["scenario"] for x in results) if not down else "not serving -> " + "; ".join(down[:6]))

    findings = A.hygiene(inv)
    r.check("hygiene", not findings, "no exposure or identity findings" if not findings else "; ".join(findings[:4]))

    m = A.Model(inv)
    problems = []
    comps = {c["id"]: c for c in inv["components"]}
    for cid in ("alb", "api", "worker", "db"):
        if cid not in comps:
            problems.append(f"component {cid} missing")
    if "api" in comps:
        for sn in comps["api"]["subnets"]:
            if m.default_target(sn):
                problems.append(f"C-1: api subnet {sn} has a 0.0.0.0/0 route ({m.default_target(sn)})")
    if "worker" in comps:
        for sn in comps["worker"]["subnets"]:
            t = m.default_target(sn)
            g = m.gws.get(t or "", {})
            if g.get("type") == "nat" and m.subnets[g["subnet"]]["az"] != m.subnets[sn]["az"]:
                problems.append(f"C-2: worker subnet {sn} ({m.subnets[sn]['az']}) uses {t} in {m.subnets[g['subnet']]['az']}")
            if g.get("type") == "internet":
                problems.append(f"C-2: worker subnet {sn} routes straight to the internet gateway")
    publics = [c["id"] for c in inv["components"] if c.get("public")]
    if publics and publics != ["alb"]:
        problems.append(f"only the load balancer may be public, found {publics}")
    r.check("constraints", not problems, "C-1, C-2 and public-exposure constraints hold" if not problems else "; ".join(problems[:4]))

    fa = inv.get("failure_analysis") or {}
    stated = {s.get("id"): s for s in fa.get("single_points_of_failure", []) if isinstance(s, dict)}
    computed = A.computed_spofs(inv)
    missing = [s["id"] for s in computed if s["id"] not in stated]
    thin = [sid for sid, s in stated.items() if not (text(s.get("mitigation"), 20) or text(s.get("accepted_because"), 20))]
    ok_spof = not missing and not thin and text(fa.get("az_loss"), 40)
    obs = f"computed {[s['id'] for s in computed]}; stated {sorted(k for k in stated if k)}"
    if missing:
        obs += f"; not stated: {missing}"
    if thin:
        obs += f"; no mitigation/accepted_because: {thin}"
    if not text(fa.get("az_loss"), 40):
        obs += "; az_loss needs 40+ chars"
    r.check("spof-stated", ok_spof, obs)

    with open(os.path.join(ASSETS, "prices.json"), "r", encoding="utf-8") as fh:
        model = A.cost_model(inv, json.load(fh))
    cost = inv.get("cost") or {}
    stated_fixed = cost.get("network_fixed_monthly_usd")
    drivers = " ".join(str(d) for d in cost.get("drivers", [])).lower()
    cost_problems = []
    if not num(stated_fixed):
        cost_problems.append("network_fixed_monthly_usd is not a number")
    elif abs(stated_fixed - model["network_fixed_monthly"]) > 0.15 * model["network_fixed_monthly"]:
        cost_problems.append(f"stated {stated_fixed} vs model {model['network_fixed_monthly']} (more than 15% apart)")
    if model["network_fixed_monthly"] > BUDGET_NETWORK_FIXED:
        cost_problems.append(f"model {model['network_fixed_monthly']} exceeds the B-1 budget of {BUDGET_NETWORK_FIXED}")
    if not num(cost.get("monthly_estimate_usd")) or (num(stated_fixed) and cost["monthly_estimate_usd"] < stated_fixed):
        cost_problems.append("monthly_estimate_usd missing or below the fixed network cost")
    if "nat" not in drivers or "endpoint" not in drivers:
        cost_problems.append("drivers should name NAT gateways and interface endpoints")
    if not text(cost.get("assumptions"), 40):
        cost_problems.append("assumptions needs 40+ chars (what is excluded?)")
    r.check("cost", not cost_problems, (f"model {model['network_fixed_monthly']} USD/month, stated {stated_fixed}" if not cost_problems else "; ".join(cost_problems)))

    rec = inv.get("recovery") or {}
    db = comps.get("db", {})
    rec_problems = []
    if not (num(rec.get("rpo_minutes")) and 0 < rec["rpo_minutes"] <= 15):
        rec_problems.append(f"rpo_minutes {rec.get('rpo_minutes')!r} (R-2: <= 15)")
    if not (num(rec.get("rto_minutes")) and 0 < rec["rto_minutes"] <= 60):
        rec_problems.append(f"rto_minutes {rec.get('rto_minutes')!r} (R-2: <= 60)")
    if not db.get("pitr") or not (num(db.get("backup_retention_days")) and db["backup_retention_days"] >= 7):
        rec_problems.append("db needs pitr true and backup_retention_days >= 7 to support the RPO")
    for k, n in (("backup", 40), ("restore_procedure", 40), ("region_loss", 30)):
        if not text(rec.get(k), n):
            rec_problems.append(f"recovery.{k} needs {n}+ chars")
    r.check("recovery", not rec_problems, (f"RPO {rec.get('rpo_minutes')} min, RTO {rec.get('rto_minutes')} min, PITR on" if not rec_problems else "; ".join(rec_problems)))

    ex = L.read_text(os.path.join(EV, "L09-explanation.md")) or ""
    heads = {h: bool(re.search(r"^#+\s*" + h, ex, re.I | re.M)) for h in ("Request path", "Identity", "Failure domains", "Fault found")}
    body = re.sub(r"^#.*$|^>.*$", "", ex, flags=re.M)
    r.check("explanation", all(heads.values()) and len(body.strip()) >= 600, f"sections={heads} chars={len(body.strip())}")

    return r.finish(args.out, args.explanation or ex[:4000], {"variant_file": variant, "network_fixed_model_usd": model["network_fixed_monthly"]})


if __name__ == "__main__":
    sys.exit(main())
