/* SRE & Cloud Deployment Foundations — local lab specifications L29–L32.
   Same record shape as sre-labs.js (see L01/L03 there). M15: a paper
   translation of the D01/L09 design onto Azure and Google Cloud (L29) and a
   local API support fixture (L30); M16: rebuilding the core Beacon deployment
   from checked-in artifacts (L31) and the final assessment harness (L32). */
window.LX = window.LX || { commands: [], scenarios: [], drills: [] };
LX.sreLabs = LX.sreLabs || [];

(function () {
  var DIR = 'labs/sre-cloud-foundations/';
  function lab(x) { x.version = x.version || '1.0'; LX.sreLabs.push(x); }

  lab({
    id: 'L29', moduleId: 'M15', title: 'Beacon on Azure and Google Cloud: translate the design, not the vocabulary',
    objectiveIds: ['obj-m15-01', 'obj-m15-04'], executionMode: 'local', estimatedMinutes: 90, environmentProfile: 'workstation', prerequisites: ['L09', 'L18'],
    learnerBrief: 'Two prospective customers run on Azure and Google Cloud. Finish a colleague\'s worksheet that translates the two-AZ Beacon design from D01/L09 (its inventory ids are cited row by row): a diagram per provider, a row per design concept with its scope and the difference a migration would get wrong, an access/network responsibility matrix for EKS, AKS and GKE, and a judgement on thirteen curated equivalence claims, each with the deciding fact and a source from the course register.\n\nPaper exercise: no cloud account, no cost. A small standard-library checker (`assets/xlate.py`) reads the worksheet and flags known wrong equivalences; the colleague\'s draft contains some. Nothing you write may claim hands-on experience you do not have.',
    checkpoints: [
      { id: 'c1', title: 'Translate, judge, defend', resumeInstructions: '`bash ' + DIR + 'L29/setup.sh` keeps work/translation.yaml. Re-run `python3 ' + DIR + 'L29/assets/xlate.py ' + DIR + 'L29/work/translation.yaml` to see what is still flagged; notes are in evidence/L29-notes.md.' }
    ],
    assetPaths: ['README.md', 'setup.sh', 'inject.sh', 'validate.py', 'reset.sh', 'teardown.sh', 'assets/xlate.py', 'assets/draft-base.yaml', 'assets/variants.json', 'assets/claims.json', 'assets/facts.json', 'assets/notes-template.md', 'SOLUTION.md', 'VARIANT.md', 'hints.md', 'evidence-example.json'],
    setup: ['bash ' + DIR + 'L29/setup.sh', 'python3 ' + DIR + 'L29/assets/xlate.py --claims'],
    faultInjection: ['# setup.sh planted variant-a; to choose explicitly (rewrites work/translation.yaml from the draft):', 'LOOPED_VARIANT=variant-b bash ' + DIR + 'L29/inject.sh'],
    tasks: ['Read the L09 inventory and the draft; note which of the colleague\'s rows you already doubt before running the checker.', 'Run xlate.py, quote the first findings under Fault found, and fix each row\'s target, scope (global, regional, zonal, tenant, subscription, project …) and difference.', 'Draw an Azure and a Google Cloud diagram as Mermaid text: load balancer, API, worker, database, zone/region boundary, private service path and identities.', 'Complete the responsibility matrix (control plane, node patching, upgrades, workload identity, NetworkPolicy, API endpoint access, zone spread, secrets encryption) for EKS, AKS and GKE with provider and operator ownership.', 'Judge all thirteen claims (holds, partly, does-not-hold) with the deciding difference and LX.sreSources ids such as T19 and T20.', 'Write the limits statement and the notes, run validate.py and import the evidence.'],
    validation: [
      { id: 'fixtures-intact', description: 'checker, claims, facts and variant files are the shipped versions', critical: true },
      { id: 'worksheet-parses', description: 'work/translation.yaml parses as the YAML subset with schema looped.xlate/v1', critical: true },
      { id: 'rows', description: 'eleven concepts for Azure and GCP, each with target, difference and an aws_ref that exists in L09', critical: true },
      { id: 'scopes', description: 'network, subnet, NAT and resource-scope facts stated correctly', critical: true },
      { id: 'diagrams', description: 'both diagrams have 8+ lines, 6+ edges and every required part', critical: true },
      { id: 'matrix', description: 'eight concerns across three providers with provider and operator ownership', critical: true },
      { id: 'claims', description: 'every curated claim judged correctly with the deciding fact and a register source', critical: true },
      { id: 'phrasing', description: 'no known wrong-equivalence phrasing left in rows or matrix', critical: true },
      { id: 'honesty', description: 'a limits statement and no claim of hands-on cloud proficiency', critical: true },
      { id: 'notes', description: 'Fault found, Identity scopes, Network and Managed Kubernetes notes (advisory)', critical: false }
    ],
    reset: ['bash ' + DIR + 'L29/reset.sh   # same variant; your worksheet saved as work/translation.yaml.bak'],
    teardown: ['bash ' + DIR + 'L29/teardown.sh   # removes work/ only; nothing exists in any cloud'],
    evidenceInstructions: ['`python3 ' + DIR + 'L29/validate.py --explanation-file ' + DIR + 'L29/evidence/L29-notes.md`', 'Add `--assistance assisted` if you opened hint rung 3–4, the solution or another variant\'s draft.', 'Paste evidence/latest.json here. The worksheet is fictional and holds no account data.'],
    hints: [
      { level: 1, text: 'For every row and claim ask two questions per provider: how far does this object reach (zone, region, global, subscription, project, tenant), and where are permissions attached (to the identity, to a scope, to the resource)?' },
      { level: 2, text: 'Read each xlate.py finding by area: scopes and phrasing point at rows, claims at judgements, matrix at missing concerns. Then read the provider\'s own architecture guidance (T19, T20) for that object rather than a comparison table.' },
      { level: 3, text: 'Take the L09 layout literally — two zonal subnets per tier, one NAT per AZ, an S3 gateway endpoint on route tables, task roles with identity policies — and ask whether the other provider\'s object even has a zone, a route table or a policy attached to the identity.' },
      { level: 4, text: 'Variant A: identity scope (TR-01 partly; TR-02, TR-13 do not hold; TR-12 holds; GCP resource scope is project). Variant B: network (GCP VPC global, Azure/GCP subnets and Cloud NAT regional, TR-03/04/06/07 do not hold, TR-05 partly). Variant C: managed clusters and availability (node patching depends on mode, zones vary, GCP global load balancer; TR-08/09/10 do not hold, TR-11 holds).' }
    ],
    solutionRef: 'SOLUTION.md', sourceIds: ['T19', 'T20', 'T08', 'T18'], status: 'validated',
    variant: { brief: 'After passing one variant, `LOOPED_VARIANT=variant-b bash ' + DIR + 'L29/reset.sh` (or variant-a/variant-c), keep your diagrams and matrix but re-read every flagged row, rewrite Fault found, add the first sandbox test you would run, and validate with `--variant variant-b --assistance independent --out ' + DIR + 'L29/evidence/variant.json`.', command: 'LOOPED_VARIANT=variant-b bash ' + DIR + 'L29/reset.sh' },
    limits: ['A paper translation checked by a curated teaching aid: it proves you can name non-equivalences in identity scope, IAM, networking, managed-cluster responsibility and availability with sources. It does not prove live Azure or Google Cloud proficiency, that the design works, or anything about current prices, quotas or regional support; no provider API is called.', 'Executed during development on Linux amd64 (Python 3, no cloud account): all three variants ran setup → validate FAIL → fix → validate PASS → reset; shortcuts (judging every claim does-not-hold; adding a production-experience claim to limits) failed. Not run on macOS.']
  });

  lab({
    id: 'L30', moduleId: 'M15', title: 'An API support case: reproduce it minimally, classify it, explain it',
    objectiveIds: ['obj-m15-03'], executionMode: 'local', estimatedMinutes: 90, environmentProfile: 'workstation', prerequisites: ['L08'],
    learnerBrief: 'A fictional customer reports that their nightly integration with a summaries API is failing. Their ticket, log excerpt and reproduction script are in your workspace; a local standard-library fixture plays the API on 127.0.0.1:8130. Decide whether the failure is the caller\'s, authentication or entitlement, or the service; rewrite their script into a minimal, sanitised reproduction that prints a request id and a category and follows a bounded, idempotent retry policy; and write the reply the customer will read.\n\nThe validator runs your reproduction against every fixture mode and judges it by what the fixture saw on the wire. No real API, customer or key is involved.',
    checkpoints: [
      { id: 'c1', title: 'Reproduce, isolate, explain', resumeInstructions: '`bash ' + DIR + 'L30/setup.sh` restarts the fixture and keeps work/repro.py and work/customer-reply.md. Re-read work/TICKET.md and run `python3 repro.py --base-url http://127.0.0.1:8130 --key-file .secrets/customer-key` from work/.' }
    ],
    assetPaths: ['README.md', 'setup.sh', 'inject.sh', 'validate.py', 'reset.sh', 'teardown.sh', 'assets/support_api.py', 'assets/customer-request.json', 'assets/tickets/', 'assets/reply-template.md', 'assets/notes-template.md', 'starter/repro.py', 'solution/repro.py', 'SOLUTION.md', 'VARIANT.md', 'hints.md', 'evidence-example.json'],
    setup: ['bash ' + DIR + 'L30/setup.sh', 'cat ' + DIR + 'L30/work/TICKET.md'],
    faultInjection: ['# setup.sh started the fixture for variant-a\'s ticket; another ticket (restarts the fixture):', 'LOOPED_VARIANT=variant-c bash ' + DIR + 'L30/inject.sh'],
    tasks: ['Read the ticket and the customer\'s repro.py; write down what its output would leak and why its retries hurt.', 'Reproduce with curl (`--noproxy \'*\' -D -`): status, X-Request-Id, Retry-After and quota headers, stream events; compare GET /v1/health and /_fixture/stats.', 'Isolate the failure (caller, auth/entitlement, service) in evidence/L30-notes.md with the evidence that rules out the other two.', 'Rewrite work/repro.py to the contract: one JSON result line with category and request id, exit 0/3/2, at most 3 attempts, no retry on 400/401/403, Retry-After honoured, one Idempotency-Key per run, nothing secret printed.', 'Write work/customer-reply.md (Summary, What we saw with your request id, What it means, Next steps, Retry guidance).', 'Run validate.py and import the evidence.'],
    validation: [
      { id: 'fixture', description: 'the fixture answers on 127.0.0.1:8130 and the ticket variant is known', critical: true },
      { id: 'repro-contract', description: 'six runs each end with the JSON result line and the documented exit code', critical: true },
      { id: 'classification', description: 'ok, auth_invalid, not_entitled, rate_limited, timeout and stream_interrupted for the six modes', critical: true },
      { id: 'request-ids', description: 'reported request ids were issued by the fixture in that run', critical: true },
      { id: 'attempts-honest', description: 'reported attempts equal the requests the fixture received', critical: true },
      { id: 'caller-errors', description: '401 and 403 are never retried', critical: true },
      { id: 'retry-after', description: '429 retried at most twice, each after at least Retry-After seconds', critical: true },
      { id: 'bounded', description: 'at most 3 attempts per run; the stalled mode ends in under 20 s with each stall abandoned early', critical: true },
      { id: 'idempotent', description: 'every retried run reuses one Idempotency-Key', critical: true },
      { id: 'sanitised', description: 'no key, Authorization header or customer text in outputs, repro.py, reply or notes', critical: true },
      { id: 'reply', description: 'five sections, a request id issued in the ticket\'s mode and the decisive evidence for it', critical: true },
      { id: 'notes', description: 'Reproduction, Isolation and Retry policy notes (advisory)', critical: false }
    ],
    reset: ['bash ' + DIR + 'L30/reset.sh   # re-issues both lab keys, clears quota/stream counters, same ticket; your code and reply kept'],
    teardown: ['bash ' + DIR + 'L30/teardown.sh   # stops the fixture, removes keys, run files and ticket; your repro.py and reply stay'],
    evidenceInstructions: ['`python3 ' + DIR + 'L30/validate.py --explanation-file ' + DIR + 'L30/evidence/L30-notes.md`', 'Add `--assistance assisted` if you opened hint rung 3–4 or the solution.', 'The evidence records categories, counts and timings only; the keys are lab placeholders and never appear in it.'],
    hints: [
      { level: 1, text: 'Decide which of three places the failure lives in before touching code: the caller (request, client behaviour), authentication or entitlement (who is calling, what they may use), or the service. One curl with -D - and one GET /v1/health usually rule out two of them.' },
      { level: 2, text: 'Read the status line, X-Request-Id, WWW-Authenticate, Retry-After and X-RateLimit-* headers, and every event: line of a stream until the connection closes. /_fixture/stats is the provider-side view of what arrived and when.' },
      { level: 3, text: 'Change one thing at a time: the other lab key (work/.secrets/new-key), "stream": false, curl --max-time 5, two requests 2 s apart. Each change moves exactly one candidate cause.' },
      { level: 4, text: '401 → auth_invalid, 403 → not_entitled, 429 → rate_limited, no first byte within the timeout → timeout, a stream without event: done → stream_interrupted. Retry only 429 (after Retry-After), timeouts, 5xx and interrupted streams, at most 3 attempts, one uuid4 Idempotency-Key per run, never print headers or the body. Reference: solution/repro.py.' }
    ],
    solutionRef: 'SOLUTION.md', sourceIds: ['T11', 'T01'], status: 'validated',
    variant: { brief: 'After passing one ticket, `LOOPED_VARIANT=variant-d bash ' + DIR + 'L30/reset.sh` (variant-a … variant-e are five different tickets), predict the category from the ticket text alone, write a new reply quoting a fresh request id, and validate with `--variant variant-d --assistance independent --out ' + DIR + 'L30/evidence/variant.json`.', command: 'LOOPED_VARIANT=variant-d bash ' + DIR + 'L30/reset.sh' },
    limits: ['A scripted fixture: six modes, one rate limit, one way for a stream to fail. It proves wire-level classification, a measured bounded and idempotent retry policy, sanitised output and an evidence-backed reply; not experience with any real provider\'s API, error codes, quotas or support tooling, and real incidents can mix modes intermittently.', 'Executed during development on Linux amd64 (Python 3): all five tickets (variant-a … variant-e) ran setup/reset → validate FAIL with the customer\'s script → fixed repro and reply → validate PASS; reset re-issued the keys and teardown stopped the fixture; shortcuts (ignoring Retry-After; quoting a request id from another mode) failed. Not run on macOS.']
  });
})();
