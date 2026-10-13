# SUP-30233 — Every call fails since we turned on progress streaming

> We switched our job to `stream: true` this week so the dispatch dashboard can show progress.
> Every call has failed since. Before the change the job worked. Log:
>
> ```
> 2026-10-13T01:00:01Z summaries depot=north failed: HTTP Error 403
> 2026-10-13T01:00:01Z summaries depot=north failed: HTTP Error 403
> ```
>
> Our key is definitely right — it worked last week. Please fix your API.
