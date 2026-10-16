#!/usr/bin/env bash
# open_ingress.sh - report security group ingress open to the whole internet.
#
# Usage: open_ingress.sh [FILE]     (no FILE, or "-", reads stdin)
# Input:  JSON shaped like `aws ec2 describe-security-groups` output
# Report: ingress from 0.0.0.0/0 or ::/0, except exactly tcp 80 and tcp 443
# stdout: "<GroupId>\t<GroupName or ->\t<protocol>\t<ports>\t<cidr>" per finding
#         (input order), then "checked <n> group(s): <m> finding(s)"
# Exit:   0 no findings, 1 findings, 2 usage or input error

prog=open_ingress.sh

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

input=$(cat -- "$src") || { echo "$prog: failed to read '$src'" >&2; exit 2; }
[ -n "$input" ] || { echo "$prog: empty input (did the aws command fail?)" >&2; exit 2; }
printf '%s\n' "$input" | jq empty >/dev/null 2>&1 \
  || { echo "$prog: invalid JSON" >&2; exit 2; }
printf '%s\n' "$input" | jq -e 'type == "object" and (.SecurityGroups | type) == "array"' >/dev/null 2>&1 \
  || { echo "$prog: no SecurityGroups array (is this describe-security-groups output?)" >&2; exit 2; }

# One row per (permission, world-open CIDR). "-1" means every protocol and port.
report=$(printf '%s\n' "$input" | jq -r '
  [ .SecurityGroups[]
    | (.GroupId // "-") as $id | (.GroupName // "-") as $name
    | .IpPermissions[]?
    | select((.IpProtocol == "tcp" and .FromPort == .ToPort
              and (.FromPort == 80 or .FromPort == 443)) | not)
    | (if .IpProtocol == "-1" then "all" else .IpProtocol end) as $proto
    | (if .IpProtocol == "-1" or .FromPort == null then "all"
       elif .FromPort == .ToPort then "\(.FromPort)"
       else "\(.FromPort)-\(.ToPort)" end) as $ports
    | (.IpRanges[]?.CidrIp, .Ipv6Ranges[]?.CidrIpv6)
    | select(. == "0.0.0.0/0" or . == "::/0")
    | [$id, $name, $proto, $ports, .] ] as $found
  | ($found[] | @tsv),
    "checked \(.SecurityGroups | length) group(s): \($found | length) finding(s)"
') || { echo "$prog: jq failed to process the input" >&2; exit 2; }

printf '%s\n' "$report"
case $report in
  *": 0 finding(s)") exit 0 ;;
  *) exit 1 ;;
esac
