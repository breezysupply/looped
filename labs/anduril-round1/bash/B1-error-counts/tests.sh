#!/usr/bin/env bash
# Tests for B1. Usage: bash tests.sh [PATH/TO/count_errors.sh]  (default: starter)
here=$(cd "$(dirname "$0")" && pwd) || exit 2
# shellcheck source-path=SCRIPTDIR source=../lib/assert.sh
. "$here/../lib/assert.sh"
SCRIPT=${1:-$here/starter/count_errors.sh}
fx=$here/fixtures

run "$fx/normal.log"
begin "B1 normal log: per-service counts, sorted, TOTAL line"
expect_out "$(lines 'api-gateway 3' 'billing 2' 'ledger 2' 'auth 1' 'TOTAL 8')"
end
begin "B1 normal log: exit 1 when ERRORs found, stderr empty"
expect_rc 1
expect_err_empty
end

run "$fx/no-errors.log"
begin "B1 log without ERRORs: TOTAL 0, exit 0"
expect_rc 0
expect_out "TOTAL 0"
expect_err_empty
end

run "$fx/empty.log"
begin "B1 empty file: TOTAL 0, exit 0, nothing on stderr"
expect_rc 0
expect_out "TOTAL 0"
expect_err_empty
end

run "$fx/case.log"
begin "B1 only the exact level ERROR counts (not error/Error/ERRORS/message text)"
expect_rc 1
expect_out "$(lines 'error-reporter 1' 'TOTAL 1')"
expect_err_empty
end

run "$fx/malformed.log"
begin "B1 malformed lines skipped, valid ones still counted"
expect_rc 1
expect_out "$(lines 'queue 2' 'TOTAL 2')"
end
begin "B1 malformed lines reported on stderr (not stdout)"
expect_err_has "skipped 5 malformed line(s)"
end

printf '%s\n%s' \
  "2026-10-01T12:00:00Z ERROR dns: SERVFAIL for db.internal" \
  "2026-10-01T12:00:01Z ERROR dns: SERVFAIL for cache.internal" >"$TEST_TMP/no-newline.log"
run "$TEST_TMP/no-newline.log"
begin "B1 last line without trailing newline is still counted"
expect_rc 1
expect_out "$(lines 'dns 2' 'TOTAL 2')"
end

run "$fx/does-not-exist.log"
begin "B1 missing file: exit 2, message on stderr, stdout empty"
expect_rc 2
expect_out_empty
expect_err_has "cannot read"
end

run "$fx"
begin "B1 directory instead of a file: exit 2"
expect_rc 2
expect_out_empty
expect_err_has "cannot read"
end

run
begin "B1 no arguments: usage on stderr, exit 2"
expect_rc 2
expect_out_empty
expect_err_has "usage:"
end

run "$fx/normal.log" "$fx/case.log"
begin "B1 two arguments: usage on stderr, exit 2"
expect_rc 2
expect_out_empty
expect_err_has "usage:"
end

finish
