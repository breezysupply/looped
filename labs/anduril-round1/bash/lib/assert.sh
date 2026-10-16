# shellcheck shell=bash
# lib/assert.sh - tiny test helpers for the Bash labs. No bats needed.
# Works on Bash 3.2 (macOS /bin/bash) and Bash 5.
#
# A tests.sh file sources this, sets SCRIPT (the implementation under test),
# then for each case:
#
#   run ARGS...                     run "$BASH_BIN" "$SCRIPT" ARGS... (stdin = /dev/null)
#   run_stdin FILE ARGS...          same, with stdin read from FILE
#   begin "B1 name of the case"
#   expect_rc 0                     exit status
#   expect_out "$(lines 'a' 'b')"   exact stdout (trailing newlines ignored)
#   expect_err_has "cannot read"    stderr contains a substring
#   expect_err_empty
#   end                             prints PASS or FAIL with the reasons
#
# and finally calls `finish`, which exits 1 if any case failed.
# After `run`, the results are in RC, OUT and ERR. Several begin/end blocks
# may check one run.

BASH_BIN=${BASH_BIN:-bash}
# shellcheck disable=SC2034  # TAB and TEST_TMP are used by the tests.sh files
TAB=$(printf '\t')
_passed=0
_failed=0
_case=""
_why=""

# One private temp dir per test file, removed however the file exits.
_tmp=$(mktemp -d "${TMPDIR:-/tmp}/bash-labs.XXXXXX") || {
  echo "assert.sh: mktemp failed" >&2
  exit 2
}
# shellcheck disable=SC2034
TEST_TMP=$_tmp
trap 'if [ -n "$_tmp" ] && [ -d "$_tmp" ]; then rm -rf -- "$_tmp"; fi' EXIT

run() {
  "$BASH_BIN" "$SCRIPT" "$@" </dev/null >"$_tmp/out" 2>"$_tmp/err"
  RC=$?
  OUT=$(cat "$_tmp/out")
  ERR=$(cat "$_tmp/err")
}

run_stdin() {
  local input=$1
  shift
  "$BASH_BIN" "$SCRIPT" "$@" <"$input" >"$_tmp/out" 2>"$_tmp/err"
  RC=$?
  OUT=$(cat "$_tmp/out")
  ERR=$(cat "$_tmp/err")
}

# Print each argument on its own line: expected output without heredocs.
lines() { printf '%s\n' "$@"; }

begin() { _case=$1; _why=""; }

_note() { _why="$_why$1
"; }

_show() { printf '%s\n' "$1" | sed 's/^/        | /'; }

expect_rc() {
  [ "$RC" = "$1" ] || _note "exit status: expected $1, got $RC"
}

expect_out() {
  [ "$OUT" = "$1" ] || _note "stdout differs. expected:
$(_show "$1")
      actual:
$(_show "$OUT")"
}

expect_out_empty() {
  [ -z "$OUT" ] || _note "stdout should be empty, got:
$(_show "$OUT")"
}

expect_out_has() {
  case $OUT in
    *"$1"*) ;;
    *) _note "stdout should contain '$1', got:
$(_show "$OUT")" ;;
  esac
}

expect_err_has() {
  case $ERR in
    *"$1"*) ;;
    *) _note "stderr should contain '$1', got:
$(_show "$ERR")" ;;
  esac
}

expect_err_empty() {
  [ -z "$ERR" ] || _note "stderr should be empty, got:
$(_show "$ERR")"
}

# Free-form check: expect_true "description" COMMAND ARGS...
expect_true() {
  local what=$1
  shift
  "$@" || _note "$what"
}

end() {
  if [ -z "$_why" ]; then
    echo "PASS  $_case"
    _passed=$((_passed + 1))
  else
    echo "FAIL  $_case"
    printf '%s' "$_why" | sed 's/^/      /'
    _failed=$((_failed + 1))
  fi
}

finish() {
  echo "  -- $_passed passed, $_failed failed"
  if [ "$_failed" -eq 0 ]; then exit 0; fi
  exit 1
}
