# L06 — A TLS reverse proxy in front of Beacon

Module M03 · ~100 min practical (two sessions) · profile `linux-arm64` · runs **inside the course VM**

## Ticket

> Beacon is being published to internal clients as `https://beacon.corp.lab:8446`, through a
> small TLS-terminating reverse proxy on the lab host. Clients are configured to trust **only the
> lab CA** (`/opt/beacon-l06/ca/ca.pem`). Since the proxy change went in, clients cannot use the
> service. Make it work for a client that verifies properly, show the handshake, the Host header,
> the status and the backend port, and explain what was wrong.

## Objectives

- `obj-m03-05` validate TLS identity (SAN, issuer, chain to the supplied trust) and operate a
  reverse proxy in front of Beacon; fix a mismatch properly
- `obj-m03-04` isolate the failing layer (connect, handshake, proxy, backend) from evidence, and
  reject fixes that bypass verification

## What is fixture-controlled

`setup.sh` creates two certificate authorities under `/opt/beacon-l06` — the lab CA your clients
trust and an older "legacy" CA — starts Beacon on `127.0.0.1:8086` and starts the proxy
(`assets/tlsproxy.py`, standard-library Python: TLS 1.2+, Host preserved, `X-Forwarded-*` added,
502/504 with a JSON reason on upstream failure, one JSON access-log line per request) on
`127.0.0.1:8446` from `/opt/beacon-l06/proxy.json`. `inject.sh` issues the variant's server
certificate(s) and writes `proxy.json` (`LOOPED_VARIANT=variant-a|variant-b|variant-c`). The
system trust store is never touched; nothing listens beyond loopback.

No hosts-file edit is needed: `curl --resolve beacon.corp.lab:8446:127.0.0.1` sends the right
SNI and Host while connecting to loopback. Add `--noproxy '*'` if your shell has an HTTP proxy set.

## Steps and checkpoints

**Checkpoint c1 — reproduce with verification on, then look at the handshake (week 8, session 1).**

1. `sudo bash labs/sre-cloud-foundations/L06/setup.sh`
2. Reproduce as a client that trusts only the lab CA:
   `curl -sS --noproxy '*' --cacert /opt/beacon-l06/ca/ca.pem --resolve beacon.corp.lab:8446:127.0.0.1 https://beacon.corp.lab:8446/healthz`
3. Handshake: `openssl s_client -connect 127.0.0.1:8446 -servername beacon.corp.lab -CAfile /opt/beacon-l06/ca/ca.pem </dev/null`
   — read `subject`, `issuer`, `Verify return code`. Then
   `openssl x509 -in <served or configured cert> -noout -subject -issuer -ext subjectAltName -dates`.
4. Proxy and backend: `cat /opt/beacon-l06/proxy.json`, `ss -ltnp | grep -E ':8446|:8086'`,
   `tail -3 /opt/beacon-l06/run/proxy-access.log`.

**Checkpoint c2 — fix properly, prove it (session 2).**

5. Change only what the evidence names: the proxy's certificate/key paths, a new server
   certificate issued by the lab CA with the right SAN (template: `/opt/beacon-l06/leaf.ext.example`),
   or the proxy's upstream. Restart the proxy: `sudo bash labs/sre-cloud-foundations/L06/restart-proxy.sh`.
6. Prove it with the same verified curl, plus `/version`, and read the access-log line.
7. Notes in `evidence/L06-notes.md`, then
   `sudo python3 labs/sre-cloud-foundations/L06/validate.py --explanation-file labs/sre-cloud-foundations/L06/evidence/L06-notes.md`

## What you should observe

- The failing layer is visible in the client error: a verification error (`unable to get local
  issuer certificate`, `no alternative certificate subject name matches`) is the handshake; a
  `502` with a JSON body naming the upstream is the proxy talking to its backend.
- Modern clients match the name against the **SAN**, not the subject CN. A certificate whose CN
  is right and SAN is wrong still fails.
- The access log shows the Host the client sent, the upstream it chose and the upstream's status.

## Not fixes (the validator rejects them)

`curl -k`/`--insecure`, `verify=False`, `CERT_NONE`, adding the legacy CA to the lab trust file,
or installing either CA into the system trust store. Each makes one client "work" by removing the
check that protects every client.

## Pause / resume

All state is under `/opt/beacon-l06`. `reset.sh` re-issues the variant's certificates, rewrites
`proxy.json` and restarts the proxy (it rebuilds the whole lab, including new CAs, if the lab CA
file was modified). `teardown.sh` removes everything.

## Lab versus production

Production uses nginx/Envoy/HAProxy or a cloud load balancer, certificates from an internal PKI
or ACME, full chains with intermediates, OCSP/CRL policy, and the private key readable only by the
proxy's service user. The diagnosis ladder — connect, handshake (name, issuer, validity), proxy,
backend — is the same, and so is the rule that verification is never the thing you turn off.

## Limits

One proxy, one certificate, a root-only chain, loopback only. This lab does not prove mTLS,
intermediate-chain assembly, certificate rotation automation, HTTP/2, or load-balancer health
checking. It proves you can read a handshake, fix a name/issuer mismatch or a backend-port error
properly, and show the request reached the right backend.

## References

- T23 RFC/IETF concepts; OpenSSL `s_client(1)`, `x509(1)`, `verify(1)`; Python `ssl` module (T11)
