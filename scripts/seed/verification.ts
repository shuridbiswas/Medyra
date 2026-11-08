/**
 * DEVELOPMENT-ONLY fixtures for student verification, applied to the fictional seed accounts
 * (seed+...@example.com) of the locked development project. Every row is labelled
 * "[DEV TEST DATA]"; no document is created (evidence is a plainly fake text reference), nothing
 * here is a forged attestation, and it refuses to run anywhere but SEED_ALLOWED_PROJECT_REF.
 *   npm run seed:verification            add the scenarios
 *   npm run seed:verification -- --clean remove them
 * The same ten scenarios are exercised end to end by supabase/tests/student-verification.test.ts.
 */
import { assertDevOnly, loadEnvironment, requireManagementToken, SeedSafetyError } from "./safety.ts";
import { literal, managementQuery } from "./sql.ts";

const TAG = "[DEV TEST DATA]";

type Scenario = {
  name: string;
  slug: string;
  program?: string;
  claim: "CURRENT_STUDENT" | "CURRENT_PROGRAM_STUDENT";
  status: "APPROVED" | "REJECTED" | "EXPIRED" | "REVOKED" | "AWAITING_EVIDENCE";
  reason?: string;
  emailOnly?: boolean;
};

const SCENARIOS: Scenario[] = [
  { name: "Valid current enrolment (UdeM nursing)", slug: "udem", program: "nursing", claim: "CURRENT_PROGRAM_STUDENT", status: "APPROVED" },
  { name: "Valid enrolment, no program confirmed (McGill)", slug: "mcgill", claim: "CURRENT_STUDENT", status: "APPROVED" },
  { name: "Institution email verified only (UQAM)", slug: "uqam", claim: "CURRENT_STUDENT", status: "AWAITING_EVIDENCE", emailOnly: true },
  { name: "Expired attestation (Concordia)", slug: "concordia", claim: "CURRENT_STUDENT", status: "EXPIRED" },
  { name: "Historical enrolment (Sherbrooke)", slug: "sherbrooke", claim: "CURRENT_STUDENT", status: "REJECTED", reason: "not_current" },
  { name: "Incorrect program (Dawson nursing)", slug: "dawson", program: "nursing", claim: "CURRENT_PROGRAM_STUDENT", status: "REJECTED", reason: "program_not_confirmed" },
  { name: "Name mismatch (Vanier)", slug: "vanier", claim: "CURRENT_STUDENT", status: "REJECTED", reason: "identity_mismatch" },
  { name: "Duplicate identity claim (Laval)", slug: "laval", claim: "CURRENT_STUDENT", status: "REJECTED", reason: "duplicate_identity" },
  { name: "Rejected evidence (UdeM)", slug: "udem", claim: "CURRENT_STUDENT", status: "REJECTED", reason: "unverifiable_document" },
  { name: "Revoked credential (McGill)", slug: "mcgill", claim: "CURRENT_STUDENT", status: "REVOKED" },
];

const inst = (slug: string) => `(select id from public.academic_institutions where slug = ${literal(slug)})`;

function statements(userIds: string[]): string[] {
  const out: string[] = [];
  for (const slug of new Set(SCENARIOS.filter((s) => s.program).map((s) => s.slug))) {
    out.push(`insert into public.academic_programs (institution_id, category, official_name, credential_level, catalog_url, classification, source_reviewed_at)
      values (${inst(slug)}, 'nursing', ${literal(`Nursing programme (DEV TEST DATA)`)}, 'bachelor', 'https://example.test/dev-test-data', 'direct_entry_professional', now())
      on conflict do nothing`);
  }
  SCENARIOS.forEach((s, i) => {
    const user = literal(userIds[i]);
    const program = s.program ? `(select id from public.academic_programs where official_name like '%(DEV TEST DATA)' and institution_id = ${inst(s.slug)} limit 1)` : "null";
    const request = `gen_random_uuid()`;
    out.push(`with r as (
      insert into public.student_verification_requests
        (id, user_id, institution_id, requested_program_id, requested_claim_type, method, status, submitted_at, decision_reason_code, email_verified_at, email_domain, consent_version, consent_timestamp, student_message)
      values (${request}, ${user}, ${inst(s.slug)}, ${program}, ${literal(s.claim)}, 'OFFICIAL_ATTESTATION_REVIEW', ${literal(s.status)}, now() - interval '3 days',
        ${literal(s.reason ?? (s.status === "APPROVED" ? "approved" : null))}, ${s.emailOnly ? "now()" : "null"}, ${s.emailOnly ? "'school.test'" : "null"},
        'student-verification-2026-11-draft', now() - interval '3 days', ${literal(`${TAG} ${s.name}`)})
      returning id),
    e as (
      insert into public.student_verification_evidence (request_id, evidence_type, source_reference, retention_delete_at, validation_status)
      select id, 'issuer_share_reference', ${literal(`${TAG} fictional reference, not a real document`)}, now() + interval '30 days', ${literal(s.status === "APPROVED" || s.status === "EXPIRED" || s.status === "REVOKED" ? "validated" : "pending")} from r
      where ${s.emailOnly ? "false" : "true"})
    ${
      s.status === "APPROVED" || s.status === "EXPIRED" || s.status === "REVOKED"
        ? `insert into public.student_verified_credentials (user_id, institution_id, academic_program_id, claim_type, issuer, verification_method, verified_at, expires_at, expired_at, revoked_at, revocation_reason_code, source_reference_id)
      select ${user}, ${inst(s.slug)}, ${program}, ${literal(s.claim)}, ${literal(`${TAG} fictional issuer`)}, 'OFFICIAL_ATTESTATION_REVIEW', now() - interval '5 days',
        ${s.status === "EXPIRED" ? "now() - interval '1 day'" : "now() + interval '60 days'"}, ${s.status === "EXPIRED" ? "now()" : "null"},
        ${s.status === "REVOKED" ? "now()" : "null"}, ${s.status === "REVOKED" ? "'revoked_error'" : "null"}, id from r`
        : "select 1"
    }`);
  });
  return out;
}

async function main() {
  const env = loadEnvironment();
  const target = assertDevOnly(env);
  const token = requireManagementToken(env);
  const clean = process.argv.includes("--clean");

  if (clean) {
    await managementQuery(
      target.ref,
      token,
      `delete from public.student_verified_credentials where issuer like '${TAG}%';
       delete from public.student_verification_requests where student_message like '${TAG}%';
       delete from public.academic_programs where official_name like '%(DEV TEST DATA)';`,
    );
    console.log("Removed the student verification fixtures.");
    return;
  }

  const users = await managementQuery<{ id: string }[]>(
    target.ref,
    token,
    "select u.id from auth.users u join public.profiles p on p.id = u.id where u.email like 'seed+%@example.com' and p.onboarding_completed order by u.email limit 10",
  );
  if (users.length < SCENARIOS.length) {
    throw new SeedSafetyError(`Need ${SCENARIOS.length} completed seed accounts; found ${users.length}. Run npm run seed:dev first.`);
  }
  for (const sql of statements(users.map((u) => u.id))) await managementQuery(target.ref, token, sql);
  console.log(`Added ${SCENARIOS.length} labelled student verification scenarios to ${target.ref}.`);
  SCENARIOS.forEach((s, i) => console.log(`  ${i + 1}. ${s.name}`));
}

main().catch((error: unknown) => {
  console.error(error instanceof SeedSafetyError ? `Refused: ${error.message}` : error instanceof Error ? error.message : error);
  process.exit(1);
});
