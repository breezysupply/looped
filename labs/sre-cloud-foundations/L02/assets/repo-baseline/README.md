# beacon-config (L02 lab repository)

Deployment configuration for the lab copy of Beacon.

- `config/beacon.yaml` — what Beacon reads at start-up (Beacon's documented YAML subset).
- `deploy/service.json` — what the deploy tooling expects: the port it health-checks, the
  health path and status, and the version it expects `/version` to report.

The two files must agree. Every change goes through a branch and a reviewed merge; a bad
change on `main` is undone with `git revert`, never by rewriting shared history.
