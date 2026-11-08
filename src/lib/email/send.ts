import "server-only";
import { Resend } from "resend";
import { z } from "zod";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { reportError } from "@/lib/monitoring/report";
import type { EmailMessage } from "@/lib/email/templates";

/**
 * Server-side email service (Resend). Rules:
 *  - The API key lives only in RESEND_API_KEY on the server; nothing here is importable by the
 *    browser (server-only).
 *  - Authorization: the public entry point, `sendToMember`, only ever emails the address of the
 *    VERIFIED signed-in member passed in. No caller can choose an arbitrary recipient, so server
 *    actions cannot be abused to send mail to other people.
 *  - Categories: "transactional" and "security" always send. "activity" (comments, connections)
 *    respects notification_preferences.
 *  - Never throws. A failed or unconfigured email must not break sign-up, onboarding or a post.
 *  - Authentication emails (confirm, recover) are sent by Supabase Auth, not by this service.
 */

export type EmailCategory = "transactional" | "security" | "activity";

export type SendResult =
  | { status: "sent"; id: string | null }
  | { status: "skipped"; reason: "not_configured" | "preference_off" | "rate_limited" | "no_email" }
  | { status: "failed" };

const recipientSchema = z.email().max(254);
const messageSchema = z.object({
  subject: z.string().min(1).max(200),
  html: z.string().min(1).max(100_000),
  text: z.string().min(1).max(50_000),
});

let client: Resend | null | undefined;
function getResend(): Resend | null {
  if (client !== undefined) return client;
  const key = process.env.RESEND_API_KEY;
  client = key ? new Resend(key) : null;
  return client;
}

export function resetEmailClientForTests() {
  client = undefined;
}

/** "Medyra <hello@yourdomain.com>". The domain must be verified in Resend (EMAIL_SETUP.md). */
const fromAddress = () => process.env.EMAIL_FROM;

/** Reads the member's own preference row (row level security makes it owner-only). Default: on. */
async function activityEmailsEnabled(userId: string): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("notification_preferences")
      .select("notify_activity")
      .eq("user_id", userId)
      .maybeSingle();
    return data?.notify_activity ?? true;
  } catch (error) {
    reportError("notification_preferences.read", error);
    return true;
  }
}

export async function sendToMember(
  member: Pick<User, "id" | "email">,
  message: EmailMessage,
  category: EmailCategory,
): Promise<SendResult> {
  if (category === "activity" && !(await activityEmailsEnabled(member.id)))
    return { status: "skipped", reason: "preference_off" };
  return sendToAddress(member.email, message, member.id, category);
}

/**
 * Lower-level send used by sendToMember and by student verification only. The caller must have
 * obtained `address` from a trusted place: the signed-in member's own session, a school domain the
 * database confirmed for the institution, or the database function that returns a request owner's
 * address to an administrator. Never pass an address that arrived unchecked from a form. Rate
 * limited per `rateKey` (a member id).
 */
export async function sendToAddress(
  address: string | null | undefined,
  message: EmailMessage,
  rateKey: string,
  category: EmailCategory,
): Promise<SendResult> {
  const resend = getResend();
  const from = fromAddress();
  if (!resend || !from) return { status: "skipped", reason: "not_configured" };

  const to = recipientSchema.safeParse(address);
  if (!to.success) return { status: "skipped", reason: "no_email" };
  const body = messageSchema.safeParse(message);
  if (!body.success) {
    reportError("email.invalid-message", new Error("Invalid email payload"));
    return { status: "failed" };
  }

  const limited = await checkRateLimit("email", rateKey);
  if (!limited.ok) return { status: "skipped", reason: "rate_limited" };

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: [to.data],
      subject: body.data.subject,
      html: body.data.html,
      text: body.data.text,
    });
    if (error) {
      reportError("email.send", error, { category });
      return { status: "failed" };
    }
    return { status: "sent", id: data?.id ?? null };
  } catch (error) {
    reportError("email.send", error, { category });
    return { status: "failed" };
  }
}
