# L03 — Beacon under systemd: unit, user, journal, socket

Module M02 · ~100 min practical (two sessions) · profile `linux-arm64` · runs **inside the course VM**

## Ticket

> Beacon has been given a proper systemd unit on the lab host so it survives reboots. After
> `systemctl start beacon` the unit goes straight to `failed`. The team wants it running **as
> the `beacon` user**, reading `/etc/beacon/beacon.yaml`, listening on 8080 — and they want
> to know what each line of the unit does, because nobody wrote that down either.

## Objectives

- `obj-m02-01` run and diagnose a systemd service; explain each directive
- `obj-m02-02` isolate host versus application failure from process, journal and socket evidence
- `obj-m02-03` fix a permission or path fault narrowly (no `chmod 777`, no running as root)
- `obj-m02-05` map the listening socket to its process and configuration

## What is fixture-controlled

`inject.sh` breaks the installed unit in one of two ways (`LOOPED_VARIANT=variant-a|variant-b`):
a wrong `ExecStart`/working-directory combination, or a configuration file the service user
cannot read. The Beacon code is untouched. The VM itself is healthy.

## Steps and checkpoints

**Checkpoint c1 — install, read, reproduce (week 3, session 2).**

1. `sudo bash labs/sre-cloud-foundations/L03/setup.sh` — installs `/opt/beacon` (code),
   `/etc/beacon/beacon.yaml` (config), `/var/lib/beacon` (state), the `beacon` user, and the
   unit at `/etc/systemd/system/beacon.service`; then injects the fault.
2. `systemctl cat beacon` and read every directive against lesson les-m02-03. Write one line
   per directive in `evidence/L03-diagnosis.md` (template in `assets/`).
3. Reproduce: `sudo systemctl start beacon; systemctl status beacon --no-pager`;
   `journalctl -u beacon -n 20 --no-pager`. Quote the FATAL line.

**Checkpoint c2 — discriminate, fix narrowly, prove the user and the socket (session 3).**

4. Hypotheses and the discriminating check (e.g. `sudo -u beacon cat /etc/beacon/beacon.yaml`,
   `systemctl show beacon -p ExecStart -p WorkingDirectory -p User`, `namei -l /etc/beacon/beacon.yaml`).
5. Fix the smallest thing: a path in the unit, or the ownership/mode of exactly the file the
   service user needs (`chown root:beacon` + `640`, or `644` if nothing in it is sensitive).
   `systemctl daemon-reload` after editing a unit. Then `systemctl restart beacon`.
6. Prove it: `systemctl is-active beacon`; `ps -o user=,pid=,cmd= -p "$(systemctl show beacon -p MainPID --value)"`
   shows user `beacon`; `ss -ltnp | grep :8080` shows that PID; `curl -s 127.0.0.1:8080/healthz` → `ok`.
7. `python3 labs/sre-cloud-foundations/L03/validate.py --out labs/sre-cloud-foundations/L03/evidence/latest.json --explanation-file labs/sre-cloud-foundations/L03/evidence/L03-diagnosis.md`

## What you should observe

- `Active: failed (Result: exit-code)` with `status=1/FAILURE` from the main process: the
  application exited deliberately. Variant-specific: `FATAL config: open … permission denied`
  (the file exists; the *user* cannot read it) or a Python `No module named beacon` /
  `open … no such file` line (the process started in the wrong place).
- `Restart=on-failure` with `RestartSec=2` means the journal fills with the same line every two
  seconds until systemd gives up (`start-limit-hit`): one more reason to read, not restart.
- After the fix: the main PID belongs to user `beacon`, the socket on `0.0.0.0:8080` is owned by
  that PID, and the config file is still not world-readable.

## Pause / resume

State is the unit file and `/etc/beacon`. `reset.sh` re-injects the same variant; your notes
stay.

## Lab versus production

Production units add resource limits, sandboxing and socket activation; the diagnosis path
(status → journal → show → reproduce as the service user) is the same. In containers, the
"unit" is the image entrypoint and the "service user" is `USER` in the Dockerfile (L13).

## Limits

One unit on one VM. It proves you can read a unit, a journal and a socket table and fix a
permission or path fault narrowly. It does not prove multi-service dependency ordering or
anything about production load.

## References

- T15 systemd documentation (`systemd.service(5)`, `systemd.exec(5)`, `journalctl(1)`)
