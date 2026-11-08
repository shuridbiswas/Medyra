import type { RequestStatus } from "@/features/student-verification/machine";
import type { BadgeCredential } from "@/features/student-verification/content";

export type InstitutionRow = {
  id: string;
  slug: string;
  name: string;
  name_en: string;
  name_fr: string;
  kind: "university" | "cegep" | "college";
  city: string | null;
  website: string | null;
  email_domains: string[];
  registrar_url: string | null;
  documents_url: string | null;
  instructions_en: string | null;
  instructions_fr: string | null;
  integration_status: string;
};

export type MethodRow = { method: string; status: "documented" | "requires_permission" | "unverified"; source_url: string | null; note: string | null };

export type ProgramRow = {
  id: string;
  institution_id: string;
  category: string;
  official_name: string;
  official_code: string | null;
  credential_level: string;
  classification: string;
  catalog_url: string | null;
  source_reviewed_at: string | null;
};

export type RequestRow = {
  id: string;
  user_id: string;
  institution_id: string;
  requested_program_id: string | null;
  requested_claim_type: "CURRENT_STUDENT" | "CURRENT_PROGRAM_STUDENT";
  method: string;
  status: RequestStatus;
  created_at: string;
  submitted_at: string | null;
  updated_at: string;
  reviewed_at: string | null;
  assigned_to: string | null;
  expires_at: string | null;
  decision_reason_code: string | null;
  student_message: string | null;
  consent_version: string | null;
  email_verified_at: string | null;
  email_domain: string | null;
  institution: Pick<InstitutionRow, "id" | "slug" | "name" | "name_en" | "name_fr"> | null;
  program: Pick<ProgramRow, "id" | "official_name" | "category"> | null;
};

export type EvidenceRow = {
  id: string;
  request_id: string;
  private_storage_path: string | null;
  evidence_type: string;
  source_reference: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_at: string;
  retention_delete_at: string;
  deleted_at: string | null;
  scan_status: "pending" | "static_ok" | "av_clean" | "quarantined";
  validation_status: "pending" | "validated" | "rejected";
};

export type EventRow = { id: string; request_id: string; from_status: string | null; to_status: string | null; event: string; created_at: string };

export type CredentialRow = {
  id: string;
  user_id: string;
  institution_id: string;
  academic_program_id: string | null;
  claim_type: string;
  issuer: string;
  verification_method: string;
  verified_at: string;
  academic_term_start: string | null;
  academic_term_end: string | null;
  expires_at: string;
  revoked_at: string | null;
  revocation_reason_code: string | null;
  expired_at: string | null;
  source_reference_id: string | null;
};

export type ReviewDetails = {
  request_id: string;
  issuer_verified: boolean;
  issuer_name: string | null;
  identity_linkage: "unchecked" | "matched" | "mismatch" | "ambiguous";
  enrolment_confirmed: boolean;
  program_confirmed: boolean;
  term_start: string | null;
  term_end: string | null;
  registrar_result: "not_requested" | "pending" | "confirmed" | "not_confirmed" | "ambiguous";
  binding_hash: string | null;
  reviewer_notes: string | null;
};

export type BadgeRow = BadgeCredential & { user_id: string; institution_id: string };

/** What a page needs to draw the badge for a member: their valid credentials, best first. */
export type MemberBadge = { credentials: BadgeRow[] };
