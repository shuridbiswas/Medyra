import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { getRedis, redisPrefix } from "@/lib/redis";
import { reportError } from "@/lib/monitoring/report";

/**
 * Per-member rate limits backed by Upstash Redis (sliding window).
 *
 * - The identifier is the verified member id, never an email or a client-supplied value.
 * - If Redis is not configured, or it fails, requests are ALLOWED (fail open): rate limiting is
 *   abuse protection, and an outage in an optional service must not lock members out. The
 *   database also enforces hard per-hour limits on posts and comments.
 */

export type RateLimitPolicy =
  | "post"
  | "comment"
  | "like"
  | "network"
  | "mfa"
  | "report"
  | "privacy"
  | "community"
  | "forum"
  | "message"
  | "mentorship"
  | "search"
  | "verification"
  | "api"
  | "email";

type Window = `${number} ${"s" | "m" | "h"}`;

export const RATE_LIMIT_POLICIES: Record<
  RateLimitPolicy,
  { limit: number; window: Window; message: string }
> = {
  post: { limit: 10, window: "10 m", message: "You're posting quickly. Please wait a few minutes." },
  comment: { limit: 20, window: "10 m", message: "You're commenting quickly. Please wait a few minutes." },
  like: { limit: 120, window: "1 m", message: "Too many reactions. Please slow down." },
  network: { limit: 40, window: "10 m", message: "You're doing that quickly. Please wait a few minutes." },
  mfa: { limit: 10, window: "10 m", message: "Too many attempts. Please wait a few minutes." },
  report: { limit: 10, window: "1 h", message: "You're sending reports quickly. Please wait a while." },
  privacy: { limit: 10, window: "1 h", message: "Too many requests. Please try again later." },
  community: { limit: 30, window: "10 m", message: "You're doing that quickly. Please wait a few minutes." },
  forum: { limit: 20, window: "10 m", message: "You're posting quickly. Please wait a few minutes." },
  message: { limit: 40, window: "1 m", message: "You're sending messages quickly. Please wait a moment." },
  mentorship: { limit: 20, window: "10 m", message: "You're doing that quickly. Please wait a few minutes." },
  verification: { limit: 30, window: "10 m", message: "You're doing that quickly. Please wait a few minutes." },
  search: { limit: 30, window: "1 m", message: "Too many searches. Please wait a moment." },
  api: { limit: 120, window: "1 m", message: "Too many requests. Please wait a moment." },
  email: { limit: 5, window: "1 h", message: "Too many emails requested. Please try again later." },
};

export type RateLimitResult =
  | { ok: true; enforced: boolean }
  | { ok: false; retryAfterSeconds: number; message: string };

const limiters = new Map<RateLimitPolicy, Ratelimit>();

function limiterFor(policy: RateLimitPolicy): Ratelimit | null {
  const redis = getRedis();
  if (!redis) return null;
  let limiter = limiters.get(policy);
  if (!limiter) {
    const { limit, window } = RATE_LIMIT_POLICIES[policy];
    limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, window),
      prefix: `${redisPrefix()}:rl:${policy}`,
      analytics: false,
    });
    limiters.set(policy, limiter);
  }
  return limiter;
}

export async function checkRateLimit(
  policy: RateLimitPolicy,
  memberId: string,
): Promise<RateLimitResult> {
  const limiter = limiterFor(policy);
  if (!limiter) return { ok: true, enforced: false };

  try {
    const result = await limiter.limit(memberId);
    if (result.success) return { ok: true, enforced: true };
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)),
      message: RATE_LIMIT_POLICIES[policy].message,
    };
  } catch (error) {
    reportError("rate-limit", error, { policy });
    return { ok: true, enforced: false };
  }
}

/** For tests. */
export function resetRateLimitersForTests() {
  limiters.clear();
}
