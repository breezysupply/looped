# Beacon desired state (GitOps repository for L20)

`envs/<env>/*.json` is what the reconciler applies to namespace `beacon` of the kind cluster
`looped-foundations` (JSON is valid Kubernetes manifest syntax and lets the course tooling stay
standard-library Python). `promotions/<env>.json` records which artifact each environment runs
and who approved it. Change this repository only by commit; the reconciler applies HEAD, not your
working tree. Never commit Secret values here: the Deployments reference Secrets by name.
