# L25 independent variant

After passing one variant, run the other without hints:

```sh
LOOPED_VARIANT=variant-b bash labs/sre-cloud-foundations/L25/reset.sh     # or variant-a
cat labs/sre-cloud-foundations/L25/work/TICKET.md
# new secrets are generated; your previous triage/lock/SBOM are in .work-previous/
python3 labs/sre-cloud-foundations/L25/validate.py --variant variant-b --assistance independent \
  --out labs/sre-cloud-foundations/L25/evidence/variant.json \
  --explanation-file labs/sre-cloud-foundations/L25/evidence/L25-notes.md
```

What changes between variants: how the second consumer obtains the credential, the report
tool's configuration (which decides whether some findings are reachable), and the lock the scan
was run against. Do not copy the previous triage: the same CVE ids have different correct
decisions. Rewrite the Rotation plan before touching anything.

**Changed-symptom extension (no validator):** with everything green, run
`docker compose -p looped-l25 -f labs/sre-cloud-foundations/L25/work/compose.yaml restart ingest`
and predict which fingerprint it logs. Then explain what would happen if someone later restored
`work/secrets/` from a backup taken yesterday, and how you would detect it within one heartbeat.
