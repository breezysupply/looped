# SUP-30141 — Nightly summaries failing since this morning

> Hi team — since about 02:10 UTC every call from our nightly job fails. Nothing changed in our
> code. Our platform team did some maintenance on the account overnight, but they say that was
> unrelated. Our logs only show:
>
> ```
> 2026-10-13T02:10:04Z summaries depot=north failed: HTTP Error 401
> 2026-10-13T02:10:05Z summaries depot=north failed: HTTP Error 401
> 2026-10-13T02:10:05Z summaries depot=north giving up after 6 attempts
> ```
>
> Is your API down? We need this fixed before tonight's run.
