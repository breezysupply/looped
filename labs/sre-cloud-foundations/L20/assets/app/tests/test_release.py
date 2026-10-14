"""Release metadata tests (L20). Run with the Beacon suite:
    python3 -m unittest discover -s tests -t .
They keep release.json, the migrations directory and the declared schema range consistent, so
the promotion gate can trust them."""
import json
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class ReleaseMetadata(unittest.TestCase):
    def setUp(self):
        with open(os.path.join(ROOT, "release.json"), encoding="utf-8") as fh:
            self.rel = json.load(fh)
        self.files = sorted(f for f in os.listdir(os.path.join(ROOT, "migrations")) if f.endswith(".sql"))

    def test_version_is_pinned_semver(self):
        self.assertRegex(self.rel["version"], r"^[0-9]+\.[0-9]+\.[0-9]+$")

    def test_migrations_are_sequential_and_listed(self):
        nums = [int(re.match(r"^(\d{4})_", f).group(1)) for f in self.files]
        self.assertEqual(nums, list(range(1, len(nums) + 1)), "migrations must be numbered 0001, 0002, ... without gaps")
        self.assertEqual(self.rel["migrations"], self.files)

    def test_schema_range_matches_migrations(self):
        lo, hi = self.rel["schema"]["min"], self.rel["schema"]["max"]
        self.assertTrue(1 <= lo <= hi, "schema range must be 1 <= min <= max")
        self.assertEqual(hi, len(self.files), "schema.max must equal the highest migration")
