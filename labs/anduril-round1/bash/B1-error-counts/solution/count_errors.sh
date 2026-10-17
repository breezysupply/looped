#!/usr/bin/env bash
# count_errors.sh - count ERROR lines per service in an application log.
#
# Usage: count_errors.sh FILE
# Log line: <YYYY-MM-DDTHH:MM:SSZ> <LEVEL> <service>: <message>
# stdout:   "<service> <count>" per service (count desc, then name), then "TOTAL <n>"
# stderr:   usage/read errors; "skipped N malformed line(s)" warning
# Exit:     0 no ERROR lines, 1 ERROR lines found, 2 usage or input error

prog=count_errors.sh
export LC_ALL=C   # byte-wise sort and regex ranges: same result on macOS and Linux

if [ "$#" -ne 1 ]; then
  echo "usage: $prog FILE" >&2
  exit 2
fi
log=$1

# Check up front so the user gets our message, not awk's.
if [ ! -f "$log" ] || [ ! -r "$log" ]; then
  echo "$prog: cannot read '$log'" >&2
  exit 2
fi

# One awk pass. Fields: $1 timestamp, $2 level, $3 "service:".
# Only an exact "ERROR" level counts: not "error", not "ERRORS",
# not the word ERROR inside the message.
counts=$(awk -v prog="$prog" '
  NF == 0 { next }
  $1 !~ /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z$/ ||
  $2 !~ /^[A-Za-z]+$/ || $3 !~ /^[A-Za-z0-9._-]+:$/ { bad++; next }
  $2 == "ERROR" { n[substr($3, 1, length($3) - 1)]++ }
  END {
    if (bad > 0) printf "%s: skipped %d malformed line(s)\n", prog, bad > "/dev/stderr"
    for (s in n) print s, n[s]
  }' "$log") || { echo "$prog: failed to parse '$log'" >&2; exit 2; }

# awk's status was checked above; only now do we sort (no pipeline to hide it).
total=0
if [ -n "$counts" ]; then
  printf '%s\n' "$counts" | sort -k2,2nr -k1,1
  total=$(printf '%s\n' "$counts" | awk '{ t += $2 } END { print t }')
fi
echo "TOTAL $total"

if [ "$total" -gt 0 ]; then
  exit 1
fi
exit 0
