# L27 notes

## Saturation point

The step test you ran (rates and duration), the goodput at each step, and the offered rate at
which goodput stopped rising. Name the number (requests/s) and what /stats and the database
showed at that point (busy workers, waiting requests, what the database sessions were waiting on).

## Bottleneck

What limits the write path, with the evidence (a query, a counter, a log line), and why it is
there rather than in the API.

## Replicas

What you changed, the goodput and errors you measured with more than one api replica, and why
the result is what it is.

## Limits and retries

The server limits and client policy you chose, the reasoning for each value, and the before and
after numbers (goodput, success rate, p99, amplification, duplicates).

## What would raise capacity

The change that would remove the bottleneck rather than queue in front of it, what it costs,
and how you would prove it worked.
