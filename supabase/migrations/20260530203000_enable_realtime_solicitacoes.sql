do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'solicitacoes'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'solicitacoes'
  ) then
    alter publication supabase_realtime add table public.solicitacoes;
  end if;
end $$;
