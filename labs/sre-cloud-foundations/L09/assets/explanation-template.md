# L09 explanation — Beacon on AWS, two AZs

> Replace every prompt line (starting with >) with your own words. The validator checks the
> four headings exist and that there is substance; a mentor or the rubric grades the content.

## Request path

> Trace one sensor POST from the internet to a committed database row: DNS name, load balancer
> (which subnets, which AZs), target API task (which subnet, which route table), database. Then
> the API task's own calls at start-up: image pull (ECR API, ECR registry, S3 for layers), logs,
> secret, KMS. For each hop name the route-table entry or endpoint that makes it possible.

## Identity

> Which principal makes each AWS call (task role versus task execution role)? What trust policy
> lets ECS use it? Where does KMS sit in reading the database secret? What would a wrong
> resource ARN or an expired session look like at this point (preview of L10)?

## Failure domains

> What happens when us-west-2a is unavailable: which tasks die, which keep serving, what fails
> over (database standby promotion) and how long that takes. What do two AZs NOT protect against?
> Name every single point of failure the checker found and what you would do about each.

## Fault found

> The checker output that first showed a problem (quote it), your hypothesis, the change you
> made to the inventory and why it is the smallest change that meets the customer needs.
> Include the cost consequence of your change.
