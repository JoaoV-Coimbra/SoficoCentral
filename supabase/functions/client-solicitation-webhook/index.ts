import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type ClientWebhookPayload = {
  source?: string;
  event?: string;
  protocol?: string;
  type?: string;
  status?: string;
  administrator?: {
    name?: string;
    email?: string;
  };
  customer?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  condominium?: {
    name?: string;
    complement?: string;
  };
  request?: {
    area?: string;
    reason?: string;
    description?: string;
  };
  attachments?: Array<{
    name?: string;
    type?: string;
    size?: number;
    path?: string;
  }>;
  createdAt?: string;
  uploadToken?: string;
};

type CallerProfile = {
  role?: string | null;
  administradora?: string | null;
  administrador?: string | null;
};

const ATTACHMENTS_BUCKET = "solicitacao-anexos";
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_LENGTH = 4000;
const PUBLIC_CLIENT_WEBHOOK_WINDOW_MS = 30 * 60 * 1000;
const SIGNED_URL_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 30;
const ALLOWED_ATTACHMENT_EXTENSIONS = [
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "doc",
  "docx",
  "xls",
  "xlsx",
];
const ALLOWED_ATTACHMENT_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

function isShortText(value: unknown, maxLength = MAX_TEXT_LENGTH) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function normalizeEmail(value: unknown) {
  return normalizeText(value).toLowerCase();
}

function getFileExtension(name: string) {
  return name.split(".").pop()?.toLowerCase() || "";
}

function sanitizeFileName(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-");
}

function isAllowedAttachmentType(name: string, type: string) {
  return (
    ALLOWED_ATTACHMENT_EXTENSIONS.includes(getFileExtension(name)) &&
    (!type || ALLOWED_ATTACHMENT_MIME_TYPES.includes(type))
  );
}

function isValidAttachmentPath(protocol: string, path: string, name: string) {
  const fileNameFromPath = path.split("/").pop() || "";
  const sanitizedFileName = sanitizeFileName(name);

  return (
    path.startsWith(`${protocol}/`) &&
    !path.includes("..") &&
    path === `${protocol}/${sanitizeFileName(fileNameFromPath)}` &&
    fileNameFromPath.endsWith(`-${sanitizedFileName}`)
  );
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function getCallerProfile(
  adminClient: ReturnType<typeof createClient>,
  authHeader: string | null,
) {
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.replace("Bearer ", "");
  const { data: callerData, error: callerError } = await adminClient.auth.getUser(token);

  if (callerError || !callerData.user) {
    return null;
  }

  const primary = await adminClient
    .from("profiles")
    .select("role,administradora,administrador")
    .eq("id", callerData.user.id)
    .maybeSingle();

  if (!primary.error) {
    return primary.data as CallerProfile | null;
  }

  if (
    !primary.error.message.includes("administradora") &&
    !primary.error.message.includes("administrador")
  ) {
    throw primary.error;
  }

  const fallbackAdministradora = await adminClient
    .from("profiles")
    .select("role,administradora")
    .eq("id", callerData.user.id)
    .maybeSingle();

  if (!fallbackAdministradora.error) {
    return fallbackAdministradora.data as CallerProfile | null;
  }

  const fallback = await adminClient
    .from("profiles")
    .select("role,administrador")
    .eq("id", callerData.user.id)
    .maybeSingle();

  if (fallback.error) {
    throw fallback.error;
  }

  return fallback.data as CallerProfile | null;
}

function validatePayload(payload: ClientWebhookPayload) {
  const isClientPayload =
    payload.source === "sofico_area_cliente" &&
    payload.event === "client_solicitation_created" &&
    payload.type === "client";
  const isAdministratorPayload =
    payload.source === "sofico_area_administradora" &&
    payload.event === "administrator_contact_created" &&
    payload.type === "administrator";

  if (
    !isClientPayload &&
    !isAdministratorPayload
  ) {
    return "Payload de solicitação inválido.";
  }

  if (!isShortText(payload.protocol, 64)) {
    return "Protocolo inválido.";
  }

  if (isClientPayload && !isShortText(payload.uploadToken, 128)) {
    return "Token da solicitação inválido.";
  }

  if (isClientPayload && !isShortText(payload.customer?.name, 255)) {
    return "Nome do cliente inválido.";
  }

  if (
    isClientPayload &&
    !isShortText(payload.customer?.email, 320) &&
    !isShortText(payload.customer?.phone, 32)
  ) {
    return "Informe e-mail ou telefone.";
  }

  if (isClientPayload && !isShortText(payload.condominium?.name, 255)) {
    return "Condomínio inválido.";
  }

  if (
    isAdministratorPayload &&
    (
      !isShortText(payload.administrator?.name, 255) ||
      !isShortText(payload.administrator?.email, 320) ||
      !isShortText(payload.request?.area, 255)
    )
  ) {
    return "Administradora, e-mail ou área da Sofico inválidos.";
  }

  if (!isShortText(payload.request?.reason, 255) || !isShortText(payload.request?.description)) {
    return "Motivo ou descrição inválidos.";
  }

  if ((payload.attachments || []).length > MAX_ATTACHMENTS) {
    return `A solicitação pode ter no máximo ${MAX_ATTACHMENTS} anexos.`;
  }

  const oversizedAttachment = (payload.attachments || []).find(
    (attachment) => Number(attachment.size || 0) > MAX_ATTACHMENT_SIZE_BYTES,
  );

  if (oversizedAttachment) {
    return `O anexo ${oversizedAttachment.name || ""} ultrapassa 10 MB.`;
  }

  const disallowedAttachment = (payload.attachments || []).find(
    (attachment) =>
      !isAllowedAttachmentType(String(attachment.name || ""), String(attachment.type || "")),
  );

  if (disallowedAttachment) {
    return `O anexo ${disallowedAttachment.name || ""} não é permitido.`;
  }

  const invalidPathAttachment = (payload.attachments || []).find(
    (attachment) =>
      !isShortText(attachment.path, 500) ||
      !isValidAttachmentPath(
        String(payload.protocol || ""),
        String(attachment.path || ""),
        String(attachment.name || ""),
      ),
  );

  if (invalidPathAttachment) {
    return `O caminho do anexo ${invalidPathAttachment.name || ""} é inválido.`;
  }

  return "";
}

async function buildPipefyPayload(
  adminClient: ReturnType<typeof createClient>,
  payload: ClientWebhookPayload,
) {
  const { uploadToken: _uploadToken, ...payloadWithoutToken } = payload;
  const attachments = payload.attachments || [];

  if (!attachments.length) {
    return payloadWithoutToken;
  }

  const paths = attachments.map((attachment) => String(attachment.path || ""));
  const { data: signedUrls, error } = await adminClient.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrls(paths, SIGNED_URL_EXPIRES_IN_SECONDS, {
      download: true,
    });

  if (error) {
    throw error;
  }

  const signedUrlByPath = new Map<string, string>();

  for (const signedUrl of signedUrls || []) {
    if (signedUrl.path && signedUrl.signedUrl) {
      signedUrlByPath.set(signedUrl.path, signedUrl.signedUrl);
    }
  }

  const missingPath = paths.find((path) => !signedUrlByPath.has(path));

  if (missingPath) {
    throw new Error(`Não foi possível gerar link assinado para ${missingPath}.`);
  }

  const pipefyAttachments = attachments.map((attachment) => {
    const { path, ...attachmentPayload } = attachment;
    const url = signedUrlByPath.get(String(path || "")) || "";

    return {
      ...attachmentPayload,
      url,
    };
  });

  return {
    ...payloadWithoutToken,
    attachments: pipefyAttachments,
    attachmentLinks: pipefyAttachments
      .map((attachment) => `${attachment.name}: ${attachment.url}`)
      .join("\n"),
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Método não permitido." }, 405);
  }

  const webhookUrl = Deno.env.get("PIPEFY_CLIENT_WEBHOOK_URL");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!webhookUrl) {
    return jsonResponse({ error: "Webhook Pipefy do cliente não configurado." }, 500);
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Edge Function sem variáveis do Supabase configuradas." }, 500);
  }

  const payload = (await request.json().catch(() => ({}))) as ClientWebhookPayload;
  const validationError = validatePayload(payload);

  if (validationError) {
    return jsonResponse({ error: validationError }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const { data: record, error: recordError } = await adminClient
    .from("solicitacoes")
    .select(
      "id, protocolo, tipo, status, nome, email, telefone, condominio, complemento, administradora, area, motivo, descricao, created_at, upload_token_hash, client_webhook_sent_at",
    )
    .eq("protocolo", payload.protocol)
    .maybeSingle();

  if (recordError) {
    return jsonResponse({ error: recordError.message }, 500);
  }

  if (!record || record.tipo !== payload.type) {
    return jsonResponse({ error: "Solicitação do cliente não encontrada." }, 404);
  }

  if (record.client_webhook_sent_at) {
    return jsonResponse({ error: "Webhook desta solicitação já foi enviado." }, 409);
  }

  if (payload.type === "client") {
    const createdAtMs = Date.parse(record.created_at || "");

    if (!Number.isFinite(createdAtMs) || Date.now() - createdAtMs > PUBLIC_CLIENT_WEBHOOK_WINDOW_MS) {
      return jsonResponse({ error: "Janela de envio do webhook expirada." }, 403);
    }

    const uploadTokenHash = await sha256Hex(payload.uploadToken || "");

    if (!record.upload_token_hash || uploadTokenHash !== record.upload_token_hash) {
      return jsonResponse({ error: "Token da solicitação inválido." }, 403);
    }
  } else {
    let callerProfile: CallerProfile | null = null;

    try {
      callerProfile = await getCallerProfile(adminClient, request.headers.get("Authorization"));
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500);
    }

    const role = callerProfile?.role || "";
    const callerAdministradora = callerProfile?.administradora || callerProfile?.administrador || "";
    const canSendAdministratorWebhook =
      ["operador", "admin"].includes(role) ||
      (
        role === "administradora" &&
        record.tipo === "administrator" &&
        record.administradora === callerAdministradora
      );

    if (!canSendAdministratorWebhook) {
      return jsonResponse({ error: "Usuário sem permissão para enviar este contato ao Pipefy." }, 403);
    }
  }

  const payloadMatchesRecord =
    payload.type === "client"
      ? normalizeText(payload.status) === normalizeText(record.status) &&
        normalizeText(payload.customer?.name) === normalizeText(record.nome) &&
        normalizeEmail(payload.customer?.email) === normalizeEmail(record.email) &&
        normalizeText(payload.customer?.phone) === normalizeText(record.telefone) &&
        normalizeText(payload.condominium?.name) === normalizeText(record.condominio) &&
        normalizeText(payload.condominium?.complement) === normalizeText(record.complemento) &&
        normalizeText(payload.request?.reason) === normalizeText(record.motivo) &&
        normalizeText(payload.request?.description) === normalizeText(record.descricao)
      : normalizeText(payload.status) === normalizeText(record.status) &&
        normalizeText(payload.administrator?.name) === normalizeText(record.administradora) &&
        normalizeEmail(payload.administrator?.email) === normalizeEmail(record.email) &&
        normalizeText(payload.request?.area) === normalizeText(record.area) &&
        normalizeText(payload.request?.reason) === normalizeText(record.motivo) &&
        normalizeText(payload.request?.description) === normalizeText(record.descricao);

  if (!payloadMatchesRecord) {
    return jsonResponse({ error: "Payload não confere com a solicitação salva." }, 400);
  }

  let pipefyPayload: Awaited<ReturnType<typeof buildPipefyPayload>>;

  try {
    pipefyPayload = await buildPipefyPayload(adminClient, payload);
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error
          ? error.message
          : "Não foi possível gerar os links dos anexos.",
      },
      500,
    );
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(pipefyPayload),
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    const responseMessage = responseText
      ? `Webhook Pipefy respondeu com status ${response.status}: ${responseText.slice(0, 1000)}`
      : `Webhook Pipefy respondeu com status ${response.status}.`;

    console.error(responseMessage);

    return jsonResponse(
      { error: `Webhook Pipefy respondeu com status ${response.status}.` },
      502,
    );
  }

  const { error: updateError } = await adminClient
    .from("solicitacoes")
    .update({ client_webhook_sent_at: new Date().toISOString() })
    .eq("id", record.id);

  if (updateError) {
    return jsonResponse({ error: updateError.message }, 500);
  }

  return jsonResponse({ ok: true });
});
