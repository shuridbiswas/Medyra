"use server";

import { createHash, randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireMember } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { reportError } from "@/lib/monitoring/report";
import { sendToAddress, sendToMember } from "@/lib/email/send";
import { institutionalCodeEmail, verificationNoticeEmail } from "@/lib/email/templates";
import { parseLang, type Lang } from "@/features/student-verification/content";
import { EVIDENCE_BUCKET, cleanReference, inspectEvidence } from "@/features/student-verification/evidence";
import { emailAddressHash, emailCodeHash, generateEmailCode, isVerificationHashConfigured } from "@/features/student-verification/crypto";
import { friendlyDbError } from "@/features/student-verification/errors";
import { getInstitution } from "@/features/student-verification/queries";

/**
 * Member-side steps of student verification. Every action starts with requireMember(); the member
 * is always the verified session user, never an id from the form. Writes go through database
 * functions that check ownership again, so a forged request cannot touch someone else's request.
 * A step ends with a redirect carrying a short notice or error (nothing sensitive) back to the
 * wizard.
 */
const uuid = z.string().uuid();
const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

function back(requestId: string | null, lang: Lang, kind: "notice" | "error", message: string): never {
  const q = new URLSearchParams();
  if (requestId) q.set("request", requestId);
  q.set(kind, message.slice(0, 200));
  if (lang === "fr") q.set("lang", "fr");
  revalidatePath("/verification", "layout");
  redirect(`/verification/student?${q.toString()}`);
}

async function guard(lang: Lang, requestId: string | null) {
  const { user } = await requireMember();
  const limited = await checkRateLimit("verification", user.id);
  if (!limited.ok) back(requestId, lang, "error", limited.message);
  return user;
}

const db = async () => (await createClient()) as unknown as SupabaseClient;

const startSchema = z.object({
  institutionId: uuid,
  programId: uuid.nullable(),
  claim: z.enum(["CURRENT_STUDENT", "CURRENT_PROGRAM_STUDENT"]),
  method: z.enum(["ISSUER_BACKED_DOCUMENT_SHARE", "OFFICIAL_ATTESTATION_REVIEW", "REGISTRAR_CONFIRMATION"]),
});

export async function startVerification(formData: FormData): Promise<void> {
  const lang = parseLang(str(formData, "lang"));
  const user = await guard(lang, null);
  const programId = str(formData, "programId");
  const parsed = startSchema.safeParse({
    institutionId: str(formData, "institutionId"),
    programId: programId ? programId : null,
    claim: programId ? "CURRENT_PROGRAM_STUDENT" : "CURRENT_STUDENT",
    method: str(formData, "method"),
  });
  if (!parsed.success) back(null, lang, "error", lang === "fr" ? "Vérifiez les champs du formulaire." : "Please check the form fields.");
  const { institutionId, programId: program, claim, method } = parsed.data;
  const supabase = await db();
  const { data, error } = await supabase.rpc("start_student_verification", {
    p_institution: institutionId,
    p_program: program,
    p_claim: claim,
    p_method: method,
  });
  if (error || typeof data !== "string") {
    if (error) reportError("student_verification.start", error);
    back(null, lang, "error", friendlyDbError(error));
  }
  void user;
  back(data, lang, "notice", lang === "fr" ? "Demande créée." : "Request created.");
}

const requestField = (fd: FormData) => {
  const id = str(fd, "requestId");
  return uuid.safeParse(id).success ? id : null;
};

export async function sendInstitutionalCode(formData: FormData): Promise<void> {
  const lang = parseLang(str(formData, "lang"));
  const requestId = requestField(formData);
  const user = await guard(lang, requestId);
  if (!requestId) back(null, lang, "error", friendlyDbError(null));
  const email = str(formData, "email").trim().toLowerCase();
  const parsed = z.email().max(254).safeParse(email);
  if (!parsed.success) back(requestId, lang, "error", lang === "fr" ? "Adresse courriel invalide." : "That email address is not valid.");
  if (!isVerificationHashConfigured()) back(requestId, lang, "error", lang === "fr" ? "Cette étape n'est pas disponible pour le moment." : "This step is not available right now.");

  const supabase = await db();
  const { data: request } = await supabase
    .from("student_verification_requests")
    .select("institution_id")
    .eq("id", requestId)
    .eq("user_id", user.id)
    .maybeSingle();
  const found = request ? await getInstitution((request as { institution_id: string }).institution_id) : null;
  if (!found) back(requestId, lang, "error", friendlyDbError(null));

  const domain = email.split("@")[1];
  const code = generateEmailCode();
  // The database checks that the domain is one it confirmed for this institution, and rate limits.
  const { error } = await supabase.rpc("create_email_challenge", {
    p_request: requestId,
    p_domain: domain,
    p_email_hash: emailAddressHash(found.institution.id, email),
    p_code_hash: emailCodeHash(user.id, requestId, code),
  });
  if (error) {
    reportError("student_verification.email_challenge", error);
    back(requestId, lang, "error", friendlyDbError(error));
  }
  const sent = await sendToAddress(email, institutionalCodeEmail({ code, minutes: 15, institution: found.institution.name }), user.id, "security");
  if (sent.status !== "sent") back(requestId, lang, "error", lang === "fr" ? "Le courriel n'a pas pu être envoyé. Réessayez plus tard ou ignorez cette étape." : "We couldn't send the email. Try again later, or skip this step.");
  back(requestId, lang, "notice", lang === "fr" ? "Code envoyé. Il est valide 15 minutes." : "Code sent. It works for 15 minutes.");
}

export async function confirmInstitutionalCode(formData: FormData): Promise<void> {
  const lang = parseLang(str(formData, "lang"));
  const requestId = requestField(formData);
  const user = await guard(lang, requestId);
  if (!requestId) back(null, lang, "error", friendlyDbError(null));
  const code = str(formData, "code").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) back(requestId, lang, "error", lang === "fr" ? "Le code compte 6 chiffres." : "The code has 6 digits.");
  if (!isVerificationHashConfigured()) back(requestId, lang, "error", lang === "fr" ? "Cette étape n'est pas disponible pour le moment." : "This step is not available right now.");
  const supabase = await db();
  const { data, error } = await supabase.rpc("verify_email_challenge", {
    p_request: requestId,
    p_code_hash: emailCodeHash(user.id, requestId, code),
  });
  if (error) {
    reportError("student_verification.email_verify", error);
    back(requestId, lang, "error", friendlyDbError(error));
  }
  const messages: Record<string, { en: string; fr: string }> = {
    wrong: { en: "That code didn't match.", fr: "Ce code ne correspond pas." },
    expired: { en: "That code has expired. Ask for a new one.", fr: "Ce code a expiré. Demandez-en un nouveau." },
    invalid: { en: "There is no code waiting. Ask for a new one.", fr: "Aucun code en attente. Demandez-en un nouveau." },
    locked: { en: "Too many wrong tries. Ask for a new code.", fr: "Trop d'essais. Demandez un nouveau code." },
    in_use: { en: "That school address already confirmed another account.", fr: "Cette adresse scolaire a déjà confirmé un autre compte." },
  };
  if (data !== "ok") back(requestId, lang, "error", (messages[String(data)] ?? messages.invalid)[lang]);
  void sendToMember(user, verificationNoticeEmail({ firstName: String(user.user_metadata?.first_name ?? ""), notice: "email_confirmed" }), "transactional");
  back(requestId, lang, "notice", lang === "fr" ? "Courriel scolaire confirmé. Cela ne vérifie pas votre inscription." : "School email confirmed. This does not verify your enrolment yet.");
}

export async function skipEmailStep(formData: FormData): Promise<void> {
  const lang = parseLang(str(formData, "lang"));
  const requestId = requestField(formData);
  await guard(lang, requestId);
  if (!requestId) back(null, lang, "error", friendlyDbError(null));
  const { error } = await (await db()).rpc("skip_email_step", { p_request: requestId });
  if (error) back(requestId, lang, "error", friendlyDbError(error));
  back(requestId, lang, "notice", lang === "fr" ? "Étape ignorée." : "Step skipped.");
}

export async function uploadEvidence(formData: FormData): Promise<void> {
  const lang = parseLang(str(formData, "lang"));
  const requestId = requestField(formData);
  const user = await guard(lang, requestId);
  if (!requestId) back(null, lang, "error", friendlyDbError(null));
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) back(requestId, lang, "error", lang === "fr" ? "Choisissez un fichier." : "Choose a file.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const inspected = inspectEvidence(bytes, file.type);
  if (!inspected.ok) back(requestId, lang, "error", inspected.reason);

  const supabase = await db();
  const path = `${user.id}/${requestId}/${randomUUID()}.${inspected.ext}`;
  const upload = await supabase.storage.from(EVIDENCE_BUCKET).upload(path, bytes, { contentType: inspected.mime, upsert: false });
  if (upload.error) {
    reportError("student_verification.upload", upload.error);
    back(requestId, lang, "error", lang === "fr" ? "Le fichier n'a pas pu être enregistré. Vérifiez que la demande attend une preuve." : "The file couldn't be saved. Check that the request is waiting for evidence.");
  }
  const sha = createHash("sha256").update(bytes).digest("hex");
  const { error } = await supabase.rpc("add_verification_evidence", {
    p_request: requestId,
    p_type: "official_attestation",
    p_path: path,
    p_mime: inspected.mime,
    p_size: bytes.length,
    p_sha256: sha,
    p_reference: null,
  });
  if (error) {
    await supabase.storage.from(EVIDENCE_BUCKET).remove([path]);
    reportError("student_verification.add_evidence", error);
    back(requestId, lang, "error", friendlyDbError(error));
  }
  back(requestId, lang, "notice", lang === "fr" ? "Fichier ajouté." : "File added.");
}

export async function addReference(formData: FormData): Promise<void> {
  const lang = parseLang(str(formData, "lang"));
  const requestId = requestField(formData);
  await guard(lang, requestId);
  if (!requestId) back(null, lang, "error", friendlyDbError(null));
  const cleaned = cleanReference(str(formData, "reference"));
  if (!cleaned.ok) back(requestId, lang, "error", cleaned.reason);
  // Stored as text only. Medyra never requests this address.
  const { error } = await (await db()).rpc("add_verification_evidence", {
    p_request: requestId,
    p_type: "issuer_share_reference",
    p_path: null,
    p_mime: null,
    p_size: null,
    p_sha256: null,
    p_reference: cleaned.value,
  });
  if (error) back(requestId, lang, "error", friendlyDbError(error));
  back(requestId, lang, "notice", lang === "fr" ? "Référence ajoutée." : "Reference added.");
}

export async function submitVerification(formData: FormData): Promise<void> {
  const lang = parseLang(str(formData, "lang"));
  const requestId = requestField(formData);
  const user = await guard(lang, requestId);
  if (!requestId) back(null, lang, "error", friendlyDbError(null));
  if (formData.get("consent") !== "on") back(requestId, lang, "error", lang === "fr" ? "Veuillez accepter la déclaration de consentement." : "Please accept the consent statement.");
  const version = str(formData, "consentVersion");
  const { error } = await (await db()).rpc("submit_student_verification", { p_request: requestId, p_consent_version: version });
  if (error) {
    reportError("student_verification.submit", error);
    back(requestId, lang, "error", friendlyDbError(error));
  }
  void sendToMember(user, verificationNoticeEmail({ firstName: String(user.user_metadata?.first_name ?? ""), notice: "received" }), "transactional");
  back(requestId, lang, "notice", lang === "fr" ? "Demande soumise. Un évaluateur l'examinera." : "Submitted. A reviewer will look at it.");
}

export async function withdrawVerification(formData: FormData): Promise<void> {
  const lang = parseLang(str(formData, "lang"));
  const requestId = requestField(formData);
  await guard(lang, requestId);
  if (!requestId) back(null, lang, "error", friendlyDbError(null));
  const { error } = await (await db()).rpc("withdraw_student_verification", { p_request: requestId });
  if (error) back(requestId, lang, "error", friendlyDbError(error));
  back(requestId, lang, "notice", lang === "fr" ? "Demande retirée." : "Request withdrawn.");
}
