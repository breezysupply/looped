#!/usr/bin/env python3
"""labdns — a small, standard-library DNS fixture for L05.

Three roles, one file:

  auth      authoritative server for one zone read from a master-file subset
            ($ORIGIN, $TTL, one record per line, `;` comments, no parentheses;
            types SOA NS A TXT). Answers with AA set, refers (AA clear, NS in
            AUTHORITY, glue in ADDITIONAL) below a delegation point, and returns
            NXDOMAIN / NODATA with the zone's SOA in AUTHORITY. SIGHUP reloads the
            zone file; a parse error keeps the old zone and logs why.
  resolver  iterative resolver for names under the lab's root hint (the corp.lab
            parent server). Caches positive answers for their TTL and negative
            answers (NXDOMAIN, NODATA) for min(SOA TTL, SOA MINIMUM) as RFC 2308
            describes. A small HTTP control port shows and flushes the cache.
  query     a dig-like client (`query @10.55.2.53 api.beacon.corp.lab A +norec`).
  cachectl  `cachectl --control 10.55.2.10:8953 dump|flush [NAME]`.

It is a teaching fixture: UDP only, no EDNS, no DNSSEC, no TCP fallback, no
wildcards, no CNAME chasing. It refuses names outside its zone or root hint.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import signal
import socket
import struct
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Dict, List, Optional, Tuple

TYPES = {"A": 1, "NS": 2, "SOA": 6, "TXT": 16, "AAAA": 28, "ANY": 255}
TYPE_NAMES = {v: k for k, v in TYPES.items()}
RCODES = {0: "NOERROR", 1: "FORMERR", 2: "SERVFAIL", 3: "NXDOMAIN", 4: "NOTIMP", 5: "REFUSED"}

RR = Tuple[str, int, int, object]  # (name, type, ttl, rdata) ; rdata: str for A/NS/TXT, tuple for SOA


def log(role: str, msg: str) -> None:
    sys.stdout.write(time.strftime("%Y-%m-%dT%H:%M:%SZ ", time.gmtime()) + f"{role}: {msg}\n")
    sys.stdout.flush()


def norm(name: str) -> str:
    name = name.strip().lower()
    return name if name.endswith(".") else name + "."


def in_zone(name: str, origin: str) -> bool:
    return name == origin or name.endswith("." + origin)


# ── wire format ────────────────────────────────────────────────────────

def enc_name(name: str) -> bytes:
    out = b""
    for label in norm(name).rstrip(".").split("."):
        if label:
            b = label.encode("ascii")
            if len(b) > 63:
                raise ValueError("label too long")
            out += bytes([len(b)]) + b
    return out + b"\x00"


def dec_name(msg: bytes, off: int) -> Tuple[str, int]:
    labels: List[str] = []
    jumped, end, hops = False, off, 0
    while True:
        if off >= len(msg):
            raise ValueError("truncated name")
        n = msg[off]
        if n & 0xC0 == 0xC0:
            ptr = ((n & 0x3F) << 8) | msg[off + 1]
            if not jumped:
                end = off + 2
            jumped, off, hops = True, ptr, hops + 1
            if hops > 20:
                raise ValueError("compression loop")
            continue
        off += 1
        if n == 0:
            break
        labels.append(msg[off:off + n].decode("ascii", "replace"))
        off += n
    return (".".join(labels) + ".") if labels else ".", (end if jumped else off)


def enc_rdata(rtype: int, rdata: object) -> bytes:
    if rtype == 1:
        return socket.inet_aton(str(rdata))
    if rtype == 2:
        return enc_name(str(rdata))
    if rtype == 6:
        mname, rname, serial, refresh, retry, expire, minimum = rdata  # type: ignore[misc]
        return enc_name(mname) + enc_name(rname) + struct.pack("!IIIII", serial, refresh, retry, expire, minimum)
    if rtype == 16:
        t = str(rdata).encode("utf-8")[:255]
        return bytes([len(t)]) + t
    raise ValueError(f"unsupported type {rtype}")


def enc_rr(rr: RR) -> bytes:
    name, rtype, ttl, rdata = rr
    rd = enc_rdata(rtype, rdata)
    return enc_name(name) + struct.pack("!HHIH", rtype, 1, max(0, int(ttl)), len(rd)) + rd


def dec_rr(msg: bytes, off: int) -> Tuple[Optional[RR], int]:
    name, off = dec_name(msg, off)
    rtype, _cls, ttl, rdlen = struct.unpack("!HHIH", msg[off:off + 10])
    off += 10
    rd = msg[off:off + rdlen]
    rdata: object = rd.hex()
    if rtype == 1 and rdlen == 4:
        rdata = socket.inet_ntoa(rd)
    elif rtype == 2:
        rdata, _ = dec_name(msg, off)
    elif rtype == 6:
        mname, o = dec_name(msg, off)
        rname, o = dec_name(msg, o)
        rdata = (mname, rname) + struct.unpack("!IIIII", msg[o:o + 20])
    elif rtype == 16 and rdlen:
        rdata = rd[1:1 + rd[0]].decode("utf-8", "replace")
    elif rtype == 41:  # OPT pseudo-record: ignored
        return None, off + rdlen
    return (name, rtype, ttl, rdata), off + rdlen


def build(qid: int, flags: int, question: Tuple[str, int], an: List[RR], ns: List[RR], ar: List[RR]) -> bytes:
    hdr = struct.pack("!HHHHHH", qid, flags, 1, len(an), len(ns), len(ar))
    q = enc_name(question[0]) + struct.pack("!HH", question[1], 1)
    return hdr + q + b"".join(enc_rr(r) for r in an + ns + ar)


def parse(msg: bytes) -> Dict[str, object]:
    qid, flags, qd, an, ns, ar = struct.unpack("!HHHHHH", msg[:12])
    off = 12
    qs = []
    for _ in range(qd):
        name, off = dec_name(msg, off)
        qt, _qc = struct.unpack("!HH", msg[off:off + 4])
        off += 4
        qs.append((name, qt))
    secs: Dict[str, List[RR]] = {"answer": [], "authority": [], "additional": []}
    for key, count in (("answer", an), ("authority", ns), ("additional", ar)):
        for _ in range(count):
            rr, off = dec_rr(msg, off)
            if rr is not None:
                secs[key].append(rr)
    return {"id": qid, "flags": flags, "rcode": flags & 0xF, "aa": bool(flags & 0x0400), "rd": bool(flags & 0x0100),
            "ra": bool(flags & 0x0080), "qr": bool(flags & 0x8000), "question": qs, **secs}


def flags_of(qr=True, aa=False, rd=False, ra=False, rcode=0) -> int:
    return (0x8000 if qr else 0) | (0x0400 if aa else 0) | (0x0100 if rd else 0) | (0x0080 if ra else 0) | rcode


# ── zone files ─────────────────────────────────────────────────────────

class Zone:
    def __init__(self, path: str) -> None:
        self.path = path
        self.origin = ""
        self.records: Dict[str, List[Tuple[int, int, object]]] = {}
        self.soa: Optional[RR] = None
        self.load()

    def load(self) -> None:
        origin, ttl = "", 3600
        records: Dict[str, List[Tuple[int, int, object]]] = {}
        soa: Optional[RR] = None
        last = ""
        with open(self.path, "r", encoding="utf-8") as fh:
            for no, raw in enumerate(fh, start=1):
                line = raw.split(";", 1)[0].rstrip()
                if not line.strip():
                    continue
                parts = line.split()
                if parts[0] == "$ORIGIN":
                    origin = norm(parts[1])
                    continue
                if parts[0] == "$TTL":
                    ttl = int(parts[1])
                    continue
                if not origin:
                    raise ValueError(f"{self.path}:{no}: $ORIGIN must come first")
                if line[0] in " \t":
                    name = last
                else:
                    tok = parts.pop(0)
                    name = origin if tok == "@" else (norm(tok) if tok.endswith(".") else norm(tok + "." + origin))
                last = name
                rttl = ttl
                if parts and parts[0].isdigit():
                    rttl = int(parts.pop(0))
                if parts and parts[0].upper() == "IN":
                    parts.pop(0)
                if not parts:
                    raise ValueError(f"{self.path}:{no}: missing type")
                rtype = parts.pop(0).upper()
                if rtype not in ("SOA", "NS", "A", "TXT"):
                    raise ValueError(f"{self.path}:{no}: unsupported type {rtype}")
                if not in_zone(name, origin):
                    raise ValueError(f"{self.path}:{no}: {name} is outside {origin}")

                def absname(t: str) -> str:
                    return origin if t == "@" else (norm(t) if t.endswith(".") else norm(t + "." + origin))
                try:
                    if rtype == "A":
                        socket.inet_aton(parts[0])
                        rdata: object = parts[0]
                    elif rtype == "NS":
                        rdata = absname(parts[0])
                    elif rtype == "TXT":
                        rdata = " ".join(parts).strip('"')
                    else:
                        if len(parts) != 7:
                            raise ValueError("SOA needs: mname rname serial refresh retry expire minimum on one line")
                        rdata = (absname(parts[0]), absname(parts[1])) + tuple(int(x) for x in parts[2:])
                        soa = (name, 6, rttl, rdata)
                except (IndexError, OSError, ValueError) as e:
                    raise ValueError(f"{self.path}:{no}: bad {rtype} record ({e})")
                records.setdefault(name, []).append((TYPES[rtype], rttl, rdata))
        if soa is None or soa[0] != origin:
            raise ValueError(f"{self.path}: zone {origin or '?'} has no SOA at its apex")
        if not any(t == 2 for t, _, _ in records.get(origin, [])):
            raise ValueError(f"{self.path}: zone {origin} has no NS at its apex")
        self.origin, self.records, self.soa = origin, records, soa

    def neg_soa(self) -> RR:
        name, t, ttl, rdata = self.soa  # type: ignore[misc]
        return (name, t, min(ttl, rdata[6]), rdata)  # type: ignore[index]

    def exists(self, name: str) -> bool:
        return name in self.records or any(k.endswith("." + name) for k in self.records)

    def answer(self, qname: str, qtype: int) -> Tuple[int, bool, List[RR], List[RR], List[RR]]:
        """(rcode, aa, answer, authority, additional)"""
        if not in_zone(qname, self.origin):
            return 5, False, [], [], []
        # closest delegation point strictly below the apex
        labels = qname.rstrip(".").split(".")
        for i in range(len(labels)):
            cut = ".".join(labels[i:]) + "."
            if cut == self.origin:
                break
            ns = [r for r in self.records.get(cut, []) if r[0] == 2]
            if ns:
                auth = [(cut, 2, ttl, rd) for _, ttl, rd in ns]
                glue = []
                for _, _, target in ns:
                    for t, ttl, rd in self.records.get(str(target), []):
                        if t == 1:
                            glue.append((str(target), 1, ttl, rd))
                return 0, False, [], auth, glue
        rrs = self.records.get(qname)
        if rrs is None:
            if self.exists(qname):
                return 0, True, [], [self.neg_soa()], []
            return 3, True, [], [self.neg_soa()], []
        match = [(qname, t, ttl, rd) for t, ttl, rd in rrs if t == qtype or qtype == 255]
        if not match:
            return 0, True, [], [self.neg_soa()], []
        return 0, True, match, [], []


def serve_udp(listen: str, port: int, handler, role: str) -> None:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((listen, port))
    log(role, f"listening on {listen}:{port}/udp")
    while True:
        data, peer = sock.recvfrom(4096)
        try:
            reply = handler(data, peer)
        except Exception as e:  # noqa: BLE001 - one bad packet must not stop the server
            log(role, f"error handling packet from {peer[0]}: {e!r}")
            continue
        if reply:
            sock.sendto(reply, peer)


def run_auth(a: argparse.Namespace) -> int:
    zone = Zone(a.zone)
    log("auth", f"loaded {zone.origin} from {a.zone} (serial {zone.soa[3][2]})")  # type: ignore[index]

    def reload(_s, _f):
        try:
            zone.load()
            log("auth", f"reloaded {zone.origin} (serial {zone.soa[3][2]})")  # type: ignore[index]
        except (OSError, ValueError) as e:
            log("auth", f"reload FAILED, keeping the previous zone: {e}")
    signal.signal(signal.SIGHUP, reload)

    def handle(data: bytes, peer) -> Optional[bytes]:
        m = parse(data)
        if m["qr"] or not m["question"]:
            return None
        qname, qtype = m["question"][0]  # type: ignore[index]
        qname = norm(qname)
        rcode, aa, an, ns, ar = zone.answer(qname, qtype)
        log("auth", f"{peer[0]} {qname} {TYPE_NAMES.get(qtype, qtype)} -> {RCODES[rcode]}{' aa' if aa else ''} an={len(an)} ns={len(ns)}")
        return build(m["id"], flags_of(aa=aa, rd=bool(m["rd"]), rcode=rcode), (qname, qtype), an, ns, ar)  # type: ignore[arg-type]
    serve_udp(a.listen, a.port, handle, "auth " + zone.origin)
    return 0


# ── iterative resolver with a cache ────────────────────────────────────

class Cache:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.entries: Dict[Tuple[str, int], Dict[str, object]] = {}

    def get(self, name: str, qtype: int) -> Optional[Dict[str, object]]:
        with self.lock:
            e = self.entries.get((name, qtype))
            if e and float(e["expires"]) > time.time():  # type: ignore[arg-type]
                return e
            if e:
                del self.entries[(name, qtype)]
            return None

    def put(self, name: str, qtype: int, rcode: int, answer: List[RR], authority: List[RR], ttl: int) -> None:
        if ttl <= 0:
            return
        with self.lock:
            self.entries[(name, qtype)] = {"rcode": rcode, "answer": answer, "authority": authority, "ttl": ttl, "stored": time.time(), "expires": time.time() + ttl}

    def dump(self) -> List[Dict[str, object]]:
        now = time.time()
        with self.lock:
            out = []
            for (name, qtype), e in sorted(self.entries.items()):
                left = int(float(e["expires"]) - now)  # type: ignore[arg-type]
                if left > 0:
                    out.append({"name": name, "type": TYPE_NAMES.get(qtype, qtype), "status": RCODES[int(e["rcode"])],  # type: ignore[arg-type]
                                "negative": not e["answer"], "ttl_left": left, "ttl_stored": e["ttl"],
                                "answer": [rr[3] for rr in e["answer"]]})  # type: ignore[union-attr]
            return out

    def flush(self, name: Optional[str]) -> int:
        with self.lock:
            keys = [k for k in self.entries if name is None or k[0] == name]
            for k in keys:
                del self.entries[k]
            return len(keys)


def ask(server: str, qname: str, qtype: int, rd: bool = False, timeout: float = 2.0, port: int = 53) -> Dict[str, object]:
    qid = random.randint(0, 0xFFFF)
    pkt = struct.pack("!HHHHHH", qid, 0x0100 if rd else 0, 1, 0, 0, 0) + enc_name(qname) + struct.pack("!HH", qtype, 1)
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.settimeout(timeout)
    try:
        s.sendto(pkt, (server, port))
        while True:
            data, _ = s.recvfrom(4096)
            m = parse(data)
            if m["id"] == qid:
                return m
    finally:
        s.close()


def run_resolver(a: argparse.Namespace) -> int:
    cache = Cache()
    root_zone = norm(a.root_zone)

    def resolve(qname: str, qtype: int, depth: int = 0) -> Tuple[int, List[RR], List[RR]]:
        hit = cache.get(qname, qtype)
        if hit:
            left = max(1, int(float(hit["expires"]) - time.time()))  # type: ignore[arg-type]
            an = [(n, t, min(ttl, left), rd) for n, t, ttl, rd in hit["answer"]]  # type: ignore[union-attr]
            ns = [(n, t, min(ttl, left), rd) for n, t, ttl, rd in hit["authority"]]  # type: ignore[union-attr]
            log("resolver", f"{qname} {TYPE_NAMES.get(qtype, qtype)} cache hit ({RCODES[int(hit['rcode'])]}, {left}s left)")  # type: ignore[arg-type]
            return int(hit["rcode"]), an, ns  # type: ignore[arg-type]
        if not in_zone(qname, root_zone) or depth > 4:
            return 5, [], []
        server = a.root
        for _step in range(8):
            try:
                m = ask(server, qname, qtype, rd=False, timeout=a.timeout)
            except (socket.timeout, OSError) as e:
                log("resolver", f"{qname}: no answer from {server} ({e})")
                return 2, [], []
            rcode = int(m["rcode"])  # type: ignore[arg-type]
            an, ns, ar = m["answer"], m["authority"], m["additional"]
            if m["aa"] or rcode == 3:
                if rcode == 0 and an:
                    cache.put(qname, qtype, 0, an, [], min(r[2] for r in an))  # type: ignore[union-attr]
                elif rcode in (0, 3):
                    soa = [r for r in ns if r[1] == 6]  # type: ignore[union-attr]
                    if soa:
                        neg = min(soa[0][2], soa[0][3][6])  # type: ignore[index]
                        cache.put(qname, qtype, rcode, [], soa, neg)
                log("resolver", f"{qname} {TYPE_NAMES.get(qtype, qtype)} from {server}: {RCODES.get(rcode, rcode)} (cached)")
                return rcode, an, ns  # type: ignore[return-value]
            nsrecs = [r for r in ns if r[1] == 2]  # type: ignore[union-attr]
            if rcode == 0 and nsrecs:
                glue = {r[0]: r[3] for r in ar if r[1] == 1}  # type: ignore[union-attr]
                nxt = None
                for r in nsrecs:
                    if r[3] in glue:
                        nxt = glue[r[3]]
                        break
                if nxt is None:
                    rc, a_an, _ = resolve(str(nsrecs[0][3]), 1, depth + 1)
                    addrs = [r[3] for r in a_an if r[1] == 1]
                    if rc != 0 or not addrs:
                        return 2, [], []
                    nxt = addrs[0]
                log("resolver", f"{qname}: referral from {server} to {nsrecs[0][0]} via {nxt}")
                server = str(nxt)
                continue
            return (rcode if rcode else 2), [], []
        return 2, [], []

    def handle(data: bytes, peer) -> Optional[bytes]:
        m = parse(data)
        if m["qr"] or not m["question"]:
            return None
        qname, qtype = m["question"][0]  # type: ignore[index]
        qname = norm(qname)
        rcode, an, ns = resolve(qname, qtype)
        log("resolver", f"{peer[0]} {qname} {TYPE_NAMES.get(qtype, qtype)} -> {RCODES.get(rcode, rcode)}")
        return build(m["id"], flags_of(rd=bool(m["rd"]), ra=True, rcode=rcode), (qname, qtype), an, ns, [])  # type: ignore[arg-type]

    class Control(BaseHTTPRequestHandler):
        def _send(self, code: int, obj) -> None:
            body = (json.dumps(obj, indent=1) + "\n").encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):  # noqa: N802
            if self.path.startswith("/cache"):
                return self._send(200, cache.dump())
            return self._send(404, {"error": "GET /cache, POST /flush?name=NAME or POST /flush"})

        def do_POST(self):  # noqa: N802
            if self.path.startswith("/flush"):
                name = None
                if "name=" in self.path:
                    name = norm(self.path.split("name=", 1)[1].split("&", 1)[0])
                n = cache.flush(name)
                log("resolver", f"cache flush {name or '(all)'}: {n} entr{'y' if n == 1 else 'ies'} removed")
                return self._send(200, {"flushed": n, "name": name})
            return self._send(404, {"error": "unknown"})

        def log_message(self, *_a) -> None:
            pass

    if a.control:
        host, port = a.control.rsplit(":", 1)
        srv = ThreadingHTTPServer((host, int(port)), Control)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        log("resolver", f"control on http://{a.control} (GET /cache, POST /flush?name=)")
    serve_udp(a.listen, a.port, handle, "resolver")
    return 0


# ── client commands ────────────────────────────────────────────────────

def fmt_rr(rr: RR) -> str:
    name, t, ttl, rd = rr
    if t == 6:
        rd = " ".join(str(x) for x in rd)  # type: ignore[union-attr]
    return f"{name:<28} {ttl:<6} IN {TYPE_NAMES.get(t, t):<5} {rd}"


def run_query(a: argparse.Namespace) -> int:
    server = a.server.lstrip("@")
    qtype = TYPES.get(a.type.upper())
    if qtype is None:
        print(f"unsupported type {a.type}", file=sys.stderr)
        return 2
    try:
        m = ask(server, norm(a.name), qtype, rd=not a.norec, timeout=a.timeout)
    except (socket.timeout, OSError) as e:
        print(f";; connection timed out; no servers could be reached ({server}: {e})")
        return 9
    fl = " ".join(f for f, on in (("qr", m["qr"]), ("aa", m["aa"]), ("rd", m["rd"]), ("ra", m["ra"])) if on)
    print(f";; ->>HEADER<<- opcode: QUERY, status: {RCODES.get(int(m['rcode']), m['rcode'])}, id: {m['id']}")  # type: ignore[arg-type]
    print(f";; flags: {fl}; QUERY: 1, ANSWER: {len(m['answer'])}, AUTHORITY: {len(m['authority'])}, ADDITIONAL: {len(m['additional'])}")  # type: ignore[arg-type]
    for title, key in (("ANSWER", "answer"), ("AUTHORITY", "authority"), ("ADDITIONAL", "additional")):
        if m[key]:
            print(f"\n;; {title} SECTION:")
            for rr in m[key]:  # type: ignore[union-attr]
                print(fmt_rr(rr))
    print(f"\n;; SERVER: {server}#53")
    if a.json:
        print(json.dumps({k: m[k] for k in ("rcode", "aa", "answer", "authority", "additional")}))
    return 0


def run_cachectl(a: argparse.Namespace) -> int:
    base = "http://" + a.control
    try:
        if a.action == "dump":
            with urllib.request.urlopen(base + "/cache", timeout=3) as r:
                sys.stdout.write(r.read().decode())
        else:
            url = base + "/flush" + (f"?name={a.name}" if a.name else "")
            with urllib.request.urlopen(urllib.request.Request(url, data=b"", method="POST"), timeout=3) as r:
                sys.stdout.write(r.read().decode())
    except OSError as e:
        print(f"cachectl: {base}: {e}", file=sys.stderr)
        return 1
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(prog="labdns")
    sub = p.add_subparsers(dest="cmd", required=True)
    pa = sub.add_parser("auth")
    pa.add_argument("--zone", required=True)
    pa.add_argument("--listen", required=True)
    pa.add_argument("--port", type=int, default=53)
    pr = sub.add_parser("resolver")
    pr.add_argument("--root", required=True, help="address of the root-hint (parent) authoritative server")
    pr.add_argument("--root-zone", default="corp.lab")
    pr.add_argument("--listen", required=True)
    pr.add_argument("--port", type=int, default=53)
    pr.add_argument("--control", default="", help="host:port for the HTTP cache control")
    pr.add_argument("--timeout", type=float, default=2.0)
    pq = sub.add_parser("query", prefix_chars="-+")
    pq.add_argument("server", help="@address")
    pq.add_argument("name")
    pq.add_argument("type", nargs="?", default="A")
    pq.add_argument("+norec", dest="norec", action="store_true")
    pq.add_argument("--norec", dest="norec", action="store_true")
    pq.add_argument("--timeout", type=float, default=3.0)
    pq.add_argument("--json", action="store_true")
    pc = sub.add_parser("cachectl")
    pc.add_argument("--control", default="10.55.2.10:8953")
    pc.add_argument("action", choices=["dump", "flush"])
    pc.add_argument("name", nargs="?")
    a = p.parse_args(argv)
    return {"auth": run_auth, "resolver": run_resolver, "query": run_query, "cachectl": run_cachectl}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
