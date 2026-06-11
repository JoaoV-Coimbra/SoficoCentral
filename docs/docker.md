# Docker

Este Docker roda apenas o front-end React/Vite em producao. A Vercel continua
funcionando como antes, porque nenhum script ou arquivo de configuracao da
Vercel foi alterado.

## O que entra na imagem

- Build do React/Vite com `npm run build`.
- Arquivos estaticos da pasta `dist`.
- Nginx para servir a aplicacao.
- Fallback de SPA para rotas como `/cliente`, `/administradora` e `/operador`.

## O que nao entra na imagem

- Supabase Database/Auth/Storage.
- Supabase Edge Functions em `supabase/functions`.
- Secrets server-side do Pipefy.
- Arquivos `.env`.

As Edge Functions devem continuar deployadas no Supabase, a menos que a
arquitetura seja alterada de proposito.

## Build local

Defina as variaveis publicas do Vite no shell ou use um `.env` local:

```bash
docker compose up --build
```

A aplicacao ficara disponivel em:

```txt
http://localhost:8080
```

## Build manual

```bash
docker build \
  --build-arg VITE_SUPABASE_URL="https://seu-projeto.supabase.co" \
  --build-arg VITE_SUPABASE_ANON_KEY="sua-anon-key" \
  -t sofico-central .
```

```bash
docker run --rm -p 8080:80 sofico-central
```

## Pontos de atencao na migracao para Ubuntu

- As variaveis `VITE_` sao gravadas no bundle durante o build. Se mudar URL ou
  chave anonima do Supabase, reconstrua a imagem.
- Configure HTTPS no dominio final antes de usar em producao.
- Adicione o novo dominio nas URLs permitidas do Supabase Auth.
- Mantenha os webhooks do Pipefy apontando para as Supabase Edge Functions se
  elas continuarem no Supabase.
- Nao coloque `PIPEFY_CLIENT_WEBHOOK_URL`, `PIPEFY_STATUS_WEBHOOK_SECRET` ou
  `service_role` no front-end.
