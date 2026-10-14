# Final assessment incident report (L32)

Sanitised: no keys, passwords, tokens or customer data. Times in UTC (ISO 8601). Every claim
points at evidence: a file under report/evidence/, a command and its quoted output, or a path in
this repository. This is lab experience on a local environment; describe it as such.

## Summary

[three sentences: what broke, what you did, what is still open]

## Timeline

[at least six time-stamped lines: detection, each hypothesis tested, each change, verification]

## Fault 1

[lab and variant from report/draw.json; symptom; evidence; root cause; minimal fix; how verified]

## Fault 2

[same structure]

## Combined incident

[the two faults you found on the L31 rebuild, how you separated them, in which order you fixed
them and why]

## Data and recovery decision

[what data was affected, the recovery options (full restore, selective restore, accept loss),
the point you chose, what each option would lose, how many records, and the proof]

## Verification

[service checks and data checks after recovery, with output]

## Least privilege

[the auth can-i matrix after recovery; any access you added and removed]

## Cleanup

[exactly what you removed, scoped to which labs/namespaces, and what you kept]

## Follow-ups

[owned, prioritised actions]
