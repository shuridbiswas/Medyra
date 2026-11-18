import type { NormalizedProof } from "./types";

/** Development-only fixtures. Marked simulated, so the policy refuses them in production. */
export function simulatedProof(attemptId: string, kind: "student" | "member" | "no_link", now = new Date()): NormalizedProof {
  return {
    provider: "simulated",
    providerAttemptId: attemptId,
    claimType: "CURRENT_STUDENT",
    outcome: kind === "member" ? "negative" : "positive",
    verifiedAt: now.toISOString(),
    validUntil: new Date(now.getTime() + 90 * 86_400_000).toISOString(),
    providerSubjectHash: kind === "no_link" ? undefined : `sim-${attemptId}`,
    accountLinkage: kind === "no_link" ? "unresolved" : "strong",
    issuerValidated: true,
    simulated: true,
    sandbox: true,
  };
}
