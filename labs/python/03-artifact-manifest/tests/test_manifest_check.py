"""Behavioural tests for manifest_check.

Read-only cases use the committed bundle in ../fixtures/bundle. Cases that
need a changed tree (symlinks, files outside the bundle, a manifest inside
it) copy the bundle into a temporary directory first, so the fixtures are
never modified.

Which implementation is tested is chosen by PYTHONPATH (see ../README.md).
"""
import contextlib
import hashlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

# `python -m unittest` (and pytest) put the current directory ahead of
# PYTHONPATH on sys.path, and the exercise directory holds the starter
# manifest_check.py. Re-insert the PYTHONPATH entries first so PYTHONPATH wins.
for _entry in reversed(os.environ.get("PYTHONPATH", "").split(os.pathsep)):
    if _entry:
        sys.path.insert(0, os.path.abspath(_entry))

import manifest_check  # noqa: E402  (must come after the sys.path fix above)

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"
BUNDLE = FIXTURES / "bundle"
MANIFESTS = FIXTURES / "manifests"
ALL_FILES = ["README.txt", "bin/app", "bin/healthcheck.sh", "config/app.yaml", "data/.keep", "lib/libfoo.so.1"]


def check(manifest, bundle=BUNDLE):
    return manifest_check.check(str(bundle), str(manifest))


def sha(data):
    return hashlib.sha256(data).hexdigest()


def problems(report):
    return {
        "missing": list(report.missing), "duplicates": list(report.duplicates),
        "unexpected": list(report.unexpected), "unsafe": list(report.unsafe),
        "mismatched": [m.path for m in report.mismatched],
    }


NO_PROBLEMS = {"missing": [], "duplicates": [], "unexpected": [], "unsafe": [], "mismatched": []}


class TempBundle(unittest.TestCase):
    """Gives each test a private copy of the bundle at self.root/bundle."""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="manifest-test-"))
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.bundle = self.root / "bundle"
        shutil.copytree(BUNDLE, self.bundle)
        # A file OUTSIDE the bundle that an attacker would like us to "verify".
        self.secret = self.root / "outside.txt"
        self.secret.write_bytes(b"root:x:0:0:root:/root:/bin/bash\n")

    def manifest(self, extra_entries, name="manifest.json", where=None):
        good = json.loads((MANIFESTS / "good.json").read_text())
        good["files"].extend(extra_entries)
        path = (where or self.root) / name
        path.write_text(json.dumps(good))
        return path

    def symlink(self, target, link):
        try:
            os.symlink(target, link)
        except (OSError, NotImplementedError) as exc:  # e.g. Windows without privilege
            self.skipTest(f"symlinks unavailable: {exc}")


class Verdicts(unittest.TestCase):
    def test_good_bundle_is_ok(self):
        r = check(MANIFESTS / "good.json")
        self.assertTrue(r.ok)
        self.assertEqual(problems(r), NO_PROBLEMS)
        self.assertEqual(sorted(r.verified), ALL_FILES)   # includes the empty data/.keep

    def test_hex_case_is_normalised(self):
        entry = json.loads((MANIFESTS / "good.json").read_text())["files"][1]
        self.assertEqual(entry["path"], "bin/app")
        self.assertTrue(entry["sha256"].isupper())         # the fixture really is uppercase
        self.assertIn("bin/app", check(MANIFESTS / "good.json").verified)

    def test_missing_file(self):
        r = check(MANIFESTS / "missing-file.json")
        self.assertFalse(r.ok)
        self.assertEqual(problems(r), dict(NO_PROBLEMS, missing=["bin/migrate"]))

    def test_duplicate_entry(self):
        r = check(MANIFESTS / "duplicate-entry.json")
        self.assertFalse(r.ok)
        self.assertEqual(problems(r), dict(NO_PROBLEMS, duplicates=["config/app.yaml"]))

    def test_unexpected_file_on_disk(self):
        r = check(MANIFESTS / "extra-file-on-disk.json")
        self.assertFalse(r.ok)
        self.assertEqual(problems(r), dict(NO_PROBLEMS, unexpected=["lib/libfoo.so.1"]))

    def test_mismatches_report_expected_and_actual(self):
        r = check(MANIFESTS / "sha256-mismatch.json")
        self.assertFalse(r.ok)
        by_path = {m.path: m for m in r.mismatched}
        self.assertEqual(sorted(by_path), ["bin/app", "config/app.yaml"])
        app = by_path["bin/app"]
        self.assertEqual(app.field, "sha256")
        self.assertEqual(app.actual, sha((BUNDLE / "bin/app").read_bytes()))
        self.assertNotEqual(app.expected, app.actual)
        cfg = by_path["config/app.yaml"]
        self.assertEqual((cfg.field, cfg.actual), ("size", (BUNDLE / "config/app.yaml").stat().st_size))
        self.assertEqual(cfg.expected, cfg.actual + 12)
        self.assertNotIn("bin/app", r.verified)

    def test_ok_requires_every_list_empty(self):
        for name in ("missing-file.json", "duplicate-entry.json", "extra-file-on-disk.json",
                     "unsafe-paths.json", "sha256-mismatch.json"):
            with self.subTest(name):
                self.assertFalse(check(MANIFESTS / name).ok)

    def test_hash_file_streams_correctly(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "big.bin"
            data = os.urandom(3 * 4096 + 17)   # not a multiple of the chunk size
            p.write_bytes(data)
            self.assertEqual(manifest_check.hash_file(str(p), chunk_size=4096), sha(data))
            self.assertEqual(manifest_check.hash_file(str(p)), sha(data))


class Safety(TempBundle):
    def test_unsafe_manifest_paths_are_rejected(self):
        r = check(MANIFESTS / "unsafe-paths.json")
        self.assertEqual(sorted(r.unsafe),
                         sorted(["../etc/passwd", "/etc/shadow", "bin/../../outside.txt", "config\\app.yaml"]))
        others = r.missing + r.verified + [m.path for m in r.mismatched]
        for bad in r.unsafe:
            self.assertNotIn(bad, others)

    def test_traversal_is_not_followed_even_when_target_matches(self):
        # ../outside.txt exists and the hash is right. It must still be unsafe.
        m = self.manifest([{"path": "../outside.txt", "sha256": sha(self.secret.read_bytes())}])
        r = check(m, self.bundle)
        self.assertEqual(r.unsafe, ["../outside.txt"])
        self.assertNotIn("../outside.txt", r.verified)
        self.assertFalse(r.ok)

    def test_other_non_canonical_spellings_are_unsafe(self):
        # These do not escape, but they give one file two names. That defeats
        # duplicate detection, so they are rejected too.
        m = self.manifest([{"path": p, "sha256": "0" * 64} for p in ("./bin/app", "bin//app", "")])
        self.assertEqual(sorted(check(m, self.bundle).unsafe), sorted(["./bin/app", "bin//app", ""]))

    def test_symlink_to_outside_is_unsafe_not_verified(self):
        self.symlink(self.secret, self.bundle / "lib" / "libssl.so.3")
        m = self.manifest([{"path": "lib/libssl.so.3", "sha256": sha(self.secret.read_bytes())}])
        r = check(m, self.bundle)
        self.assertEqual(r.unsafe, ["lib/libssl.so.3"])
        self.assertNotIn("lib/libssl.so.3", r.verified)

    def test_symlinked_directory_to_outside_is_unsafe(self):
        outside_dir = self.root / "etc"
        outside_dir.mkdir()
        (outside_dir / "passwd").write_bytes(self.secret.read_bytes())
        self.symlink(outside_dir, self.bundle / "conf.d")
        m = self.manifest([{"path": "conf.d/passwd", "sha256": sha(self.secret.read_bytes())}])
        r = check(m, self.bundle)
        self.assertIn("conf.d/passwd", r.unsafe)
        self.assertNotIn("conf.d/passwd", r.verified)

    def test_unlisted_escaping_symlink_on_disk_is_reported(self):
        self.symlink(self.secret, self.bundle / "bin" / "helper")
        r = check(MANIFESTS / "good.json", self.bundle)
        self.assertFalse(r.ok)
        self.assertEqual(r.unsafe, ["bin/helper"])
        self.assertNotIn("bin/helper", r.unexpected)

    def test_manifest_inside_bundle_is_not_unexpected(self):
        m = self.manifest([], name="MANIFEST.json", where=self.bundle)
        r = check(m, self.bundle)
        self.assertEqual(problems(r), NO_PROBLEMS)
        (self.bundle / "config" / "debug.yaml").write_text("log_level: trace\n")
        self.assertEqual(check(m, self.bundle).unexpected, ["config/debug.yaml"])


class Malformed(unittest.TestCase):
    def test_malformed_fixtures(self):
        self.assertTrue(issubclass(manifest_check.MalformedManifest, ValueError))
        for name in ("malformed-invalid-json.json", "malformed-no-files.json", "malformed-bad-entry.json"):
            with self.subTest(name):
                with self.assertRaises(manifest_check.MalformedManifest):
                    check(MANIFESTS / name)

    def test_structural_errors(self):
        h = "a" * 64
        cases = {
            "top level list": [{"path": "bin/app", "sha256": h}],
            "files not a list": {"files": {"bin/app": h}},
            "entry not an object": {"files": ["bin/app"]},
            "path missing": {"files": [{"sha256": h}]},
            "path not a string": {"files": [{"path": 7, "sha256": h}]},
            "sha256 missing": {"files": [{"path": "bin/app"}]},
            "sha256 too short": {"files": [{"path": "bin/app", "sha256": "abc123"}]},
            "sha256 not hex": {"files": [{"path": "bin/app", "sha256": "g" * 64}]},
            "size negative": {"files": [{"path": "bin/app", "sha256": h, "size": -1}]},
            "size a string": {"files": [{"path": "bin/app", "sha256": h, "size": "12"}]},
            "size a bool": {"files": [{"path": "bin/app", "sha256": h, "size": True}]},
        }
        with tempfile.TemporaryDirectory() as d:
            for label, doc in cases.items():
                with self.subTest(label):
                    p = Path(d) / "m.json"
                    p.write_text(json.dumps(doc))
                    with self.assertRaises(manifest_check.MalformedManifest):
                        check(p)

    def test_missing_bundle_or_manifest_is_an_os_error(self):
        with self.assertRaises(OSError):
            check(MANIFESTS / "good.json", FIXTURES / "no-such-bundle")
        with self.assertRaises(OSError):
            check(MANIFESTS / "no-such-manifest.json")


class Cli(unittest.TestCase):
    def run_main(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = manifest_check.main([str(a) for a in args])
        return code, out.getvalue(), err.getvalue()

    def test_exit_codes_and_output(self):
        cases = [("good.json", 0), ("missing-file.json", 1), ("unsafe-paths.json", 1),
                 ("sha256-mismatch.json", 1), ("malformed-no-files.json", 2), ("malformed-invalid-json.json", 2)]
        for name, expected in cases:
            with self.subTest(name):
                code, out, err = self.run_main(BUNDLE, MANIFESTS / name)
                self.assertEqual(code, expected)
                if expected == 2:
                    self.assertEqual(out, "")
                    self.assertTrue(err)
        code, out, _ = self.run_main(BUNDLE, MANIFESTS / "missing-file.json")
        self.assertIn("bin/migrate", out)
        self.assertEqual(self.run_main(FIXTURES / "no-such-bundle", MANIFESTS / "good.json")[0], 2)
        self.assertEqual(self.run_main(BUNDLE)[0], 2)   # usage error


if __name__ == "__main__":
    unittest.main()
