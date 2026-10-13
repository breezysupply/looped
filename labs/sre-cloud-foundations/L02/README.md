# L02 — A config change on a branch: validate, merge, revert

Module M01 · ~60 min practical · profile `linux-arm64` · runs **inside the course VM**

## Ticket

> **BEA-142** — A teammate finished ticket-142 on its own branch: Beacon's lab deployment should
> report the environment `staging-lab` and allow a 15-second request timeout. Meanwhile `main`
> moved on. Please merge the ticket into `main` so the deploy tooling can pick it up.
> Also: since yesterday evening the deploy health check against the lab Beacon fails, and nobody
> has touched Beacon's code. Get `main` back to a state that deploys cleanly.

The repository is small on purpose: `config/beacon.yaml` (what Beacon reads) and
`deploy/service.json` (what the deploy tooling expects — the port it probes, the health path
and the version it expects). The two files must agree.

## Objectives

- `obj-m01-02` use Git safely for an operational change: branch, focused diff, conflict resolved
  without losing either intended change, a bad change reverted so behaviour is restored
- `obj-m01-03` read and validate structured configuration (YAML and JSON) with a tool before
  committing it

## What is fixture-controlled

`inject.sh` builds `/opt/beacon-l02/repo` with a fixed history (fixed authors and dates, so every
learner sees the same commit ids for a given variant). `LOOPED_VARIANT=variant-a|variant-b`
changes what the ticket branch and `main` did. Beacon itself is the unmodified starter from
`labs/sre-cloud-foundations/beacon`; nothing is wrong with its code.

## Steps and checkpoints

**Checkpoint c1 — read before you merge.**

1. `sudo bash labs/sre-cloud-foundations/L02/setup.sh` (as root; the repository is handed to
   your user). Then, as yourself: `cd /opt/beacon-l02/repo`.
2. `git log --oneline --graph --all`, `git show ticket-142`, `git diff main...ticket-142`.
   What did each side intend? Write it down in `evidence/L02-notes.md` before merging.
3. Validate the ticket's config **as committed on the branch**, with the tool Beacon uses:
   ```sh
   export PYTHONPATH=<your course repo>/labs/sre-cloud-foundations/beacon
   git show ticket-142:config/beacon.yaml > /tmp/t142.yaml
   python3 -m beacon validate-config --config /tmp/t142.yaml; echo "exit=$?"
   git show ticket-142:deploy/service.json | python3 -m json.tool >/dev/null && echo json-ok
   ```

**Checkpoint c2 — merge, resolve, revert, prove.**

4. `git switch main && git merge ticket-142`. Resolve any conflict by keeping **both** intended
   changes. Re-validate the resolved files before `git commit`.
5. Find the commit that changed behaviour (`git log -p main -- config`, or `git bisect`), and
   undo it with `git revert <id>` — not `git reset`: `main` is shared history.
6. Prove behaviour: start Beacon from the committed config and probe what `deploy/service.json`
   expects (`curl -s -o /dev/null -w '%{http_code}\n' 127.0.0.1:<port>/ready`, `/version`).
7. `python3 labs/sre-cloud-foundations/L02/validate.py --explanation-file labs/sre-cloud-foundations/L02/evidence/L02-notes.md`

## What you should observe

- A validator error that names a **line** and a reason, or a config that is syntactically fine
  and still wrong for the deploy tooling. "It parses" is not the same as "it is right".
- A conflict hunk where both sides are legitimate. The fix is a decision per line, not
  `--ours`/`--theirs` for the whole file.
- A commit whose message does not mention the setting it changed. `git log -p` shows the diff;
  the message is a claim.

## Pause / resume

All state is `/opt/beacon-l02/repo` and `/opt/beacon-l02/.lab/` (the commit ids the validator
expects). `sudo bash labs/sre-cloud-foundations/L02/reset.sh` rebuilds the repository for the same
variant (your work in the exercise repo is discarded; `evidence/` is kept).

## Validation

`validate.py` uses real `git` (`merge-base --is-ancestor`, `log`, `diff --name-only`, `status`)
and Beacon's own parser; it starts Beacon from `HEAD:config/beacon.yaml` and probes the port and
health path from `HEAD:deploy/service.json`. An unresolved merge, a rewritten history, a
whole-file `--theirs`, or a revert done by hand without a revert commit all fail.

## Lab versus production

Real repositories add branch protection, required reviews and CI that runs the same validation
on every pull request. The habits are the same: validate with the consumer's parser, read the
diff not the message, revert on shared branches.

## Limits

This lab does not prove you can handle large merges, rebases of shared work, signed commits or
a CI pipeline (M10). It proves one focused config change, one two-sided conflict and one
revert, judged against the real repository state. Beacon's YAML reader is a documented subset;
a full YAML parser would accept some files Beacon rejects (and the reverse).

## References

- T12 Git documentation (`git-merge(1)`, `git-revert(1)`, `git-bisect(1)`)
