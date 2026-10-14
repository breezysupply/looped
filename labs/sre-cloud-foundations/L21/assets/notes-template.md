# L21 notes

> Replace the prompts under each heading with your own words. The rubric in README.md grades them.

## Signals

For this incident, what did each signal answer that the others could not: the metric, the trace,
the log line? Name the query, the trace id and the log field you used.

## Latency source

Your two hypotheses for the slow sensor page, the evidence that separated them (RED on the route,
the dependency histogram, CPU, the slow trace's spans), and the change you made.

## Cardinality

What BEACON-1987 did to the number of series, how you counted them, and where the per-user
information lives now that it is not a label.

## Correlation

How one request is followed from the API's log line to its trace, into the worker, and to a
metric exemplar. What had to change for the worker to join the trace?

## Dashboard

What each panel shows, why the latency panels use rate() inside histogram_quantile(), and what
the dashboard would still miss.
