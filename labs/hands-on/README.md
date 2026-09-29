# Hands-on scenarios (real practice cluster)

The scenarios themselves live in the app: **Gallatin Onsite → Learn › Prep → Hands-on**
(data: `assets/js/data/onsite-handson.js`). They are original exercises covering the
fundamentals the team's preparation note named — finding your way around a cluster,
deploying and running an app, exposing it outside the cluster, updating and rolling back,
configuring, and troubleshooting — written for:

- the [Killercoda Kubernetes playground](https://killercoda.com/playgrounds/scenario/kubernetes), or
- [Docker Desktop's built-in Kubernetes](https://docs.docker.com/desktop/features/kubernetes/).

Rules every scenario follows:

- Check `kubectl config current-context` first. Never run them against a work cluster.
- Everything happens in a namespace called `practice`; every command that changes something
  names it with `-n practice`. `kubectl delete namespace practice` removes it all.
- Each scenario starts with a "start fresh" block (Killercoda sessions are time-limited) and
  ends with a copy-paste check that prints PASS or FAIL.
- Looped cannot see your cluster, so completion in the app is self-reported.

`validate.js` is a development tool, not something you need: it plays every scenario against
the kind lab cluster from `labs/kind/` and checks each task's output. What it found is in
[VALIDATION.md](VALIDATION.md).
