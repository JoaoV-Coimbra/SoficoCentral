import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Status = "Novo" | "Em análise" | "Pendente" | "Concluído" | "Cancelado";

type PipefyStatusPayload = {
  protocol?: string;
  protocolo?: string;
  cardId?: string | number;
  card_id?: string | number;
  pipefyCardId?: string | number;
  status?: string;
  phase?: string | { name?: string };
  phaseName?: string;
  card?: {
    id?: string | number;
    title?: string;
    current_phase?: {
      name?: string;
    };
    fields?: Array<{
      name?: string;
      field?: { label?: string; id?: string };
      value?: string;
      report_value?: string;
    }>;
  };
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-pipefy-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const statuses: Status[] = ["Novo", "Em análise", "Pendente", "Concluído", "Cancelado"];

const phaseToStatus: Record<string, Status> = {
  novo: "Novo",
  recebidos: "Novo",
  recebido: "Novo",
  triagem: "Em análise",
  "em analise": "Em análise",
  "em análise": "Em análise",
  andamento: "Em análise",
  "em andamento": "Em análise",
  pendente: "Pendente",
  "aguardando cliente": "Pendente",
  "aguardando administradora": "Pendente",
  concluido: "Concluído",
  "concluído": "Concluído",
  finalizado: "Concluído",
  cancelado: "Cancelado",
  cancelada: "Cancelado",
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

function normalize(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function readField(payload: PipefyStatusPayload, names: string[]) {
  const normalizedNames = names.map(normalize);

  return payload.card?.fields?.find((field) => {
    const label = field.name || field.field?.label || field.field?.id || "";
    return normalizedNames.includes(normalize(label));
  })?.value || payload.card?.fields?.find((field) => {
    const label = field.name || field.field?.label || field.field?.id || "";
    return normalizedNames.includes(normalize(label));
  })?.report_value;
}

function getProtocol(payload: PipefyStatusPayload) {
  return (
    payload.protocol ||
    payload.protocolo ||
    readField(payload, ["Protocolo", "protocol", "protocolo_sistema"])
  )?.trim();
}

function getPhaseName(payload: PipefyStatusPayload) {
  if (typeof payload.phase === "string") {
    return payload.phase;
  }

  return (
    payload.phaseName ||
    payload.phase?.name ||
    payload.card?.current_phase?.name ||
    payload.status
  )?.trim();
}

function getCardId(payload: PipefyStatusPayload) {
  const cardId =
    payload.card?.id ||
    payload.cardId ||
    payload.card_id ||
    payload.pipefyCardId;

  return cardId ? String(cardId) : null;
}

async function logEvent(
  adminClient: ReturnType<typeof createClient>,
  payload: PipefyStatusPayload,
  httpStatus: number,
  result: string,
) {
  const { error } = await adminClient.from("pipefy_webhook_events").insert({
    protocol: getProtocol(payload) || null,
    status: payload.status || null,
    phase_name: getPhaseName(payload) || null,
    http_status: httpStatus,
    result,
    payload,
  });

  if (error) {
    console.error("Erro ao registrar auditoria Pipefy:", error.message);
  }
}

function resolveStatus(payload: PipefyStatusPayload): Status | null {
  if (payload.status && statuses.includes(payload.status as Status)) {
    return payload.status as Status;
  }

  if (payload.status && phaseToStatus[normalize(payload.status)]) {
    return phaseToStatus[normalize(payload.status)];
  }

  const phaseName = getPhaseName(payload);

  if (!phaseName) {
    return null;
  }

  return phaseToStatus[normalize(phaseName)] || null;
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
    return jsonResponse({ error: "Edge Function sem variáveis do Supabase configuradas." }, 500);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const payload = (await request.json().catch(() => ({}))) as PipefyStatusPayload;

  if (!webhookSecret || requestSecret !== webhookSecret) {
    await logEvent(adminClient, payload, 401, "unauthorized");
    return jsonResponse({ error: "Webhook não autorizado." }, 401);
  }

  const protocol = getProtocol(payload);
  const status = resolveStatus(payload);

  if (!protocol) {
    await logEvent(adminClient, payload, 400, "missing_protocol");
    return jsonResponse({ error: "Informe o protocolo da solicitação." }, 400);
  }

  if (!status) {
    await logEvent(adminClient, payload, 400, "invalid_status");
    return jsonResponse(
      {
        error:
          "Status/fase inválido. Use Novo, Em análise, Pendente, Concluído ou Cancelado.",
      },
      400,
    );
  }

  const updatedAt = new Date().toISOString();
  const pipefyCardId = getCardId(payload);
  const { data, error } = await adminClient
    .from("solicitacoes")
    .update({
      status,
      updated_at: updatedAt,
      ...(pipefyCardId ? { pipefy_card_id: pipefyCardId } : {}),
    })
    .eq("protocolo", protocol)
    .select("id, protocolo, status, updated_at, pipefy_card_id")
    .maybeSingle();

  if (error) {
    await logEvent(adminClient, payload, 500, `database_error: ${error.message}`);
    return jsonResponse({ error: error.message }, 500);
  }

  if (!data) {
    await logEvent(adminClient, payload, 404, "solicitation_not_found");
    return jsonResponse({ error: `Solicitação ${protocol} não encontrada.` }, 404);
  }

  await logEvent(adminClient, payload, 200, "updated");

  return jsonResponse({
    ok: true,
    solicitation: data,
    pipefyCardId: payload.card?.id || null,
  });
});
