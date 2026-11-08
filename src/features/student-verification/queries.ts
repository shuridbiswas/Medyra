import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/monitoring/report";
import type {
  BadgeRow,
  CredentialRow,
  EventRow,
  EvidenceRow,
  InstitutionRow,
  MemberBadge,
  MethodRow,
  ProgramRow,
  RequestRow,
  ReviewDetails,
} from "@/features/student-verification/types";
import type { RequestStatus } from "@/features/student-verification/machine";

/**
 * Reads for student verification. These tables are newer than the generated database types, so the
 * client is used untyped here and every result is given its row type explicitly. Row level
 * security decides what each caller can see; nothing here widens it.
 */
type Db = SupabaseClient;
const db = async () => (await createClient()) as unknown as Db;

const REQUEST_SELECT =
  "id, user_id, institution_id, requested_program_id, requested_claim_type, method, status, created_at, submitted_at, updated_at, reviewed_at, assigned_to, expires_at, decision_reason_code, student_message, consent_version, email_verified_at, email_domain, " +
  "institution:academic_institutions(id, slug, name, name_en, name_fr), program:academic_programs(id, official_name, category)";

export async function listInstitutions(): Promise<InstitutionRow[]> {
  const supabase = await db();
  const { data, error } = await supabase
    .from("academic_institutions")
    .select("id, slug, name, name_en, name_fr, kind, city, website, email_domains, registrar_url, documents_url, instructions_en, instructions_fr, integration_status")
    .eq("active", true)
    .order("kind")
    .order("name");
  if (error) {
    reportError("student_verification.institutions", error);
    return [];
  }
  return (data ?? []) as InstitutionRow[];
}

export async function getInstitution(id: string): Promise<{ institution: InstitutionRow; methods: MethodRow[]; programs: ProgramRow[] } | null> {
  const supabase = await db();
  const [inst, methods, programs] = await Promise.all([
    supabase
      .from("academic_institutions")
      .select("id, slug, name, name_en, name_fr, kind, city, website, email_domains, registrar_url, documents_url, instructions_en, instructions_fr, integration_status")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("institution_verification_methods").select("method, status, source_url, note").eq("institution_id", id),
    supabase
      .from("academic_programs")
      .select("id, institution_id, category, official_name, official_code, credential_level, classification, catalog_url, source_reviewed_at")
      .eq("institution_id", id)
      .eq("active", true)
      .order("official_name"),
  ]);
  if (inst.error || !inst.data) return null;
  return { institution: inst.data as InstitutionRow, methods: (methods.data ?? []) as MethodRow[], programs: (programs.data ?? []) as ProgramRow[] };
}

export async function getMyRequests(userId: string): Promise<RequestRow[]> {
  const supabase = await db();
  const { data, error } = await supabase
    .from("student_verification_requests")
    .select(REQUEST_SELECT)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    reportError("student_verification.my_requests", error);
    return [];
  }
  return (data ?? []) as unknown as RequestRow[];
}

export async function getRequestDetail(id: string): Promise<{ request: RequestRow; evidence: EvidenceRow[]; events: EventRow[] } | null> {
  const supabase = await db();
  const { data, error } = await supabase.from("student_verification_requests").select(REQUEST_SELECT).eq("id", id).maybeSingle();
  if (error || !data) return null;
  const [evidence, events] = await Promise.all([
    supabase
      .from("student_verification_evidence")
      .select("id, request_id, private_storage_path, evidence_type, source_reference, mime_type, size_bytes, uploaded_at, retention_delete_at, deleted_at, scan_status, validation_status")
      .eq("request_id", id)
      .is("deleted_at", null)
      .order("uploaded_at"),
    supabase.from("verification_review_events").select("id, request_id, from_status, to_status, event, created_at").eq("request_id", id).order("created_at"),
  ]);
  return { request: data as unknown as RequestRow, evidence: (evidence.data ?? []) as EvidenceRow[], events: (events.data ?? []) as EventRow[] };
}

export async function getMyCredentials(userId: string): Promise<CredentialRow[]> {
  const supabase = await db();
  const { data } = await supabase
    .from("student_verified_credentials")
    .select("id, user_id, institution_id, academic_program_id, claim_type, issuer, verification_method, verified_at, academic_term_start, academic_term_end, expires_at, revoked_at, revocation_reason_code, expired_at, source_reference_id")
    .eq("user_id", userId)
    .order("verified_at", { ascending: false });
  return (data ?? []) as CredentialRow[];
}

export async function getPolicy(): Promise<{ consent_version: string; evidence_retention_days: number }> {
  const supabase = await db();
  const { data } = await supabase.from("verification_policy").select("consent_version, evidence_retention_days").maybeSingle();
  return (data as { consent_version: string; evidence_retention_days: number } | null) ?? { consent_version: "", evidence_retention_days: 90 };
}

/**
 * The one way any page learns who is verified. Asks the database at the moment of the request (it
 * checks expiry and revocation itself), so there is nothing to invalidate and nothing cached.
 * On any failure the answer is "not verified", never "verified".
 */
export async function getBadges(memberIds: string[]): Promise<Map<string, MemberBadge>> {
  const out = new Map<string, MemberBadge>();
  const ids = [...new Set(memberIds)].slice(0, 200);
  if (ids.length === 0) return out;
  try {
    const supabase = await db();
    const { data, error } = await supabase.rpc("verified_badges", { p_users: ids });
    if (error) {
      reportError("student_verification.badges", error);
      return out;
    }
    for (const row of (data ?? []) as BadgeRow[]) {
      const entry = out.get(row.user_id) ?? { credentials: [] };
      entry.credentials.push(row);
      out.set(row.user_id, entry);
    }
  } catch (error) {
    reportError("student_verification.badges", error);
  }
  return out;
}

/** Adds `badge` to anything with an `id`, in one round trip. */
export async function withBadges<T extends { id: string }>(members: T[]): Promise<(T & { badge: MemberBadge | null })[]> {
  const map = await getBadges(members.map((m) => m.id));
  return members.map((m) => ({ ...m, badge: map.get(m.id) ?? null }));
}

// --- Administrators -------------------------------------------------------------------------

export const ADMIN_TABS = ["pending", "review", "info", "approved", "rejected", "ended", "audit"] as const;
export type AdminTabKey = (typeof ADMIN_TABS)[number];
export const parseAdminTab = (v: unknown): AdminTabKey => (ADMIN_TABS as readonly string[]).includes(v as string) ? (v as AdminTabKey) : "pending";

const TAB_STATUSES: Record<Exclude<AdminTabKey, "audit">, RequestStatus[]> = {
  pending: ["SUBMITTED"],
  review: ["UNDER_REVIEW"],
  info: ["MORE_INFORMATION_REQUIRED"],
  approved: ["APPROVED"],
  rejected: ["REJECTED"],
  ended: ["EXPIRED", "REVOKED"],
};

export type AdminRequest = RequestRow & { member: { first_name: string | null; last_name: string | null; username: string | null } | null };

export async function listAdminRequests(tab: Exclude<AdminTabKey, "audit">): Promise<AdminRequest[]> {
  const supabase = await db();
  const { data, error } = await supabase
    .from("student_verification_requests")
    .select(`${REQUEST_SELECT}, member:profiles!student_verification_requests_user_id_fkey(first_name, last_name, username)`)
    .in("status", TAB_STATUSES[tab])
    .order("submitted_at", { ascending: true, nullsFirst: false })
    .limit(100);
  if (error) {
    reportError("student_verification.admin_list", error);
    return [];
  }
  return (data ?? []) as unknown as AdminRequest[];
}

export async function getAdminDetail(id: string) {
  const detail = await getRequestDetail(id);
  if (!detail) return null;
  const supabase = await db();
  const [details, member, credentials] = await Promise.all([
    supabase
      .from("verification_review_details")
      .select("request_id, issuer_verified, issuer_name, identity_linkage, enrolment_confirmed, program_confirmed, term_start, term_end, registrar_result, binding_hash, reviewer_notes")
      .eq("request_id", id)
      .maybeSingle(),
    supabase.from("profiles").select("first_name, last_name, username").eq("id", detail.request.user_id).maybeSingle(),
    supabase
      .from("student_verified_credentials")
      .select("id, user_id, institution_id, academic_program_id, claim_type, issuer, verification_method, verified_at, academic_term_start, academic_term_end, expires_at, revoked_at, revocation_reason_code, expired_at, source_reference_id")
      .eq("source_reference_id", id),
  ]);
  return {
    ...detail,
    details: (details.data ?? null) as ReviewDetails | null,
    member: (member.data ?? null) as { first_name: string | null; last_name: string | null; username: string | null } | null,
    credentials: (credentials.data ?? []) as CredentialRow[],
  };
}

export async function listAudit(): Promise<{ id: string; actor_id: string | null; action: string; target_type: string; target_id: string | null; created_at: string; metadata: Record<string, unknown> }[]> {
  const supabase = await db();
  const { data } = await supabase
    .from("verification_audit_log")
    .select("id, actor_id, action, target_type, target_id, created_at, metadata")
    .order("created_at", { ascending: false })
    .limit(100);
  return (data ?? []) as never;
}
