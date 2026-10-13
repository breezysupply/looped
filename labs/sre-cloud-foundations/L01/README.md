# L01 — The lab VM, your workspace, and a Beacon process that will not start

Module M01 · ~60 min practical · profile `linux-arm64` · runs **inside the course VM**

## Ticket

> The Beacon starter was copied onto the new lab host and "just needs starting". The launcher
> script at `/opt/beacon-l01/run-beacon.sh` fails immediately. Nobody has written down what the
> error actually says. Find out, prove the cause, fix the smallest thing, and leave notes a
> colleague could follow.

## Objectives

- `obj-m01-04` operate the disposable Linux VM and a Git workspace; record tool versions
- `obj-m01-01` separate observation from hypothesis; reproduce before you fix

## What is fixture-controlled

The launcher is broken on purpose by `inject.sh` in one of two ways chosen by the variant
seed (`LOOPED_VARIANT=variant-a|variant-b`). Nothing else on the VM is faulty. The
validator never reveals which variant is active; your hypothesis log has to.

## Steps and checkpoints

**Checkpoint c1 — VM, workspace, inventory (session 2 of week 1).**

1. On the Mac: `labs/sre-cloud-foundations/profiles/linux-arm64/vm-create.sh`, then
   `limactl shell looped-foundations` and `cd` to the repository.
2. Inside the VM: `sudo bash labs/sre-cloud-foundations/L01/setup.sh` — installs the lab copy at
   `/opt/beacon-l01`, injects the fault, and writes `evidence/L01-inventory.txt` with
   `uname -m`, the distribution and `python3 --version`. Read that file; it is your first
   evidence.
3. `git status` at the repository root: confirm the evidence directory is untracked and that
   you are on a branch of your own (`git checkout -b course/evidence` is fine).

**Checkpoint c2 — reproduce, hypothesise, discriminate, fix (session 3).**

4. Reproduce: `bash /opt/beacon-l01/run-beacon.sh`. Quote the FATAL line exactly into
   `labs/sre-cloud-foundations/L01/evidence/L01-hypotheses.md` (copy the template from
   `assets/hypotheses-template.md`).
5. Write at least two hypotheses that would each explain that exact line. Then the one
   read-only check that separates them. Run it; record the observation.
6. Make the **smallest** change to `run-beacon.sh` (or the environment it sets up) that
   addresses the surviving hypothesis. Do not move or copy the config, do not change
   permissions broadly.
7. Verify on the user path: the launcher now starts, `curl -s http://127.0.0.1:8080/healthz`
   returns `ok`, then stop it (Ctrl-C or `kill` the PID the launcher prints).
8. `python3 labs/sre-cloud-foundations/L01/validate.py --out labs/sre-cloud-foundations/L01/evidence/latest.json --explanation-file labs/sre-cloud-foundations/L01/evidence/L01-hypotheses.md`
   Paste `evidence/latest.json` into the app (Labs → L01 → Evidence).

## What you should observe

- Variant-specific: a `FATAL config: …` line naming a *relative* path, or a `FATAL config: …
  store.url is required …` line. Both are the application refusing to start on purpose and
  saying why; neither is a crash.
- The absolute file `/opt/beacon-l01/config/beacon.yaml` exists and is readable in both
  variants — which is exactly why "the file is missing" is a hypothesis to test, not a fact.
- After the fix: `beacon-api 1.4.0 listening on 0.0.0.0:8080` and a 200 from `/healthz`.

## Pause / resume

Everything lives in `/opt/beacon-l01` and your `evidence/` directory. Stop any time; `setup.sh`
is idempotent and `reset.sh` restores the broken launcher without touching your notes.

## Lab versus production

- Here the launcher is a shell script you can read; in production the equivalent is a unit
  file, a container entrypoint or an orchestrator template, and the same two hypotheses
  (where does it start, what environment does it get) still come first.
- A process refusing to start with a clear message is the good case. L03 shows the version
  where the message is in a journal you have to know how to read.

## Limits

This lab proves you can operate the VM, keep notes under version control, and reason from an
observation to a fix. It does not prove systemd knowledge (L03) or anything about production.

## References

- T12 Git documentation · T15 systemd documentation (for `WorkingDirectory=`, read ahead to L03)
