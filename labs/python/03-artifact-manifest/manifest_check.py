"""Verify a directory of release artifacts against a SHA-256 manifest.

STARTER FILE: replace every `raise NotImplementedError` with your code.
Read README.md first; it defines the exact behaviour the tests check.

Usage:
    python3 manifest_check.py BUNDLE_DIR MANIFEST_JSON

Manifest format:
    {"files": [{"path": "bin/app", "sha256": "<64 hex chars>", "size": 123}, ...]}
    `size` is optional.

Exit codes: 0 all good, 1 problems found, 2 malformed manifest / unreadable input.
"""
from __future__ import annotations

import hashlib  # noqa: F401  (you will need these)
import json  # noqa: F401
import os  # noqa: F401
import sys
from dataclasses import dataclass, field
from typing import List, NamedTuple

CHUNK_SIZE = 64 * 1024


class MalformedManifest(ValueError):
    """The manifest is not valid JSON or does not have the documented shape.
    (Provided for you.)"""


class Mismatch(NamedTuple):
    """One file whose contents differ from the manifest. (Provided.)

    field is "size" or "sha256"; expected/actual are the two values.
    """

    path: str
    field: str
    expected: object
    actual: object


@dataclass
class Report:
    """Result of check(). Keep every list sorted. (Provided, except `ok`.)"""

    missing: List[str] = field(default_factory=list)       # in manifest, not on disk
    duplicates: List[str] = field(default_factory=list)    # path listed more than once
    unexpected: List[str] = field(default_factory=list)    # on disk, not in manifest
    unsafe: List[str] = field(default_factory=list)        # would escape the bundle
    mismatched: List[Mismatch] = field(default_factory=list)
    verified: List[str] = field(default_factory=list)      # present and matching

    @property
    def ok(self) -> bool:
        """True only if missing, duplicates, unexpected, unsafe and mismatched are all empty."""
        raise NotImplementedError("Report.ok")


def load_manifest(manifest_path: str) -> list:
    """Parse and validate the manifest.

    Return a list of {"path": str, "sha256": <lowercase hex>, "size": int or None}.
    Raise MalformedManifest for invalid JSON or a bad shape (see README.md).
    Let OSError propagate if the file cannot be opened.
    """
    raise NotImplementedError("load_manifest")


def is_safe_relpath(path: str) -> bool:
    """Decide from the string alone (no filesystem access) whether a manifest
    path is a safe, canonical, relative POSIX path. See README.md for the rules."""
    raise NotImplementedError("is_safe_relpath")


def hash_file(path: str, chunk_size: int = CHUNK_SIZE) -> str:
    """Return the lowercase hex SHA-256 of the file, reading `chunk_size` bytes
    at a time (never the whole file at once)."""
    raise NotImplementedError("hash_file")


def check(bundle_dir: str, manifest_path: str) -> Report:
    """Compare the files under bundle_dir with the manifest and return a Report.

    Raise MalformedManifest for a bad manifest. Raise an OSError (for example
    NotADirectoryError) if bundle_dir is not a directory or the manifest
    cannot be read.
    """
    raise NotImplementedError("check")


def format_report(report: Report) -> str:
    """Human-readable report: one line per problem, then a summary line."""
    raise NotImplementedError("format_report")


def main(argv: list | None = None) -> int:
    """CLI: `manifest_check.py BUNDLE_DIR MANIFEST_JSON`. Return the exit code.
    argv excludes the program name. Errors go to stderr. Usage error -> 2."""
    raise NotImplementedError("main")


if __name__ == "__main__":
    sys.exit(main())
