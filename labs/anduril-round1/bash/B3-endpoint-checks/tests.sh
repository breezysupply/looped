#!/usr/bin/env bash
# Tests for B3. Usage: bash tests.sh [PATH/TO/check_endpoints.sh]  (default: starter)
# No network: every check goes through fixtures/mock_check.sh via CHECK_CMD.
here=$(cd "$(dirname "$0")" && pwd) || exit 2
# shellcheck source-path=SCRIPTDIR source=../lib/assert.sh
. "$here/../lib/assert.sh"
SCRIPT=${1:-$here/starter/check_endpoints.sh}
fx=$here/fixtures
export CHECK_CMD="$fx/mock_check.sh"
export CHECK_TIMEOUT=1

start=$SECONDS
run "$fx/mixed.txt"
elapsed=$((SECONDS - start))
begin "B3 mixed file: table in file order, blanks/comments skipped, summary"
expect_out "$(lines \
  'ENDPOINT                         STATUS' \
  'ok-api.internal:443              OK' \
  'fail-db.internal:5432            FAIL' \
  'hang-cache.internal:6379         TIMEOUT' \
  'ok-queue.internal:5672           OK' \
  'not-an-endpoint                  INVALID' \
  'ok-bad-port.internal:99999       INVALID' \
  '6 checked, 2 ok, 4 failed')"
end
begin "B3 mixed file: exit 1 when anything is not OK"
expect_rc 1
end
begin "B3 invalid lines reported on stderr with their line numbers"
expect_err_has "line 9: invalid endpoint 'not-an-endpoint'"
expect_err_has "line 10: invalid endpoint 'ok-bad-port.internal:99999'"
end
begin "B3 hanging endpoint is cut off by CHECK_TIMEOUT=1 (whole run <= 3 s, mock sleeps 10 s)"
expect_out_has "hang-cache.internal:6379         TIMEOUT"
expect_true "run took ${elapsed}s" [ "$elapsed" -le 3 ]
end

run "$fx/all-ok.txt"
begin "B3 all endpoints up: exit 0, stderr empty"
expect_rc 0
expect_out "$(lines \
  'ENDPOINT                         STATUS' \
  'ok-api.internal:443              OK' \
  'ok-queue.internal:5672           OK' \
  '2 checked, 2 ok, 0 failed')"
expect_err_empty
end

printf '%s\n%s' "ok-a.internal:80" "fail-b.internal:81" >"$TEST_TMP/no-newline.txt"
run "$TEST_TMP/no-newline.txt"
begin "B3 last line without trailing newline is still checked"
expect_rc 1
expect_out_has "fail-b.internal:81               FAIL"
expect_out_has "2 checked, 1 ok, 1 failed"
end

run "$fx/comments-only.txt"
begin "B3 file with only comments/blank lines: exit 2 'no endpoints'"
expect_rc 2
expect_out_empty
expect_err_has "no endpoints"
end

run "$fx/does-not-exist.txt"
begin "B3 missing file: exit 2, 'cannot read' on stderr"
expect_rc 2
expect_out_empty
expect_err_has "cannot read"
end

run
begin "B3 no arguments: usage on stderr, exit 2"
expect_rc 2
expect_out_empty
expect_err_has "usage:"
end

export CHECK_CMD="$fx/no-such-checker.sh"
run "$fx/all-ok.txt"
begin "B3 CHECK_CMD not executable: exit 2 before checking anything"
expect_rc 2
expect_out_empty
expect_err_has "CHECK_CMD"
end
export CHECK_CMD="$fx/mock_check.sh"

export CHECK_TIMEOUT=soon
run "$fx/all-ok.txt"
begin "B3 non-numeric CHECK_TIMEOUT: exit 2"
expect_rc 2
expect_out_empty
expect_err_has "CHECK_TIMEOUT"
end
export CHECK_TIMEOUT=1

finish
