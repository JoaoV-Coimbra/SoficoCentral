import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type PipefyCardLinkPayload = {
  protocol?: string;
  protocolo?: string;
  cardId?: string | number;
  card_id?: string | number;
  pipefyCardId?: string | number;
  card?: {
    id?: string | number;
  };
};

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

function getProtocol(payload: PipefyCardLinkPayload) {
  return (payload.protocol || payload.protocolo)?.trim().toUpperCase() || "";
}

function getCardId(payload: PipefyCardLinkPayload) {
  const cardId =
    payload.card?.id ||
    payload.cardId ||
    payload.card_id ||
    payload.pipefyCardId;

  return cardId ? String(cardId).trim() : "";
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

  if (!webhookSecret || requestSecret !== webhookSecret) {
    return jsonResponse({ error: "Webhook não autorizado." }, 401);
  }

  const payload = (await request.json().catch(() => ({}))) as PipefyCardLinkPayload;
  const protocol = getProtocol(payload);
  const cardId = getCardId(payload);

  if (!/^SOF-\d{4}-[A-Z0-9-]+$/.test(protocol)) {
    return jsonResponse({ error: "Protocolo inválido." }, 400);
  }

  if (!cardId) {
    return jsonResponse({ error: "ID do card não informado." }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const { data, error } = await adminClient
    .from("solicitacoes")
    .update({ pipefy_card_id: cardId })
    .eq("protocolo", protocol)
    .select("id, protocolo, pipefy_card_id")
    .maybeSingle();

  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }

  if (!data) {
    return jsonResponse({ error: `Solicitação ${protocol} não encontrada.` }, 404);
  }

  return jsonResponse({ ok: true, solicitation: data });
});
