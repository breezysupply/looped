#!/usr/bin/env bash
# non_running.sh - list EC2 instances that are not "running".
#
# Usage: non_running.sh [FILE]     (no FILE, or "-", reads stdin)
# Input:  JSON shaped like `aws ec2 describe-instances` output
# stdout: "<id>\t<state>\t<Name tag or ->" per non-running instance (input order),
#         then "checked <n> instance(s): <m> not running"
# Exit:   0 all running, 1 some not running, 2 usage or input error
#
# The full contract is in ../README.md. Test with:  ../../run-tests.sh starter B2
# Needs jq (brew install jq). Must run on macOS Bash 3.2.

# Your code here.
