// @vitest-environment node
import { generateKeyPair } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { processSsoCallback, type SsoContext, type SsoDeps } from "./callback";
import { FICTIONAL, MOCK_SCOPE, createMockIdp } from "./mock-idp";
import { buildAuthorizationUrl, deriveFromState, fetchDiscovery, hashState, studentAffiliation } from "./oidc";

// The signed local simulator stands in for a university. Nothing here touches a real institution.
const SECRET = "test-state-secret";
const STATE = "s".repeat(43);
const NOW = new Date("2026-11-18T12:00:00Z");
let idp: Awaited<ReturnType<typeof createMockIdp>>;
beforeAll(async () => {
  idp = await createMockIdp();
});
afterEach(() => vi.unstubAllEnvs());

const ctx = (over: Partial<SsoContext> = {}): SsoContext => ({
  attemptId: "att-1", requestId: "req-1", userId: "u1", institutionId: "inst-1", status: "started", expired: false,
  protocol: "mock", approvalState: "sandbox_approved", issuer: idp.issuer, clientId: idp.clientId, affiliationScopes: [MOCK_SCOPE], ...over,
});

function setup(c: SsoContext | null, claims: Record<string, unknown>, tokenOver: Parameters<typeof idp.issue>[1] extends infer T ? Partial<T> : never = {}, depsOver: Partial<SsoDeps> = {}) {
  const { nonce } = deriveFromState(STATE, SECRET);
  const exchange = vi.fn(async () => ({
    idToken: await idp.issue(claims, { nonce, iat: new Date(NOW.getTime() - 5_000), exp: Math.floor(NOW.getTime() / 1000) + 300, ...tokenOver } as Parameters<typeof idp.issue>[1]),
    jwks: idp.jwks,
  }));
  const complete = vi.fn(async (_id: string, r: { outcome: string; subjectHash: string | null }) =>
    r.outcome === "failed" ? "failed" : r.outcome === "student" && r.subjectHash ? "provisional" : "sso_confirmed_only");
  const deps: SsoDeps = {
    userId: "u1", env: "development", now: () => NOW, stateSecret: SECRET,
    getContext: vi.fn(async () => c), exchange, complete,
    hashSubject: vi.fn((inst: string, iss: string, sub: string) => `h(${inst}|${iss}|${sub})`),
    ...depsOver,
  };
  return { deps, exchange, complete };
}
const run = (d: SsoDeps, p: { state?: string; code?: string; error?: string } = { state: STATE, code: "code-1" }) => processSsoCallback(p, d);
const completionOf = (m: ReturnType<typeof vi.fn>) => m.mock.calls[0][1] as { outcome: string; failure: string | null; provisionalUntil: Date | null; subjectHash: string | null };

describe("university login callback (simulated issuer, real token validation)", () => {
  it("a trusted student claim becomes provisional, with a short expiry and a hashed subject", async () => {
    const { deps, complete } = setup(ctx(), FICTIONAL.student);
    expect(await run(deps)).toEqual({ kind: "done", status: "provisional", requestId: "req-1" });
    const c = completionOf(complete);
    expect(c.outcome).toBe("student");
    expect(c.subjectHash).toBe(`h(inst-1|${idp.issuer}|mock-sub-student-001)`);
    expect(c.provisionalUntil!.getTime() - NOW.getTime()).toBe(14 * 86_400_000);
  });
  it("a successful login without a student claim is not student affiliation", async () => {
    for (const person of [FICTIONAL.loginOnly, FICTIONAL.staff, FICTIONAL.alumnus, FICTIONAL.wrongScope]) {
      const { deps, complete } = setup(ctx(), person);
      await run(deps);
      expect(completionOf(complete).outcome).toBe("confirmed_only");
      expect(completionOf(complete).provisionalUntil).toBeNull();
    }
  });
  it("rejects tokens with a wrong nonce, issuer, audience, expiry, signature or future issue time", async () => {
    const other = await generateKeyPair("RS256");
    const bad: Array<[string, Record<string, unknown>]> = [
      ["nonce", { nonce: "someone-elses-nonce" }],
      ["issuer", { iss: "https://evil.example" }],
      ["audience", { aud: "another-client" }],
      ["expired", { exp: Math.floor(NOW.getTime() / 1000) - 3600 }],
      ["signature", { key: other.privateKey }],
      ["future iat", { iat: new Date(NOW.getTime() + 3_600_000) }],
    ];
    for (const [, over] of bad) {
      const { deps, complete } = setup(ctx(), FICTIONAL.student, over as never);
      expect(await run(deps)).toMatchObject({ kind: "done", status: "failed" });
      expect(completionOf(complete)).toMatchObject({ outcome: "failed", failure: "token_invalid", subjectHash: null });
    }
  });
  it("refuses a state Medyra never issued without any exchange", async () => {
    const { deps, exchange } = setup(null, FICTIONAL.student);
    expect(await run(deps)).toEqual({ kind: "invalid" });
    expect(await run(deps, { state: "short", code: "c" })).toEqual({ kind: "invalid" });
    expect(await run(deps, {})).toEqual({ kind: "invalid" });
    expect(exchange).not.toHaveBeenCalled();
  });
  it("an account swap is refused and consumes nothing", async () => {
    const { deps, exchange, complete } = setup(ctx({ userId: "someone-else" }), FICTIONAL.student);
    expect(await run(deps)).toEqual({ kind: "account_mismatch" });
    expect(exchange).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });
  it("a replayed callback only reports the stored result", async () => {
    const { deps, exchange, complete } = setup(ctx({ status: "provisional" }), FICTIONAL.student);
    expect(await run(deps)).toEqual({ kind: "done", status: "provisional", requestId: "req-1" });
    expect(exchange).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });
  it("an expired attempt, an error from the provider or a missing code fail without an exchange", async () => {
    for (const [c, p] of [[ctx({ expired: true }), { state: STATE, code: "c" }], [ctx(), { state: STATE, error: "access_denied" }], [ctx(), { state: STATE }]] as const) {
      const { deps, exchange, complete } = setup(c, FICTIONAL.student);
      await run(deps, p);
      expect(exchange).not.toHaveBeenCalled();
      expect(completionOf(complete).outcome).toBe("failed");
    }
  });
  it("is unavailable unless the connection is approved, and never uses the mock or sandbox in production", async () => {
    const cases: Array<[Partial<SsoContext>, Partial<SsoDeps>]> = [
      [{ approvalState: "researched" }, {}],
      [{ approvalState: "disabled" }, {}],
      [{ approvalState: "sandbox_approved" }, { env: "production" }],
      [{ approvalState: "production_approved", protocol: "mock" }, { env: "production" }],
      [{ protocol: "saml" }, {}],
      [{ issuer: null }, {}],
    ];
    for (const [c, d] of cases) {
      const { deps, exchange, complete } = setup(ctx(c), FICTIONAL.student, {}, d);
      await run(deps);
      expect(exchange).not.toHaveBeenCalled();
      expect(completionOf(complete)).toMatchObject({ outcome: "failed", failure: "connection_unavailable" });
    }
  });
  it("fails closed without the server secret", async () => {
    const { deps, exchange, complete } = setup(ctx(), FICTIONAL.student, {}, { stateSecret: null });
    await run(deps);
    expect(exchange).not.toHaveBeenCalled();
    expect(completionOf(complete).failure).toBe("not_configured");
  });
});

describe("OIDC helpers", () => {
  it("only an exact student@<approved scope> counts", () => {
    const p = (v: unknown) => studentAffiliation({ eduPersonScopedAffiliation: v } as never, [MOCK_SCOPE]).student;
    expect(p(["student@mock-udem.test"])).toBe(true);
    expect(p("STUDENT@MOCK-UDEM.TEST")).toBe(true);
    for (const v of [["staff@mock-udem.test"], ["member@mock-udem.test"], ["alum@mock-udem.test"], ["student"], ["student@evil.test"], ["student@mock-udem.test@x"], [], undefined, 5])
      expect(p(v)).toBe(false);
  });
  it("state, nonce and PKCE are derived deterministically, differ by secret, and the challenge is S256", () => {
    const a = deriveFromState(STATE, "k1");
    expect(deriveFromState(STATE, "k1")).toEqual(a);
    expect(deriveFromState(STATE, "k2").nonce).not.toBe(a.nonce);
    expect(a.verifier).not.toBe(a.nonce);
    expect(hashState(STATE)).toMatch(/^[0-9a-f]{64}$/);
  });
  it("discovery must name the approved issuer, and the authorization URL carries state, nonce and S256", async () => {
    const good = { issuer: "https://idp.example", authorization_endpoint: "https://idp.example/a", token_endpoint: "https://idp.example/t", jwks_uri: "https://idp.example/j" };
    const client = { issuer: "https://idp.example", clientId: "c1" };
    const d = await fetchDiscovery(client, (async () => new Response(JSON.stringify(good))) as unknown as typeof fetch);
    const u = new URL(buildAuthorizationUrl(d, client, { redirectUri: "https://medyra.example/api/verification/student/return", state: "S", nonce: "N", challenge: "C" }));
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ response_type: "code", client_id: "c1", state: "S", nonce: "N", code_challenge: "C", code_challenge_method: "S256" });
    await expect(fetchDiscovery(client, (async () => new Response(JSON.stringify({ ...good, issuer: "https://other.example" }))) as unknown as typeof fetch)).rejects.toThrow("oidc_discovery_invalid");
    await expect(fetchDiscovery(client, (async () => new Response(JSON.stringify({ ...good, token_endpoint: "http://insecure" }))) as unknown as typeof fetch)).rejects.toThrow("oidc_discovery_invalid");
  });
  it("the simulator refuses to exist in production", async () => {
    vi.stubEnv("VERIFICATION_ENV", "production");
    await expect(createMockIdp()).rejects.toThrow("mock_idp_disabled_in_production");
  });
});
