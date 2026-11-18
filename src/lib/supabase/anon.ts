import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "./env";

/**
 * A cookie-less, session-less client for the trusted provider writer only. It uses the publishable
 * key like everything else; its power comes from a separate writer key checked inside the database
 * functions it calls. It never carries a member session and never sees a secret/service_role key.
 */
export function createAnonClient() {
  const env = getSupabaseEnv();
  if (!env) return null;
  return createClient(env.url, env.key, { auth: { persistSession: false, autoRefreshToken: false } });
}
