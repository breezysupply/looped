# L17 notes — scheduling, memory, storage and disruption

<!-- Write in your own words. Quote real lines (events, describe, logs); the validator counts
     words outside comments and headings. -->

## Pending

<!-- c1: which pod was Pending, the exact FailedScheduling event, the node allocatable you
     compared it with, your fix and why it is not over-provisioning. -->

## OOM

<!-- c2: lastState / exit code / reason, the measured working set (where you read it), the
     limit and request you chose and the headroom rule behind them. Why is Pending a
     scheduling problem and OOMKilled a runtime one? -->

## Storage

<!-- c3: PVC events, the StorageClass you used and its binding mode, what you had to delete and
     why (which fields are immutable), how you restored the data, the checksum before/after.
     What does a local-path volume NOT prove about durability? -->

## Drain

<!-- c4: the first drain attempt (quote the eviction message), what the budget was protecting,
     the change you made and why it is safer than deleting the budget or forcing the drain,
     the completed attempt. -->
