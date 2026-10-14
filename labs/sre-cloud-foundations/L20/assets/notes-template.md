# L20 notes — gated delivery, digest promotion, reconciliation, schema

<!-- Quote real output (stage lines, digests, reconciler events). The validator counts words
     outside comments and headings. Say whether any evidence came from a hosted run; by default
     everything here is local-only. -->

## Gate

<!-- c1: which stage blocked which commit, the failing test and assertion, the cause, the fix
     (and why changing the test would have been the wrong fix). Which digest did the fixed run
     publish? -->

## Promotion

<!-- c2: the digest promoted to staging and prod and how you know they are the same artifact;
     what happened with the release manager's tag-based instruction; what you checked before
     promoting; who approved. -->

## Reconciler

<!-- c2: the drift the reconciler found (quote the event), what it did, why a manual fix
     disappears under GitOps, and the two legitimate ways to make an emergency change stick. -->

## Schema

<!-- c3: your decision on INC-81 with the gate's reason quoted, what an expand/contract
     migration plan would have allowed instead, and what you would do for the customers now.
     Where are the secrets, and why are none of them in git, the image or the CI logs? -->
