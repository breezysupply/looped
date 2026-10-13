# L07 — A log summariser you can trust: CLI, exit codes, tests that catch bugs

Module M04 · ~150 min practical (three sessions) · profile `linux-arm64` · runs **inside the course VM**
(any Linux with Python 3.9+ works; no root needed)

## Ticket

> During incidents people paste Beacon's JSON logs into ad-hoc one-liners and argue about the
> numbers. Write `logsummary`: a small CLI that summarises a JSON-lines log by service and status,
> lists the top error messages, and **fails loudly and usefully** on bad input. Its output must be
> the same every time, its exit code must be usable in a script, and it must come with tests that
> would catch the bugs people usually introduce.

## Objectives

- `obj-m04-01` small correct functions over collections — normal, empty and malformed input
- `obj-m04-02` a CLI with arguments, errors on stderr, meaningful exit codes
- `obj-m04-03` unit tests with fixtures that fail on broken variants and pass on a correct one
- `obj-m04-06` explain why the scan is O(n) and how memory stays bounded

## The contract (fixed — the validator relies on it)

The full contract is the docstring at the top of `starter/logsummary.py`. In short:

- Input: one JSON object per line; blank lines ignored; required `ts` (ISO-8601 with an offset or
  `Z`), `service` (non-empty string), `status` (integer). A row is an error if `status >= 500` or
  `level` is `error`/`fatal`; its message is the first of `error`, `msg`, `message`.
- `python3 logsummary.py PATH [--top N] [--json]`. `--json` prints the documented summary dict
  with `sort_keys=True`. Times in the summary are UTC.
- Exit codes: **0** no errors in the log · **1** errors found (summary still printed) · **2** input
  unreadable or malformed (one message on **stderr** naming `file:line`; nothing on stdout).
- Output is byte-for-byte identical across runs. Top errors: count descending, then message.

## What is fixture-controlled

`setup.sh` creates your workspace (default `labs/sre-cloud-foundations/L07/work`, or `L07_WORK=DIR`)
from `starter/` and copies the sample fixtures (`fixtures/`: sample, empty, malformed, missing key,
offsets, ties). `inject.sh` generates the variant's **incident log** in `work/data/`
(`LOOPED_VARIANT=variant-a|variant-b`, deterministic per variant). The validator generates further
edge-case files at run time and compares your CLI with a reference implementation.

## Steps and checkpoints

**Checkpoint c1 — functions and the happy path (week 9).**

1. `bash labs/sre-cloud-foundations/L07/setup.sh`, then `cd labs/sre-cloud-foundations/L07/work`.
2. Implement `parse_ts`, `read_records`, `summarize` until the two example tests pass:
   `python3 -m unittest discover -s . -p 'test_*.py'`.

**Checkpoint c2 — failure classes, CLI and tests (week 10).**

3. For each failure class decide: raise, report or skip — and write it down in
   `evidence/L07-notes.md`. Implement `render` and `main`.
4. Write tests for every edge case: empty file, malformed row, missing key, non-integer status,
   naive and offset timestamps, ties in the ranking, exit codes, stdout versus stderr, determinism.
   Test the **contract**, not private helpers.

**Checkpoint c3 — the incident and the explanation (week 11).**

5. `python3 logsummary.py data/incident-<variant>.jsonl; echo "exit=$?"` — paste it into your notes.
6. Explain the complexity and the memory behaviour; then
   `python3 labs/sre-cloud-foundations/L07/validate.py --explanation-file labs/sre-cloud-foundations/L07/evidence/L07-notes.md`

## How validation works (and why your tests matter)

`validate.py` runs your suite on your code (≥8 tests), then on the **reference** implementation
(it must pass — otherwise a test depends on something outside the contract), then on seven
**deliberately broken** copies of the reference described in `broken/mutants.json` — each one a bug
people really write. Your suite must fail on every one. It then runs your CLI and the reference on
generated edge-case files and compares exit codes and `--json` output, checks byte-identical output
across hash seeds, and measures peak memory on a 30k-row versus a 300k-row file.

## What you should observe

- Silently skipping a malformed row produces a summary that is wrong and looks right.
- `2026-09-14T05:45:00-05:00` and `2026-09-14T10:45:00Z` are the same instant.
- A test suite that only checks the happy path passes on most of the broken copies.

## Pause / resume

Your code lives in the workspace (commit it). `reset.sh` regenerates only `data/` for the same
variant; `teardown.sh` removes generated data and never your code or tests.

## Lab versus production

A production version would add structured logging of its own, a `--since/--until` window, gzip
input, and probably a streaming top-k structure when message cardinality is unbounded. The
contract habits — exit codes a script can use, errors on stderr, deterministic output, tests
that fail on real bugs — are exactly what you need there.

## Limits

This lab does not prove packaging, performance tuning, concurrency, or handling unbounded message
cardinality; the memory check is a coarse peak-RSS comparison, not a profiler. It proves a small
tool that is correct on the documented edge cases, honest about failure, and tested well enough
to catch common bugs. The reference is in `solution/` — reading it first defeats the exercise.

## References

- T11 Python tutorial and standard library (`json`, `argparse`, `datetime`, `unittest`)
