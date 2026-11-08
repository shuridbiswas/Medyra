import "server-only";
import { getBadges } from "@/features/student-verification/queries";
import { createClient } from "@/lib/supabase/server";
import type { CommunityRole, CommunityRow } from "@/lib/supabase/database.types";
import { getHiddenAuthorIds } from "@/features/safety/queries";
import { NETWORK_MEMBER_COLUMNS, type NetworkMember } from "@/features/network/types";
import { COMMUNITY_PAGE_SIZE, AUDIT_PAGE_SIZE, MEMBERS_PAGE_SIZE } from "@/features/communities/options";
import type { DirectoryParams } from "@/features/communities/schemas";

/**
 * Reads run under the member's own session, so row level security decides what is visible: a
 * private community's members, posts and announcements simply are not returned to outsiders.
 */

const LIST_COLUMNS =
  "id, slug, name, description, kind, visibility, institution, region_label, country, created_at, members:community_members(count)";

type ListRow = Pick<
  CommunityRow,
  "id" | "slug" | "name" | "description" | "kind" | "visibility" | "institution" | "region_label" | "country" | "created_at"
> & { members: { count: number }[] };

export type CommunityListItem = Omit<ListRow, "members"> & {
  /** Null when the member list is not visible to this viewer (a private community they are not in). */
  memberCount: number | null;
  role: CommunityRole | null;
  requestPending: boolean;
};

export type CommunityDetail = CommunityListItem & Pick<CommunityRow, "rules" | "created_by">;

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function viewerState(supabase: Supabase, viewerId: string, ids: string[]) {
  const roles = new Map<string, CommunityRole>();
  const pending = new Set<string>();
  if (ids.length === 0) return { roles, pending };
  const [members, requests] = await Promise.all([
    supabase
      .from("community_members")
      .select("community_id, role")
      .eq("user_id", viewerId)
      .in("community_id", ids)
      .overrideTypes<{ community_id: string; role: CommunityRole }[], { merge: false }>(),
    supabase
      .from("community_requests")
      .select("community_id")
      .eq("user_id", viewerId)
      .eq("status", "pending")
      .in("community_id", ids)
      .overrideTypes<{ community_id: string }[], { merge: false }>(),
  ]);
  for (const m of members.data ?? []) roles.set(m.community_id, m.role);
  for (const r of requests.data ?? []) pending.add(r.community_id);
  return { roles, pending };
}

function toItem(row: ListRow, roles: Map<string, CommunityRole>, pending: Set<string>): CommunityListItem {
  const { members, ...rest } = row;
  const role = roles.get(row.id) ?? null;
  const visible = row.visibility === "public" || role !== null;
  return { ...rest, memberCount: visible ? (members?.[0]?.count ?? 0) : null, role, requestPending: pending.has(row.id) };
}

export async function listCommunities(
  viewerId: string,
  { q, kind, visibility, scope, page }: DirectoryParams,
): Promise<{ items: CommunityListItem[]; total: number; failed?: boolean }> {
  const supabase = await createClient();

  let mineIds: string[] | undefined;
  if (scope === "mine") {
    const { data, error } = await supabase
      .from("community_members")
      .select("community_id")
      .eq("user_id", viewerId)
      .limit(500)
      .overrideTypes<{ community_id: string }[], { merge: false }>();
    if (error) return { items: [], total: 0, failed: true };
    mineIds = (data ?? []).map((m) => m.community_id);
    if (mineIds.length === 0) return { items: [], total: 0 };
  }

  let query = supabase.from("communities").select(LIST_COLUMNS, { count: "exact" }).is("archived_at", null);
  if (mineIds) query = query.in("id", mineIds);
  if (kind) query = query.eq("kind", kind);
  if (visibility) query = query.eq("visibility", visibility);
  if (q) query = query.or(`name.ilike.%${q}%,description.ilike.%${q}%,institution.ilike.%${q}%`);

  const from = (page - 1) * COMMUNITY_PAGE_SIZE;
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + COMMUNITY_PAGE_SIZE - 1)
    .overrideTypes<ListRow[], { merge: false }>();
  if (error || !data) return { items: [], total: 0, failed: true };

  const { roles, pending } = await viewerState(
    supabase,
    viewerId,
    data.map((r) => r.id),
  );
  return { items: data.map((r) => toItem(r, roles, pending)), total: count ?? data.length };
}

export async function getCommunityBySlug(viewerId: string, slug: string): Promise<CommunityDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("communities")
    .select(`${LIST_COLUMNS}, rules, created_by`)
    .eq("slug", slug)
    .maybeSingle()
    .overrideTypes<ListRow & Pick<CommunityRow, "rules" | "created_by">, { merge: false }>();
  if (!data) return null;
  const { roles, pending } = await viewerState(supabase, viewerId, [data.id]);
  const { rules, created_by } = data;
  return { ...toItem(data, roles, pending), rules, created_by };
}

export type MemberEntry = { role: CommunityRole; joined_at: string; member: NetworkMember };

type MemberRow = { role: CommunityRole; joined_at: string; member: NetworkMember | null };

const MEMBER_EMBED = `member:profiles!community_members_user_id_fkey(${NETWORK_MEMBER_COLUMNS})`;

/** Owner and moderators, then the other members a page at a time. Blocked and muted members are left out. */
export async function listCommunityMembers(
  viewerId: string,
  communityId: string,
  page: number,
): Promise<{ staff: MemberEntry[]; members: MemberEntry[]; total: number; failed?: boolean }> {
  const supabase = await createClient();
  const hidden = new Set(await getHiddenAuthorIds(viewerId));
  const keep = (rows: MemberRow[] | null): MemberEntry[] =>
    (rows ?? []).flatMap((r) =>
      r.member && !hidden.has(r.member.id) ? [{ role: r.role, joined_at: r.joined_at, member: r.member }] : [],
    );

  const from = (page - 1) * MEMBERS_PAGE_SIZE;
  const [staff, members] = await Promise.all([
    supabase
      .from("community_members")
      .select(`role, joined_at, ${MEMBER_EMBED}`)
      .eq("community_id", communityId)
      .in("role", ["owner", "moderator"])
      .order("joined_at", { ascending: true })
      .limit(100)
      .overrideTypes<MemberRow[], { merge: false }>(),
    supabase
      .from("community_members")
      .select(`role, joined_at, ${MEMBER_EMBED}`, { count: "exact" })
      .eq("community_id", communityId)
      .eq("role", "member")
      .order("joined_at", { ascending: true })
      .range(from, from + MEMBERS_PAGE_SIZE - 1)
      .overrideTypes<MemberRow[], { merge: false }>(),
  ]);
  if (staff.error || members.error) return { staff: [], members: [], total: 0, failed: true };
  const staffList = keep(staff.data);
  const memberList = keep(members.data);
  const badges = await getBadges([...staffList, ...memberList].map((e) => e.member.id));
  const badged = (list: MemberEntry[]) => list.map((e) => ({ ...e, member: { ...e.member, badge: badges.get(e.member.id) ?? null } }));
  return { staff: badged(staffList), members: badged(memberList), total: members.count ?? 0 };
}

export type JoinRequestEntry = { id: string; message: string | null; created_at: string; member: NetworkMember };

/** Pending requests. Only moderators get rows back (row level security). */
export async function listJoinRequests(communityId: string): Promise<JoinRequestEntry[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("community_requests")
    .select(`id, message, created_at, member:profiles!community_requests_user_id_fkey(${NETWORK_MEMBER_COLUMNS})`)
    .eq("community_id", communityId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(100)
    .overrideTypes<(Omit<JoinRequestEntry, "member"> & { member: NetworkMember | null })[], { merge: false }>();
  return (data ?? []).flatMap((r) => (r.member ? [{ ...r, member: r.member }] : []));
}

export type BanEntry = { reason: string; created_at: string; member: NetworkMember };

export async function listBans(communityId: string): Promise<BanEntry[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("community_bans")
    .select(`reason, created_at, member:profiles!community_bans_user_id_fkey(${NETWORK_MEMBER_COLUMNS})`)
    .eq("community_id", communityId)
    .order("created_at", { ascending: false })
    .limit(100)
    .overrideTypes<(Omit<BanEntry, "member"> & { member: NetworkMember | null })[], { merge: false }>();
  return (data ?? []).flatMap((b) => (b.member ? [{ ...b, member: b.member }] : []));
}

export type AnnouncementEntry = {
  id: string;
  title: string;
  body: string;
  created_at: string;
  author: { id: string; username: string | null; first_name: string; last_name: string } | null;
};

export async function listAnnouncements(communityId: string, limit = 5): Promise<AnnouncementEntry[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("community_announcements")
    .select("id, title, body, created_at, author:profiles!community_announcements_author_id_fkey(id, username, first_name, last_name)")
    .eq("community_id", communityId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit)
    .overrideTypes<AnnouncementEntry[], { merge: false }>();
  return data ?? [];
}

export type AuditEntry = {
  id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  actor: { first_name: string; last_name: string } | null;
  targetName: string | null;
};

/** The community's moderator log, newest first. Only moderators (and platform staff) get rows. */
export async function listAuditLog(
  communityId: string,
  page: number,
): Promise<{ entries: AuditEntry[]; total: number; failed?: boolean }> {
  const supabase = await createClient();
  const from = (page - 1) * AUDIT_PAGE_SIZE;
  const { data, error, count } = await supabase
    .from("community_audit_logs")
    .select(
      "id, action, target_type, target_id, metadata, created_at, actor:profiles!community_audit_logs_actor_id_fkey(first_name, last_name)",
      { count: "exact" },
    )
    .eq("community_id", communityId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + AUDIT_PAGE_SIZE - 1)
    .overrideTypes<Omit<AuditEntry, "targetName">[], { merge: false }>();
  if (error || !data) return { entries: [], total: 0, failed: true };

  const memberIds = [...new Set(data.filter((e) => e.target_type === "member" && e.target_id).map((e) => e.target_id as string))];
  const names = new Map<string, string>();
  if (memberIds.length > 0) {
    const { data: people } = await supabase
      .from("profiles")
      .select("id, first_name, last_name")
      .in("id", memberIds)
      .overrideTypes<{ id: string; first_name: string; last_name: string }[], { merge: false }>();
    for (const p of people ?? []) names.set(p.id, [p.first_name, p.last_name].filter(Boolean).join(" "));
  }
  return {
    entries: data.map((e) => ({ ...e, targetName: e.target_id ? (names.get(e.target_id) ?? null) : null })),
    total: count ?? data.length,
  };
}
