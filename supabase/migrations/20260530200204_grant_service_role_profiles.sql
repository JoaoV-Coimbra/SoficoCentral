grant usage on schema public to service_role;

grant select, insert, update, delete
on public.profiles
to service_role;

grant select, insert, update, delete
on public.solicitacoes
to service_role;
