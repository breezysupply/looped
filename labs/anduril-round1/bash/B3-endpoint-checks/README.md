# B3 · Endpoint checks with a timeout

**Time:** about 20 minutes. **You edit:** `starter/check_endpoints.sh`.
**Test:** `./run-tests.sh starter B3` from `bash/` (about 2 seconds; no network).

## The task

After a security-group or route-table change you want a quick "can I still
reach these?" check. Write `check_endpoints.sh FILE` that reads endpoints from
FILE, checks each one **in order**, with a per-check timeout, prints a table and
exits non-zero if anything is not OK.

A check that hangs (a blackholed packet, a silently dropped SYN) must be cut off
by the timeout, not stall the whole script. macOS has no `timeout` command and
Bash 3.2 has no `wait -n`, so you build it: start the check in the background,
poll it with `kill -0 "$pid"`, and `kill` it when time runs out.

## Input format

- One endpoint per line as **`host:port`** (not URLs). Host: letters, digits,
  `.`, `-`. Port: 1-65535. No scheme, no path, no IPv6.
- Leading and trailing blanks are ignored.
- Blank lines and lines starting with `#` (after optional blanks) are skipped.
  No trailing comments.
- The last line may lack a newline.
- Any other line is **invalid**: reported in the table and on stderr, and
  counted as a failure. The other endpoints are still checked.

```
# fictional internal services
ok-api.internal:443
fail-db.internal:5432
```

## Configuration (environment)

| Variable | Default | Meaning |
|---|---|---|
| `CHECK_TIMEOUT` | `3` | whole seconds allowed per check; positive integer |
| `CHECK_CMD` | unset | path to an executable run as `CHECK_CMD HOST PORT`; exit 0 means up |

Without `CHECK_CMD` the script does a real TCP connect with Bash's built-in
`/dev/tcp/HOST/PORT` redirection (works in macOS Bash 3.2). The tests always set
`CHECK_CMD=fixtures/mock_check.sh`, which needs no network:

| Host starts with | Mock does |
|---|---|
| `ok` | exits 0 (up) |
| `fail` | exits 1 (down) |
| `hang` | sleeps 10 s, so your timeout must kill it |
| anything else | exits 3 |

## Output format (stdout)

A header, one row per endpoint in file order, then a summary. Each row is
`printf '%-32s %s\n' "$endpoint" "$status"` (endpoint padded to 32 columns, one
space, status):

```
ENDPOINT                         STATUS
ok-api.internal:443              OK
fail-db.internal:5432            FAIL
hang-cache.internal:6379         TIMEOUT
ok-queue.internal:5672           OK
not-an-endpoint                  INVALID
ok-bad-port.internal:99999       INVALID
6 checked, 2 ok, 4 failed
```

| Status | When |
|---|---|
| `OK` | check exited 0 within the timeout |
| `FAIL` | check exited non-zero within the timeout |
| `TIMEOUT` | check still running after `CHECK_TIMEOUT` seconds; it is killed |
| `INVALID` | line is not a valid `host:port`; not checked |

"checked" counts every non-comment, non-blank line, invalid ones included.

## stderr and exit status

| Exit | When | stderr contains |
|---|---|---|
| 0 | every endpoint OK | (nothing) |
| 1 | any FAIL, TIMEOUT or INVALID | for each invalid line: `line <N>: invalid endpoint '<text>' (want host:port)` (N counts every line of the file) |
| 2 | not exactly one argument | `usage:` |
| 2 | FILE missing or unreadable | `cannot read` |
| 2 | FILE has only comments/blank lines | `no endpoints` |
| 2 | `CHECK_TIMEOUT` not a positive integer | `CHECK_TIMEOUT` |
| 2 | `CHECK_CMD` set but not an executable file | `CHECK_CMD` |

On exit 2 nothing is printed on stdout (validate before printing the header).

## Error handling to show

- Capture each check's status straight away (`rc=$?` or `case $? in`) and map
  it to OK / FAIL / TIMEOUT.
- `trap '...' EXIT` that kills a still-running check, so Ctrl-C does not leave
  a stray background process behind.
- Run the check with `</dev/null`. Otherwise a check that reads stdin eats the
  rest of your endpoint file from the `while read` loop.

## Trying it against real local services (optional)

Only check hosts you own. Locally:

```sh
cd "$(mktemp -d)" && python3 -m http.server 8000 --bind 127.0.0.1 &   # something listening
./solution/check_endpoints.sh fixtures/real-local.txt                 # 8000 OK, 8001 FAIL
kill %1
```

`fixtures/real-local.txt` lists `127.0.0.1:8000` and `127.0.0.1:8001`. To see
a real timeout, try a non-routable private address such as `10.255.255.1:443`
with `CHECK_TIMEOUT=2`. On an ordinary network the SYN goes unanswered and you
get `TIMEOUT` after about 2 seconds. A VPN, corporate proxy or sandbox that
accepts every connection will show `OK` instead, which is a lesson in itself:
a TCP connect only proves that *something* answered.
If your Bash lacks `/dev/tcp`, use a small wrapper as `CHECK_CMD`, for example
a script containing `exec nc -z "$1" "$2"`.

## Explain it aloud

1. Why is `CHECK_CMD` injectable? What does that buy you in tests, and what
   would testing against real public hosts cost you?
2. Walk through your timeout: what if the check finishes first, and what if it
   does not? What does `wait "$pid"` return in each case, and why save it at once?
3. What does `set -e` do when a check fails inside `if ...; then`, and why is
   it no substitute for mapping each check's status yourself?
4. Why quote `"$line"` and `"${line%:*}"`? What would an unquoted value
   containing `*` do?
