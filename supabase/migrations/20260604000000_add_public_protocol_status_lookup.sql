create or replace function public.consultar_status_protocolo(p_protocolo text)
returns table (
  protocolo text,
  status text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    solicitacoes.protocolo,
    solicitacoes.status,
    solicitacoes.created_at,
    solicitacoes.updated_at
  from public.solicitacoes
  where solicitacoes.protocolo = upper(trim(p_protocolo))
  limit 1
$$;

revoke all on function public.consultar_status_protocolo(text) from public;
grant execute on function public.consultar_status_protocolo(text) to anon, authenticated;
