#!/usr/bin/env python3
"""L06 validator: makes real, fully verified TLS requests through the lab proxy
with the lab CA as the only trust anchor, inspects the served certificate, the
proxy configuration and the backend socket, and checks that verification was
not weakened anywhere the lab can see.

Checks (critical unless noted):
  backend-healthy        Beacon answers on its own port, without the proxy
  trust-anchor           /opt/beacon-l06/ca/ca.pem is the CA created at setup (one certificate, same fingerprint)
  verified-handshake     TLS to 127.0.0.1:8446 with SNI beacon.corp.lab verifies (CERT_REQUIRED, hostname checked) against the lab CA only
  leaf-sane              the served certificate names beacon.corp.lab in its SAN, is not a CA, is issued by the lab CA and is currently valid for at most 398 days
  user-path              GET /healthz and /version through the proxy (verified) return 200 ok and Beacon's version
  backend-port           the proxy's upstream is the port Beacon is listening on, and the access log shows the forwarded Host and upstream status
  no-verification-bypass the system trust store does not contain the lab CAs; your notes use no -k/--insecure/verify=False/CERT_NONE
  notes                  notes quote the handshake evidence (advisory)
Exit 1 if any check fails.
"""
import hashlib
import json
import os
import re
import socket
import ssl
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
import labcheck as L  # noqa: E402

LAB = "/opt/beacon-l06"
CA = os.path.join(LAB, "ca", "ca.pem")
HOST, PORT = "beacon.corp.lab", 8446
EV = os.path.join(HERE, "evidence")


def verified_ctx():
    ctx = ssl.create_default_context(cafile=CA)  # only the lab CA; no system store
    ctx.check_hostname = True
    ctx.verify_mode = ssl.CERT_REQUIRED
    return ctx


def https_get(path):
    """Plain HTTP/1.1 over a verified TLS socket to 127.0.0.1 with SNI/Host beacon.corp.lab."""
    raw = socket.create_connection(("127.0.0.1", PORT), timeout=5)
    with verified_ctx().wrap_socket(raw, server_hostname=HOST) as s:
        s.sendall(f"GET {path} HTTP/1.1\r\nHost: {HOST}:{PORT}\r\nConnection: close\r\nUser-Agent: looped-l06-validate\r\n\r\n".encode())
        data = b""
        while True:
            chunk = s.recv(65536)
            if not chunk:
                break
            data += chunk
    head, _, body = data.partition(b"\r\n\r\n")
    lines = head.decode("latin-1").split("\r\n")
    status = int(lines[0].split()[1])
    headers = {k.strip().lower(): v.strip() for k, v in (ln.split(":", 1) for ln in lines[1:] if ":" in ln)}
    return status, body.decode("utf-8", "replace"), headers


def main() -> int:
    args = L.standard_args("L06")
    r = L.Report("L06", "linux-arm64")
    L.apply_args(r, args)
    variant = (L.read_text(os.path.join(LAB, ".lab", "variant")) or "").strip() or "variant-a"
    if not args.variant:
        r.seed = variant
    if not os.path.exists(CA):
        r.check("trust-anchor", False, f"{CA} missing; run setup.sh")
        return r.finish(args.out, args.explanation)

    code, body, _ = L.http("http://127.0.0.1:8086/healthz", timeout=3)
    r.check("backend-healthy", code == 200 and body.strip() == "ok", f"GET http://127.0.0.1:8086/healthz -> {code} {body.strip()[:60]}")

    ca_pem = L.read_text(CA) or ""
    n_certs = ca_pem.count("BEGIN CERTIFICATE")
    want = (L.read_text(os.path.join(LAB, ".lab", "ca.sha256")) or "").strip()
    got = hashlib.sha256(open(CA, "rb").read()).hexdigest()
    r.check("trust-anchor", n_certs == 1 and got == want,
            f"{CA}: {n_certs} certificate(s), sha256 {got[:16]}… {'matches' if got == want else 'DIFFERS from'} the CA created at setup")

    peer_der, peer, hs_obs, hs_ok = None, None, "", False
    try:
        raw = socket.create_connection(("127.0.0.1", PORT), timeout=5)
        with verified_ctx().wrap_socket(raw, server_hostname=HOST) as s:
            peer_der = s.getpeercert(binary_form=True)
            peer = s.getpeercert()
            hs_ok = True
            hs_obs = f"{s.version()} verified for {HOST}; subject={dict(x[0] for x in peer.get('subject', ()))} issuer={dict(x[0] for x in peer.get('issuer', ())).get('commonName')}"
    except ssl.SSLCertVerificationError as e:
        hs_obs = f"verification failed: {e.verify_message or e.reason} ({e.reason})"
    except (ssl.SSLError, OSError) as e:
        hs_obs = f"handshake failed: {e}"
    served_pem = None
    if not hs_ok:  # fetch what is being served, for the observation only (never used to decide a pass)
        try:
            served_pem = ssl.get_server_certificate(("127.0.0.1", PORT), timeout=5)
        except (ssl.SSLError, OSError):
            served_pem = None
    elif peer_der:
        served_pem = ssl.DER_cert_to_PEM_cert(peer_der)
    r.check("verified-handshake", hs_ok, hs_obs)

    leaf_obs, leaf_ok = "no certificate received", False
    if served_pem:
        fd, tpem = tempfile.mkstemp(suffix=".pem")
        os.write(fd, served_pem.encode())
        os.close(fd)
        _, txt, _ = L.sh(["openssl", "x509", "-in", tpem, "-noout", "-subject", "-issuer", "-ext", "subjectAltName,basicConstraints", "-dates"])
        vcode, vout, verr = L.sh(["openssl", "verify", "-CAfile", CA, "-purpose", "sslserver", "-verify_hostname", HOST, tpem])
        os.unlink(tpem)
        vtext = (vout + "\n" + verr).replace(tpem, "served-cert")
        reasons = re.findall(r"error \d+ at \d+ depth lookup: [^\n]+", vtext)
        verdict = "OK" if vcode == 0 else ("; ".join(sorted(set(reasons))) or "verification failed")
        sans = re.findall(r"DNS:([^,\s]+)", txt)
        is_ca = bool(re.search(r"CA:TRUE", txt))
        nb = re.search(r"notBefore=(.*)", txt)
        na = re.search(r"notAfter=(.*)", txt)
        days = None
        if nb and na:
            try:
                days = (ssl.cert_time_to_seconds(na.group(1).strip()) - ssl.cert_time_to_seconds(nb.group(1).strip())) / 86400
            except ValueError:
                days = None
        wild = [s for s in sans if s.startswith("*")]
        leaf_ok = HOST in sans and not wild and not is_ca and vcode == 0 and days is not None and days <= 398
        issuer = (re.search(r"issuer=(.*)", txt) or [None, "?"])[1]
        leaf_obs = f"SAN={sans} CA={is_ca} issuer={issuer.strip()} lifetime={round(days) if days else '?'}d openssl verify -verify_hostname {HOST}: {verdict}"
    r.check("leaf-sane", leaf_ok, leaf_obs)

    up_ok, up_obs = False, "skipped: no verified handshake"
    if hs_ok:
        try:
            s1, b1, h1 = https_get("/healthz")
            s2, b2, _ = https_get("/version")
            ver = json.loads(b2).get("version") if s2 == 200 else None
            up_ok = s1 == 200 and b1.strip() == "ok" and ver == "1.4.0" and "x-request-id" in h1
            up_obs = f"GET /healthz -> {s1} {b1.strip()[:40]!r}; GET /version -> {s2} version={ver!r}; X-Request-Id {'present' if 'x-request-id' in h1 else 'missing'}"
        except (OSError, ValueError, IndexError) as e:
            up_obs = f"request through the proxy failed: {e}"
    r.check("user-path", up_ok, up_obs)

    cfg = {}
    try:
        cfg = json.loads(L.read_text(os.path.join(LAB, "proxy.json")) or "{}")
    except ValueError:
        pass
    m = re.match(r"http://([^:/]+):(\d+)", str(cfg.get("upstream", "")))
    up_port = int(m.group(2)) if m else None
    listening = L.listening(up_port) if up_port else []
    bea_pid = (L.read_text(os.path.join(LAB, "run", "beacon.pid")) or "").strip()
    owned = any(f"pid={bea_pid}," in x["process"] for x in listening) if bea_pid else False
    last = None
    for line in (L.read_text(os.path.join(LAB, "run", "proxy-access.log"), limit=400000) or "").splitlines()[::-1]:
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if e.get("path") == "/healthz":
            last = e
            break
    log_ok = bool(last) and last.get("upstream_status") == 200 and str(last.get("host", "")).startswith(HOST)
    r.check("backend-port", bool(up_port) and owned and log_ok,
            f"proxy upstream={cfg.get('upstream')!r}; listener on {up_port}: {listening[0]['process'] if listening else 'none'} (Beacon pid {bea_pid}); last /healthz access: "
            + (f"host={last.get('host')} status={last.get('status')} upstream_status={last.get('upstream_status')} reason={last.get('reason')}" if last else "none"))

    bypass = []
    store = L.read_text("/etc/ssl/certs/ca-certificates.crt", limit=5_000_000) or ""
    for p in (CA, os.path.join(LAB, "legacy-ca", "ca.pem")):
        body = re.sub(r"-----[^-]+-----|\s", "", L.read_text(p) or "")
        if body and body[:200] in re.sub(r"\s", "", store):
            bypass.append(f"{os.path.basename(os.path.dirname(p))} CA is in the system trust store")
    for d in ("/usr/local/share/ca-certificates",):
        if os.path.isdir(d):
            for name in os.listdir(d):
                if re.search(r"looped|beacon|lab", name, re.I):
                    bypass.append(f"{d}/{name}")
    notes_raw = L.read_text(os.path.join(EV, "L06-notes.md")) or ""
    notes = re.sub(r"<!--.*?-->", "", notes_raw, flags=re.S)
    if re.search(r"(?<![\w-])(-k|--insecure)(?![\w-])|verify\s*=\s*False|CERT_NONE|check_hostname\s*=\s*False|PYTHONHTTPSVERIFY=0|-noverify", notes):
        bypass.append("notes show a verification-disabling flag in a command you ran")
    if os.environ.get("PYTHONHTTPSVERIFY") == "0":
        bypass.append("PYTHONHTTPSVERIFY=0 in the environment")
    r.check("no-verification-bypass", not bypass, "verification intact: lab CA passed explicitly, system store untouched, no insecure flags in notes" if not bypass else "; ".join(bypass))

    quoted = bool(re.search(r"Verify return code|verify error|SSL certificate problem|subjectAltName|X509v3 Subject Alternative Name|502|Bad Gateway|bad gateway", notes))
    r.check("notes", quoted and len(notes) > 300, f"notes {'quote' if quoted else 'do not quote'} handshake/proxy evidence; {len(notes)} chars", critical=False)

    return r.finish(args.out, args.explanation, {"lab_root": LAB, "variant_file": variant, "openssl": (L.sh(["openssl", "version"])[1].strip() or None)})


if __name__ == "__main__":
    sys.exit(main())
