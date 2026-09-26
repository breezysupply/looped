# Lab 03 — solution

## Mechanism

A Service does not point at pods by name. The EndpointSlice controller
selects pods whose labels match **all** key=value pairs in the Service's
`spec.selector`, and publishes the ready ones as endpoints. The "label
cleanup" added `tier: backend` to the selector; the orders-api pods (from the
Deployment's template) have only `app: orders-api`, so no pod matches, the
EndpointSlice is empty, and traffic to the ClusterIP has nowhere to go. DNS
still resolves `orders` to the ClusterIP: DNS was never the problem.

## Valid fixes

1. **Correct the Service selector** (the change that broke it):

   ```sh
   kubectl --context kind-looped-onsite -n looped-lab patch service orders --type=json \
     -p '[{"op":"remove","path":"/spec/selector/tier"}]'
   ```

   and fix the manifest in version control the same way. Endpoints appear
   within seconds and storefront's next call succeeds.

2. **Add the label to the pod template**, if `tier: backend` is a label you
   actually want on those pods:

   ```sh
   kubectl --context kind-looped-onsite -n looped-lab patch deployment orders-api --type=merge \
     -p '{"spec":{"template":{"metadata":{"labels":{"tier":"backend"}}}}}'
   ```

   This triggers a rollout; new pods carry the label and match. (Do not add it
   to the Deployment's `spec.selector`: that field is immutable.)

Not durable: `kubectl label pod … tier=backend` on the running pods. It works
until the next rollout replaces them. verify.sh fails it because the template
still lacks the label.

## Why this matters in an interview

Walk the request path aloud: name → DNS → ClusterIP → Service selector →
EndpointSlice → pod IP:targetPort. Each hop has a command that proves or
disproves it. "Pods are Ready" and "the Service has endpoints" are separate
facts, and the selector joins them.
