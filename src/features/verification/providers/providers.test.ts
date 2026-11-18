// @vitest-environment node
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { decideProof } from "./policy";
import { createSheerIdVerification, fetchSheerIdDetails, normalizeSheerId, sheerIdHostedUrl, verifySheerIdSignature } from "./sheerid";
import { simulatedProof } from "./simulated";
import type { NormalizedProof, ProviderConfig } from "./types";

const NOW = new Date("2026-11-17T12:00:00Z");
const config = (over: Partial<ProviderConfig> = {}): ProviderConfig => ({
  provider: "simulated", enabled: true, environment: "development", contractState: "sandbox", claims: ["CURRENT_STUDENT"], ...over,
});
const strong = (over: Partial<NormalizedProof> = {}): NormalizedProof => ({ ...simulatedProof("a1", "student", NOW), ...over });
const decide = (p: NormalizedProof, c = config(), env: "development" | "staging" | "production" = "development", requested: "CURRENT_STUDENT" | "CURRENT_PROGRAM_STUDENT" = "CURRENT_STUDENT") =>
  decideProof(p, { requested, config: c, env, now: NOW });

describe("policy engine", () => {
  it("a strong, issuer-validated, current proof is ready for a reviewer", () => {
    expect(decide(strong())).toEqual({ state: "proof_received", reason: "ok" });
  });
  it("refuses a provider that is disabled or has no approved contract", () => {
    expect(decide(strong(), config({ enabled: false })).reason).toBe("provider_not_approved");
    expect(decide(strong(), config({ contractState: "awaiting_contract" })).reason).toBe("provider_not_approved");
  });
  it("never accepts simulator or sandbox proof in production, even with a live-looking config", () => {
    const prod = config({ environment: "production", contractState: "live" });
    expect(decide(strong(), prod, "production").reason).toBe("test_proof_in_production");
    expect(decide(strong({ simulated: false, sandbox: true }), prod, "production").reason).toBe("test_proof_in_production");
    expect(decide(strong({ simulated: false, sandbox: false }), config({ environment: "production", contractState: "sandbox" }), "production").reason).toBe("test_proof_in_production");
  });
  it("refuses a config for another environment", () => {
    expect(decide(strong(), config({ environment: "staging" })).reason).toBe("wrong_environment");
  });
  it("a negative result rejects and an unfinished one stays pending", () => {
    expect(decide(strong({ outcome: "negative" })).state).toBe("rejected");
    expect(decide(strong({ outcome: "indeterminate" })).state).toBe("provider_pending");
  });
  it("general student status never proves a program", () => {
    const c = config({ claims: ["CURRENT_STUDENT", "CURRENT_PROGRAM_STUDENT"] });
    const p = strong({ claimType: "CURRENT_PROGRAM_STUDENT" });
    expect(decide(p, c, "development", "CURRENT_PROGRAM_STUDENT").reason).toBe("program_not_proved");
    expect(decide({ ...p, programStated: true }, c, "development", "CURRENT_PROGRAM_STUDENT").state).toBe("proof_received");
  });
  it("a missing or weak account link goes to review, never straight through", () => {
    expect(decide(strong({ accountLinkage: "partial" })).reason).toBe("account_link_not_strong");
    expect(decide(simulatedProof("a1", "no_link", NOW)).reason).toBe("account_link_not_strong");
  });
  it("stale, future or expired proof goes to review", () => {
    expect(decide(strong({ verifiedAt: "2025-01-01T00:00:00Z" })).reason).toBe("proof_too_old");
    expect(decide(strong({ verifiedAt: "2027-01-01T00:00:00Z" })).reason).toBe("bad_timestamp");
    expect(decide(strong({ validUntil: "2026-11-01T00:00:00Z" })).reason).toBe("proof_expired");
  });
  it("an unvalidated issuer goes to review", () => {
    expect(decide(strong({ issuerValidated: false })).reason).toBe("issuer_not_validated");
  });
  it("a proof from a different provider than the config is refused", () => {
    expect(decide(strong({ provider: "sheerid" })).reason).toBe("provider_mismatch");
  });
});

describe("SheerID adapter", () => {
  const env = { programId: "prog 1", token: "tok" };

  it("creates the session on the documented endpoint with a bearer token and only the program id", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ verificationId: "v-1" })));
    expect(await createSheerIdVerification(env, f as unknown as typeof fetch)).toBe("v-1");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://services.sheerid.com/rest/v2/verification");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(init.body).toBe('{"programId":"prog 1"}');
  });
  it("builds the documented hosted URL with encoded parts", () => {
    expect(sheerIdHostedUrl("prog 1", "v/1")).toBe("https://services.sheerid.com/verify/prog%201/?verificationId=v%2F1");
  });
  it("fails on provider errors and malformed responses", async () => {
    await expect(createSheerIdVerification(env, (async () => new Response("", { status: 401 })) as unknown as typeof fetch)).rejects.toThrow("sheerid_create_401");
    await expect(createSheerIdVerification(env, (async () => new Response("{}")) as unknown as typeof fetch)).rejects.toThrow("sheerid_create_shape");
    await expect(fetchSheerIdDetails(env, "v", (async () => new Response("", { status: 500 })) as unknown as typeof fetch)).rejects.toThrow("sheerid_details_500");
  });
  it("verifies the HMAC over the raw body and rejects a forged or missing signature", () => {
    const body = '{"verificationId":"v-1"}';
    const sig = createHmac("sha256", "whsec").update(body).digest("hex");
    expect(verifySheerIdSignature(body, sig, "whsec")).toBe(true);
    expect(verifySheerIdSignature(body + " ", sig, "whsec")).toBe(false);
    expect(verifySheerIdSignature(body, "deadbeef", "whsec")).toBe(false);
    expect(verifySheerIdSignature(body, null, "whsec")).toBe(false);
    expect(verifySheerIdSignature(body, sig, "")).toBe(false);
  });
  it("a SheerID success is only general student status with a partial link, so it can never skip review", () => {
    const proof = normalizeSheerId({ currentStep: "success" }, { verificationId: "v-1", now: NOW, testMode: false });
    expect(proof.outcome).toBe("positive");
    expect(proof.programStated).toBeUndefined();
    const c = config({ provider: "sheerid", contractState: "live", environment: "production" });
    expect(decide(proof, c, "production").state).toBe("requires_review");
  });
  it("pending, document review and unknown steps are never positive", () => {
    for (const step of ["docUpload", "pending", "collectStudentPersonalInfo", "", "SUCCESS-ish"])
      expect(normalizeSheerId({ currentStep: step }, { verificationId: "v", now: NOW, testMode: false }).outcome).toBe("indeterminate");
    expect(normalizeSheerId({}, { verificationId: "v", now: NOW, testMode: false }).outcome).toBe("indeterminate");
    expect(normalizeSheerId({ currentStep: "rejected" }, { verificationId: "v", now: NOW, testMode: false }).outcome).toBe("negative");
  });
});
