create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid()
  limit 1
$$;

create or replace function public.current_profile_administradora()
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  profile_administradora text;
  has_administradora_column boolean;
  has_administrador_column boolean;
begin
  if auth.uid() is null then
    return null;
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'administradora'
  ) into has_administradora_column;

  if has_administradora_column then
    execute 'select administradora from public.profiles where id = $1'
    into profile_administradora
    using auth.uid();
  end if;

  if profile_administradora is not null then
    return profile_administradora;
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'administrador'
  ) into has_administrador_column;

  if has_administrador_column then
    execute 'select administrador from public.profiles where id = $1'
    into profile_administradora
    using auth.uid();
  end if;

  return profile_administradora;
end;
$$;

grant execute on function public.current_profile_role() to anon, authenticated;
grant execute on function public.current_profile_administradora() to anon, authenticated;

alter table public.profiles enable row level security;
alter table public.solicitacoes enable row level security;

alter table public.solicitacoes
add column if not exists upload_token_hash text;

alter table public.solicitacoes
add column if not exists client_webhook_sent_at timestamptz;

revoke all on public.profiles from anon, authenticated;
revoke all on public.solicitacoes from anon, authenticated;

grant select on public.profiles to authenticated;
grant insert on public.solicitacoes to anon;
grant select, insert, update, delete on public.solicitacoes to authenticated;

drop policy if exists profiles_select_own_or_operator on public.profiles;
create policy profiles_select_own_or_operator
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or public.current_profile_role() in ('operador', 'admin')
);

drop policy if exists solicitacoes_public_client_insert on public.solicitacoes;
create policy solicitacoes_public_client_insert
on public.solicitacoes
for insert
to anon, authenticated
with check (
  tipo = 'client'
  and status = 'Novo'
  and upload_token_hash ~ '^[a-f0-9]{64}$'
  and client_webhook_sent_at is null
);

drop policy if exists solicitacoes_operator_select on public.solicitacoes;
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

drop policy if exists solicitacoes_administrator_insert on public.solicitacoes;
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

drop policy if exists solicitacoes_operator_update on public.solicitacoes;
create policy solicitacoes_operator_update
on public.solicitacoes
for update
to authenticated
using (public.current_profile_role() in ('operador', 'admin'))
with check (public.current_profile_role() in ('operador', 'admin'));

drop policy if exists solicitacoes_operator_delete on public.solicitacoes;
create policy solicitacoes_operator_delete
on public.solicitacoes
for delete
to authenticated
using (public.current_profile_role() in ('operador', 'admin'));

insert into storage.buckets (id, name, public)
values ('solicitacao-anexos', 'solicitacao-anexos', false)
on conflict (id) do update
set public = false;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'storage'
      and table_name = 'buckets'
      and column_name = 'file_size_limit'
  ) then
    update storage.buckets
    set file_size_limit = 10485760
    where id = 'solicitacao-anexos';
  end if;
end $$;

drop policy if exists attachments_public_upload on storage.objects;

drop policy if exists attachments_operator_select on storage.objects;
create policy attachments_operator_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'solicitacao-anexos'
  and public.current_profile_role() in ('operador', 'admin')
);

drop policy if exists attachments_operator_delete on storage.objects;
create policy attachments_operator_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'solicitacao-anexos'
  and public.current_profile_role() in ('operador', 'admin')
);
