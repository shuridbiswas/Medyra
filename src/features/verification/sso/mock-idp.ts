import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK, type JWTPayload, type JWTVerifyGetKey } from "jose";

/**
 * Local-only identity provider simulator: a test issuer with throwaway keys and fictional students.
 * It is never wired to a route and refuses to run in production; its keys exist only in memory, so a
 * production deployment has nothing that could validate its tokens.
 */
export const MOCK_ISSUER = "https://mock-idp.test.invalid";
export const MOCK_CLIENT_ID = "medyra-test-client";

export async function createMockIdp(opts: { issuer?: string; clientId?: string } = {}) {
  if (process.env.VERIFICATION_ENV === "production") throw new Error("mock_idp_disabled_in_production");
  const issuer = opts.issuer ?? MOCK_ISSUER;
  const clientId = opts.clientId ?? MOCK_CLIENT_ID;
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: "mock-1", alg: "RS256", use: "sig" };
  const jwks: JWTVerifyGetKey = createLocalJWKSet({ keys: [jwk] });

  async function issue(
    claims: JWTPayload & Record<string, unknown>,
    over: { nonce: string; iss?: string; aud?: string; exp?: string | number; iat?: Date; key?: CryptoKey },
  ) {
    return new SignJWT({ nonce: over.nonce, ...claims })
      .setProtectedHeader({ alg: "RS256", kid: "mock-1" })
      .setIssuer(over.iss ?? issuer)
      .setAudience(over.aud ?? clientId)
      .setIssuedAt(over.iat ? Math.floor(over.iat.getTime() / 1000) : undefined)
      .setExpirationTime(over.exp ?? "5m")
      .sign(over.key ?? privateKey);
  }
  return { issuer, clientId, jwks, issue, privateKey };
}

/** Fictional people. Names are obviously fake on purpose. */
export const FICTIONAL = {
  student: { sub: "mock-sub-student-001", eduPersonScopedAffiliation: ["student@mock-udem.test"] },
  staff: { sub: "mock-sub-staff-001", eduPersonScopedAffiliation: ["staff@mock-udem.test", "employee@mock-udem.test"] },
  alumnus: { sub: "mock-sub-alumnus-001", eduPersonScopedAffiliation: ["alum@mock-udem.test", "member@mock-udem.test"] },
  loginOnly: { sub: "mock-sub-login-001" },
  wrongScope: { sub: "mock-sub-other-001", eduPersonScopedAffiliation: ["student@other-school.test"] },
} as const;
export const MOCK_SCOPE = "mock-udem.test";
