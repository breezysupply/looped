#!/usr/bin/env python3
"""L05 validator: queries the DNS fixtures, the routing table and Beacon from
inside the lab namespaces. Run with sudo (it uses `ip netns exec`).

Checks (critical unless noted):
  topology            the three looped-l05-* namespaces exist and every fixture process is running
  authoritative-data  the child server answers api.beacon.corp.lab A authoritatively (aa) with 10.55.2.80
  delegation          the parent server refers beacon.corp.lab to ns1.beacon.corp.lab with glue 10.55.2.54
  recursive-result    the resolver (10.55.2.10) returns NOERROR 10.55.2.80 for api.beacon.corp.lab
  route               the client reaches 10.55.2.80 via 10.55.1.1 and has no route through an absent gateway
  user-path           from the client namespace, http://api.beacon.corp.lab:8080/healthz answers ok (name resolved through resolv.conf)
  no-bypass           the client still uses the resolver: resolv.conf unchanged, no hosts-file entry for the name
  resolver-kept       the resolver was not restarted to clear its cache (advisory)
  evidence-quoted     your notes quote the failing evidence and the authoritative answer
Exit 1 if any check fails.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
import labcheck as L  # noqa: E402

LAB = "/opt/beacon-l05"
CLI, RTR, SRV = "looped-l05-client", "looped-l05-rtr", "looped-l05-srv"
NAME, ADDR = "api.beacon.corp.lab", "10.55.2.80"
EV = os.path.join(HERE, "evidence")
FIXTURES = ("auth-parent", "auth-child", "resolver", "beacon")


def in_ns(ns, cmd, timeout=15.0):
    return L.sh(["ip", "netns", "exec", ns] + cmd, timeout=timeout)


def dns(server, name, qtype="A", rec=True):
    cmd = ["python3", os.path.join(LAB, "labdns.py"), "query", "@" + server, name, qtype, "--json", "--timeout", "3"]
    if not rec:
        cmd.append("+norec")
    code, out, err = in_ns(CLI, cmd)
    lines = out.strip().splitlines()
    try:
        return json.loads(lines[-1]) if lines and lines[-1].startswith("{") else {"error": (out + err).strip()[-200:]}
    except ValueError:
        return {"error": out[-200:]}


RC = {0: "NOERROR", 2: "SERVFAIL", 3: "NXDOMAIN", 5: "REFUSED"}


def alive(pid):
    return pid and os.path.exists(f"/proc/{pid}")


def main() -> int:
    args = L.standard_args("L05")
    r = L.Report("L05", "linux-arm64")
    L.apply_args(r, args)
    variant = (L.read_text(os.path.join(LAB, ".lab", "variant")) or "").strip() or "variant-a"
    if not args.variant:
        r.seed = variant
    if os.geteuid() != 0:
        r.check("topology", False, "run validate.py with sudo: it needs `ip netns exec`")
        return r.finish(args.out, args.explanation)

    _, nslist, _ = L.sh(["ip", "netns", "list"])
    have = [n for n in (CLI, RTR, SRV) if re.search(r"^" + n + r"\b", nslist, re.M)]
    pids = {f: (L.read_text(os.path.join(LAB, "run", f + ".pid")) or "").strip() for f in FIXTURES}
    dead = [f for f, p in pids.items() if not alive(p)]
    r.check("topology", len(have) == 3 and not dead, f"namespaces: {', '.join(have) or 'none'}; fixtures not running: {', '.join(dead) or 'none'}")

    m = dns("10.55.2.54", NAME, rec=False)
    ans = [rr[3] for rr in m.get("answer", []) if rr[1] == 1]
    r.check("authoritative-data", m.get("rcode") == 0 and m.get("aa") and ADDR in ans,
            f"@10.55.2.54 {NAME} A +norec -> {RC.get(m.get('rcode'), m.get('error', '?'))} aa={m.get('aa')} answer={ans}")

    m = dns("10.55.2.53", NAME, rec=False)
    ns = [rr[3] for rr in m.get("authority", []) if rr[1] == 2]
    glue = {rr[0]: rr[3] for rr in m.get("additional", []) if rr[1] == 1}
    ok = m.get("rcode") == 0 and not m.get("aa") and "ns1.beacon.corp.lab." in ns and glue.get("ns1.beacon.corp.lab.") == "10.55.2.54"
    r.check("delegation", ok, f"@10.55.2.53 {NAME} A +norec -> {RC.get(m.get('rcode'), m.get('error', '?'))} aa={m.get('aa')} authority NS={ns} glue={glue}")

    m = dns("10.55.2.10", NAME, rec=True)
    ans = [rr[3] for rr in m.get("answer", []) if rr[1] == 1]
    soa_ttl = [rr[2] for rr in m.get("authority", []) if rr[1] == 6]
    r.check("recursive-result", m.get("rcode") == 0 and ADDR in ans,
            f"@10.55.2.10 {NAME} A -> {RC.get(m.get('rcode'), m.get('error', '?'))} answer={ans}" + (f" (negative answer, SOA TTL {soa_ttl[0]})" if soa_ttl else ""))

    _, rget, rerr = L.sh(["ip", "-n", CLI, "route", "get", ADDR])
    _, table, _ = L.sh(["ip", "-n", CLI, "-4", "route", "show"])
    gws = set(re.findall(r"via (\S+)", table))
    bad_gw = sorted(g for g in gws if g != "10.55.1.1")
    r.check("route", "via 10.55.1.1 " in rget + " " and not bad_gw,
            f"route get {ADDR}: {(rget or rerr).strip().splitlines()[0] if (rget or rerr).strip() else '?'}; gateways in client table: {sorted(gws) or 'none'}")

    probe = ("import urllib.request\nop = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # never via an HTTP proxy\n"
             "try:\n print(op.open('http://%s:8080/healthz', timeout=5).read().decode().strip())\nexcept Exception as e:\n print('ERR', e)" % NAME)
    _, out, err = in_ns(CLI, ["python3", "-c", probe], timeout=20)
    r.check("user-path", out.strip() == "ok", f"client GET http://{NAME}:8080/healthz -> {(out or err).strip()[:160]}")

    rc = L.read_text(f"/etc/netns/{CLI}/resolv.conf") or ""
    servers = re.findall(r"^\s*nameserver\s+(\S+)", rc, re.M)
    hosts_hits = []
    for hp in ("/etc/hosts", f"/etc/netns/{CLI}/hosts"):
        txt = L.read_text(hp) or ""
        if re.search(r"(?<![\w.-])" + re.escape(NAME) + r"(?![\w-])", re.sub(r"#.*", "", txt)):
            hosts_hits.append(hp)
    r.check("no-bypass", servers == ["10.55.2.10"] and not hosts_hits,
            f"client nameservers={servers}; hosts entries for {NAME}: {hosts_hits or 'none'}")

    orig = (L.read_text(os.path.join(LAB, ".lab", "resolver.pid.orig")) or "").strip()
    r.check("resolver-kept", bool(orig) and orig == pids.get("resolver"),
            "resolver kept its cache process (cleared narrowly)" if orig == pids.get("resolver") else "resolver was restarted (flushing one name is the narrower fix on a shared resolver)", critical=False)

    notes = re.sub(r"<!--.*?-->", "", L.read_text(os.path.join(EV, "L05-notes.md")) or "", flags=re.S)
    has_auth = bool(re.search(r"flags:[^\n]*\baa\b", notes)) and ADDR in notes
    if variant in ("variant-a", "variant-b"):
        has_fail = "NXDOMAIN" in notes
    else:
        has_fail = bool(re.search(r"10\.55\.1\.254|10\.55\.2\.64/27", notes)) or bool(re.search(r"No route to host|timed out|Connection timed out", notes))
    r.check("evidence-quoted", has_auth and has_fail and len(notes) > 400,
            f"notes: authoritative answer with aa flag {'quoted' if has_auth else 'missing'}; failing evidence {'quoted' if has_fail else 'missing'}; {len(notes)} chars")

    return r.finish(args.out, args.explanation, {"lab_root": LAB, "variant_file": variant, "namespaces": have})


if __name__ == "__main__":
    sys.exit(main())
