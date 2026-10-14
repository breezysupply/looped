# SUP-30177 — About half of our summary calls fail

> Hello — to finish the nightly job faster we started running all 40 depots in parallel on
> Monday. Since then roughly half the calls fail and the job takes longer than before, even
> though our client retries. Sample from our log:
>
> ```
> 2026-10-13T01:00:00.212Z summaries depot=north failed: HTTP Error 429
> 2026-10-13T01:00:00.431Z summaries depot=north failed: HTTP Error 429
> 2026-10-13T01:00:00.648Z summaries depot=north failed: HTTP Error 429
> ```
>
> Your status page is green. What is going on?
