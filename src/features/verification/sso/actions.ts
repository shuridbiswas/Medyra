"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { reportError } from "@/lib/monitoring/report";
import { getSsoContext, isWriterConfigured } from "@/features/verification/server/trusted-writer";
import { buildAuthorizationUrl, deriveFromState, fetchDiscovery, hashState } from "@/features/verification/sso/oidc";

const back = (requestId: string, kind: "notice" | "error", message: string): never =>
  redirect(`/verification/student?request=${encodeURIComponent(requestId)}&${kind}=${encodeURIComponent(message.slice(0, 200))}`);

/**
 * Member: "Verify through University". Creates a single-use attempt bound to this member and request,
 * then sends the browser to the approved issuer's own login page. The destination comes only from the
 * administrator-approved connection, never from anything the member typed. Nothing is built from a
 * domain, and Medyra never sees a school password.
 */
export async function startUniversitySso(formData: FormData): Promise<void> {
  const { user } = await requireMember();
  const requestId = formData.get("requestId");
  if (typeof requestId !== "string" || !z.string().uuid().safeParse(requestId).success) return redirect("/verification/student");
  const limited = await checkRateLimit("verification", user.id);
  if (!limited.ok) return back(requestId, "error", limited.message);
  const secret = process.env.VERIFICATION_SECRET || process.env.TWO_FACTOR_SECRET;
  const unavailable = "University login is not available for this institution. You can verify with an official document instead.";
  if (!secret || !isWriterConfigured()) return back(requestId, "error", unavailable);

  const state = randomBytes(32).toString("base64url");
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const { error } = await supabase.rpc("start_sso_attempt", { p_request: requestId, p_state_hash: hashState(state) });
  if (error) return back(requestId, "error", unavailable);

  let url: string;
  try {
    const ctx = await getSsoContext(hashState(state));
    if (!ctx || ctx.protocol !== "oidc" || !ctx.issuer || !ctx.clientId) return back(requestId, "error", unavailable);
    const client = { issuer: ctx.issuer, clientId: ctx.clientId };
    const { nonce, challenge } = deriveFromState(state, secret);
    const origin = process.env.NEXT_PUBLIC_SITE_URL;
    if (!origin) return back(requestId, "error", unavailable);
    url = buildAuthorizationUrl(await fetchDiscovery(client), client, { redirectUri: `${origin}/api/verification/student/return`, state, nonce, challenge });
  } catch (e) {
    reportError("verification.sso_start", e);
    return back(requestId, "error", "The university login is unavailable right now.");
  }
  redirect(url);
}

export async function cancelUniversitySso(formData: FormData): Promise<void> {
  await requireMember();
  const attemptId = formData.get("attemptId");
  const requestId = formData.get("requestId");
  if (typeof attemptId !== "string" || typeof requestId !== "string" || !z.string().uuid().safeParse(attemptId).success) return redirect("/verification/student");
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const { error } = await supabase.rpc("cancel_sso_attempt", { p_attempt: attemptId });
  return back(requestId, error ? "error" : "notice", error ? "That login cannot be cancelled." : "Cancelled.");
}
