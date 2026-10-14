"""Your tests for logsummary (L07). Run: python3 -m unittest discover -s . -p 'test_*.py'

Test the CONTRACT (the functions and CLI documented in logsummary.py), not private helpers:
validate.py also runs this file against a reference implementation (it must pass there) and
against several subtly broken ones (it must fail on each). Two examples to start from:
"""
import io
import json
import os
import unittest

import logsummary as ls

FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")


def run(*argv):
    out, err = io.StringIO(), io.StringIO()
    code = ls.main(list(argv), stdout=out, stderr=err)
    return code, out.getvalue(), err.getvalue()


class Examples(unittest.TestCase):
    def test_sample_counts_by_service(self):
        s = ls.summarize(ls.read_records(os.path.join(FIX, "sample.jsonl")))
        self.assertEqual(s["total"], 8)
        self.assertEqual(s["services"]["beacon-api"]["requests"], 5)

    def test_empty_file_is_not_an_error(self):
        code, out, _ = run(os.path.join(FIX, "empty.jsonl"), "--json")
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out)["total"], 0)

    # Add tests for: malformed rows, a missing key, timezone offsets, ties in the
    # error ranking, exit codes, what goes to stdout versus stderr, determinism.


if __name__ == "__main__":
    unittest.main()
