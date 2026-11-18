import type { JWTVerifyGetKey } from "jose";
import type { VerificationEnv } from "@/features/verification/providers/types";
import { deriveFromState, hashState, studentAffiliation, validateIdToken } from "./oidc";

export type SsoContext = {
  attemptId: string;
  requestId: string;
  userId: string;
  institutionId: string;
  status: string;
  expired: boolean;
  protocol: "oidc" | "saml" | "contracted_provider" | "mock";
  approvalState: string;
  issuer: string | null;
  clientId: string | null;
  affiliationScopes: string[];
};

export type SsoCompletion = {
  outcome: "student" | "confirmed_only" | "failed";
  failure: string | null;
  subjectHash: string | null;
  evidence: string | null;
  authAt: Date | null;
  provisionalUntil: Date | null;
};

export type SsoDeps = {
  userId: string;
  env: VerificationEnv;
  now: () => Date;
  stateSecret: string | null;
  getContext: (stateHash: string) => Promise<SsoContext | null>;
  /** Exchanges the code at the approved issuer. Injected so tests never touch a network. */
  exchange: (ctx: SsoContext, code: string, verifier: string) => Promise<{ idToken: string; jwks: JWTVerifyGetKey }>;
  hashSubject: (institutionId: string, issuer: string, sub: string) => string;
  complete: (attemptId: string, c: SsoCompletion) => Promise<string>;
};

export type SsoResult = { kind: "invalid" | "account_mismatch" | "done"; status?: string; requestId?: string };
/** How long a "school affiliation confirmed" status lasts: Medyra policy, deliberately short. */
export const PROVISIONAL_DAYS = 14;
const failed = (failure: string): SsoCompletion => ({ outcome: "failed", failure, subjectHash: null, evidence: null, authAt: null, provisionalUntil: null });

/**
 * The browser returns here after the university login. The code and state are only inputs: the state
 * must match an attempt this exact member started, the issuer must be the approved one, and the ID
 * token must pass full validation. Nothing here can issue a badge; at most it records a private,
 * short-lived provisional affiliation.
 */
export async function processSsoCallback(params: { state?: string; code?: string; error?: string }, d: SsoDeps): Promise<SsoResult> {
  const { state, code } = params;
  if (!state || state.length < 32 || state.length > 200) return { kind: "invalid" };
  const ctx = await d.getContext(hashState(state));
  if (!ctx) return { kind: "invalid" };
  // A callback delivered to a different signed-in member (account swap) is refused and consumes nothing.
  if (ctx.userId !== d.userId) return { kind: "account_mismatch" };
  const done = (status: string): SsoResult => ({ kind: "done", status, requestId: ctx.requestId });
  if (ctx.status !== "started") return done(ctx.status); // replay: report the recorded result only
  if (ctx.expired) return done(await d.complete(ctx.attemptId, failed("expired")));

  const fail = async (why: string) => done(await d.complete(ctx.attemptId, failed(why)));
  if (params.error || !code) return fail(params.error ? "provider_error" : "no_code");

  const approved = ctx.approvalState === "sandbox_approved" || ctx.approvalState === "production_approved";
  const envOk = d.env !== "production" || ctx.approvalState === "production_approved";
  // The mock IdP never runs in production, and only OIDC is implemented so far.
  const protocolOk = ctx.protocol === "oidc" || (ctx.protocol === "mock" && d.env !== "production");
  if (!approved || !envOk || !protocolOk || !ctx.issuer || !ctx.clientId && ctx.protocol !== "mock") return fail("connection_unavailable");
  if (!d.stateSecret) return fail("not_configured");

  try {
    const { nonce, verifier } = deriveFromState(state, d.stateSecret);
    const { idToken, jwks } = await d.exchange(ctx, code, verifier);
    const client = { issuer: ctx.issuer, clientId: ctx.clientId ?? "" };
    const claims = await validateIdToken(idToken, client, { nonce, now: d.now() }, jwks);
    const { student, evidence } = studentAffiliation(claims, ctx.affiliationScopes);
    const subjectHash = d.hashSubject(ctx.institutionId, ctx.issuer, claims.sub);
    return done(await d.complete(ctx.attemptId, {
      outcome: student ? "student" : "confirmed_only", failure: null, subjectHash, evidence,
      authAt: claims.iat ? new Date(claims.iat * 1000) : d.now(),
      provisionalUntil: student ? new Date(d.now().getTime() + PROVISIONAL_DAYS * 86_400_000) : null,
    }));
  } catch {
    // Any validation problem is one generic failure: nothing about why is revealed or logged.
    return fail("token_invalid");
  }
}
