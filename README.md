# Sofico Central

Sistema web para registro e acompanhamento de solicitações de clientes, administradoras e operadores da Sofico.

## Visão Geral

O projeto reúne em uma única interface:

- Cadastro público de solicitações da Área do Cliente.
- Cadastro autenticado de solicitações de administradoras.
- Painel do operador para consulta, filtros, alteração de status, anexos, exportação CSV e criação de usuários.
- Integração com Pipefy por Supabase Edge Functions.
- Armazenamento privado de anexos no Supabase Storage.

## Stack

- React + TypeScript
- Vite
- Tailwind CSS
- Supabase Auth, Database, Storage e Edge Functions
- Pipefy Webhook

## Segurança

O projeto usa RLS/policies versionadas para proteger `profiles`, `solicitacoes` e anexos. O webhook do Pipefy fica em secret server-side (`PIPEFY_CLIENT_WEBHOOK_URL`) e é chamado por Edge Function, não pelo front-end.

Uploads de anexos são limitados a 5 arquivos por solicitação, até 10 MB cada, com tipos permitidos: PDF, PNG, JPG/JPEG, DOC/DOCX e XLS/XLSX.

## Ambiente

Crie um `.env` local a partir de `.env.example` e configure as variáveis públicas do Vite. Secrets server-side devem ser configurados no Supabase, não no bundle do front-end.

## Scripts

```bash
npm run dev
npm run build
npm run preview
```

## Supabase

As migrations ficam em `supabase/migrations`.

As Edge Functions atuais são:

- `client-solicitation-webhook`
- `create-attachment-upload`
- `create-user`
- `pipefy-status-webhook`

## Assinatura

João Victor Coimbra | G5Jus MiddleOffice
