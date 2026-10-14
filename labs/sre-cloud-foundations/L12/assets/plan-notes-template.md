# L12 plan notes

> Replace every prompt line (starting with >). The validator checks the headings and substance;
> the rubric in README.md grades the content. Paste plan excerpts, not whole plans.

## Prediction

> BEFORE each plan you run after the fault: what you expect it to create, update in place,
> replace or destroy, and why. Then the plan's summary line and every difference from your
> prediction.

## Drift

> What changed outside Terraform (if anything), how the plan showed it, and how you decided
> between "make reality match the code" and "make the code match reality".

## Import

> Which existing objects you brought into state, how (import block or command), what the first
> plan after import showed, and why you accepted or rejected that plan. Which resource types
> imported cleanly and which did not.

## Replacement

> Every "must be replaced" you met: the attribute marked "# forces replacement", what data lived
> in that object, and what you did to keep it (moved block, lifecycle rule, declining the change).

## Module and environments

> What moved into modules/beacon, the moved blocks you needed, and how dev and staging states are
> kept apart. How a change would be promoted from dev to staging.
