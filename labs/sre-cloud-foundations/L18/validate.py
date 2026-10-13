#!/usr/bin/env python3
"""L18 validator: queries the kind cluster looped-policy (namespace beacon). Read-only
except one harmless annotation the deploy bot writes on beacon-api (the "real API
access" test runs the bot's four steps as its ServiceAccount via impersonation).

Checks (critical unless marked):
  cluster              context kind-looped-policy is a local kind cluster
  cni-enforcing        calico-node ready on every node and no kindnet pods (enforcement is possible)
  workloads-ready      beacon-api, beacon-report, beacon-db each 1/1 ready
  rbac-allowed         `auth can-i --as=system:serviceaccount:beacon:beacon-deployer`: get/list/watch/
                       patch deployments, list pods, get pods/log in beacon → yes
  rbac-denied          … delete deployments, get secrets, create pods/exec, create rolebindings,
                       escalate/bind roles, list pods in kube-system, list nodes → no
  rbac-shape           Role has no "*" anywhere; RoleBinding binds that Role (not a ClusterRole) to
                       beacon-deployer only; no ClusterRoleBinding names a beacon ServiceAccount
  deploy-bot           the bot's four real API calls succeed as the ServiceAccount, and a real
                       `get secrets` as the same identity is Forbidden
  default-deny         a policy selects every pod with policyTypes Ingress+Egress and no rules
  no-allow-all         no policy in beacon has an empty (allow-everything) rule or 0.0.0.0/0
  dns-allowed          beacon-api resolves beacon-db's FQDN; beacon-report resolves kubernetes.default
  api-to-db            from beacon-api: TCP to beacon-db:5432 opens and PostgreSQL answers an SSLRequest
  report-to-db-denied  from beacon-report: TCP to beacon-db's ClusterIP:5432 times out
  api-to-report-denied from beacon-api: TCP to beacon-report's ClusterIP:9090 times out
  api-to-kube-api-denied from beacon-api: TCP to the kubernetes Service ClusterIP:443 times out
  notes                evidence/L18-notes.md: RBAC, Policy, Proof sections with substance
Exit 1 if a critical check fails. Writes the evidence JSON.
"""
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import labcheck as L  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
CTX = "kind-looped-policy"
NS = L.NAMESPACE
SA = "system:serviceaccount:%s:beacon-deployer" % NS
PROBE = L.read_text(os.path.join(HERE, "assets", "probe.py")) or ""
NOTES = os.path.join(HERE, "evidence", "L18-notes.md")


def can_i(verb, resource, ns=NS):
    args = ["auth", "can-i", verb, resource, "--as", SA]
    code, out, err = L.kubectl(CTX, args + (["-n", ns] if ns else []), ns=None, timeout=20)
    return out.strip() == "yes", (out.strip() or err.strip()[:60])


def probe(app, mode, host, port):
    code, out, err = L.kubectl(CTX, ["exec", "deploy/" + app, "--", "python3", "-c", PROBE, mode, host, str(port)], timeout=45)
    try:
        return json.loads(out.strip().splitlines()[-1])
    except (ValueError, IndexError):
        return {"target": "%s:%s" % (host, port), "error": (err.strip() or "no output")[:120]}


def main():
    args = L.standard_args("L18")
    r = L.Report("L18", "kind-policy")
    L.apply_args(r, args)
    ok, why = L.require_kube_context(CTX)
    if not r.check("cluster", ok, why):
        return r.finish(args.out, args.explanation)

    ds = L.kget(CTX, ["get", "daemonset", "calico-node"], ns="kube-system") or {}
    st = ds.get("status", {})
    kindnet = (L.kget(CTX, ["get", "pods", "-l", "app=kindnet"], ns="kube-system") or {}).get("items", [])
    nodes = (L.kget(CTX, ["get", "nodes"], ns=None) or {}).get("items", [])
    r.check("cni-enforcing", bool(ds) and st.get("numberReady", 0) >= 1 and st.get("numberReady") == st.get("desiredNumberScheduled") == len(nodes) and not kindnet,
            "calico-node %s/%s ready on %d nodes; kindnet pods=%d" % (st.get("numberReady"), st.get("desiredNumberScheduled"), len(nodes), len(kindnet)))

    states = []
    good = True
    for d in ("beacon-api", "beacon-report", "beacon-db"):
        o = L.kget(CTX, ["get", "deployment", d]) or {}
        rr = o.get("status", {}).get("readyReplicas", 0)
        states.append("%s %s/%s" % (d, rr, o.get("spec", {}).get("replicas")))
        good = good and bool(o) and rr == o.get("spec", {}).get("replicas") and rr >= 1
    r.check("workloads-ready", good, "; ".join(states))

    must = [("get", "deployments.apps"), ("list", "deployments.apps"), ("watch", "deployments.apps"), ("patch", "deployments.apps"),
            ("list", "pods"), ("get", "pods"), ("get", "pods/log")]
    res = [(v, rs, can_i(v, rs)) for v, rs in must]
    r.check("rbac-allowed", all(x[2][0] for x in res), ", ".join("%s %s=%s" % (v, rs, a[1]) for v, rs, a in res))
    mustnot = [("delete", "deployments.apps", NS), ("create", "deployments.apps", NS), ("get", "secrets", NS), ("create", "pods/exec", NS),
               ("create", "rolebindings.rbac.authorization.k8s.io", NS), ("escalate", "roles.rbac.authorization.k8s.io", NS),
               ("bind", "roles.rbac.authorization.k8s.io", NS), ("update", "roles.rbac.authorization.k8s.io", NS),
               ("list", "pods", "kube-system"), ("list", "nodes", None), ("*", "*", NS)]
    res2 = [(v, rs, ns, can_i(v, rs, ns)) for v, rs, ns in mustnot]
    leaks = ["%s %s%s" % (v, rs, " -n " + ns if ns and ns != NS else (" (cluster)" if ns is None else "")) for v, rs, ns, a in res2 if a[0]]
    r.check("rbac-denied", not leaks, "allowed but should not be: %s" % leaks if leaks else "all %d out-of-scope requests denied" % len(res2))

    role = L.kget(CTX, ["get", "role", "beacon-deployer"]) or {}
    rb = L.kget(CTX, ["get", "rolebinding", "beacon-deployer"]) or {}
    wild = [rule for rule in role.get("rules", []) or [] if "*" in (rule.get("verbs") or []) + (rule.get("resources") or []) + (rule.get("apiGroups") or [])]
    ref = rb.get("roleRef", {})
    subj = rb.get("subjects", []) or []
    crbs = (L.kget(CTX, ["get", "clusterrolebindings"], ns=None) or {}).get("items", [])
    crb_hits = [c["metadata"]["name"] for c in crbs for s in c.get("subjects", []) or [] if s.get("kind") == "ServiceAccount" and s.get("namespace") == NS]
    rbs = (L.kget(CTX, ["get", "rolebindings"]) or {}).get("items", [])
    to_cluster = [b["metadata"]["name"] for b in rbs if b.get("roleRef", {}).get("kind") == "ClusterRole" and any(s.get("name") == "beacon-deployer" for s in b.get("subjects", []) or [])]
    r.check("rbac-shape", bool(role) and not wild and ref.get("kind") == "Role" and ref.get("name") == "beacon-deployer"
            and [(s.get("kind"), s.get("name"), s.get("namespace")) for s in subj] == [("ServiceAccount", "beacon-deployer", NS)] and not crb_hits and not to_cluster,
            "role rules=%d wildcard rules=%d; binding roleRef=%s/%s subjects=%s; ClusterRoleBindings naming beacon SAs=%s; ClusterRole bindings for the bot=%s" % (
                len(role.get("rules", []) or []), len(wild), ref.get("kind"), ref.get("name"), [s.get("name") for s in subj], crb_hits or "none", to_cluster or "none"))

    steps = [
        ("get", ["get", "deployment", "beacon-api", "-o", "name"]),
        ("patch", ["annotate", "--overwrite", "deployment/beacon-api", "looped.lab/release-check=validate-%d" % int(time.time())]),
        ("watch", ["rollout", "status", "deployment/beacon-api", "--timeout=60s"]),
        ("logs", ["logs", "deployment/beacon-api", "--tail=1"]),
    ]
    outcomes, bot_ok = [], True
    for name, a in steps:
        code, out, err = L.kubectl(CTX, a + ["--as", SA], timeout=90)
        outcomes.append("%s=%s" % (name, "ok" if code == 0 else "FAILED " + (err.strip().splitlines() or ["?"])[-1][:120]))
        bot_ok = bot_ok and code == 0
        if code != 0:
            break
    code, out, err = L.kubectl(CTX, ["get", "secrets", "--as", SA], timeout=20)
    forbidden = code != 0 and "forbidden" in err.lower()
    outcomes.append("get secrets=%s" % ("Forbidden" if forbidden else "NOT forbidden (exit %d)" % code))
    r.check("deploy-bot", bot_ok and forbidden, "; ".join(outcomes))

    pols = (L.kget(CTX, ["get", "networkpolicy"]) or {}).get("items", [])
    deny = [p["metadata"]["name"] for p in pols if p.get("spec", {}).get("podSelector", {}) in ({}, {"matchLabels": {}})
            and sorted(p["spec"].get("policyTypes", [])) == ["Egress", "Ingress"] and not p["spec"].get("ingress") and not p["spec"].get("egress")]
    r.check("default-deny", bool(deny), "default-deny policies: %s; all policies: %s" % (deny or "none", [p["metadata"]["name"] for p in pols]))

    open_rules = []
    for p in pols:
        for direction, peer_key in (("ingress", "from"), ("egress", "to")):
            for rule in p.get("spec", {}).get(direction, []) or []:
                peers = rule.get(peer_key)
                if not rule or (not peers and not rule.get("ports")):
                    open_rules.append("%s %s: empty rule" % (p["metadata"]["name"], direction))
                for peer in peers or []:
                    cidr = (peer.get("ipBlock") or {}).get("cidr")
                    if cidr in ("0.0.0.0/0", "::/0"):
                        open_rules.append("%s %s: %s" % (p["metadata"]["name"], direction, cidr))
                    if peer.get("namespaceSelector") == {} and "podSelector" not in peer:
                        open_rules.append("%s %s: every namespace" % (p["metadata"]["name"], direction))
    r.check("no-allow-all", bool(pols) and not open_rules, "; ".join(open_rules) if open_rules else "%d policies, no allow-all rule" % len(pols))

    db_ip = ((L.kget(CTX, ["get", "service", "beacon-db"]) or {}).get("spec", {}) or {}).get("clusterIP")
    rep_ip = ((L.kget(CTX, ["get", "service", "beacon-report"]) or {}).get("spec", {}) or {}).get("clusterIP")
    kapi_ip = ((L.kget(CTX, ["get", "service", "kubernetes"], ns="default") or {}).get("spec", {}) or {}).get("clusterIP")
    fqdn = "beacon-db.%s.svc.cluster.local." % NS
    a2d = probe("beacon-api", "pg", fqdn, 5432)
    rdns = probe("beacon-report", "tcp", "kubernetes.default.svc.cluster.local.", 443)
    r.check("dns-allowed", a2d.get("dns") == "ok" and rdns.get("dns") == "ok", "api resolves %s: %s; report resolves kubernetes.default: %s" % (fqdn, a2d.get("dns", a2d.get("error")), rdns.get("dns", rdns.get("error"))))
    r.check("api-to-db", a2d.get("tcp") == "open" and a2d.get("pg") in ("N", "S"), json.dumps(a2d))
    r2d = probe("beacon-report", "tcp", db_ip or "0.0.0.0", 5432)
    r.check("report-to-db-denied", bool(db_ip) and r2d.get("tcp") == "timeout", json.dumps(r2d))
    a2r = probe("beacon-api", "tcp", rep_ip or "0.0.0.0", 9090)
    r.check("api-to-report-denied", bool(rep_ip) and a2r.get("tcp") == "timeout", json.dumps(a2r))
    a2k = probe("beacon-api", "tcp", kapi_ip or "0.0.0.0", 443)
    r.check("api-to-kube-api-denied", bool(kapi_ip) and a2k.get("tcp") == "timeout", json.dumps(a2k))

    notes = L.read_text(NOTES) or ""
    secs = {s: bool(re.search(r"^#+\s*%s\b" % s, notes, re.M | re.I)) for s in ("RBAC", "Policy", "Proof")}
    body = re.sub(r"<!--.*?-->|^#.*$", "", notes, flags=re.S | re.M)
    words = len(re.findall(r"[A-Za-z]{3,}", body))
    r.check("notes", all(secs.values()) and words >= 120, "sections=%s words=%d" % (secs, words))
    return r.finish(args.out, args.explanation, extra_env={"cni": "calico", "calico_node_ready": st.get("numberReady"),
                                                          "variant_file": (L.read_text(os.path.join(HERE, "work", ".variant")) or "").strip()})


if __name__ == "__main__":
    sys.exit(main())
