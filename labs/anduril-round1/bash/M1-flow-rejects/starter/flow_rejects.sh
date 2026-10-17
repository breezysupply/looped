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
#
# The full contract is in ../README.md. Test with:  ../../run-tests.sh starter M1
# Must run on macOS Bash 3.2: no associative arrays, mapfile or ${var,,}.

# Your code here.
