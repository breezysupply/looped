-- L24: today's writes, after the nightly backup was taken (8 000 records, 40 audit rows).
SET client_min_messages = warning;
INSERT INTO public.records
SELECT md5('rec-' || i), 's-' || lpad(((i * 7919) % 400)::text, 4, '0'),
       CASE WHEN (i * 31) % 100 < 3 THEN 'fault' WHEN (i * 31) % 100 < 9 THEN 'degraded' ELSE 'ok' END,
       to_char(timestamp '2026-09-01 00:00:00' + i * interval '37 seconds', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
       'req-' || substr(md5('req-' || i), 1, 16), 'idem-' || i
FROM generate_series(50001, 58000) AS i;
INSERT INTO public.audit_log (at, note)
SELECT timestamptz '2026-09-01T00:00:00Z' + i * interval '3 hours', 'config change #' || i FROM generate_series(401, 440) AS i;
