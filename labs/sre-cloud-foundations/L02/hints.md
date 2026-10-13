# L02 hints (four rungs; rungs 3–4 end independent credit for this attempt)

1. **Boundary.** Nothing is wrong with Beacon's code. Everything you need is in the repository's
   history: what each branch intended, what each commit actually changed, and whether the files
   at `HEAD` are acceptable to the programs that read them.
2. **Evidence source.** Validate with the consumer's parser, at a specific commit:
   `git show <rev>:config/beacon.yaml > /tmp/x.yaml && python3 -m beacon validate-config --config /tmp/x.yaml`.
   For behaviour, read diffs rather than messages: `git log -p main -- config/`.
3. **Discriminating command.** In the conflict, `git diff` (during the merge) shows both sides;
   compare each side with `git show main:deploy/service.json` and the ticket description. For the
   health-check failure, start Beacon from `HEAD`'s config and request the deploy file's health
   path; then find which commit introduced the setting that makes it fail.
4. **Root cause and fix.** Variant A: the ticket's `request_timeout_s` has three-space indentation
   and the conflict is version (main) next to environment (ticket) — keep both, fix the indent.
   Variant B: main moved the port to 8081 (with service.json) and the ticket raised the timeout on
   the adjacent line — keep 8081 and 15. Both: the maintenance commit set `inject.ready_fail: true`;
   `git revert <id>`, never `reset`.
