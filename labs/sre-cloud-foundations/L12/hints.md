# L12 hints (four rungs; rungs 3–4 end independent credit for this attempt)

1. **Boundary.** Three sources of truth again: the `.tf` files, the state file, and what
   `docker inspect` shows. Decide which two disagree before changing anything, and decide which
   object holds data you must not lose. Containers here are disposable; volumes are not.
2. **Evidence source.** `terraform plan` (read `has been deleted`, `must be replaced`,
   `# forces replacement`, `will be imported`, `has moved to`), `terraform state show <addr>`
   for the recorded id, and `docker inspect -f '{{.Id}} {{.Config.Labels}}' <name>` /
   `docker volume inspect <name>` for reality. Compare ids, ports and creation times.
3. **Discriminating check.** Does the container id in state equal the id Docker reports for the
   same name? If not, someone replaced it by hand. Is there a looped-l12-* object no state knows?
   That is a candidate for import. Does the plan replace a `docker_volume`? Then find the
   attribute that forces it before anything else.
4. **Root cause and fix.** Variant A: the API was removed and re-run by hand on another port, so
   apply hits a name conflict; import it (accept the replacement) or remove the unmanaged
   container after checking its data is in the volume, then apply. Variant B: import the spool
   volume (clean) and the worker container (replacement accepted; it is stateless), or create the
   worker from Terraform after removing the hand-made one — never delete the spool. Variant C:
   the port change is safe (container replacement); the volume label change replaces the data
   volume — decline it in tfvars, say why, and let `prevent_destroy` catch the next attempt. In
   c2, four `moved` blocks make the module refactor a 0/0/0 plan.
