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
})();
