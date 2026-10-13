# L07 worked solution

The reference implementation is `solution/logsummary.py`; the reference tests are
`solution/test_logsummary.py` (18 tests, all seven broken variants caught). Read them after your
own attempt. The decisions that matter:

1. **Stream.** `read_records()` is a generator over the file handle (`for line in fh`), validating
   each row and yielding it. Nothing ever holds all rows; `summarize()` keeps counters per service
   and status, one dict of message → count, and the min/max timestamp. Time O(n) in rows; memory
   O(distinct services + statuses + messages). `fh.readlines()` or `list(records)` makes memory
   grow with the file — the validator's 300k-row check shows ~50 MiB of growth for that.
2. **Fail loudly on bad rows.** Invalid JSON, a non-object, a missing required key, a non-integer
   status (`"503"` is a string) and a naive timestamp each raise `MalformedInput("path:line: …")`.
   `main()` catches only that, writes one line to **stderr**, prints nothing on stdout, returns 2.
   Skipping is the dangerous choice: the summary is then wrong without saying so.
3. **Normalise time.** `datetime.fromisoformat` after mapping a trailing `Z` to `+00:00` (3.9/3.10
   do not accept `Z`), reject results without `tzinfo`, then `.astimezone(timezone.utc)`.
   `.replace(tzinfo=utc)` is the classic bug: it relabels instead of converting.
4. **Deterministic output.** Services sorted by name, statuses by number, top errors by
   `(-count, message)`, `json.dumps(..., sort_keys=True)`. Ties are where "it looked stable on my
   machine" comes from.
5. **Exit codes in one place.** `main()` returns 0 / 1 / 2 and never calls `sys.exit` itself, so
   tests can call it with `io.StringIO` for stdout and stderr.

Tests that catch the broken variants: a malformed fixture must raise and must give exit 2 with
nothing on stdout; offsets must produce the UTC window; ties must come back alphabetically; an
empty file must give exit 0 and `window: null`; a missing key must be `MalformedInput`, not a
`KeyError` traceback; a log with errors must give exit 1.

Variant B's incident log has one row without `service` (line 1388): the correct result is exit 2
naming that line — the summary of the other 1,999 rows is *not* printed, and your notes should say
why that is the right default and what flag (`--skip-bad-rows` with a count on stderr) you would add
if the team wanted the opposite.
