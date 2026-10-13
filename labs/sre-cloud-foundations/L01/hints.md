# L01 hints (four rungs; rungs 3–4 end independent credit for this attempt)

1. **Boundary.** The application itself printed a FATAL line and exited on purpose. That rules
   out the kernel, the network and the VM. The fault is in what the process was given: where
   it started, or what environment it saw.
2. **Evidence source.** Read the launcher script line by line — every line before `exec` is
   environment the process inherits. Compare the path in the error with `ls -l` of the real
   file. For a "required setting" error, look for where that setting was supposed to come from.
3. **Discriminating command.** Variant with a path error: `cd / && ls config/beacon.yaml`
   versus `ls /opt/beacon-l01/config/beacon.yaml`. Variant with a missing setting:
   `grep -n BEACON_ /opt/beacon-l01/env` versus `grep -n env /opt/beacon-l01/run-beacon.sh`.
4. **Root cause and fix.** Path variant: the launcher does `cd /` and then uses a relative
   config path, so it resolves to `/config/beacon.yaml`; fix by starting in
   `/opt/beacon-l01` (or an absolute `--config`). Setting variant: the config asks for
   PostgreSQL and the URL lives in `./env`, which the launcher never sources; fix by
   `set -a; . /opt/beacon-l01/env; set +a` before `exec` (or switch the lab config back to
   sqlite if that is the intended store — say which in your notes).
