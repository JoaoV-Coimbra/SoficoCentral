import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type UserRole = "administradora" | "operador";

type CreateUserPayload = {
  email?: string;
  password?: string;
  role?: UserRole;
  administradora?: string | null;
};

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

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Método não permitido." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authHeader = request.headers.get("Authorization");

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Edge Function sem variáveis do Supabase configuradas." }, 500);
  }

  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Usuário não autenticado." }, 401);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const token = authHeader.replace("Bearer ", "");
  const { data: callerData, error: callerError } = await adminClient.auth.getUser(token);

  if (callerError || !callerData.user) {
    return jsonResponse({ error: "Sessão inválida." }, 401);
  }

  const { data: callerProfile, error: profileError } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", callerData.user.id)
    .maybeSingle();

  if (profileError) {
    return jsonResponse({ error: profileError.message }, 500);
  }

  if (!callerProfile || !["operador", "admin"].includes(callerProfile.role)) {
    return jsonResponse({ error: "Apenas operador ou admin pode criar usuários." }, 403);
  }

  const payload = (await request.json().catch(() => ({}))) as CreateUserPayload;
  const email = payload.email?.trim().toLowerCase();
  const password = payload.password || "";
  const role = payload.role;
  const administradora = payload.administradora?.trim() || null;

  if (!email || !password || !role) {
    return jsonResponse({ error: "E-mail, senha e role são obrigatórios." }, 400);
  }

  if (!["administradora", "operador"].includes(role)) {
    return jsonResponse({ error: "Role inválida." }, 400);
  }

  if (password.length < 6) {
    return jsonResponse({ error: "A senha precisa ter pelo menos 6 caracteres." }, 400);
  }

  const { data: createdUser, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError || !createdUser.user) {
    return jsonResponse({ error: createError?.message || "Não foi possível criar o usuário." }, 400);
  }

  const profilePayload = {
    id: createdUser.user.id,
    email,
    role,
    administradora: role === "administradora" ? administradora : null,
  };

  let { error: profileInsertError } = await adminClient.from("profiles").upsert(profilePayload);

  if (profileInsertError?.message?.includes("administradora")) {
    const fallbackPayload = {
      id: createdUser.user.id,
      email,
      role,
      administrador: role === "administradora" ? administradora : null,
    };

    const fallbackResult = await adminClient.from("profiles").upsert(fallbackPayload);
    profileInsertError = fallbackResult.error;
  }

  if (profileInsertError) {
    await adminClient.auth.admin.deleteUser(createdUser.user.id);
    return jsonResponse({ error: profileInsertError.message }, 500);
  }

  return jsonResponse({
    user: {
      id: createdUser.user.id,
      email,
      role,
      administradora: role === "administradora" ? administradora : null,
    },
  });
});
