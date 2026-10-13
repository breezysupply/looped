# Network probe run INSIDE a lab pod (kubectl exec … python3 -c "<this file>" MODE HOST PORT).
# Prints one JSON line: name resolution result, then TCP result (open / timeout / refused), and
# for MODE=pg the first byte of PostgreSQL's reply to an SSLRequest ("N" or "S" means a real
# PostgreSQL server answered). A NetworkPolicy drop shows up as a TIMEOUT, not a refusal.
import json
import socket
import sys

mode, host, port = sys.argv[1], sys.argv[2], int(sys.argv[3])
res = {"target": "%s:%d" % (host, port)}
try:
    ip = socket.getaddrinfo(host, port, socket.AF_INET, socket.SOCK_STREAM)[0][4][0]
    res["dns"] = "ok"
    res["ip"] = ip
except OSError as e:
    res["dns"] = "fail:" + type(e).__name__
    print(json.dumps(res))
    sys.exit(0)
try:
    s = socket.create_connection((ip, port), timeout=3)
    res["tcp"] = "open"
    if mode == "pg":
        s.settimeout(3)
        s.sendall(b"\x00\x00\x00\x08\x04\xd2\x16\x2f")  # SSLRequest
        res["pg"] = s.recv(1).decode("ascii", "replace")
    s.close()
except socket.timeout:
    res["tcp"] = "timeout"
except ConnectionRefusedError:
    res["tcp"] = "refused"
except OSError as e:
    res["tcp"] = "error:" + type(e).__name__
print(json.dumps(res))
