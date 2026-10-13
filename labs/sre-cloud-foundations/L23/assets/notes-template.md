# L23 notes

> Replace the prompts under each heading with your own words. validate.py reads the
> Blocker section for the pid you identified; the rest is graded by the rubric in README.md.

## Plan before

Paste `EXPLAIN (ANALYZE, BUFFERS)` for the ticket query before any change. Name the scan node,
the rows it read, the rows it returned, and the execution time.

## Plan after

The same EXPLAIN after your index. What node replaced the scan, and how much work did it save?

## Why this index

Which columns, in which order, and why that order serves this query (equality first? range or
sort column second?). What does the index cost on writes?

## When an index would not help

Name one query on this table where an index would not help (or would be ignored) and why.

## Blocker

blocker_pid: <the pid you identified>

How you identified it (the query, the lock mode, the wait event), and why the other long-running
session was NOT the problem.

## Pool saturation

What the API's pool was doing while the lock was held: connections in use, threads waiting,
acquire timeouts. Why does a lock wait in the database look like "pool exhausted" in the API?

## Action and why not more

The single action you took, what happened to the blocked writes afterwards, and why restarting
the database or terminating every long-running session would have been worse.
