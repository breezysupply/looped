#!/usr/bin/env bash
# run-tests.sh - run every exercise's tests against one implementation.
#
# Usage: ./run-tests.sh [starter|solution|DIR] [EXERCISE]
#   starter   test each exercise's starter/ script (the default; you edit these)
#   solution  test the reference solutions
#   DIR       a directory holding count_errors.sh, non_running.sh,
#             check_endpoints.sh, flow_rejects.sh and open_ingress.sh
#             (any that are missing fail their tests)
#   EXERCISE  optional prefix to run one exercise only, e.g. B2 or M1
#
# Env: BASH_BIN=/path/to/bash  interpreter for this runner, the tests and the
#      scripts under test, e.g. BASH_BIN=/bin/bash on a Mac to force 3.2.
# Exit: 0 every case passed, 1 any case failed, 2 usage error.

# Re-run ourselves under BASH_BIN so the whole run uses one interpreter.
if [ -n "${BASH_BIN:-}" ] && [ -z "${_RUN_TESTS_REEXEC:-}" ]; then
  _RUN_TESTS_REEXEC=1 exec "$BASH_BIN" "$0" "$@"
fi
BASH_BIN=${BASH_BIN:-$BASH}
export BASH_BIN

here=$(cd "$(dirname "$0")" && pwd) || exit 2
impl=${1:-starter}
only=${2:-}

case $impl in
  starter|solution) ;;
  *)
    if [ ! -d "$impl" ]; then
      echo "usage: $0 [starter|solution|DIR] [EXERCISE]" >&2
      exit 2
    fi
    impl=$(cd "$impl" && pwd) || exit 2
    ;;
esac

# shellcheck disable=SC2016  # $BASH_VERSION must expand in the child shell
echo "interpreter: $BASH_BIN (bash $("$BASH_BIN" -c 'echo "$BASH_VERSION"'))"
echo "implementation: $impl"

log=$(mktemp "${TMPDIR:-/tmp}/bash-labs-log.XXXXXX") || exit 2
trap 'rm -f -- "$log"' EXIT

passed=0
failed=0
broken=0
# "directory script" pairs. Plain strings, not an associative array: Bash 3.2.
for spec in "B1-error-counts count_errors.sh" \
            "B2-instances-jq non_running.sh" \
            "B3-endpoint-checks check_endpoints.sh" \
            "M1-flow-rejects flow_rejects.sh" \
            "M2-open-ingress open_ingress.sh"; do
  ex=${spec%% *}
  script=${spec#* }
  case $ex in "$only"*) ;; *) continue ;; esac

  case $impl in
    starter|solution) path=$here/$ex/$impl/$script ;;
    *) path=$impl/$script ;;
  esac

  echo
  echo "== $ex ($path)"
  "$BASH_BIN" "$here/$ex/tests.sh" "$path" >"$log" 2>&1
  rc=$?
  cat "$log"
  p=$(grep -c '^PASS ' "$log")
  f=$(grep -c '^FAIL ' "$log")
  passed=$((passed + p))
  failed=$((failed + f))
  # A test file that dies without reporting failures is still a failure.
  if [ "$rc" -ne 0 ] && [ "$f" -eq 0 ]; then
    echo "ERROR: $ex/tests.sh exited $rc"
    broken=$((broken + 1))
  fi
done

echo
echo "TOTAL: $passed passed, $failed failed"
if [ "$failed" -eq 0 ] && [ "$broken" -eq 0 ] && [ "$passed" -gt 0 ]; then
  exit 0
fi
exit 1
