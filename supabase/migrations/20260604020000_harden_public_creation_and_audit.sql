-- Remove policies legadas permissivas e restaura somente as regras atuais.
drop policy if exists "Administradora can insert administrator solicitations" on public.solicitacoes;
drop policy if exists "Anyone can insert client solicitations" on public.solicitacoes;
drop policy if exists "Operators can delete solicitations" on public.solicitacoes;
drop policy if exists "Operators can read all solicitations" on public.solicitacoes;
drop policy if exists "Operators can update solicitations" on public.solicitacoes;
drop policy if exists allow_anon_client_insert on public.solicitacoes;
drop policy if exists allow_authenticated_delete on public.solicitacoes;
drop policy if exists allow_authenticated_insert on public.solicitacoes;
drop policy if exists allow_authenticated_update on public.solicitacoes;
drop policy if exists allow_select_all on public.solicitacoes;
drop policy if exists solicitacoes_public_client_insert on public.solicitacoes;
drop policy if exists solicitacoes_operator_select on public.solicitacoes;
drop policy if exists solicitacoes_administrator_insert on public.solicitacoes;
drop policy if exists solicitacoes_operator_update on public.solicitacoes;
drop policy if exists solicitacoes_operator_delete on public.solicitacoes;

revoke all on public.solicitacoes from anon, authenticated;
grant select, insert, update, delete on public.solicitacoes to authenticated;

create policy solicitacoes_operator_select
on public.solicitacoes
for select
to authenticated
using (
  public.current_profile_role() in ('operador', 'admin')
  or (
    public.current_profile_role() = 'administradora'
    and tipo = 'administrator'
    and administradora = public.current_profile_administradora()
  )
);

create policy solicitacoes_administrator_insert
on public.solicitacoes
for insert
to authenticated
with check (
  public.current_profile_role() in ('operador', 'admin')
  or (
    public.current_profile_role() = 'administradora'
    and tipo = 'administrator'
    and administradora = public.current_profile_administradora()
  )
);

create policy solicitacoes_operator_update
on public.solicitacoes
for update
to authenticated
using (public.current_profile_role() in ('operador', 'admin'))
with check (public.current_profile_role() in ('operador', 'admin'));

create policy solicitacoes_operator_delete
on public.solicitacoes
for delete
to authenticated
using (public.current_profile_role() in ('operador', 'admin'));

-- A criação pública passa por uma função controlada. O cliente não escolhe
-- protocolo, status, datas, vínculo Pipefy ou marcadores internos.
create or replace function public.criar_solicitacao_cliente(
  p_nome text,
  p_email text,
  p_telefone text,
  p_condominio text,
  p_complemento text,
  p_motivo text,
  p_descricao text,
  p_upload_token_hash text
)
returns table (
  id uuid,
  protocolo text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_protocol text;
begin
  if length(trim(coalesce(p_nome, ''))) not between 1 and 255 then
    raise exception 'Nome inválido.';
  end if;

  if length(trim(coalesce(p_email, ''))) = 0
    and length(trim(coalesce(p_telefone, ''))) = 0 then
    raise exception 'Informe e-mail ou telefone.';
  end if;

  if length(trim(coalesce(p_email, ''))) > 320
    or length(trim(coalesce(p_telefone, ''))) > 32
    or length(trim(coalesce(p_condominio, ''))) not between 1 and 255
    or length(trim(coalesce(p_complemento, ''))) not between 1 and 255
    or length(trim(coalesce(p_motivo, ''))) not between 1 and 255
    or length(trim(coalesce(p_descricao, ''))) not between 1 and 4000 then
    raise exception 'Dados da solicitação inválidos.';
  end if;

  if p_upload_token_hash is null
    or p_upload_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Token de upload inválido.';
  end if;

  new_protocol :=
    'SOF-' || extract(year from now())::integer::text || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));

  return query
  insert into public.solicitacoes (
    protocolo,
    tipo,
    status,
    nome,
    email,
    telefone,
    condominio,
    complemento,
    administradora,
    area,
    motivo,
    descricao,
    upload_token_hash,
    client_webhook_sent_at,
    pipefy_card_id
  )
  values (
    new_protocol,
    'client',
    'Novo',
    trim(p_nome),
    nullif(lower(trim(coalesce(p_email, ''))), ''),
    nullif(trim(coalesce(p_telefone, '')), ''),
    trim(p_condominio),
    trim(p_complemento),
    null,
    null,
    trim(p_motivo),
    trim(p_descricao),
    p_upload_token_hash,
    null,
    null
  )
  returning
    solicitacoes.id,
    solicitacoes.protocolo,
    solicitacoes.created_at,
    solicitacoes.updated_at;
end;
$$;

revoke all on function public.criar_solicitacao_cliente(
  text, text, text, text, text, text, text, text
) from public;
grant execute on function public.criar_solicitacao_cliente(
  text, text, text, text, text, text, text, text
) to anon, authenticated;

-- A auditoria é exclusiva das Edge Functions que usam service_role.
alter table public.pipefy_webhook_events enable row level security;
alter table public.pipefy_webhook_events force row level security;

revoke all on public.pipefy_webhook_events
from public, anon, authenticated, service_role;
grant select, insert on public.pipefy_webhook_events to service_role;
