import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type UploadRequest = {
  protocol?: string;
  path?: string;
  name?: string;
  type?: string;
  size?: number;
  recordType?: "client" | "administrator";
  uploadToken?: string;
};

type CallerProfile = {
  role?: string;
  administradora?: string | null;
  administrador?: string | null;
};

const ATTACHMENTS_BUCKET = "solicitacao-anexos";
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;
const PUBLIC_CLIENT_UPLOAD_WINDOW_MS = 30 * 60 * 1000;
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

function sanitizeFileName(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-");
}

function getFileExtension(name: string) {
  return name.split(".").pop()?.toLowerCase() || "";
}

function isAllowedAttachmentType(name: string, type: string) {
  return (
    ALLOWED_ATTACHMENT_EXTENSIONS.includes(getFileExtension(name)) &&
    (!type || ALLOWED_ATTACHMENT_MIME_TYPES.includes(type))
  );
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function validateRequest(payload: UploadRequest) {
  if (!payload.protocol || !/^SOF-\d{4}-[A-Z0-9-]+$/i.test(payload.protocol)) {
    return "Protocolo inválido.";
  }

  if (!payload.name || payload.name.length > 255) {
    return "Nome do arquivo inválido.";
  }

  const sanitizedFileName = sanitizeFileName(payload.name);
  const fileNameFromPath = payload.path?.split("/").pop() || "";

  if (
    !payload.path ||
    !payload.path.startsWith(`${payload.protocol}/`) ||
    payload.path.includes("..") ||
    payload.path !== `${payload.protocol}/${sanitizeFileName(fileNameFromPath)}` ||
    !fileNameFromPath.endsWith(`-${sanitizedFileName}`)
  ) {
    return "Caminho do anexo inválido.";
  }

  if (!Number.isFinite(payload.size) || Number(payload.size) <= 0) {
    return "Tamanho do arquivo inválido.";
  }

  if (Number(payload.size) > MAX_ATTACHMENT_SIZE_BYTES) {
    return "O arquivo ultrapassa o limite de 10 MB.";
  }

  if (!isAllowedAttachmentType(payload.name, payload.type || "")) {
    return "Tipo de arquivo não permitido. Use PDF, imagens, Word ou Excel.";
  }

  return "";
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

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Método não permitido." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Edge Function sem variáveis do Supabase configuradas." }, 500);
  }

  const payload = (await request.json().catch(() => ({}))) as UploadRequest;
  const validationError = validateRequest(payload);

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
    .select("id, tipo, administradora, created_at, upload_token_hash")
    .eq("protocolo", payload.protocol)
    .maybeSingle();

  if (recordError) {
    return jsonResponse({ error: recordError.message }, 500);
  }

  if (!record) {
    return jsonResponse({ error: "Solicitação não encontrada." }, 404);
  }

  let callerProfile: CallerProfile | null = null;

  try {
    callerProfile = await getCallerProfile(adminClient, request.headers.get("Authorization"));
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500);
  }

  const role = callerProfile?.role || "";
  const callerAdministradora = callerProfile?.administradora || callerProfile?.administrador || "";
  const createdAtMs = Date.parse(record.created_at || "");
  const isRecentClientRecord =
    record.tipo === "client" &&
    Number.isFinite(createdAtMs) &&
    Date.now() - createdAtMs <= PUBLIC_CLIENT_UPLOAD_WINDOW_MS;
  const uploadTokenHash = payload.uploadToken
    ? await sha256Hex(payload.uploadToken)
    : "";
  const hasValidUploadToken =
    isRecentClientRecord &&
    Boolean(record.upload_token_hash) &&
    uploadTokenHash === record.upload_token_hash;
  const canUpload =
    ["operador", "admin"].includes(role) ||
    (
      role === "administradora" &&
      record.tipo === "administrator" &&
      record.administradora === callerAdministradora
    ) ||
    hasValidUploadToken;

  if (!canUpload) {
    return jsonResponse({ error: "Usuário sem permissão para enviar anexos." }, 403);
  }

  const { data: currentFiles, error: listError } = await adminClient.storage
    .from(ATTACHMENTS_BUCKET)
    .list(payload.protocol);

  if (listError) {
    return jsonResponse({ error: listError.message }, 500);
  }

  const currentAttachmentCount = (currentFiles || []).filter(
    (file) => file.name !== ".emptyFolderPlaceholder",
  ).length;

  if (currentAttachmentCount >= MAX_ATTACHMENTS) {
    return jsonResponse(
      { error: `A solicitação pode ter no máximo ${MAX_ATTACHMENTS} anexos.` },
      400,
    );
  }

  const { data: signedUpload, error: signedUploadError } =
    await adminClient.storage
      .from(ATTACHMENTS_BUCKET)
      .createSignedUploadUrl(payload.path);

  if (signedUploadError || !signedUpload) {
    return jsonResponse(
      { error: signedUploadError?.message || "Não foi possível preparar o envio do anexo." },
      500,
    );
  }

  return jsonResponse({
    path: signedUpload.path,
    token: signedUpload.token,
  });
});
