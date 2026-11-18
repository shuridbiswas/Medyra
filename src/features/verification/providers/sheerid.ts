import { createHmac, timingSafeEqual } from "node:crypto";
import type { NormalizedProof } from "./types";

// Endpoints exactly as published in SheerID's docs (checked 2026-11-17). The token is a server-side
// OAuth/application token; static tokens stop working on 2027-01-31, so never build on them.
const API = "https://services.sheerid.com/rest/v2";
const HOSTED = "https://services.sheerid.com/verify";

export type SheerIdEnv = { programId: string; token: string };

export const sheerIdHostedUrl = (programId: string, verificationId: string) =>
  `${HOSTED}/${encodeURIComponent(programId)}/?verificationId=${encodeURIComponent(verificationId)}`;

/** Server-created session, so only an authenticated Medyra backend can start one. */
export async function createSheerIdVerification(env: SheerIdEnv, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(`${API}/verification`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ programId: env.programId }),
  });
  if (!res.ok) throw new Error(`sheerid_create_${res.status}`);
  const data = (await res.json()) as { verificationId?: unknown };
  if (typeof data.verificationId !== "string" || !data.verificationId) throw new Error("sheerid_create_shape");
  return data.verificationId;
}

/** The authoritative result. A webhook or a browser return is only ever a hint to call this. */
export async function fetchSheerIdDetails(env: SheerIdEnv, verificationId: string, fetchImpl: typeof fetch = fetch) {
  const res = await fetchImpl(`${API}/verification/${encodeURIComponent(verificationId)}/details`, {
    headers: { Authorization: `Bearer ${env.token}` },
  });
  if (!res.ok) throw new Error(`sheerid_details_${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/** HMAC-SHA256 over the raw body, constant-time compare. Kept for when a webhook route is approved. */
export function verifySheerIdSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature.trim().toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Maps SheerID details to a proof. SheerID verifies student eligibility, not who the account owner is
 * nor the program, so linkage is at best partial and no program is ever stated. Field names beyond
 * `currentStep` are NOT assumed; anything unrecognised is indeterminate.
 */
export function normalizeSheerId(
  details: Record<string, unknown>,
  ctx: { verificationId: string; now: Date; testMode: boolean },
): NormalizedProof {
  const step = typeof details.currentStep === "string" ? details.currentStep : "";
  const outcome: NormalizedProof["outcome"] =
    step === "success" ? "positive" : step === "error" || step === "rejected" || step === "expired" ? "negative" : "indeterminate";
  return {
    provider: "sheerid",
    providerAttemptId: ctx.verificationId,
    claimType: "CURRENT_STUDENT",
    outcome,
    verifiedAt: ctx.now.toISOString(),
    accountLinkage: "partial",
    issuerValidated: false,
    simulated: false,
    sandbox: ctx.testMode,
  };
}
