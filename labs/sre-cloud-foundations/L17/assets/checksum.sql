-- prints "<rows>:<md5>" over every column of every row in id order (timezone-independent)
SELECT count(*) || ':' || coalesce(md5(string_agg(
         id || '|' || sensor_id || '|' || status || '|' || reading::text || '|' || extract(epoch FROM recorded_at)::bigint,
         E'\n' ORDER BY id)), 'empty')
FROM readings;
