# L06 hints (four rungs; rungs 3–4 end independent credit for this attempt)

1. **Boundary.** Read the client error carefully: is it a TCP problem, a certificate verification
   problem, or an HTTP status from the proxy? Each one points at a different hop — handshake versus
   proxy-to-backend.
2. **Evidence source.** For the handshake: `openssl s_client -connect 127.0.0.1:8446 -servername
   beacon.corp.lab -CAfile /opt/beacon-l06/ca/ca.pem </dev/null` (subject, issuer, Verify return code)
   and `openssl x509 -noout -issuer -ext subjectAltName` on the certificate files. For the proxy:
   `proxy.json`, the access log and `ss -ltnp`.
3. **Discriminating command.** Compare the served certificate's issuer with the lab CA's subject
   (`openssl x509 -in /opt/beacon-l06/ca/ca.pem -noout -subject`), and its SAN with the name the
   client uses. If the handshake verifies, compare the proxy's `upstream` port with what Beacon
   actually listens on.
4. **Root cause and fix.** A: the proxy serves `beacon-2025` from the legacy CA — point it at
   `beacon-2026`. B: the SAN says `beacon.corp.local` — issue a new certificate from the lab CA with
   `DNS:beacon.corp.lab`. C: `upstream` is port 8087, Beacon is on 8086. Restart the proxy after each
   change; never `-k`, never extra trust.
