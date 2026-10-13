/* SRE & Cloud Deployment Foundations — local lab specifications L01–L32.

   LabSpec (curriculum §5): stable id, version, module, objectives, execution
   mode, estimate, environment profile, prerequisites, learner brief,
   checkpoints with resume instructions, assets, setup/fault/tasks,
   validation checks (critical flags), reset, teardown, evidence
   instructions, four staged hints, solution reference, sources, status and
   the independent variant. Commands are what the learner runs on their own
   machine; the app never runs them. Status: draft | validated |
   execution-not-tested — what actually ran is in
   docs/sre-cloud-foundations/implementation-status.md. */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.sreLabs = LX.sreLabs || [];

(function () {
  var DIR = 'labs/sre-cloud-foundations/';
  function lab(x) { x.version = x.version || '1.0'; LX.sreLabs.push(x); }

  lab({
    id: 'L01', moduleId: 'M01', title: 'The lab VM, your workspace, and a Beacon process that will not start',
    objectiveIds: ['obj-m01-04', 'obj-m01-01'], executionMode: 'local', estimatedMinutes: 60, environmentProfile: 'linux-arm64', prerequisites: [],
    learnerBrief: 'Create the disposable ARM64 Linux VM and your Git workspace, record a tool inventory, then investigate a Beacon launcher that fails immediately. The point is the habit: quote the exact error, hold two hypotheses, pick the one read-only check that separates them, reproduce, fix the smallest thing, verify on the user path.\n\nRuns inside the course VM (`limactl shell looped-foundations`). The launcher is broken on purpose by `inject.sh` in one of two ways; the validator never says which.',
    checkpoints: [
      { id: 'c1', title: 'VM, workspace, inventory', resumeInstructions: 'If the VM exists, `limactl shell looped-foundations`; `sudo bash labs/sre-cloud-foundations/L01/setup.sh` is idempotent and rewrites the inventory. Your branch and notes are in the repository, not the VM.' },
      { id: 'c2', title: 'Reproduce, hypothesise, discriminate, fix', resumeInstructions: 'Your hypothesis log is `labs/sre-cloud-foundations/L01/evidence/L01-hypotheses.md`; `reset.sh` restores the broken launcher without touching it.' }
    ],
    assetPaths: ['README.md', 'setup.sh', 'inject.sh', 'validate.py', 'reset.sh', 'teardown.sh', 'assets/hypotheses-template.md', 'SOLUTION.md', 'VARIANT.md', 'hints.md', 'evidence-example.json'],
    setup: ['# on the Mac', 'labs/sre-cloud-foundations/profiles/linux-arm64/vm-create.sh', 'limactl shell looped-foundations', '# inside the VM, at the repository root', 'sudo bash labs/sre-cloud-foundations/L01/setup.sh'],
    faultInjection: ['# setup.sh already injected variant-a; to choose explicitly:', 'sudo LOOPED_VARIANT=variant-b bash ' + DIR + 'L01/inject.sh'],
    tasks: ['Read `evidence/L01-inventory.txt`; confirm arch, distro and python3 are recorded.', 'Reproduce with `bash /opt/beacon-l01/run-beacon.sh` and quote the FATAL line into your hypothesis log (template in assets/).', 'Write two or more hypotheses that each explain the exact line, then the one read-only command that separates them. Run it.', 'Make the smallest change that addresses the surviving hypothesis (the launcher or its environment; never the file layout, never permissions).', 'Verify: the launcher starts and `curl -s http://127.0.0.1:8080/healthz` returns `ok`; stop the process.', 'Run validate.py and import the evidence JSON.'],
    validation: [
      { id: 'vm-marker', description: 'running inside the course VM; architecture recorded', critical: true },
      { id: 'tool-inventory', description: 'evidence/L01-inventory.txt has arch and python lines', critical: true },
      { id: 'hypothesis-log', description: 'the log has Observation, 2+ Hypotheses, Discriminating check, Result', critical: true },
      { id: 'reproduced', description: 'the log quotes the fixture\'s actual FATAL line verbatim', critical: true },
      { id: 'fixed', description: 'the launcher starts Beacon and /healthz answers 200', critical: true },
      { id: 'minimal-fix', description: 'config still at its original path (advisory)', critical: false },
      { id: 'no-unsafe', description: 'nothing under /opt/beacon-l01 became world-writable', critical: true }
    ],
    reset: ['sudo bash ' + DIR + 'L01/reset.sh   # same variant; notes kept'],
    teardown: ['sudo bash ' + DIR + 'L01/teardown.sh   # removes /opt/beacon-l01 only', '# the VM itself: profiles/linux-arm64/vm-delete.sh (asks first)'],
    evidenceInstructions: ['`python3 ' + DIR + 'L01/validate.py --out ' + DIR + 'L01/evidence/latest.json --explanation-file ' + DIR + 'L01/evidence/L01-hypotheses.md`', 'Add `--assistance assisted` if you opened hints rung 3–4 or the solution.', 'Paste the JSON here. Sanitised excerpts only; the launcher and config contain no secrets.'],
    hints: [
      { level: 1, text: 'The application printed a FATAL line and exited on purpose; the fault is in what the process was given — where it started or what environment it saw — not in the VM or the network.' },
      { level: 2, text: 'Read the launcher script line by line: every line before `exec` is environment the process inherits. Compare the path in the error with `ls -l` of the real file; for a "required setting", find where that setting was supposed to come from.' },
      { level: 3, text: 'Path error: `cd / && ls config/beacon.yaml` versus `ls /opt/beacon-l01/config/beacon.yaml`. Missing setting: `grep -n BEACON_ /opt/beacon-l01/env` versus `grep -n env /opt/beacon-l01/run-beacon.sh`.' },
      { level: 4, text: 'Variant A: the launcher does `cd /` then uses a relative config path; start in /opt/beacon-l01 or pass an absolute --config. Variant B: the config wants PostgreSQL and the URL lives in ./env which is never sourced; `set -a; . /opt/beacon-l01/env; set +a` before exec — and since no database exists in the VM, switch the lab config back to sqlite and say so.' }
    ],
    solutionRef: 'SOLUTION.md', sourceIds: ['T12', 'T15'], status: 'validated',
    variant: { brief: 'After passing one variant, `sudo LOOPED_VARIANT=variant-b bash ' + DIR + 'L01/reset.sh` (or variant-a), write a fresh hypothesis log for the new symptom, validate with `--variant variant-b --assistance independent --out ' + DIR + 'L01/evidence/variant.json`, and import it.', command: 'sudo LOOPED_VARIANT=variant-b bash ' + DIR + 'L01/reset.sh' },
    limits: ['Proves VM operation, versioned notes and observation-to-fix reasoning on one launcher. Not systemd (L03), not production.', 'Executed during development on a Linux amd64 container with LOOPED_ALLOW_ANY_LINUX=1 (both variants, unsafe shortcut rejected); not on Apple Silicon or inside Lima.']
  });

  lab({
    id: 'L02', moduleId: 'M01', title: 'A config change on a branch: validate, merge, revert',
    objectiveIds: ['obj-m01-02', 'obj-m01-03'], executionMode: 'local', estimatedMinutes: 60, environmentProfile: 'linux-arm64', prerequisites: ['L01'],
    learnerBrief: 'A teammate finished ticket-142 on its own branch (a staging-lab environment and a 15-second request timeout for Beacon) while `main` moved on, and since yesterday the deploy health check against the lab Beacon fails although nobody touched its code. Validate the branch with the parser Beacon really uses, merge it keeping both sides\' intended changes, find the commit that changed behaviour and undo it without rewriting shared history, then prove Beacon answers the deploy check.\n\nRuns inside the course VM; the exercise repository is `/opt/beacon-l02/repo`, built with a fixed history by `inject.sh` in one of two variants.',
    checkpoints: [
      { id: 'c1', title: 'Read the history and validate the branch before merging', resumeInstructions: '`sudo bash ' + DIR + 'L02/setup.sh` rebuilds the exercise repository (fixed commit ids per variant). Your notes are in `' + DIR + 'L02/evidence/L02-notes.md`.' },
      { id: 'c2', title: 'Merge, resolve, revert, prove behaviour', resumeInstructions: 'Continue in `/opt/beacon-l02/repo`; if the merge went wrong, `sudo bash ' + DIR + 'L02/reset.sh` rebuilds the repository for the same variant (work in the exercise repo is discarded, notes kept).' }
    ],
    assetPaths: ['README.md', 'setup.sh', 'inject.sh', 'validate.py', 'reset.sh', 'teardown.sh', 'assets/repo-baseline/config/beacon.yaml', 'assets/repo-baseline/deploy/service.json', 'assets/repo-baseline/README.md', 'assets/notes-template.md', 'SOLUTION.md', 'VARIANT.md', 'hints.md', 'evidence-example.json'],
    setup: ['# inside the VM, at the repository root', 'sudo bash ' + DIR + 'L02/setup.sh', 'cd /opt/beacon-l02/repo && git log --oneline --graph --all'],
    faultInjection: ['# setup.sh builds variant-a; to choose explicitly (rebuilds the repository):', 'sudo LOOPED_VARIANT=variant-b bash ' + DIR + 'L02/inject.sh'],
    tasks: ['Read `git log --oneline --graph --all`, `git show ticket-142` and `git diff main...ticket-142`; write down what each side intended before merging.', 'Validate the ticket\'s config as committed: `git show ticket-142:config/beacon.yaml > /tmp/t142.yaml && PYTHONPATH=' + DIR + 'beacon python3 -m beacon validate-config --config /tmp/t142.yaml`, and the JSON with `python3 -m json.tool`.', '`git merge ticket-142` on main; resolve each conflicting line by keeping both intended changes; re-validate both files before committing.', 'Find the commit that changed behaviour with `git log -p main -- config/` (the message is a claim, the diff is evidence) and undo it with `git revert <id>`.', 'Start Beacon from the committed config and request the health path and port that `deploy/service.json` expects; check `/version`.', 'Run validate.py and import the evidence JSON.'],
    validation: [
      { id: 'repo-state', description: 'on main, no merge in progress, no unmerged paths, nothing uncommitted', critical: true },
      { id: 'branch-merged', description: 'the original ticket-142 commit is an ancestor of main', critical: true },
      { id: 'history-kept', description: 'baseline, main\'s intended change and the behaviour-changing commit are all still in history', critical: true },
      { id: 'no-conflict-markers', description: 'no conflict markers in any tracked file at HEAD', critical: true },
      { id: 'config-valid', description: 'Beacon\'s own parser and validator accept the YAML; json accepts service.json', critical: true },
      { id: 'both-changes', description: 'main\'s change and the ticket\'s change are both present at HEAD', critical: true },
      { id: 'ports-agree', description: 'server.port equals the deploy file\'s listen_port', critical: true },
      { id: 'reverted', description: 'a revert commit names the behaviour-changing commit and its effect is gone', critical: true },
      { id: 'focused-diff', description: 'net change since the last good main commit touches only the two config files', critical: true },
      { id: 'behaviour', description: 'Beacon started from HEAD\'s config answers the deploy health check with the expected version', critical: true },
      { id: 'notes', description: 'notes filled in, including the revert (advisory)', critical: false }
    ],
    reset: ['sudo bash ' + DIR + 'L02/reset.sh   # rebuilds the exercise repository, same variant; notes kept'],
    teardown: ['sudo bash ' + DIR + 'L02/teardown.sh   # removes /opt/beacon-l02 only'],
    evidenceInstructions: ['`python3 ' + DIR + 'L02/validate.py --out ' + DIR + 'L02/evidence/latest.json --explanation-file ' + DIR + 'L02/evidence/L02-notes.md`', 'Add `--assistance assisted` if you opened hints rung 3–4 or the solution.', 'The report records commit ids, the parsed values it compared and the HTTP status Beacon returned; no secrets are involved.'],
    hints: [
      { level: 1, text: 'Nothing is wrong with Beacon\'s code. What each branch intended, what each commit actually changed, and whether the files at HEAD are acceptable to the programs that read them are all in the repository history.' },
      { level: 2, text: 'Validate with the consumer\'s parser at a specific commit (`git show <rev>:config/beacon.yaml > /tmp/x.yaml`, then `python3 -m beacon validate-config`). For behaviour, read diffs not messages: `git log -p main -- config/`.' },
      { level: 3, text: 'During the merge, `git diff` shows both sides of each hunk; compare them with `git show main:deploy/service.json` and the ticket text. For the failing health check, start Beacon from HEAD\'s config, request the deploy file\'s health path, and find which commit introduced the setting that makes it fail.' },
      { level: 4, text: 'Variant A: the ticket\'s `request_timeout_s` has three-space indentation, and the conflict is the version bump (main) next to the environment (ticket) — keep both, fix the indent. Variant B: main moved the port to 8081 together with service.json and the ticket raised the timeout on the adjacent line — keep 8081 and 15. Both: the maintenance commit set `inject.ready_fail: true`; `git revert` it, never `reset`.' }
    ],
    solutionRef: 'SOLUTION.md', sourceIds: ['T12'], status: 'validated',
    variant: { brief: 'After passing one variant, `sudo LOOPED_VARIANT=variant-b bash ' + DIR + 'L02/reset.sh` (or variant-a), solve the rebuilt repository without hints, rewrite your notes for the new commit ids and conflict, validate with `--variant variant-b --assistance independent --out ' + DIR + 'L02/evidence/variant.json`, and import it.', command: 'sudo LOOPED_VARIANT=variant-b bash ' + DIR + 'L02/reset.sh' },
    limits: ['Proves one focused config change, one two-sided conflict and one revert, judged against real git state and Beacon\'s own parser. Not rebases of shared work, signed commits, branch protection or CI (M10). Beacon\'s YAML reader is a documented subset, not full YAML.', 'Executed during development in a Linux amd64 container with LOOPED_ALLOW_ANY_LINUX=1 as root: setup → validate FAIL → resolve/revert → validate PASS for both variants, a whole-file --theirs plus reset --hard shortcut rejected, reset re-breaks, teardown clean. Not run on Apple Silicon or inside Lima.']
  });

  lab({
    id: 'L03', moduleId: 'M02', title: 'Beacon under systemd: unit, user, journal, socket',
    objectiveIds: ['obj-m02-01', 'obj-m02-02', 'obj-m02-03', 'obj-m02-05'], executionMode: 'local', estimatedMinutes: 100, environmentProfile: 'linux-arm64', prerequisites: ['L01'],
    learnerBrief: 'Run Beacon as a proper systemd service on the lab VM — as the `beacon` user, reading `/etc/beacon/beacon.yaml`, listening on 8080 — and explain every directive in the unit. The unit is broken by `inject.sh` with either a wrong ExecStart/working-directory combination or a config the service user cannot read. Diagnose from the journal, `systemctl show` and the socket table; fix narrowly; prove the user and the socket.',
    checkpoints: [
      { id: 'c1', title: 'Install, read the unit, reproduce', resumeInstructions: '`sudo bash ' + DIR + 'L03/setup.sh` is idempotent (reinstalls and re-injects). Your directive notes live in evidence/L03-diagnosis.md.' },
      { id: 'c2', title: 'Discriminate, fix narrowly, prove user and socket', resumeInstructions: '`sudo bash ' + DIR + 'L03/reset.sh` re-injects the same variant; the unit and config are the only state.' }
    ],
    assetPaths: ['README.md', 'setup.sh', 'inject.sh', 'validate.py', 'reset.sh', 'teardown.sh', 'assets/diagnosis-template.md', 'SOLUTION.md', 'VARIANT.md', 'hints.md', 'evidence-example.json', '../beacon/beacon.service'],
    setup: ['# inside the VM, at the repository root', 'sudo bash ' + DIR + 'L03/setup.sh', 'systemctl cat beacon'],
    faultInjection: ['sudo LOOPED_VARIANT=variant-b bash ' + DIR + 'L03/inject.sh   # or variant-a (default)'],
    tasks: ['Explain each directive of the unit in evidence/L03-diagnosis.md (template in assets/).', 'Reproduce: `sudo systemctl start beacon; systemctl status beacon --no-pager; journalctl -u beacon -n 20 --no-pager`. Quote the error.', 'Hypotheses and a discriminating check: `systemctl show beacon -p ExecStart -p WorkingDirectory -p User`, `namei -l /etc/beacon/beacon.yaml`, `sudo -u beacon cat /etc/beacon/beacon.yaml`.', 'Fix the smallest thing (a directive, or ownership/mode of exactly the file the service user needs); `daemon-reload` only if the unit changed; restart.', 'Prove: MainPID runs as beacon; `ss -ltnp` shows that PID on 0.0.0.0:8080; `curl -s 127.0.0.1:8080/healthz` → ok.', 'Run validate.py and import the evidence.'],
    validation: [
      { id: 'unit-active', description: 'systemctl is-active beacon == active', critical: true },
      { id: 'runs-as-beacon', description: 'MainPID\'s user is beacon, not root', critical: true },
      { id: 'socket-owned', description: '0.0.0.0:8080 is listened on by MainPID', critical: true },
      { id: 'user-path', description: '/healthz 200 and /version reports 1.4.0', critical: true },
      { id: 'config-not-open', description: 'the config file is not world-readable or world-writable', critical: true },
      { id: 'no-world-writable', description: 'nothing under /opt/beacon or /etc/beacon is world-writable', critical: true },
      { id: 'journal-clean', description: 'no FATAL in the recent journal (advisory)', critical: false },
      { id: 'diagnosis-notes', description: 'directives explained and the cause named (advisory)', critical: false }
    ],
    reset: ['sudo bash ' + DIR + 'L03/reset.sh'],
    teardown: ['sudo bash ' + DIR + 'L03/teardown.sh   # beacon.service, /etc/beacon, /var/lib/beacon only'],
    evidenceInstructions: ['`python3 ' + DIR + 'L03/validate.py --out ' + DIR + 'L03/evidence/latest.json --explanation-file ' + DIR + 'L03/evidence/L03-diagnosis.md`', 'The report records MainPID, user and the socket line; no secrets are involved.'],
    hints: [
      { level: 1, text: 'Result: exit-code with status=1 means the application ran and chose to exit. Ask what systemd gave it (user, directory, environment, command) and what the application saw.' },
      { level: 2, text: '`journalctl -u beacon` for the application\'s words; `systemctl show beacon -p User -p WorkingDirectory -p ExecStart` for what systemd gave it; `namei -l /etc/beacon/beacon.yaml` for who may read the file.' },
      { level: 3, text: '`sudo -u beacon python3 -c "open(\'/etc/beacon/beacon.yaml\')"` shows a permission problem; `sudo -u beacon sh -c \'cd $(systemctl show beacon -p WorkingDirectory --value) && python3 -c "import beacon"\'` shows a module-path problem.' },
      { level: 4, text: 'Module not found: WorkingDirectory= is /opt, not /opt/beacon; fix, daemon-reload, restart. Permission denied: the config is root:root 600; `chown root:beacon` + `chmod 640`, restart (no daemon-reload). Never chmod 777, never User=root.' }
    ],
    solutionRef: 'SOLUTION.md', sourceIds: ['T15'], status: 'execution-not-tested',
    variant: { brief: 'Re-inject the other variant with `sudo LOOPED_VARIANT=variant-b bash ' + DIR + 'L03/reset.sh`, diagnose without hints, write fresh notes, validate with `--variant variant-b --assistance independent --out ' + DIR + 'L03/evidence/variant.json`.', command: 'sudo LOOPED_VARIANT=variant-b bash ' + DIR + 'L03/reset.sh' },
    limits: ['One unit on one VM: proves reading a unit, a journal and a socket table, and a narrow permission/path fix. Not dependency ordering, not production.', 'Needs real systemd, which the development container lacked: scripts were parsed and the validator compiled, but the lab was not executed end to end.']
  });

  lab({
    id: 'L04', moduleId: 'M02', title: 'Host resource triage: CPU, memory, blocks and inodes',
    objectiveIds: ['obj-m02-04', 'obj-m02-02'], executionMode: 'local', estimatedMinutes: 100, environmentProfile: 'linux-arm64', prerequisites: ['L03'],
    learnerBrief: 'Beacon on the shared lab host has started failing or slowing its writes. Its database and pending jobs live on a small data volume and are live data; another team\'s reporter process runs on the same host. Measure CPU, memory, disk blocks and inodes, name the bottleneck with the metric that proves it, and restore the write path without deleting live data or killing anyone else\'s process.\n\nRuns inside the course VM. The data volume is a 24 MiB ext4 image with 1024 inodes, loop-mounted at `/opt/beacon-l04/mnt`; every fault is capped to that image or to a time-limited batch process.',
    checkpoints: [
      { id: 'c1', title: 'Reproduce and measure every candidate', resumeInstructions: '`sudo bash ' + DIR + 'L04/setup.sh` recreates the image, Beacon (127.0.0.1:8084), the reporter and the fault. Your measurements live in `' + DIR + 'L04/evidence/L04-triage.md`.' },
      { id: 'c2', title: 'Restore narrowly and prove it', resumeInstructions: '`sudo bash ' + DIR + 'L04/reset.sh` unmounts and recreates the image and re-injects the same variant; a VM reboot drops the mount, so run reset after one.' }
    ],
    assetPaths: ['README.md', 'setup.sh', 'inject.sh', 'validate.py', 'reset.sh', 'teardown.sh', 'assets/report-builder.py', 'assets/reporter.py', 'assets/triage-template.md', 'SOLUTION.md', 'VARIANT.md', 'hints.md', 'evidence-example.json'],
    setup: ['# inside the VM, at the repository root', 'sudo bash ' + DIR + 'L04/setup.sh', 'df -h /opt/beacon-l04/mnt; df -i /opt/beacon-l04/mnt'],
    faultInjection: ['# setup.sh injects variant-a; choose explicitly with a reset:', 'sudo LOOPED_VARIANT=variant-b bash ' + DIR + 'L04/reset.sh   # or variant-c'],
    tasks: ['Reproduce: POST a status record and a job to 127.0.0.1:8084 with curl and read the last lines of `/opt/beacon-l04/beacon.log`.', 'Record the baseline with commands: `uptime`, `ps -eo pid,ppid,user,%cpu,%mem,cmd --sort=-%cpu | head`, `free -m`, `/proc/pressure/*`, `df -h` and `df -i` on the lab mount.', 'Write two hypotheses and the one measurement that separates them.', 'Find what is consuming the exhausted resource (`du -xsh`, per-directory file counts, the process tree) and remove or stop only that; leave `data/`, `queue/`, Beacon and the reporter alone.', 'Prove both POSTs succeed, headroom is back and the reporter still has its PID; run validate.py with sudo.'],
    validation: [
      { id: 'lab-fs', description: 'the same capped image (same block and inode counts) is still mounted at the lab path', critical: true },
      { id: 'headroom', description: 'at least 20% of blocks and of inodes free on the lab filesystem', critical: true },
      { id: 'writes-restored', description: 'POST /status 201, POST /jobs 202, /ready 200', critical: true },
      { id: 'live-data-intact', description: 'every seeded record is readable and every seeded pending job file is unchanged', critical: true },
      { id: 'batch-stopped', description: 'no process of the CPU fixture is still running', critical: true },
      { id: 'bystanders-alive', description: 'the reporter kept its original PID and Beacon is running', critical: true },
      { id: 'bottleneck-evidence', description: 'the triage notes quote the measurement that identifies this fault', critical: true },
      { id: 'notes', description: 'triage notes filled in with hypotheses (advisory)', critical: false }
    ],
    reset: ['sudo bash ' + DIR + 'L04/reset.sh   # stop lab processes, unmount, recreate image, re-inject; notes kept'],
    teardown: ['sudo bash ' + DIR + 'L04/teardown.sh   # stops only lab PIDs, unmounts the image, removes /opt/beacon-l04'],
    evidenceInstructions: ['`sudo python3 ' + DIR + 'L04/validate.py --out ' + DIR + 'L04/evidence/latest.json --explanation-file ' + DIR + 'L04/evidence/L04-triage.md`', 'The report records filesystem geometry, free blocks/inodes, HTTP statuses and PIDs; no secrets are involved.'],
    hints: [
      { level: 1, text: 'Beacon\'s process is alive and /healthz answers, so the application is not crashing. Ask which shared resource its write path needs: CPU time, memory, disk blocks or inodes on the volume that holds its database and queue.' },
      { level: 2, text: 'The Beacon log line under the failing request carries the kernel\'s error. Then measure every candidate, not just the first one you think of: uptime, ps sorted by CPU, free -m, and both df -h and df -i on /opt/beacon-l04/mnt.' },
      { level: 3, text: 'If df -h and df -i disagree, the one at 100% is the answer; `du -xsh /opt/beacon-l04/mnt/*` (bytes) or `find … -type f | cut -d/ -f5,6 | sort | uniq -c` (file counts) shows where. If the disks are fine, `ps -eo pid,ppid,%cpu,cmd --sort=-%cpu | head` shows who burns CPU and their parent.' },
      { level: 4, text: 'Blocks: old rotated logs/beacon-debug.log.* — delete those only. Inodes: ~990 stale files in tmp/sessions — `find …/tmp/sessions -type f -mtime +1 -delete`. CPU: the report-builder.py --rebuild-all job — kill its parent PID. Never touch data/, queue/, Beacon or the reporter.' }
    ],
    solutionRef: 'SOLUTION.md', sourceIds: ['T15'], status: 'validated',
    variant: { brief: 'Three variants share a similar API symptom. After passing one, `sudo LOOPED_VARIANT=variant-b bash ' + DIR + 'L04/reset.sh` (or variant-c), start a fresh triage note from the template, diagnose without hints and validate with `--variant variant-b --assistance independent --out ' + DIR + 'L04/evidence/variant.json`.', command: 'sudo LOOPED_VARIANT=variant-b bash ' + DIR + 'L04/reset.sh' },
    limits: ['Proves separating full blocks, exhausted inodes and CPU saturation with the right metric, and a narrow restore on a capped 24 MiB lab filesystem. Memory pressure is recorded as baseline, not injected; no OOM, I/O-latency or capacity planning; Beacon runs as a plain process, not a systemd unit.', 'Executed during development in a Linux amd64 container with LOOPED_ALLOW_ANY_LINUX=1 as root: setup → validate FAIL → fix → validate PASS for all three variants, unsafe shortcuts (deleting all small files; pkill of every python3 process) rejected, reset re-breaks, teardown left no mount, loop device or process. Not run on Apple Silicon or inside Lima.']
  });

  lab({
    id: 'L05', moduleId: 'M03', title: 'DNS from delegation to cache, and the route underneath',
    objectiveIds: ['obj-m03-01', 'obj-m03-02', 'obj-m03-03'], executionMode: 'local', estimatedMinutes: 120, environmentProfile: 'linux-arm64', prerequisites: ['L03'],
    learnerBrief: 'From the client network, `http://api.beacon.corp.lab:8080/healthz` does not work. The Beacon team says their DNS is fine; the network team says nothing changed. Narrow the failure layer by layer (resolve, route, connect, answer), prove what the parent and child authoritative servers say versus what the caching resolver returns, fix the narrowest thing and explain any disagreement.\n\nRuns inside the course VM in three network namespaces (`looped-l05-client`, `-rtr`, `-srv`) with a small standard-library DNS fixture: parent zone corp.lab, child zone beacon.corp.lab, a caching resolver and Beacon.',
    checkpoints: [
      { id: 'c1', title: 'Narrow by layer and compare authoritative with recursive answers', resumeInstructions: '`sudo bash ' + DIR + 'L05/reset.sh` restores zones, routes and caches for the same variant; if the namespaces are gone (VM reboot), run teardown.sh then setup.sh. Notes: `' + DIR + 'L05/evidence/L05-notes.md`.' },
      { id: 'c2', title: 'Fix the narrowest thing and prove the user path', resumeInstructions: 'Zone files are in /opt/beacon-l05/zones (reload with `kill -HUP` on the server\'s PID file); the resolver cache is `labdns.py cachectl dump|flush`; reset.sh restores everything for another attempt.' }
    ],
    assetPaths: ['README.md', 'setup.sh', 'inject.sh', 'validate.py', 'reset.sh', 'teardown.sh', 'assets/labdns.py', 'assets/zones/corp.lab.zone', 'assets/zones/beacon.corp.lab.zone', 'assets/notes-template.md', 'SOLUTION.md', 'VARIANT.md', 'hints.md', 'evidence-example.json'],
    setup: ['# inside the VM, at the repository root (needs iproute2; dig from bind9-dnsutils is optional)', 'sudo bash ' + DIR + 'L05/setup.sh', 'sudo ip netns exec looped-l05-client curl -sS --noproxy \'*\' --max-time 5 http://api.beacon.corp.lab:8080/healthz'],
    faultInjection: ['# setup.sh injects variant-a; choose explicitly:', 'sudo LOOPED_VARIANT=variant-b bash ' + DIR + 'L05/reset.sh   # or variant-c'],
    tasks: ['Reproduce from the client namespace and note whether the error is resolution or connection.', 'Ask the resolver (`dig api.beacon.corp.lab`), the parent (`dig @10.55.2.53 +norec …`) and the child (`dig @10.55.2.54 +norec …`); compare status, the aa flag, AUTHORITY and TTLs.', 'Read the client routing table and `ip route get 10.55.2.80`.', 'Fix only what the evidence names: a zone file (bump the serial, HUP the server), one resolver cache entry, or one route.', 'Prove the user path through the resolver from the client namespace; paste the evidence into your notes and run validate.py with sudo.'],
    validation: [
      { id: 'topology', description: 'the three looped-l05-* namespaces exist and every fixture is running', critical: true },
      { id: 'authoritative-data', description: 'the child server answers api.beacon.corp.lab authoritatively (aa) with 10.55.2.80', critical: true },
      { id: 'delegation', description: 'the parent refers beacon.corp.lab to ns1.beacon.corp.lab with glue 10.55.2.54', critical: true },
      { id: 'recursive-result', description: 'the resolver returns NOERROR 10.55.2.80', critical: true },
      { id: 'route', description: 'the client reaches 10.55.2.80 via 10.55.1.1 and has no route through an absent gateway', critical: true },
      { id: 'user-path', description: 'the client gets ok from http://api.beacon.corp.lab:8080/healthz through resolv.conf', critical: true },
      { id: 'no-bypass', description: 'resolv.conf still points at the resolver and no hosts-file entry exists for the name', critical: true },
      { id: 'resolver-kept', description: 'the resolver was not restarted to clear its cache (advisory)', critical: false },
      { id: 'evidence-quoted', description: 'notes quote the failing evidence and the authoritative answer with its aa flag', critical: true }
    ],
    reset: ['sudo bash ' + DIR + 'L05/reset.sh   # zones, routes, resolver cache for the same variant; notes kept'],
    teardown: ['sudo bash ' + DIR + 'L05/teardown.sh   # deletes only looped-l05-* namespaces, /etc/netns/looped-l05-client and /opt/beacon-l05'],
    evidenceInstructions: ['`sudo python3 ' + DIR + 'L05/validate.py --out ' + DIR + 'L05/evidence/latest.json --explanation-file ' + DIR + 'L05/evidence/L05-notes.md`', 'The report records DNS answers, flags and routes from inside the namespaces; no secrets are involved.'],
    hints: [
      { level: 1, text: 'Split the request into resolve → route → connect → answer and find the first step that fails from the client namespace. The exact curl error already says whether the name resolved.' },
      { level: 2, text: 'Compare three views of one name: the resolver\'s (`dig name`), the parent\'s (`dig @10.55.2.53 +norec name`) and the child\'s (`dig @10.55.2.54 +norec name`). Read status, the aa flag, AUTHORITY and TTLs. If the name resolves, read the client\'s routing table instead.' },
      { level: 3, text: 'Child has the record with aa but the parent says NXDOMAIN with aa: the problem is in the parent. Both servers right, only the resolver disagrees: `labdns.py cachectl dump` and watch the SOA TTL count down. DNS agrees everywhere: `ip -n looped-l05-client route get 10.55.2.80`.' },
      { level: 4, text: 'A: the parent zone lost `beacon NS ns1.beacon.corp.lab.` and its glue — add them, bump the serial, HUP the parent, flush the name. B: a negative answer cached for 3600 s before the record was published — `cachectl flush api.beacon.corp.lab`. C: a stale `10.55.2.64/27 via 10.55.1.254` route — delete it.' }
    ],
    solutionRef: 'SOLUTION.md', sourceIds: ['T23'], status: 'validated',
    variant: { brief: 'Three variants: two DNS faults with the same client error and one that is not DNS at all. After passing one, `sudo LOOPED_VARIANT=variant-b bash ' + DIR + 'L05/reset.sh` (or variant-c), write your layer hypothesis before the second command, and validate with `--variant variant-b --assistance independent --out ' + DIR + 'L05/evidence/variant.json`.', command: 'sudo LOOPED_VARIANT=variant-b bash ' + DIR + 'L05/reset.sh' },
    limits: ['Proves separating resolution from routing, reading authoritative versus cached answers, negative caching, and narrow repair of a delegation, a cache entry or a route — with a teaching DNS fixture (UDP only, no EDNS/DNSSEC/TCP fallback) in network namespaces on one VM. No firewalls, anycast, split horizon or cloud private zones.', 'Executed during development in a Linux amd64 container with LOOPED_ALLOW_ANY_LINUX=1 as root (iproute2 and dnsutils installed): setup → validate FAIL → fix → validate PASS for all three variants, a hosts-file bypass rejected, reset re-breaks, teardown removed namespaces, /etc/netns entry and processes. Not run on Apple Silicon or inside Lima.']
  });

  lab({
    id: 'L06', moduleId: 'M03', title: 'A TLS reverse proxy in front of Beacon',
    objectiveIds: ['obj-m03-05', 'obj-m03-04'], executionMode: 'local', estimatedMinutes: 100, environmentProfile: 'linux-arm64', prerequisites: ['L05'],
    learnerBrief: 'Beacon is published to internal clients as `https://beacon.corp.lab:8446` through a small TLS-terminating reverse proxy, and clients trust only the lab CA. Since the proxy change, clients cannot use the service. Reproduce with verification on, read the handshake (subject, SAN, issuer, verify result), the proxy configuration, the Host header and the backend port, and fix the fault properly — never by disabling verification or adding trust.\n\nRuns inside the course VM on loopback: a lab CA and a legacy CA generated with openssl, Beacon on 127.0.0.1:8086 and a standard-library Python proxy on 127.0.0.1:8446.',
    checkpoints: [
      { id: 'c1', title: 'Reproduce with verification on and read the handshake', resumeInstructions: '`sudo bash ' + DIR + 'L06/reset.sh` re-issues the variant\'s certificates and restarts the proxy; notes live in `' + DIR + 'L06/evidence/L06-notes.md`.' },
      { id: 'c2', title: 'Fix the certificate or the upstream properly and prove the path', resumeInstructions: 'Edit /opt/beacon-l06/proxy.json or issue a certificate from /opt/beacon-l06/ca, then `sudo bash ' + DIR + 'L06/restart-proxy.sh`; reset.sh rebuilds the whole lab if the CA file was modified.' }
    ],
    assetPaths: ['README.md', 'setup.sh', 'inject.sh', 'restart-proxy.sh', 'validate.py', 'reset.sh', 'teardown.sh', 'assets/tlsproxy.py', 'assets/leaf.ext.example', 'assets/notes-template.md', 'SOLUTION.md', 'VARIANT.md', 'hints.md', 'evidence-example.json'],
    setup: ['# inside the VM, at the repository root', 'sudo bash ' + DIR + 'L06/setup.sh', 'curl -sS --noproxy \'*\' --cacert /opt/beacon-l06/ca/ca.pem --resolve beacon.corp.lab:8446:127.0.0.1 https://beacon.corp.lab:8446/healthz'],
    faultInjection: ['# setup.sh injects variant-a; choose explicitly:', 'sudo LOOPED_VARIANT=variant-b bash ' + DIR + 'L06/reset.sh   # or variant-c'],
    tasks: ['Reproduce as a client that trusts only the lab CA (curl --cacert … --resolve …) and classify the error: TCP, verification, or an HTTP status from the proxy.', 'Read the handshake with `openssl s_client -connect 127.0.0.1:8446 -servername beacon.corp.lab -CAfile /opt/beacon-l06/ca/ca.pem` and the certificate files with `openssl x509 -noout -subject -issuer -ext subjectAltName -dates`.', 'Read proxy.json, `ss -ltnp` for the backend port and the proxy access log (Host, status, upstream status).', 'Fix only what the evidence names: the configured certificate, a new certificate from the lab CA with the right SAN, or the upstream port; restart the proxy.', 'Prove the verified path (/healthz and /version) and run validate.py with sudo.'],
    validation: [
      { id: 'backend-healthy', description: 'Beacon answers on 127.0.0.1:8086 without the proxy', critical: true },
      { id: 'trust-anchor', description: 'the lab CA file is unchanged (one certificate, same fingerprint as at setup)', critical: true },
      { id: 'verified-handshake', description: 'TLS with SNI beacon.corp.lab verifies against the lab CA only, hostname checked', critical: true },
      { id: 'leaf-sane', description: 'served certificate: SAN names beacon.corp.lab, not a CA, issued by the lab CA, valid and at most 398 days', critical: true },
      { id: 'user-path', description: 'verified GET /healthz and /version through the proxy return 200 ok and 1.4.0', critical: true },
      { id: 'backend-port', description: 'the proxy upstream is Beacon\'s listening port and the access log shows Host and upstream 200', critical: true },
      { id: 'no-verification-bypass', description: 'system trust store untouched; no -k/--insecure/verify=False/CERT_NONE in the notes', critical: true },
      { id: 'notes', description: 'notes quote the handshake or proxy evidence (advisory)', critical: false }
    ],
    reset: ['sudo bash ' + DIR + 'L06/reset.sh   # same variant; rebuilds the CAs too if the CA file was modified'],
    teardown: ['sudo bash ' + DIR + 'L06/teardown.sh   # stops the lab proxy and Beacon, removes /opt/beacon-l06 (system trust store never touched)'],
    evidenceInstructions: ['`sudo python3 ' + DIR + 'L06/validate.py --out ' + DIR + 'L06/evidence/latest.json --explanation-file ' + DIR + 'L06/evidence/L06-notes.md`', 'The report records certificate subjects, SANs, issuers and HTTP statuses; private keys never leave /opt/beacon-l06.'],
    hints: [
      { level: 1, text: 'Read the client error carefully: a TCP problem, a certificate verification problem, or an HTTP status from the proxy each point at a different hop — handshake versus proxy-to-backend.' },
      { level: 2, text: 'Handshake: `openssl s_client -connect 127.0.0.1:8446 -servername beacon.corp.lab -CAfile /opt/beacon-l06/ca/ca.pem </dev/null` (subject, issuer, Verify return code) and `openssl x509 -noout -issuer -ext subjectAltName` on the certificate files. Proxy: proxy.json, the access log and `ss -ltnp`.' },
      { level: 3, text: 'Compare the served certificate\'s issuer with the lab CA\'s subject, and its SAN with the name the client uses. If the handshake verifies, compare the proxy\'s upstream port with the port Beacon actually listens on.' },
      { level: 4, text: 'A: the proxy serves beacon-2025 from the legacy CA — point it at beacon-2026. B: the SAN says beacon.corp.local — issue a new certificate from the lab CA with DNS:beacon.corp.lab. C: upstream is port 8087, Beacon is on 8086. Restart the proxy after each change; never -k, never extra trust.' }
    ],
    solutionRef: 'SOLUTION.md', sourceIds: ['T23', 'T11'], status: 'validated',
    variant: { brief: 'Three variants: issuer, name, and a backend fault behind a valid handshake. After passing one, `sudo LOOPED_VARIANT=variant-b bash ' + DIR + 'L06/reset.sh` (or variant-c), predict the failing layer from the client error alone, then diagnose without hints and validate with `--variant variant-b --assistance independent --out ' + DIR + 'L06/evidence/variant.json`.', command: 'sudo LOOPED_VARIANT=variant-b bash ' + DIR + 'L06/reset.sh' },
    limits: ['Proves reading a TLS handshake, fixing an issuer or SAN mismatch or a wrong upstream port properly, and showing the request reached the right backend — one proxy, one root-only chain, loopback only. Not mTLS, intermediate chains, rotation automation, HTTP/2 or load-balancer health checks; the proxy is a teaching fixture, not nginx/Envoy.', 'Executed during development in a Linux amd64 container (OpenSSL 3.0.13, Python 3.13) with LOOPED_ALLOW_ANY_LINUX=1 as root: setup → validate FAIL → fix → validate PASS for all three variants, unsafe shortcuts (legacy CA appended to the trust file; curl -k in the notes) rejected, reset re-breaks, teardown clean. Not run on Apple Silicon or inside Lima.']
  });

  lab({
    id: 'L07', moduleId: 'M04', title: 'A log summariser you can trust: CLI, exit codes, tests that catch bugs',
    objectiveIds: ['obj-m04-01', 'obj-m04-02', 'obj-m04-03', 'obj-m04-06'], executionMode: 'local', estimatedMinutes: 150, environmentProfile: 'linux-arm64', prerequisites: ['L01'],
    learnerBrief: 'During incidents people paste Beacon\'s JSON logs into ad-hoc one-liners and argue about the numbers. Write `logsummary`: a small CLI that summarises a JSON-lines log by service and status, lists the top error messages, fails loudly and usefully on bad input, prints the same bytes every time, and returns exit codes a script can use — with unit tests good enough to catch the bugs people usually introduce.\n\nThe contract is fixed in the starter; the validator runs your tests against your code, a reference and seven deliberately broken copies, then compares your CLI with the reference on generated edge cases.',
    checkpoints: [
      { id: 'c1', title: 'Functions over collections', resumeInstructions: 'Your code is in `' + DIR + 'L07/work/` (commit it). `bash ' + DIR + 'L07/setup.sh` never overwrites it.' },
      { id: 'c2', title: 'Files, JSON and the CLI', resumeInstructions: 'Run your CLI on every file in `work/fixtures/`; `python3 -m unittest discover -s . -p \'test_*.py\'` in work/.' },
      { id: 'c3', title: 'Tests you can trust', resumeInstructions: 'Run validate.py to see which broken variants your suite still misses; broken/mutants.json names them.' },
      { id: 'c4', title: 'Exceptions, stderr and exit codes', resumeInstructions: 'Your failure-class decisions go in `' + DIR + 'L07/evidence/L07-notes.md`; reset.sh only regenerates data/.' },
      { id: 'c5', title: 'Complexity, memory and the incident', resumeInstructions: 'Run your tool on `work/data/incident-<variant>.jsonl`; `bash ' + DIR + 'L07/reset.sh` regenerates it if deleted.' }
    ],
    assetPaths: ['README.md', 'setup.sh', 'inject.sh', 'validate.py', 'reset.sh', 'teardown.sh', 'starter/logsummary.py', 'starter/test_logsummary.py', 'fixtures/sample.jsonl', 'fixtures/empty.jsonl', 'fixtures/malformed.jsonl', 'fixtures/missing-key.jsonl', 'fixtures/tz-offsets.jsonl', 'fixtures/ties.jsonl', 'assets/gen_logs.py', 'assets/notes-template.md', 'broken/mutants.json', 'solution/logsummary.py', 'solution/test_logsummary.py', 'SOLUTION.md', 'VARIANT.md', 'hints.md', 'evidence-example.json'],
    setup: ['# inside the VM (any Linux with Python 3.9+), at the repository root; no root needed', 'bash ' + DIR + 'L07/setup.sh', 'cd ' + DIR + 'L07/work && python3 -m unittest discover -s . -p \'test_*.py\''],
    faultInjection: ['# the variant decides the incident log in work/data/:', 'LOOPED_VARIANT=variant-b bash ' + DIR + 'L07/inject.sh'],
    tasks: ['Implement parse_ts and summarize against the contract in the starter docstring (UTC window, per-service/status counters, ranked errors).', 'Implement read_records as a streaming generator, render, and the CLI arguments.', 'Write tests for every edge case — empty file, malformed row, missing key, non-integer status, naive and offset timestamps, ties, exit codes, stdout versus stderr, determinism — through the public contract.', 'Decide raise/report/skip for each failure class; make main return 0/1/2 with errors only on stderr and no tracebacks for bad input.', 'Run the tool on the variant\'s incident log; explain the O(n) scan and what memory grows with in your notes; run validate.py.'],
    validation: [
      { id: 'tests-pass', description: 'your unittest suite passes on your code (at least 8 tests)', critical: true },
      { id: 'tests-are-fair', description: 'your suite also passes on the reference implementation', critical: true },
      { id: 'tests-catch-bugs', description: 'your suite fails on every deliberately broken variant', critical: true },
      { id: 'edge-cases', description: 'your CLI matches the reference on generated edge-case files (exit code, --json, stderr file:line, empty stdout on bad input)', critical: true },
      { id: 'incident', description: 'your result for the variant\'s incident log matches the reference', critical: true },
      { id: 'deterministic', description: 'byte-identical text and --json output across hash seeds', critical: true },
      { id: 'bounded-memory', description: 'peak memory does not grow with a 10x larger file (advisory)', critical: false },
      { id: 'notes', description: 'notes explain O(n) and memory (advisory)', critical: false }
    ],
    reset: ['bash ' + DIR + 'L07/reset.sh   # regenerates data/ only; your code and tests untouched'],
    teardown: ['bash ' + DIR + 'L07/teardown.sh   # removes generated data; keeps your code'],
    evidenceInstructions: ['`python3 ' + DIR + 'L07/validate.py --out ' + DIR + 'L07/evidence/latest.json --explanation-file ' + DIR + 'L07/evidence/L07-notes.md`', 'Add `--assistance assisted` if you read solution/ or hints rung 3–4. The report records test counts, which broken variants your tests caught and the memory measurement.'],
    hints: [
      { level: 1, text: 'Separate three jobs: reading rows (and refusing bad ones), counting, and printing/choosing an exit code. Most bugs live in the first and the last.' },
      { level: 2, text: 'The contract docstring in starter/logsummary.py and the files in fixtures/ are your evidence. Run the CLI on each fixture and look at stdout, stderr and `$?` separately.' },
      { level: 3, text: 'If validate.py reports a broken variant your tests did not catch, read its id in broken/mutants.json and write the one test that would fail on it — a tie between two messages, an offset timestamp whose UTC hour differs, an empty file.' },
      { level: 4, text: 'Stream with `for line in fh`; raise MalformedInput("path:line: …") for bad JSON, non-objects, missing keys, string statuses and naive timestamps; convert with .astimezone(timezone.utc); sort ties by message; return 0/1/2 from main and write errors only to stderr. The reference is in solution/.' }
    ],
    solutionRef: 'SOLUTION.md', sourceIds: ['T11'], status: 'validated',
    variant: { brief: 'The independent variant changes the data, not the contract: `LOOPED_VARIANT=variant-b bash ' + DIR + 'L07/reset.sh` (or variant-a), run your tool on the new incident log, explain the result and which test proves it, and validate with `--variant variant-b --assistance independent --out ' + DIR + 'L07/evidence/variant.json`.', command: 'LOOPED_VARIANT=variant-b bash ' + DIR + 'L07/reset.sh' },
    limits: ['Proves a small tool correct on the documented edge cases, honest about failure, and tested well enough to catch seven common bugs; the memory check is a coarse peak-RSS comparison. Not packaging, performance tuning, concurrency or unbounded message cardinality.', 'Executed during development in a Linux amd64 container (Python 3.13) with LOOPED_ALLOW_ANY_LINUX=1: setup → validate FAIL on the starter → reference code and tests → validate PASS for both variants; reference code without real tests and a readlines() version were rejected; reset and teardown touched only generated data. Not run on Apple Silicon or inside Lima.']
  });

  lab({
    id: 'L08', moduleId: 'M04', title: 'A health/inventory client that cannot hang, loop, double-post or leak',
    objectiveIds: ['obj-m04-05', 'obj-m04-03'], executionMode: 'local', estimatedMinutes: 150, environmentProfile: 'linux-arm64', prerequisites: ['L07'],
    learnerBrief: 'The last script someone wrote for the lab inventory API hung when the API stalled, hammered it during rate limiting, ran a refresh twice after a 503 and once printed the bearer token into a ticket. Write `invclient.py` so none of that can happen — finite timeouts, bounded retries that honour Retry-After, pagination with loop detection, an explicit policy for the non-idempotent POST, and no secret in any log — and prove it with unit tests that need no network and against a local fixture that misbehaves on purpose.\n\nThe contract (client class, injected transport and sleep, CLI exit codes) is fixed in the starter.',
    checkpoints: [
      { id: 'c1', title: 'Transport, timeouts and the first tests', resumeInstructions: 'Your code is in `' + DIR + 'L08/work/` (commit it, never .secrets/). `bash ' + DIR + 'L08/setup.sh` never overwrites it and restarts the fixture.' },
      { id: 'c2', title: 'Retries, pagination and the POST policy', resumeInstructions: 'Unit tests run offline: `python3 -m unittest discover -s . -p \'test_*.py\'` in work/; broken/mutants.json names the bugs your suite must catch.' },
      { id: 'c3', title: 'The CLI against the integration fixture', resumeInstructions: '`bash ' + DIR + 'L08/reset.sh` restarts the fixture on 127.0.0.1:8098 with fresh counters; `/_fixture/stats` shows what your client did.' }
    ],
    assetPaths: ['README.md', 'setup.sh', 'inject.sh', 'validate.py', 'reset.sh', 'teardown.sh', 'starter/invclient.py', 'starter/test_invclient.py', 'assets/inventory_server.py', 'assets/notes-template.md', 'broken/mutants.json', 'solution/invclient.py', 'solution/test_invclient.py', 'SOLUTION.md', 'VARIANT.md', 'hints.md', 'evidence-example.json'],
    setup: ['# inside the VM (any Linux with Python 3.9+), at the repository root; no root needed', 'bash ' + DIR + 'L08/setup.sh', 'cd ' + DIR + 'L08/work && python3 invclient.py --token-file .secrets/l08-token list --out out/inventory.json; echo $?'],
    faultInjection: ['# the fixture starts in faults mode; another variant moves every fault:', 'LOOPED_VARIANT=variant-b bash ' + DIR + 'L08/reset.sh', 'curl -s --noproxy \'*\' -X POST -d \'{"mode": "loop"}\' http://127.0.0.1:8098/_fixture/scenario'],
    tasks: ['Implement http_transport with urllib (finite timeout; TimeoutError/ConnectionError; HTTP statuses returned).', 'Implement request with bounded retries for GET on timeouts, connection errors, 429, 502–504 and invalid JSON, waiting Retry-After or exponential backoff; test each rule with the fake transport and a recorded sleep.', 'Implement list_inventory with repeated-token detection and refresh that retries only with one Idempotency-Key.', 'Make sure the token appears in no log line, exception or repr — and test it.', 'Run the CLI against the fixture in faults and loop modes and both refresh forms; read /_fixture/stats; write your policy in the notes and run validate.py.'],
    validation: [
      { id: 'unit-tests-pass', description: 'your suite passes on your client (at least 8 tests)', critical: true },
      { id: 'tests-are-fair', description: 'your suite passes on the reference client', critical: true },
      { id: 'tests-catch-bugs', description: 'your suite fails on every broken client', critical: true },
      { id: 'integration-list', description: 'faults mode: list exits 0 with every item exactly once', critical: true },
      { id: 'retry-after', description: 'each 429 is followed by a wait of at least Retry-After', critical: true },
      { id: 'bounded-time', description: 'the stalled page is abandoned and retried well before the stall ends; request count bounded', critical: true },
      { id: 'pagination-loop', description: 'loop mode: list exits 3 within a bounded number of requests', critical: true },
      { id: 'post-policy', description: 'refresh without a key: one attempt, exit 3; with a key: retried with the same key, one side effect', critical: true },
      { id: 'no-secret-leak', description: 'the token appears in no output, log, result or workspace file', critical: true },
      { id: 'notes', description: 'notes explain idempotency and Retry-After (advisory)', critical: false }
    ],
    reset: ['bash ' + DIR + 'L08/reset.sh   # restart the fixture with fresh counters; clear out/'],
    teardown: ['bash ' + DIR + 'L08/teardown.sh   # stop the fixture, remove the lab token and outputs; keep your code'],
    evidenceInstructions: ['`python3 ' + DIR + 'L08/validate.py --out ' + DIR + 'L08/evidence/latest.json --explanation-file ' + DIR + 'L08/evidence/L08-notes.md`', 'The report records what the fixture saw (pages, attempts, timings, POST counts) and never the token; the validator checks that itself.'],
    hints: [
      { level: 1, text: 'Separate one HTTP exchange (may time out, may return any status) from the policy around it (retry or not, how long to wait, when to stop paging). Tests drive the policy through a fake transport and a fake sleep — no network, no waiting.' },
      { level: 2, text: 'The fixture\'s /_fixture/stats shows what your client really did: page, attempt, status and time of every request. Compare it with what your policy says should have happened.' },
      { level: 3, text: 'Check the gap after the 429 event (at least Retry-After?), the gap after the stalled request (about your timeout, not 8 s?), the number of POSTs and refreshes, and whether loop mode ends. For tests, broken/mutants.json names each bug your suite must catch.' },
      { level: 4, text: 'Retry only GET (or POST with an Idempotency-Key, the same key each time) on timeout, connection error, 429, 502–504 or invalid JSON; wait Retry-After else backoff_s * 2**attempt; at most 1 + max_retries attempts; a set of seen page tokens; the token only in the Authorization header. Reference: solution/invclient.py.' }
    ],
    solutionRef: 'SOLUTION.md', sourceIds: ['T11'], status: 'validated',
    variant: { brief: 'The other variant moves every fault (stalled page, double 503, Retry-After value, loop start, item count). `LOOPED_VARIANT=variant-b bash ' + DIR + 'L08/reset.sh`, predict from /_fixture/stats what your client should do at each event, and validate with `--variant variant-b --assistance independent --out ' + DIR + 'L08/evidence/variant.json`.', command: 'LOOPED_VARIANT=variant-b bash ' + DIR + 'L08/reset.sh' },
    limits: ['Proves bounded timeouts, retries and pagination, an explicit POST policy and a credential kept out of logs, against a deterministic local fixture and offline unit tests. Not concurrency, connection pooling, jittered backoff, OAuth flows or a real third-party API; TLS verification is L06.', 'Executed during development in a Linux amd64 container (Python 3.13) with LOOPED_ALLOW_ANY_LINUX=1: setup → validate FAIL on the starter → reference client and tests → validate PASS for both variants; a blind-retry client without loop detection and a client that printed the token were rejected; reset and teardown stopped the fixture and removed the token. Not run on Apple Silicon or inside Lima.']
  });
})();
