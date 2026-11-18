import { createHash, createHmac } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

/**
 * OIDC building blocks on top of `jose` (maintained, audited): nothing here hand-rolls signature
 * validation. These run only for institutions an administrator approved; no URL is ever built from a
 * member-supplied domain.
 */
export type OidcClient = { issuer: string; clientId: string };

const b64url = (b: Buffer) => b.toString("base64url");

/** State is random and stored hashed. Nonce and PKCE verifier are derived from it with a server key, so nothing else is stored. */
export function deriveFromState(state: string, secret: string) {
  const mac = (purpose: string) => createHmac("sha256", secret).update(`${purpose}|${state}`).digest();
  const verifier = b64url(mac("pkce"));
  return {
    nonce: b64url(mac("nonce")),
    verifier,
    challenge: b64url(createHash("sha256").update(verifier).digest()),
  };
}
export const hashState = (state: string) => createHash("sha256").update(state).digest("hex");

export type Discovery = { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string };

export async function fetchDiscovery(client: OidcClient, fetchImpl: typeof fetch = fetch): Promise<Discovery> {
  const res = await fetchImpl(`${client.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("oidc_discovery_failed");
  const d = (await res.json()) as Partial<Discovery>;
  // The metadata must name the issuer we approved; otherwise someone is substituting another issuer.
  if (d.issuer !== client.issuer || !d.authorization_endpoint?.startsWith("https://") || !d.token_endpoint?.startsWith("https://") || !d.jwks_uri?.startsWith("https://"))
    throw new Error("oidc_discovery_invalid");
  return d as Discovery;
}

export function buildAuthorizationUrl(d: Discovery, client: OidcClient, p: { redirectUri: string; state: string; nonce: string; challenge: string }) {
  const url = new URL(d.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code", client_id: client.clientId, redirect_uri: p.redirectUri, scope: "openid",
    state: p.state, nonce: p.nonce, code_challenge: p.challenge, code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

export async function exchangeCode(
  d: Discovery, client: OidcClient, p: { code: string; verifier: string; redirectUri: string; clientSecret?: string }, fetchImpl: typeof fetch = fetch,
): Promise<{ idToken: string; jwks: JWTVerifyGetKey }> {
  const body = new URLSearchParams({ grant_type: "authorization_code", code: p.code, redirect_uri: p.redirectUri, client_id: client.clientId, code_verifier: p.verifier });
  if (p.clientSecret) body.set("client_secret", p.clientSecret);
  const res = await fetchImpl(d.token_endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!res.ok) throw new Error("oidc_exchange_failed");
  const json = (await res.json()) as { id_token?: unknown };
  if (typeof json.id_token !== "string") throw new Error("oidc_no_id_token");
  // Access and refresh tokens are never kept.
  return { idToken: json.id_token, jwks: createRemoteJWKSet(new URL(d.jwks_uri)) };
}

/** Verifies signature, issuer, audience, expiry, not-before, issued-at, nonce and subject. Throws on any failure. */
export async function validateIdToken(
  idToken: string, client: OidcClient, expect: { nonce: string; now: Date }, jwks: JWTVerifyGetKey,
): Promise<JWTPayload & { sub: string }> {
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: client.issuer, audience: client.clientId, algorithms: ["RS256", "ES256", "PS256"],
    currentDate: expect.now, clockTolerance: 30, requiredClaims: ["exp", "iat", "sub", "nonce"],
  });
  if (payload.nonce !== expect.nonce) throw new Error("oidc_nonce_mismatch");
  if (typeof payload.sub !== "string" || !payload.sub) throw new Error("oidc_no_subject");
  if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== client.clientId) throw new Error("oidc_azp_mismatch");
  if ((payload.iat as number) * 1000 > expect.now.getTime() + 60_000) throw new Error("oidc_iat_future");
  return payload as JWTPayload & { sub: string };
}

/** Only an explicit `student@<approved scope>` counts. Staff, faculty, employee, alumni and member never do. */
export function studentAffiliation(payload: JWTPayload, approvedScopes: string[]): { student: boolean; evidence: string | null } {
  const raw = payload.eduPersonScopedAffiliation;
  const list = (Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []).filter((x): x is string => typeof x === "string");
  const scopes = approvedScopes.map((s) => s.toLowerCase());
  const student = list.some((v) => {
    const [role, scope, ...rest] = v.toLowerCase().split("@");
    return role === "student" && rest.length === 0 && !!scope && scopes.includes(scope);
  });
  return { student, evidence: student ? "eduPersonScopedAffiliation" : null };
}
