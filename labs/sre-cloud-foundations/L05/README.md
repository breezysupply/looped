# L05 — DNS from delegation to cache, and the route underneath

Module M03 · ~120 min practical (two sessions) · profile `linux-arm64` · runs **inside the course VM**

## Ticket

> From the client network, `http://api.beacon.corp.lab:8080/healthz` does not work. The Beacon
> team says their server is up and "DNS is fine on our side". The network team says "nothing
> changed". Find which layer is failing, prove what the authoritative servers say versus what
> the client's resolver says, fix the narrowest thing, and explain any disagreement.

## Objectives

- `obj-m03-01` trace a request path (resolve → route → connect → answer) and name the failing hop
- `obj-m03-02` reason about addresses and routes; find and fix a bad route
- `obj-m03-03` diagnose DNS from delegation to cache: authoritative versus recursive data,
  negative caching, delegation repair

## The lab network (all inside the VM, all named `looped-l05-*`)

```
looped-l05-client 10.55.1.10 ──── 10.55.1.1 looped-l05-rtr 10.55.2.1 ──── looped-l05-srv 10.55.2.2
   resolv.conf → 10.55.2.10                                                .10  caching resolver (control :8953)
                                                                           .53  ns1.corp.lab          (parent zone corp.lab)
                                                                           .54  ns1.beacon.corp.lab   (child zone beacon.corp.lab)
                                                                           .80  Beacon :8080
```

The DNS servers are `assets/labdns.py` — a small standard-library fixture that behaves like an
authoritative server (AA flag, referrals with glue, NXDOMAIN/NODATA with the SOA) and an
iterative caching resolver (positive TTLs; negative answers cached for min(SOA TTL, SOA
MINIMUM), as RFC 2308 describes). It is a teaching fixture: UDP only, no EDNS/DNSSEC.
`dig` works against it; `python3 /opt/beacon-l05/labdns.py query @SERVER NAME [TYPE] [+norec]`
is a dig-like fallback.

## What is fixture-controlled

`inject.sh` applies one of three variants (`LOOPED_VARIANT=variant-a|variant-b|variant-c`) to the
zone files under `/opt/beacon-l05/zones`, the resolver's cache, or the client's routing table.
The VM's own interfaces, routes and resolver are never touched.

## Steps and checkpoints

**Checkpoint c1 — narrow by layer (week 7, session 1).**

1. `sudo bash labs/sre-cloud-foundations/L05/setup.sh`
2. Reproduce from the client: `sudo ip netns exec looped-l05-client curl -sS --noproxy '*' --max-time 5 http://api.beacon.corp.lab:8080/healthz`.
   Note the exact error — "could not resolve" and "couldn't connect" are different layers.
3. Resolve: `sudo ip netns exec looped-l05-client dig api.beacon.corp.lab` (through the resolver),
   then ask the servers yourself, without recursion: `dig @10.55.2.53 +norec …` (parent),
   `dig @10.55.2.54 +norec …` (child). Read the status, the `aa` flag, the AUTHORITY section, TTLs.
4. Route: `sudo ip -n looped-l05-client route`, `ip -n looped-l05-client route get 10.55.2.80`.

**Checkpoint c2 — fix the narrowest thing, prove the user path (session 2).**

5. Fix only what the evidence names: a zone file (then bump its serial and
   `sudo kill -HUP $(cat /opt/beacon-l05/run/auth-parent.pid)` / `auth-child.pid`), one entry in the
   resolver's cache (`sudo ip netns exec looped-l05-client python3 /opt/beacon-l05/labdns.py cachectl dump|flush NAME`),
   or one route.
6. Prove the user path from the client again, through the resolver.
7. Paste the evidence into `evidence/L05-notes.md`, then
   `sudo python3 labs/sre-cloud-foundations/L05/validate.py --explanation-file labs/sre-cloud-foundations/L05/evidence/L05-notes.md`.

## What you should observe

- "Authoritative" means the `aa` flag from the server that owns the zone. A resolver's answer
  never carries it; it is a copy with a TTL.
- A negative answer carries the zone's SOA in AUTHORITY; its TTL is how long resolvers may
  remember "this name does not exist", and you can watch it count down.
- A name that resolves correctly and still cannot be reached is not a DNS problem. Longest-prefix
  match decides the route; `ip route get` tells you which one wins.

## Unsafe shortcuts (the validator rejects them)

Adding `api.beacon.corp.lab` to a hosts file, pointing the client's `resolv.conf` at an
authoritative server, or adding a more specific route over a stale one makes one request work
and leaves the real fault for the next client. Restarting the shared resolver to clear one name is
accepted but flagged (advisory) — flush the name instead.

## Pause / resume

State: the three namespaces, `/etc/netns/looped-l05-client/`, and `/opt/beacon-l05` (zones,
fixture logs, PID files). `reset.sh` restores zones, routes and caches for the same variant. A VM
reboot removes the namespaces: run `teardown.sh` then `setup.sh`.

## Lab versus production

Real resolvers (systemd-resolved, unbound, BIND, cloud VPC resolvers) cache the same way and have
their own flush commands (`resolvectl flush-caches`, `unbound-control flush NAME`,
`rndc flushname NAME`); a cloud resolver you do not operate may simply require waiting out the
negative TTL. Real delegations are changed at a registrar or a parent zone you may not control.

## Limits

One VM, three namespaces, a fixture DNS implementation. This lab does not prove DNSSEC, TCP
fallback, EDNS, anycast, split-horizon views or cloud private zones, and it does not exercise a
firewall (M03 lesson 4 and S06 cover that). It proves you can separate resolution from routing,
read authoritative versus cached data, and repair a delegation, a cache entry or a route narrowly.

## References

- T23 RFC 1034/1035 and RFC 2308 (negative caching) — DNS concepts
