import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { AttemptState, ProviderKey, VerificationEnv } from "@/features/verification/providers/types";

export const verificationEnv = (): VerificationEnv => {
  const v = process.env.VERIFICATION_ENV;
  return v === "production" || v === "staging" ? v : "development";
};
export const liveProvidersEnabled = () => process.env.VERIFICATION_LIVE_PROVIDERS_ENABLED === "true";

const db = async () => (await createClient()) as unknown as SupabaseClient;

/** Providers a member may start right now: approved in the database AND switched on in this environment. */
export async function listAvailableProviders(): Promise<ProviderKey[]> {
  const env = verificationEnv();
  const { data } = await (await db())
    .from("verification_provider_configs")
    .select("provider, enabled, environment")
    .eq("enabled", true)
    .eq("environment", env);
  const rows = (data ?? []) as { provider: ProviderKey }[];
  return rows
    .map((r) => r.provider)
    .filter((p) => (p === "simulated" ? env !== "production" : liveProvidersEnabled() && p === "sheerid" && process.env.SHEERID_ENABLED === "true"));
}

export type ProviderAttemptRow = {
  id: string;
  provider: ProviderKey;
  state: AttemptState;
  linkage: "strong" | "partial" | "unresolved" | null;
  issuer_validated: boolean | null;
  valid_until: string | null;
  last_checked_at: string | null;
  created_at: string;
  expires_at: string;
  environment: VerificationEnv;
};

/** RLS limits this to the request's owner and administrators. Newest first; history is never deleted. */
export async function listProviderAttempts(requestId: string): Promise<ProviderAttemptRow[]> {
  const { data } = await (await db())
    .from("verification_attempts")
    .select("id, provider, state, linkage, issuer_validated, valid_until, last_checked_at, created_at, expires_at, environment")
    .eq("request_id", requestId)
    .order("created_at", { ascending: false });
  return (data ?? []) as ProviderAttemptRow[];
}

/** What a reviewer should read from an attempt: eligible, or exactly what blocks it. */
export function attemptEligibility(a: ProviderAttemptRow, now = new Date()): { eligible: boolean; blockers: string[] } {
  const blockers: string[] = [];
  if (a.state !== "proof_received") blockers.push(`State is "${a.state}", not a recorded provider result.`);
  if (a.linkage !== "strong") blockers.push("Account link is not strong: the identity checklist must be done by hand.");
  if (a.issuer_validated !== true) blockers.push("The issuer is not validated.");
  if (a.valid_until && Date.parse(a.valid_until) <= now.getTime()) blockers.push("The proof has expired.");
  if (a.environment === "production" && a.provider === "simulated") blockers.push("Test results are refused in production.");
  return { eligible: blockers.length === 0, blockers };
}
