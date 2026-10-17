#!/usr/bin/env bash
# Tests for M2. Usage: bash tests.sh [PATH/TO/open_ingress.sh]  (default: starter)
here=$(cd "$(dirname "$0")" && pwd) || exit 2
# shellcheck source-path=SCRIPTDIR source=../lib/assert.sh
. "$here/../lib/assert.sh"
SCRIPT=${1:-$here/starter/open_ingress.sh}
fx=$here/fixtures
T=$TAB

# True when the last run's stdout does not contain $1. Called via expect_true.
# shellcheck disable=SC2317
out_lacks() { case $OUT in *"$1"*) return 1 ;; esac; return 0; }

if ! command -v jq >/dev/null 2>&1; then
  echo "FAIL  M2 jq is not installed (brew install jq / apt-get install jq)"
  exit 1
fi

mixed_expected=$(lines \
  "sg-0a1b2c3d4e5f60001${T}bastion${T}tcp${T}22${T}0.0.0.0/0" \
  "sg-0a1b2c3d4e5f60002${T}web-https${T}udp${T}443${T}0.0.0.0/0" \
  "sg-0a1b2c3d4e5f60003${T}web-http${T}tcp${T}80-443${T}0.0.0.0/0" \
  "sg-0a1b2c3d4e5f60004${T}debug-all${T}all${T}all${T}0.0.0.0/0" \
  "sg-0a1b2c3d4e5f60004${T}debug-all${T}all${T}all${T}::/0" \
  "sg-0a1b2c3d4e5f60005${T}app-range${T}tcp${T}8000-8100${T}::/0" \
  "sg-0a1b2c3d4e5f60007${T}-${T}tcp${T}0-65535${T}0.0.0.0/0" \
  "checked 8 group(s): 7 finding(s)")

run "$fx/mixed.json"
begin "M2 mixed groups from a file: one tab-separated row per open CIDR + summary"
expect_out "$mixed_expected"
end
begin "M2 mixed groups: exit 1, stderr empty"
expect_rc 1
expect_err_empty
end
begin "M2 exactly tcp 80 / tcp 443 are allowed, but udp 443 and tcp 80-443 are not"
expect_out_has "web-https${T}udp${T}443${T}"
expect_out_has "web-http${T}tcp${T}80-443${T}"
expect_true "tcp 443 alone was reported" out_lacks "${T}tcp${T}443${T}"
expect_true "tcp 80 alone was reported" out_lacks "${T}tcp${T}80${T}"
end
begin "M2 a /32 or private CIDR next to 0.0.0.0/0 is not reported (0.0.0.0/0 still is)"
expect_out_has "bastion${T}tcp${T}22${T}0.0.0.0/0"
expect_true "203.0.113.10/32 was reported" out_lacks "203.0.113.10/32"
expect_true "10.20.0.0/16 was reported" out_lacks "10.20.0.0/16"
expect_true "10.0.0.0/8 was reported" out_lacks "10.0.0.0/8"
end

run_stdin "$fx/mixed.json"
begin "M2 reads stdin when no FILE is given"
expect_rc 1
expect_out "$mixed_expected"
expect_err_empty
end

run_stdin "$fx/mixed.json" -
begin "M2 '-' means stdin"
expect_rc 1
expect_out "$mixed_expected"
end

run "$fx/clean.json"
begin "M2 only tcp 80/443 open to the world: summary only, exit 0"
expect_rc 0
expect_out "checked 2 group(s): 0 finding(s)"
expect_err_empty
end

run "$fx/empty-groups.json"
begin "M2 empty SecurityGroups: zero groups is fine, exit 0"
expect_rc 0
expect_out "checked 0 group(s): 0 finding(s)"
expect_err_empty
end

run "$fx/malformed.json"
begin "M2 malformed JSON: exit 2, 'invalid JSON' on stderr, stdout empty"
expect_rc 2
expect_out_empty
expect_err_has "invalid JSON"
end

run "$fx/wrong-shape.json"
begin "M2 valid JSON without SecurityGroups: exit 2, not 'all good'"
expect_rc 2
expect_out_empty
expect_err_has "SecurityGroups"
end

run_stdin /dev/null
begin "M2 empty stdin (upstream aws command failed): exit 2"
expect_rc 2
expect_out_empty
expect_err_has "empty input"
end

run "$fx/does-not-exist.json"
begin "M2 missing file: exit 2, 'cannot read' on stderr"
expect_rc 2
expect_out_empty
expect_err_has "cannot read"
end

run "$fx/mixed.json" "$fx/clean.json"
begin "M2 two arguments: usage on stderr, exit 2"
expect_rc 2
expect_out_empty
expect_err_has "usage:"
end

# A PATH with common tools but no jq. The interpreter is called by absolute path.
nojq=$TEST_TMP/nojq-bin
mkdir -p "$nojq"
for t in cat sed awk grep sort tr head tail wc cut mktemp rm printf; do
  p=$(command -v "$t" 2>/dev/null) || continue
  case $p in /*) ln -s "$p" "$nojq/$t" ;; esac
done
bash_abs=$(command -v "$BASH_BIN")
PATH=$nojq "$bash_abs" "$SCRIPT" "$fx/mixed.json" </dev/null >"$TEST_TMP/out" 2>"$TEST_TMP/err"
RC=$?
OUT=$(cat "$TEST_TMP/out")
ERR=$(cat "$TEST_TMP/err")
begin "M2 jq not installed: exit 2, 'jq is required' on stderr, stdout empty"
expect_rc 2
expect_out_empty
expect_err_has "jq is required"
end

finish
