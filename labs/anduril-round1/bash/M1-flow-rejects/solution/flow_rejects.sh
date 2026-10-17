#!/usr/bin/env bash
# flow_rejects.sh - count REJECTed VPC Flow Log records per destination port.
#
# Usage: flow_rejects.sh FILE
# Record (default v2 format, 14 space-separated fields):
#   version account-id interface-id srcaddr dstaddr srcport dstport protocol
#   packets bytes start end action log-status
# stdout: "<dstport> <count>" per port (count desc, then port asc numerically),
#         then "REJECT <rejects> of <valid records>"
# stderr: usage/read errors; "skipped N malformed line(s)" warning
# Exit:   0 no REJECT records, 1 REJECTs found, 2 usage or input error

prog=flow_rejects.sh
export LC_ALL=C

if [ "$#" -ne 1 ]; then
  echo "usage: $prog FILE" >&2
  exit 2
fi
log=$1
if [ ! -f "$log" ] || [ ! -r "$log" ]; then
  echo "$prog: cannot read '$log'" >&2
  exit 2
fi

# $7 dstport, $13 action, $14 log-status. NODATA/SKIPDATA records are valid
# but carry no traffic ("-" fields), so they never count as REJECT.
out=$(awk -v prog="$prog" '
  NF == 0 { next }
  NF != 14 || $1 != "2" { bad++; next }
  $14 == "NODATA" || $14 == "SKIPDATA" { recs++; next }
  $14 != "OK" || ($13 != "ACCEPT" && $13 != "REJECT") { bad++; next }
  { recs++ }
  $13 == "REJECT" { n[$7]++; rej++ }
  END {
    if (bad > 0) printf "%s: skipped %d malformed line(s)\n", prog, bad > "/dev/stderr"
    for (p in n) print p, n[p]
    printf "REJECT %d of %d\n", rej, recs
  }' "$log") || { echo "$prog: failed to parse '$log'" >&2; exit 2; }

# The summary is awk's last line; sort only the per-port lines above it.
summary=$(printf '%s\n' "$out" | tail -n 1)
printf '%s\n' "$out" | sed '$d' | sort -k2,2nr -k1,1n
echo "$summary"

case $summary in
  "REJECT 0 of "*) exit 0 ;;
  *) exit 1 ;;
esac
