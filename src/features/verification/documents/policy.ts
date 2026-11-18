import type { DocumentAnalysis } from "./analysis";
import { compareNames, matchProgram, type CatalogProgram } from "./program-matcher";

export type Authenticity =
  | "NOT_CHECKED" | "ISSUER_VALIDATED" | "DIGITAL_SIGNATURE_VALIDATED" | "REGISTRAR_CONFIRMED" | "UNVERIFIABLE" | "SUSPECTED_TAMPERING";
const AUTHENTIC: Authenticity[] = ["ISSUER_VALIDATED", "DIGITAL_SIGNATURE_VALIDATED", "REGISTRAR_CONFIRMED"];

export type DocumentDecision = {
  /** program: may support a program credential after review; general: student status only; review: a person decides; reject: not usable. */
  outcome: "program" | "general" | "review" | "reject";
  reasons: string[];
  programId: string | null;
  nameMatch: "matched" | "mismatch" | "ambiguous";
};

/**
 * The decision matrix. It never approves anything and never trusts the analyzer's confidence: the
 * result is "eligible for a reviewer", and only an authentic document can reach "program" or "general".
 */
export function decideDocument(
  a: DocumentAnalysis,
  ctx: { institutionId: string; requestedProgramId: string | null; memberName: string | null; catalogue: CatalogProgram[]; authenticity: Authenticity; today: Date },
): DocumentDecision {
  const reasons: string[] = [];
  const match = matchProgram(a.exactProgramName, ctx.institutionId, ctx.catalogue);
  const nameMatch = compareNames(a.studentName, ctx.memberName);
  const base = { programId: match.programId, nameMatch };
  const out = (outcome: DocumentDecision["outcome"]): DocumentDecision => ({ outcome, reasons, ...base });

  if (a.documentType === "admission" || a.documentType === "diploma") { reasons.push("not_current_enrolment"); return out("reject"); }
  if (a.documentType !== "current_enrollment") { reasons.push("not_an_enrolment_document"); return out("review"); }
  if (a.claimedEnrollmentStatus !== "current") { reasons.push("enrolment_not_current"); return out("reject"); }
  const end = a.termEnd ? Date.parse(a.termEnd) : NaN;
  if (Number.isNaN(end)) { reasons.push("term_unknown"); return out("review"); }
  if (end < Date.UTC(ctx.today.getUTCFullYear(), ctx.today.getUTCMonth(), ctx.today.getUTCDate())) { reasons.push("term_ended"); return out("reject"); }
  if (nameMatch === "mismatch") { reasons.push("name_mismatch"); return out("review"); }
  if (nameMatch === "ambiguous") reasons.push("name_ambiguous");
  if (match.reason === "wrong_institution") { reasons.push("institution_mismatch"); return out("review"); }
  if (a.ambiguityFlags.length > 0) reasons.push("analyzer_flagged_ambiguity");
  // Nothing is eligible until the document itself is shown to be genuine, whatever the text says.
  if (!AUTHENTIC.includes(ctx.authenticity)) { reasons.push(ctx.authenticity === "SUSPECTED_TAMPERING" ? "suspected_tampering" : "authenticity_not_confirmed"); return out("review"); }
  if (nameMatch !== "matched" || a.ambiguityFlags.length > 0) return out("review");

  if (ctx.requestedProgramId) {
    if (match.programId && match.programId === ctx.requestedProgramId && !a.mentionsHealthcareWordsOnly) return out("program");
    reasons.push(match.programId ? "program_differs_from_request" : "program_not_confirmed");
    // A genuine current enrolment without the requested program supports only the general claim.
    return out("general");
  }
  return out("general");
}
