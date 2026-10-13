"""Beacon configuration: a small YAML subset, JSON, environment overrides.

Beacon deliberately depends only on the Python standard library so the host
labs (L01–L06) need nothing installed. The YAML reader therefore handles the
subset the course uses — nested maps with two-space indentation, scalars,
quoted strings, numbers, booleans, comments — and refuses anything else with
a clear error naming the line. JSON configs are read with the real parser.

Resolution order (later wins): defaults → file → BEACON_* environment →
command-line flags. Every effective value is logged at startup (secrets are
redacted) so "what did it actually run with" is never a mystery.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple


class ConfigError(Exception):
    """Raised for a missing or malformed configuration file."""


DEFAULTS: Dict[str, Any] = {
    "server": {"listen": "0.0.0.0", "port": 8080, "request_timeout_s": 10},
    "app": {"version": "1.4.0", "environment": "lab", "admin_enabled": False},
    "store": {"kind": "memory", "path": "", "url": ""},
    "queue": {"kind": "none", "dir": "", "url": "", "name": "beacon-jobs"},
    "inject": {"delay_ms": 0, "fail_rate": 0.0, "ready_fail": False},
    "worker": {"poll_s": 1.0, "idempotency": True, "effects_path": ""},
}

SECRET_KEYS = ("url", "password", "token", "secret", "key")


def _scalar(raw: str, line_no: int) -> Any:
    s = raw.strip()
    if s == "" or s == "~" or s == "null":
        return None
    if (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
        return s[1:-1]
    if s.lower() in ("true", "yes", "on"):
        return True
    if s.lower() in ("false", "no", "off"):
        return False
    try:
        if "." in s:
            return float(s)
        return int(s)
    except ValueError:
        pass
    if s.startswith("[") or s.startswith("{"):
        raise ConfigError(f"line {line_no}: inline lists/maps are not supported by Beacon's YAML subset")
    return s


def parse_yaml_subset(text: str) -> Dict[str, Any]:
    """Parse nested maps of scalars. Lists are not supported (and not needed)."""
    root: Dict[str, Any] = {}
    stack: List[Tuple[int, Dict[str, Any]]] = [(-1, root)]
    for i, raw in enumerate(text.splitlines(), start=1):
        if "\t" in raw.split("#", 1)[0]:
            raise ConfigError(f"line {i}: tab character in indentation (YAML requires spaces)")
        line = raw.split("#", 1)[0].rstrip() if not raw.lstrip().startswith("#") else ""
        if not line.strip():
            continue
        if raw.startswith(("<<<<<<<", "=======", ">>>>>>>")):
            raise ConfigError(f"line {i}: unresolved merge conflict marker")
        indent = len(line) - len(line.lstrip(" "))
        if indent % 2:
            raise ConfigError(f"line {i}: indentation of {indent} is not a multiple of two")
        if line.lstrip().startswith("- "):
            raise ConfigError(f"line {i}: lists are not supported by Beacon's YAML subset")
        if ":" not in line:
            raise ConfigError(f"line {i}: expected 'key: value'")
        key, _, value = line.strip().partition(":")
        key = key.strip()
        if not key:
            raise ConfigError(f"line {i}: empty key")
        while stack and indent <= stack[-1][0]:
            stack.pop()
        if not stack:
            raise ConfigError(f"line {i}: indentation does not match any parent")
        parent = stack[-1][1]
        if key in parent:
            raise ConfigError(f"line {i}: duplicate key '{key}' at this level")
        if value.strip() == "":
            child: Dict[str, Any] = {}
            parent[key] = child
            stack.append((indent, child))
        else:
            parent[key] = _scalar(value, i)
    return root


def load_file(path: str) -> Dict[str, Any]:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            text = fh.read()
    except FileNotFoundError:
        raise ConfigError(f"open {path}: no such file or directory")
    except PermissionError:
        raise ConfigError(f"open {path}: permission denied")
    if path.endswith(".json"):
        try:
            data = json.loads(text)
        except json.JSONDecodeError as e:
            raise ConfigError(f"{path}:{e.lineno}: {e.msg}")
        if not isinstance(data, dict):
            raise ConfigError(f"{path}: top level must be an object")
        return data
    try:
        return parse_yaml_subset(text)
    except ConfigError as e:
        raise ConfigError(f"{path}:{e}")


def _merge(base: Dict[str, Any], over: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(base)
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


def _env_overrides(environ: Dict[str, str]) -> Dict[str, Any]:
    """BEACON_SERVER_PORT=9090 → {"server": {"port": 9090}} (two levels)."""
    out: Dict[str, Any] = {}
    for name, value in environ.items():
        if not name.startswith("BEACON_"):
            continue
        parts = name[len("BEACON_"):].lower().split("_", 1)
        if len(parts) != 2:
            continue
        section, key = parts
        if section not in DEFAULTS:
            continue
        out.setdefault(section, {})[key] = _scalar(value, 0)
    return out


@dataclass
class Config:
    data: Dict[str, Any] = field(default_factory=dict)
    source: str = "defaults"

    def get(self, section: str, key: str, default: Any = None) -> Any:
        return self.data.get(section, {}).get(key, default)

    def redacted(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {}
        for section, values in self.data.items():
            if not isinstance(values, dict):
                out[section] = values
                continue
            out[section] = {k: ("<redacted>" if any(s in k for s in SECRET_KEYS) and v else v) for k, v in values.items()}
        return out


def validate(data: Dict[str, Any]) -> List[str]:
    """Semantic checks a parser cannot do. Returns a list of problems."""
    problems: List[str] = []
    srv = data.get("server", {})
    port = srv.get("port")
    if not isinstance(port, int) or isinstance(port, bool) or not (0 <= port <= 65535):
        problems.append(f"server.port must be an integer 0–65535, got {port!r} ({type(port).__name__})")
    listen = srv.get("listen")
    if not isinstance(listen, str) or not listen:
        problems.append(f"server.listen must be a non-empty string, got {listen!r}")
    kind = data.get("store", {}).get("kind")
    if kind not in ("memory", "sqlite", "postgres"):
        problems.append(f"store.kind must be memory, sqlite or postgres, got {kind!r}")
    if kind == "sqlite" and not data.get("store", {}).get("path"):
        problems.append("store.path is required when store.kind is sqlite")
    if kind == "postgres" and not data.get("store", {}).get("url"):
        problems.append("store.url is required when store.kind is postgres (BEACON_STORE_URL)")
    q = data.get("queue", {}).get("kind")
    if q not in ("none", "dir", "redis"):
        problems.append(f"queue.kind must be none, dir or redis, got {q!r}")
    inj = data.get("inject", {})
    fr = inj.get("fail_rate", 0.0)
    if not isinstance(fr, (int, float)) or isinstance(fr, bool) or not (0.0 <= float(fr) <= 1.0):
        problems.append(f"inject.fail_rate must be between 0 and 1, got {fr!r}")
    for section in data:
        if section not in DEFAULTS:
            problems.append(f"unknown top-level section '{section}' (did indentation put a key at the wrong level?)")
    return problems


def load(path: Optional[str], environ: Optional[Dict[str, str]] = None, overrides: Optional[Dict[str, Dict[str, Any]]] = None) -> Config:
    environ = os.environ if environ is None else environ
    data = dict(DEFAULTS)
    source = "defaults"
    if path:
        data = _merge(data, load_file(path))
        source = path
    data = _merge(data, _env_overrides(environ))
    if overrides:
        data = _merge(data, overrides)
    problems = validate(data)
    if problems:
        raise ConfigError("; ".join(problems))
    return Config(data=data, source=source)
