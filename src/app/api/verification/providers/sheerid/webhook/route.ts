import { NextResponse } from "next/server";
import { reportError } from "@/lib/monitoring/report";
import { fetchSheerIdDetails } from "@/features/verification/providers/sheerid";
import { getAttemptContext, isWriterConfigured, recordVerifiedResult } from "@/features/verification/server/trusted-writer";
import { processSheerIdWebhook } from "@/features/verification/server/sheerid-webhook";

// Public by design (SheerID calls it): authorised only by a valid HMAC signature over the raw body.
export async function POST(request: Request) {
  const rawBody = await request.text(); // raw bytes: re-serialising would break the signature
  const programId = process.env.SHEERID_PROGRAM_ID;
  const token = process.env.SHEERID_ACCESS_TOKEN;
  const envName = process.env.VERIFICATION_ENV;
  const result = await processSheerIdWebhook(rawBody, request.headers.get("x-sheerid-signature"), {
    secret: process.env.SHEERID_WEBHOOK_SECRET,
    sheerId: process.env.SHEERID_ENABLED === "true" && programId && token ? { programId, token } : null,
    liveEnabled: process.env.VERIFICATION_LIVE_PROVIDERS_ENABLED === "true",
    env: envName === "production" || envName === "staging" ? envName : "development",
    writerConfigured: isWriterConfigured(),
    now: () => new Date(),
    getContext: getAttemptContext,
    fetchDetails: fetchSheerIdDetails,
    record: async (...args) => {
      try {
        return await recordVerifiedResult(...args);
      } catch (error) {
        reportError("verification.sheerid_webhook_record", error);
        throw error;
      }
    },
  });
  return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
