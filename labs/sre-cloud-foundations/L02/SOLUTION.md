# L02 worked solution

Read this after your own attempt. Commit ids below are the ones `inject.sh` produces; check
yours with `git log --oneline --all`.

## Variant A — the ticket branch carries a structural fault

1. Validate the branch before merging:
   ```sh
   git show ticket-142:config/beacon.yaml > /tmp/t142.yaml
   python3 -m beacon validate-config --config /tmp/t142.yaml
   # FATAL config: /tmp/t142.yaml:line 6: indentation of 3 is not a multiple of two
   ```
   Line 6 is `   request_timeout_s: 15` — three spaces. The intent (a 15 s timeout under
   `server:`) is clear; the indentation is wrong. A full YAML parser would also reject it.
2. `git merge ticket-142` conflicts on adjacent lines in `app:` — `main` bumped
   `version: "1.4.1"` (release), the ticket set `environment: staging-lab`. Both are intended.
   Resolve to:
   ```yaml
   server:
     listen: 127.0.0.1
     port: 8080
     request_timeout_s: 15
   app:
     version: "1.4.1"
     environment: staging-lab
   ```
   (and re-indent the timeout while you are in the file). Re-run `validate-config`, then
   `git add config/beacon.yaml && git commit`.

## Variant B — both sides changed the server block

`main` moved Beacon to 8081 and updated `deploy/service.json` to match (ops commit). The ticket
raised the timeout on the line next to `port:`. The conflict hunk shows `port: 8081 /
request_timeout_s: 10` versus `port: 8080 / request_timeout_s: 15`. Taking either side whole
loses an intended change; taking `--theirs` leaves Beacon on 8080 while the deploy tooling probes
8081. Keep `port: 8081` **and** `request_timeout_s: 15`; check the two files agree:
`grep -n port config/beacon.yaml; python3 -m json.tool deploy/service.json | grep listen_port`.

## Both variants — the behaviour change

`git log -p main -- config/` shows the "maintenance: prepare for host patching" commit also
set `inject.ready_fail: true`, so `/ready` answers 503 and the deploy health check fails. The
message talks about the README; the diff tells the truth. On a shared branch undo it with
`git revert <id>` — the history then shows both the change and its undo, and anyone who pulled
in between is not broken. `git reset --hard` would rewrite `main` (and the validator's
`history-kept` check fails).

## Prove it

```sh
git show HEAD:config/beacon.yaml > /tmp/head.yaml
python3 -m beacon api --config /tmp/head.yaml &  sleep 1
curl -s -o /dev/null -w '%{http_code}\n' 127.0.0.1:8081/ready   # 8080 in variant A → 200
curl -s 127.0.0.1:8081/version                                    # version the deploy expects
kill %1
```

Then run `validate.py`. Focused diff: `git diff <release-or-ops commit>..HEAD --stat` touches
only `config/beacon.yaml` — the revert cancels the maintenance commit's README edit too.
