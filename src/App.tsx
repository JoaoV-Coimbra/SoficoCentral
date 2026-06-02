import {
  Download,
  Eye,
  FileArchive,
  FileText,
  Filter,
  LoaderCircle,
  Mail,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import logoUrl from "../public/fi-logo.png";
import { supabase } from "./supabaseClient";

const ATTACHMENTS_BUCKET = "solicitacao-anexos";
const MAX_ATTACHMENTS_PER_RECORD = 5;
const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;
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

// Tipos centrais do fluxo: cliente, administradora, operador e registros compartilhados.
type RecordType = "client" | "administrator";
type ActiveTab = "client" | "administrator" | "operator";
type Status = "Novo" | "Em análise" | "Pendente" | "Concluído" | "Cancelado";

type Attachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl: string;
  path?: string;
};

type UserRole = "administradora" | "operador" | "admin";

type UserProfile = {
  id: string;
  email: string;
  role: UserRole;
  administradora?: string | null;
  administrador?: string | null;
};

type SolicitationRecord = {
  id: string;
  protocol: string;
  type: RecordType;
  name: string;
  administrator: string;
  email: string;
  phone: string;
  condominium: string;
  complement: string;
  area: string;
  reason: string;
  description: string;
  status: Status;
  attachments: Attachment[];
  createdAt: string;
  updatedAt: string;
};

type SolicitationForm = Omit<SolicitationRecord, "createdAt" | "updatedAt"> & {
  createdAt?: string;
  updatedAt?: string;
};

type DbSolicitationRow = {
  id: string;
  protocolo: string;
  tipo: RecordType;
  status: Status;
  nome: string | null;
  email: string | null;
  telefone: string | null;
  condominio: string | null;
  complemento: string | null;
  administradora: string | null;
  area: string | null;
  motivo: string | null;
  descricao: string | null;
  created_at: string;
  updated_at: string;
};

const initialForm: SolicitationForm = {
  id: "",
  protocol: "",
  type: "administrator",
  name: "",
  administrator: "",
  email: "",
  phone: "",
  condominium: "",
  complement: "",
  area: "",
  reason: "",
  description: "",
  status: "Novo",
  attachments: [],
};

const administrators = [
  "Habitacional",
  "Semog",
  "Controlar",
  "Apsa",
  "Lowndes",
  "ASC",
  "Outras",
];
const areas = ["Backoffice", "Jurídico", "Financeiro", "Propostas"];
const statuses: Status[] = [
  "Novo",
  "Em análise",
  "Pendente",
  "Concluído",
  "Cancelado",
];
const administratorReasons = [
  "Duplicidade",
  "Emissão de CND",
  "Verificação de situação das cotas",
  "Emissão de Planilha Débito",
  "Solicitação de simulação de acordo",
  "Outros",
];
const clientReasons = [
  "Emissão de CND",
  "Verificação de cotas em aberto",
  "Solicitação de acordo",
  "Reclamações",
  "Informações",
  "Outros",
];
const recordTypes: Record<RecordType, string> = {
  client: "Cliente",
  administrator: "Administradora",
};

// Usa UUID quando disponível e mantém fallback para navegadores antigos.
function makeId() {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Protocolo amigável para o usuário e seguro contra colisões sem precisar consultar dados públicos.
function makeProtocol(records: SolicitationRecord[]) {
  const year = new Date().getFullYear();
  const prefix = `SOF-${year}-`;
  const lastNumber = records
    .map((record) => record.protocol)
    .filter((protocol) => protocol?.startsWith(prefix))
    .map((protocol) => Number(protocol.replace(prefix, "")))
    .filter(Number.isFinite)
    .reduce((highest, current) => Math.max(highest, current), 0);

  const timeNumber = Number(String(Date.now()).slice(-5));
  return `${prefix}${String(Math.max(lastNumber + 1, timeNumber)).padStart(5, "0")}`;
}

// Registros antigos ou importados recebem protocolo compatível sem quebrar o app.
function fallbackProtocol(record: Partial<SolicitationRecord>) {
  const year = new Date(record.createdAt || Date.now()).getFullYear();
  const suffix = String(record.id || makeId())
    .replace(/[^a-z0-9]/gi, "")
    .slice(-5)
    .toUpperCase()
    .padStart(5, "0");

  return `SOF-${year}-${suffix}`;
}

function isStatus(value: unknown): value is Status {
  return typeof value === "string" && statuses.includes(value as Status);
}

// Converte a linha snake_case do Supabase para o modelo camelCase usado pela UI.
function mapDbSolicitation(
  row: DbSolicitationRow,
  attachments: Attachment[] = [],
): SolicitationRecord {
  return {
    id: row.id,
    protocol: row.protocolo,
    type: row.tipo,
    name: row.nome || "",
    administrator: row.administradora || "",
    email: row.email || "",
    phone: row.telefone || "",
    condominium: row.condominio || "",
    complement: row.complemento || "",
    area: row.area || "",
    reason: row.motivo || "",
    description: row.descricao || "",
    status: isStatus(row.status) ? row.status : "Novo",
    attachments,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Converte o modelo da UI para as colunas do Supabase.
function mapSolicitationToDb(record: SolicitationRecord) {
  return {
    id: record.id,
    protocolo: record.protocol,
    tipo: record.type,
    status: record.status,
    nome: record.name || null,
    email: record.email || null,
    telefone: record.phone || null,
    condominio: record.condominium || null,
    complemento: record.complement || null,
    administradora: record.administrator || null,
    area: record.area || null,
    motivo: record.reason,
    descricao: record.description || null,
  };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 11);

  if (digits.length <= 2) {
    return digits ? `(${digits}` : "";
  }

  if (digits.length <= 6) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  }

  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }

  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
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

function makeUploadToken() {
  return globalThis.crypto?.randomUUID
    ? `${globalThis.crypto.randomUUID()}-${globalThis.crypto.randomUUID()}`
    : `${makeId()}-${makeId()}-${Date.now()}`;
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function dataUrlToBlob(dataUrl: string) {
  const [header, base64] = dataUrl.split(",");
  const mime =
    header.match(/data:(.*?);base64/)?.[1] || "application/octet-stream";
  const bytes = atob(base64 || "");
  const array = new Uint8Array(bytes.length);

  for (let index = 0; index < bytes.length; index += 1) {
    array[index] = bytes.charCodeAt(index);
  }

  return new Blob([array], { type: mime });
}

// Mantém leitura local para preview imediato; o arquivo é enviado ao Supabase Storage no submit.
function fileToAttachment(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      resolve({
        id: makeId(),
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        dataUrl: String(reader.result || ""),
      });
    };

    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function uploadRecordAttachments(
  record: SolicitationRecord,
  uploadToken?: string,
) {
  const uploadedAttachments: Attachment[] = [];

  for (const attachment of record.attachments) {
    if (attachment.path || !attachment.dataUrl.startsWith("data:")) {
      uploadedAttachments.push(attachment);
      continue;
    }

    const path = `${record.protocol}/${attachment.id}-${sanitizeFileName(attachment.name)}`;
    const { data: signedUpload, error: signedUploadError } =
      await supabase.functions.invoke("create-attachment-upload", {
        body: {
          protocol: record.protocol,
          path,
          name: attachment.name,
          type: attachment.type,
          size: attachment.size,
          recordType: record.type,
          uploadToken,
        },
      });

    if (signedUploadError || signedUpload?.error) {
      throw new Error(
        await getFunctionErrorMessage(signedUploadError, signedUpload),
      );
    }

    const { error } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .uploadToSignedUrl(
        signedUpload.path,
        signedUpload.token,
        dataUrlToBlob(attachment.dataUrl),
        {
          contentType: attachment.type,
        },
      );

    if (error) {
      throw error;
    }

    uploadedAttachments.push({ ...attachment, path });
  }

  return uploadedAttachments;
}

async function fetchRecordAttachments(protocol: string): Promise<Attachment[]> {
  const { data, error } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .list(protocol);

  if (error || !data) {
    return [];
  }

  const attachments = await Promise.all(
    data
      .filter((file) => file.name !== ".emptyFolderPlaceholder")
      .map(async (file) => {
        const path = `${protocol}/${file.name}`;
        const { data: signed } = await supabase.storage
          .from(ATTACHMENTS_BUCKET)
          .createSignedUrl(path, 60 * 10);
        const originalName = file.name.replace(/^[^-]+-/, "");

        return {
          id: path,
          name: originalName,
          type: String(file.metadata?.mimetype || "application/octet-stream"),
          size: Number(file.metadata?.size || 0),
          dataUrl: signed?.signedUrl || "",
          path,
        };
      }),
  );

  return attachments;
}

// Payload JSON esperado pelo Pipefy para abertura de solicitações da Área do Cliente.
function buildClientWebhookPayload(
  record: SolicitationRecord,
  uploadToken: string,
) {
  return {
    source: "sofico_area_cliente",
    event: "client_solicitation_created",
    protocol: record.protocol,
    type: record.type,
    status: record.status,
    customer: {
      name: record.name,
      email: record.email,
      phone: record.phone,
    },
    condominium: {
      name: record.condominium,
      complement: record.complement,
    },
    request: {
      reason: record.reason,
      description: record.description,
    },
    attachments: record.attachments.map((attachment) => ({
      name: attachment.name,
      type: attachment.type,
      size: attachment.size,
      path: attachment.path,
    })),
    createdAt: record.createdAt,
    uploadToken,
  };
}

// Envia somente JSON para a Edge Function; a URL/segredo do Pipefy ficam no servidor.
async function sendClientWebhook(record: SolicitationRecord, uploadToken: string) {
  const { data, error } = await supabase.functions.invoke(
    "client-solicitation-webhook",
    {
      body: buildClientWebhookPayload(record, uploadToken),
    },
  );

  if (error || data?.error) {
    throw new Error(await getFunctionErrorMessage(error, data));
  }
}

function validateAttachments(attachments: Attachment[]) {
  if (attachments.length > MAX_ATTACHMENTS_PER_RECORD) {
    return `Anexe no máximo ${MAX_ATTACHMENTS_PER_RECORD} arquivos por solicitação.`;
  }

  const oversizedAttachment = attachments.find(
    (attachment) => attachment.size > MAX_ATTACHMENT_SIZE_BYTES,
  );

  if (oversizedAttachment) {
    return `${oversizedAttachment.name} ultrapassa o limite de ${formatBytes(MAX_ATTACHMENT_SIZE_BYTES)}.`;
  }

  const disallowedAttachment = attachments.find(
    (attachment) =>
      !isAllowedAttachmentType(attachment.name, attachment.type),
  );

  if (disallowedAttachment) {
    return `${disallowedAttachment.name} não é um tipo de arquivo permitido. Use PDF, imagens, Word ou Excel.`;
  }

  return "";
}

function validateIncomingFiles(
  currentAttachments: Attachment[],
  incomingFiles: File[],
) {
  const totalAttachments = currentAttachments.length + incomingFiles.length;

  if (totalAttachments > MAX_ATTACHMENTS_PER_RECORD) {
    return `Você pode anexar até ${MAX_ATTACHMENTS_PER_RECORD} arquivos por solicitação.`;
  }

  const oversizedFile = incomingFiles.find(
    (file) => file.size > MAX_ATTACHMENT_SIZE_BYTES,
  );

  if (oversizedFile) {
    return `${oversizedFile.name} ultrapassa o limite de ${formatBytes(MAX_ATTACHMENT_SIZE_BYTES)}.`;
  }

  const disallowedFile = incomingFiles.find(
    (file) => !isAllowedAttachmentType(file.name, file.type),
  );

  if (disallowedFile) {
    return `${disallowedFile.name} não é um tipo de arquivo permitido. Use PDF, imagens, Word ou Excel.`;
  }

  return "";
}

function canAccessAdministrator(profile: UserProfile | null) {
  return Boolean(
    profile && ["administradora", "operador", "admin"].includes(profile.role),
  );
}

function canAccessOperator(profile: UserProfile | null) {
  return Boolean(profile && ["operador", "admin"].includes(profile.role));
}

function canAccessOwnAdministratorRecords(profile: UserProfile | null) {
  const administrator = profile?.administradora || profile?.administrador || "";
  return Boolean(profile?.role === "administradora" && administrator);
}

function canReadRecords(profile: UserProfile | null) {
  return canAccessOperator(profile) || canAccessOwnAdministratorRecords(profile);
}

function getSupabaseErrorMessage(error: unknown) {
  if (!error) return "Erro desconhecido";

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object") {
    const details = error as { message?: string; details?: string; hint?: string; code?: string };
    return [details.message, details.details, details.hint, details.code].filter(Boolean).join(" | ") || "Erro desconhecido";
  }

  return String(error);
}

async function getFunctionErrorMessage(error: unknown, data: unknown) {
  if (data && typeof data === "object" && "error" in data) {
    return String((data as { error?: unknown }).error || "Erro desconhecido");
  }

  const possibleError = error as { context?: Response } | null;

  if (possibleError?.context instanceof Response) {
    try {
      const body = await possibleError.context.clone().json();
      if (body?.error) return String(body.error);
      if (body?.message) return String(body.message);
    } catch {
      try {
        const text = await possibleError.context.clone().text();
        if (text) return text;
      } catch {
        // Mantém o fallback abaixo.
      }
    }
  }

  return getSupabaseErrorMessage(error);
}

function App() {
  const [bootError, setBootError] = useState("");
  const [records, setRecords] = useState<SolicitationRecord[]>([]);
  const [form, setForm] = useState<SolicitationForm>({
    ...initialForm,
    type: "client",
  });
  const [activeTab, setActiveTab] = useState<ActiveTab>("client");
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordSaving, setRecordSaving] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [search, setSearch] = useState("");
  const [administratorSearch, setAdministratorSearch] = useState("");
  const [administratorAreaFilter, setAdministratorAreaFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [areaFilter, setAreaFilter] = useState("");
  const [selectedRecord, setSelectedRecord] =
    useState<SolicitationRecord | null>(null);
  const [toast, setToast] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [pendingOperatorTab, setPendingOperatorTab] = useState(false);
  const [pendingAdministratorTab, setPendingAdministratorTab] = useState(false);
  const [showCreateUserModal, setShowCreateUserModal] = useState(false);
  const [createUserForm, setCreateUserForm] = useState({
    email: "",
    password: "",
    role: "administradora" as "administradora" | "operador",
    administradora: "",
  });
  const [createUserLoading, setCreateUserLoading] = useState(false);
  const fileInputRef = useRef(null);

  // Toast simples para feedback curto depois de salvar, entrar, sair ou mudar status.
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Sessão do Supabase Auth: operador e administradora usam login e roles em profiles.
  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setProfileLoading(Boolean(data.session?.user?.id));
      setSession(data.session);
      setAuthLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, currentSession) => {
      setProfileLoading(Boolean(currentSession?.user?.id));
      setSession(currentSession);
      setAuthLoading(false);

      if (event === "SIGNED_OUT") {
        setActiveTab("client");
        setSelectedRecord(null);
        setProfile(null);
        setProfileLoading(false);
        setRecords([]);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    if (!session?.user?.id) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }

    setProfileLoading(true);
    supabase
      .from("profiles")
      .select("id,email,role,administradora")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(async ({ data, error }) => {
        if (error?.message?.includes("administradora")) {
          const fallback = await supabase
            .from("profiles")
            .select("id,email,role,administrador")
            .eq("id", session.user.id)
            .maybeSingle();

          data = fallback.data as unknown as typeof data;
          error = fallback.error;
        }

        if (!mounted) return;

        if (error) {
          console.error("Erro ao carregar perfil do usuário:", error);
          setProfile(null);
          setProfileLoading(false);
          return;
        }

        if (!data) {
          console.warn("Usuário autenticado sem linha em public.profiles:", session.user.email);
          setProfile(null);
          setProfileLoading(false);
          return;
        }

        const loadedProfile = data as UserProfile;
        loadedProfile.administradora = loadedProfile.administradora || loadedProfile.administrador || null;
        setProfile(loadedProfile);
        setProfileLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [session]);

  async function refreshRecords() {
    if (!canReadRecords(profile)) {
      setRecords([]);
      return;
    }

    setRecordsLoading(true);
    const profileAdministrator = profile?.administradora || profile?.administrador || "";
    let query = supabase
      .from("solicitacoes")
      .select("*")
      .order("updated_at", { ascending: false });

    if (profile?.role === "administradora") {
      query = query
        .eq("tipo", "administrator")
        .eq("administradora", profileAdministrator);
    }

    const { data, error } = await query;

    if (error || !data) {
      console.error("Erro ao carregar solicitações:", error);
      setRecordsLoading(false);
      setToast(`Não foi possível carregar as solicitações: ${getSupabaseErrorMessage(error)}`);
      return;
    }

    const recordsWithAttachments = await Promise.all(
      (data as DbSolicitationRow[]).map(async (row) =>
        mapDbSolicitation(row, await fetchRecordAttachments(row.protocolo)),
      ),
    );

    setRecords(recordsWithAttachments);
    setRecordsLoading(false);
  }

  useEffect(() => {
    if (
      (activeTab === "operator" && canAccessOperator(profile)) ||
      (activeTab === "administrator" && canAccessOwnAdministratorRecords(profile))
    ) {
      refreshRecords();
    }
  }, [activeTab, profile]);

  useEffect(() => {
    const shouldSyncRecords =
      (activeTab === "operator" && canAccessOperator(profile)) ||
      (activeTab === "administrator" && canAccessOwnAdministratorRecords(profile));

    if (!shouldSyncRecords) {
      return;
    }

    const channel = supabase
      .channel("solicitacoes-status-sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "solicitacoes" },
        () => {
          refreshRecords();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeTab, profile]);

  useEffect(() => {
    if (activeTab !== "administrator" || profile?.role !== "administradora") {
      return;
    }

    const profileAdministrator = profile.administradora || profile.administrador || "";

    if (!profileAdministrator) {
      return;
    }

    setForm((current) => ({
      ...current,
      type: "administrator",
      administrator: profileAdministrator,
    }));
  }, [activeTab, profile]);

  // Quando o login é bem-sucedido e o profile carregar com acesso, mantém o usuário na área correta.
  useEffect(() => {
    if (pendingOperatorTab && canAccessOperator(profile)) {
      setActiveTab("operator");
      setPendingOperatorTab(false);
    }

    if (pendingAdministratorTab && canAccessOwnAdministratorRecords(profile)) {
      setActiveTab("administrator");
      setPendingAdministratorTab(false);
    }

    if (
      pendingOperatorTab &&
      session &&
      profile === null &&
      !authLoading &&
      !profileLoading
    ) {
      setLoginError("Login feito, mas este usuário não tem perfil/role em public.profiles.");
      setPendingOperatorTab(false);
    }

    if (
      pendingAdministratorTab &&
      session &&
      profile === null &&
      !authLoading &&
      !profileLoading
    ) {
      setLoginError("Login feito, mas este usuário não tem perfil/role de administradora em public.profiles.");
      setPendingAdministratorTab(false);
    }
  }, [
    pendingAdministratorTab,
    pendingOperatorTab,
    profile,
    session,
    authLoading,
    profileLoading,
  ]);

  // Filtros do operador ficam memoizados para evitar recálculo desnecessário ao digitar.
  const filteredRecords = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return records
      .filter((record) => {
        const searchText = [
          record.protocol,
          recordTypes[record.type],
          record.name,
          record.administrator,
          record.email,
          record.phone,
          record.condominium,
          record.complement,
          record.area,
          record.reason,
          record.status,
          record.description,
        ]
          .join(" ")
          .toLowerCase();

        return (
          (!normalizedSearch || searchText.includes(normalizedSearch)) &&
          (!typeFilter || record.type === typeFilter) &&
          (!areaFilter || record.area === areaFilter)
        );
      })
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
  }, [areaFilter, records, search, typeFilter]);
  // Indicadores gerais da sidebar do operador.
  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);

    return {
      total: records.length,
      clients: records.filter((record) => record.type === "client").length,
      administrators: records.filter(
        (record) => record.type === "administrator",
      ).length,
      legal: records.filter((record) => record.area === "Jurídico").length,
      today: records.filter((record) => record.createdAt.slice(0, 10) === today)
        .length,
      attachments: records.reduce(
        (sum, record) => sum + record.attachments.length,
        0,
      ),
      pending: records.filter((record) =>
        ["Novo", "Em análise", "Pendente"].includes(record.status),
      ).length,
    };
  }, [records]);

  // Indicadores da tela do operador respeitam busca e filtros ativos.
  const filteredStats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);

    return {
      total: filteredRecords.length,
      clients: filteredRecords.filter((record) => record.type === "client")
        .length,
      administrators: filteredRecords.filter(
        (record) => record.type === "administrator",
      ).length,
      legal: filteredRecords.filter((record) => record.area === "Jurídico")
        .length,
      today: filteredRecords.filter(
        (record) => record.createdAt.slice(0, 10) === today,
      ).length,
      pending: filteredRecords.filter((record) =>
        ["Novo", "Em análise", "Pendente"].includes(record.status),
      ).length,
      areas: new Set(filteredRecords.map((record) => record.area)).size,
    };
  }, [filteredRecords]);

  const currentProfileAdministrator =
    profile?.administradora || profile?.administrador || "";

  const administratorRecords = useMemo(() => {
    const normalizedSearch = administratorSearch.trim().toLowerCase();

    return records
      .filter((record) => {
        const isOwnAdministratorRecord =
          record.type === "administrator" &&
          record.administrator === currentProfileAdministrator;
        const searchText = [
          record.protocol,
          record.administrator,
          record.email,
          record.area,
          record.reason,
          record.status,
          record.description,
        ]
          .join(" ")
          .toLowerCase();

        return (
          isOwnAdministratorRecord &&
          (!normalizedSearch || searchText.includes(normalizedSearch)) &&
          (!administratorAreaFilter || record.area === administratorAreaFilter)
        );
      })
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
  }, [
    administratorAreaFilter,
    administratorSearch,
    currentProfileAdministrator,
    records,
  ]);

  const administratorStats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);

    return {
      total: administratorRecords.length,
      pending: administratorRecords.filter((record) =>
        ["Novo", "Em análise", "Pendente"].includes(record.status),
      ).length,
      concluded: administratorRecords.filter(
        (record) => record.status === "Concluído",
      ).length,
      today: administratorRecords.filter(
        (record) => record.createdAt.slice(0, 10) === today,
      ).length,
    };
  }, [administratorRecords]);

  const isClientRequiredFieldsComplete = Boolean(
    form.name.trim() &&
      (form.email.trim() || form.phone.trim()) &&
      form.condominium.trim() &&
      form.complement.trim() &&
      form.reason &&
      form.description.trim(),
  );
  const areAttachmentsLocked =
    activeTab === "client" && !isClientRequiredFieldsComplete;

  if (bootError) {
    return (
      <div className="grid min-h-screen place-items-center bg-fi-paper p-6">
        <div className="max-w-xl rounded-lg border border-violet-100 bg-white p-6 text-center shadow-glow">
          <img
            className="mx-auto mb-4 h-16 w-16 rounded-lg"
            src={logoUrl}
            alt="Logo Sofico"
          />
          <h1 className="text-2xl font-black text-fi-navy">
            Não consegui abrir o CRUD
          </h1>
          <p className="mt-3 text-sm font-semibold text-slate-500">
            {bootError}
          </p>
          <button
            className="button-primary mt-5"
            type="button"
            onClick={() => window.location.reload()}
          >
            Recarregar
          </button>
        </div>
      </div>
    );
  }

  function updateField(event) {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: name === "phone" ? formatPhone(value) : value,
    }));
  }

  function updateLoginField(event) {
    const { name, value } = event.target;
    setLoginForm((current) => ({ ...current, [name]: value }));
  }

  async function signInOperator(event) {
    event.preventDefault();
    setLoginLoading(true);
    setLoginError("");

    const { error } = await supabase.auth.signInWithPassword({
      email: loginForm.email.trim(),
      password: loginForm.password,
    });

    setLoginLoading(false);

    if (error) {
      console.error("Erro de login Supabase Auth:", error);
      setLoginError(`Falha no login: ${getSupabaseErrorMessage(error)}`);
      return;
    }

    setLoginForm({ email: "", password: "" });
    if (activeTab === "administrator") {
      setPendingAdministratorTab(true);
    } else {
      setPendingOperatorTab(true);
    }
    setToast("Login realizado. Verificando permissões...");
  }

  async function signOutOperator() {
    await supabase.auth.signOut();
    setToast("Sessão encerrada.");
  }

  async function createNewUser(event) {
    event.preventDefault();
    setCreateUserLoading(true);

    if (createUserForm.role === "administradora" && !createUserForm.administradora) {
      setCreateUserLoading(false);
      setToast("Selecione a administradora do novo usuário.");
      return;
    }

    const { data, error } = await supabase.functions.invoke("create-user", {
      body: {
        email: createUserForm.email.trim(),
        password: createUserForm.password,
        role: createUserForm.role,
        administradora: createUserForm.administradora || null,
      },
    });

    setCreateUserLoading(false);

    if (error || data?.error) {
      console.error("Erro ao criar usuário via Edge Function:", error || data);
      setToast(`Erro ao criar usuário: ${await getFunctionErrorMessage(error, data)}`);
      return;
    }

    setToast(`Usuário ${createUserForm.email} criado com sucesso!`);
    setCreateUserForm({
      email: "",
      password: "",
      role: "administradora",
      administradora: "",
    });
    setShowCreateUserModal(false);
  }

  async function addFiles(files) {
    const incomingFiles = Array.from(files || []) as File[];
    if (!incomingFiles.length) return;

    const validationError = validateIncomingFiles(
      form.attachments,
      incomingFiles,
    );

    if (validationError) {
      setToast(validationError);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    const convertedFiles = await Promise.all(
      incomingFiles.map(fileToAttachment),
    );
    setForm((current) => ({
      ...current,
      attachments: [...current.attachments, ...convertedFiles],
    }));
    setToast(`${incomingFiles.length} anexo(s) adicionado(s).`);
  }

  function resetForm() {
    setForm({
      ...initialForm,
      type: activeTab === "administrator" ? "administrator" : "client",
      administrator:
        activeTab === "administrator" && profile?.role === "administradora"
          ? profile.administradora || profile.administrador || ""
          : "",
    });
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function removeAttachment(id) {
    setForm((current) => ({
      ...current,
      attachments: current.attachments.filter(
        (attachment) => attachment.id !== id,
      ),
    }));
  }

  async function saveRecord(event) {
    event.preventDefault();

    if (recordSaving) {
      return;
    }

    if (activeTab === "administrator" && !canAccessAdministrator(profile)) {
      setToast(
        "Faça login com perfil de administradora para registrar essa solicitação.",
      );
      return;
    }

    if (activeTab === "client") {
      const hasEmail = Boolean(form.email.trim());
      const hasPhone = Boolean(form.phone.trim());

      if (!hasEmail && !hasPhone) {
        setToast("Informe pelo menos E-mail ou Telefone/Whatsapp.");
        return;
      }
    }

    const attachmentValidationError = validateAttachments(form.attachments);

    if (attachmentValidationError) {
      setToast(attachmentValidationError);
      return;
    }

    setRecordSaving(true);

    try {
      const now = new Date().toISOString();
      const isNewRecord = !form.id;
      const uploadToken =
        isNewRecord && form.type === "client" ? makeUploadToken() : "";
      const uploadTokenHash = uploadToken ? await sha256Hex(uploadToken) : "";
      const record: SolicitationRecord = {
        ...form,
        id: form.id || makeId(),
        type:
          form.type ||
          (activeTab === "administrator" ? "administrator" : "client"),
        protocol: form.protocol || makeProtocol(records),
        status: form.status || "Novo",
        email: form.email.trim(),
        name: form.name?.trim() || "",
        phone: form.phone?.trim() || "",
        condominium: form.condominium?.trim() || "",
        complement: form.complement?.trim() || "",
        description: form.description.trim(),
        createdAt: "createdAt" in form ? form.createdAt || now : now,
        updatedAt: now,
      };
      let recordToPersist = record;

      if (isNewRecord) {
        const dbRecord: Record<string, unknown> =
          mapSolicitationToDb(recordToPersist);
        const { error } = await supabase
          .from("solicitacoes")
          .insert(
            uploadTokenHash
              ? { ...dbRecord, upload_token_hash: uploadTokenHash }
              : dbRecord,
          );
        if (error) throw error;

        try {
          const attachments = await uploadRecordAttachments(
            recordToPersist,
            uploadToken,
          );
          recordToPersist = { ...recordToPersist, attachments };
        } catch (error) {
          console.error(
            "Erro ao enviar anexos para o Supabase Storage:",
            error,
          );
          setToast(
            `Contato cadastrado, mas os anexos não foram enviados. Protocolo: ${recordToPersist.protocol}.`,
          );
        }
      } else {
        const { id, ...updates } = mapSolicitationToDb(recordToPersist);
        const { error } = await supabase
          .from("solicitacoes")
          .update(updates)
          .eq("id", id);
        if (error) throw error;
      }

      if (canReadRecords(profile)) {
        setRecords((current) => {
          const exists = current.some((item) => item.id === recordToPersist.id);
          return exists
            ? current.map((item) =>
                item.id === recordToPersist.id ? recordToPersist : item,
              )
            : [recordToPersist, ...current];
        });
      }

      resetForm();

      if (isNewRecord && recordToPersist.type === "client") {
        try {
          await sendClientWebhook(recordToPersist, uploadToken);
          setToast(
            `Contato cadastrado e enviado ao Pipefy. Protocolo: ${recordToPersist.protocol}.`,
          );
        } catch {
          setToast(
            `Contato cadastrado, mas não foi possível enviar ao Pipefy. Protocolo: ${recordToPersist.protocol}.`,
          );
        }
        return;
      }

      setToast(
        form.id
          ? "Contato atualizado com sucesso."
          : `Contato cadastrado. Protocolo: ${recordToPersist.protocol}.`,
      );
    } catch (error) {
      console.error("Erro ao salvar solicitação no Supabase:", error);
      const message = getSupabaseErrorMessage(error);
      setToast(`Não foi possível salvar no Supabase: ${message}`);
    } finally {
      setRecordSaving(false);
    }
  }

  async function updateStatus(recordId, status) {
    const now = new Date().toISOString();

    const { error } = await supabase
      .from("solicitacoes")
      .update({ status, updated_at: now })
      .eq("id", recordId);

    if (error) {
      console.error("Erro ao atualizar status:", error);
      setToast(`Não foi possível atualizar o status: ${getSupabaseErrorMessage(error)}`);
      return;
    }

    setRecords((current) =>
      current.map((record) =>
        record.id === recordId ? { ...record, status, updatedAt: now } : record,
      ),
    );

    setSelectedRecord((current) =>
      current?.id === recordId
        ? { ...current, status, updatedAt: now }
        : current,
    );
    setToast("Status do caso atualizado.");
  }

  function editRecord(record) {
    setForm(record);
    setSelectedRecord(null);
    setActiveTab(record.type === "client" ? "client" : "administrator");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deleteRecord(recordId) {
    const record = records.find((item) => item.id === recordId);
    const label = record
      ? `${record.protocol} - ${record.email}`
      : "este contato";

    if (!window.confirm(`Excluir ${label}?`)) {
      return;
    }

    if (record?.attachments.length) {
      await supabase.storage
        .from(ATTACHMENTS_BUCKET)
        .remove(
          record.attachments
            .map((attachment) => attachment.path)
            .filter(Boolean) as string[],
        );
    }

    const { error } = await supabase
      .from("solicitacoes")
      .delete()
      .eq("id", recordId);

    if (error) {
      setToast("Não foi possível excluir a solicitação.");
      return;
    }

    setRecords((current) => current.filter((item) => item.id !== recordId));
    if (selectedRecord?.id === recordId) {
      setSelectedRecord(null);
    }
    setToast("Contato excluído.");
  }

  function exportCsv() {
    if (!records.length) {
      setToast("Não há registros para exportar.");
      return;
    }

    const headers = [
      "ID",
      "Protocolo",
      "Status",
      "Tipo",
      "Nome",
      "Administradora",
      "Email",
      "Telefone",
      "Condominio",
      "Complemento",
      "Area",
      "Motivo",
      "Descricao",
      "Anexos",
      "Criado em",
      "Atualizado em",
    ];

    const rows = records.map((record) => [
      record.id,
      record.protocol,
      record.status,
      recordTypes[record.type],
      record.name,
      record.administrator,
      record.email,
      record.phone,
      record.condominium,
      record.complement,
      record.area,
      record.reason,
      record.description,
      record.attachments.map((attachment) => attachment.name).join("; "),
      record.createdAt,
      record.updatedAt,
    ]);

    const csv = [headers, ...rows]
      .map((row) =>
        row
          .map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`)
          .join(","),
      )
      .join("\n");

    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `contatos-sofico-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(255,77,26,0.12),transparent_32%),linear-gradient(135deg,#f8f7ff_0%,#ffffff_48%,#f4f0ff_100%)]">
      <aside className="fixed inset-y-0 left-0 hidden w-72 bg-fi-navy text-white lg:flex lg:flex-col">
        <div className="flex items-center gap-4 px-7 py-7">
          <img
            className="h-14 w-14 rounded-lg"
            src={logoUrl}
            alt="Logo Sofico"
          />
          <div>
            <p className="text-lg font-black leading-tight">Sofico</p>
            <p className="text-sm font-semibold text-white/62">
              Central de atendimento
            </p>
          </div>
        </div>

        <nav className="grid gap-2 px-4">
          <button
            className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-left text-sm font-extrabold transition ${
              activeTab === "client"
                ? "bg-white/10 text-white"
                : "text-white/75 hover:bg-white/10 hover:text-white"
            }`}
            type="button"
            onClick={() => {
              setActiveTab("client");
              setForm((current) =>
                current.id ? current : { ...initialForm, type: "client" },
              );
            }}
          >
            <Plus size={18} />
            Área do Cliente
          </button>
          <button
            className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-left text-sm font-extrabold transition ${
              activeTab === "administrator"
                ? "bg-white/10 text-white"
                : "text-white/75 hover:bg-white/10 hover:text-white"
            }`}
            type="button"
            onClick={() => {
              setActiveTab("administrator");
              setForm((current) =>
                current.id
                  ? current
                  : { ...initialForm, type: "administrator" },
              );
            }}
          >
            <FileText size={18} />
            Área da Administradora
          </button>
          <button
            className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-left text-sm font-extrabold transition ${
              activeTab === "operator"
                ? "bg-white/10 text-white"
                : "text-white/75 hover:bg-white/10 hover:text-white"
            }`}
            type="button"
            onClick={() => setActiveTab("operator")}
          >
            <FileText size={18} />
            Área do Operador
          </button>
          {activeTab === "operator" && (
            <button
              className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-left text-sm font-extrabold text-white/75 transition hover:bg-white/10 hover:text-white"
              type="button"
              onClick={canAccessOperator(profile) ? exportCsv : undefined}
              disabled={!canAccessOperator(profile)}
            >
              <Download size={18} />
              Exportar CSV
            </button>
          )}
        </nav>

        {activeTab === "operator" && canAccessOperator(profile) && (
          <div className="mt-auto grid gap-3 px-4 pb-5">
            <Metric label="Total" value={stats.total} />
            <Metric label="Clientes" value={stats.clients} />
            <Metric label="Administradoras" value={stats.administrators} />
          </div>
        )}
      </aside>

      <main className="lg:pl-72">
        <header className="border-b border-violet-100/80 bg-white/95 px-4 py-4 md:px-8 lg:px-10">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4">
              <img
                className="h-12 w-12 rounded-lg lg:hidden"
                src={logoUrl}
                alt="Logo Sofico"
              />
              <div>
                <p className="text-xs font-black uppercase text-fi-orange">
                  {activeTab === "operator"
                    ? "Área do Operador"
                    : activeTab === "administrator"
                      ? "Área da Administradora"
                      : "Área do Cliente"}
                </p>
                <h1 className="text-2xl font-black tracking-normal text-fi-navy md:text-4xl">
                  {activeTab === "operator"
                    ? "Solicitações recebidas"
                    : activeTab === "administrator"
                      ? "Solicitação da administradora"
                      : "Solicitação do cliente"}
                </h1>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 md:flex md:items-center">
              <div className="grid w-full grid-cols-3 rounded-lg border border-violet-100 bg-white p-1 md:w-auto">
                <button
                  className={`min-h-10 truncate rounded-md px-2 text-xs font-extrabold transition sm:px-3 sm:text-sm ${
                    activeTab === "client"
                      ? "bg-fi-navy text-white"
                      : "text-fi-navy hover:bg-violet-50"
                  }`}
                  type="button"
                  onClick={() => {
                    setActiveTab("client");
                    setForm((current) =>
                      current.id ? current : { ...initialForm, type: "client" },
                    );
                  }}
                >
                  Cliente
                </button>
                <button
                  className={`min-h-10 truncate rounded-md px-2 text-xs font-extrabold transition sm:px-3 sm:text-sm ${
                    activeTab === "administrator"
                      ? "bg-fi-navy text-white"
                      : "text-fi-navy hover:bg-violet-50"
                  }`}
                  type="button"
                  onClick={() => {
                    setActiveTab("administrator");
                    setForm((current) =>
                      current.id
                        ? current
                        : { ...initialForm, type: "administrator" },
                    );
                  }}
                >
                  Administradora
                </button>
                <button
                  className={`min-h-10 truncate rounded-md px-2 text-xs font-extrabold transition sm:px-3 sm:text-sm ${
                    activeTab === "operator"
                      ? "bg-fi-navy text-white"
                      : "text-fi-navy hover:bg-violet-50"
                  }`}
                  type="button"
                  onClick={() => setActiveTab("operator")}
                >
                  Operador
                </button>
              </div>
              {activeTab === "operator" &&
                (canAccessOperator(profile) ? (
                  <>
                    <button
                      className="button-secondary w-full md:w-auto"
                      type="button"
                      onClick={signOutOperator}
                    >
                      Sair
                    </button>
                    <button
                      className="button-primary w-full md:w-auto"
                      type="button"
                      onClick={exportCsv}
                    >
                      <Download size={18} />
                      Exportar
                    </button>
                    <button
                      className="button-primary w-full md:w-auto"
                      type="button"
                      onClick={() => setShowCreateUserModal(true)}
                    >
                      <Plus size={18} />
                      Novo Usuário
                    </button>
                  </>
                ) : (
                  <span className="rounded-lg border border-violet-100 bg-white px-4 py-3 text-sm font-extrabold text-fi-navy">
                    Login necessário
                  </span>
                ))}
              {activeTab === "administrator" &&
                canAccessAdministrator(profile) && (
                  <button
                    className="button-secondary w-full md:w-auto"
                    type="button"
                    onClick={signOutOperator}
                  >
                    Sair
                  </button>
                )}
            </div>
          </div>
        </header>

        <div
          className={`mx-auto grid max-w-7xl gap-6 px-4 py-6 md:px-8 lg:px-10 ${
            activeTab === "client" || activeTab === "administrator"
              ? "lg:max-w-6xl"
              : ""
          }`}
        >
          {activeTab === "administrator" &&
            !canAccessAdministrator(profile) && (
              <section className="mx-auto w-full max-w-xl rounded-lg border border-violet-100 bg-white p-6 shadow-glow">
                <div className="mb-6 text-center">
                  <img
                    className="mx-auto mb-4 h-16 w-16 rounded-lg"
                    src={logoUrl}
                    alt="Logo Sofico"
                  />
                  <p className="text-xs font-black uppercase text-fi-orange">
                    Área da Administradora
                  </p>
                  <h2 className="mt-1 text-2xl font-black text-fi-navy">
                    Login da administradora
                  </h2>
                  <p className="mt-2 text-sm font-semibold text-slate-500">
                    Entre com um usuário de administradora ou peça para o
                    operador autorização
                  </p>
                </div>

                {authLoading ? (
                  <div className="rounded-lg border border-violet-100 bg-violet-50 p-4 text-center text-sm font-extrabold text-fi-navy">
                    Verificando sessão...
                  </div>
                ) : (
                  <form className="grid gap-4" onSubmit={signInOperator}>
                    <label className="field-label">
                      E-mail
                      <input
                        className="field-control"
                        name="email"
                        type="email"
                        placeholder="administradora@empresa.com"
                        value={loginForm.email}
                        onChange={updateLoginField}
                        required
                      />
                    </label>

                    <label className="field-label">
                      Senha
                      <input
                        className="field-control"
                        name="password"
                        type="password"
                        placeholder="Digite sua senha"
                        value={loginForm.password}
                        onChange={updateLoginField}
                        required
                      />
                    </label>

                    {loginError && (
                      <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
                        {loginError}
                      </div>
                    )}

                    <button
                      className="button-primary"
                      type="submit"
                      disabled={loginLoading}
                    >
                      {loginLoading ? "Entrando..." : "Entrar"}
                    </button>
                  </form>
                )}
              </section>
            )}

          {(activeTab === "client" ||
            (activeTab === "administrator" &&
              canAccessAdministrator(profile))) && (
            <section
              id="form"
              className="rounded-lg border border-violet-100 bg-white p-5 shadow-glow md:p-6"
            >
              <div className="mb-6 flex items-start justify-between gap-4">
                <div>
                  <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-fi-orangeSoft px-3 py-1 text-xs font-black text-fi-orange">
                    <Sparkles size={15} />
                    {form.id ? "Editando registro" : "Novo atendimento"}
                  </div>
                  <h2 className="text-xl font-black text-fi-navy">
                    {form.id
                      ? "Atualizar contato"
                      : activeTab === "client"
                        ? "Registre sua solicitação"
                        : "Cadastrar solicitação da administradora"}
                  </h2>
                  <p className="mt-1 text-sm font-medium text-slate-500">
                    {activeTab === "client"
                      ? "Preencha as informações abaixo para atendimento"
                      : "Registre a demanda da administradora e mantenha os comprovantes ligados ao caso."}
                  </p>
                </div>
                {form.id && (
                  <button
                    className="icon-button"
                    type="button"
                    title="Cancelar edição"
                    onClick={resetForm}
                  >
                    <X size={18} />
                  </button>
                )}
              </div>

              <form className="grid gap-4" onSubmit={saveRecord}>
                <div className="grid gap-4 md:grid-cols-2">
                  {activeTab === "client" ? (
                    <>
                      <label className="field-label">
                        <span>
                          Nome <RequiredHint />
                        </span>
                        <input
                          className="field-control"
                          name="name"
                          type="text"
                          placeholder="Nome completo"
                          value={form.name}
                          onChange={updateField}
                          required
                        />
                      </label>

                      <label className="field-label">
                        <span>
                          E-mail <RequiredHint label="Informe e-mail ou telefone." />
                        </span>
                        <span className="relative">
                          <Mail
                            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fi-navy/35"
                            size={17}
                          />
                          <input
                            className="field-control pl-10"
                            name="email"
                            type="email"
                            placeholder="nome@email.com"
                            value={form.email}
                            onChange={updateField}
                          />
                        </span>
                      </label>

                      <label className="field-label">
                        <span>
                          Telefone ou Whatsapp{" "}
                          <RequiredHint label="Informe e-mail ou telefone." />
                        </span>
                        <input
                          className="field-control"
                          name="phone"
                          type="tel"
                          inputMode="tel"
                          maxLength={15}
                          placeholder="(21) 99999-9999"
                          value={form.phone}
                          onChange={updateField}
                        />
                      </label>

                      <label className="field-label">
                        <span>
                          Condomínio <RequiredHint />
                        </span>
                        <input
                          className="field-control"
                          name="condominium"
                          type="text"
                          placeholder="Nome do condomínio"
                          value={form.condominium}
                          onChange={updateField}
                          required
                        />
                      </label>

                      <label className="field-label">
                        <span>
                          Complemento <RequiredHint />
                        </span>
                        <input
                          className="field-control"
                          name="complement"
                          type="text"
                          placeholder="Bloco, unidade ou referência"
                          value={form.complement}
                          onChange={updateField}
                          required
                        />
                      </label>

                      <label className="field-label">
                        <span>
                          Motivo do contato <RequiredHint />
                        </span>
                        <select
                          className="field-control"
                          name="reason"
                          value={form.reason}
                          onChange={updateField}
                          required
                        >
                          <option value="">Selecione</option>
                          {clientReasons.map((reason) => (
                            <option key={reason}>{reason}</option>
                          ))}
                        </select>
                      </label>
                    </>
                  ) : (
                    <>
                      <label className="field-label">
                        Selecione sua Administradora
                  <select
                    className="field-control"
                    name="administrator"
                    value={form.administrator}
                    onChange={updateField}
                    disabled={profile?.role === "administradora"}
                    required
                  >
                    <option value="">Selecione</option>
                    {administrators.map((administrator) => (
                      <option key={administrator}>{administrator}</option>
                    ))}
                  </select>
                      </label>

                      <label className="field-label">
                        E-mail
                        <span className="relative">
                          <Mail
                            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fi-navy/35"
                            size={17}
                          />
                          <input
                            className="field-control pl-10"
                            name="email"
                            type="email"
                            placeholder="nome@empresa.com"
                            value={form.email}
                            onChange={updateField}
                            required
                          />
                        </span>
                      </label>

                      <label className="field-label">
                        Área da Sofico contatada
                        <select
                          className="field-control"
                          name="area"
                          value={form.area}
                          onChange={updateField}
                          required
                        >
                          <option value="">Selecione</option>
                          {areas.map((area) => (
                            <option key={area}>{area}</option>
                          ))}
                        </select>
                      </label>

                      <label className="field-label">
                        Motivo do contato
                        <select
                          className="field-control"
                          name="reason"
                          value={form.reason}
                          onChange={updateField}
                          required
                        >
                          <option value="">Selecione</option>
                          {administratorReasons.map((reason) => (
                            <option key={reason}>{reason}</option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}
                </div>

                <label className="field-label">
                  <span>
                    Descrição do caso{" "}
                    {activeTab === "client" && <RequiredHint />}
                  </span>
                  <textarea
                    className="field-area"
                    name="description"
                    placeholder="Descreva o contexto, histórico e próximos passos necessários."
                    value={form.description}
                    onChange={updateField}
                    required
                  />
                </label>

                <label
                  className={`grid min-h-40 place-items-center gap-2 rounded-lg border-2 border-dashed p-5 text-center transition ${
                    areAttachmentsLocked
                      ? "cursor-not-allowed border-slate-200 bg-slate-50 opacity-75"
                      : isDragging
                        ? "border-fi-orange bg-fi-orangeSoft"
                        : "border-violet-200 bg-gradient-to-br from-violet-50 to-white"
                  }`}
                  aria-disabled={areAttachmentsLocked}
                  onClick={(event) => {
                    if (!areAttachmentsLocked) return;
                    event.preventDefault();
                    setToast("Preencha os campos obrigatórios antes de anexar arquivos.");
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDragOver={(event) => {
                    if (areAttachmentsLocked) {
                      return;
                    }
                    event.preventDefault();
                    setIsDragging(true);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setIsDragging(false);
                    if (areAttachmentsLocked) {
                      setToast("Preencha os campos obrigatórios antes de anexar arquivos.");
                      return;
                    }
                    addFiles(event.dataTransfer.files);
                  }}
                >
                  <input
                    ref={fileInputRef}
                    className="sr-only"
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx"
                    multiple
                    disabled={areAttachmentsLocked}
                    onChange={(event) => addFiles(event.target.files)}
                  />
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-fi-navy text-white">
                    <UploadCloud size={22} />
                  </span>
                  <strong className="text-sm font-black text-fi-navy">
                    Anexe comprovantes e arquivos úteis
                  </strong>
                  <small className="max-w-md text-sm font-medium text-slate-500">
                    {areAttachmentsLocked
                      ? "Preencha os campos obrigatórios para liberar o envio de anexos."
                      : "Arraste arquivos para cá ou clique para selecionar PDFs, imagens, Word e Excel. Limite de 5 arquivos, 10 MB cada."}
                  </small>
                </label>

                {form.attachments.length > 0 && (
                  <ul className="grid gap-2">
                    {form.attachments.map((attachment) => (
                      <li
                        className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-violet-100 bg-white px-3 py-2"
                        key={attachment.id}
                      >
                        <span className="flex min-w-0 items-center gap-2 text-sm font-bold text-slate-600">
                          <FileArchive
                            className="shrink-0 text-fi-orange"
                            size={17}
                          />
                          <span className="truncate">{attachment.name}</span>
                          <span className="shrink-0 text-xs text-slate-400">
                            {formatBytes(attachment.size)}
                          </span>
                        </span>
                        <button
                          className="icon-button shrink-0"
                          type="button"
                          onClick={() => removeAttachment(attachment.id)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                  <button
                    className="button-secondary"
                    type="button"
                    onClick={resetForm}
                  >
                    Limpar
                  </button>
                  <button
                    className="button-primary"
                    type="submit"
                    disabled={recordSaving}
                  >
                    {recordSaving ? (
                      <LoaderCircle
                        className="animate-spin"
                        size={18}
                        aria-hidden="true"
                      />
                    ) : (
                      <Plus size={18} />
                    )}
                    {recordSaving
                      ? form.id
                        ? "Atualizando..."
                        : "Registrando..."
                      : form.id
                        ? "Atualizar contato"
                        : "Registrar contato"}
                  </button>
                </div>
              </form>
            </section>
          )}

          {activeTab === "administrator" &&
            canAccessOwnAdministratorRecords(profile) && (
              <section
                id="administrator-records"
                className="min-w-0 rounded-lg border border-violet-100 bg-white p-5 shadow-glow md:p-6"
              >
                <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                  <div>
                    <h2 className="text-xl font-black text-fi-navy">
                      Minhas solicitações
                    </h2>
                    <p className="mt-1 text-sm font-medium text-slate-500">
                      Acompanhe os contatos registrados por {currentProfileAdministrator}.
                    </p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_minmax(150px,190px)] xl:w-full xl:max-w-[560px]">
                    <label className="relative">
                      <span className="sr-only">Buscar solicitações</span>
                      <Search
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fi-navy/35"
                        size={18}
                      />
                      <input
                        className="field-control pl-10"
                        type="search"
                        placeholder="Buscar por protocolo, e-mail ou motivo"
                        value={administratorSearch}
                        onChange={(event) =>
                          setAdministratorSearch(event.target.value)
                        }
                      />
                    </label>
                    <label className="relative">
                      <span className="sr-only">Filtrar por área</span>
                      <Filter
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fi-navy/35"
                        size={18}
                      />
                      <select
                        className="field-control pl-10"
                        value={administratorAreaFilter}
                        onChange={(event) =>
                          setAdministratorAreaFilter(event.target.value)
                        }
                      >
                        <option value="">Todas as áreas</option>
                        {areas.map((area) => (
                          <option key={area}>{area}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>

                <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <SummaryCard
                    label="Total"
                    value={administratorStats.total}
                  />
                  <SummaryCard
                    label="Em aberto"
                    value={administratorStats.pending}
                    accent="orange"
                  />
                  <SummaryCard
                    label="Concluídas"
                    value={administratorStats.concluded}
                  />
                  <SummaryCard
                    label="Hoje"
                    value={administratorStats.today}
                    accent="orange"
                  />
                </div>

                <div className="rounded-lg border border-violet-100 bg-violet-50/50 p-3">
                  {recordsLoading && (
                    <div className="mb-3 rounded-lg border border-violet-100 bg-white px-4 py-3 text-sm font-extrabold text-fi-navy">
                      Carregando solicitações...
                    </div>
                  )}

                  <div className="grid gap-3">
                    {administratorRecords.map((record) => (
                      <article
                        className="rounded-lg border border-violet-100 bg-white p-4 transition hover:border-fi-orange/35"
                        key={record.id}
                      >
                        <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-[130px_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_130px_140px] xl:items-center">
                          <RecordCell label="Protocolo">
                            <span className="chip max-w-full bg-fi-orangeSoft text-fi-orange">
                              <span className="whitespace-normal break-all leading-tight">
                                {record.protocol}
                              </span>
                            </span>
                          </RecordCell>

                          <RecordCell label="Solicitante">
                            <strong className="block truncate text-sm font-black text-fi-navy">
                              {record.administrator}
                            </strong>
                            <span className="block truncate text-xs font-semibold text-slate-400">
                              {formatDate(record.createdAt)}
                            </span>
                          </RecordCell>

                          <RecordCell label="E-mail">
                            <span className="block truncate text-sm font-semibold text-slate-600">
                              {record.email}
                            </span>
                          </RecordCell>

                          <RecordCell label="Motivo">
                            <span className="block truncate text-sm font-semibold text-slate-600">
                              {record.reason}
                            </span>
                            <span className="mt-1 inline-flex max-w-full text-xs font-bold text-fi-navy/55">
                              <span className="truncate">
                                {record.area || "Sem área"}
                              </span>
                            </span>
                          </RecordCell>

                          <RecordCell label="Status">
                            <span className="chip max-w-full bg-violet-100 text-fi-navy">
                              <span className="truncate">{record.status}</span>
                            </span>
                          </RecordCell>

                          <div className="grid min-w-0 gap-2 sm:grid-cols-[auto_1fr] sm:items-center xl:grid-cols-[auto_auto] xl:justify-end">
                            <span className="chip max-w-max bg-fi-orangeSoft text-fi-orange">
                              {record.attachments.length} anexos
                            </span>
                            <div className="flex flex-wrap gap-2 sm:justify-end">
                              <button
                                className="icon-button"
                                type="button"
                                title="Ver"
                                onClick={() => setSelectedRecord(record)}
                              >
                                <Eye size={16} />
                              </button>
                            </div>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>

                  {administratorRecords.length === 0 && (
                    <div className="grid min-h-52 place-items-center gap-2 px-6 py-12 text-center">
                      <div className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-fi-orangeSoft text-fi-orange">
                        <FileText size={24} />
                      </div>
                      <strong className="text-fi-navy">
                        Nenhuma solicitação encontrada
                      </strong>
                      <span className="max-w-sm text-sm font-medium text-slate-500">
                        Registre um contato ou ajuste a busca e o filtro de área.
                      </span>
                    </div>
                  )}
                </div>
              </section>
            )}

          {activeTab === "operator" && !canAccessOperator(profile) && (
            <section className="mx-auto w-full max-w-xl rounded-lg border border-violet-100 bg-white p-6 shadow-glow">
              <div className="mb-6 text-center">
                <img
                  className="mx-auto mb-4 h-16 w-16 rounded-lg"
                  src={logoUrl}
                  alt="Logo Sofico"
                />
                <p className="text-xs font-black uppercase text-fi-orange">
                  Área do Operador
                </p>
                <h2 className="mt-1 text-2xl font-black text-fi-navy">
                  Login do operador
                </h2>
                <p className="mt-2 text-sm font-semibold text-slate-500">
                  Entre com um usuário operador
                </p>
              </div>

              {session && profile && !canAccessOperator(profile) ? (
                <div className="grid gap-3">
                  <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-3 text-sm font-bold text-red-700">
                    Este usuário não tem permissão de operador.
                  </div>
                  <button
                    className="button-secondary"
                    type="button"
                    onClick={signOutOperator}
                  >
                    Sair e entrar com outro usuário
                  </button>
                </div>
              ) : authLoading ? (
                <div className="rounded-lg border border-violet-100 bg-violet-50 p-4 text-center text-sm font-extrabold text-fi-navy">
                  Verificando sessão...
                </div>
              ) : (
                <form className="grid gap-4" onSubmit={signInOperator}>
                  <label className="field-label">
                    E-mail
                    <input
                      className="field-control"
                      name="email"
                      type="email"
                      placeholder="operador@sofico.com"
                      value={loginForm.email}
                      onChange={updateLoginField}
                      required
                    />
                  </label>

                  <label className="field-label">
                    Senha
                    <input
                      className="field-control"
                      name="password"
                      type="password"
                      placeholder="Digite sua senha"
                      value={loginForm.password}
                      onChange={updateLoginField}
                      required
                    />
                  </label>

                  {loginError && (
                    <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
                      {loginError}
                    </div>
                  )}

                  <button
                    className="button-primary"
                    type="submit"
                    disabled={loginLoading}
                  >
                    {loginLoading
                      ? "Entrando..."
                      : "Entrar na Área do Operador"}
                  </button>
                </form>
              )}
            </section>
          )}

          {activeTab === "operator" && canAccessOperator(profile) && (
            <section
              id="records"
              className="min-w-0 rounded-lg border border-violet-100 bg-white p-5 shadow-glow md:p-6"
            >
              <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <h2 className="text-xl font-black text-fi-navy">Registros</h2>
                  <p className="mt-1 text-sm font-medium text-slate-500">
                    Pesquise, filtre, edite, exclua e baixe anexos cadastrados.
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_minmax(150px,180px)_minmax(150px,180px)] xl:w-full xl:max-w-[760px]">
                  <label className="relative">
                    <span className="sr-only">Buscar registros</span>
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fi-navy/35"
                      size={18}
                    />
                    <input
                      className="field-control pl-10"
                      type="search"
                      placeholder="Buscar por protocolo, nome, e-mail ou motivo"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </label>
                  <label className="relative">
                    <span className="sr-only">Filtrar por tipo</span>
                    <Filter
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fi-navy/35"
                      size={18}
                    />
                    <select
                      className="field-control pl-10"
                      value={typeFilter}
                      onChange={(event) => setTypeFilter(event.target.value)}
                    >
                      <option value="">Todos os tipos</option>
                      <option value="client">Clientes</option>
                      <option value="administrator">Administradoras</option>
                    </select>
                  </label>
                  <label className="relative">
                    <span className="sr-only">Filtrar por área</span>
                    <Filter
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fi-navy/35"
                      size={18}
                    />
                    <select
                      className="field-control pl-10"
                      value={areaFilter}
                      onChange={(event) => setAreaFilter(event.target.value)}
                    >
                      <option value="">Todas as áreas</option>
                      {areas.map((area) => (
                        <option key={area}>{area}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <SummaryCard
                  label="Total filtrado"
                  value={filteredStats.total}
                />
                <SummaryCard
                  label="Em aberto"
                  value={filteredStats.pending}
                  accent="orange"
                />
                <SummaryCard label="Clientes" value={filteredStats.clients} />
                <SummaryCard
                  label="Administradoras"
                  value={filteredStats.administrators}
                  accent="orange"
                />
              </div>

              <div className="rounded-lg border border-violet-100 bg-violet-50/50 p-3">
                {recordsLoading && (
                  <div className="mb-3 rounded-lg border border-violet-100 bg-white px-4 py-3 text-sm font-extrabold text-fi-navy">
                    Carregando solicitações...
                  </div>
                )}

                <div className="grid gap-3">
                  {filteredRecords.map((record) => (
                    <article
                      className="rounded-lg border border-violet-100 bg-white p-4 transition hover:border-fi-orange/35"
                      key={record.id}
                    >
                      <div className="grid min-w-0 gap-3 md:grid-cols-2 2xl:grid-cols-[120px_118px_minmax(0,1.1fr)_minmax(0,1.25fr)_minmax(0,1fr)_150px_220px] 2xl:items-center">
                        <RecordCell label="Protocolo">
                          <span className="chip max-w-full bg-fi-orangeSoft text-fi-orange">
                            <span className="whitespace-normal break-all leading-tight">
                              {record.protocol}
                            </span>
                          </span>
                        </RecordCell>

                        <RecordCell label="Tipo">
                          <span className="chip max-w-full bg-violet-100 text-fi-navy">
                            <span className="truncate">
                              {recordTypes[record.type]}
                            </span>
                          </span>
                        </RecordCell>

                        <RecordCell label="Solicitante">
                          <strong className="block truncate text-sm font-black text-fi-navy">
                            {record.type === "client"
                              ? record.name
                              : record.administrator}
                          </strong>
                          <span className="block truncate text-xs font-semibold text-slate-400">
                            {formatDate(record.createdAt)}
                          </span>
                        </RecordCell>

                        <RecordCell label="E-mail">
                          <span className="block truncate text-sm font-semibold text-slate-600">
                            {record.email}
                          </span>
                        </RecordCell>

                        <RecordCell label="Motivo">
                          <span className="block truncate text-sm font-semibold text-slate-600">
                            {record.reason}
                          </span>
                          <span className="mt-1 inline-flex max-w-full text-xs font-bold text-fi-navy/55">
                            <span className="truncate">
                              {record.area || "Sem área"}
                            </span>
                          </span>
                        </RecordCell>

                        <RecordCell label="Status">
                          <select
                            className="field-control min-h-9 text-xs font-extrabold"
                            value={record.status}
                            onChange={(event) =>
                              updateStatus(record.id, event.target.value)
                            }
                          >
                            {statuses.map((status) => (
                              <option key={status}>{status}</option>
                            ))}
                          </select>
                        </RecordCell>

                        <div className="grid min-w-0 gap-2 sm:grid-cols-[auto_1fr] sm:items-center 2xl:grid-cols-[auto_auto] 2xl:justify-end">
                          <span className="chip max-w-max bg-fi-orangeSoft text-fi-orange">
                            {record.attachments.length} anexos
                          </span>
                          <div className="flex flex-wrap gap-2 sm:justify-end">
                            <button
                              className="icon-button"
                              type="button"
                              title="Ver"
                              onClick={() => setSelectedRecord(record)}
                            >
                              <Eye size={16} />
                            </button>
                            <button
                              className="icon-button"
                              type="button"
                              title="Editar"
                              onClick={() => editRecord(record)}
                            >
                              <Pencil size={16} />
                            </button>
                            <button
                              className="icon-button"
                              type="button"
                              title="Excluir"
                              onClick={() => deleteRecord(record.id)}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>

                {filteredRecords.length === 0 && (
                  <div className="grid min-h-52 place-items-center gap-2 px-6 py-12 text-center">
                    <div className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-fi-orangeSoft text-fi-orange">
                      <FileText size={24} />
                    </div>
                    <strong className="text-fi-navy">
                      Nenhum contato encontrado
                    </strong>
                    <span className="max-w-sm text-sm font-medium text-slate-500">
                      Cadastre o primeiro caso ou ajuste a busca e o filtro de
                      área.
                    </span>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </main>

      {selectedRecord && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-fi-navy/55 p-4">
          <article className="modal-scroll max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl md:p-6">
            <header className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase text-fi-orange">
                  Detalhes do contato
                </p>
                <h2 className="text-2xl font-black text-fi-navy">
                  {selectedRecord.protocol} ·{" "}
                  {selectedRecord.type === "client"
                    ? selectedRecord.name
                    : selectedRecord.administrator}
                </h2>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setSelectedRecord(null)}
              >
                <X size={18} />
              </button>
            </header>

            <div className="grid gap-3 md:grid-cols-2">
              <Detail label="Protocolo" value={selectedRecord.protocol} />
              <Detail label="Tipo" value={recordTypes[selectedRecord.type]} />
              {canAccessOperator(profile) ? (
                <div className="rounded-lg border border-violet-100 bg-violet-50/65 p-4">
                  <span className="text-xs font-black uppercase text-fi-navy/55">
                    Status
                  </span>
                  <select
                    className="field-control mt-2"
                    value={selectedRecord.status}
                    onChange={(event) =>
                      updateStatus(selectedRecord.id, event.target.value)
                    }
                  >
                    {statuses.map((status) => (
                      <option key={status}>{status}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <Detail label="Status" value={selectedRecord.status} />
              )}
              {selectedRecord.type === "client" ? (
                <>
                  <Detail label="Nome" value={selectedRecord.name} />
                  <Detail
                    label="Telefone ou Whatsapp"
                    value={selectedRecord.phone}
                  />
                  <Detail
                    label="Condomínio"
                    value={selectedRecord.condominium}
                  />
                  <Detail
                    label="Complemento"
                    value={selectedRecord.complement || "-"}
                  />
                </>
              ) : (
                <Detail
                  label="Administradora"
                  value={selectedRecord.administrator}
                />
              )}
              <Detail label="E-mail" value={selectedRecord.email} />
              {selectedRecord.type === "administrator" && (
                <Detail label="Área" value={selectedRecord.area} />
              )}
              <Detail label="Motivo" value={selectedRecord.reason} />
              <Detail
                label="Descrição do caso"
                value={selectedRecord.description}
                wide
              />
              <Detail
                label="Criado em"
                value={formatDate(selectedRecord.createdAt)}
              />
              <Detail
                label="Atualizado em"
                value={formatDate(selectedRecord.updatedAt)}
              />
              <div className="rounded-lg border border-violet-100 bg-violet-50/65 p-4 md:col-span-2">
                <span className="text-xs font-black uppercase text-fi-navy/55">
                  Anexos
                </span>
                <div className="mt-3 grid gap-2">
                  {selectedRecord.attachments.length > 0 ? (
                    selectedRecord.attachments.map((attachment) => (
                      <a
                        className="flex min-h-11 items-center gap-2 rounded-lg bg-white px-3 text-sm font-extrabold text-fi-navy transition hover:text-fi-orange"
                        download={attachment.name}
                        href={attachment.dataUrl}
                        key={attachment.id}
                      >
                        <Download size={16} />
                        <span className="truncate">{attachment.name}</span>
                        <span className="ml-auto shrink-0 text-xs text-slate-400">
                          {formatBytes(attachment.size)}
                        </span>
                      </a>
                    ))
                  ) : (
                    <p className="m-0 text-sm font-semibold text-slate-500">
                      Nenhum anexo cadastrado.
                    </p>
                  )}
                </div>
              </div>
            </div>

            <footer className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-end">
              {canAccessOperator(profile) && (
                <button
                  className="button-secondary"
                  type="button"
                  onClick={() => editRecord(selectedRecord)}
                >
                  <Pencil size={18} />
                  Editar
                </button>
              )}
              <button
                className="button-primary"
                type="button"
                onClick={() => setSelectedRecord(null)}
              >
                Fechar
              </button>
            </footer>
          </article>
        </div>
      )}

      <div
        className={`fixed bottom-5 right-5 z-50 max-w-[calc(100vw-2.5rem)] rounded-lg bg-fi-navy px-4 py-3 text-sm font-extrabold text-white shadow-2xl transition ${
          toast
            ? "translate-y-0 opacity-100"
            : "pointer-events-none translate-y-4 opacity-0"
        }`}
      >
        {toast}
      </div>

      {showCreateUserModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
          <div className="max-w-md w-full rounded-lg bg-white p-6 shadow-2xl">
            <h2 className="mb-4 text-2xl font-black text-fi-navy">
              Cadastrar Novo Usuário
            </h2>
            <form className="grid gap-4" onSubmit={createNewUser}>
              <div>
                <label className="block text-xs font-black uppercase text-fi-navy/55 mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={createUserForm.email}
                  onChange={(e) =>
                    setCreateUserForm({
                      ...createUserForm,
                      email: e.target.value,
                    })
                  }
                  required
                  className="w-full rounded-lg border border-violet-100 bg-white px-3 py-2 text-sm font-medium placeholder-gray-400 outline-none transition focus:border-fi-orange focus:ring-1 focus:ring-fi-orange"
                  placeholder="seu-email@example.com"
                />
              </div>

              <div>
                <label className="block text-xs font-black uppercase text-fi-navy/55 mb-2">
                  Senha
                </label>
                <input
                  type="password"
                  value={createUserForm.password}
                  onChange={(e) =>
                    setCreateUserForm({
                      ...createUserForm,
                      password: e.target.value,
                    })
                  }
                  required
                  className="w-full rounded-lg border border-violet-100 bg-white px-3 py-2 text-sm font-medium placeholder-gray-400 outline-none transition focus:border-fi-orange focus:ring-1 focus:ring-fi-orange"
                  placeholder="••••••••"
                />
              </div>

              <div>
                <label className="block text-xs font-black uppercase text-fi-navy/55 mb-2">
                  Nível de Acesso
                </label>
                <select
                  value={createUserForm.role}
                  onChange={(e) =>
                    setCreateUserForm({
                      ...createUserForm,
                      role: e.target.value as "administradora" | "operador",
                    })
                  }
                  className="w-full rounded-lg border border-violet-100 bg-white px-3 py-2 text-sm font-medium outline-none transition focus:border-fi-orange focus:ring-1 focus:ring-fi-orange"
                >
                  <option value="administradora">Administradora</option>
                  <option value="operador">Operador</option>
                </select>
              </div>

              {createUserForm.role === "administradora" && (
                <div>
                  <label className="block text-xs font-black uppercase text-fi-navy/55 mb-2">
                    Administradora
                  </label>
                  <select
                    value={createUserForm.administradora}
                    onChange={(e) =>
                      setCreateUserForm({
                        ...createUserForm,
                        administradora: e.target.value,
                      })
                    }
                    className="w-full rounded-lg border border-violet-100 bg-white px-3 py-2 text-sm font-medium placeholder-gray-400 outline-none transition focus:border-fi-orange focus:ring-1 focus:ring-fi-orange"
                    required
                  >
                    <option value="">Selecione</option>
                    {administrators.map((administrator) => (
                      <option key={administrator}>{administrator}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateUserModal(false)}
                  className="button-secondary flex-1"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={createUserLoading}
                  className="button-primary flex-1"
                >
                  {createUserLoading ? "Criando..." : "Criar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

type MetricProps = {
  label: string;
  value: number;
};

type RecordCellProps = {
  label: string;
  children: React.ReactNode;
};

type RequiredHintProps = {
  label?: string;
};

function RequiredHint({ label = "Campo obrigatório" }: RequiredHintProps) {
  return (
    <span
      className="align-super text-xs font-black text-fi-orange"
      title={label}
      aria-label={label}
    >
      *
    </span>
  );
}

// Célula reutilizada nos cards do operador para manter alinhamento e truncamento consistentes.
function RecordCell({ label, children }: RecordCellProps) {
  return (
    <div className="min-w-0">
      <span className="mb-1 block truncate text-[0.68rem] font-black uppercase text-fi-navy/45">
        {label}
      </span>
      {children}
    </div>
  );
}

// Indicador compacto usado na sidebar.
function Metric({ label, value }: MetricProps) {
  return (
    <div className="rounded-lg border border-white/12 bg-white/8 p-4">
      <span className="text-xs font-black uppercase text-white/55">
        {label}
      </span>
      <strong className="mt-1 block text-3xl font-black">{value}</strong>
    </div>
  );
}

type SummaryCardProps = {
  label: string;
  value: number;
  accent?: "navy" | "orange";
};

// Indicadores da área do operador, sempre baseados nos filtros atuais.
function SummaryCard({ label, value, accent = "navy" }: SummaryCardProps) {
  const colorClass =
    accent === "orange"
      ? "bg-fi-orangeSoft text-fi-orange"
      : "bg-violet-100 text-fi-navy";

  return (
    <div className="rounded-lg border border-violet-100 bg-white p-4">
      <span className="text-xs font-black uppercase text-slate-400">
        {label}
      </span>
      <div className="mt-2 flex items-center justify-between">
        <strong className="text-3xl font-black text-fi-navy">{value}</strong>
        <span className={`h-3 w-3 rounded-full ${colorClass}`} />
      </div>
    </div>
  );
}

type DetailProps = {
  label: string;
  value: React.ReactNode;
  wide?: boolean;
};

// Bloco de detalhe do modal; aceita conteúdo longo sem empurrar o layout.
function Detail({ label, value, wide }: DetailProps) {
  return (
    <div
      className={`rounded-lg border border-violet-100 bg-violet-50/65 p-4 ${wide ? "md:col-span-2" : ""}`}
    >
      <span className="text-xs font-black uppercase text-fi-navy/55">
        {label}
      </span>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm font-semibold text-fi-ink">
        {value}
      </p>
    </div>
  );
}

export default App;
