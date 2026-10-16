#!/usr/bin/env bash
# count_errors.sh - count ERROR lines per service in an application log.
#
# Usage: count_errors.sh FILE
# Log line: <YYYY-MM-DDTHH:MM:SSZ> <LEVEL> <service>: <message>
# stdout:   "<service> <count>" per service (count desc, then name), then "TOTAL <n>"
# stderr:   usage/read errors; "skipped N malformed line(s)" warning
# Exit:     0 no ERROR lines, 1 ERROR lines found, 2 usage or input error
#
# The full contract is in ../README.md. Test with:  ../../run-tests.sh starter B1
# Must run on macOS Bash 3.2: no associative arrays, mapfile or ${var,,}.

# Your code here.
