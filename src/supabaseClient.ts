import { createClient } from "@supabase/supabase-js";

// Chaves públicas do Supabase carregadas pelo Vite a partir do .env local.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Client único usado pelo Auth; a anon key pode existir no front-end, a service_role nunca.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
