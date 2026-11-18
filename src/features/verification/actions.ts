"use server";

import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireMember } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { reportError } from "@/lib/monitoring/report";
import { decideProof } from "@/features/verification/providers/policy";
import { createSheerIdVerification, fetchSheerIdDetails, normalizeSheerId, sheerIdHostedUrl } from "@/features/verification/providers/sheerid";
import { simulatedProof } from "@/features/verification/providers/simulated";
import type { ClaimType, NormalizedProof, ProviderConfig, ProviderKey } from "@/features/verification/providers/types";
import { liveProvidersEnabled, verificationEnv } from "@/features/verification/queries";

/**
 * Provider-based verification, off unless a provider is approved in verification_provider_configs AND
 * switched on for this environment. Members can only start, retry and cancel attempts. A result is
 * recorded by the webhook's trusted writer or by an administrator's check; neither issues a credential.
 * Approval stays with the existing reviewer flow (approve_verification).
 */
const uuid = z.string().uuid();
const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};
const db = async () => (await createClient()) as unknown as SupabaseClient;
const UNAVAILABLE = "That verification provider is not available.";

const sheerIdEnv = () => {
  const programId = process.env.SHEERID_PROGRAM_ID;
  const token = process.env.SHEERID_ACCESS_TOKEN;
  return process.env.SHEERID_ENABLED === "true" && programId && token ? { programId, token } : null;
};

function memberBack(requestId: string | null, kind: "notice" | "error", message: string): never {
  const q = new URLSearchParams();
  if (requestId) q.set("request", requestId);
  q.set(kind, message.slice(0, 200));
  revalidatePath("/verification", "layout");
  redirect(`/verification/student?${q.toString()}`);
}

function adminBack(requestId: string | null, kind: "notice" | "error", message: string): never {
  const q = new URLSearchParams({ tab: "review" });
  if (requestId) q.set("request", requestId);
  q.set(kind, message.slice(0, 200));
  revalidatePath("/admin/student-verifications");
  redirect(`/admin/student-verifications?${q.toString()}`);
}

async function loadConfig(supabase: SupabaseClient, provider: ProviderKey): Promise<ProviderConfig | null> {
  const { data } = await supabase.from("verification_provider_configs").select("*").eq("provider", provider).maybeSingle();
  if (!data) return null;
  return { provider, enabled: data.enabled, environment: data.environment, contractState: data.contract_state, claims: data.claims };
}

/** Member: start (or retry) provider verification. Creates the request if needed, then an attempt. */
export async function startProviderVerification(formData: FormData): Promise<void> {
  const { user } = await requireMember();
  const institutionId = str(formData, "institutionId");
  const provider = str(formData, "provider") as ProviderKey;
  const existing = str(formData, "requestId");
  const known = uuid.safeParse(existing).success ? existing : null;
  if (!uuid.safeParse(institutionId).success || (provider !== "sheerid" && provider !== "simulated")) memberBack(known, "error", UNAVAILABLE);
  const limited = await checkRateLimit("verification", user.id);
  if (!limited.ok) memberBack(known, "error", limited.message);
  const env = verificationEnv();
  // The simulator can never run in production, whatever the database says.
  if (provider === "simulated" && env === "production") memberBack(known, "error", UNAVAILABLE);
  if (provider === "sheerid" && !liveProvidersEnabled()) memberBack(known, "error", UNAVAILABLE);

  const supabase = await db();
  const config = await loadConfig(supabase, provider);
  if (!config || !config.enabled || config.environment !== env) memberBack(known, "error", UNAVAILABLE);

  const { data: requestId, error: requestError } = await supabase.rpc("start_provider_request", { p_institution: institutionId });
  if (requestError || typeof requestId !== "string") memberBack(known, "error", requestError?.message.slice(0, 160) ?? "Could not start verification.");

  let providerAttemptId: string | null = null;
  let redirectTo: string | null = null;
  if (provider === "sheerid") {
    const sheer = sheerIdEnv();
    if (!sheer) memberBack(requestId, "error", UNAVAILABLE);
    try {
      providerAttemptId = await createSheerIdVerification(sheer);
      redirectTo = sheerIdHostedUrl(sheer.programId, providerAttemptId);
    } catch (error) {
      reportError("verification.sheerid_create", error);
      memberBack(requestId, "error", "The verification provider is unavailable right now. Please try again later.");
    }
  }
  const { data: attemptId, error } = await supabase.rpc("start_provider_attempt", {
    p_request: requestId, p_provider: provider, p_provider_attempt_id: providerAttemptId,
  });
  if (error || typeof attemptId !== "string") memberBack(requestId, "error", error?.message.slice(0, 160) ?? "Could not start verification.");
  await supabase.rpc("set_attempt_progress", { p_attempt: attemptId, p_state: "redirected" });
  if (redirectTo) redirect(redirectTo);
  memberBack(requestId, "notice", "Verification started.");
}

/** Member: cancel an open attempt. History is kept. */
export async function cancelProviderAttempt(formData: FormData): Promise<void> {
  const { user } = await requireMember();
  const attemptId = str(formData, "attemptId");
  const requestId = str(formData, "requestId");
  const known = uuid.safeParse(requestId).success ? requestId : null;
  if (!uuid.safeParse(attemptId).success) memberBack(known, "error", "Unknown attempt.");
  const limited = await checkRateLimit("verification", user.id);
  if (!limited.ok) memberBack(known, "error", limited.message);
  const { error } = await (await db()).rpc("set_attempt_progress", { p_attempt: attemptId, p_state: "cancelled" });
  if (error) memberBack(known, "error", "That attempt cannot be cancelled.");
  memberBack(known, "notice", "Attempt cancelled.");
}

/**
 * Administrator: fetch the provider's authoritative result for one attempt (the simulator in
 * development), apply the policy and record it. Safe to repeat.
 */
export async function checkProviderAttempt(formData: FormData): Promise<void> {
  const { user } = await requireAdmin();
  const attemptId = str(formData, "attemptId");
  const requestId = str(formData, "requestId");
  const known = uuid.safeParse(requestId).success ? requestId : null;
  if (!uuid.safeParse(attemptId).success) adminBack(known, "error", "Unknown attempt.");
  const limited = await checkRateLimit("api", user.id);
  if (!limited.ok) adminBack(known, "error", limited.message);
  const kindRaw = str(formData, "simulate");
  const kind = kindRaw === "member" || kindRaw === "no_link" ? kindRaw : "student";
  const env = verificationEnv();
  const supabase = await db();
  const { data: attempt } = await supabase
    .from("verification_attempts").select("id, provider, claim_type, provider_attempt_id").eq("id", attemptId).maybeSingle();
  if (!attempt) adminBack(known, "error", "Unknown attempt.");
  const provider = attempt.provider as ProviderKey;
  const config = await loadConfig(supabase, provider);
  if (!config) adminBack(known, "error", "Provider not configured.");

  let proof: NormalizedProof;
  try {
    if (provider === "simulated") {
      if (env === "production") adminBack(known, "error", "The simulator is disabled in production.");
      proof = simulatedProof(attempt.id, kind);
    } else if (provider === "sheerid") {
      const sheer = sheerIdEnv();
      if (!sheer || !liveProvidersEnabled() || !attempt.provider_attempt_id) adminBack(known, "error", "That provider is not configured.");
      const details = await fetchSheerIdDetails(sheer, attempt.provider_attempt_id);
      proof = normalizeSheerId(details, { verificationId: attempt.provider_attempt_id, now: new Date(), testMode: config.contractState !== "live" });
    } else {
      adminBack(known, "error", "No adapter is implemented for that provider yet.");
    }
  } catch (error) {
    // redirect() throws a control-flow error; let it through untouched.
    if (error && typeof error === "object" && "digest" in error) throw error;
    reportError("verification.provider_fetch", error);
    adminBack(known, "error", "The provider could not be reached. Nothing was recorded.");
  }

  const decision = decideProof(proof, { requested: attempt.claim_type as ClaimType, config, env });
  const hash = createHash("sha256").update([provider, attempt.id, proof.outcome, decision.state, decision.reason].join("|")).digest("hex");
  const { error } = await supabase.rpc("record_provider_result", {
    p_attempt: attempt.id, p_event_hash: hash, p_outcome: proof.outcome, p_state: decision.state,
    p_linkage: proof.accountLinkage, p_issuer_validated: proof.issuerValidated, p_valid_until: proof.validUntil ?? null,
    p_subject_hash: proof.providerSubjectHash ?? null, p_digest: proof.evidenceDigest ?? null,
  });
  if (error) adminBack(known, "error", error.message.slice(0, 160));
  adminBack(known, "notice", `Recorded: ${decision.state} (${decision.reason}).`);
}

/** Administrator: copy a strong, policy-eligible result into the checklist. Approval is a separate step. */
export async function applyProviderResult(formData: FormData): Promise<void> {
  const { user } = await requireAdmin();
  const requestId = str(formData, "requestId");
  if (!uuid.safeParse(requestId).success) adminBack(null, "error", "Unknown request.");
  const limited = await checkRateLimit("api", user.id);
  if (!limited.ok) adminBack(requestId, "error", limited.message);
  const { error } = await (await db()).rpc("apply_provider_result_to_review", { p_request: requestId });
  if (error) adminBack(requestId, "error", error.message.slice(0, 160));
  adminBack(requestId, "notice", "Provider result copied into the checklist. Review it, then approve.");
}
