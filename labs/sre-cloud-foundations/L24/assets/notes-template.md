# L24 notes

> Replace the prompts under each heading with your own words. The rubric in README.md grades
> them; validate.py checks the measurements against real state.

## Backup inspection

Which backup files did you find, how did you check each one before trusting it (`pg_restore --list`,
a test restore, sizes, checksums), and what did you find wrong?

## Restore and verification

The commands you ran, the fresh target you restored into, and the verify_restore.py result
(counts, checksums, selected values, sequences). Why is "pg_restore exited 0" not proof?

## Recovery interval, RPO and RTO

Your measured interval (start to verified). If the source had been lost at the moment you
started, which backup would you have restored, how much data would be gone (RPO), and does
this lab meet RPO 15 min / RTO 60 min (design D04)? Say honestly what was not measured.

## Duplicate deliveries

What the evidence showed (ledger rows per key, job attempts, the worker's restart count), and
the two ways a message is delivered twice here.

## Idempotency fix

What makes a second delivery of the same key impossible now, where that guarantee lives
(application check or database constraint) and why. What did you do with the duplicates that
had already happened?
