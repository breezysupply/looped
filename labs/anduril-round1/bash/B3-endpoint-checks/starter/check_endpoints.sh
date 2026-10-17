#!/usr/bin/env bash
# check_endpoints.sh - check host:port endpoints listed in a file, one at a time.
#
# Usage: check_endpoints.sh FILE
# Env:   CHECK_TIMEOUT  whole seconds allowed per check (default 3)
#        CHECK_CMD      path to an executable run as `CHECK_CMD HOST PORT`;
#                       exit 0 means up. Default: TCP connect via bash /dev/tcp.
# stdout: table "ENDPOINT STATUS" (OK|FAIL|TIMEOUT|INVALID), then a summary line
# Exit:   0 all OK, 1 any not OK, 2 usage or input error
#
# The full contract is in ../README.md. Test with:  ../../run-tests.sh starter B3
# macOS has no `timeout` command and Bash 3.2 has no `wait -n`: build the
# timeout yourself. Must run on macOS Bash 3.2.

# Your code here.
