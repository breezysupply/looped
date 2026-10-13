"""beacon-report tests: run inside the image with `python3 -m unittest discover -s tests -t .`."""
import json
import os
import tempfile
import unittest

from app import report

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data", "records.json")


class ReportTests(unittest.TestCase):
    def setUp(self):
        with open(DATA, "r", encoding="utf-8") as fh:
            self.records = json.load(fh)

    def test_normalize_ascii_and_case(self):
        self.assertEqual(report.normalize_host("S-102.Edge.corp.lab."), "s-102.edge.corp.lab")

    def test_normalize_unicode_label(self):
        self.assertEqual(report.normalize_host("bücher-7.edge.corp.lab"), "xn--bcher-7-n2a.edge.corp.lab")

    def test_rejects_overlong_hostname(self):
        with self.assertRaises(ValueError):
            report.normalize_host("a" * 254)

    def test_summary_counts(self):
        s = report.summarize(self.records)
        self.assertEqual(s["total"], 5)
        self.assertEqual(s["by_status"]["ok"], 3)
        self.assertEqual(len(s["hosts"]), 5)

    def test_render_escapes_untrusted_status(self):
        pages = report.render(report.load_config(None), self.records)
        self.assertIn("&lt;script&gt;", pages["index.html"])
        self.assertNotIn("<script>alert", pages["index.html"])

    def test_cli_writes_pages(self):
        with tempfile.TemporaryDirectory() as d:
            rc = report.main(["--config", "/nonexistent.json", "--input", DATA, "--out", d])
            self.assertEqual(rc, 0)
            self.assertTrue(os.path.exists(os.path.join(d, "index.html")))


if __name__ == "__main__":
    unittest.main()
