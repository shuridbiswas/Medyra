// @vitest-environment node
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { processSheerIdWebhook, type WebhookDeps } from "./sheerid-webhook";
import type { AttemptContext } from "./trusted-writer";

const SECRET = "whsec_test_fixture_only";
const VID = "fixture-verification-0001";
const sign = (body: string, secret = SECRET) => createHmac("sha256", secret).update(body).digest("hex");
const body = JSON.stringify({ verificationId: VID, notifierEventType: "SUCCESS" });

const ctx = (over: Partial<AttemptContext["config"]> = {}, state = "redirected"): AttemptContext => ({
  attemptId: "a1", claim: "CURRENT_STUDENT", state,
  config: { provider: "sheerid", enabled: true, environment: "development", contractState: "sandbox", claims: ["CURRENT_STUDENT"], ...over },
});

function deps(over: Partial<WebhookDeps> = {}) {
  const record = vi.fn(async () => "requires_review");
  const d: WebhookDeps = {
    secret: SECRET, sheerId: { programId: "prog-1", token: "tok" }, liveEnabled: true, env: "development", writerConfigured: true,
    now: () => new Date("2026-11-17T12:00:00Z"),
    getContext: vi.fn(async () => ctx()),
    fetchDetails: vi.fn(async () => ({ currentStep: "success", programId: "prog-1" })),
    record,
    ...over,
  };
  return { d, record };
}

describe("SheerID webhook (synthetic signed fixtures, no network)", () => {
  it("rejects a missing or invalid signature and does nothing else", async () => {
    const { d, record } = deps();
    expect((await processSheerIdWebhook(body, null, d)).status).toBe(401);
    expect((await processSheerIdWebhook(body, "deadbeef", d)).status).toBe(401);
    expect((await processSheerIdWebhook(body, sign(body, "other-secret"), d)).status).toBe(401);
    expect((await processSheerIdWebhook(body + " ", sign(body), d)).status).toBe(401); // body altered in transit
    expect(d.getContext).not.toHaveBeenCalled();
    expect(d.fetchDetails).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
  it("is closed when the provider, the live switch, the secret or the writer key is missing", async () => {
    for (const over of [{ liveEnabled: false }, { sheerId: null }, { secret: undefined }, { writerConfigured: false }]) {
      const { d, record } = deps(over);
      expect((await processSheerIdWebhook(body, sign(body), d)).status).toBe(503);
      expect(record).not.toHaveBeenCalled();
    }
  });
  it("a valid delivery re-fetches the authoritative details, applies the policy and records once", async () => {
    const { d, record } = deps();
    const r = await processSheerIdWebhook(body, sign(body), d);
    expect(r).toEqual({ status: 200, body: { ok: true, state: "requires_review" } });
    expect(d.fetchDetails).toHaveBeenCalledWith(d.sheerId, VID);
    const [, id, proof, decision] = record.mock.calls[0] as unknown as [string, string, { accountLinkage: string }, { state: string }];
    expect(id).toBe(VID);
    // SheerID only shows eligibility, never a strong account link: it cannot skip review.
    expect(proof.accountLinkage).toBe("partial");
    expect(decision.state).toBe("requires_review");
  });
  it("the webhook payload is only a hint: a success event with a failing details fetch records nothing", async () => {
    const { d, record } = deps({ fetchDetails: vi.fn(async () => { throw new Error("sheerid_details_500"); }) });
    expect((await processSheerIdWebhook(body, sign(body), d)).status).toBe(502);
    expect(record).not.toHaveBeenCalled();
  });
  it("a pending or unrecognised provider step is recorded as pending, never positive", async () => {
    for (const currentStep of ["docUpload", "pending", "something-new"]) {
      const { d, record } = deps({ fetchDetails: vi.fn(async () => ({ currentStep })) });
      await processSheerIdWebhook(body, sign(body), d);
      expect((record.mock.calls[0] as unknown as [string, string, unknown, { state: string }])[3].state).toBe("provider_pending");
    }
  });
  it("an id Medyra never issued is acknowledged and ignored without any fetch or write", async () => {
    const { d, record } = deps({ getContext: vi.fn(async () => null) });
    expect(await processSheerIdWebhook(body, sign(body), d)).toEqual({ status: 200, body: { ok: true, state: "ignored" } });
    expect(d.fetchDetails).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
  it("a result for another SheerID program is refused", async () => {
    const { d, record } = deps({ fetchDetails: vi.fn(async () => ({ currentStep: "success", programId: "someone-elses" })) });
    expect((await processSheerIdWebhook(body, sign(body), d)).status).toBe(422);
    expect(record).not.toHaveBeenCalled();
  });
  it("malformed payloads are refused, and a payload cannot name a user", async () => {
    const bad = JSON.stringify({ verificationId: "../../etc", userId: "someone" });
    const { d, record } = deps();
    expect((await processSheerIdWebhook(bad, sign(bad), d)).status).toBe(400);
    expect((await processSheerIdWebhook("not json", sign("not json"), d)).status).toBe(400);
    const withUser = JSON.stringify({ verificationId: VID, user_id: "attacker" });
    await processSheerIdWebhook(withUser, sign(withUser), d);
    expect(JSON.stringify(record.mock.calls)).not.toContain("attacker");
  });
  it("simulated or sandbox proof can never pass in production", async () => {
    const { d, record } = deps({ env: "production" });
    d.getContext = vi.fn(async () => ctx({ environment: "production", contractState: "sandbox" }));
    await processSheerIdWebhook(body, sign(body), d);
    expect((record.mock.calls[0] as unknown as [string, string, unknown, { state: string; reason: string }])[3]).toMatchObject({ state: "provider_error", reason: "test_proof_in_production" });
  });
  it("retries are safe: the same delivery produces the same record call arguments", async () => {
    const { d, record } = deps();
    await processSheerIdWebhook(body, sign(body), d);
    await processSheerIdWebhook(body, sign(body), d);
    expect(record.mock.calls[0]).toEqual(record.mock.calls[1]);
  });
});
