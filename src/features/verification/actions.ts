"use server";

import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireMember } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { reportError } from "@/lib/monitoring/report";
import { decideProof } from "@/features/verification/providers/policy";
import { createSheerIdVerification, fetchSheerIdDetails, normalizeSheerId, sheerIdHostedUrl } from "@/features/verification/providers/sheerid";
import { simulatedProof } from "@/features/verification/providers/simulated";
import type { ClaimType, NormalizedProof, ProviderConfig, ProviderKey, VerificationEnv } from "@/features/verification/providers/types";

/**
 * Provider-based verification. Disabled by default: a provider must be approved in
 * verification_provider_configs AND VERIFICATION_LIVE_PROVIDERS_ENABLED=true. A member can only start
 * an attempt. The result is fetched from the provider by an administrator's action and recorded by
 * a database function that only administrators can call; nothing here issues a credential.
 */
export type ProviderResult = { ok: true; message: string } | { ok: false; error: string };

const uuid = z.string().uuid();
const db = async () => (await createClient()) as unknown as SupabaseClient;
const verificationEnv = (): VerificationEnv => {
  const v = process.env.VERIFICATION_ENV;
  return v === "production" || v === "staging" ? v : "development";
};
const liveEnabled = () => process.env.VERIFICATION_LIVE_PROVIDERS_ENABLED === "true";
const sheerIdEnv = () => {
  const programId = process.env.SHEERID_PROGRAM_ID;
  const token = process.env.SHEERID_ACCESS_TOKEN;
  return process.env.SHEERID_ENABLED === "true" && programId && token ? { programId, token } : null;
};

async function loadConfig(supabase: SupabaseClient, provider: ProviderKey): Promise<ProviderConfig | null> {
  const { data } = await supabase.from("verification_provider_configs").select("*").eq("provider", provider).maybeSingle();
  if (!data) return null;
  return { provider, enabled: data.enabled, environment: data.environment, contractState: data.contract_state, claims: data.claims };
}

/** Member: start an attempt. Returns the provider URL for the browser to open, or an error. */
export async function beginProviderAttempt(institutionId: string, provider: "sheerid" | "simulated"): Promise<ProviderResult> {
  const { user } = await requireMember();
  if (!uuid.safeParse(institutionId).success) return { ok: false, error: "Unknown institution." };
  const limited = await checkRateLimit("verification", user.id);
  if (!limited.ok) return { ok: false, error: limited.message };
  const env = verificationEnv();
  // The simulator can never run in production, whatever the database says.
  if (provider === "simulated" && env === "production") return { ok: false, error: "That verification provider is not available." };
  if (provider !== "simulated" && !liveEnabled()) return { ok: false, error: "That verification provider is not available." };

  const supabase = await db();
  const config = await loadConfig(supabase, provider);
  if (!config || !config.enabled || config.environment !== env) return { ok: false, error: "That verification provider is not available." };

  let providerAttemptId: string | null = null;
  let redirectTo: string | null = null;
  if (provider === "sheerid") {
    const sheer = sheerIdEnv();
    if (!sheer) return { ok: false, error: "That verification provider is not available." };
    try {
      providerAttemptId = await createSheerIdVerification(sheer);
      redirectTo = sheerIdHostedUrl(sheer.programId, providerAttemptId);
    } catch (error) {
      reportError("verification.sheerid_create", error);
      return { ok: false, error: "The verification provider is unavailable right now. Please try again later." };
    }
  }
  const { data, error } = await supabase.rpc("start_provider_attempt", {
    p_institution: institutionId, p_provider: provider, p_claim: "CURRENT_STUDENT", p_provider_attempt_id: providerAttemptId,
  });
  if (error || typeof data !== "string") return { ok: false, error: error?.message.slice(0, 160) ?? "Could not start verification." };
  await supabase.rpc("set_attempt_progress", { p_attempt: data, p_state: "redirected" });
  if (redirectTo) redirect(redirectTo);
  return { ok: true, message: "Attempt started." };
}

/**
 * Administrator: fetch the provider's authoritative result for an attempt, apply the policy and
 * record the outcome. Safe to repeat: the same provider answer produces the same event hash.
 */
export async function confirmProviderAttempt(attemptId: string, simulatedKind: "student" | "member" | "no_link" = "student"): Promise<ProviderResult> {
  const { user } = await requireAdmin();
  if (!uuid.safeParse(attemptId).success) return { ok: false, error: "Unknown attempt." };
  const limited = await checkRateLimit("api", user.id);
  if (!limited.ok) return { ok: false, error: limited.message };
  const env = verificationEnv();
  const supabase = await db();
  const { data: attempt } = await supabase
    .from("verification_attempts")
    .select("id, provider, claim_type, provider_attempt_id")
    .eq("id", attemptId)
    .maybeSingle();
  if (!attempt) return { ok: false, error: "Unknown attempt." };
  const provider = attempt.provider as ProviderKey;
  const config = await loadConfig(supabase, provider);
  if (!config) return { ok: false, error: "Provider not configured." };

  let proof: NormalizedProof;
  try {
    if (provider === "simulated") {
      if (env === "production") return { ok: false, error: "The simulator is disabled in production." };
      proof = simulatedProof(attempt.id, simulatedKind);
    } else if (provider === "sheerid") {
      const sheer = sheerIdEnv();
      if (!sheer || !liveEnabled() || !attempt.provider_attempt_id) return { ok: false, error: "That provider is not configured." };
      const details = await fetchSheerIdDetails(sheer, attempt.provider_attempt_id);
      proof = normalizeSheerId(details, { verificationId: attempt.provider_attempt_id, now: new Date(), testMode: config.contractState !== "live" });
    } else {
      return { ok: false, error: "No adapter is implemented for that provider yet." };
    }
  } catch (error) {
    reportError("verification.provider_fetch", error);
    return { ok: false, error: "The provider could not be reached. Nothing was recorded." };
  }

  const decision = decideProof(proof, { requested: attempt.claim_type as ClaimType, config, env });
  // Same provider answer -> same hash, so a repeat is a no-op in the database.
  const eventHash = createHash("sha256").update(`${provider}|${attempt.id}|${proof.outcome}|${decision.state}|${decision.reason}`).digest("hex");
  const { error } = await supabase.rpc("record_provider_result", {
    p_attempt: attempt.id, p_event_hash: eventHash, p_outcome: proof.outcome, p_state: decision.state,
    p_linkage: proof.accountLinkage, p_issuer_validated: proof.issuerValidated, p_valid_until: proof.validUntil ?? null,
    p_subject_hash: proof.providerSubjectHash ?? null, p_digest: proof.evidenceDigest ?? null,
  });
  if (error) return { ok: false, error: error.message.slice(0, 160) };
  return { ok: true, message: `Recorded: ${decision.state} (${decision.reason}).` };
}
