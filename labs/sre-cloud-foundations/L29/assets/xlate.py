#!/usr/bin/env python3
"""xlate.py — check an AWS -> Azure/GCP translation worksheet (L29).

    python3 xlate.py WORKSHEET.yaml            findings, one per line; exit 0 if none, 1 otherwise
    python3 xlate.py WORKSHEET.yaml --json     the same as JSON
    python3 xlate.py --claims                  the curated claims you must judge (no answers)

What it checks (and what it cannot):
  structure   schema looped.xlate/v1; providers azure and gcp; required rows, matrix, assumptions
  references  each row's aws_ref is an id in L09's inventory (the D01/L09 design you translate)
  scopes      the few scope facts that are unambiguous (e.g. which providers' networks are global)
  claims      every curated claim in claims.json is judged, with a stated difference that names
              the deciding fact, and a source id from the course source register (LX.sreSources)
  phrasing    known wrong-equivalence phrasings anywhere in rows or the matrix
              ("X is the same as Y", "regional in all three", ...) unless the sentence negates them
  honesty     a limits statement, and no claim of hands-on cloud proficiency

It is a teaching aid with a curated list, not a judge of cloud architecture: it cannot tell
whether free text is right, only whether known wrong equivalences appear and required facts are
stated. The rubric in README.md covers the rest.

The worksheet uses a YAML SUBSET (parsed here with the standard library): nested maps, lists
("- "), lists of maps, "|" block scalars, [a, b] flow lists of plain words, quoted or plain
scalars, and # comments. Anchors, tags, multi-document files and flow maps are not supported;
the parser says which line it could not read.
"""
from __future__ import annotations

import json
import os
import re
import sys
from typing import Any, Dict, List, Optional, Tuple

HERE = os.path.dirname(os.path.abspath(__file__))
SRE = os.path.abspath(os.path.join(HERE, "..", ".."))
REPO = os.path.abspath(os.path.join(SRE, "..", ".."))
VERDICTS = ("holds", "partly", "does-not-hold")


class XlateError(Exception):
    pass


# ── YAML subset ────────────────────────────────────────────────────────────

KEY = re.compile(r"^([A-Za-z0-9_][\w./-]*)\s*:(?:\s+(.*?))?\s*$")


def _indent(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def _significant(line: str) -> bool:
    s = line.strip()
    return bool(s) and not s.startswith("#")


def _scalar(text: str, lineno: int) -> Any:
    t = text.strip()
    if not t:
        return None
    if t[0] == '"':
        m = re.match(r'^("(?:[^"\\]|\\.)*")\s*(#.*)?$', t)
        if not m:
            raise XlateError(f"line {lineno}: unterminated double-quoted string")
        return json.loads(m.group(1))
    if t[0] == "'":
        m = re.match(r"^'((?:[^']|'')*)'\s*(#.*)?$", t)
        if not m:
            raise XlateError(f"line {lineno}: unterminated single-quoted string")
        return m.group(1).replace("''", "'")
    if t[0] == "[":
        if not t.rstrip().endswith("]"):
            t = re.sub(r"\s+#.*$", "", t)
        if not t.endswith("]"):
            raise XlateError(f"line {lineno}: flow list must close on the same line")
        inner = t[1:-1].strip()
        return [] if not inner else [_scalar(x, lineno) for x in inner.split(",")]
    if t[0] in "{&*!|>":
        raise XlateError(f"line {lineno}: '{t[0]}' is not supported by this YAML subset")
    t = re.sub(r"\s+#.*$", "", t)
    low = t.lower()
    if low in ("true", "false"):
        return low == "true"
    if low in ("null", "~"):
        return None
    if re.fullmatch(r"-?\d+", t):
        return int(t)
    return t


class _Parser:
    def __init__(self, text: str) -> None:
        self.lines = text.replace("\t", "    ").splitlines()

    def next_sig(self, i: int) -> int:
        while i < len(self.lines) and not _significant(self.lines[i]):
            i += 1
        return i

    def parse(self) -> Any:
        i = self.next_sig(0)
        if i >= len(self.lines):
            raise XlateError("worksheet is empty")
        val, i = self.block(i, _indent(self.lines[i]))
        i = self.next_sig(i)
        if i < len(self.lines):
            raise XlateError(f"line {i + 1}: unexpected indentation or content: {self.lines[i].strip()[:60]!r}")
        return val

    def block(self, i: int, ind: int) -> Tuple[Any, int]:
        if self.lines[i].lstrip().startswith("- ") or self.lines[i].strip() == "-":
            return self.seq(i, ind)
        return self.mapping(i, ind)

    def block_scalar(self, i: int, ind: int, style: str) -> Tuple[str, int]:
        body: List[str] = []
        j = i
        while j < len(self.lines) and (not self.lines[j].strip() or _indent(self.lines[j]) > ind):
            body.append(self.lines[j])
            j += 1
        while body and not body[-1].strip():
            body.pop()
        nonblank = [ln for ln in body if ln.strip()]
        cut = min((_indent(ln) for ln in nonblank), default=0)
        text = "\n".join(ln[cut:] if ln.strip() else "" for ln in body)
        if style.startswith(">"):
            text = re.sub(r"(?<!\n)\n(?!\n)", " ", text)
        if not style.endswith("-"):
            text += "\n"
        return text, j

    def value_after_key(self, rest: Optional[str], i: int, ind: int, lineno: int) -> Tuple[Any, int]:
        if rest in ("|", "|-", ">", ">-"):
            return self.block_scalar(i + 1, ind, rest)
        if rest:
            return _scalar(rest, lineno), i + 1
        j = self.next_sig(i + 1)
        if j < len(self.lines):
            cind = _indent(self.lines[j])
            if cind > ind or (cind == ind and self.lines[j].lstrip().startswith("- ")):
                return self.block(j, cind)
        return None, i + 1

    def mapping(self, i: int, ind: int) -> Tuple[Dict[str, Any], int]:
        out: Dict[str, Any] = {}
        while True:
            i = self.next_sig(i)
            if i >= len(self.lines) or _indent(self.lines[i]) < ind:
                return out, i
            line = self.lines[i]
            if _indent(line) > ind:
                raise XlateError(f"line {i + 1}: unexpected indentation (expected {ind} spaces)")
            if line.lstrip().startswith("- "):
                return out, i
            m = KEY.match(line.strip())
            if not m:
                raise XlateError(f"line {i + 1}: expected 'key: value', got {line.strip()[:60]!r}")
            key, rest = m.group(1), m.group(2)
            if rest is not None and rest.startswith("#"):
                rest = None
            if key in out:
                raise XlateError(f"line {i + 1}: duplicate key {key!r}")
            out[key], i = self.value_after_key(rest, i, ind, i + 1)

    def seq(self, i: int, ind: int) -> Tuple[List[Any], int]:
        out: List[Any] = []
        while True:
            i = self.next_sig(i)
            if i >= len(self.lines) or _indent(self.lines[i]) != ind or not (self.lines[i].lstrip().startswith("- ") or self.lines[i].strip() == "-"):
                if i < len(self.lines) and _indent(self.lines[i]) > ind:
                    raise XlateError(f"line {i + 1}: unexpected indentation inside a list")
                return out, i
            m = re.match(r"^(\s*)-(\s*)(.*)$", self.lines[i])
            content = m.group(3)
            if not content:
                j = self.next_sig(i + 1)
                if j < len(self.lines) and _indent(self.lines[j]) > ind:
                    val, i = self.block(j, _indent(self.lines[j]))
                else:
                    val, i = None, i + 1
                out.append(val)
                continue
            col = len(m.group(1)) + 1 + len(m.group(2))
            if KEY.match(content) and not content.startswith(("'", '"')):
                self.lines[i] = " " * col + content
                val, i = self.mapping(i, col)
            else:
                val, i = _scalar(content, i + 1), i + 1
            out.append(val)


def load_yaml_subset(text: str) -> Any:
    return _Parser(text).parse()


# ── reference data ─────────────────────────────────────────────────────────

def load_json(name: str) -> Any:
    with open(os.path.join(HERE, name), encoding="utf-8") as fh:
        return json.load(fh)


def source_ids() -> List[str]:
    """Ids of LX.sreSources, read from the course data file (assets/js/data/sre-track.js)."""
    path = os.path.join(REPO, "assets", "js", "data", "sre-track.js")
    try:
        with open(path, encoding="utf-8") as fh:
            src = fh.read()
    except OSError:
        return []
    block = src[src.find("sreSources"):]
    return sorted(set(re.findall(r"\{\s*id:\s*'([A-Z]+\d+)'\s*,\s*kind:", block)))


def l09_ids() -> List[str]:
    path = os.path.join(SRE, "L09", "assets", "draft-inventory.json")
    try:
        with open(path, encoding="utf-8") as fh:
            inv = json.load(fh)
    except (OSError, ValueError):
        return []
    ids = [inv.get("vpc", {}).get("id", ""), inv.get("region", ""), "account"]
    for k in ("subnets", "route_tables", "gateways", "endpoints", "external", "components", "iam_roles"):
        ids += [x.get("id", "") for x in inv.get(k, []) if isinstance(x, dict)]
    return sorted(i for i in set(ids) if i)


# ── checks ─────────────────────────────────────────────────────────────────

EQUIV = re.compile(r"\bsame (thing |object |kind of object )?as\b|\bidentical\b|==|\bequivalent\b|\bone-to-one\b|\b1:1\b|\bdrop-in\b|\bexactly like\b|\bis just\b|\bmaps directly\b", re.I)
NEGATION = re.compile(r"\bnot\b|\bno\b|n't\b|\bunlike\b|\bdiffer|\bneither\b|\bnever\b|\bwrong\b|\bmyth\b|\bassum", re.I)
CLAIM_OF_PROFICIENCY = re.compile(
    r"\b(i|we)\s+(have\s+|'ve\s+)?(deployed|operated|run|ran|managed|administered|built)\b[^.\n]{0,60}\b(azure|gcp|google cloud|aks|gke|eks|aws)\b"
    r"|\bproduction experience\b|\byears of (hands-on )?experience\b|\b(i am|i'm|we are)\s+(an?\s+)?(certified|expert|proficient)\b", re.I)


def sentences(text: str) -> List[str]:
    return [s.strip() for s in re.split(r"[.;\n]+", text or "") if s.strip()]


def text_of(v: Any) -> str:
    if isinstance(v, str):
        return v
    if isinstance(v, list):
        return " ".join(text_of(x) for x in v)
    if isinstance(v, dict):
        return " ".join(text_of(x) for x in v.values())
    return "" if v is None else str(v)


def phrasing_findings(ws: Dict[str, Any], claims: List[Dict[str, Any]]) -> List[str]:
    """Known wrong-equivalence phrasings in rows, matrix and diagrams' free text."""
    found = []
    places: List[Tuple[str, str]] = []
    for prov in ("azure", "gcp"):
        p = (ws.get("providers") or {}).get(prov) or {}
        for n, row in enumerate(p.get("rows") or []):
            if isinstance(row, dict):
                places.append((f"{prov} row {row.get('concept', n + 1)}", " . ".join(text_of(row.get(k)) for k in ("aws", "target", "difference"))))
    for n, row in enumerate(ws.get("responsibility") or []):
        if isinstance(row, dict):
            places.append((f"matrix {row.get('concern', n + 1)}", " . ".join(text_of(v) for k, v in row.items() if k != "concern")))
    for where, text in places:
        for s in sentences(text):
            if NEGATION.search(s):
                continue
            low = s.lower()
            for c in claims:
                eq = c.get("equivalence") or {}
                a, b = eq.get("a") or [], eq.get("b") or []
                if a and b and EQUIV.search(s) and any(x in low for x in a) and any(x in low for x in b):
                    found.append(f"{where}: treats {a[0]} and {b[0]} as equivalent ({c['id']}): {s[:90]!r}")
                for pat in c.get("flags") or []:
                    if re.search(pat, s, re.I):
                        found.append(f"{where}: wrong-equivalence phrasing ({c['id']}): {s[:90]!r}")
    return sorted(set(found))


def check(ws: Any) -> Dict[str, List[str]]:
    """Findings per area; empty lists mean that area is clean."""
    facts = load_json("facts.json")
    claims = load_json("claims.json")["claims"]
    srcs = source_ids()
    refs = l09_ids()
    out: Dict[str, List[str]] = {k: [] for k in ("structure", "references", "scopes", "diagrams", "matrix", "claims", "phrasing", "honesty")}
    if not isinstance(ws, dict) or ws.get("schema") != "looped.xlate/v1":
        out["structure"].append("top level must be a map with schema: looped.xlate/v1")
        return out
    provs = ws.get("providers") or {}
    for prov in ("azure", "gcp"):
        p = provs.get(prov)
        if not isinstance(p, dict):
            out["structure"].append(f"providers.{prov} missing")
            continue
        rows = [r for r in (p.get("rows") or []) if isinstance(r, dict)]
        by = {r.get("concept"): r for r in rows}
        for concept in facts["concepts"]:
            r = by.get(concept)
            if not r:
                out["structure"].append(f"{prov}: no row for concept {concept}")
                continue
            for k, n in (("target", 8), ("difference", 30), ("aws", 8)):
                if not isinstance(r.get(k), str) or len(r[k].strip()) < n:
                    out["structure"].append(f"{prov}/{concept}: {k} missing or under {n} chars")
            if r.get("aws_ref") not in refs:
                out["references"].append(f"{prov}/{concept}: aws_ref {r.get('aws_ref')!r} is not an id in L09's inventory")
        for key, want in facts["scopes"].items():
            fprov, concept = key.split(".", 1)
            if fprov != prov or concept not in by:
                continue
            got = str(by[concept].get("scope", "")).strip().lower()
            if got not in want:
                out["scopes"].append(f"{prov}/{concept}: scope {got or 'missing'!r} — re-check how far this object reaches in {prov}")
        d = p.get("diagram")
        dl = (d or "").lower() if isinstance(d, str) else ""
        lines = [ln for ln in dl.splitlines() if ln.strip()]
        need = facts["diagram_terms"]["all"] + facts["diagram_terms"].get(prov, [])
        miss = [t for t in need if not any(alt in dl for alt in t.split("|"))]
        if len(lines) < 8 or dl.count("-->") + dl.count("---") + dl.count("-.->") < 6 or miss:
            out["diagrams"].append(f"{prov}: diagram has {len(lines)} lines, {dl.count('-->') + dl.count('---') + dl.count('-.->')} edges; missing {miss}")
    mrows = {r.get("concern"): r for r in (ws.get("responsibility") or []) if isinstance(r, dict)}
    for concern in facts["concerns"]:
        r = mrows.get(concern)
        if not r:
            out["matrix"].append(f"responsibility: no row for {concern}")
            continue
        thin = [k for k in ("aws", "azure", "gcp", "provider_owns", "operator_owns") if not isinstance(r.get(k), str) or len(r[k].strip()) < 15]
        if thin:
            out["matrix"].append(f"responsibility/{concern}: {thin} missing or under 15 chars")
    rows = {}
    for r in ws.get("assumptions") or []:
        if isinstance(r, dict) and r.get("claim_id"):
            rows[r["claim_id"]] = r
    for c in claims:
        r = rows.get(c["id"])
        if not r:
            out["claims"].append(f"{c['id']}: not judged")
            continue
        v = str(r.get("verdict", "")).strip().lower()
        if v not in VERDICTS:
            out["claims"].append(f"{c['id']}: verdict must be one of {', '.join(VERDICTS)}")
        elif v != c["expect"]:
            out["claims"].append(f"{c['id']}: verdict disputed — check the claim against {', '.join(c['sources'])}")
        diff = r.get("difference") if isinstance(r.get("difference"), str) else ""
        if len(diff.strip()) < 60:
            out["claims"].append(f"{c['id']}: difference missing or under 60 chars")
        else:
            low = diff.lower()
            gaps = [g for g in c.get("must_mention", []) if not any(alt in low for alt in g.split("|"))]
            if gaps:
                out["claims"].append(f"{c['id']}: the difference does not yet name the deciding fact ({len(gaps)} missing)")
        s = r.get("sources")
        s = [s] if isinstance(s, str) else (s or [])
        bad = [x for x in s if x not in srcs]
        if not s or bad:
            out["claims"].append(f"{c['id']}: sources {s} must be ids from LX.sreSources{'; unknown ' + str(bad) if bad else ''}")
        elif not set(s) & set(c["sources"]):
            out["claims"].append(f"{c['id']}: cite at least one of {c['sources']}")
    out["phrasing"] = phrasing_findings(ws, claims)
    lim = ws.get("limits")
    if not isinstance(lim, str) or len(lim.strip()) < 80:
        out["honesty"].append("limits: say in 80+ characters what this paper translation does not prove")
    for s in sentences(text_of(ws)):
        if CLAIM_OF_PROFICIENCY.search(s) and not NEGATION.search(s):
            out["honesty"].append(f"claims hands-on cloud proficiency: {s[:90]!r}")
    return out


def main(argv: List[str]) -> int:
    if "--claims" in argv:
        for c in load_json("claims.json")["claims"]:
            print(f"{c['id']}  [{c['topic']}]  {c['claim']}")
        return 0
    paths = [a for a in argv if not a.startswith("--")]
    if len(paths) != 1:
        print(__doc__.split("\n\n")[1])
        return 2
    try:
        with open(paths[0], encoding="utf-8") as fh:
            ws = load_yaml_subset(fh.read())
    except (OSError, XlateError) as e:
        print(f"cannot read worksheet: {e}")
        return 1
    res = check(ws)
    if "--json" in argv:
        print(json.dumps(res, indent=2))
    else:
        for area, items in res.items():
            for it in items:
                print(f"{area:10s} {it}")
        n = sum(len(v) for v in res.values())
        print(f"{n} finding(s)" if n else "no findings")
    return 0 if not any(res.values()) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
