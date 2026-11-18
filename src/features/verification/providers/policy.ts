import type { AttemptState, ClaimType, NormalizedProof, ProviderConfig, VerificationEnv } from "./types";

export type PolicyDecision = {
  state: Extract<AttemptState, "proof_received" | "requires_review" | "rejected" | "provider_error">;
  reason: string;
};

/** Longest a provider result may be trusted without a fresh check. Medyra's own policy, not a legal rule. */
export const MAX_PROOF_AGE_DAYS = 365;

/**
 * Decides what a provider result can support. It never issues a credential: "proof_received" means a
 * reviewer may approve; anything weaker goes to review or is refused. Fails closed.
 */
export function decideProof(
  proof: NormalizedProof,
  ctx: { requested: ClaimType; config: ProviderConfig; env: VerificationEnv; now?: Date },
): PolicyDecision {
  const now = ctx.now ?? new Date();
  const { config } = ctx;
  if (proof.provider !== config.provider) return { state: "provider_error", reason: "provider_mismatch" };
  if (!config.enabled || (config.contractState !== "sandbox" && config.contractState !== "live"))
    return { state: "provider_error", reason: "provider_not_approved" };
  if (config.environment !== ctx.env) return { state: "provider_error", reason: "wrong_environment" };
  if (!config.claims.includes(ctx.requested)) return { state: "provider_error", reason: "claim_not_enabled" };
  // Test data is never real enrolment in production.
  if (ctx.env === "production" && (proof.simulated || proof.sandbox || config.contractState !== "live"))
    return { state: "provider_error", reason: "test_proof_in_production" };
  if (proof.outcome === "negative") return { state: "rejected", reason: "provider_negative" };
  if (proof.outcome === "indeterminate") return { state: "requires_review", reason: "provider_indeterminate" };
  if (proof.claimType !== ctx.requested) return { state: "requires_review", reason: "claim_mismatch" };
  // General student status never proves a program.
  if (ctx.requested === "CURRENT_PROGRAM_STUDENT" && !proof.programStated)
    return { state: "requires_review", reason: "program_not_proved" };
  const verified = Date.parse(proof.verifiedAt);
  if (Number.isNaN(verified) || verified > now.getTime() + 60_000)
    return { state: "requires_review", reason: "bad_timestamp" };
  if (now.getTime() - verified > MAX_PROOF_AGE_DAYS * 86_400_000)
    return { state: "requires_review", reason: "proof_too_old" };
  if (proof.validUntil && Date.parse(proof.validUntil) <= now.getTime())
    return { state: "requires_review", reason: "proof_expired" };
  if (proof.accountLinkage !== "strong" || !proof.providerSubjectHash)
    return { state: "requires_review", reason: "account_link_not_strong" };
  if (!proof.issuerValidated) return { state: "requires_review", reason: "issuer_not_validated" };
  return { state: "proof_received", reason: "ok" };
}
