#!/usr/bin/env bash
# check_endpoints.sh - check host:port endpoints listed in a file, one at a time.
# Usage: check_endpoints.sh FILE
# Env:   CHECK_TIMEOUT seconds per check (default 3); CHECK_CMD executable run as
#        `CHECK_CMD HOST PORT`, exit 0 = up (default: TCP connect via /dev/tcp)
# Exit:  0 all OK, 1 any FAIL/TIMEOUT/INVALID, 2 usage or input error
prog=check_endpoints.sh
export LC_ALL=C
timeout=${CHECK_TIMEOUT:-3}
pid=""

# shellcheck disable=SC2317  # called indirectly through "$checker"
tcp_check() { (exec 3<>"/dev/tcp/$1/$2"); }

valid_endpoint() {   # host:port, port 1-65535; no scheme, no IPv6
  case $1 in *:*:* | :* | *: | *[!A-Za-z0-9.:-]*) return 1 ;; *:*) ;; *) return 1 ;; esac
  case ${1##*:} in *[!0-9]*) return 1 ;; esac
  [ "${1##*:}" -ge 1 ] 2>/dev/null && [ "${1##*:}" -le 65535 ]
}

# Run "$@" in the background, poll it, kill it after $timeout seconds.
# Returns the command's status, or 124 on timeout (like GNU timeout).
run_with_timeout() {
  local ticks=$((timeout * 10)) rc
  "$@" </dev/null >/dev/null 2>&1 &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$ticks" -le 0 ]; then
      kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; pid=""; return 124
    fi
    sleep 0.1; ticks=$((ticks - 1))
  done
  wait "$pid"; rc=$?; pid=""; return "$rc"
}

# Never leave a checker running behind us, even on Ctrl-C.
trap 'if [ -n "$pid" ]; then kill "$pid" 2>/dev/null; fi' EXIT
trap 'exit 130' INT TERM

if [ "$#" -ne 1 ]; then echo "usage: $prog FILE" >&2; exit 2; fi
file=$1
if [ ! -f "$file" ] || [ ! -r "$file" ]; then echo "$prog: cannot read '$file'" >&2; exit 2; fi
case $timeout in '' | *[!0-9]* | 0) echo "$prog: CHECK_TIMEOUT must be a positive integer" >&2; exit 2 ;; esac
checker=${CHECK_CMD:-tcp_check}
if [ -n "${CHECK_CMD:-}" ] && { [ ! -f "$CHECK_CMD" ] || [ ! -x "$CHECK_CMD" ]; }; then
  echo "$prog: CHECK_CMD '$CHECK_CMD' is not an executable file" >&2; exit 2
fi
grep -qv -e '^[[:space:]]*$' -e '^[[:space:]]*#' "$file" || { echo "$prog: no endpoints in '$file'" >&2; exit 2; }

printf '%-32s %s\n' ENDPOINT STATUS
n=0 total=0 ok=0
while read -r line || [ -n "$line" ]; do   # default IFS trims surrounding blanks
  n=$((n + 1))
  case $line in '' | '#'*) continue ;; esac
  total=$((total + 1))
  if valid_endpoint "$line"; then
    run_with_timeout "$checker" "${line%:*}" "${line##*:}"
    case $? in 0) status=OK; ok=$((ok + 1)) ;; 124) status=TIMEOUT ;; *) status=FAIL ;; esac
  else
    echo "$prog: line $n: invalid endpoint '$line' (want host:port)" >&2
    status=INVALID
  fi
  printf '%-32s %s\n' "$line" "$status"
done <"$file"

echo "$total checked, $ok ok, $((total - ok)) failed"
if [ "$ok" -ne "$total" ]; then exit 1; fi
exit 0
