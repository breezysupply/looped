"""Verify a directory of release artifacts against a SHA-256 manifest.

Reference solution for labs/python/03-artifact-manifest. Read EXPLANATION.md
next to this file for the walkthrough.

Usage:
    python3 manifest_check.py BUNDLE_DIR MANIFEST_JSON

Manifest format:
    {"files": [{"path": "bin/app", "sha256": "<64 hex chars>", "size": 123}, ...]}
    `size` is optional. Paths are relative, use forward slashes, and name files
    inside BUNDLE_DIR.

Exit codes:
    0  every file matches and nothing unexpected is present
    1  problems found (missing, duplicate, unexpected, unsafe, mismatched)
    2  the manifest is malformed, or the bundle/manifest cannot be read

IMPORTANT: a clean result proves the files match *this manifest*. It does not
prove who wrote the manifest. See EXPLANATION.md, "What a checksum does not
prove".
"""
from __future__ import annotations

import hashlib
import json
import os
import string
import sys
from dataclasses import dataclass, field
from typing import List, NamedTuple

# 64 KiB per read: large enough that per-call overhead is negligible, small
# enough that a 4 GB image never needs 4 GB of RAM.
CHUNK_SIZE = 64 * 1024

HEX_DIGITS = frozenset(string.hexdigits)  # 0-9, a-f and A-F


class MalformedManifest(ValueError):
    """The manifest is not valid JSON or does not have the documented shape."""


class Mismatch(NamedTuple):
    """One file whose contents differ from the manifest.

    field is "size" or "sha256". A NamedTuple is a tuple (cheap, immutable,
    compares by value) whose items also have names, so the report can say
    m.expected rather than m[2].
    """

    path: str
    field: str
    expected: object
    actual: object


@dataclass
class Report:
    """Result of check(). Every list is sorted, so output is deterministic."""

    missing: List[str] = field(default_factory=list)       # in manifest, not on disk
    duplicates: List[str] = field(default_factory=list)    # listed more than once
    unexpected: List[str] = field(default_factory=list)    # on disk, not in manifest
    unsafe: List[str] = field(default_factory=list)        # would escape the bundle
    mismatched: List[Mismatch] = field(default_factory=list)
    verified: List[str] = field(default_factory=list)      # present and matching

    # field(default_factory=list), not `= []`: a mutable default would be one
    # list shared by every Report ever created.

    @property
    def ok(self) -> bool:
        """True only if nothing at all is wrong."""
        return not (self.missing or self.duplicates or self.unexpected or self.unsafe or self.mismatched)


# ---------------------------------------------------------------------------
# Manifest parsing
# ---------------------------------------------------------------------------


def load_manifest(manifest_path: str) -> list:
    """Parse and validate the manifest; return its list of entries.

    Each entry comes back as {"path": str, "sha256": lowercase hex, "size": int|None}.
    Raises MalformedManifest on any structural problem. OSError (file
    missing) propagates unchanged.
    """
    with open(manifest_path, encoding="utf-8") as fh:
        try:
            doc = json.load(fh)
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise MalformedManifest(f"{manifest_path}: not valid JSON: {exc}") from exc

    if not isinstance(doc, dict):
        raise MalformedManifest(f"top level must be an object, got {type(doc).__name__}")
    files = doc.get("files")
    if not isinstance(files, list):
        raise MalformedManifest("'files' must be present and be a list")

    entries = []
    for i, entry in enumerate(files):
        where = f"files[{i}]"
        if not isinstance(entry, dict):
            raise MalformedManifest(f"{where}: must be an object, got {type(entry).__name__}")
        path = entry.get("path")
        if not isinstance(path, str):
            raise MalformedManifest(f"{where}: 'path' must be a string")
        digest = entry.get("sha256")
        # Validate the digest shape here, so a typo'd manifest fails loudly as
        # malformed instead of producing a confusing "mismatch" later.
        if not isinstance(digest, str) or len(digest) != 64 or not set(digest) <= HEX_DIGITS:
            raise MalformedManifest(f"{where} ({path!r}): 'sha256' must be 64 hex characters")
        size = entry.get("size")
        if size is not None and (isinstance(size, bool) or not isinstance(size, int) or size < 0):
            raise MalformedManifest(f"{where} ({path!r}): 'size' must be a non-negative integer")
        # Normalise case ONCE, at the edge. hexdigest() is lowercase; some
        # tools (and Windows' certutil) print uppercase. Both mean the same bytes.
        entries.append({"path": path, "sha256": digest.lower(), "size": size})
    return entries


# ---------------------------------------------------------------------------
# Path safety
# ---------------------------------------------------------------------------


def is_safe_relpath(path: str) -> bool:
    """Decide from the STRING ALONE whether a manifest path is acceptable.

    No filesystem access happens here. Rejected:
      - empty paths and NUL bytes
      - absolute paths ("/etc/passwd")
      - backslashes ("..\\x", "C:\\x"): on Windows these are separators, so
        allowing them would reopen the traversal hole on the other OS
      - any "..", "." or empty segment ("a/../b", "./a", "a//b"). ".." is the
        attack; "." and "" are rejected so that every file has exactly one
        spelling and duplicate detection cannot be dodged ("a" vs "./a").
    """
    if not path or "\x00" in path or "\\" in path or path.startswith("/"):
        return False
    return all(part not in ("", ".", "..") for part in path.split("/"))


def _inside(root_real: str, candidate: str) -> bool:
    """True if `candidate`, with symlinks resolved, is root_real or below it.

    os.path.commonpath compares whole path components, so /srv/bundle-evil is
    NOT treated as inside /srv/bundle (a plain startswith() would say it is).
    """
    real = os.path.realpath(candidate)
    return os.path.commonpath([root_real, real]) == root_real


# ---------------------------------------------------------------------------
# Hashing
# ---------------------------------------------------------------------------


def hash_file(path: str, chunk_size: int = CHUNK_SIZE) -> str:
    """Return the lowercase hex SHA-256 of a file, reading it in chunks.

    Memory use stays at chunk_size however big the file is.
    """
    digest = hashlib.sha256()
    with open(path, "rb") as fh:  # binary mode: we hash bytes, not text
        # iter(callable, sentinel) calls fh.read(chunk_size) until it returns b"".
        for chunk in iter(lambda: fh.read(chunk_size), b""):
            digest.update(chunk)
    return digest.hexdigest()


# ---------------------------------------------------------------------------
# The check
# ---------------------------------------------------------------------------


def _walk(root: str) -> list:
    """Every file on disk under root, as manifest-style relative paths.

    followlinks=False: we never descend into a symlinked directory, because it
    could point anywhere (including back up the tree, looping forever). A
    symlink, to a file or to a directory, is listed as an entry of its own
    so it can be judged.
    """
    found = []
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        rel_dir = os.path.relpath(dirpath, root)
        names = list(filenames) + [d for d in dirnames if os.path.islink(os.path.join(dirpath, d))]
        for name in names:
            rel = name if rel_dir == "." else f"{rel_dir}/{name}"
            found.append(rel.replace(os.sep, "/"))
    return found


def check(bundle_dir: str, manifest_path: str) -> Report:
    """Compare bundle_dir with the manifest. See the module docstring.

    Raises MalformedManifest for a bad manifest, and OSError if the manifest
    cannot be read or bundle_dir is not a directory.
    """
    if not os.path.isdir(bundle_dir):
        raise NotADirectoryError(f"bundle directory not found: {bundle_dir}")
    entries = load_manifest(manifest_path)

    root_real = os.path.realpath(bundle_dir)
    report = Report()

    # 1. Duplicates. Count every path first. Building a dict of
    #    path -> entry straight away would silently keep only the last copy.
    #    Two entries for one path usually mean a broken build script, and if
    #    their hashes differ, which one is "right"? Reporting beats guessing.
    seen = {}
    for entry in entries:
        seen.setdefault(entry["path"], []).append(entry)
    report.duplicates = sorted(p for p, dup in seen.items() if len(dup) > 1)

    listed = set()
    for path, dup in seen.items():
        entry = dup[0]

        # 2. Unsafe by spelling. Decided from the string, BEFORE any
        #    filesystem call, so "../../etc/shadow" is never even stat()ed.
        if not is_safe_relpath(path):
            report.unsafe.append(path)
            continue
        listed.add(path)
        full = os.path.join(bundle_dir, *path.split("/"))

        # 3. Unsafe by symlink. "lib/libssl.so" can be a harmless-looking name
        #    for a link to /etc/shadow, or sit under a linked directory.
        #    realpath() resolves the links (a metadata lookup). We refuse to
        #    open anything that resolves outside the bundle.
        if not _inside(root_real, full):
            report.unsafe.append(path)
            continue

        # 4. Present? isfile() follows in-bundle links. A directory where a
        #    file should be counts as missing.
        if not os.path.isfile(full):
            report.missing.append(path)
            continue

        # 5. Size first (cheap), then hash (reads every byte).
        if entry["size"] is not None:
            actual_size = os.path.getsize(full)
            if actual_size != entry["size"]:
                report.mismatched.append(Mismatch(path, "size", entry["size"], actual_size))
                continue
        actual = hash_file(full)
        if actual != entry["sha256"]:  # both lowercase: see load_manifest
            report.mismatched.append(Mismatch(path, "sha256", entry["sha256"], actual))
        else:
            report.verified.append(path)

    # 6. Unexpected files: on disk but not in the manifest. An extra file in
    #    a release bundle is as suspicious as a modified one: a dropped-in
    #    library or a leftover debug config can change behaviour just as much.
    #    The manifest file itself is allowed to live inside the bundle.
    manifest_real = os.path.realpath(manifest_path)
    for rel in _walk(bundle_dir):
        full = os.path.join(bundle_dir, *rel.split("/"))
        if os.path.realpath(full) == manifest_real and not os.path.islink(full):
            continue
        if os.path.islink(full) and not _inside(root_real, full):
            # A link that points outside is unsafe whether or not the manifest
            # mentions it (if it does, it is already listed).
            if rel not in report.unsafe:
                report.unsafe.append(rel)
            continue
        if rel not in listed:
            report.unexpected.append(rel)

    for name in ("missing", "unexpected", "unsafe", "verified"):
        getattr(report, name).sort()
    report.mismatched.sort()
    return report


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def format_report(report: Report) -> str:
    lines = []
    for label, items in (("MISSING", report.missing), ("DUPLICATE", report.duplicates),
                         ("UNEXPECTED", report.unexpected), ("UNSAFE", report.unsafe)):
        lines.extend(f"{label:<10} {p}" for p in items)
    for m in report.mismatched:
        lines.append(f"{'MISMATCH':<10} {m.path}: {m.field} expected {m.expected}, got {m.actual}")
    lines.append(f"{'OK' if report.ok else 'FAILED'}: {len(report.verified)} verified, "
                 f"{len(lines)} problem(s)")
    return "\n".join(lines)


def main(argv: list | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 2:
        print("usage: manifest_check.py BUNDLE_DIR MANIFEST_JSON", file=sys.stderr)
        return 2
    try:
        report = check(args[0], args[1])
    except MalformedManifest as exc:
        print(f"error: malformed manifest: {exc}", file=sys.stderr)
        return 2
    except OSError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(format_report(report))
    return 0 if report.ok else 1


if __name__ == "__main__":
    sys.exit(main())
