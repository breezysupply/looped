#!/usr/bin/env bash
# non_running.sh - list EC2 instances that are not "running".
#
# Usage: non_running.sh [FILE]     (no FILE, or "-", reads stdin)
# Input:  JSON shaped like `aws ec2 describe-instances` output
# stdout: "<id>\t<state>\t<Name tag or ->" per non-running instance (input order),
#         then "checked <n> instance(s): <m> not running"
# Exit:   0 all running, 1 some not running, 2 usage or input error

prog=non_running.sh

if [ "$#" -gt 1 ]; then
  echo "usage: $prog [FILE]" >&2
  exit 2
fi
src=${1:--}

command -v jq >/dev/null 2>&1 || { echo "$prog: jq is required (brew install jq)" >&2; exit 2; }
if [ "$src" != "-" ] && { [ ! -f "$src" ] || [ ! -r "$src" ]; }; then
  echo "$prog: cannot read '$src'" >&2
  exit 2
fi

# Read once, validate, then report. `cat -- -` reads stdin.
input=$(cat -- "$src") || { echo "$prog: failed to read '$src'" >&2; exit 2; }
if [ -z "$input" ]; then
  # Typical cause: `aws ... | non_running.sh` where the aws command failed.
  echo "$prog: empty input (did the aws command fail?)" >&2
  exit 2
fi
printf '%s\n' "$input" | jq empty >/dev/null 2>&1 \
  || { echo "$prog: invalid JSON" >&2; exit 2; }
printf '%s\n' "$input" | jq -e 'type == "object" and (.Reservations | type) == "array"' >/dev/null 2>&1 \
  || { echo "$prog: no Reservations array (is this describe-instances output?)" >&2; exit 2; }

# `[]?` tolerates a reservation without Instances; `//` supplies defaults.
report=$(printf '%s\n' "$input" | jq -r '
  [.Reservations[].Instances[]?] as $all
  | [$all[] | select((.State.Name // "unknown") != "running")] as $bad
  | ($bad[]
      | [ .InstanceId // "-",
          .State.Name // "unknown",
          ((.Tags // []) | map(select(.Key == "Name")) | .[0].Value // "-") ]
      | @tsv),
    "checked \($all | length) instance(s): \($bad | length) not running"
') || { echo "$prog: jq failed to process the input" >&2; exit 2; }

printf '%s\n' "$report"
case $report in
  *": 0 not running") exit 0 ;;
  *) exit 1 ;;
esac
