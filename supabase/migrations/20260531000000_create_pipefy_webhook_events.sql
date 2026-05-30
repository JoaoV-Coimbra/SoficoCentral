create table if not exists public.pipefy_webhook_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  protocol text,
  status text,
  phase_name text,
  http_status integer not null,
  result text not null,
  payload jsonb not null default '{}'::jsonb
);

grant select, insert
on public.pipefy_webhook_events
to service_role;
