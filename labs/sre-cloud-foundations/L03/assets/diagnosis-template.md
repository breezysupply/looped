# L03 diagnosis

## The unit, line by line
- `User=` …
- `WorkingDirectory=` …
- `ExecStart=` …
- `Restart=` / `RestartSec=` …
- `ProtectSystem=` / `ReadWritePaths=` …

## Observation
```
(quote the FATAL / error line from journalctl -u beacon)
```

## Hypotheses
- H1:
- H2:

## Discriminating check
```
$
```

## Cause
(one sentence)

## Fix (smallest change) and verification
- change:
- `systemctl daemon-reload` needed? why / why not:
- proof the process runs as beacon:
- proof the socket belongs to that PID:
- user path: `curl -s 127.0.0.1:8080/healthz` →
