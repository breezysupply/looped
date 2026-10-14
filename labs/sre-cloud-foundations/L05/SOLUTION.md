# L05 worked solution

Read after your own attempt. `C="sudo ip netns exec looped-l05-client"`.

## Always start the same way

```sh
$C curl -sS --noproxy '*' --max-time 5 http://api.beacon.corp.lab:8080/healthz   # resolve or connect error?
$C dig api.beacon.corp.lab                                          # resolver's view
$C dig @10.55.2.53 +norec api.beacon.corp.lab                       # parent's view
$C dig @10.55.2.54 +norec api.beacon.corp.lab                       # child's view
sudo ip -n looped-l05-client route; sudo ip -n looped-l05-client route get 10.55.2.80
```

## Variant A — the delegation is missing

curl: `Could not resolve host`. Child: `NOERROR`, flags `qr aa`, `api… 10.55.2.80`. Parent:
`NXDOMAIN`, flags `qr aa`, `corp.lab SOA` in AUTHORITY — the parent says, with authority, that
nothing exists under `beacon.corp.lab`, because the NS and glue were removed in a "cleanup"
(serial 2026091102). The resolver starts at the parent, so it never reaches the child.

Fix: put the delegation back and bump the serial; reload the parent; clear the negative entry
(it would expire within 60 s anyway — the parent's SOA MINIMUM):

```sh
sudo tee -a /opt/beacon-l05/zones/corp.lab.zone <<'Z'
beacon     IN NS  ns1.beacon.corp.lab.
ns1.beacon IN A   10.55.2.54
Z
sudo sed -i 's/ 2026091102 / 2026091103 /' /opt/beacon-l05/zones/corp.lab.zone
sudo kill -HUP "$(cat /opt/beacon-l05/run/auth-parent.pid)"; tail -1 /opt/beacon-l05/run/auth-parent.log
$C dig @10.55.2.53 +norec api.beacon.corp.lab     # now a referral: no aa, NS + glue
$C python3 /opt/beacon-l05/labdns.py cachectl flush api.beacon.corp.lab
```

## Variant B — a stale negative answer

Child and parent are correct (`aa` answer from the child; referral from the parent). The resolver
says `NXDOMAIN` with `beacon.corp.lab SOA` in AUTHORITY and a TTL near 3600 that decreases on
every query. Someone asked for the name before it was published; the resolver cached "does not
exist" for min(SOA TTL 3600, MINIMUM 3600). `cachectl dump` shows the entry (`negative: true`,
`ttl_left`). Fix narrowly: `cachectl flush api.beacon.corp.lab`. Lasting fix: publish records
before announcing them, and keep negative TTLs short in zones that change often.

## Variant C — a stale route

curl: `Failed to connect … Couldn't connect` (or `No route to host`) — the name resolved. DNS
views all agree. `ip route` shows `10.55.2.64/27 via 10.55.1.254`; `route get 10.55.2.80` picks
it (longest prefix wins over the default) and 10.55.1.254 does not exist. Fix:
`sudo ip -n looped-l05-client route del 10.55.2.64/27`. Adding a `/32` via 10.55.1.1 would also
"work" and leave the trap for the rest of the /27 — the validator rejects any dead gateway left in
the table.
