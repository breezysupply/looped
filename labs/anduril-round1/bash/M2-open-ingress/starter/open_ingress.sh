#!/usr/bin/env bash
# open_ingress.sh - report security group ingress open to the whole internet.
#
# Usage: open_ingress.sh [FILE]     (no FILE, or "-", reads stdin)
# Input:  JSON shaped like `aws ec2 describe-security-groups` output
# Report: ingress from 0.0.0.0/0 or ::/0, except exactly tcp 80 and tcp 443
# stdout: "<GroupId>\t<GroupName or ->\t<protocol>\t<ports>\t<cidr>" per finding
#         (input order), then "checked <n> group(s): <m> finding(s)"
# Exit:   0 no findings, 1 findings, 2 usage or input error
#
# The full contract is in ../README.md. Test with:  ../../run-tests.sh starter M2
# Needs jq (brew install jq). Must run on macOS Bash 3.2.

# Your code here.
