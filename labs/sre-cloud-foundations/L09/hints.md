# L09 hints (four rungs; rungs 3–4 end independent credit for this attempt)

1. **Boundary.** Run every scenario, not just the baseline. A design can be correct when both
   zones are up and still fail the customer's R-1. Compare which components go DOWN in which
   scenario: the pattern tells you whether the problem is a zone, a path or a single copy.
2. **Evidence source.** `archcheck.py work/inventory.json --explain api` (or `worker`, `db`)
   prints, per subnet, every need and the route table or endpoint it used. Read it hop by hop
   against `customer-needs.md`; remember that pulling an image needs more than the ECR
   endpoints.
3. **Discriminating check.** Look at what each failing subnet depends on in the OTHER zone: which
   NAT gateway its route table targets, which subnets each interface endpoint has ENIs in, which
   route tables the S3 gateway endpoint is associated with, and whether the database is Multi-AZ.
   `--spof` shows the same thing from the other side.
4. **Root cause and fix.** Variant A: one NAT and single-AZ endpoint ENIs; add `nat-b` for
   `rt-worker-b` and put every interface endpoint in `api-a` and `api-b` (cost rises to about
   155 USD/month, within budget). Variant B: the S3 gateway endpoint is not associated with the
   API route tables, so ECR layers cannot be fetched; associate `rt-api-a` and `rt-api-b` (do
   not add an internet route — that breaks C-1). Variant C: the database is single-AZ; set
   `multi_az: true`. Then state `region` and `partner-hooks` as SPOFs with mitigations.
