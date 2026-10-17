#!/usr/bin/env bash
# Tests for M1. Usage: bash tests.sh [PATH/TO/flow_rejects.sh]  (default: starter)
here=$(cd "$(dirname "$0")" && pwd) || exit 2
# shellcheck source-path=SCRIPTDIR source=../lib/assert.sh
. "$here/../lib/assert.sh"
SCRIPT=${1:-$here/starter/flow_rejects.sh}
fx=$here/fixtures

run "$fx/normal.log"
begin "M1 normal log: REJECTs per dstport, count desc then port asc (numeric), summary"
expect_out "$(lines '22 3' '445 2' '3389 2' '23 1' '8080 1' '41322 1' '49731 1' 'REJECT 11 of 18')"
end
begin "M1 normal log: exit 1 when REJECTs found, stderr empty"
expect_rc 1
expect_err_empty
end

run "$fx/all-accept.log"
begin "M1 only ACCEPT records: summary only, exit 0"
expect_rc 0
expect_out "REJECT 0 of 4"
expect_err_empty
end

run "$fx/empty.log"
begin "M1 empty file: 'REJECT 0 of 0', exit 0, nothing on stderr"
expect_rc 0
expect_out "REJECT 0 of 0"
expect_err_empty
end

run "$fx/nodata.log"
begin "M1 NODATA/SKIPDATA records count as records but never as REJECT"
expect_rc 1
expect_out "$(lines '22 1' '3389 1' 'REJECT 2 of 6')"
expect_err_empty
end

run "$fx/malformed.log"
begin "M1 malformed lines skipped (header, field count, version, action, log-status)"
expect_rc 1
expect_out "$(lines '22 2' 'REJECT 2 of 3')"
end
begin "M1 malformed lines reported on stderr (not stdout)"
expect_err_has "skipped 6 malformed line(s)"
end

printf '%s\n%s' \
  "2 123456789012 eni-0d8e3a6f1b2c4e507 192.0.2.117 10.20.11.25 60125 3389 6 1 60 1760430060 1760430118 REJECT OK" \
  "2 123456789012 eni-0d8e3a6f1b2c4e507 192.0.2.117 10.20.11.25 60126 3389 6 1 60 1760430060 1760430118 REJECT OK" \
  >"$TEST_TMP/no-newline.log"
run "$TEST_TMP/no-newline.log"
begin "M1 last line without trailing newline is still counted"
expect_rc 1
expect_out "$(lines '3389 2' 'REJECT 2 of 2')"
end

run "$fx/does-not-exist.log"
begin "M1 missing file: exit 2, message on stderr, stdout empty"
expect_rc 2
expect_out_empty
expect_err_has "cannot read"
end

run "$fx"
begin "M1 directory instead of a file: exit 2"
expect_rc 2
expect_out_empty
expect_err_has "cannot read"
end

run
begin "M1 no arguments: usage on stderr, exit 2"
expect_rc 2
expect_out_empty
expect_err_has "usage:"
end

run "$fx/normal.log" "$fx/nodata.log"
begin "M1 two arguments: usage on stderr, exit 2"
expect_rc 2
expect_out_empty
expect_err_has "usage:"
end

finish
