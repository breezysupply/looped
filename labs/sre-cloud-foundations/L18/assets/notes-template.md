# L18 notes — least privilege and segmentation

<!-- Quote real command output. The validator counts words outside comments and headings. -->

## RBAC

<!-- c1: the deploy bot's failing step (quote the Forbidden line), the request it names (verb,
     resource, group), the smallest rule change, and `kubectl auth can-i` results for what it
     must AND must not be able to do. Why not bind the `edit` ClusterRole? -->

## Policy

<!-- c2: what default-deny selects, which allow rules exist and why each is needed. What broke
     when you first applied the teammate's policies, and what evidence pointed at the cause? -->

## Proof

<!-- The netcheck.sh matrix after your fix, the CNI line, and why a timeout (not "applied
     cleanly") is the evidence that a policy is enforced. -->
