# L25 notes

Never paste a credential value here. Use fingerprints (the 12-hex value the
consumers log) when you need to say which credential something used.

## Rotation plan

Which consumers use the credential, where each one reads it from, the order you will change
things in, and how you will know each step worked before taking the next.

## What happened

What you observed during the rotation (log lines with fingerprints, heartbeat times), anything
that broke, why, and what you changed.

## Revocation proof

How you showed the old credential is rejected (which check, which error/SQLSTATE).

## Triage summary

One line per finding: decision and the deciding fact. Which findings would block the release
and which would not, and why.

## Patch and SBOM

What changed in the lock (old -> new pins, where the hashes came from), the test result, and
how you confirmed that the SBOM describes the image you built rather than the lock you hoped
you built.
