import { decideProof, type PolicyDecision } from "@/features/verification/providers/policy";
import { fetchSheerIdDetails, normalizeSheerId, verifySheerIdSignature, type SheerIdEnv } from "@/features/verification/providers/sheerid";
import type { NormalizedProof, ProviderKey, VerificationEnv } from "@/features/verification/providers/types";

/** Everything the handler touches outside itself, injectable so the whole flow is testable offline. */
export type WebhookDeps = {
  secret: string | undefined;
  sheerId: SheerIdEnv | null;
  liveEnabled: boolean;
  env: VerificationEnv;
  writerConfigured: boolean;
  now: () => Date;
  getContext: (provider: ProviderKey, id: string) => Promise<import("./trusted-writer").AttemptContext | null>;
  fetchDetails: (env: SheerIdEnv, id: string) => Promise<Record<string, unknown>>;
  record: (provider: ProviderKey, id: string, proof: NormalizedProof, decision: PolicyDecision) => Promise<string>;
};

export type WebhookResult = { status: number; body: { ok: boolean; state?: string; error?: string } };
const ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * SheerID webhook. A delivery is only a hint: after the signature checks out we look the id up among
 * Medyra's own attempts, re-fetch the authoritative details from SheerID, run the policy and record
 * the outcome. The payload's content is never trusted for who the member is, and nothing here can
 * approve a credential.
 */
export async function processSheerIdWebhook(rawBody: string, signature: string | null, deps: WebhookDeps): Promise<WebhookResult> {
  if (!deps.liveEnabled || !deps.sheerId || !deps.secret || !deps.writerConfigured)
    return { status: 503, body: { ok: false, error: "not_configured" } };
  if (!verifySheerIdSignature(rawBody, signature, deps.secret)) return { status: 401, body: { ok: false, error: "bad_signature" } };

  let verificationId: unknown;
  try {
    verificationId = (JSON.parse(rawBody) as { verificationId?: unknown }).verificationId;
  } catch {
    return { status: 400, body: { ok: false, error: "bad_payload" } };
  }
  if (typeof verificationId !== "string" || !ID.test(verificationId)) return { status: 400, body: { ok: false, error: "bad_payload" } };

  try {
    const ctx = await deps.getContext("sheerid", verificationId);
    // Unknown to Medyra: acknowledge without saying whether it exists.
    if (!ctx) return { status: 200, body: { ok: true, state: "ignored" } };
    const details = await deps.fetchDetails(deps.sheerId, verificationId);
    if (typeof details.programId === "string" && details.programId !== deps.sheerId.programId)
      return { status: 422, body: { ok: false, error: "wrong_program" } };
    const proof = normalizeSheerId(details, { verificationId, now: deps.now(), testMode: ctx.config.contractState !== "live" });
    const decision = decideProof(proof, { requested: ctx.claim, config: ctx.config, env: deps.env, now: deps.now() });
    const state = await deps.record("sheerid", verificationId, proof, decision);
    return { status: 200, body: { ok: true, state } };
  } catch {
    // Non-2xx makes SheerID retry later; nothing sensitive is returned or logged here.
    return { status: 502, body: { ok: false, error: "temporary" } };
  }
}

export { fetchSheerIdDetails };
