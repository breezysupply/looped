# L06 worked solution

Read after your own attempt. `CA=/opt/beacon-l06/ca/ca.pem`;
`CURL="curl -sS --noproxy * --cacert $CA --resolve beacon.corp.lab:8446:127.0.0.1"`.

## Variant A — issued by a CA the clients do not trust

`$CURL https://beacon.corp.lab:8446/healthz` → `SSL certificate problem: unable to get local issuer
certificate`. `openssl s_client … -CAfile $CA` shows `issuer=… CN = Looped Legacy Lab CA` and
`Verify return code: 21`. The SAN is right; the issuer is not. `ls /opt/beacon-l06/certs` shows a
renewed `beacon-2026.pem`; `openssl x509 -in /opt/beacon-l06/certs/beacon-2026.pem -noout -issuer
-ext subjectAltName` → issued by the lab CA for `beacon.corp.lab`. `proxy.json` still points at
`beacon-2025`. Fix: point `cert` and `key` at `beacon-2026.*`, `restart-proxy.sh`. (Check the key
matches: `openssl pkey -in …key -pubout | sha256sum` equals `openssl x509 -in …pem -pubkey -noout | sha256sum`.)

## Variant B — right CA, wrong name

curl → `no alternative certificate subject name matches target host name 'beacon.corp.lab'`.
`openssl x509 -ext subjectAltName` → `DNS:beacon.corp.local` (the subject CN says beacon.corp.lab,
which modern clients ignore). Issue a correct certificate from the lab CA:

```sh
cd /opt/beacon-l06
sudo sh -c 'sed "s/^subjectAltName = .*/subjectAltName = DNS:beacon.corp.lab/" leaf.ext.example > certs/beacon-2026b.ext'
sudo openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
  -keyout certs/beacon-2026b.key -out certs/beacon-2026b.csr -subj "/O=Looped Lab/CN=beacon.corp.lab"
sudo openssl x509 -req -in certs/beacon-2026b.csr -CA ca/ca.pem -CAkey ca/ca.key -CAcreateserial \
  -days 90 -sha256 -extfile certs/beacon-2026b.ext -out certs/beacon-2026b.pem
sudo chmod 600 certs/beacon-2026b.key
sudo sed -i 's#certs/beacon-2026\.#certs/beacon-2026b.#g' proxy.json
sudo bash labs/sre-cloud-foundations/L06/restart-proxy.sh
```

## Variant C — the handshake is fine, the backend is not

curl verifies and returns `502` with `{"error": "bad gateway", "upstream": "127.0.0.1:8087",
"reason": "connection refused"}`. `ss -ltnp` shows Beacon on `127.0.0.1:8086`, nothing on 8087;
`curl -s 127.0.0.1:8086/healthz` → ok. Fix `upstream` to `http://127.0.0.1:8086`, restart the proxy.

## Prove it (all variants)

```sh
$CURL https://beacon.corp.lab:8446/healthz; $CURL https://beacon.corp.lab:8446/version
tail -1 /opt/beacon-l06/run/proxy-access.log   # host beacon.corp.lab:8446, status 200, upstream_status 200
```
