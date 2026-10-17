#!/usr/bin/env bash
# Tests for B2. Usage: bash tests.sh [PATH/TO/non_running.sh]  (default: starter)
here=$(cd "$(dirname "$0")" && pwd) || exit 2
# shellcheck source-path=SCRIPTDIR source=../lib/assert.sh
. "$here/../lib/assert.sh"
SCRIPT=${1:-$here/starter/non_running.sh}
fx=$here/fixtures
T=$TAB

if ! command -v jq >/dev/null 2>&1; then
  echo "FAIL  B2 jq is not installed (brew install jq / apt-get install jq)"
  exit 1
fi

mixed_expected=$(lines \
  "i-0a1b2c3d4e5f00002${T}stopped${T}web-2" \
  "i-0a1b2c3d4e5f00003${T}terminated${T}-" \
  "i-0a1b2c3d4e5f00004${T}pending${T}-" \
  "i-0a1b2c3d4e5f00005${T}unknown${T}batch worker" \
  "checked 5 instance(s): 4 not running")

run "$fx/mixed.json"
begin "B2 mixed states from a file: non-running rows (tab-separated) + summary"
expect_out "$mixed_expected"
end
begin "B2 mixed states: exit 1, stderr empty"
expect_rc 1
expect_err_empty
end

run_stdin "$fx/mixed.json"
begin "B2 reads stdin when no FILE is given"
expect_rc 1
expect_out "$mixed_expected"
expect_err_empty
end

run_stdin "$fx/mixed.json" -
begin "B2 '-' means stdin"
expect_rc 1
expect_out "$mixed_expected"
end

run "$fx/all-running.json"
begin "B2 all running: only the summary line, exit 0"
expect_rc 0
expect_out "checked 2 instance(s): 0 not running"
expect_err_empty
end

run "$fx/empty-reservations.json"
begin "B2 empty Reservations: zero instances is fine, exit 0"
expect_rc 0
expect_out "checked 0 instance(s): 0 not running"
expect_err_empty
end

run "$fx/malformed.json"
begin "B2 malformed JSON: exit 2, 'invalid JSON' on stderr, stdout empty"
expect_rc 2
expect_out_empty
expect_err_has "invalid JSON"
end

run "$fx/wrong-shape.json"
begin "B2 valid JSON without Reservations: exit 2, not 'all good'"
expect_rc 2
expect_out_empty
expect_err_has "Reservations"
end

run_stdin /dev/null
begin "B2 empty stdin (upstream aws command failed): exit 2"
expect_rc 2
expect_out_empty
expect_err_has "empty input"
end

run "$fx/does-not-exist.json"
begin "B2 missing file: exit 2, 'cannot read' on stderr"
expect_rc 2
expect_out_empty
expect_err_has "cannot read"
end

run "$fx/mixed.json" "$fx/all-running.json"
begin "B2 two arguments: usage on stderr, exit 2"
expect_rc 2
expect_out_empty
expect_err_has "usage:"
end

finish
