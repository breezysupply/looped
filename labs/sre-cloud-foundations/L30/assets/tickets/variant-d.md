# SUP-30219 — Nightly job hangs until the scheduler kills it

> Our nightly job has started hanging. It sits on the first depot for minutes, then our
> scheduler kills it at the 30-minute limit. There is no error in our log at all, just:
>
> ```
> 2026-10-13T01:00:00Z summaries depot=north starting
> 2026-10-13T01:30:00Z scheduler: job exceeded 1800 s, killed
> ```
>
> We did not change anything. Please investigate urgently.
