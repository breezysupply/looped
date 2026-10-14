# L04 triage notes

## Symptom
<!-- What failed, exactly (status code, error line from beacon.log), and since when. -->

## Baseline evidence (paste real output, with the command)
<!-- uptime / load average, `top -b -n1 | head -15` or `ps -eo pid,ppid,user,%cpu,%mem,cmd --sort=-%cpu | head`,
     `free -m` and /proc/pressure/*, `df -h /opt/beacon-l04/mnt`, `df -i /opt/beacon-l04/mnt` -->

## Hypotheses
- H1:
- H2:

## Discriminating evidence
<!-- The one measurement that separates them. Paste it. -->

## What I changed (and what I did not touch)
<!-- Exactly which files or which PID. Why the database, the queue and the other team's process are safe. -->

## Result
<!-- POST /status and POST /jobs status codes after the fix; df output after the fix. -->
