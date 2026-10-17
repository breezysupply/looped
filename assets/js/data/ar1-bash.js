/* Anduril Round 1 prep — Bash exercises B1–B3.

   The exercises run on your Mac against local fixtures, never in this app:
   the app does not execute shell code. Full specifications, starters,
   reference solutions, fixtures and deterministic tests live in
   labs/anduril-round1/bash (README per exercise). This file is the in-app
   summary, the draft pad, and what to record afterwards. */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.ar1Bash = [
  {
    id: 'B1', title: 'Count ERROR lines per service in a log', mins: 20, dir: 'B1-error-counts', script: 'count_errors.sh',
    prompt: 'Write `count_errors.sh FILE`: print `<service> <count>` for every service with at least one line whose level is exactly `ERROR`, busiest first (ties by name, `LC_ALL=C`), then `TOTAL <n>`. Lines look like `2026-10-01T09:00:01Z ERROR api-gateway: upstream timeout`.',
    rules: [
      'Only the level field `ERROR` counts — not `error`, not ERROR inside an INFO message.',
      'Blank lines are ignored; malformed lines are skipped and reported on stderr as a warning.',
      'An empty file prints `TOTAL 0`.',
      'Missing/unreadable file or wrong arguments: message on stderr, nothing on stdout, exit 2.'
    ],
    exits: [['0', 'no ERROR lines'], ['1', 'at least one ERROR line'], ['2', 'usage error or unreadable file']],
    cases: ['normal log with ties', 'empty file', 'file with no errors', 'malformed and blank lines', 'missing file', 'wrong argument count', 'lowercase "error" and ERROR in messages'],
    ideas: ['awk field matching (`$2 == "ERROR"`)', 'sort keys: `sort -k2,2nr -k1,1`', 'quoting "$1"', 'stderr with `>&2`', 'deliberate exit codes'],
    explain: ['Why quote "$1"? What breaks with `my app.log`?', 'Name two ways `grep ERROR app.log | wc -l` is wrong for this task.', 'What does `$?` hold after `awk … | sort`, and what does `set -o pipefail` change?', 'Why exit 2 with nothing on stdout for usage errors?'],
    hints: ['Conceptual: split the job — validate input, extract the service from ERROR lines only, count, sort, print the total.', 'Evidence: run `./run-tests.sh starter B1` and read the first failing case name; it says which input class you have not handled.', 'Partial structure:\n```\nawk \'$2 == "ERROR" { sub(/:$/, "", $3); n[$3]++ } END { for (s in n) print s, n[s] }\' "$file" | LC_ALL=C sort -k2,2nr -k1,1\n```\n(This ignores malformed-line handling and the total.)', 'Full solution: `solution/count_errors.sh` in the package (marks the attempt assisted).'],
    refs: ['BASH']
  },
  {
    id: 'B2', title: 'List non-running EC2 instances with jq', mins: 20, dir: 'B2-instances-jq', script: 'non_running.sh', optional: true,
    prompt: 'Write `non_running.sh [FILE]` reading `aws ec2 describe-instances` JSON from FILE or stdin. Print one tab-separated line per instance whose state is not `running` — id, state, Name tag (or `-`) — in input order, then `checked N instance(s): M not running`.',
    rules: [
      '`Reservations: []` or a reservation with no `Instances` means zero instances, exit 0.',
      'Missing `State.Name` is `unknown` and is reported; missing Name tag is `-`; missing InstanceId is `-`.',
      'Empty input, invalid JSON, or JSON with no `Reservations` array: stderr message, nothing on stdout, exit 2 — never "all good".',
      'jq missing: say so and exit 2.'
    ],
    exits: [['0', 'all running, or no instances'], ['1', 'at least one not running'], ['2', 'usage, unreadable, empty, invalid or wrong-shaped input, or no jq']],
    cases: ['mixed states', 'all running', 'empty Reservations', 'missing fields', 'empty input (upstream aws failed)', 'invalid JSON', 'wrong shape', 'stdin vs file'],
    ideas: ['`.Reservations[]?.Instances[]?`', '`//` defaults', '`select(...)`', '`@tsv`', 'checking jq\'s exit status', '`jq -e` for shape checks'],
    explain: ['Why must empty input be an error rather than "0 not running"?', 'What does `[]?` do, and where would a missing array otherwise break?', 'How do you get the Name tag out of a Key/Value list?'],
    hints: ['Conceptual: validate first (non-empty, valid JSON, has Reservations), then transform, then count.', 'Evidence: `./run-tests.sh starter B2` — the case names map to the rules above.', 'Partial structure:\n```\njq -r \'.Reservations[]?.Instances[]? | select((.State.Name // "unknown") != "running") | [.InstanceId // "-", .State.Name // "unknown", ((.Tags // []) | map(select(.Key == "Name")) | .[0].Value // "-")] | @tsv\'\n```', 'Full solution: `solution/non_running.sh` (marks the attempt assisted).'],
    refs: ['JQ', 'BASH']
  },
  {
    id: 'B3', title: 'Check endpoints with bounded timeouts and a meaningful exit status', mins: 20, dir: 'B3-endpoint-checks', script: 'check_endpoints.sh', optional: true,
    prompt: 'Write `check_endpoints.sh FILE` that checks each `host:port` line in order with a per-check timeout (`CHECK_TIMEOUT`, default 3 s), prints a table and a summary, and exits non-zero if anything failed. Tests inject `CHECK_CMD=fixtures/mock_check.sh`, so nothing touches the network.',
    rules: [
      'A hanging check must be cut off by the timeout (macOS has no `timeout` and Bash 3.2 has no `wait -n`: background + `kill -0` polling + `kill`).',
      'Invalid lines are reported and counted as failures; the rest are still checked.',
      'Blank lines and `#` comments are skipped.',
      'Without CHECK_CMD use Bash\'s `/dev/tcp/HOST/PORT`; only point it at services you run locally.'
    ],
    exits: [['0', 'every endpoint OK'], ['1', 'at least one failed, timed out or was invalid'], ['2', 'usage, unreadable file, bad CHECK_TIMEOUT or CHECK_CMD']],
    cases: ['all OK', 'mixed OK/FAIL/TIMEOUT', 'invalid lines', 'comments and blanks', 'no trailing newline', 'bad CHECK_TIMEOUT', 'CHECK_CMD not executable', 'background job cleaned up on exit'],
    ideas: ['background jobs and `$!`', '`kill -0` polling', '`trap … EXIT` cleanup', 'counters for the summary', 'regex validation with `[[ =~ ]]`'],
    explain: ['Why bound every check instead of the whole run?', 'How do you know the killed check is not left running?', 'Why is "connection refused" a different finding from "timed out"?'],
    hints: ['Conceptual: one function per check that returns OK / FAIL / TIMEOUT; the main loop only counts and prints.', 'Evidence: `./run-tests.sh starter B3` (about 2 s); the hang case tells you whether your timeout works.', 'Partial structure:\n```\n"$cmd" "$host" "$port" >/dev/null 2>&1 & pid=$!\nwhile kill -0 "$pid" 2>/dev/null; do\n  # sleep a little, count elapsed time, kill "$pid" when over the limit\ndone\nwait "$pid"; rc=$?\n```', 'Full solution: `solution/check_endpoints.sh` (marks the attempt assisted).'],
    refs: ['BASH']
  }
];
LX.ar1BashRun = {
  setup: 'cd labs/anduril-round1/bash\n/bin/bash --version | head -1     # macOS ships 3.2.57; the exercises target it\ncommand -v jq || brew install jq   # B2 only',
  test: function (id) { return 'cd labs/anduril-round1/bash\n./run-tests.sh starter ' + id + '      # your work in ' + id + '-*/starter/\n./run-tests.sh solution ' + id + '     # reference: should pass'; },
  note: 'Tests are deterministic and local: fixtures cover normal input, empty input, malformed input and command failure. Verified with Bash 5.2 and a Linux build of Bash 3.2.57 (34/34 reference, 0/34 empty starters); not yet run on macOS /bin/bash with BSD tools — if something behaves differently on your Mac, that is worth knowing before the interview.'
};
