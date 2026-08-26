-- Replay shim for pg_net. net.http_post RECORDS the request. Nothing leaves the
-- machine, so a replayed cron tick can be inspected without any outbound call --
-- which is the whole point of the worker_url guard in 20260820145930.
create table net.http_request_log (
  id bigserial primary key,
  url text, headers jsonb, body jsonb, timeout_milliseconds int,
  requested_at timestamptz not null default now()
);
create function net.http_post(
  url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb, timeout_milliseconds int default 5000
) returns bigint language sql as $$
  insert into net.http_request_log (url, headers, body, timeout_milliseconds)
  values (url, headers, body, timeout_milliseconds) returning id;
$$;
