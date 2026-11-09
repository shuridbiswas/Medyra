import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

/**
 * Security headers for every response. They are conservative on purpose: nothing here blocks
 * Supabase, Sentry, Resend (server-side only) or the ProductBridge links. A Content Security
 * Policy is NOT enforced yet; see ARCHITECTURE.md ("Risks") for the plan to add one in
 * Report-Only mode first.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  // Browsers ignore HSTS over plain http, so this is harmless on localhost and active on https.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

// Anything that is not production (previews, the dev deployment) must stay out of search engines.
const noIndex =
  process.env.NEXT_PUBLIC_APP_ENV === "production" ? [] : [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Student verification uploads (5 MB files) arrive through a server action.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  // The member home used to live at /home. Keep old links and bookmarks working (query strings
  // such as ?category= are carried over).
  async redirects() {
    return [{ source: "/home", destination: "/", permanent: false }];
  },
  async headers() {
    return [{ source: "/:path*", headers: [...securityHeaders, ...noIndex] }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

/**
 * Sentry is optional. Without SENTRY_AUTH_TOKEN the build simply skips source map upload, and
 * without a DSN the SDK never starts (see src/lib/monitoring/config.ts).
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  telemetry: false,
});
