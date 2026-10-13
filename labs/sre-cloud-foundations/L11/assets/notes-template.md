# L11 notes — configuration, state, real object

> Replace every prompt line (starting with >). The validator checks the four headings and that
> there is substance; the rubric in README.md grades the content.

## Configuration

> What the .tf files and terraform.tfvars ask for. Which variable(s) drive which resource, and
> which validation rule protects each input.

## State

> What `terraform state list` and `terraform state show local_file.config` record. What
> Terraform believes exists and with which attributes (filename, content checksum, random id).

## Real object

> What is actually on disk under work/out/ (ls -l, shasum -a 256). How you checked it
> independently of Terraform.

## Plan prediction

> BEFORE running plan after the fault: which resources you expect to be created, updated,
> replaced or destroyed, and why (name the attribute or keeper). Then paste the actual plan
> summary line and explain any difference. Say what you applied and what you refused to apply.
