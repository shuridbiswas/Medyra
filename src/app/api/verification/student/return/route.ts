import { NextResponse, type NextRequest } from "next/server";
import { reportError } from "@/lib/monitoring/report";
import { requireMember } from "@/lib/auth/session";
import { bindingHash } from "@/features/student-verification/crypto";
import { completeSsoAttempt, getSsoContext, isWriterConfigured } from "@/features/verification/server/trusted-writer";
import { processSsoCallback } from "@/features/verification/sso/callback";
import { exchangeCode, fetchDiscovery } from "@/features/verification/sso/oidc";

// The university sends the browser back here. Only a signed-in member whose own attempt matches the
// state can complete it; the code and state are never trusted on their own.
export async function GET(request: NextRequest) {
  const { user } = await requireMember();
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? request.nextUrl.origin;
  const p = request.nextUrl.searchParams;
  const secret = process.env.VERIFICATION_SECRET || process.env.TWO_FACTOR_SECRET || null;
  const envName = process.env.VERIFICATION_ENV;
  const redirectUri = `${origin}/api/verification/student/return`;

  let target = "/verification/student?error=Could%20not%20confirm%20your%20university%20login.";
  if (isWriterConfigured()) {
    try {
      const result = await processSsoCallback(
        { state: p.get("state") ?? undefined, code: p.get("code") ?? undefined, error: p.get("error") ?? undefined },
        {
          userId: user.id,
          env: envName === "production" || envName === "staging" ? envName : "development",
          now: () => new Date(),
          stateSecret: secret,
          getContext: getSsoContext,
          exchange: async (ctx, code, verifier) => {
            const client = { issuer: ctx.issuer ?? "", clientId: ctx.clientId ?? "" };
            const discovery = await fetchDiscovery(client);
            return exchangeCode(discovery, client, { code, verifier, redirectUri, clientSecret: process.env.STUDENT_SSO_CLIENT_SECRET });
          },
          hashSubject: (institutionId, issuer, sub) => bindingHash(institutionId, `${issuer}|${sub}`),
          complete: completeSsoAttempt,
        },
      );
      if (result.kind === "done" && result.requestId) {
        const note = result.status === "provisional" ? "School affiliation confirmed; program verification pending." : "University login recorded.";
        target = `/verification/student?request=${encodeURIComponent(result.requestId)}&notice=${encodeURIComponent(note)}`;
      }
    } catch (error) {
      reportError("verification.sso_return", error);
    }
  }
  return NextResponse.redirect(new URL(target, origin), { headers: { "Cache-Control": "no-store" } });
}
