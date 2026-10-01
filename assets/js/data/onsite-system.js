/* Onsite track — the System lab: one system, two rounds.

   Part 1 designs a generic customer-facing order API (ons-design-webapp).
   Part 2 hands you that same architecture as a "working system" and asks
   you to find where it can break, then troubleshoot three incidents in it
   with the interviewer holding the evidence (ons-case-09..11). Part 3 is
   optional: a small version of the same system on a real practice cluster
   (ons-hands-12).

   The system is invented for practice. It is not any company's actual
   architecture, and the incidents are not actual interview questions. */
window.LX = window.LX || {};
LX.onsiteSystems = [
  {
    id: 'ons-sys-orders', track: 'onsite', mins: 150,
    title: 'One system, two rounds: an order API from design to incident',
    intro: 'Practise the architecture round and the troubleshooting round as one exercise on one system. In part 1 you design it, aloud, against the clock. In part 2 you are handed the reference architecture — as if it were the working system an interviewer puts in front of you — and asked where it can break and what is wrong with it today. Doing them back to back trains the habit the troubleshooting round rewards: reasoning from the architecture to the evidence.',
    rounds: [
      { h: 'Part 1 · Architecture (60 min)', what: 'Design the order API: requirements first, then the request path, dependencies, scaling, failure handling, observability and delivery. The interviewer adds constraints as you go.' },
      { h: 'Part 2 · Troubleshooting (60 min)', what: 'Map the failure points and dependencies of the reference architecture (about 10 minutes), then work three incidents in it: ask for evidence, form and test hypotheses, isolate the cause, and say how you would fix and verify it.' },
      { h: 'Part 3 · Same system, real cluster (optional, ~40 min)', what: 'Deploy a three-tier version on a practice cluster, map its dependencies with kubectl, then find and fix the faults injected into it.' }
    ],
    design: 'ons-design-webapp',
    components: [
      { id: 'dns', name: 'DNS', role: 'Resolves the API\'s public name to the load balancer.', dependsOn: [], critical: true },
      { id: 'lb', name: 'Cloud load balancer', role: 'Spreads client connections across zones, health-checks its targets, terminates TLS.', dependsOn: ['dns'], critical: true },
      { id: 'ingress', name: 'Ingress controller', role: 'Routes HTTP requests to the API Service, applies timeouts and limits, emits per-route metrics.', dependsOn: ['lb'], critical: true },
      { id: 'api', name: 'API Deployment + HPA', role: 'Serves orders and catalogue requests; scales on CPU; each pod holds a database connection pool.', dependsOn: ['ingress', 'cache', 'db', 'payment', 'queue'], critical: true },
      { id: 'cache', name: 'Cache', role: 'Catalogue reads. Losing it is slower, not wrong — if the database can take the extra reads.', dependsOn: [], critical: false },
      { id: 'db', name: 'Managed database', role: 'Orders and payments. Primary, standby in another zone, read replica. Hard connection limit; firewall allow-list.', dependsOn: [], critical: true },
      { id: 'payment', name: 'Payment provider (external)', role: 'Charges the customer during order placement. Rate limits; idempotency keys.', dependsOn: [], critical: true },
      { id: 'queue', name: 'Queue', role: 'Order-placed events from the API to the workers. Ordering, retries and dead-lettering are configuration choices.', dependsOn: [], critical: false },
      { id: 'worker', name: 'Worker Deployment', role: 'Sends confirmations and writes receipts. Scales on backlog.', dependsOn: ['queue', 'db', 'storage', 'email'], critical: false },
      { id: 'storage', name: 'Object storage', role: 'Receipts and exports, accessed through workload identity.', dependsOn: [], critical: false },
      { id: 'email', name: 'Email provider (external)', role: 'Delivers confirmation emails. Rate limits.', dependsOn: [], critical: false },
      { id: 'obs', name: 'Observability', role: 'Metrics, logs and traces from everything above; SLO alerts.', dependsOn: [], critical: false }
    ],
    failureMap: {
      prompt: 'Before you open the incidents: look at the architecture and, out loud or in the box, list where this system can break. For each one say how it fails, what signal would show it, how far the damage spreads, and what guards against it. Aim for eight to ten in about ten minutes. Start from the request path, then each dependency, then the asynchronous path, then the things everything shares.',
      points: [
        { where: 'DNS and the load balancer', how: 'A bad record or TTL change, an expired certificate, or unhealthy targets in one zone.', signal: 'Client-side errors and synthetic checks fail before any request reaches the cluster; load balancer target health.', blast: 'Everything, for the clients affected.', guard: 'Managed certificates with expiry alerts, short TTLs only where needed, external synthetic checks.' },
        { where: 'Ingress controller', how: 'Too few replicas, all in one zone, or a configuration change that breaks routing.', signal: '5xx generated by the ingress itself, per-route error rate, ingress pod restarts.', blast: 'Every route behind it.', guard: 'Several replicas spread across zones, a PDB, configuration changes canaried.' },
        { where: 'API pods during a deploy', how: 'Pods receive traffic before they can serve, or are killed while still serving.', signal: 'Errors that line up with rollouts.', blast: 'A slice of traffic during every deploy.', guard: 'Readiness probes that reflect the app, a preStop delay, progressive rollout.' },
        { where: 'API autoscaling vs the database', how: 'Each new pod brings its connection pool; the total passes the database\'s connection limit.', signal: 'Connections at the limit, rejected connections, pool wait time in traces, errors only on database-backed routes.', blast: 'All database-backed routes, getting worse as the autoscaler adds pods.', guard: 'Connection budget (pool × HPA max + others < limit), a connection pooler, alert on connection utilisation.' },
        { where: 'The payment provider', how: 'Slow or rate-limited responses.', signal: 'Per-dependency latency from the API\'s side, traces with long payment spans, thread or connection exhaustion in the API.', blast: 'Order placement — and everything else on the API if slow calls hold its threads.', guard: 'Timeouts below the API\'s own deadline, retry budget with backoff, idempotency keys, circuit breaker.' },
        { where: 'The cache', how: 'Lost or flushed; every read goes to the database at once.', signal: 'Hit rate drops, database read load and latency rise.', blast: 'Catalogue latency, and the database for everyone.', guard: 'Rate-limited cache refill, request coalescing, database headroom for some cache-miss traffic.' },
        { where: 'The database itself', how: 'Primary fails, failover takes time; disk or IOPS saturates; a slow query or migration locks tables.', signal: 'Connection errors during failover, query latency, replication lag, locks.', blast: 'Every write; reads too unless served from the replica or cache.', guard: 'Multi-zone standby, tested failover, backward-compatible migrations, slow-query monitoring.' },
        { where: 'The queue and workers', how: 'A message that can never be processed is retried forever; with ordered delivery it blocks the rest.', signal: 'Age of oldest message rising, acknowledgements at zero while workers look busy.', blast: 'Every confirmation and receipt.', guard: 'Maximum receive count, dead-letter queue with an alert, idempotent consumers, schema validation at the producer.' },
        { where: 'Network paths and firewall rules', how: 'New nodes, subnets or policies that are not allowed to reach a dependency.', signal: 'Connection timeouts from some pods only; errors that follow a node, node group or zone.', blast: 'Whatever runs in the affected placement — growing as workloads move.', guard: 'Allow-lists generated from the same code as the node groups, connectivity preflights, errors split by node group.' },
        { where: 'A whole zone', how: 'Loss of a zone takes nodes, pods and possibly the database primary with it.', signal: 'Load balancer target health, node conditions, errors grouped by zone, database failover events.', blast: 'A third of capacity at once, plus failover time.', guard: 'Spread across zones, headroom so two zones carry peak, PDBs that do not block rescheduling, game days.' },
        { where: 'Observability itself', how: 'The metrics or log pipeline fails, so dashboards go quiet.', signal: 'Missing data — which must alert, not read as healthy.', blast: 'You lose your eyes during an incident.', guard: 'Absence alerts, monitoring the monitoring, logs shipped off the node.' }
      ]
    },
    cases: ['ons-case-09', 'ons-case-10', 'ons-case-11'],
    debrief: [
      'Did you start each incident from scope and recent changes, then follow the request path on the architecture?',
      'When the dependency\'s own dashboard was green, did you check the hop between caller and callee — limits, configuration, network?',
      'Did you split the errors by labels (route, pod, node group, zone) before guessing?',
      'Did you contain first (stop the autoscaler, pause the drain, unblock without losing messages) before the lasting fix?',
      'Could you point at the failure map you wrote and say which point each incident was?'
    ]
  }
];
