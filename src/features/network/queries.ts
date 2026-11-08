import "server-only";
import { getBadges, withBadges } from "@/features/student-verification/queries";
import { createClient } from "@/lib/supabase/server";
import {
  CONNECTIONS_PAGE_SIZE,
  DIRECTORY_PAGE_SIZE,
  MEMBER_GROUPS,
  REQUESTS_PAGE_SIZE,
} from "@/features/network/options";
import {
  nameTerms,
  pageRange,
  type DirectoryFilters,
} from "@/features/network/schemas";
import {
  NETWORK_MEMBER_COLUMNS,
  noRelationship,
  type NetworkCounts,
  type NetworkMember,
  type NetworkRequest,
  type Relationship,
} from "@/features/network/types";

/**
 * Reads go through the member's own session, so row level security decides what is visible:
 * accepted connections and follows are visible to members, pending requests only to the two
 * people involved, blocks only to the blocker.
 */

type ConnectionRow = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: "pending" | "accepted";
  created_at: string;
};

function relationshipFrom(
  viewerId: string,
  connection: ConnectionRow | undefined,
  following: boolean,
): Relationship {
  if (!connection) return { ...noRelationship, following };
  const state =
    connection.status === "accepted"
      ? "connected"
      : connection.requester_id === viewerId
        ? "request_sent"
        : "request_received";
  return { state, connectionId: connection.id, following };
}

/** Ids come from the database (or a validated uuid), so they are safe inside a filter string. */
const idList = (ids: string[]) => ids.join(",");

export async function getRelationships(
  viewerId: string,
  memberIds: string[],
): Promise<Map<string, Relationship>> {
  const result = new Map<string, Relationship>();
  const ids = [...new Set(memberIds)].filter((id) => id !== viewerId);
  if (ids.length === 0) return result;

  const supabase = await createClient();
  const [connections, follows] = await Promise.all([
    supabase
      .from("connections")
      .select("id, requester_id, addressee_id, status, created_at")
      .or(
        `and(requester_id.eq.${viewerId},addressee_id.in.(${idList(ids)})),and(addressee_id.eq.${viewerId},requester_id.in.(${idList(ids)}))`,
      )
      .overrideTypes<ConnectionRow[], { merge: false }>(),
    supabase
      .from("follows")
      .select("followee_id")
      .eq("follower_id", viewerId)
      .in("followee_id", ids)
      .overrideTypes<{ followee_id: string }[], { merge: false }>(),
  ]);

  const followed = new Set((follows.data ?? []).map((f) => f.followee_id));
  const byOther = new Map<string, ConnectionRow>();
  for (const c of connections.data ?? [])
    byOther.set(c.requester_id === viewerId ? c.addressee_id : c.requester_id, c);

  for (const id of ids)
    result.set(id, relationshipFrom(viewerId, byOther.get(id), followed.has(id)));
  return result;
}

export async function getRelationship(
  viewerId: string,
  memberId: string,
): Promise<Relationship> {
  const map = await getRelationships(viewerId, [memberId]);
  return map.get(memberId) ?? noRelationship;
}

async function countOf(
  query: PromiseLike<{ count: number | null; error: unknown }>,
): Promise<number> {
  const { count, error } = await query;
  return error ? 0 : (count ?? 0);
}

/** Accurate counts straight from the rows. */
export async function getNetworkCounts(profileId: string): Promise<NetworkCounts> {
  const supabase = await createClient();
  const [connections, followers, following] = await Promise.all([
    countOf(
      supabase
        .from("connections")
        .select("id", { count: "exact", head: true })
        .eq("status", "accepted")
        .or(`requester_id.eq.${profileId},addressee_id.eq.${profileId}`),
    ),
    countOf(
      supabase
        .from("follows")
        .select("follower_id", { count: "exact", head: true })
        .eq("followee_id", profileId),
    ),
    countOf(
      supabase
        .from("follows")
        .select("followee_id", { count: "exact", head: true })
        .eq("follower_id", profileId),
    ),
  ]);
  return { connections, followers, following };
}

export async function countIncomingRequests(viewerId: string): Promise<number> {
  const supabase = await createClient();
  return countOf(
    supabase
      .from("connections")
      .select("id", { count: "exact", head: true })
      .eq("addressee_id", viewerId)
      .eq("status", "pending"),
  );
}

export async function getBlockedIds(viewerId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("member_blocks")
    .select("blocked_id")
    .eq("blocker_id", viewerId)
    .overrideTypes<{ blocked_id: string }[], { merge: false }>();
  return (data ?? []).map((b) => b.blocked_id);
}

export async function listBlockedMembers(viewerId: string): Promise<NetworkMember[]> {
  const ids = await getBlockedIds(viewerId);
  if (ids.length === 0) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select(NETWORK_MEMBER_COLUMNS)
    .in("id", ids)
    .overrideTypes<NetworkMember[], { merge: false }>();
  return data ?? [];
}

const MEMBER_EMBED = (fk: string) =>
  `member:profiles!${fk}(${NETWORK_MEMBER_COLUMNS})`;

type RequestRow = {
  id: string;
  created_at: string;
  member: NetworkMember | null;
};

/** Pending requests: `incoming` are waiting on the viewer, `outgoing` are waiting on others. */
export async function listRequests(
  viewerId: string,
  direction: "incoming" | "outgoing",
): Promise<{ requests: NetworkRequest[]; failed?: boolean }> {
  const supabase = await createClient();
  const incoming = direction === "incoming";
  const { data, error } = await supabase
    .from("connections")
    .select(
      `id, created_at, ${MEMBER_EMBED(incoming ? "connections_requester_id_fkey" : "connections_addressee_id_fkey")}`,
    )
    .eq(incoming ? "addressee_id" : "requester_id", viewerId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(REQUESTS_PAGE_SIZE)
    .overrideTypes<RequestRow[], { merge: false }>();

  if (error || !data) return { requests: [], failed: true };
  const badges = await getBadges(data.map((r) => r.member?.id ?? ""));
  return {
    requests: data
      .filter((r) => r.member !== null)
      .map((r) => ({
        id: r.id,
        created_at: r.created_at,
        member: { ...(r.member as NetworkMember), badge: badges.get(r.member?.id ?? "") ?? null },
      })),
  };
}

type ConnectionListRow = {
  id: string;
  requester_id: string;
  addressee_id: string;
  requester: NetworkMember | null;
  addressee: NetworkMember | null;
};

/** Accepted connections of `profileId`, most recent first, with page numbers. */
export async function listConnections(
  profileId: string,
  page: number,
  size = CONNECTIONS_PAGE_SIZE,
): Promise<{ members: NetworkMember[]; total: number; failed?: boolean }> {
  const supabase = await createClient();
  const { from, to } = pageRange(page, size);
  const { data, error, count } = await supabase
    .from("connections")
    .select(
      `id, requester_id, addressee_id, requester:profiles!connections_requester_id_fkey(${NETWORK_MEMBER_COLUMNS}), addressee:profiles!connections_addressee_id_fkey(${NETWORK_MEMBER_COLUMNS})`,
      { count: "exact" },
    )
    .eq("status", "accepted")
    .or(`requester_id.eq.${profileId},addressee_id.eq.${profileId}`)
    .order("accepted_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to)
    .overrideTypes<ConnectionListRow[], { merge: false }>();

  if (error || !data) return { members: [], total: 0, failed: true };
  const members = data
    .map((c) => (c.requester_id === profileId ? c.addressee : c.requester))
    .filter((m): m is NetworkMember => m !== null && Boolean(m.username));
  return { members: await withBadges(members), total: count ?? members.length };
}

/** The member directory. Self, unfinished profiles and members the viewer blocked are left out. */
export async function searchDirectory(
  viewerId: string,
  filters: DirectoryFilters,
): Promise<{ members: NetworkMember[]; total: number; failed?: boolean }> {
  const supabase = await createClient();
  const blocked = await getBlockedIds(viewerId);

  let query = supabase
    .from("profiles")
    .select(NETWORK_MEMBER_COLUMNS, { count: "exact" })
    .eq("onboarding_completed", true)
    .eq("directory_listed", true)
    .not("username", "is", null)
    .neq("id", viewerId);

  if (blocked.length > 0) query = query.not("id", "in", `(${idList(blocked)})`);

  // Every term must match the name or username (separate .or() calls are ANDed).
  for (const term of nameTerms(filters.q)) {
    query = query.or(
      `username.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%`,
    );
  }
  if (filters.group) {
    const group = MEMBER_GROUPS.find((g) => g.value === filters.group);
    if (group) query = query.in("member_type", [...group.types]);
  }
  if (filters.field) query = query.contains("fields", [filters.field]);
  if (filters.institution)
    query = query.ilike("institution", `%${filters.institution}%`);
  if (filters.country) query = query.eq("country", filters.country);
  if (filters.region) query = query.ilike("location_label", `%${filters.region}%`);
  if (filters.mentorship === "offering") query = query.eq("open_to_mentor", true);
  if (filters.mentorship === "seeking")
    query = query.eq("looking_for_mentorship", true);

  const { from, to } = pageRange(filters.page, DIRECTORY_PAGE_SIZE);
  const { data, error, count } = await query
    .order("first_name", { ascending: true })
    .order("last_name", { ascending: true })
    .order("id", { ascending: true })
    .range(from, to)
    .overrideTypes<NetworkMember[], { merge: false }>();

  if (error || !data) return { members: [], total: 0, failed: true };
  return { members: await withBadges(data), total: count ?? data.length };
}
