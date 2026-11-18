import "server-only";
import { createHash } from "node:crypto";
import { createAnonClient } from "@/lib/supabase/anon";
import type { PolicyDecision } from "@/features/verification/providers/policy";
import type { ClaimType, NormalizedProof, ProviderConfig, ProviderKey } from "@/features/verification/providers/types";

/**
 * The only module that records a provider result without a signed-in administrator. It talks to two
 * database functions that check VERIFICATION_WRITER_KEY (its SHA-256 is stored by an administrator).
 * It can only record a result on an attempt that already exists; it cannot approve anything.
 */
const writerKey = () => {
  const key = process.env.VERIFICATION_WRITER_KEY;
  return key && key.length >= 32 ? key : null;
};
export const isWriterConfigured = () => writerKey() !== null;

export type AttemptContext = { attemptId: string; claim: ClaimType; state: string; config: ProviderConfig };

export async function getAttemptContext(provider: ProviderKey, providerAttemptId: string): Promise<AttemptContext | null> {
  const key = writerKey();
  const client = createAnonClient();
  if (!key || !client) throw new Error("writer_not_configured");
  const { data, error } = await client.rpc("provider_attempt_context", {
    p_secret: key, p_provider: provider, p_provider_attempt_id: providerAttemptId,
  });
  if (error) throw new Error(`writer_context_${error.code ?? "error"}`);
  const row = (Array.isArray(data) ? data[0] : data) as
    | { attempt_id: string; claim_type: ClaimType; state: string; enabled: boolean; environment: ProviderConfig["environment"]; contract_state: ProviderConfig["contractState"]; claims: ClaimType[] }
    | undefined;
  if (!row) return null;
  return {
    attemptId: row.attempt_id, claim: row.claim_type, state: row.state,
    config: { provider, enabled: row.enabled, environment: row.environment, contractState: row.contract_state, claims: row.claims },
  };
}

/** Same provider answer -> same hash, so a retried delivery is a no-op in the database. */
export const eventHash = (provider: ProviderKey, providerAttemptId: string, proof: NormalizedProof, decision: PolicyDecision) =>
  createHash("sha256").update([provider, providerAttemptId, proof.outcome, decision.state, decision.reason].join("|")).digest("hex");

export async function recordVerifiedResult(
  provider: ProviderKey, providerAttemptId: string, proof: NormalizedProof, decision: PolicyDecision,
): Promise<string> {
  const key = writerKey();
  const client = createAnonClient();
  if (!key || !client) throw new Error("writer_not_configured");
  const { data, error } = await client.rpc("ingest_provider_result", {
    p_secret: key, p_provider: provider, p_provider_attempt_id: providerAttemptId,
    p_event_hash: eventHash(provider, providerAttemptId, proof, decision), p_outcome: proof.outcome, p_state: decision.state,
    p_linkage: proof.accountLinkage, p_issuer_validated: proof.issuerValidated, p_valid_until: proof.validUntil ?? null,
    p_subject_hash: proof.providerSubjectHash ?? null, p_digest: proof.evidenceDigest ?? null,
  });
  if (error) throw new Error(`writer_ingest_${error.code ?? "error"}`);
  return String(data);
}
