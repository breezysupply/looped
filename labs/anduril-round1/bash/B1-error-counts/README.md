# B1 · Error counts per service

**Time:** about 15 minutes. **You edit:** `starter/count_errors.sh`.
**Test:** `../run-tests.sh starter B1` (from this folder) or `./run-tests.sh starter B1` from `bash/`.

## The task

An on-call page says "lots of errors". You have the application log. Write
`count_errors.sh FILE` that prints how many `ERROR` lines each service logged,
busiest first, and a total.

## Input format

One event per line, fields separated by single spaces:

```
<timestamp> <LEVEL> <service>: <message>
2026-10-01T09:00:01Z ERROR api-gateway: upstream timeout after 30s
```

| Field | Rule |
|---|---|
| timestamp | exactly `YYYY-MM-DDTHH:MM:SSZ` (digits, literal `T` and `Z`) |
| LEVEL | letters only (`INFO`, `WARN`, `ERROR`, `error`, ...) |
| service | letters, digits, `.`, `_`, `-`, followed directly by `:` |
| message | anything, may be empty |

- **Only the level `ERROR`, exactly, counts.** Not `error`, `Error` or `ERRORS`,
  and not the word ERROR appearing in the message of an `INFO` line.
- **Blank lines** are ignored silently.
- **Malformed lines** (any non-blank line breaking the rules above) are
  skipped and counted, never counted as errors.
- The last line may have no trailing newline; it still counts.

## Output format (stdout)

One line per service with at least one ERROR, `<service> <count>`, sorted by
count descending, ties broken by service name (byte order, `LC_ALL=C`). Then
always a total line:

```
api-gateway 3
billing 2
ledger 2
auth 1
TOTAL 8
```

A file with no ERROR lines (including an empty file) prints only `TOTAL 0`.

## stderr

- Wrong number of arguments: `usage: count_errors.sh FILE`
- Missing, unreadable or not a regular file: `count_errors.sh: cannot read '<FILE>'`
- If malformed lines were skipped: `count_errors.sh: skipped <N> malformed line(s)`
  (a warning: it does not change the exit status)

## Exit status

| Exit | When |
|---|---|
| 0 | no ERROR lines (`TOTAL 0`) |
| 1 | at least one ERROR line |
| 2 | usage error or unreadable file; nothing on stdout |

## Fixtures

| File | What it exercises |
|---|---|
| `normal.log` | mixed levels, a tie (billing/ledger), ERROR inside an INFO message |
| `no-errors.log` | valid log, no ERRORs |
| `empty.log` | zero bytes |
| `malformed.log` | 5 malformed lines + a blank line around 2 valid ERRORs |
| `case.log` | `error`, `Error`, `ERRORS`, and a service *named* `error-reporter` |

The tests also make a file with no trailing newline, and try a missing file,
a directory, no arguments and two arguments.

## Hints

- `awk` splits on whitespace and has associative arrays, so you do not need
  Bash 4's `declare -A`. `$2 == "ERROR"` is an exact comparison.
- `sort -k2,2nr -k1,1` sorts by field 2 numerically, descending, then field 1.
- If you write `awk ... | sort`, what happens to awk's exit status? Capture the
  awk output first, check it, then sort.
- `while read line` loses the last line if it has no newline;
  `while IFS= read -r line || [ -n "$line" ]` does not. awk handles it for you.

## Explain it aloud

1. Why `"$1"` and `"$log"` in quotes? What breaks with a file called
   `my app.log` or a value of `*`?
2. `grep ERROR app.log | wc -l` gives a number. Name two ways it is wrong for
   this task.
3. After `awk ... | sort`, what does `$?` hold? What does `set -o pipefail`
   change, and why is checking the status explicitly still clearer?
4. Why do usage errors go to stderr with exit 2 instead of printing `TOTAL 0`?
   What would a caller like `if ./count_errors.sh app.log; then ...` conclude otherwise?
