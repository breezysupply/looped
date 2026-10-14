"""pgmini — a tiny PostgreSQL client in the Python standard library.

(Copy of labs/sre-cloud-foundations/L24/assets/pgmini.py so this lab is
self-contained, with one fix: an empty ParameterStatus value no longer
breaks the startup. L25 uses it for the consumers and the validator's logins.)

Enough of the frontend/backend protocol (v3) for the course's data labs:
startup, password authentication (trust, cleartext, md5, SCRAM-SHA-256),
optional TLS (sslmode=disable|prefer|require|verify-full), the simple query
protocol, and the error fields you need to explain a failure. No extended
protocol, no COPY, no binary formats: every value comes back as text (or
None for NULL).

It exists so the lab tools (pool client, fixture sessions, worker,
verify_restore.py) run with a plain `python3` and no pip install. For real
applications use psycopg; nothing here is tuned for production.

DSN forms:
  postgresql://user:password@host:port/dbname?sslmode=require&application_name=x
  "host=127.0.0.1 port=5432 user=beacon password=... dbname=beacon"
PGPASSWORD is used when the DSN has no password.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import socket
import ssl
import struct
import urllib.parse
from typing import Any, Dict, List, Optional, Tuple


class PgError(Exception):
    """A server ErrorResponse (fields: severity, code (SQLSTATE), message, detail, hint)."""

    def __init__(self, fields: Dict[str, str]) -> None:
        self.fields = fields
        self.code = fields.get("C", "")
        self.message = fields.get("M", "")
        super().__init__(f"{fields.get('S', 'ERROR')} {self.code}: {self.message}" + (f" ({fields['D']})" if fields.get("D") else ""))


class PgConnectionError(Exception):
    pass


def parse_dsn(dsn: str) -> Dict[str, str]:
    out: Dict[str, str] = {}
    if dsn.startswith("postgres://") or dsn.startswith("postgresql://"):
        u = urllib.parse.urlsplit(dsn)
        if u.username:
            out["user"] = urllib.parse.unquote(u.username)
        if u.password:
            out["password"] = urllib.parse.unquote(u.password)
        if u.hostname:
            out["host"] = u.hostname
        if u.port:
            out["port"] = str(u.port)
        if u.path and u.path != "/":
            out["dbname"] = urllib.parse.unquote(u.path.lstrip("/"))
        for k, v in urllib.parse.parse_qsl(u.query):
            out[k] = v
    else:
        for part in dsn.split():
            if "=" in part:
                k, v = part.split("=", 1)
                out[k.strip()] = v.strip().strip("'")
    out.setdefault("host", os.environ.get("PGHOST", "127.0.0.1"))
    out.setdefault("port", os.environ.get("PGPORT", "5432"))
    out.setdefault("user", os.environ.get("PGUSER", "postgres"))
    out.setdefault("dbname", os.environ.get("PGDATABASE", out["user"]))
    if "password" not in out and os.environ.get("PGPASSWORD"):
        out["password"] = os.environ["PGPASSWORD"]
    out.setdefault("sslmode", os.environ.get("PGSSLMODE", "prefer"))
    return out


def redact_dsn(dsn: str) -> str:
    """The DSN with any password replaced, for logs and evidence."""
    p = parse_dsn(dsn)
    return f"{p['user']}@{p['host']}:{p['port']}/{p['dbname']} sslmode={p['sslmode']}"


class Connection:
    def __init__(self, dsn: str, connect_timeout: float = 5.0, application_name: Optional[str] = None) -> None:
        self.params = parse_dsn(dsn)
        if application_name:
            self.params["application_name"] = application_name
        self.server: Dict[str, str] = {}
        self.pid: Optional[int] = None
        self.status = "I"  # I idle, T in transaction, E failed transaction
        self.closed = False
        host, port = self.params["host"], int(self.params["port"])
        try:
            raw = socket.create_connection((host, port), timeout=connect_timeout)
        except OSError as e:
            raise PgConnectionError(f"connect {host}:{port}: {e}") from e
        self.sock: Any = self._maybe_tls(raw, host)
        self.sock.settimeout(None)
        self._buf = b""
        self._startup()

    # ── transport ────────────────────────────────────────────────────
    def _maybe_tls(self, raw: socket.socket, host: str) -> Any:
        mode = self.params.get("sslmode", "prefer")
        if mode == "disable":
            return raw
        raw.sendall(struct.pack("!ii", 8, 80877103))  # SSLRequest
        answer = raw.recv(1)
        if answer != b"S":
            if mode in ("require", "verify-ca", "verify-full"):
                raw.close()
                raise PgConnectionError(f"server at {host} refused TLS but sslmode={mode}")
            return raw
        if mode in ("verify-ca", "verify-full"):
            ctx = ssl.create_default_context(cafile=self.params.get("sslrootcert") or None)
            ctx.check_hostname = mode == "verify-full"
        else:  # prefer/require: encrypted, not verified (same as libpq)
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
        return ctx.wrap_socket(raw, server_hostname=host)

    def _send(self, kind: bytes, payload: bytes) -> None:
        self.sock.sendall(kind + struct.pack("!i", len(payload) + 4) + payload)

    def _recv_exact(self, n: int) -> bytes:
        while len(self._buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                self.closed = True
                raise PgConnectionError("server closed the connection")
            self._buf += chunk
        out, self._buf = self._buf[:n], self._buf[n:]
        return out

    def _read(self) -> Tuple[bytes, bytes]:
        head = self._recv_exact(5)
        kind, length = head[:1], struct.unpack("!i", head[1:])[0]
        return kind, self._recv_exact(length - 4)

    @staticmethod
    def _fields(body: bytes) -> Dict[str, str]:
        out: Dict[str, str] = {}
        for part in body.split(b"\x00"):
            if part:
                out[chr(part[0])] = part[1:].decode("utf-8", "replace")
        return out

    # ── startup and authentication ───────────────────────────────────
    def _startup(self) -> None:
        kv = {"user": self.params["user"], "database": self.params["dbname"], "client_encoding": "UTF8"}
        if self.params.get("application_name"):
            kv["application_name"] = self.params["application_name"]
        body = struct.pack("!i", 196608) + b"".join(k.encode() + b"\x00" + v.encode() + b"\x00" for k, v in kv.items()) + b"\x00"
        self.sock.sendall(struct.pack("!i", len(body) + 4) + body)
        scram: Dict[str, Any] = {}
        while True:
            kind, body = self._read()
            if kind == b"R":
                code = struct.unpack("!i", body[:4])[0]
                if code == 0:
                    continue
                if code == 3:
                    self._send(b"p", self._password().encode() + b"\x00")
                elif code == 5:
                    salt = body[4:8]
                    inner = hashlib.md5((self._password() + self.params["user"]).encode()).hexdigest()
                    outer = hashlib.md5(inner.encode() + salt).hexdigest()
                    self._send(b"p", b"md5" + outer.encode() + b"\x00")
                elif code == 10:
                    mechs = [m.decode() for m in body[4:].split(b"\x00") if m]
                    if "SCRAM-SHA-256" not in mechs:
                        raise PgConnectionError(f"unsupported SASL mechanisms {mechs}")
                    scram["cnonce"] = base64.b64encode(secrets.token_bytes(18)).decode()
                    scram["first_bare"] = "n=,r=" + scram["cnonce"]
                    first = ("n,," + scram["first_bare"]).encode()
                    self._send(b"p", b"SCRAM-SHA-256\x00" + struct.pack("!i", len(first)) + first)
                elif code == 11:
                    server_first = body[4:].decode()
                    attrs = dict(a.split("=", 1) for a in server_first.split(","))
                    if not attrs["r"].startswith(scram["cnonce"]):
                        raise PgConnectionError("SCRAM nonce mismatch")
                    salted = hashlib.pbkdf2_hmac("sha256", self._password().encode(), base64.b64decode(attrs["s"]), int(attrs["i"]))
                    client_key = hmac.new(salted, b"Client Key", hashlib.sha256).digest()
                    stored = hashlib.sha256(client_key).digest()
                    without_proof = "c=biws,r=" + attrs["r"]
                    auth_msg = (scram["first_bare"] + "," + server_first + "," + without_proof).encode()
                    sig = hmac.new(stored, auth_msg, hashlib.sha256).digest()
                    proof = bytes(a ^ b for a, b in zip(client_key, sig))
                    server_key = hmac.new(salted, b"Server Key", hashlib.sha256).digest()
                    scram["server_sig"] = base64.b64encode(hmac.new(server_key, auth_msg, hashlib.sha256).digest()).decode()
                    self._send(b"p", (without_proof + ",p=" + base64.b64encode(proof).decode()).encode())
                elif code == 12:
                    final = dict(a.split("=", 1) for a in body[4:].decode().split(","))
                    if final.get("v") != scram.get("server_sig"):
                        raise PgConnectionError("SCRAM server signature mismatch")
                else:
                    raise PgConnectionError(f"unsupported authentication request {code}")
            elif kind == b"S":
                # key\0value\0 — the value may be empty (application_name), so split, don't rstrip
                k, v = body.split(b"\x00")[:2]
                self.server[k.decode()] = v.decode()
            elif kind == b"K":
                self.pid = struct.unpack("!i", body[:4])[0]
            elif kind == b"E":
                raise PgError(self._fields(body))
            elif kind == b"Z":
                self.status = body.decode()
                return

    def _password(self) -> str:
        pw = self.params.get("password")
        if pw is None:
            raise PgConnectionError("server asked for a password; put it in the DSN or PGPASSWORD")
        return pw

    # ── queries ──────────────────────────────────────────────────────
    def query(self, sql: str) -> List[Tuple[Optional[str], ...]]:
        """Run one or more statements; return the rows of the LAST statement that returned rows.
        Raises PgError for a server error (the connection stays usable)."""
        rows, _ = self.execute(sql)
        return rows

    def execute(self, sql: str) -> Tuple[List[Tuple[Optional[str], ...]], List[str]]:
        if self.closed:
            raise PgConnectionError("connection is closed")
        self._send(b"Q", sql.encode("utf-8") + b"\x00")
        rows: List[Tuple[Optional[str], ...]] = []
        current: List[Tuple[Optional[str], ...]] = []
        tags: List[str] = []
        error: Optional[PgError] = None
        while True:
            kind, body = self._read()
            if kind == b"T":
                current = []
            elif kind == b"D":
                n = struct.unpack("!h", body[:2])[0]
                pos, vals = 2, []
                for _ in range(n):
                    ln = struct.unpack("!i", body[pos:pos + 4])[0]
                    pos += 4
                    if ln < 0:
                        vals.append(None)
                    else:
                        vals.append(body[pos:pos + ln].decode("utf-8", "replace"))
                        pos += ln
                current.append(tuple(vals))
            elif kind == b"C":
                tags.append(body.rstrip(b"\x00").decode())
                if current:
                    rows = current
                current = []
            elif kind == b"E":
                error = PgError(self._fields(body))
            elif kind == b"Z":
                self.status = body.decode()
                if error:
                    raise error
                return rows, tags
            # N (notice), S (parameter), I (empty query), A (notification) are ignored

    def scalar(self, sql: str) -> Optional[str]:
        rows = self.query(sql)
        return rows[0][0] if rows and rows[0] else None

    def close(self) -> None:
        if self.closed:
            return
        try:
            self._send(b"X", b"")
        except OSError:
            pass
        try:
            self.sock.close()
        finally:
            self.closed = True


def connect(dsn: str, connect_timeout: float = 5.0, application_name: Optional[str] = None) -> Connection:
    return Connection(dsn, connect_timeout=connect_timeout, application_name=application_name)


def literal(value: Any) -> str:
    """Quote a Python value as an SQL literal (the simple protocol has no parameters)."""
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return repr(value)
    s = str(value)
    if "\x00" in s:
        raise ValueError("NUL byte in literal")
    return "'" + s.replace("'", "''") + "'"


def ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'
