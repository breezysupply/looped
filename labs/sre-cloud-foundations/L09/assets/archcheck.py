#!/usr/bin/env python3
"""archcheck — evaluate a Beacon architecture inventory (L09) WITHOUT any cloud.

This is a teaching model, not AWS. It reads a JSON inventory (VPC, subnets,
route tables, gateways, VPC endpoints, components, IAM roles, failure
analysis, cost, recovery) and answers four questions:

  1. reachability  — from each subnet a component runs in, can it reach every
                     service it needs (an AWS service through a gateway or
                     interface endpoint, through a NAT gateway or an internet
                     gateway; another component; an external internet API)?
  2. failure domains — does every component still serve when one Availability
                     Zone is unavailable?
  3. single points of failure — which single resource, if it failed alone,
                     takes a component down? (the region and every external
                     dependency always count; two AZs do not fix those)
  4. hygiene       — private tiers routed to an internet gateway, public
                     compute, wildcard IAM, missing roles.

What the model deliberately ignores (so you never mistake it for AWS):
security groups and NACLs, DNS resolution details beyond "private DNS on an
interface endpoint", endpoint policies, quotas, data-processing charges,
partial AZ impairment, control-plane versus data-plane differences, and the
real behaviour of ECS/RDS failover timing. `ecr` is modelled as needing
ecr.api + ecr.dkr + s3 (image layers live in S3), which is true of ECR.

Standard library only. Exit codes: 0 every scenario serves and no findings,
1 something fails, 2 the inventory is malformed.

    python3 archcheck.py work/inventory.json                 # all scenarios
    python3 archcheck.py work/inventory.json --scenario az-down:us-west-2a
    python3 archcheck.py work/inventory.json --explain api   # why a component fails
    python3 archcheck.py work/inventory.json --spof          # computed SPOFs
    python3 archcheck.py work/inventory.json --cost prices.json
    python3 archcheck.py work/inventory.json --json          # machine-readable
"""
from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Dict, List, Optional, Set, Tuple

SCHEMA = "looped.archinv/v1"
# A need on the left expands to the services on the right.
COMPOUND = {"ecr": ["ecr.api", "ecr.dkr", "s3"]}
AWS_SERVICES = {"s3", "dynamodb", "ecr.api", "ecr.dkr", "logs", "secretsmanager", "kms", "sts", "ssm", "sqs"}
GATEWAY_CAPABLE = {"s3", "dynamodb"}
TRUST = {"container_service": "ecs-tasks.amazonaws.com", "function": "lambda.amazonaws.com", "instance": "ec2.amazonaws.com"}
RESOURCE_STAR_OK = {"ecr:GetAuthorizationToken"}


class InventoryError(Exception):
    pass


def load(path: str) -> Dict[str, Any]:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            inv = json.load(fh)
    except FileNotFoundError:
        raise InventoryError(f"{path}: no such file")
    except json.JSONDecodeError as e:
        raise InventoryError(f"{path}:{e.lineno}:{e.colno}: {e.msg}")
    check_schema(inv)
    return inv


def _ids(items: List[Dict[str, Any]], what: str) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    for it in items:
        if not isinstance(it, dict) or not isinstance(it.get("id"), str):
            raise InventoryError(f"every {what} needs a string id: {it!r}")
        if it["id"] in out:
            raise InventoryError(f"duplicate {what} id {it['id']}")
        out[it["id"]] = it
    return out


def check_schema(inv: Dict[str, Any]) -> None:
    if not isinstance(inv, dict) or inv.get("schema") != SCHEMA:
        raise InventoryError(f"schema must be {SCHEMA!r}")
    for key in ("azs", "subnets", "route_tables", "gateways", "endpoints", "components"):
        if not isinstance(inv.get(key), list):
            raise InventoryError(f"'{key}' must be a list")
    azs = set(inv["azs"])
    subnets = _ids(inv["subnets"], "subnet")
    rts = _ids(inv["route_tables"], "route table")
    gws = _ids(inv["gateways"], "gateway")
    eps = _ids(inv["endpoints"], "endpoint")
    comps = _ids(inv["components"], "component")
    _ids(inv.get("external", []), "external dependency")
    _ids(inv.get("iam_roles", []), "IAM role")
    for s in subnets.values():
        if s.get("az") not in azs:
            raise InventoryError(f"subnet {s['id']} is in {s.get('az')!r}, not one of {sorted(azs)}")
        if s.get("route_table") not in rts:
            raise InventoryError(f"subnet {s['id']} uses unknown route table {s.get('route_table')!r}")
    for rt in rts.values():
        for r in rt.get("routes", []):
            t = r.get("target", "")
            if t != "local" and t not in gws:
                raise InventoryError(f"route table {rt['id']}: route to unknown target {t!r}")
    for g in gws.values():
        if g.get("type") not in ("internet", "nat"):
            raise InventoryError(f"gateway {g['id']}: type must be internet or nat")
        if g["type"] == "nat" and g.get("subnet") not in subnets:
            raise InventoryError(f"NAT gateway {g['id']} needs a subnet that exists")
    for e in eps.values():
        if e.get("service") not in AWS_SERVICES:
            raise InventoryError(f"endpoint {e['id']}: unknown service {e.get('service')!r}")
        if e.get("type") == "gateway":
            if e["service"] not in GATEWAY_CAPABLE:
                raise InventoryError(f"endpoint {e['id']}: {e['service']} has no gateway endpoint (interface only)")
            for rt in e.get("route_tables", []):
                if rt not in rts:
                    raise InventoryError(f"endpoint {e['id']}: unknown route table {rt}")
        elif e.get("type") == "interface":
            for sn in e.get("subnets", []):
                if sn not in subnets:
                    raise InventoryError(f"endpoint {e['id']}: unknown subnet {sn}")
        else:
            raise InventoryError(f"endpoint {e['id']}: type must be gateway or interface")
    for c in comps.values():
        if not c.get("subnets"):
            raise InventoryError(f"component {c['id']} has no subnets")
        for sn in c["subnets"]:
            if sn not in subnets:
                raise InventoryError(f"component {c['id']}: unknown subnet {sn}")


class Model:
    def __init__(self, inv: Dict[str, Any], down_azs: Set[str] = frozenset(), failed: Set[str] = frozenset()) -> None:
        self.inv = inv
        self.down = set(down_azs)
        self.failed = set(failed)  # resource ids failed individually (NAT, endpoint, component, external)
        self.subnets = {s["id"]: s for s in inv["subnets"]}
        self.rts = {r["id"]: r for r in inv["route_tables"]}
        self.gws = {g["id"]: g for g in inv["gateways"]}
        self.eps = [e for e in inv["endpoints"] if e["id"] not in self.failed]
        self.comps = {c["id"]: c for c in inv["components"]}
        self.ext = {x["id"]: x for x in inv.get("external", [])}
        self._serving: Dict[str, Tuple[bool, List[str]]] = {}
        self._visiting: Set[str] = set()

    # ── paths ──────────────────────────────────────────────────────────
    def default_target(self, subnet_id: str) -> Optional[str]:
        rt = self.rts[self.subnets[subnet_id]["route_table"]]
        for r in rt.get("routes", []):
            if r.get("destination") == "0.0.0.0/0":
                return r.get("target")
        return None

    def internet_from(self, subnet_id: str) -> Tuple[bool, str]:
        t = self.default_target(subnet_id)
        if t is None:
            return False, f"{subnet_id}: route table {self.subnets[subnet_id]['route_table']} has no 0.0.0.0/0 route"
        if t in self.failed:
            return False, f"{subnet_id}: default route target {t} has failed"
        g = self.gws[t]
        if g["type"] == "internet":
            return True, f"{subnet_id} -> {t} (internet gateway)"
        nat_subnet = g["subnet"]
        nat_az = self.subnets[nat_subnet]["az"]
        if nat_az in self.down:
            return False, f"{subnet_id} -> {t} in {nat_az}, which is unavailable"
        t2 = self.default_target(nat_subnet)
        if t2 is None or self.gws.get(t2, {}).get("type") != "internet" or t2 in self.failed:
            return False, f"{subnet_id} -> {t}, but the NAT's subnet {nat_subnet} has no route to an internet gateway"
        return True, f"{subnet_id} -> {t} ({nat_az}) -> {t2}"

    def aws_service_from(self, subnet_id: str, service: str) -> Tuple[bool, str]:
        rt_id = self.subnets[subnet_id]["route_table"]
        for e in self.eps:
            if e["service"] != service:
                continue
            if e["type"] == "gateway" and rt_id in e.get("route_tables", []):
                return True, f"{service} via gateway endpoint {e['id']} on {rt_id}"
            if e["type"] == "interface":
                if not e.get("private_dns", False):
                    continue  # SDKs resolve the public name; this endpoint is not used by default
                live = [sn for sn in e.get("subnets", []) if self.subnets[sn]["az"] not in self.down]
                if live:
                    return True, f"{service} via interface endpoint {e['id']} (ENI in {', '.join(live)})"
        ok, why = self.internet_from(subnet_id)
        if ok:
            return True, f"{service} via public endpoint: {why}"
        return False, f"no path to {service}: no usable endpoint for {rt_id}/{subnet_id} and {why}"

    def need_from(self, subnet_id: str, need: str) -> Tuple[bool, List[str]]:
        if need in COMPOUND:
            notes, ok_all = [], True
            for part in COMPOUND[need]:
                ok, why = self.need_from(subnet_id, part)
                ok_all &= ok
                notes += why
            return ok_all, notes
        if need in AWS_SERVICES:
            ok, why = self.aws_service_from(subnet_id, need)
            return ok, [why]
        if need in self.comps:
            ok, why = self.serves(need)
            return ok, [f"{need}: " + ("serving" if ok else "NOT serving (" + "; ".join(why[:2]) + ")")]
        if need in self.ext:
            if need in self.failed:
                return False, [f"external {need} is down"]
            ok, why = self.internet_from(subnet_id)
            return ok, [f"external {need} ({self.ext[need].get('host', '?')}): {why}"]
        return False, [f"unknown need {need!r}"]

    # ── components ─────────────────────────────────────────────────────
    def serves(self, cid: str) -> Tuple[bool, List[str]]:
        if cid in self._serving:
            return self._serving[cid]
        if cid in self._visiting:
            return False, [f"dependency cycle through {cid}"]
        self._visiting.add(cid)
        c = self.comps[cid]
        res = self._serves(c)
        self._visiting.discard(cid)
        self._serving[cid] = res
        return res

    def _serves(self, c: Dict[str, Any]) -> Tuple[bool, List[str]]:
        cid = c["id"]
        if cid in self.failed:
            return False, [f"{cid} has failed"]
        azs_of = sorted({self.subnets[s]["az"] for s in c["subnets"]})
        live = [s for s in c["subnets"] if self.subnets[s]["az"] not in self.down]
        kind = c.get("kind")
        if kind == "database":
            primary_az = self.subnets[c["subnets"][0]]["az"]
            if c.get("multi_az"):
                if len(azs_of) < 2:
                    return False, [f"{cid}: multi_az needs subnets in two AZs, has {azs_of}"]
                if not live:
                    return False, [f"{cid}: every AZ it can run in is unavailable"]
                return True, [f"{cid}: Multi-AZ; standby promotes if {primary_az} fails"]
            if primary_az in self.down:
                return False, [f"{cid}: single-AZ instance lives in {primary_az}, which is unavailable"]
            return True, [f"{cid}: single instance in {primary_az}"]
        if kind == "load_balancer" and len(azs_of) < 2:
            return False, [f"{cid}: a load balancer needs subnets in at least two AZs, has {azs_of}"]
        if not live:
            return False, [f"{cid}: no subnet in an available AZ (runs in {azs_of})"]
        notes: List[str] = []
        good = []
        for sn in live:
            ok_sn = True
            for need in c.get("needs", []):
                ok, why = self.need_from(sn, need)
                if not ok:
                    ok_sn = False
                    notes += [f"from {sn}: " + w for w in why if "no path" in w or "NOT serving" in w or "unavailable" in w or "down" in w or "no 0.0.0.0/0" in w or "has failed" in w or "no route" in w]
            if ok_sn:
                good.append(sn)
        if not good:
            return False, notes or [f"{cid}: no placement can reach all needs"]
        if kind != "load_balancer" and c.get("min_azs", 1) > len({self.subnets[s]["az"] for s in good}):
            return False, [f"{cid}: serving in {len(good)} subnet(s), needs {c.get('min_azs')} AZs"] + notes
        return True, [f"{cid}: serving from {', '.join(good)}"] + notes


# ── scenarios, SPOFs, hygiene, cost ────────────────────────────────────

def scenarios(inv: Dict[str, Any]) -> List[str]:
    return ["baseline"] + [f"az-down:{az}" for az in inv["azs"]]


def run_scenario(inv: Dict[str, Any], name: str) -> Dict[str, Any]:
    down: Set[str] = set()
    if name.startswith("az-down:"):
        az = name.split(":", 1)[1]
        if az not in inv["azs"]:
            raise InventoryError(f"unknown AZ {az}")
        down = {az}
    elif name != "baseline":
        raise InventoryError(f"unknown scenario {name}")
    m = Model(inv, down)
    comps = {}
    for cid in m.comps:
        ok, why = m.serves(cid)
        comps[cid] = {"serving": ok, "why": why}
    return {"scenario": name, "all_serving": all(v["serving"] for v in comps.values()), "components": comps}


def computed_spofs(inv: Dict[str, Any]) -> List[Dict[str, str]]:
    """Single resources whose failure alone stops a component that serves at baseline."""
    base = Model(inv)
    serving0 = {cid for cid in base.comps if base.serves(cid)[0]}
    out = [{"id": "region", "kind": "region", "breaks": "everything", "why": "both AZs are in one region; a regional outage or a regional service event is not covered by two AZs"}]
    candidates: List[Tuple[str, str]] = []
    # Zonal resources fail individually. An internet gateway and a gateway
    # endpoint are regional, horizontally scaled VPC constructs (covered by
    # "region"); an interface endpoint with ENIs in two AZs is covered by the
    # AZ scenarios, so only single-AZ endpoints are candidates here.
    candidates += [(g["id"], "nat") for g in inv["gateways"] if g["type"] == "nat"]
    candidates += [(e["id"], "endpoint") for e in inv["endpoints"]
                   if e["type"] == "interface" and len({base.subnets[s]["az"] for s in e.get("subnets", [])}) < 2]
    candidates += [(x["id"], "external") for x in inv.get("external", [])]
    for c in inv["components"]:
        single = len({base.subnets[s]["az"] for s in c["subnets"]}) < 2
        if c.get("kind") == "database" and not c.get("multi_az"):
            single = True
        if single:
            candidates.append((c["id"], "component"))
    for rid, kind in candidates:
        m = Model(inv, failed={rid})
        broken = sorted(cid for cid in serving0 if not m.serves(cid)[0])
        if broken:
            out.append({"id": rid, "kind": kind, "breaks": ", ".join(broken), "why": f"if {rid} fails alone, {', '.join(broken)} stop(s) serving"})
    return out


def hygiene(inv: Dict[str, Any]) -> List[str]:
    f: List[str] = []
    m = Model(inv)
    for s in inv["subnets"]:
        t = m.default_target(s["id"])
        if s.get("tier") != "public" and t and m.gws.get(t, {}).get("type") == "internet":
            f.append(f"exposure: {s['tier']} subnet {s['id']} routes 0.0.0.0/0 to internet gateway {t}")
    for c in inv["components"]:
        if c.get("public") and c.get("kind") != "load_balancer":
            f.append(f"exposure: component {c['id']} ({c.get('kind')}) is public; only the load balancer should be")
        for sn in c["subnets"]:
            if c.get("kind") != "load_balancer" and m.subnets[sn].get("tier") == "public":
                f.append(f"exposure: component {c['id']} runs in public subnet {sn}")
    roles = {r["id"]: r for r in inv.get("iam_roles", [])}
    for c in inv["components"]:
        if c.get("kind") in TRUST:
            r = roles.get(c.get("role", ""))
            if not r:
                f.append(f"identity: component {c['id']} has no IAM role in iam_roles")
                continue
            if r.get("trust") != TRUST[c["kind"]]:
                f.append(f"identity: role {r['id']} trusts {r.get('trust')!r}; {c['kind']} needs {TRUST[c['kind']]}")
    for r in roles.values():
        for st in r.get("statements", []):
            if st.get("effect") != "Allow":
                continue
            for a in st.get("actions", []):
                if a == "*" or a.endswith(":*"):
                    f.append(f"identity: role {r['id']} allows wildcard action {a}")
            for res in st.get("resources", []):
                if res == "*" and not set(st.get("actions", [])) <= RESOURCE_STAR_OK:
                    f.append(f"identity: role {r['id']} allows {st.get('actions')} on Resource '*'")
    return f


def cost_model(inv: Dict[str, Any], prices: Dict[str, Any]) -> Dict[str, Any]:
    h = float(prices["hours_per_month"])
    subnets = {s["id"]: s for s in inv["subnets"]}
    nat = sum(1 for g in inv["gateways"] if g["type"] == "nat")
    eni_az = 0
    lines = []
    for e in inv["endpoints"]:
        if e["type"] == "interface":
            n = len({subnets[s]["az"] for s in e.get("subnets", [])})
            eni_az += n
            lines.append(f"{e['id']}: {n} AZ(s)")
    albs = sum(1 for c in inv["components"] if c.get("kind") == "load_balancer")
    nat_cost = nat * prices["nat_gateway_hour"] * h
    ep_cost = eni_az * prices["interface_endpoint_az_hour"] * h
    alb_cost = albs * prices["load_balancer_hour"] * h
    return {
        "nat_gateways": nat, "interface_endpoint_az_hours": eni_az, "load_balancers": albs,
        "nat_monthly": round(nat_cost, 2), "endpoints_monthly": round(ep_cost, 2), "load_balancer_monthly": round(alb_cost, 2),
        "network_fixed_monthly": round(nat_cost + ep_cost + alb_cost, 2), "endpoint_lines": lines,
        "excluded": "data processing per GB, LCUs, transfer, compute, storage, database",
    }


def main(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(description="Evaluate a Beacon architecture inventory (teaching model, no cloud calls)")
    p.add_argument("inventory")
    p.add_argument("--scenario", default="all", help="baseline | az-down:<az> | all")
    p.add_argument("--explain", default="", help="component id: print every path it needs, per scenario")
    p.add_argument("--spof", action="store_true", help="print computed single points of failure")
    p.add_argument("--cost", default="", help="prices JSON: print the fixed network cost model")
    p.add_argument("--json", action="store_true", help="machine-readable output")
    a = p.parse_args(argv)
    try:
        inv = load(a.inventory)
        names = scenarios(inv) if a.scenario == "all" else [a.scenario]
        results = [run_scenario(inv, n) for n in names]
        findings = hygiene(inv)
        spofs = computed_spofs(inv)
        cost = None
        if a.cost:
            with open(a.cost, "r", encoding="utf-8") as fh:
                cost = cost_model(inv, json.load(fh))
    except InventoryError as e:
        print(f"inventory error: {e}", file=sys.stderr)
        return 2
    ok = all(r["all_serving"] for r in results) and not findings
    if a.json:
        print(json.dumps({"ok": ok, "scenarios": results, "findings": findings, "spofs": spofs, "cost": cost}, indent=2))
        return 0 if ok else 1
    for r in results:
        print(f"== {r['scenario']}: {'all components serving' if r['all_serving'] else 'SOME COMPONENTS DOWN'}")
        for cid, v in r["components"].items():
            print(f"   {'ok  ' if v['serving'] else 'DOWN'} {cid}")
            if not v["serving"] or a.explain == cid:
                for w in v["why"][:6]:
                    print(f"        {w}")
    if a.explain:
        m = Model(inv)
        c = m.comps.get(a.explain)
        if not c:
            print(f"no component {a.explain}", file=sys.stderr)
            return 2
        print(f"== paths for {a.explain} (baseline)")
        for sn in c["subnets"]:
            for need in c.get("needs", []):
                okn, why = m.need_from(sn, need)
                print(f"   {sn} {need}: {'ok' if okn else 'NO'} — " + "; ".join(why))
    print("== findings: " + ("none" if not findings else str(len(findings))))
    for f in findings:
        print("   " + f)
    if a.spof:
        print("== computed single points of failure")
        for s in spofs:
            print(f"   {s['id']} ({s['kind']}): {s['why']}")
    if cost:
        print(f"== fixed network cost (model, USD/month): {cost['network_fixed_monthly']}  "
              f"[NAT {cost['nat_monthly']} x{cost['nat_gateways']}, endpoints {cost['endpoints_monthly']} "
              f"({cost['interface_endpoint_az_hours']} endpoint-AZs), LB {cost['load_balancer_monthly']}]; excludes {cost['excluded']}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
