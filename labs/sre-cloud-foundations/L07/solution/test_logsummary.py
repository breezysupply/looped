"""Reference tests for L07 (read after your own attempt).

They test the contract in the starter — the public functions and the CLI —
not one implementation, so they pass on any correct logsummary.py and fail on
each of the deliberately broken variants the validator builds.
"""
import io
import json
import os
import tempfile
import unittest
from datetime import timezone

import logsummary as ls

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, "fixtures")


def run(*argv):
    out, err = io.StringIO(), io.StringIO()
    code = ls.main(list(argv), stdout=out, stderr=err)
    return code, out.getvalue(), err.getvalue()


def write(lines):
    fd, path = tempfile.mkstemp(suffix=".jsonl")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write("".join(line + "\n" for line in lines))
    return path


class ParseTimestamp(unittest.TestCase):
    def test_offsets_are_normalised_to_utc(self):
        self.assertEqual(ls.parse_ts("2026-09-14T12:30:00+02:00").isoformat(), "2026-09-14T10:30:00+00:00")
        self.assertEqual(ls.parse_ts("2026-09-14T05:45:00-05:00").tzinfo, timezone.utc)
        self.assertEqual(ls.parse_ts("2026-09-14T05:45:00-05:00").hour, 10)

    def test_trailing_z(self):
        self.assertEqual(ls.parse_ts("2026-09-14T10:00:00Z").isoformat(), "2026-09-14T10:00:00+00:00")

    def test_naive_and_garbage_are_rejected(self):
        for bad in ("2026-09-14T10:00:00", "yesterday", "", None, 1694685600):
            with self.assertRaises(ls.MalformedInput):
                ls.parse_ts(bad)


class Summarize(unittest.TestCase):
    def test_sample_counts(self):
        s = ls.summarize(ls.read_records(os.path.join(FIX, "sample.jsonl")))
        self.assertEqual(s["total"], 8)
        self.assertEqual(s["errors"], 4)  # three 5xx plus one level=error
        self.assertEqual(s["services"]["beacon-api"], {"requests": 5, "errors": 2, "by_status": {200: 1, 201: 1, 404: 1, 503: 2}})
        self.assertEqual(s["services"]["beacon-worker"]["errors"], 2)
        self.assertEqual(s["top_errors"][0], {"message": "store unavailable", "count": 2})

    def test_window_uses_utc_across_offsets(self):
        s = ls.summarize(ls.read_records(os.path.join(FIX, "tz-offsets.jsonl")))
        self.assertEqual(s["window"], {"start": "2026-09-14T10:15:00Z", "end": "2026-09-14T10:45:00Z"})

    def test_ties_are_broken_by_message(self):
        s = ls.summarize(ls.read_records(os.path.join(FIX, "ties.jsonl")), top=3)
        self.assertEqual([e["message"] for e in s["top_errors"]], ["alpha: store unavailable", "zeta: queue full", "mid: bad gateway"])

    def test_top_limits_the_list(self):
        s = ls.summarize(ls.read_records(os.path.join(FIX, "ties.jsonl")), top=1)
        self.assertEqual(len(s["top_errors"]), 1)

    def test_empty_file(self):
        s = ls.summarize(ls.read_records(os.path.join(FIX, "empty.jsonl")))
        self.assertEqual((s["total"], s["errors"], s["window"], s["services"], s["top_errors"]), (0, 0, None, {}, []))


class ReadRecords(unittest.TestCase):
    def test_malformed_row_names_the_line(self):
        with self.assertRaises(ls.MalformedInput) as cm:
            list(ls.read_records(os.path.join(FIX, "malformed.jsonl")))
        self.assertIn(":3", str(cm.exception))

    def test_missing_key_is_malformed(self):
        with self.assertRaises(ls.MalformedInput) as cm:
            list(ls.read_records(os.path.join(FIX, "missing-key.jsonl")))
        self.assertIn("service", str(cm.exception))

    def test_non_integer_status(self):
        path = write(['{"ts": "2026-09-14T10:00:00Z", "service": "a", "status": "500"}'])
        self.addCleanup(os.unlink, path)
        with self.assertRaises(ls.MalformedInput):
            list(ls.read_records(path))

    def test_streams(self):
        # a generator, not a list: memory is bounded by distinct keys, not by lines
        self.assertFalse(isinstance(ls.read_records(os.path.join(FIX, "sample.jsonl")), (list, tuple)))


class Cli(unittest.TestCase):
    def test_exit_1_when_errors_found_and_summary_printed(self):
        code, out, err = run(os.path.join(FIX, "sample.jsonl"))
        self.assertEqual(code, 1)
        self.assertIn("beacon-api", out)
        self.assertEqual(err, "")

    def test_exit_0_without_errors(self):
        path = write(['{"ts": "2026-09-14T10:00:00Z", "service": "a", "status": 200}'])
        self.addCleanup(os.unlink, path)
        self.assertEqual(run(path)[0], 0)

    def test_empty_file_is_not_an_error(self):
        code, out, err = run(os.path.join(FIX, "empty.jsonl"), "--json")
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out)["total"], 0)

    def test_bad_input_exit_2_message_on_stderr_only(self):
        for name in ("malformed.jsonl", "missing-key.jsonl"):
            code, out, err = run(os.path.join(FIX, name))
            self.assertEqual(code, 2, name)
            self.assertEqual(out, "", name)
            self.assertIn(name, err)

    def test_missing_file(self):
        code, out, err = run(os.path.join(FIX, "does-not-exist.jsonl"))
        self.assertEqual((code, out), (2, ""))
        self.assertIn("does-not-exist", err)

    def test_json_output_is_deterministic(self):
        a = run(os.path.join(FIX, "ties.jsonl"), "--json")[1]
        b = run(os.path.join(FIX, "ties.jsonl"), "--json")[1]
        self.assertEqual(a, b)
        self.assertEqual(list(json.loads(a)["services"]), ["beacon-api"])


if __name__ == "__main__":
    unittest.main()
