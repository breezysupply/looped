# L03 worked solution

## Reading the unit

| Directive | Meaning |
|---|---|
| `User=beacon` / `Group=beacon` | the process runs as the unprivileged service user; files it needs must be readable by that user |
| `WorkingDirectory=/opt/beacon` | the current directory at start; `python3 -m beacon` imports the package from here |
| `Environment=BEACON_CONFIG=/etc/beacon/beacon.yaml` | the service's environment is *not* your shell's; this is how the config path arrives |
| `ExecStart=/usr/bin/python3 -m beacon api` | absolute binary path; the command systemd runs |
| `Restart=on-failure`, `RestartSec=2` | restart after a non-zero exit, two seconds apart, until the start limit |
| `ProtectSystem=strict`, `ReadWritePaths=/var/lib/beacon` | the filesystem is read-only to the service except the state directory |

## Variant A — wrong working directory

Journal: `python3: No module named beacon` (or `ModuleNotFoundError`). `systemctl show beacon -p
WorkingDirectory` → `/opt`. Fix: edit the unit back to `WorkingDirectory=/opt/beacon`,
`sudo systemctl daemon-reload`, `sudo systemctl restart beacon`.

## Variant B — config not readable by the service user

Journal: `FATAL config: open /etc/beacon/beacon.yaml: permission denied`. `namei -l` shows
`-rw------- root root beacon.yaml`. Fix: `sudo chown root:beacon /etc/beacon/beacon.yaml && sudo chmod 640 /etc/beacon/beacon.yaml`,
then `sudo systemctl restart beacon`. No `daemon-reload` is needed: the unit did not change.

## Proof

```
systemctl is-active beacon                               # active
ps -o user=,pid=,cmd= -p "$(systemctl show beacon -p MainPID --value)"   # beacon  1234  python3 -m beacon api
ss -ltnp | grep :8080                                    # LISTEN 0.0.0.0:8080 users:(("python3",pid=1234,...))
curl -s 127.0.0.1:8080/healthz                           # ok
```

## Rejected fixes

`chmod 777 /etc/beacon/beacon.yaml` or `chmod -R 777 /opt/beacon` fail `config-not-open` /
`no-world-writable`. `User=root` fails `runs-as-beacon`. Both "work" and both are the wrong
answer to the ticket.
