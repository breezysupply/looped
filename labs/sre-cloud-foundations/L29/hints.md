# L29 hints (four rungs; rungs 3–4 end independent credit for this attempt)

1. **Boundary.** For every row and claim, ask two questions per provider: how far does this
   object reach (zone, region, global, subscription, project, tenant), and where are permissions
   attached (to the identity, to a scope, to the resource)? Most wrong equivalences fail one of
   those two questions.
2. **Evidence source.** Run `xlate.py` and read each finding's area: `scopes` and `phrasing`
   point at rows, `claims` at judgements, `matrix` at missing concerns. Then read the provider's
   own architecture guidance (T19, T20) for that object, not a comparison table.
3. **Discriminating check.** Take the L09 layout literally: two zonal subnets per tier, one NAT
   per AZ, an S3 gateway endpoint on route tables, task roles with identity policies. For each,
   ask what object the other provider uses and whether it even has a zone, a route table or a
   policy document attached to the identity.
4. **Root cause and fix.** Variant A: identity scope — managed identities/service accounts are
   granted via role assignments/allow policies, identities live in the tenant/organisation, no
   key file is needed, Key Vault and Cloud KMS have no key policy (TR-01 partly, TR-02, TR-13
   does-not-hold, TR-12 holds). Variant B: network — GCP VPCs are global, Azure/GCP subnets
   regional, Cloud NAT regional, private endpoints differ from gateway endpoints, NSGs have deny
   and priorities (TR-03/04/06/07 does-not-hold, TR-05 partly). Variant C: managed clusters and
   availability — node patching depends on mode, zones vary and names are per account, GCP's
   global load balancer, zone-redundant PostgreSQL exists in all three (TR-08/09/10
   does-not-hold, TR-11 holds).
