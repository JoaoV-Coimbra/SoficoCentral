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

## Páginas

A aplicação possui URLs próprias para cada área:

- `/cliente`
- `/administradora`
- `/operador`

O React mantém a navegação sem recarregar a aplicação e converte
automaticamente links antigos baseados em `#` para as URLs limpas.

Como esta é uma SPA, a hospedagem escolhida deve encaminhar acessos diretos
dessas rotas para o `index.html`. Essa regra é independente do provedor e
normalmente é chamada de SPA fallback ou history fallback.

## Supabase

As migrations ficam em `supabase/migrations`.

As Edge Functions atuais são:

- `client-solicitation-webhook`
- `create-attachment-upload`
- `create-user`
- `pipefy-card-link-webhook`
- `pipefy-delete-webhook`
- `pipefy-status-webhook`

### Exclusão sincronizada com o Pipefy

O webhook `pipefy-delete-webhook` recebe eventos oficiais `card.delete` do Pipefy,
remove os anexos privados e exclui a solicitação correspondente do banco.

- URL: `https://<project-ref>.supabase.co/functions/v1/pipefy-delete-webhook`
- Método enviado pelo Pipefy: `POST`
- Evento: `card.delete`
- Header obrigatório: `x-pipefy-secret: <PIPEFY_STATUS_WEBHOOK_SECRET>`

O vínculo é feito por `pipefy_card_id`, preenchido automaticamente quando
`pipefy-status-webhook` recebe um payload com protocolo e o ID do card. Na
automação de atualização de status do Pipefy, envie também:

```json
{
  "protocol": "<campo Protocolo>",
  "phaseName": "<fase atual>",
  "cardId": "<ID do card>"
}
```

O webhook aceita o ID como `card.id`, `cardId`, `card_id` ou `pipefyCardId`.
Como fallback, o webhook de exclusão reconhece o protocolo quando ele aparece
no título do card. A exclusão nunca usa apenas o nome/título para localizar uma
solicitação.

## Assinatura

João Victor Coimbra | G5Jus MiddleOffice
