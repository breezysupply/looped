# Lab 03 — Healthy pods, but the orders Service returns nothing

Real-cluster version of simulated lab **ons-lab-03**.
Lessons: `les-services`, `les-request-path`.

## Ticket

> After this morning's "label cleanup" change to the orders Service manifest,
> storefront reports connection failures to orders. All three orders-api pods
> are Running and Ready. Someone in the channel says "it's DNS".
>
> **Impact:** storefront cannot reach orders. **Recent change:** the orders
> Service manifest (labels tidied up).

## Objective

Find the break, fix it **durably** (not in a way the next orders-api rollout
would undo), and prove requests from storefront work.

## What is simulated or simplified

- `storefront` is a busybox loop that calls `http://orders:8080/` every 3 s
  and logs the result; orders-api is a busybox web server.
- The "previous" Service is applied first so storefront's log shows the moment
  it broke.

## Steps

1. Once: `labs/kind/setup.sh`
2. Inject: `labs/kind/03-service-selector/inject.sh`
3. Investigate. Start with read-only commands:

   ```sh
   kubectl --context kind-looped-onsite -n looped-lab logs deployment/storefront --tail=10
   kubectl --context kind-looped-onsite -n looped-lab get deployment,pods -l app=orders-api -o wide --show-labels
   kubectl --context kind-looped-onsite -n looped-lab get service orders -o wide
   kubectl --context kind-looped-onsite -n looped-lab describe service orders
   kubectl --context kind-looped-onsite -n looped-lab get endpointslices -l kubernetes.io/service-name=orders -o yaml
   kubectl --context kind-looped-onsite -n looped-lab exec deployment/storefront -- nslookup orders
   ```

   Work the request path in order: does the name resolve (DNS)? to which
   ClusterIP? does that Service have endpoints? do the pods match its selector?

4. What you should observe:
   - storefront switches from `-> orders-api ok (…)` to
     `FAILED: wget: can't connect to remote host (10.96.x.x): Connection refused`
     within a few seconds of the change.
   - `nslookup orders` returns the Service's ClusterIP: DNS is working.
   - The Service's selector has two keys; the pods carry only one of them. The
     EndpointSlice for `orders` has no endpoints (`<unset>`), and
     `describe service` shows `Endpoints:` empty.
   - "Connection refused" (rather than a timeout) is what kube-proxy's rules
     typically produce for a Service with no endpoints; the exact error can
     depend on the proxy mode and CNI.
5. Fix: your call. Think about which object is the source of truth for the
   pod labels, and what happens at the next rollout.
6. Verify: `labs/kind/03-service-selector/verify.sh`
   Checks: every key=value in the Service selector is in the orders-api
   Deployment's **pod template** labels; ready endpoints = orders-api ready
   replicas; a real request from the storefront pod to `http://orders:8080/`
   returns the orders page.
7. Then read `SOLUTION.md`.
8. Reset: `labs/kind/reset.sh 03`

## Lab vs production

- Here there is one Service and one client. In production the same mistake
  can hide behind retries, a service mesh or an ingress that reports its own
  errors, so the first symptom may be a 503 from a proxy rather than
  "connection refused".
- Manually labelling running pods would make this lab's traffic flow again
  but would not survive the next rollout; verify.sh checks the template, as a
  reviewer would.

## References

- [Service](https://kubernetes.io/docs/concepts/services-networking/service/)
- [EndpointSlices](https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/)
- [Debug Services](https://kubernetes.io/docs/tasks/debug/debug-application/debug-service/)
- [DNS for Services and Pods](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/)
