#!/bin/sh
# Exit 0 if the local service answers its readiness endpoint within 2s.
exec curl -fsS --max-time 2 http://127.0.0.1:8080/healthz/ready >/dev/null
