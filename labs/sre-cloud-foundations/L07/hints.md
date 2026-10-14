# L07 hints (four rungs; rungs 3–4 end independent credit for this attempt)

1. **Boundary.** Separate the three jobs: reading rows (and refusing bad ones), counting, and
   printing/choosing an exit code. Most bugs live in the first and the last.
2. **Evidence source.** The contract docstring in `starter/logsummary.py` and the fixtures in
   `fixtures/`. Run your CLI on each fixture and look at stdout, stderr and `$?` separately:
   `python3 logsummary.py fixtures/malformed.jsonl >out.txt 2>err.txt; echo $?`.
3. **Discriminating check.** If `validate.py` reports a broken variant your tests did not catch,
   read its id in `broken/mutants.json` and write the one test that would fail on it (e.g. a file
   where two messages tie, an offset timestamp whose UTC hour differs, an empty file).
4. **Root cause and fix.** Stream with `for line in fh`; raise `MalformedInput(f"{path}:{n}: …")`
   for bad JSON, non-objects, missing keys, string statuses and naive timestamps; convert with
   `.astimezone(timezone.utc)`; sort ties by message; return 0/1/2 from `main()` and write errors
   only to stderr. The reference is `solution/`.
