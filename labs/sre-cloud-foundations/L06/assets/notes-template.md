# L06 notes

## Symptom
<!-- The verified client command you ran (curl --cacert … --resolve …) and its exact error or status. -->

## Handshake
<!-- `openssl s_client -connect 127.0.0.1:8446 -servername beacon.corp.lab -CAfile … </dev/null` :
     paste the subject, issuer, the SAN line (openssl x509 -noout -ext subjectAltName) and "Verify return code". -->

## Proxy and backend
<!-- proxy.json upstream; `ss -ltnp` for the backend port; the access-log line for your request (host, status, upstream_status). -->

## Fix and why it is the right one
<!-- What you changed. Why disabling verification, trusting another CA, or editing the system trust store is not a fix. -->
