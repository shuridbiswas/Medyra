import "server-only";
import { createHmac, randomInt } from "node:crypto";

/**
 * Keyed hashes for the school-email step and the identity reference. The database stores only
 * these digests: never an address, a code or a student identifier. VERIFICATION_SECRET is used when
 * set, otherwise TWO_FACTOR_SECRET; with neither, the features that need a digest stay off.
 */
const secret = () => process.env.VERIFICATION_SECRET || process.env.TWO_FACTOR_SECRET || null;
export const isVerificationHashConfigured = () => Boolean(secret());

function mac(purpose: string, ...parts: string[]): string {
  const key = secret();
  if (!key) throw new Error("verification_secret_missing");
  return createHmac("sha256", key).update([purpose, ...parts].join("\u0000")).digest("hex");
}

export const emailAddressHash = (institutionId: string, email: string) =>
  mac("address", institutionId, email.trim().toLowerCase());
export const emailCodeHash = (userId: string, requestId: string, code: string) => mac("code", userId, requestId, code);
export const bindingHash = (institutionId: string, identifier: string) =>
  mac("binding", institutionId, identifier.trim().replace(/\s+/g, "").toLowerCase());

export const generateEmailCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");
