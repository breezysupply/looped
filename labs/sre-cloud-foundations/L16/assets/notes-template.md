# L16 notes — Service, EndpointSlices, configuration and probes

## The request path (fill in from your cluster)
<!-- client pod -> DNS name -> ClusterIP:80 -> EndpointSlice endpoint IP:port -> pod container port; name each object and how you saw it -->

## Probes
<!-- for startup, readiness and liveness: path, what failure does (hold off / remove from endpoints / restart), and why liveness must not check dependencies -->

## Observation
<!-- the exact symptom: command and output, quoted -->

## Hypotheses
- H1:
- H2:

## Discriminating check
<!-- the one command that separates them, and what it printed -->

## Result
<!-- the change to work/*.yaml, applied with kubectl apply, and the proof through the Service -->
