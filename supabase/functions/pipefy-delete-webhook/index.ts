import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type PipefyDeletePayload = {
  protocol?: string;
  protocolo?: string;
  action?: string;
  cardId?: string | number;
  cardTitle?: string;
  card?: PipefyCard;
  data?: {
    action?: string;
    card?: PipefyCard;
  };
};

type PipefyCard = {
  id?: string | number;
  title?: string;
  pipe_id?: string | number;
};

const ATTACHMENTS_BUCKET = "solicitacao-anexos";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-pipefy-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function getAction(payload: PipefyDeletePayload) {
  return payload.data?.action || payload.action || "";
}

function getCard(payload: PipefyDeletePayload) {
  return payload.data?.card || payload.card || {
    id: payload.cardId,
    title: payload.cardTitle,
  };
}

function getProtocol(payload: PipefyDeletePayload) {
  const explicitProtocol = payload.protocol || payload.protocolo;

  if (explicitProtocol) {
    return explicitProtocol.trim().toUpperCase();
  }

  return getCard(payload).title
    ?.match(/\bSOF-\d{4}-[A-Z0-9-]+\b/i)?.[0]
    ?.toUpperCase() || null;
}

async function logEvent(
  adminClient: ReturnType<typeof createClient>,
  payload: PipefyDeletePayload,
  httpStatus: number,
  result: string,
) {
  const { error } = await adminClient.from("pipefy_webhook_events").insert({
    protocol: getProtocol(payload),
    status: null,
    phase_name: null,
    http_status: httpStatus,
    result,
    payload,
  });

  if (error) {
    console.error("Erro ao registrar auditoria Pipefy:", error.message);
  }
}

async function removeAttachments(
  adminClient: ReturnType<typeof createClient>,
  protocol: string,
) {
  const { data: files, error: listError } = await adminClient.storage
    .from(ATTACHMENTS_BUCKET)
    .list(protocol);

  if (listError) {
    throw listError;
  }

  if (!files?.length) {
    return;
  }

  const paths = files.map((file) => `${protocol}/${file.name}`);
  const { error: removeError } = await adminClient.storage
    .from(ATTACHMENTS_BUCKET)
    .remove(paths);

  if (removeError) {
    throw removeError;
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Método não permitido." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const webhookSecret = Deno.env.get("PIPEFY_STATUS_WEBHOOK_SECRET");
  const requestSecret = request.headers.get("x-pipefy-secret");

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { error: "Edge Function sem variáveis do Supabase configuradas." },
      500,
    );
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const payload = (await request.json().catch(() => ({}))) as PipefyDeletePayload;

  if (!webhookSecret || requestSecret !== webhookSecret) {
    await logEvent(adminClient, payload, 401, "delete_unauthorized");
    return jsonResponse({ error: "Webhook não autorizado." }, 401);
  }

  if (getAction(payload) !== "card.delete") {
    await logEvent(adminClient, payload, 400, "invalid_delete_action");
    return jsonResponse({ error: "Este endpoint aceita apenas card.delete." }, 400);
  }

  const card = getCard(payload);
  const pipefyCardId = card.id ? String(card.id) : null;
  const protocol = getProtocol(payload);

  if (!pipefyCardId && !protocol) {
    await logEvent(adminClient, payload, 400, "missing_card_reference");
    return jsonResponse(
      { error: "O webhook não informou ID do card nem protocolo." },
      400,
    );
  }

  let record: {
    id: string;
    protocolo: string;
    pipefy_card_id: string | null;
  } | null = null;
  let findError: { message: string } | null = null;

  if (protocol) {
    const result = await adminClient
      .from("solicitacoes")
      .select("id, protocolo, pipefy_card_id")
      .eq("protocolo", protocol)
      .maybeSingle();
    record = result.data;
    findError = result.error;
  }

  if (!record && !findError && pipefyCardId) {
    const result = await adminClient
      .from("solicitacoes")
      .select("id, protocolo, pipefy_card_id")
      .eq("pipefy_card_id", pipefyCardId)
      .maybeSingle();
    record = result.data;
    findError = result.error;
  }

  if (findError) {
    await logEvent(adminClient, payload, 500, `delete_lookup_error: ${findError.message}`);
    return jsonResponse({ error: findError.message }, 500);
  }

  if (!record) {
    await logEvent(adminClient, payload, 200, "delete_already_absent");
    return jsonResponse({
      ok: true,
      deleted: false,
      message:
        "Solicitação já estava ausente ou o card ainda não possui vínculo seguro.",
    });
  }

  try {
    await removeAttachments(adminClient, record.protocolo);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logEvent(adminClient, payload, 500, `delete_attachments_error: ${message}`);
    return jsonResponse({ error: `Não foi possível excluir os anexos: ${message}` }, 500);
  }

  const { error: deleteError } = await adminClient
    .from("solicitacoes")
    .delete()
    .eq("id", record.id);

  if (deleteError) {
    await logEvent(adminClient, payload, 500, `delete_database_error: ${deleteError.message}`);
    return jsonResponse({ error: deleteError.message }, 500);
  }

  await logEvent(adminClient, payload, 200, "deleted");
  return jsonResponse({
    ok: true,
    deleted: true,
    protocol: record.protocolo,
    pipefyCardId,
  });
});
