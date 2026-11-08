"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { reportError } from "@/lib/monitoring/report";
import { sendToAddress } from "@/lib/email/send";
import { verificationNoticeEmail, type VerificationNotice } from "@/lib/email/templates";
import { EVIDENCE_BUCKET, inspectEvidence } from "@/features/student-verification/evidence";
import { bindingHash, isVerificationHashConfigured } from "@/features/student-verification/crypto";
import { friendlyDbError } from "@/features/student-verification/errors";

/**
 * Reviewer actions. Every one starts with requireAdmin() (404 for everyone else, and a confirmed
 * sign-in). The decisions themselves happen inside database functions that re-check the reviewer
 * role, that the request is assigned to this reviewer, the checklist, and write the audit row in
 * the same transaction. Nothing a form sends is trusted as a status or a credential.
 */
const uuid = z.string().uuid();
const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};
const bool = (fd: FormData, key: string) => fd.get(key) === "on";
const db = async () => (await createClient()) as unknown as SupabaseClient;

function done(requestId: string | null, kind: "notice" | "error", message: string, tab?: string): never {
  const q = new URLSearchParams();
  if (tab) q.set("tab", tab);
  if (requestId) q.set("request", requestId);
  q.set(kind, message.slice(0, 200));
  revalidatePath("/admin/student-verifications");
  redirect(`/admin/student-verifications?${q.toString()}`);
}

async function guard(requestId: string | null) {
  const { user } = await requireAdmin();
  const limited = await checkRateLimit("api", user.id);
  if (!limited.ok) done(requestId, "error", limited.message);
  return user;
}

const requestId = (fd: FormData) => {
  const id = str(fd, "requestId");
  return uuid.safeParse(id).success ? id : null;
};

/** Emails the request's owner a short pointer to the dashboard. Failure never blocks the decision. */
async function notify(supabase: SupabaseClient, request: string, notice: VerificationNotice) {
  try {
    const { data } = await supabase.rpc("verification_notice_recipient", { p_request: request });
    const row = (Array.isArray(data) ? data[0] : data) as { user_id: string; email: string; first_name: string } | null;
    if (row?.email) await sendToAddress(row.email, verificationNoticeEmail({ firstName: row.first_name ?? "", notice }), row.user_id, "transactional");
  } catch (error) {
    reportError("student_verification.notify", error);
  }
}

async function rpc(name: string, args: Record<string, unknown>, id: string | null) {
  const supabase = await db();
  const { error } = await supabase.rpc(name, args);
  if (error) {
    reportError(`student_verification.${name}`, error);
    done(id, "error", friendlyDbError(error), "review");
  }
  return supabase;
}

export async function claimVerification(formData: FormData): Promise<void> {
  const id = requestId(formData);
  await guard(id);
  if (!id) done(null, "error", friendlyDbError(null));
  await rpc("claim_student_verification", { p_request: id }, id);
  done(id, "notice", "Review started.", "review");
}

/**
 * Reads the stored file's real bytes and records the result. The member's own upload check is not
 * trusted: a file only becomes openable after this reviewer-triggered inspection passes.
 */
export async function inspectEvidenceFile(formData: FormData): Promise<void> {
  const id = requestId(formData);
  await guard(id);
  const evidenceId = str(formData, "evidenceId");
  if (!id || !uuid.safeParse(evidenceId).success) done(id, "error", friendlyDbError(null));
  const supabase = await db();
  const { data: row } = await supabase
    .from("student_verification_evidence")
    .select("private_storage_path, mime_type, request_id")
    .eq("id", evidenceId)
    .eq("request_id", id)
    .maybeSingle();
  const path = (row as { private_storage_path: string | null; mime_type: string | null } | null)?.private_storage_path;
  if (!path) done(id, "error", "That item is not a stored file.", "review");
  const file = await supabase.storage.from(EVIDENCE_BUCKET).download(path);
  let result: "static_ok" | "quarantined" = "quarantined";
  let message = "The file could not be read, so it was quarantined.";
  if (!file.error && file.data) {
    const inspected = inspectEvidence(new Uint8Array(await file.data.arrayBuffer()), (row as { mime_type: string | null }).mime_type ?? undefined);
    if (inspected.ok) {
      result = "static_ok";
      message = "Inspection passed (static checks only; this is not an antivirus scan).";
    } else message = `Quarantined: ${inspected.reason}`;
  }
  await rpc("set_evidence_scan", { p_evidence: evidenceId, p_status: result }, id);
  done(id, result === "static_ok" ? "notice" : "error", message, "review");
}

/** A short-lived link, created only for a file that passed inspection (and an AV scan if required). */
export async function openEvidenceFile(formData: FormData): Promise<void> {
  const id = requestId(formData);
  await guard(id);
  const evidenceId = str(formData, "evidenceId");
  if (!id || !uuid.safeParse(evidenceId).success) done(id, "error", friendlyDbError(null));
  const supabase = await db();
  const { data: row } = await supabase
    .from("student_verification_evidence")
    .select("private_storage_path, scan_status")
    .eq("id", evidenceId)
    .eq("request_id", id)
    .is("deleted_at", null)
    .maybeSingle();
  const evidence = row as { private_storage_path: string | null; scan_status: string } | null;
  const allowed = process.env.EVIDENCE_AV_REQUIRED === "true" ? ["av_clean"] : ["static_ok", "av_clean"];
  if (!evidence?.private_storage_path || !allowed.includes(evidence.scan_status)) {
    done(id, "error", process.env.EVIDENCE_AV_REQUIRED === "true" ? "Files stay closed until an antivirus scan passes." : "Inspect the file first.", "review");
  }
  const { data, error } = await supabase.storage.from(EVIDENCE_BUCKET).createSignedUrl(evidence.private_storage_path, 60);
  if (error || !data?.signedUrl) done(id, "error", "The file could not be opened.", "review");
  redirect(data.signedUrl);
}

export async function reviewEvidenceItem(formData: FormData): Promise<void> {
  const id = requestId(formData);
  await guard(id);
  const evidenceId = str(formData, "evidenceId");
  const status = str(formData, "status");
  if (!id || !uuid.safeParse(evidenceId).success || !["validated", "rejected"].includes(status)) done(id, "error", friendlyDbError(null));
  await rpc("review_evidence", { p_evidence: evidenceId, p_status: status }, id);
  done(id, "notice", "Evidence updated.", "review");
}

const checksSchema = z.object({
  issuerVerified: z.boolean(),
  issuerName: z.string().trim().max(200),
  identityLinkage: z.enum(["unchecked", "matched", "mismatch", "ambiguous"]),
  enrolmentConfirmed: z.boolean(),
  programConfirmed: z.boolean(),
  termStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")),
  termEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")),
  registrarResult: z.enum(["not_requested", "pending", "confirmed", "not_confirmed", "ambiguous"]),
  notes: z.string().trim().max(2000),
});

export async function saveChecks(formData: FormData): Promise<void> {
  const id = requestId(formData);
  await guard(id);
  const parsed = checksSchema.safeParse({
    issuerVerified: bool(formData, "issuerVerified"),
    issuerName: str(formData, "issuerName"),
    identityLinkage: str(formData, "identityLinkage"),
    enrolmentConfirmed: bool(formData, "enrolmentConfirmed"),
    programConfirmed: bool(formData, "programConfirmed"),
    termStart: str(formData, "termStart"),
    termEnd: str(formData, "termEnd"),
    registrarResult: str(formData, "registrarResult"),
    notes: str(formData, "notes"),
  });
  if (!id || !parsed.success) done(id, "error", "Please check the checklist fields.", "review");
  const c = parsed.data;
  const supabase = await db();

  // The identity reference is typed once, hashed here and never stored; leaving it blank keeps the existing one.
  let binding: string | null = null;
  const identifier = str(formData, "identifier").trim();
  if (identifier) {
    if (!isVerificationHashConfigured()) done(id, "error", "VERIFICATION_SECRET (or TWO_FACTOR_SECRET) is not set, so identity references cannot be recorded.", "review");
    const { data: req } = await supabase.from("student_verification_requests").select("institution_id").eq("id", id).maybeSingle();
    if (!req) done(id, "error", friendlyDbError(null), "review");
    binding = bindingHash((req as { institution_id: string }).institution_id, identifier);
  } else {
    const { data: existing } = await supabase.from("verification_review_details").select("binding_hash").eq("request_id", id).maybeSingle();
    binding = (existing as { binding_hash: string | null } | null)?.binding_hash ?? null;
  }
  await rpc(
    "record_verification_checks",
    {
      p_request: id,
      p_issuer_verified: c.issuerVerified,
      p_issuer_name: c.issuerName || null,
      p_identity_linkage: c.identityLinkage,
      p_enrolment_confirmed: c.enrolmentConfirmed,
      p_program_confirmed: c.programConfirmed,
      p_term_start: c.termStart || null,
      p_term_end: c.termEnd || null,
      p_registrar_result: c.registrarResult,
      p_binding_hash: binding,
      p_notes: c.notes || null,
    },
    id,
  );
  done(id, "notice", "Checklist saved.", "review");
}

export async function requestMoreInformation(formData: FormData): Promise<void> {
  const id = requestId(formData);
  await guard(id);
  if (!id) done(null, "error", friendlyDbError(null));
  const supabase = await rpc("request_more_information", { p_request: id, p_message: str(formData, "message") }, id);
  await notify(supabase, id, "more_information");
  done(id, "notice", "The member has been asked for more information.", "info");
}

export async function rejectVerification(formData: FormData): Promise<void> {
  const id = requestId(formData);
  await guard(id);
  if (!id) done(null, "error", friendlyDbError(null));
  const supabase = await rpc("reject_verification", { p_request: id, p_reason: str(formData, "reason"), p_message: str(formData, "message") || null }, id);
  await notify(supabase, id, "rejected");
  done(id, "notice", "Request rejected.", "rejected");
}

export async function approveVerification(formData: FormData): Promise<void> {
  const id = requestId(formData);
  await guard(id);
  const claim = str(formData, "claim");
  const expiry = str(formData, "expiresOn");
  if (!id || !["CURRENT_STUDENT", "CURRENT_PROGRAM_STUDENT"].includes(claim) || (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry))) {
    done(id, "error", friendlyDbError(null), "review");
  }
  const supabase = await rpc("approve_verification", { p_request: id, p_claim: claim, p_expires_at: expiry ? `${expiry}T23:59:59Z` : null }, id);
  await notify(supabase, id, "approved");
  done(id, "notice", "Approved. The credential was issued.", "approved");
}

export async function revokeCredential(formData: FormData): Promise<void> {
  const id = requestId(formData);
  await guard(id);
  const credential = str(formData, "credentialId");
  if (!uuid.safeParse(credential).success) done(id, "error", friendlyDbError(null));
  const supabase = await rpc("revoke_student_credential", { p_credential: credential, p_reason: str(formData, "reason") }, id);
  if (id) await notify(supabase, id, "revoked");
  done(id, "notice", "Credential revoked. The badge is gone immediately.", "ended");
}

export async function setCredentialExpiry(formData: FormData): Promise<void> {
  const id = requestId(formData);
  await guard(id);
  const credential = str(formData, "credentialId");
  const on = str(formData, "expiresOn");
  if (!uuid.safeParse(credential).success || !/^\d{4}-\d{2}-\d{2}$/.test(on)) done(id, "error", friendlyDbError(null));
  await rpc("set_credential_expiry", { p_credential: credential, p_expires_at: `${on}T23:59:59Z` }, id);
  done(id, "notice", "Expiry updated.", "approved");
}

export async function runExpiry(): Promise<void> {
  await guard(null);
  const supabase = await db();
  const { data, error } = await supabase.rpc("expire_student_credentials");
  if (error) done(null, "error", friendlyDbError(error));
  done(null, "notice", `Expiry run finished: ${String(data ?? 0)} credential(s) expired.`, "audit");
}

/** Deletes evidence whose retention time is up from Storage, then clears the database record. */
export async function purgeDueEvidence(): Promise<void> {
  await guard(null);
  const supabase = await db();
  const { data, error } = await supabase.rpc("due_evidence_deletions");
  if (error) done(null, "error", friendlyDbError(error));
  const rows = (data ?? []) as { id: string; private_storage_path: string | null }[];
  const paths = rows.map((r) => r.private_storage_path).filter((p): p is string => Boolean(p));
  if (paths.length > 0) {
    const removed = await supabase.storage.from(EVIDENCE_BUCKET).remove(paths);
    if (removed.error) {
      reportError("student_verification.purge", removed.error);
      done(null, "error", "Some files could not be deleted, so nothing was cleared.", "audit");
    }
  }
  const cleared = await supabase.rpc("mark_evidence_deleted", { p_ids: rows.map((r) => r.id) });
  if (cleared.error) done(null, "error", friendlyDbError(cleared.error), "audit");
  done(null, "notice", `Deleted ${rows.length} item(s) past their retention date.`, "audit");
}
