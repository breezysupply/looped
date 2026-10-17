# Bash labs: Anduril Round 1

Short, operational Bash exercises for the Bash part (about 10%) of the
"Anduril Round 1: Networking + AWS Terraform" path: three practice exercises
(B1-B3) and two mock interview exercises (M1, M2). They are interview-sized:
each reference solution is under about 60 lines, the kind of script a strong
candidate writes in 15 to 25 minutes and can then explain line by line.

| # | Exercise | You write | Main ideas |
|---|---|---|---|
| B1 | [`B1-error-counts`](B1-error-counts/) | `count_errors.sh`: ERROR lines per service in a log | awk fields, exact matching, `sort` keys, malformed input, exit codes |
| B2 | [`B2-instances-jq`](B2-instances-jq/) | `non_running.sh`: non-running EC2 instances from `describe-instances` JSON | `jq` defaults (`//`, `[]?`), stdin vs file, refusing to say "all good" on bad input |
| B3 | [`B3-endpoint-checks`](B3-endpoint-checks/) | `check_endpoints.sh`: check `host:port` endpoints with a timeout | timeouts without `timeout`, background jobs, `trap` cleanup, injectable commands |

### Mock interview exercises

Timed, and used by the mock interviews rather than the practice path. Same
layout, test runner and shared contract as B1-B3.

| # | Exercise | Mock | Time | You write | Main ideas |
|---|---|---|---|---|---|
| M1 | [`M1-flow-rejects`](M1-flow-rejects/) | Mock B | ~15 min | `flow_rejects.sh`: REJECTed VPC Flow Log records per destination port | awk field validation, numeric sort keys, NODATA/SKIPDATA, NACL vs security group |
| M2 | [`M2-open-ingress`](M2-open-ingress/) | scripting-only mock (Mock S) | ~25 min | `open_ingress.sh`: security group ingress open to `0.0.0.0/0` or `::/0` (except tcp 80/443) | `jq` nesting with `as` bindings, `select`/`not`, defaults, stdin vs file, input validation |

## Requirements

- Bash 3.2 or newer. On a Mac, `/bin/bash` is 3.2.57 and that is the target.
- `jq` for B2 and M2: `brew install jq` (macOS) or `apt-get install jq` (Debian/Ubuntu).
- Nothing else: no bats, no network, no AWS account, no credentials.

## Layout

```
run-tests.sh            runs every exercise's tests against one implementation
lib/assert.sh           tiny test helpers (run, expect_rc, expect_out, ...)
Bn-name/                practice exercises B1-B3
Mn-name/                mock interview exercises M1 (Mock B), M2 (scripting-only mock)
  README.md             the task: input format, exact output, exit codes, questions
  starter/<script>.sh   your file: usage comment only
  solution/<script>.sh  reference solution
  fixtures/             input files (and B3's mock checker)
  tests.sh              the tests for this exercise
```

## Running the tests

```sh
cd labs/anduril-round1/bash

./run-tests.sh                 # same as: ./run-tests.sh starter  (your work)
./run-tests.sh starter B2      # one exercise only
./run-tests.sh starter M       # both mock interview exercises
./run-tests.sh solution        # reference solutions: all should PASS
./run-tests.sh ~/my-attempt    # a directory holding your scripts

BASH_BIN=/bin/bash ./run-tests.sh solution   # force macOS's Bash 3.2
```

Each case prints `PASS` or `FAIL`; a failure lists what differed (exit status,
stdout, stderr). The runner exits 0 only if every case passed. The starters
fail on purpose until you fill them in. `BASH_BIN` picks the interpreter for
the runner, the tests and the scripts under test, so "it works on my Mac" means
it works on 3.2.

You can also run a single test file directly:
`bash B1-error-counts/tests.sh B1-error-counts/solution/count_errors.sh`.

## Shared contract

All the scripts follow the same rules, and the tests check each part
separately:

| Exit | Meaning |
|---|---|
| 0 | ran fine, nothing to report (no ERRORs, all running, all endpoints up, no REJECTs, no open ingress) |
| 1 | ran fine and found something (ERRORs, stopped instances, failed endpoints, REJECTs, open ingress) |
| 2 | could not do the job: wrong arguments, missing file, unparseable input |

- **stdout** is the report: data a person or the next command reads.
- **stderr** is for diagnostics: usage, "cannot read", warnings. Never mix
  them, so `script > report.txt` still shows errors on the terminal.
- Exit 2 must never look like exit 0. Empty or garbage input is an error, not
  "everything is fine".

## Error handling, deliberately

`set -euo pipefail` is a useful safety net, but it is **not** an error-handling
strategy, and the solutions here do not rely on it:

- `set -e` is skipped inside `if`, `while`, `&&`/`||` lists and functions called
  from them, and it says nothing useful to the user. It also turns
  "grep found nothing" (exit 1) into a silent crash.
- `pipefail` only changes which status a pipeline reports. You still have to
  look at it.

What the solutions do instead:

- Check inputs up front and fail with a clear message:
  `[ -r "$file" ] || { echo "$prog: cannot read '$file'" >&2; exit 2; }`
- Check the status of commands that can fail, right where they run:
  `out=$(jq ... ) || { echo "$prog: jq failed" >&2; exit 2; }`
- Save `$?` immediately (`rc=$?`) if you need it later. The next command overwrites it.
- Avoid hiding a failure in the middle of a pipeline: capture the output first,
  check it, then sort or format it.
- Use `trap ... EXIT` to clean up (temp files, background processes) on every
  path out of the script, including Ctrl-C (B3).

## Bash 3.2 (macOS) compatibility

macOS ships Bash 3.2 because of licensing, and many CI images and laptops still
run it. Do not use:

| Bash 4+ feature | Use instead |
|---|---|
| `declare -A` associative arrays | `awk` arrays, or `sort \| uniq -c` |
| `mapfile` / `readarray` | `while IFS= read -r line; do ...; done < file` |
| `${var,,}` / `${var^^}` | `tr '[:upper:]' '[:lower:]'` |
| `cmd \|& next` | `cmd 2>&1 \| next` |
| `wait -n`, `declare -n` | poll with `kill -0 "$pid"`; pass names/values explicitly |

And avoid GNU-only tools and flags: `sed -i` without a suffix, `grep -P`,
`date -d`, `readlink -f`, and the `timeout` command (macOS does not have it;
B3 builds its own). Set `LC_ALL=C` before `sort` if the order matters: macOS and
Linux collate punctuation differently in UTF-8 locales.

## What is real and what is simulated

- **B1** reads real files. The log lines are invented.
- **B2** reads JSON shaped like `aws ec2 describe-instances` output. The IDs,
  names and account numbers are fictional. No AWS call is made; you can pipe
  real output into it (`aws ec2 describe-instances | ./non_running.sh`).
- **B3** never touches the network in the tests. The check is injected through
  `CHECK_CMD`, and the tests use `fixtures/mock_check.sh`, which succeeds, fails
  or hangs depending on the host name. Without `CHECK_CMD` the script does a real
  TCP connect; the B3 README shows how to try it against a local
  `python3 -m http.server`. Do not point it at hosts you do not own.
- **M1** reads real files in the AWS VPC Flow Log default (version 2) format.
  The records are invented and use documentation address ranges
  (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`) and `10.x` addresses.
- **M2** reads JSON shaped like `aws ec2 describe-security-groups` output. The
  group, VPC and account IDs are fictional. No AWS call is made; you can pipe
  real output into it (`aws ec2 describe-security-groups | ./open_ingress.sh`).
