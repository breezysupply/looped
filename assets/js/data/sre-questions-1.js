/* SRE & Cloud Deployment Foundations — question banks for M01–M04.

   Each module: at least eight original bank items (q-mNN-bKK) plus at least
   four unseen gate variants (q-mNN-gKK) that are different questions, not
   reordered choices. Types: mcq, predict (output/log/config context),
   diagnose (context + choose the cause), order (steps in correct order),
   explain (rubric + model answer, self-reviewed). Selected-response items
   list the correct choice first; the gate shuffles positions. Every item
   has a rationale, misconception feedback, difficulty 1–3, objective tags
   and a remediation lesson. Diagnosis over flag trivia. */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.sreQuestions = LX.sreQuestions || [];
LX.sreReviews = LX.sreReviews || [];

(function () {
  var Q = function (x) { LX.sreQuestions.push(x); };

  /* ═══ M01 ═══════════════════════════════════════════════════════ */
  Q({ id: 'q-m01-b01', moduleId: 'M01', pool: 'bank', type: 'mcq', difficulty: 1, objectiveIds: ['obj-m01-01'], remediation: 'les-m01-01',
    q: 'Which of these is an observation rather than a hypothesis?',
    choices: ['`curl: (7) Failed to connect to 127.0.0.1 port 8080: Connection refused`', 'The service is not running', 'The deploy probably changed the port', 'The firewall is blocking it'],
    a: 0, rationale: 'An observation is what a tool printed or a user reported, quoted. The other three are stories that would explain it; each needs a discriminating check.',
    misconception: 'Treating the most likely story as a fact skips the check that would have separated it from the others.' });
  Q({ id: 'q-m01-b02', moduleId: 'M01', pool: 'bank', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m01-01'], remediation: 'les-m01-01',
    context: '$ systemctl status beacon\n● beacon.service - Beacon API\n     Active: failed (Result: exit-code)\n$ journalctl -u beacon -n 2\nFATAL config: open config/beacon.yaml: no such file or directory\n$ ls -l /opt/beacon/config/beacon.yaml\n-rw-r--r-- 1 beacon beacon 412 Oct 13 09:00 /opt/beacon/config/beacon.yaml',
    q: 'The file exists and is readable. Which hypothesis does this evidence leave standing, and what is the discriminating check?',
    choices: ['The process starts in a different working directory, so the relative path resolves elsewhere — check `WorkingDirectory=` in the unit', 'The file was deleted — recreate it', 'The service user cannot read it — `chmod 777` the file', 'The disk is full — run `df -h`'],
    a: 0, rationale: 'The error names a relative path and the absolute file exists and is readable, so location of the process (its working directory) is the remaining explanation. The unit\'s `WorkingDirectory=` (or `/proc/<pid>/cwd`) discriminates.',
    misconception: '"No such file" with the file present points at *where* the process looks, not at the file; permission errors say "permission denied".' });
  Q({ id: 'q-m01-b03', moduleId: 'M01', pool: 'bank', type: 'order', difficulty: 2, objectiveIds: ['obj-m01-01'], remediation: 'les-m01-01',
    q: 'Put the investigation steps in the order this course teaches.',
    steps: ['Quote the exact symptom as an observation', 'Write two or more hypotheses that each explain it', 'Choose the read-only check that discriminates between them', 'Reproduce the failure on demand', 'Make the smallest change that addresses the surviving hypothesis', 'Verify on the user path, not just process state'],
    rationale: 'Observe, hypothesise, discriminate, reproduce, change minimally, verify from the user side. Changing before reproducing destroys the before/after evidence.',
    misconception: 'Restarting or changing first feels productive but removes the evidence and cannot prove the change mattered.' });
  Q({ id: 'q-m01-b04', moduleId: 'M01', pool: 'bank', type: 'predict', difficulty: 1, objectiveIds: ['obj-m01-03'], remediation: 'les-m01-03',
    context: 'server:\n  listen: 0.0.0.0\nport: "8080"',
    q: 'Beacon reads `server.port`. What happens when it starts with this file?',
    choices: ['No parse error; `server.port` is missing so Beacon falls back to its default port', 'A YAML parse error on line 3', 'Beacon listens on 8080 because the key name matches', 'Beacon refuses to start because the port is a string'],
    a: 0, rationale: '`port` is at indentation 0, a sibling of `server`, so `server.port` does not exist. The file is valid YAML; only a structural read or a schema-aware check catches it.',
    misconception: 'A file that parses is not a file that means what you intended; indentation is structure.' });
  Q({ id: 'q-m01-b05', moduleId: 'M01', pool: 'bank', type: 'mcq', difficulty: 2, objectiveIds: ['obj-m01-02'], remediation: 'les-m01-02',
    q: 'A bad configuration commit is already on the shared branch and pushed. What is the right undo?',
    choices: ['`git revert <sha>`: a new commit that reverses it, keeping history', '`git reset --hard HEAD~1` then force-push', 'Delete the branch and recreate it from the previous commit', 'Edit the file back by hand without committing'],
    a: 0, rationale: 'Revert keeps the shared history intact and records what was tried; reset with a force-push rewrites history others may have built on. Editing without committing leaves the ledger wrong.',
    misconception: 'Reset and revert are not interchangeable: reset discards, revert records.' });
  Q({ id: 'q-m01-b06', moduleId: 'M01', pool: 'bank', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m01-02', 'obj-m01-03'], remediation: 'les-m01-02',
    context: '$ git merge feature/replicas\nCONFLICT (content): Merge conflict in deploy/beacon.yaml\n$ sed -n 3,9p deploy/beacon.yaml\n<<<<<<< HEAD\n  port: 8081\n=======\n  port: "8080"\n  replicas: 3\n>>>>>>> feature/replicas',
    q: 'Your branch moved the port to 8081 to avoid a clash; the feature branch added `replicas: 3` and accidentally quoted the port. Which resolution preserves both intentions?',
    choices: ['`port: 8081` and `replicas: 3`, markers removed, then validate, add, commit', 'Keep the HEAD side only: `port: 8081`', 'Keep the feature side only: `port: "8080"` and `replicas: 3`', 'Leave the markers; Git resolves them on commit'],
    a: 0, rationale: 'The intended result combines the port move with the new replica count and keeps the port a number. Either side alone drops a change; markers left behind make the file invalid YAML.',
    misconception: 'Picking one side is fast but silently discards the other branch\'s intent.' });
  Q({ id: 'q-m01-b07', moduleId: 'M01', pool: 'bank', type: 'explain', difficulty: 2, objectiveIds: ['obj-m01-01'], remediation: 'les-m01-01',
    q: 'A teammate\'s fix for a start failure was `chmod -R 777 /opt/beacon` and the service came up. Explain, in two to four sentences, why this course counts that as a failed attempt even though the symptom is gone.',
    rubric: ['Names that the cause (which file, which user, what access) was never identified', 'States the new risk: every file world-writable, including config and binaries', 'Describes the narrow alternative: fix ownership or mode on the specific file the service user needs', 'Mentions that the symptom vanishing is not verification of a cause'],
    answer: 'The change hid the symptom without identifying which file the service user could not read or why. It also made every file under /opt/beacon writable by anyone, so configuration and binaries can now be altered by any local process. The narrow fix is to find the exact file from the permission-denied message and set its owner or mode for the service user only. Service-up is not proof the cause was found; the same failure returns on the next deploy that resets permissions.',
    rationale: 'Least privilege and cause identification are both pass conditions; a symptom disappearing after a broad change satisfies neither.',
    misconception: 'Service-up is read as success; the course grades the change and the explanation, not the uptime.' });
  Q({ id: 'q-m01-b08', moduleId: 'M01', pool: 'bank', type: 'mcq', difficulty: 1, objectiveIds: ['obj-m01-04'], remediation: 'les-m01-03',
    q: 'Why do the host labs run in an ARM64 Linux VM rather than directly on macOS or in an ordinary container?',
    choices: ['macOS has no systemd or Linux namespaces, and an ordinary container does not run systemd; the VM gives real units, filesystems and namespaces', 'The VM is faster than macOS', 'Containers cannot run Python', 'Git only works on Linux'],
    a: 0, rationale: 'The M02–M03 labs exercise systemd, journald, Linux filesystems and network namespaces. Those are Linux kernel and init features; a VM provides them, macOS and a plain container do not.',
    misconception: 'A Docker container on a Mac is often mistaken for a Linux host; it shares a Linux kernel but is not a full system with an init.' });
  Q({ id: 'q-m01-b09', moduleId: 'M01', pool: 'bank', type: 'predict', difficulty: 2, objectiveIds: ['obj-m01-02'], remediation: 'les-m01-02',
    context: '$ git status\nOn branch fix/port\nYou have unmerged paths.\n  (fix conflicts and run "git commit")\nUnmerged paths:\n\tboth modified:   deploy/beacon.yaml\n$ grep -c "<<<<<<<" deploy/beacon.yaml\n0',
    q: 'You have edited the file and the markers are gone. What does `git commit` do right now?',
    choices: ['It refuses: the path is still unmerged until you `git add deploy/beacon.yaml`', 'It commits the merge', 'It re-runs the merge', 'It reverts your edit'],
    a: 0, rationale: 'Resolving the text is only half of resolving the conflict; `git add` tells Git the path is resolved. Until then the index still lists it as unmerged.',
    misconception: 'Removing the markers feels like finishing; Git tracks resolution in the index, not in the file.' });
  Q({ id: 'q-m01-b10', moduleId: 'M01', pool: 'bank', type: 'mcq', difficulty: 2, objectiveIds: ['obj-m01-03'], remediation: 'les-m01-03',
    q: 'Which check proves a Kubernetes manifest is acceptable to the API, rather than merely parseable YAML?',
    choices: ['`kubectl apply --dry-run=client -f file.yaml` (schema) or `--dry-run=server` (admission as well)', '`python3 -c "import yaml; yaml.safe_load(open(\'file.yaml\'))"`', '`cat file.yaml | wc -l`', 'Opening it in an editor with syntax highlighting'],
    a: 0, rationale: 'A YAML parser proves shape. The consumer\'s validation proves the fields, types and (server-side) admission rules are satisfied.',
    misconception: 'Syntax highlighting and parsers cannot know what keys a consumer expects.' });

  Q({ id: 'q-m01-g01', moduleId: 'M01', pool: 'gate', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m01-01'], remediation: 'les-m01-01',
    context: '$ journalctl -u beacon -n 1\nFATAL: required setting BEACON_DB_URL is not set; refusing to start\n$ env | grep BEACON_DB_URL\nBEACON_DB_URL=postgres://beacon@db:5432/beacon',
    q: 'The variable is set in your shell but the service refuses to start. What is the standing hypothesis and its check?',
    choices: ['The service does not inherit your shell environment; check `systemctl show beacon -p Environment` / the unit\'s `EnvironmentFile=`', 'The database is down; ping `db`', 'The variable has a typo; retype it', 'The journal is stale; restart the service'],
    a: 0, rationale: 'systemd starts units with their own environment, not your login shell\'s. The discriminating check reads the unit\'s environment configuration.',
    misconception: '"Works when I run it, fails under systemd" is almost always environment or working directory, not the application.' });
  Q({ id: 'q-m01-g02', moduleId: 'M01', pool: 'gate', type: 'order', difficulty: 2, objectiveIds: ['obj-m01-02'], remediation: 'les-m01-02',
    q: 'Order the steps to resolve a merge conflict in a config file safely.',
    steps: ['Read both sides between the markers and state each branch\'s intent', 'Edit the file to the intended combined result and delete all marker lines', 'Validate the file with the consuming tool or a schema-aware check', 'Stage the resolved file with git add', 'Commit the merge with a message that says what was combined', 'Re-check behaviour on the user path'],
    rationale: 'Understand both intents first; then edit, validate, stage, commit, verify. Staging before validating risks committing an invalid file.',
    misconception: 'Deleting the markers is not resolution; the content must be validated and the index updated.' });
  Q({ id: 'q-m01-g03', moduleId: 'M01', pool: 'gate', type: 'predict', difficulty: 2, objectiveIds: ['obj-m01-03'], remediation: 'les-m01-03',
    context: 'workers:\n  - name: ingest\n\tconcurrency: 4\n  - name: export',
    q: 'What does a YAML parser do with this file?',
    choices: ['Rejects it: a tab character is used for indentation on line 3', 'Accepts it with concurrency under ingest', 'Accepts it with concurrency as a top-level key', 'Accepts it and ignores the tab'],
    a: 0, rationale: 'YAML forbids tabs in indentation. This is the loud kind of error; the quiet ones are wrong depth and wrong type.',
    misconception: 'Editors that convert tabs silently can make the file look identical to a valid one.' });
  Q({ id: 'q-m01-g04', moduleId: 'M01', pool: 'gate', type: 'explain', difficulty: 2, objectiveIds: ['obj-m01-01', 'obj-m01-04'], remediation: 'les-m01-01',
    q: 'Explain why "reproduce the failure first" is a prerequisite for claiming a fix, and what you record so someone else can reproduce it later.',
    rubric: ['Reproduction gives a before/after pair; without it a later success could be coincidence', 'Names the reproduction conditions: same command, user, working directory, environment', 'Records the exact error text and the tool/OS versions in the evidence', 'Verification is on the user path, not process state'],
    answer: 'If you cannot make the failure happen on demand you cannot show your change removed it; the service might have started anyway. Reproduce with the same command, user, working directory and environment the service manager uses, record the exact error, change one thing, and show the same command now succeeds and the user-path request works. The evidence report carries the error text, the versions (architecture, distribution, Python) and the seed so another person can repeat it.',
    rationale: 'A fix is a claim backed by a reproducible before/after; the report is what makes it checkable.',
    misconception: 'Success after a change is taken as proof without a controlled before state.' });
  Q({ id: 'q-m01-g05', moduleId: 'M01', pool: 'gate', type: 'mcq', difficulty: 1, objectiveIds: ['obj-m01-02'], remediation: 'les-m01-02',
    q: 'What makes a diff "focused" in the sense this course requires for operational changes?',
    choices: ['It touches only the lines related to the stated change, so a reviewer can read it in a minute', 'It is under 100 lines', 'It changes only one file', 'It has a long commit message'],
    a: 0, rationale: 'Focus is about relatedness, not size: reformatting a file hides the one line that matters even if the total is small.',
    misconception: 'Combining a cleanup with a fix feels efficient but makes the fix unreviewable and the revert imprecise.' });

  /* review prompts for M01 (changed symptoms, not the same questions) */
  LX.sreReviews.push(
    { id: 'rev-m01-01', objectiveIds: ['obj-m01-01'], kind: 'changed-symptom', prompt: 'A service logs `permission denied` opening its config, and the file is mode 640 owned by root:root while the unit runs as `beacon`. Name the two smallest fixes and the one you must not use.', answer: 'Either `chown root:beacon` (group read via 640) or `chmod 644` if the content is not sensitive; never 777 or running the service as root to make the error go away.' },
    { id: 'rev-m01-02', objectiveIds: ['obj-m01-02'], kind: 'recall', prompt: 'Without looking: what does `git revert HEAD` do that `git reset --hard HEAD~1` does not?', answer: 'Creates a new commit that reverses the change while keeping history; reset discards the commit and rewrites history.' },
    { id: 'rev-m01-03', objectiveIds: ['obj-m01-03'], kind: 'changed-symptom', prompt: 'A manifest has `replicas: "3"`. The YAML parser is happy. What tool tells you it is wrong, and why?', answer: '`kubectl apply --dry-run=client` (schema): replicas must be an integer; a parser cannot know the field\'s type.' },
    { id: 'rev-m01-04', objectiveIds: ['obj-m01-04'], kind: 'recall', prompt: 'Which three version facts go in every host-lab evidence report, and why?', answer: 'Architecture (uname -m), distribution release, and the tool version under test (e.g. python3), so a result can be reproduced on the same stack.' }
  );
})();

(function () {
  var Q = function (x) { LX.sreQuestions.push(x); };

  /* ═══ M02 ═══════════════════════════════════════════════════════ */
  Q({ id: 'q-m02-b01', moduleId: 'M02', pool: 'bank', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m02-02', 'obj-m02-04'], remediation: 'les-m02-01',
    context: '$ systemctl status beacon-worker --no-pager\n     Active: activating (auto-restart) (Result: signal) since Mon 2026-10-13 09:12:40 UTC; 3s ago\n    Process: 2301 ExecStart=/opt/beacon/bin/beacon-worker (code=killed, signal=KILL)\n$ journalctl -u beacon-worker -n 2 --no-pager\nOct 13 09:12:38 node1 beacon-worker[2301]: processed batch 419 (2000 records)\nOct 13 09:12:40 node1 systemd[1]: beacon-worker.service: Main process exited, code=killed, status=9/KILL\n$ journalctl -k -n 1 --no-pager\nOct 13 09:12:40 node1 kernel: Out of memory: Killed process 2301 (beacon-worker) total-vm:4210048kB, anon-rss:3902112kB',
    q: 'Is this the application failing or the host, and what is the honest next question?',
    choices: ['The host: the kernel OOM killer sent SIGKILL after the worker reached ~3.9 GB; next ask whether that growth is a leak or a batch size too large for this host', 'The application: it crashed with exit code 9, so fix the code path around batch 419', 'The application: `Result: signal` means Beacon raised an unhandled exception', 'The host: the disk filled up, so run `df -h`'],
    a: 0, rationale: 'The worker printed no error and was removed by a signal it cannot catch; the kernel line names the sender and the memory held. That is pressure, not a code exception, even though the growing process is Beacon.',
    misconception: '`code=killed, signal=KILL` is read as an exit code of the application; exit codes are chosen by the program, signals are sent to it.' });
  Q({ id: 'q-m02-b02', moduleId: 'M02', pool: 'bank', type: 'predict', difficulty: 2, objectiveIds: ['obj-m02-03'], remediation: 'les-m02-02',
    context: '$ id beacon\nuid=998(beacon) gid=998(beacon) groups=998(beacon)\n$ namei -l /opt/beacon/config/beacon.yaml\nf: /opt/beacon/config/beacon.yaml\ndrwxr-xr-x root   root   /\ndrwxr-xr-x root   root   opt\ndrwxr-x--- root   root   beacon\ndrwxr-xr-x root   root   config\n-rw-r----- root   beacon beacon.yaml',
    q: 'What does `sudo -u beacon cat /opt/beacon/config/beacon.yaml` print, and which single change fixes it narrowly?',
    choices: ['`Permission denied`: `/opt/beacon` has no execute bit for "other" and beacon is not in group root; fix with `chgrp beacon /opt/beacon` (or `chmod o+x`)', 'The file contents: the file is group-readable by beacon', '`Permission denied`: the file needs `chmod 644`', '`Permission denied`: run the service as root instead'],
    a: 0, rationale: 'Access is decided on every path component. The file itself is fine (group beacon can read), but the directory `/opt/beacon` is 750 owned by root:root, so uid 998 cannot traverse it. The narrow fix is on that directory only.',
    misconception: 'Looking only at the file\'s mode bits misses the directory traverse bit, which is the most common hidden component.' });
  Q({ id: 'q-m02-b03', moduleId: 'M02', pool: 'bank', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m02-01'], remediation: 'les-m02-03',
    context: '$ systemctl status beacon-api --no-pager\n     Active: failed (Result: exit-code)\n    Process: 3410 ExecStart=/opt/beacon/bin/beacon-api --config config/beacon.yaml (code=exited, status=203/EXEC)\n$ journalctl -u beacon-api -b -n 2 --no-pager\nOct 13 11:02:17 node1 systemd[3410]: beacon-api.service: Failed at step EXEC spawning /opt/beacon/bin/beacon-api: No such file or directory\nOct 13 11:02:17 node1 systemd[1]: beacon-api.service: Failed with result \'exit-code\'.\n$ ls -l /opt/beacon/bin/beacon-api\n-rwxr-xr-x 1 root root 212 Oct 13 10:58 /opt/beacon/bin/beacon-api',
    q: 'The file exists and is executable. What is the standing hypothesis and its check?',
    choices: ['The script\'s `#!` interpreter path does not exist; check `head -1` of the script and `ls -l` that interpreter', 'The config file is missing; check `ls config/beacon.yaml`', 'Beacon raised an exception on startup; read the application log', 'The unit needs `daemon-reload`; run it and retry'],
    a: 0, rationale: '`203/EXEC` means systemd could not execute the program at all, so Beacon never ran and its config was never read. A present, executable script that still gives "No such file" points at the interpreter named on its first line.',
    misconception: '"No such file or directory" is attached to the script path, so people look for the script; the missing file is the interpreter it names.' });
  Q({ id: 'q-m02-b04', moduleId: 'M02', pool: 'bank', type: 'mcq', difficulty: 1, objectiveIds: ['obj-m02-01'], remediation: 'les-m02-03',
    q: 'You added `WorkingDirectory=/opt/beacon` to the unit file, ran `systemctl restart beacon-api`, and the same relative-path error appears. What is the most likely reason?',
    choices: ['systemd is still using the previously loaded unit; `systemctl daemon-reload` is required after editing a unit file', 'The directive must be in the `[Unit]` section', 'The directory must be owned by the service user', 'Restart does not re-read environment; use `systemctl reload`'],
    a: 0, rationale: 'Unit files are read at load time. Without `daemon-reload` the restart runs the old definition, which is the most common "my change did nothing" in this module.',
    misconception: 'Treating a restart as a re-read of configuration; systemd caches units until told to reload.' });
  Q({ id: 'q-m02-b05', moduleId: 'M02', pool: 'bank', type: 'predict', difficulty: 2, objectiveIds: ['obj-m02-04'], remediation: 'les-m02-04',
    context: '$ nproc\n2\n$ uptime\n 12:40:11 up 6 days,  load average: 9.21, 8.70, 4.15\n$ vmstat 1 2 | tail -1\n r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st\n 1  8      0 118204  10240 190112    0    0  9120 48210  812 1400  6  4 12 78  0',
    q: 'Which resource is saturated, and what will `top` sorted by CPU show?',
    choices: ['Disk I/O: eight tasks are blocked and `wa` is 78%; `top` will show low CPU use with processes in state D', 'CPU: load 9 on 2 CPUs means the CPUs are pegged; `top` will show a process at ~100%', 'Memory: free is only 118 MB; `top` will show swapping', 'Network: `in` and `cs` are high; `top` will show interrupts'],
    a: 0, rationale: 'Load counts runnable and I/O-blocked tasks. The `b` column and `wa` show the queue is waiting on disk while `us` is 6%; the load number alone cannot tell CPU from I/O.',
    misconception: 'Reading load average as CPU utilisation; it is a queue length that includes uninterruptible I/O waits.' });
  Q({ id: 'q-m02-b06', moduleId: 'M02', pool: 'bank', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m02-04'], remediation: 'les-m02-05',
    context: '$ journalctl -u beacon-worker -n 1 --no-pager\nOct 13 13:05:02 node1 beacon-worker[5102]: OSError: [Errno 28] No space left on device: \'/var/lib/beacon/spool/r-88213.json\'\n$ df -h /var/lib/beacon\nFilesystem      Size  Used Avail Use% Mounted on\n/dev/vda2        20G  6.8G   13G  35% /\n$ df -i /var/lib/beacon\nFilesystem      Inodes   IUsed  IFree IUse% Mounted on\n/dev/vda2      1310720 1310720      0  100% /',
    q: 'What is exhausted, and what kind of cleanup restores writes?',
    choices: ['Inodes: the filesystem has free blocks but no free inodes; delete or consolidate the many small files in the spool directory', 'Blocks: delete the largest log files under `/var/log`', 'Memory: the write buffer is full; restart the worker', 'Nothing on this filesystem; the spool must be on a different mount'],
    a: 0, rationale: '`ENOSPC` is raised for either budget. `df -h` shows 13 GB free; `df -i` shows zero free inodes. Freeing bytes does not help; freeing file count does.',
    misconception: '"No space left" is assumed to mean bytes; inode exhaustion gives the identical error and needs the second `df`.' });
  Q({ id: 'q-m02-b07', moduleId: 'M02', pool: 'bank', type: 'order', difficulty: 2, objectiveIds: ['obj-m02-02', 'obj-m02-01'], remediation: 'les-m02-03',
    q: 'Order the ladder this course teaches for a unit that will not start, stopping at the first step that explains everything.',
    steps: ['`systemctl status <unit>` for state, result and exit code or signal', '`journalctl -u <unit> -b -n 50` to see whether systemd or the application produced the failure message', '`systemctl cat <unit>` and compare its paths and user with reality (`ls -l`, `namei -l`, `id`)', 'Reproduce as the service user with the unit\'s working directory and environment', 'Change one directive, `daemon-reload`, restart', 'Verify on the user path with a real request'],
    rationale: 'Lifecycle fact, then the story, then compare the unit with reality, then reproduce, then change one thing, then verify where the user is.',
    misconception: 'Editing the unit before reading the journal guesses at the cause and loses the before/after evidence.' });
  Q({ id: 'q-m02-b08', moduleId: 'M02', pool: 'bank', type: 'explain', difficulty: 2, objectiveIds: ['obj-m02-03'], remediation: 'les-m02-02',
    q: 'The journal shows `PermissionError: [Errno 13] Permission denied: \'/var/log/beacon/api.log\'` for a unit with `User=beacon`. Describe the procedure that identifies the exact component at fault and the narrow fix, and name the unit directive that prevents it recurring.',
    rubric: ['Confirms the identity the unit runs as (`systemctl show -p User`, `id beacon`)', 'Walks every path component with `namei -l` (or `ls -ld` per directory) to find which lacks the needed bit for that user', 'Reproduces without changing anything (`sudo -u beacon touch ...`) before and after the fix', 'Changes ownership or mode only on the directory/file the service writes (e.g. `chown beacon:beacon /var/log/beacon`, `750`), not `777` and not root', 'Names `LogsDirectory=` (or `StateDirectory=`) so systemd creates the directory with the right owner on every start'],
    answer: 'First confirm who the process is: `systemctl show beacon-api -p User` and `id beacon`. Then walk the path with `namei -l /var/log/beacon/api.log` reading owner, group and mode on every component; the service needs execute on each directory and write on the log directory and file. Reproduce as that user with `sudo -u beacon touch /var/log/beacon/api.log`. Fix only the component that fails — typically `chown -R beacon:beacon /var/log/beacon` and `chmod 750` on it — then reproduce again, restart, and verify a request. Add `LogsDirectory=beacon` to the unit so the directory is created and owned correctly every start; never `chmod 777` or `User=root`.',
    rationale: 'The pass condition is identifying user, component and bit, fixing exactly that, and preventing recurrence, not making the error disappear.',
    misconception: 'Widening permissions on the whole tree hides which component was wrong and exposes config and code to every local user.' });
  Q({ id: 'q-m02-b09', moduleId: 'M02', pool: 'bank', type: 'mcq', difficulty: 2, objectiveIds: ['obj-m02-05'], remediation: 'les-m02-05',
    q: '`sudo ss -ltnp` on node1 shows `LISTEN 0 128 127.0.0.1:8080 0.0.0.0:* users:(("python",pid=3301,fd=5))`. The proxy host gets `Connection refused` to `10.42.3.10:8080`. What is proven and what is the fix?',
    choices: ['Beacon owns 8080 but is bound to loopback only, so remote SYNs get a reset; make the process listen on `0.0.0.0` (or the interface address) via the config it actually reads, then restart', 'A firewall is dropping the proxy\'s packets; open 8080 in the host firewall', 'Beacon is not running; start the unit', 'The proxy has the wrong port; it should use 443'],
    a: 0, rationale: 'The socket table proves the owner and the scope: `127.0.0.1` accepts only local connections. A refusal (not a timeout) is consistent with that and inconsistent with a firewall drop.',
    misconception: '"Connection refused" is blamed on a firewall; a drop times out, a refusal is an active reset from a reachable host with nothing listening on that address.' });
  Q({ id: 'q-m02-b10', moduleId: 'M02', pool: 'bank', type: 'predict', difficulty: 1, objectiveIds: ['obj-m02-01', 'obj-m02-02'], remediation: 'les-m02-01',
    context: '$ /opt/beacon/bin/beacon-worker --once; echo "exit: $?"\nprocessing batch 1 ...\nTerminated\nexit: 143',
    q: 'What ended the worker?',
    choices: ['A SIGTERM from outside the process (143 = 128 + 15): a stop request, not an error the program chose', 'The program returned 143 to report a batch failure', 'The kernel OOM killer (SIGKILL)', 'A configuration error, since Beacon exits non-zero on bad config'],
    a: 0, rationale: 'Exit statuses above 128 from a shell mean "killed by signal (status − 128)". 15 is SIGTERM; SIGKILL would be 137. The program did not pick the number.',
    misconception: 'Any non-zero exit is read as an application error code; the 128+N convention marks signal deaths.' });

  Q({ id: 'q-m02-g01', moduleId: 'M02', pool: 'gate', type: 'diagnose', difficulty: 3, objectiveIds: ['obj-m02-04', 'obj-m02-02'], remediation: 'les-m02-04',
    context: '$ free -h\n               total        used        free      shared  buff/cache   available\nMem:           3.8Gi       3.6Gi        90Mi        12Mi       110Mi        85Mi\nSwap:             0B          0B          0B\n$ ps -o pid,rss,etimes,cmd --sort=-rss | head -3\n    PID   RSS ELAPSED CMD\n   5102 3310200   7210 /opt/beacon/venv/bin/python -m beacon.worker\n    812  210400  519000 /usr/sbin/postgres -D /var/lib/postgresql\n$ journalctl -k --since "2 hours ago" | grep -ci "out of memory"\n0',
    q: 'Nothing has been killed yet. What is the situation and the safest first change?',
    choices: ['Memory pressure from the worker (3.3 GB RSS after two hours, 85 MB available); stop or bound it with `MemoryMax=` in a drop-in so a kill hits only that unit, then determine leak versus batch size', 'The host is healthy because nothing was OOM-killed; no change needed', 'PostgreSQL is the consumer; restart it to free memory', 'Add 4 GB of swap so the kernel has headroom'],
    a: 0, rationale: '`available` is the pressure metric and it is nearly gone; the top RSS is the worker and it has grown over its lifetime. Bounding the unit scopes the next kill to the grower; swap converts the shortage into I/O wait and hides it.',
    misconception: 'Waiting for an OOM line before acting, or treating swap as a fix; the kernel line proves a kill, but pressure is visible before it.' });
  Q({ id: 'q-m02-g02', moduleId: 'M02', pool: 'gate', type: 'predict', difficulty: 2, objectiveIds: ['obj-m02-04', 'obj-m02-05'], remediation: 'les-m02-05',
    context: '$ sudo rm /var/log/beacon/worker.log\n$ df -h /var/log | tail -1\n/dev/vda2        20G   19G  240M  99% /\n$ sudo lsof +L1 | grep worker.log\npython  5102 beacon  7w  REG 253,1 9663676416  0 262913 /var/log/beacon/worker.log (deleted)',
    q: 'Why did `rm` not free the 9 GB, and what frees it without restarting the worker?',
    choices: ['The worker still holds the file open on fd 7, so the blocks are not released; `truncate -s 0 /proc/5102/fd/7` empties it through the descriptor', 'The filesystem needs an `fsck` to reclaim deleted blocks', 'The file is in the journal, not on disk; run `journalctl --vacuum-size`', 'Only a reboot frees deleted files'],
    a: 0, rationale: 'Unlinking removes the name; the inode and its blocks live until the last open descriptor closes. Truncating through `/proc/<pid>/fd/N` returns the space immediately and the process keeps writing to its handle.',
    misconception: 'Deleting a file is equated with freeing its space; open files are the exception, and `lsof +L1` finds them.' });
  Q({ id: 'q-m02-g03', moduleId: 'M02', pool: 'gate', type: 'mcq', difficulty: 2, objectiveIds: ['obj-m02-01'], remediation: 'les-m02-03',
    q: 'After five quick failures `systemctl status` shows `Result: start-limit-hit` and `systemctl restart` appears to do nothing. What is the correct sequence?',
    choices: ['Find and fix the cause from the journal, then `systemctl reset-failed <unit>`, then start it', 'Raise `StartLimitBurst=` so restarts can continue', 'Reboot the host to clear the limit', 'Set `Restart=always` so systemd keeps trying'],
    a: 0, rationale: 'The start limit is systemd protecting the host from a restart loop. Clearing it without fixing the cause reproduces the loop; the limit is reset with `reset-failed` once the cause is addressed.',
    misconception: 'Treating the rate limit as the fault rather than a symptom of repeated failure.' });
  Q({ id: 'q-m02-g04', moduleId: 'M02', pool: 'gate', type: 'order', difficulty: 2, objectiveIds: ['obj-m02-03'], remediation: 'les-m02-02',
    q: 'Order the steps for repairing a permission fault narrowly.',
    steps: ['Read the exact path and errno from the journal and confirm the unit\'s `User=`', 'Walk every component of that path with `namei -l`', 'Reproduce as the service user (`sudo -u beacon ...`) without changing anything', 'Change owner or mode on only the component that lacks the needed bit', 'Reproduce again as the service user to confirm the access now succeeds', 'Restart the unit and verify on the user path; add `StateDirectory=`/`LogsDirectory=` if a writable directory was the cause'],
    rationale: 'Identity, then components, then a read-only reproduction, then the one change, then confirmation and prevention.',
    misconception: 'Changing modes before locating the component leads to broad changes and no understanding of what was wrong.' });
  Q({ id: 'q-m02-g05', moduleId: 'M02', pool: 'gate', type: 'explain', difficulty: 2, objectiveIds: ['obj-m02-02'], remediation: 'les-m02-01',
    q: 'Explain how you decide from `systemctl status`, the unit journal and the kernel log whether a stopped Beacon process was the application\'s decision or the host\'s. Give the signature of each case.',
    rubric: ['`code=exited, status=N` plus an application message in the journal means the program ran and chose to exit (application)', '`code=killed, signal=KILL` with no application error and a kernel `Out of memory: Killed process` line means the OOM killer (host pressure)', '`code=killed, signal=TERM` (or KILL after `TimeoutStopSec`) with a systemd stop message means an operator or systemd stopped it', 'A process in state D that never exits points at I/O on the host, not a crash', 'States that the next evidence source follows from the case: config/input for the application, memory/disk for the host'],
    answer: 'Read the exit information first. `code=exited, status=2` with `FATAL config ...` just above it in `journalctl -u` is the program speaking: it inspected its input and refused, so the next step is that input. `code=killed, signal=KILL` with normal application lines right up to the end and a `kernel: Out of memory: Killed process <pid>` line in `journalctl -k` is the host: memory pressure, and the next step is `free -h` and `ps --sort=-rss`. `code=killed, signal=TERM` with a systemd "Stopping" line is an operator or systemd stop. If the process has not exited at all but sits in state D with rising load, the host is holding it on I/O. In every case the signature tells you which log to read next.',
    rationale: 'The discriminator is who chose the exit: a status is chosen by the program, a signal is sent to it, and the kernel log names the sender for OOM kills.',
    misconception: 'Treating every stop as an application crash and restarting; the signal/exit distinction is the cheapest host-versus-application read available.' });

  /* ═══ M03 ═══════════════════════════════════════════════════════ */
  Q({ id: 'q-m03-b01', moduleId: 'M03', pool: 'bank', type: 'predict', difficulty: 2, objectiveIds: ['obj-m03-02'], remediation: 'les-m03-01',
    context: '$ ip -br addr show eth0\neth0             UP             10.42.3.77/22\n$ ip route\ndefault via 10.42.0.1 dev eth0 proto dhcp metric 100\n10.42.0.0/22 dev eth0 proto kernel scope link src 10.42.3.77',
    q: 'What does `ip route get 10.42.9.5` print, and what does `ip route get 10.42.1.9` print?',
    choices: ['`10.42.9.5 via 10.42.0.1 dev eth0` (outside the /22, sent to the gateway) and `10.42.1.9 dev eth0` (inside 10.42.0.0–10.42.3.255, delivered on link)', 'Both `via 10.42.0.1`: everything leaves through the default route', 'Both `dev eth0` with no gateway: both are in 10.42.0.0/16', '`Network is unreachable` for 10.42.9.5 because no route covers it'],
    a: 0, rationale: 'A /22 holds 1024 addresses: 10.42.0.0 through 10.42.3.255. 10.42.1.9 is inside (on link); 10.42.9.5 is outside and only the default route matches, so it goes via the gateway.',
    misconception: 'Treating the third octet as "same network if it starts with 10.42"; the prefix length decides the block.' });
  Q({ id: 'q-m03-b02', moduleId: 'M03', pool: 'bank', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m03-02', 'obj-m03-04'], remediation: 'les-m03-01',
    context: '$ curl -sS --connect-timeout 5 http://10.42.9.5:5000/v2/\ncurl: (28) Failed to connect to 10.42.9.5 port 5000 after 5001 ms: Timeout was reached\n$ ip -br addr show eth0\neth0             UP             10.42.3.77/16\n$ ip route get 10.42.9.5\n10.42.9.5 dev eth0 src 10.42.3.77 uid 1000\n$ ip neigh show 10.42.9.5\n10.42.9.5 dev eth0  FAILED\n$ curl -sS --connect-timeout 5 http://10.42.1.9:5432/ 2>&1 | head -c 40\ncurl: (52) Empty reply from server',
    q: 'The database at 10.42.1.9 answers but the registry at 10.42.9.5 times out. What is wrong?',
    choices: ['The interface mask is /16 instead of the subnet\'s /22, so the host treats 10.42.9.5 as on-link, ARPs for it and gets no answer; correct the prefix to /22', 'The registry host is down; ARP would otherwise succeed', 'A firewall on the registry drops port 5000', 'The default route is missing'],
    a: 0, rationale: '`ip route get` shows no `via`, so the kernel believes the destination is local; `FAILED` in the neighbour table means ARP got no reply, because the registry is behind the router. Hosts inside the real /22 still work, which is why only some destinations fail.',
    misconception: 'A timeout is blamed on the far host or a firewall before checking whether the packet could leave at all.' });
  Q({ id: 'q-m03-b03', moduleId: 'M03', pool: 'bank', type: 'mcq', difficulty: 1, objectiveIds: ['obj-m03-04'], remediation: 'les-m03-02',
    q: '`curl http://10.42.3.10:8080/` fails in 2 ms with `Connection refused`. Which hypotheses does this timing and message rule out, and which check comes next?',
    choices: ['Rules out a firewall drop and a routing fault (both would time out); next is `ss -ltnp` on 10.42.3.10 to see whether anything listens on 8080 and on which address', 'Rules out nothing; next is to disable the firewall and retry', 'Rules out a DNS problem only; next is `dig`', 'Proves the host is down; next is to ping it'],
    a: 0, rationale: 'A refusal is a TCP reset from a reachable host: routing works and nothing silently dropped the SYN. What remains is "nothing listening on that address:port" (or an explicit reject), which the server\'s socket table settles.',
    misconception: 'Refused and timed out are treated as the same "cannot connect"; they are produced by different hops and separate the hypotheses.' });
  Q({ id: 'q-m03-b04', moduleId: 'M03', pool: 'bank', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m03-03'], remediation: 'les-m03-03',
    context: '$ dig @ns1.corp.lab +norecurse beacon.corp.lab | grep -A1 "ANSWER SECTION"\n;; ANSWER SECTION:\nbeacon.corp.lab.        3600    IN      A       10.42.3.20\n$ dig beacon.corp.lab | grep -A1 "ANSWER SECTION"\n;; ANSWER SECTION:\nbeacon.corp.lab.        3242    IN      A       10.42.3.10\n$ resolvectl status eth0 | grep "DNS Servers"\n    DNS Servers: 10.42.0.53',
    q: 'Beacon moved to 10.42.3.20 three minutes ago. Why do the workers still post to .10, and what is an honest fix?',
    choices: ['The resolver at 10.42.0.53 cached the old record with a one-hour TTL and will serve it for 3242 more seconds; keep the old host answering (or proxying) until then, or flush that resolver if you control it, and lower the TTL before the next move', 'The zone update failed; re-apply it on ns1', 'Add `10.42.3.20 beacon.corp.lab` to `/etc/hosts` on every worker', 'The workers have a DNS bug; restart them'],
    a: 0, rationale: 'The authoritative server (`aa`, asked with `@`) already serves .20. The resolver\'s answer carries a counting-down TTL, which is a cache honouring the zone\'s own 3600. Editing `/etc/hosts` masks the resolver permanently and repeats the fault with a harder cause next time.',
    misconception: 'Believing a zone change is live everywhere immediately; resolvers serve cached records until TTL expiry.' });
  Q({ id: 'q-m03-b05', moduleId: 'M03', pool: 'bank', type: 'predict', difficulty: 2, objectiveIds: ['obj-m03-03'], remediation: 'les-m03-03',
    context: '10:00:05 $ dig api.corp.lab | grep -E "status|SOA"\n;; ->>HEADER<<- opcode: QUERY, status: NXDOMAIN, id: 4471\ncorp.lab.  600  IN  SOA  ns1.corp.lab. hostmaster.corp.lab. 2026101301 3600 600 86400 600\n10:00:40 $ # record api.corp.lab A 10.42.3.21 added on ns1 and zone reloaded\n10:01:10 $ dig @ns1.corp.lab api.corp.lab +short\n10.42.3.21',
    q: 'What does `dig api.corp.lab +short` (via the normal resolver) return at 10:01:15, and until roughly when?',
    choices: ['Nothing (still NXDOMAIN): the resolver negatively cached the "no such name" answer for the SOA minimum of 600 s, so until about 10:10:05', '`10.42.3.21`: the record exists now', '`SERVFAIL`: the resolver is confused by the change', '`10.42.3.21` but only after 3600 s'],
    a: 0, rationale: 'Negative answers are cached for the lesser of the SOA TTL and its minimum field (both 600 here). The resolver will not re-ask until that expires; the authoritative server already answers correctly.',
    misconception: 'Only positive records are thought to be cached; negative caching surprises anyone who queried a name before creating it.' });
  Q({ id: 'q-m03-b06', moduleId: 'M03', pool: 'bank', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m03-04', 'obj-m03-01'], remediation: 'les-m03-04',
    context: '# from worker 10.42.9.14\n$ nc -vz -w 3 10.42.3.30 5000\nnc: connect to 10.42.3.30 port 5000 (tcp) failed: Connection timed out\n# from proxy 10.42.3.10\n$ nc -vz -w 3 10.42.3.30 5000\nConnection to 10.42.3.30 5000 port [tcp/*] succeeded!\n# on registry 10.42.3.30\n$ sudo nft list chain inet filter input\n  chain input {\n    type filter hook input priority filter; policy drop;\n    ct state established,related accept\n    tcp dport 22 accept\n    ip saddr 10.42.0.0/22 tcp dport 5000 accept\n  }',
    q: 'Where is the fault and what is the narrow fix?',
    choices: ['Ingress on the registry host: 5000 is accepted only from 10.42.0.0/22 and the policy drops the rest; add `ip saddr 10.42.8.0/22 tcp dport 5000 accept` persistently', 'The registry is not listening; the proxy succeeded only because it is local', 'Egress on the worker subnet; open all outbound traffic', 'The policy should be changed to `accept` so the rules stop mattering'],
    a: 0, rationale: 'A same-subnet client connects, so the listener is fine; the worker is in 10.42.8.0/22, which no accept rule covers, and the chain policy is drop, hence the silent timeout. The fix is one rule for that source and port.',
    misconception: 'Fixing by changing the policy or flushing rules removes every other protection on the host instead of adding the one missing rule.' });
  Q({ id: 'q-m03-b07', moduleId: 'M03', pool: 'bank', type: 'mcq', difficulty: 2, objectiveIds: ['obj-m03-01', 'obj-m03-04'], remediation: 'les-m03-04',
    q: 'A stateless network ACL in front of the proxy subnet allows inbound TCP 443 and has no outbound rules. Clients time out; the proxy shows connections in `SYN-RECV`. What is missing?',
    choices: ['An outbound rule allowing TCP to the clients\' ephemeral port range, because a stateless filter judges the SYN-ACK on its own', 'An inbound rule for port 80', 'A route to the client subnet', 'Nothing: `SYN-RECV` means the proxy is overloaded'],
    a: 0, rationale: 'Stateless filters need both directions; the reply packet (SYN-ACK) leaves on a high client port and is dropped without an egress rule. A stateful firewall would have allowed it as part of the established connection.',
    misconception: 'Assuming all firewalls track connections; network ACLs do not, so replies need their own rule.' });
  Q({ id: 'q-m03-b08', moduleId: 'M03', pool: 'bank', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m03-05', 'obj-m03-04'], remediation: 'les-m03-05',
    context: '$ curl -sS https://beacon.corp.lab/healthz\ncurl: (60) SSL certificate problem: unable to get local issuer certificate\n$ openssl s_client -connect 10.42.3.10:443 -servername beacon.corp.lab </dev/null 2>/dev/null | grep -E "^ [0-9] s:|Verify return"\n 0 s:CN = beacon.corp.lab\nVerify return code: 21 (unable to verify the first certificate)\n$ openssl s_client -connect 10.42.3.10:443 -servername beacon.corp.lab </dev/null 2>/dev/null | openssl x509 -noout -dates -ext subjectAltName\nnotBefore=Oct 13 08:00:00 2026 GMT\nnotAfter=Jan 11 08:00:00 2027 GMT\n    DNS:beacon.corp.lab, DNS:api.corp.lab',
    q: 'Which of the three checks fails, and what is the server-side fix?',
    choices: ['The chain: only the leaf is served (one certificate, verify 21), so clients cannot link it to the trusted root; serve leaf plus intermediate as the certificate file and reload the proxy', 'The name: the SAN does not match; reissue', 'The dates: the certificate is expired; reissue', 'The client\'s clock is wrong; fix NTP'],
    a: 0, rationale: 'Dates are valid and the SAN contains the requested name, so validity and name pass. Verify code 21 with a single certificate in the chain is the missing intermediate; the honest fix is on the server, not `-k` on the client.',
    misconception: '"Works with -k" is read as a picky client; `-k` skips exactly the check that failed.' });
  Q({ id: 'q-m03-b09', moduleId: 'M03', pool: 'bank', type: 'order', difficulty: 2, objectiveIds: ['obj-m03-01', 'obj-m03-04'], remediation: 'les-m03-02',
    q: 'Order the layered ladder for a failing `https://beacon.corp.lab/healthz`, stopping at the first rung that fails.',
    steps: ['Resolve: `getent hosts` and `dig +short` — do they agree and give the expected address?', 'Connect: `nc -vz` or `curl --connect-timeout` to the address and port — refused, timeout, no route, or connected?', 'Handshake: `openssl s_client -servername` — does the certificate verify for the name?', 'Answer: `curl -sv` the real path — status code, headers, body', 'If a proxy answered 502/504, repeat connect/handshake/answer from the proxy to its upstream'],
    rationale: 'Resolve, connect, handshake, answer; a proxy error moves the same ladder one hop inward.',
    misconception: 'Starting at the application log for a request that never reached the application.' });
  Q({ id: 'q-m03-b10', moduleId: 'M03', pool: 'bank', type: 'explain', difficulty: 2, objectiveIds: ['obj-m03-04', 'obj-m03-05'], remediation: 'les-m03-05',
    q: 'A teammate proposes shipping `verify=False` in the worker because "it works with `curl -k`". Explain why the course rejects this, and give the proper fix for each of the three certificate failure types.',
    rubric: ['States that `-k`/`verify=False` disables the identity check, so the worker would accept any server at that address', 'Explains that `-k` working only shows the handshake completes, not that the certificate is valid', 'Chain failure: serve the full chain on the server, or install the lab CA in the client trust store / `--cacert`', 'Expiry: reissue (and check the client clock)', 'Name mismatch: reissue with the hostname in the SANs, or use a name the certificate covers'],
    answer: '`-k` and `verify=False` tell the client to skip chain, validity and name checks, so the worker would happily send data to anything answering on that address — the handshake succeeding proves only that TLS could be negotiated, not who with. Diagnose which check failed with `openssl s_client -servername`. A missing intermediate is fixed by serving leaf plus intermediate on the proxy; an untrusted lab CA by installing that CA in the client\'s trust store or passing it with `--cacert`/`verify=path`; an expired certificate by reissuing (after checking the client clock); a name mismatch by reissuing with the right SANs or using a covered name. The client change hides a server fault permanently.',
    rationale: 'Verification is the only proof of identity in TLS; disabling it is graded as a failure regardless of outcome.',
    misconception: 'Treating certificate errors as client strictness rather than as a specific failed check with a specific fix.' });

  Q({ id: 'q-m03-g01', moduleId: 'M03', pool: 'gate', type: 'predict', difficulty: 2, objectiveIds: ['obj-m03-02'], remediation: 'les-m03-01',
    context: 'A subnet plan lists 192.168.40.130/27 for a host.',
    q: 'What are the network address, the broadcast address and the number of usable host addresses?',
    choices: ['192.168.40.128, 192.168.40.159, 30 usable', '192.168.40.0, 192.168.40.255, 254 usable', '192.168.40.128, 192.168.40.191, 62 usable', '192.168.40.130, 192.168.40.157, 27 usable'],
    a: 0, rationale: 'A /27 leaves 5 host bits: blocks of 32 in the last octet. 130 falls in 128–159; the first and last addresses are network and broadcast, leaving 30.',
    misconception: 'Confusing the prefix length with the block size, or counting the network and broadcast addresses as usable.' });
  Q({ id: 'q-m03-g02', moduleId: 'M03', pool: 'gate', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m03-04', 'obj-m03-01'], remediation: 'les-m03-05',
    context: '# from a laptop\n$ curl -s -o /dev/null -w "%{http_code}\\n" https://beacon.corp.lab/healthz\n502\n# on the proxy host 10.42.3.10\n$ nc -vz -w 2 127.0.0.1 8080\nnc: connect to 127.0.0.1 port 8080 (tcp) failed: Connection refused\n$ sudo ss -ltnp "sport = :8080"\nState  Recv-Q Send-Q Local Address:Port Peer Address:Port Process\n$ systemctl is-active beacon-api\nfailed',
    q: 'Name the failing layer and the two hosts it lies between.',
    choices: ['The connect rung between the proxy and its upstream: nothing listens on 8080 because the beacon-api unit has failed; DNS, routing, firewall and TLS to the proxy all worked', 'TLS between the laptop and the proxy: a 502 is a handshake failure', 'DNS: the laptop resolved the wrong address', 'The firewall between the laptop and the proxy is dropping packets'],
    a: 0, rationale: 'The laptop completed TLS and received an HTTP status, so everything up to the proxy works. 502 means the proxy could not get a valid response from upstream; the empty socket table and failed unit explain why. The next step is the M02 ladder on beacon-api.',
    misconception: 'Reading a 5xx as "the application returned an error" when the application was never reached.' });
  Q({ id: 'q-m03-g03', moduleId: 'M03', pool: 'gate', type: 'mcq', difficulty: 2, objectiveIds: ['obj-m03-03'], remediation: 'les-m03-03',
    q: '`dig +short beacon.corp.lab` returns `10.42.3.20` but the worker on the same host keeps connecting to `10.42.3.10`, and `getent hosts beacon.corp.lab` prints `10.42.3.10`. What explains the difference?',
    choices: ['An `/etc/hosts` entry (consulted first by nsswitch) overrides DNS for applications; `dig` queries DNS directly and never reads it', 'The worker has its own DNS cache that must be restarted', '`dig` and `getent` use different DNS servers by default', 'The record has two addresses and clients pick randomly'],
    a: 0, rationale: 'Applications resolve through the system resolver (`/etc/nsswitch.conf` order, hosts file first); `dig` speaks DNS only. A stale hosts entry produces exactly this split.',
    misconception: '`dig` is assumed to show what applications see; it bypasses the hosts file and nsswitch.' });
  Q({ id: 'q-m03-g04', moduleId: 'M03', pool: 'gate', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m03-05'], remediation: 'les-m03-05',
    context: '$ curl -sS https://beacon.corp.lab/healthz\ncurl: (60) SSL: no alternative certificate subject name matches target host name \'beacon.corp.lab\'\n$ openssl s_client -connect 10.42.3.10:443 -servername beacon.corp.lab </dev/null 2>/dev/null | openssl x509 -noout -subject -ext subjectAltName -dates\nsubject=CN = beacon.corp.lab\n    DNS:api.corp.lab\nnotBefore=Oct 13 08:00:00 2026 GMT\nnotAfter=Jan 11 08:00:00 2027 GMT',
    q: 'The CN is correct. Why does verification fail, and what is the proper fix?',
    choices: ['Modern clients match the hostname against the SAN extension only, which lists just `api.corp.lab`; reissue the certificate with `beacon.corp.lab` in its SANs (or have clients use `api.corp.lab`)', 'The certificate is expired; reissue it', 'The intermediate is missing; serve the full chain', 'The client lacks the lab CA; install it'],
    a: 0, rationale: 'The error names the check: no SAN matches. The CN is ignored by current clients, the dates are valid, and the chain is not what failed. The fix is a certificate that covers the names clients use.',
    misconception: 'Believing a matching Common Name is sufficient; only Subject Alternative Names count.' });
  Q({ id: 'q-m03-g05', moduleId: 'M03', pool: 'gate', type: 'explain', difficulty: 2, objectiveIds: ['obj-m03-01'], remediation: 'les-m03-04',
    q: 'Beacon\'s workers sit in a private subnet behind source NAT. Explain three operational consequences of that for reaching the registry and for being reached, and what mechanism each one needs.',
    rubric: ['The registry sees the gateway\'s address for every worker (shared identity, allow-lists and rate limits apply to one address)', 'Inbound connections to a worker are impossible without destination NAT or a load balancer forwarding to it', 'Idle connections are forgotten by the connection-tracking table after a timeout, so long-lived connections need keepalives', 'Names the mechanism: conntrack/masquerade for outbound, DNAT or a load balancer for inbound'],
    answer: 'Outbound, the gateway rewrites each worker\'s source address to its own and keeps a connection-tracking entry so replies map back; the registry therefore logs one address for all workers, and any allow-list or rate limit applies to the whole fleet at once. Inbound, nothing outside can open a connection to a private address — there is no conntrack entry for a new SYN — so reaching a worker needs destination NAT (port forwarding) or a load balancer with a reachable address forwarding to it. The tracking entries expire when idle, so a long-lived database or websocket connection through the NAT must send keepalives more often than the idle timeout or it will be reset mid-life.',
    rationale: 'Understanding NAT as a rewrite plus a state table explains the logs, the reachability and the idle resets at once.',
    misconception: 'Treating NAT as transparent; it changes identity, direction and connection lifetime.' });

  /* ═══ M04 ═══════════════════════════════════════════════════════ */
  Q({ id: 'q-m04-b01', moduleId: 'M04', pool: 'bank', type: 'predict', difficulty: 1, objectiveIds: ['obj-m04-01'], remediation: 'les-m04-01',
    context: 'def add_sensor(sensor, seen=[]):\n    seen.append(sensor)\n    return seen\n\nprint(add_sensor("s-1"))\nprint(add_sensor("s-2"))',
    q: 'What do the two print calls output?',
    choices: ['`[\'s-1\']` then `[\'s-1\', \'s-2\']`: the default list is created once and shared by every call', '`[\'s-1\']` then `[\'s-2\']`', 'A `TypeError` on the second call', '`[\'s-1\']` twice'],
    a: 0, rationale: 'Default argument values are evaluated at function definition, so a mutable default persists across calls. Use `seen=None` and create the list inside the function.',
    misconception: 'Expecting the default to be re-created on every call, as it would be in some other languages.' });
  Q({ id: 'q-m04-b02', moduleId: 'M04', pool: 'bank', type: 'mcq', difficulty: 1, objectiveIds: ['obj-m04-01', 'obj-m04-06'], remediation: 'les-m04-01',
    q: 'You need to drop records whose sensor id has already been seen while streaming a million records. Which container holds the seen ids, and why?',
    choices: ['A set: membership tests are constant time, so the whole pass stays O(n)', 'A list: `append` is cheap and order is kept', 'A dict mapping id to the whole record, so nothing is lost', 'A tuple: it is immutable so it cannot be corrupted'],
    a: 0, rationale: 'The question is membership, not order or payload. A list makes each check walk every previous id (quadratic overall); a dict works but stores values nobody needs.',
    misconception: 'Reaching for a list by habit; `in` on a list is a linear scan.' });
  Q({ id: 'q-m04-b03', moduleId: 'M04', pool: 'bank', type: 'predict', difficulty: 1, objectiveIds: ['obj-m04-02'], remediation: 'les-m04-02',
    context: '$ head -2 status.jsonl\n{"sensor": "s-1", "status": "ok"}\n{"sensor": "s-2", "status": "degraded"}\n$ python3 -c "import json; print(len(json.load(open(\'status.jsonl\'))))"',
    q: 'What happens when the one-liner runs?',
    choices: ['`json.JSONDecodeError: Extra data` after the first object: the file is JSON lines, so it must be read line by line with `json.loads`', 'It prints `2`', 'It prints `1` because only the first line is valid', 'It hangs waiting for the closing bracket'],
    a: 0, rationale: '`json.load` expects exactly one document. The second line is extra data. JSON-lines files are iterated line by line and parsed per line, tolerating blank and torn lines.',
    misconception: 'Treating `.jsonl` and `.json` as the same format.' });
  Q({ id: 'q-m04-b04', moduleId: 'M04', pool: 'bank', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m04-02'], remediation: 'les-m04-02',
    context: '$ beacon-report status.jsonl --format csv > summary.csv\n$ head -3 summary.csv\nline 48213: skipped (Unterminated string starting at)\nstatus,count\nok,91244\n$ grep -n "skipped" beacon_report.py\n71:            print(f"line {n}: skipped ({e.msg})")',
    q: 'Why is the warning inside the CSV, and what is the fix?',
    choices: ['`print()` writes to stdout, the data channel; send diagnostics to stderr (`print(..., file=sys.stderr)` or `logging` configured on stderr) so redirected output contains only data', 'The CSV writer needs `newline=""`', 'The redirect should be `2>` instead of `>`', 'The warning should be suppressed with `except: pass`'],
    a: 0, rationale: 'Only stdout is redirected into the file, and the warning was printed there. Separating data (stdout) from messages (stderr) is what makes a tool usable in a pipeline; suppressing the warning would hide the skipped line.',
    misconception: 'Thinking the destination of a message does not matter as long as the operator sees it.' });
  Q({ id: 'q-m04-b05', moduleId: 'M04', pool: 'bank', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m04-04', 'obj-m04-02'], remediation: 'les-m04-03',
    context: '# cron: 0 * * * *  /opt/beacon/bin/beacon-report /var/lib/beacon/status.jsonl --format json > /var/lib/beacon/summary.json\n$ ls -l /var/lib/beacon/summary.json\n-rw-r--r-- 1 beacon beacon 0 Oct 13 14:00 /var/lib/beacon/summary.json\n$ sed -n 60,70p /opt/beacon/bin/beacon-report\n    try:\n        summary = summarise(read_jsonl(f, log))\n        write_output(summary, args.format)\n    except Exception:\n        pass\n    return 0',
    q: 'The summary file has been empty for six hours and nothing alerted. What is the cause and the correct shape of the fix?',
    choices: ['The broad `except Exception: pass` swallows whatever failed and `main()` returns 0, so cron sees success; catch specific errors, log the rest with `log.exception`, and return non-zero', 'Cron cannot write to `/var/lib/beacon`; run it as root', 'The file is overwritten before it is written; use append mode', '`summarise` returns `None` on weekends'],
    a: 0, rationale: 'An exit code of 0 is the only thing cron reads. Swallowing the exception produced an empty file and a success status; the fix is to make failures loud: specific handlers, a top-level handler that logs the traceback, and a non-zero return.',
    misconception: '"It does not crash" is mistaken for "it works"; silent failure with exit 0 is worse than a traceback.' });
  Q({ id: 'q-m04-b06', moduleId: 'M04', pool: 'bank', type: 'mcq', difficulty: 2, objectiveIds: ['obj-m04-04'], remediation: 'les-m04-03',
    q: 'While parsing 90,000 JSON-lines records, one line fails to parse. Which handling matches "handle failure deliberately"?',
    choices: ['Skip the line, count it, log a WARNING with the line number, and after output exit non-zero if the count exceeds a documented threshold', 'Abort immediately with a traceback: any bad input invalidates the run', 'Skip it silently; one line out of 90,000 does not matter', 'Replace it with an empty record so the counts stay the same'],
    a: 0, rationale: 'One malformed record should not discard the other 89,999, but it must be visible and bounded. Counting plus a threshold gives both the data and an honest verdict.',
    misconception: 'Treating skip and swallow as the same thing; skipping without counting and reporting is swallowing.' });
  Q({ id: 'q-m04-b07', moduleId: 'M04', pool: 'bank', type: 'predict', difficulty: 2, objectiveIds: ['obj-m04-03'], remediation: 'les-m04-04',
    context: '# spec: a record is stale when it is strictly older than max_age_s\n# broken variant:  return now - record_ts >= max_age_s\n# solution:        return now - record_ts >  max_age_s\n\nclass StalenessTests(unittest.TestCase):\n    def test_old_record_is_stale(self):\n        self.assertTrue(is_stale(record_ts=1000, max_age_s=60, now=2000))',
    q: 'Run this test against the broken variant and against the solution. What happens, and what does that say about the test?',
    choices: ['It passes on both: 1000 seconds is far past the boundary, so the test cannot tell `>` from `>=`; a boundary case (`now=1060` must not be stale) is needed', 'It fails on the broken variant and passes on the solution, as intended', 'It fails on both because `now` is not a real timestamp', 'It errors because `is_stale` needs a real clock'],
    a: 0, rationale: 'A test proves its worth by failing on the broken code. Testing a comfortable middle value cannot detect an off-by-one; the injected `now` makes the exact boundary testable.',
    misconception: 'Equating a passing test with coverage of the rule it was written for.' });
  Q({ id: 'q-m04-b08', moduleId: 'M04', pool: 'bank', type: 'diagnose', difficulty: 3, objectiveIds: ['obj-m04-05'], remediation: 'les-m04-05',
    context: '02:10:31 WARNING POST https://beacon.corp.lab/v1/readings: Timeout; retry 1/4 in 0.7s\n02:10:32 INFO    posted 200 readings (attempt 2)\n\nbeacon=# SELECT sensor, ts, count(*) FROM readings WHERE ts BETWEEN \'02:10\' AND \'02:14\' GROUP BY 1,2 HAVING count(*) > 1 LIMIT 1;\n sensor | ts       | count\n s-17   | 02:10:30 |     2',
    q: 'Why are the readings duplicated, and which fix is correct?',
    choices: ['The first POST was processed but its response timed out; the client retried a non-idempotent request and the server inserted again. Do not retry POSTs unless the API supports an idempotency key (or a unique constraint on sensor+ts)', 'The retry delay was too short; raise the backoff base', 'The server has a bug that double-inserts; nothing to change in the client', 'The timeout was too short; raise it to 60 s and keep retrying'],
    a: 0, rationale: 'A timeout means no response arrived, not that nothing happened. Retrying is safe only for idempotent requests; a POST that creates records needs a de-duplication mechanism before it can be retried.',
    misconception: 'Believing a timed-out request had no effect, and that retry logic is a property of the client alone.' });
  Q({ id: 'q-m04-b09', moduleId: 'M04', pool: 'bank', type: 'order', difficulty: 2, objectiveIds: ['obj-m04-05'], remediation: 'les-m04-05',
    q: 'Order the decisions a safe retry wrapper makes for one failed request.',
    steps: ['Check the request is idempotent (GET/PUT/DELETE, or POST with an idempotency key); otherwise raise without retrying', 'Classify the failure: connection error, timeout, 429, 502, 503, 504 are retryable; 4xx like 400/401/403/404 are not', 'Check the attempt count and overall deadline have not been exhausted; if they have, raise with the reason', 'Compute the delay: exponential backoff capped, with jitter, honouring Retry-After if present', 'Log the retry at WARNING with URL, reason and attempt number — never headers or tokens', 'Sleep and retry'],
    rationale: 'Idempotency first (it decides whether retrying is allowed at all), then whether this failure is retryable, then the bound, then the delay, then an honest log line, then the retry.',
    misconception: 'Starting from "how long to wait" skips the two questions that decide whether to retry at all.' });
  Q({ id: 'q-m04-b10', moduleId: 'M04', pool: 'bank', type: 'explain', difficulty: 2, objectiveIds: ['obj-m04-06'], remediation: 'les-m04-06',
    q: 'A script loads a 2 M-line JSON-lines file into a list and finds duplicate (sensor, ts) pairs with two nested loops. Explain why it is slow and memory-hungry, describe the rewrite, and state the memory bound of the rewrite in one sentence.',
    rubric: ['Identifies nested loops over the same list as O(n²) and gives a sense of scale (doubling input quadruples time)', 'Identifies the list comprehension / whole-file load as O(n) memory', 'Rewrite: stream the file with a generator and keep a set of seen keys for constant-time membership (O(n))', 'States the bound: memory grows with the number of distinct (sensor, ts) keys, not with the number of records', 'Mentions measuring (two input sizes, `/usr/bin/time -v` peak RSS) to confirm'],
    answer: 'Two loops over the same list compare every record with every later one: about n²/2 comparisons, so doubling the file quadruples the time and 2 M lines takes days. Loading every line into a list first also makes memory proportional to the file. The rewrite reads the file line by line through a generator and keeps a set of `(sensor, ts)` keys: one pass, with a constant-time `in` check, so it is O(n) in time. Its memory grows with the number of distinct keys, not with the number of records. Confirm by timing two input sizes and reading peak RSS from `/usr/bin/time -v`.',
    rationale: 'The objective is explaining the class from the code and naming the memory bound of the streaming version.',
    misconception: 'Trusting a fast run on a small sample; quadratic code is always fast on small input.' });

  Q({ id: 'q-m04-g01', moduleId: 'M04', pool: 'gate', type: 'predict', difficulty: 2, objectiveIds: ['obj-m04-01'], remediation: 'les-m04-01',
    context: 'def reading_or_default(rec):\n    value = rec.get("value")\n    if not value:\n        return "missing"\n    return value\n\nprint(reading_or_default({"sensor": "s-1", "value": 0}))\nprint(reading_or_default({"sensor": "s-2"}))',
    q: 'What is printed, and is it correct?',
    choices: ['`missing` twice; wrong: a reading of 0 is valid data but is falsy, so the test must be `if value is None`', '`0` then `missing`; correct', '`0` then `None`; correct', 'A `KeyError` on the second call'],
    a: 0, rationale: '`not value` is true for `None`, `0`, `""` and `[]` alike. When zero is a legitimate reading, test for `None` explicitly.',
    misconception: 'Using truthiness as a presence test.' });
  Q({ id: 'q-m04-g02', moduleId: 'M04', pool: 'gate', type: 'diagnose', difficulty: 2, objectiveIds: ['obj-m04-05', 'obj-m04-04'], remediation: 'les-m04-05',
    context: '$ systemctl status beacon-worker --no-pager | head -3\n● beacon-worker.service - Beacon worker\n     Active: active (running) since Mon 2026-10-13 01:58:12 UTC; 4h 20min ago\n$ journalctl -u beacon-worker --since "4 hours ago" -n 1 --no-pager\nOct 13 02:11:04 node1 beacon-worker[5102]: fetching page 3 of readings\n$ sudo ss -tnp "( dport = :443 )" | grep 5102\nESTAB 0 0 10.42.3.77:51234 10.42.3.21:443 users:(("python",pid=5102,fd=6))\n$ grep -n "client.get" /opt/beacon/worker.py\n88:        resp = client.get(url, params=params, headers=headers)',
    q: 'The worker has been "running" for four hours with no output since 02:11. What happened?',
    choices: ['The GET has no timeout: the server accepted the connection and never answered, so the worker blocks forever on the read while looking healthy; pass `timeout=(connect, read)` and treat the timeout as retryable', 'The server is rate limiting; add a longer backoff', 'The worker was OOM-killed; check the kernel log', 'The page token loop is spinning; add loop detection'],
    a: 0, rationale: 'An established connection with no traffic, a last log line from the fetch, and a `get` call without `timeout=` together say the client is waiting indefinitely. A spinning loop would log pages; an OOM kill would not be "active (running)".',
    misconception: 'Assuming HTTP libraries time out by default; most do not.' });
  Q({ id: 'q-m04-g03', moduleId: 'M04', pool: 'gate', type: 'mcq', difficulty: 2, objectiveIds: ['obj-m04-03'], remediation: 'les-m04-04',
    q: 'You want a unit test proving the retry helper waits 0.5, 1 and 2 seconds between attempts, and the suite must stay fast and deterministic. Which approach?',
    choices: ['Inject a fake `sleep` (and a deterministic `rng`) into the helper and assert the recorded delays equal `[0.5, 1, 2]`', 'Call the helper against a local server that returns 503 and time the run with `perf_counter`', 'Set the base delay to 0 in the test so it runs fast', 'Mark the test as slow and run it only before releases'],
    a: 0, rationale: 'Injected dependencies make time an input: the test observes what the code asked for without waiting. Zeroing the delay removes the behaviour under test; a real server adds time and flakiness.',
    misconception: 'Believing tests of time-dependent code must take real time.' });
  Q({ id: 'q-m04-g04', moduleId: 'M04', pool: 'gate', type: 'predict', difficulty: 2, objectiveIds: ['obj-m04-06'], remediation: 'les-m04-06',
    context: '$ /usr/bin/time -f "%e s, %M KB" python3 dedupe.py sample-100k.jsonl\n10.2 s, 412000 KB\n$ /usr/bin/time -f "%e s, %M KB" python3 dedupe.py sample-200k.jsonl\n40.9 s, 820000 KB',
    q: 'What do the two runs tell you about time and memory, and what construct do you look for?',
    choices: ['Time quadrupled when input doubled (quadratic) and peak memory doubled (the whole file is loaded); look for a nested loop or list membership test, and for `read()`/`readlines()`/`json.load` or a list built from the file', 'Both doubled; the tool is O(n) and healthy', 'Time is I/O-bound; a faster disk fixes it', 'Memory is bounded by the number of sensors; only time is a problem'],
    a: 0, rationale: 'Two sizes give the growth class directly: 4× time for 2× input is O(n²); 2× peak RSS for 2× input means memory tracks the input rather than the aggregate.',
    misconception: 'Reading absolute numbers instead of growth between sizes.' });
  Q({ id: 'q-m04-g05', moduleId: 'M04', pool: 'gate', type: 'explain', difficulty: 2, objectiveIds: ['obj-m04-04', 'obj-m04-02'], remediation: 'les-m04-03',
    q: 'Propose the exit-code table for `beacon-report` and explain why a tool that prints `ERROR: ...` and exits 0 is worse than one that crashes with a traceback.',
    rubric: ['0 only when the output can be trusted; 1 for input/dependency failures reported on stderr; 2 for usage errors (argparse convention); 130 for interrupt; any extra code documented', 'Explains that schedulers, pipelines and systemd read only the exit status, so a message with exit 0 is invisible to automation', 'Explains that a traceback with non-zero status is honest and actionable, while exit 0 with bad output is trusted downstream', 'Mentions returning the code from `main()` and `sys.exit(main())`'],
    answer: 'Use 0 for "the output can be trusted", 1 for failures the operator can act on (missing or unreadable input, dependency unreachable, skipped records above the threshold) with one line on stderr, 2 for usage errors as argparse already does, and 130 when interrupted; document the table in the README and return the code from `main()` via `sys.exit(main())`. A tool that prints ERROR and exits 0 tells cron, the pipeline and systemd that everything is fine, so empty or wrong output is consumed as truth and nobody is alerted. A traceback with a non-zero exit is ugly but honest: automation stops, and the message points at the line.',
    rationale: 'Exit codes are the tool\'s contract with everything that calls it; the message is for humans only.',
    misconception: 'Judging a tool by what it prints rather than what it returns.' });

  /* review prompts for M02–M04 (changed symptoms and short recall, not the same items) */
  LX.sreReviews.push(
    { id: 'rev-m02-01', objectiveIds: ['obj-m02-04'], kind: 'changed-symptom', prompt: 'Beacon logs `No space left on device` but `df -h` shows 40% used. What is the next command and what will it show?', answer: '`df -i` on that path; expect `IUse%` at or near 100%: the inode table is exhausted by many small files. Free file count, not bytes.' },
    { id: 'rev-m02-02', objectiveIds: ['obj-m02-01'], kind: 'recall', prompt: 'Without looking: what do `status=203/EXEC`, `status=217/USER` and `status=200/CHDIR` each mean, and did Beacon run in any of them?', answer: 'systemd could not execute `ExecStart=` (path/interpreter/mode), the `User=` does not exist, the `WorkingDirectory=` does not exist. Beacon ran in none of them.' },
    { id: 'rev-m02-03', objectiveIds: ['obj-m02-05', 'obj-m02-02'], kind: 'changed-symptom', prompt: 'The proxy now gets `Connection timed out` (not refused) to Beacon on 8080, and `ss -ltnp` on the Beacon host shows `0.0.0.0:8080` owned by python. Is the socket the fault?', answer: 'No. The listener is on all interfaces; a timeout means packets are not arriving or replies not returning — a firewall drop or routing fault between the hosts, not the socket.' },
    { id: 'rev-m03-01', objectiveIds: ['obj-m03-04'], kind: 'changed-symptom', prompt: 'Yesterday the request to `beacon.corp.lab:443` was refused in 2 ms; today it times out after 30 s from the same client. Which hypotheses changed?', answer: 'Yesterday: reachable host, nothing listening on that address:port. Today: silence — a firewall drop, a routing change, or the host gone. The listener is no longer the first suspect; check `ip route get`, `traceroute` and firewall rules.' },
    { id: 'rev-m03-02', objectiveIds: ['obj-m03-02'], kind: 'recall', prompt: 'Without looking: how many addresses and how many usable hosts are in a /26, and which block does 10.42.3.77/26 belong to?', answer: '64 addresses, 62 usable; block size 64 in the last octet, so 10.42.3.64/26 (64–127), broadcast 10.42.3.127.' },
    { id: 'rev-m03-03', objectiveIds: ['obj-m03-05'], kind: 'changed-symptom', prompt: 'The certificate verified fine yesterday; today one worker reports `certificate has expired` while the others are fine, and the certificate\'s `notAfter` is next year. What do you check on that worker?', answer: 'Its clock (`date -u`, `timedatectl`): a client clock outside the validity window produces the expiry error with a valid certificate. Fix time sync, not the certificate.' },
    { id: 'rev-m04-01', objectiveIds: ['obj-m04-05'], kind: 'recall', prompt: 'Without looking: which HTTP statuses and client errors does the safe client retry, which does it never retry, and which request methods may it retry at all?', answer: 'Retry connection errors, timeouts, 429 (honour Retry-After), 502, 503, 504; never 400/401/403/404/422. Only idempotent methods (GET, HEAD, PUT, DELETE) or a POST carrying an idempotency key.' },
    { id: 'rev-m04-02', objectiveIds: ['obj-m04-04', 'obj-m04-02'], kind: 'changed-symptom', prompt: 'The nightly report now prints `WARNING: skipped 1 line` and exits 1, and the on-call page fires every night for one torn log line. Is the tool wrong?', answer: 'The threshold is wrong, not the mechanism: one skipped line should be tolerated (`--max-skipped` above 0) while still being counted and logged; exit non-zero only when the count exceeds the documented limit.' },
    { id: 'rev-m04-03', objectiveIds: ['obj-m04-06'], kind: 'recall', prompt: 'State in one sentence the memory bound of a streaming "latest record per sensor" tool, and name the one call that would silently break it.', answer: 'Memory grows with the number of distinct sensors, not with the number of records; `list(...)`/`readlines()`/`json.load` on the whole file (or `sorted()` over all records) loads everything and breaks the bound.' }
  );
})();
