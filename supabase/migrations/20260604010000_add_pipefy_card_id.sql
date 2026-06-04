alter table public.solicitacoes
add column if not exists pipefy_card_id text;

create unique index if not exists solicitacoes_pipefy_card_id_unique
on public.solicitacoes (pipefy_card_id)
where pipefy_card_id is not null;
