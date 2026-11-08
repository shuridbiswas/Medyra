import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  MentorAvailabilityRow,
  MentorProfileRow,
  MentorshipRequestRow,
  MentorshipRow,
} from "@/lib/supabase/database.types";
import { NETWORK_MEMBER_COLUMNS, type NetworkMember } from "@/features/network/types";
import { getBadges } from "@/features/student-verification/queries";
import { MENTOR_PAGE_SIZE } from "@/features/mentorship/options";
import type { MentorFilters } from "@/features/mentorship/schemas";

/**
 * Reads run under the member's own session. Mentor listings are visible to members (not to
 * anyone they have blocked or who blocked them); requests, mentorships and feedback only to the
 * two people involved.
 */

const MEMBER = `member:profiles!mentor_profiles_user_id_fkey(${NETWORK_MEMBER_COLUMNS})`;
const MENTOR_COLUMNS =
  "user_id, bio, expertise, experience_years, organization, topics, languages, capacity, session_formats, accepting";

export type MentorListing = Pick<
  MentorProfileRow,
  "user_id" | "bio" | "expertise" | "experience_years" | "organization" | "topics" | "languages" | "capacity" | "session_formats" | "accepting"
> & { member: NetworkMember };

async function attach(mentors: MentorListing[]): Promise<MentorListing[]> {
  const badges = await getBadges(mentors.map((m) => m.member.id));
  return mentors.map((m) => ({ ...m, member: { ...m.member, badge: badges.get(m.member.id) ?? null } }));
}

type ListingRow = Omit<MentorListing, "member"> & { member: NetworkMember | null };

export async function listMentors(
  viewerId: string,
  { q, field, topic, language, minYears, format, page }: MentorFilters,
): Promise<{ mentors: MentorListing[]; total: number; failed?: boolean }> {
  const supabase = await createClient();
  // !inner so a filter on the member's profession can narrow the mentors.
  let query = supabase
    .from("mentor_profiles")
    .select(`${MENTOR_COLUMNS}, member:profiles!mentor_profiles_user_id_fkey!inner(${NETWORK_MEMBER_COLUMNS})`, { count: "exact" })
    .eq("accepting", true)
    .neq("user_id", viewerId);
  if (field) query = query.filter("member.fields", "cs", `{${field}}`);
  if (topic) query = query.contains("topics", [topic]);
  if (language) query = query.contains("languages", [language]);
  if (format) query = query.contains("session_formats", [format]);
  if (minYears) query = query.gte("experience_years", minYears);
  if (q) query = query.or(`expertise.ilike.%${q}%,bio.ilike.%${q}%,organization.ilike.%${q}%`);

  const from = (page - 1) * MENTOR_PAGE_SIZE;
  const { data, error, count } = await query
    .order("experience_years", { ascending: false })
    .order("user_id", { ascending: true })
    .range(from, from + MENTOR_PAGE_SIZE - 1)
    .overrideTypes<ListingRow[], { merge: false }>();
  if (error || !data) return { mentors: [], total: 0, failed: true };
  return {
    mentors: await attach(data.flatMap((m) => (m.member ? [{ ...m, member: m.member }] : []))),
    total: count ?? data.length,
  };
}

export type MentorDetail = MentorListing & {
  availability: MentorAvailabilityRow[];
  /** The viewer's open request to this mentor, if any. */
  pendingRequest: { id: string; created_at: string } | null;
  /** The viewer's current mentorship with this mentor, if any. */
  mentorship: Pick<MentorshipRow, "id" | "status" | "conversation_id"> | null;
};

export async function getMentor(viewerId: string, mentorId: string): Promise<MentorDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("mentor_profiles")
    .select(`${MENTOR_COLUMNS}, ${MEMBER}`)
    .eq("user_id", mentorId)
    .maybeSingle()
    .overrideTypes<ListingRow, { merge: false }>();
  if (!data?.member) return null;

  const [availability, pending, relationship] = await Promise.all([
    supabase
      .from("mentor_availability")
      .select("id, mentor_id, weekday, start_minute, end_minute, timezone")
      .eq("mentor_id", mentorId)
      .order("weekday", { ascending: true })
      .order("start_minute", { ascending: true })
      .overrideTypes<MentorAvailabilityRow[], { merge: false }>(),
    supabase
      .from("mentorship_requests")
      .select("id, created_at")
      .eq("mentee_id", viewerId)
      .eq("mentor_id", mentorId)
      .eq("status", "pending")
      .maybeSingle()
      .overrideTypes<{ id: string; created_at: string }, { merge: false }>(),
    supabase
      .from("mentorships")
      .select("id, status, conversation_id")
      .eq("mentee_id", viewerId)
      .eq("mentor_id", mentorId)
      .in("status", ["active", "paused"])
      .maybeSingle()
      .overrideTypes<Pick<MentorshipRow, "id" | "status" | "conversation_id">, { merge: false }>(),
  ]);
  return {
    ...data,
    member: { ...data.member, badge: (await getBadges([data.member.id])).get(data.member.id) ?? null },
    availability: availability.data ?? [],
    pendingRequest: pending.data ?? null,
    mentorship: relationship.data ?? null,
  };
}

export type MyMentorProfile = MentorProfileRow & {
  availability: MentorAvailabilityRow[];
  activeMentees: number;
};

export async function getMyMentorProfile(userId: string): Promise<MyMentorProfile | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("mentor_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle()
    .overrideTypes<MentorProfileRow, { merge: false }>();
  if (!data) return null;
  const [availability, active] = await Promise.all([
    supabase
      .from("mentor_availability")
      .select("id, mentor_id, weekday, start_minute, end_minute, timezone")
      .eq("mentor_id", userId)
      .order("weekday", { ascending: true })
      .order("start_minute", { ascending: true })
      .overrideTypes<MentorAvailabilityRow[], { merge: false }>(),
    supabase
      .from("mentorships")
      .select("id", { count: "exact", head: true })
      .eq("mentor_id", userId)
      .in("status", ["active", "paused"]),
  ]);
  return { ...data, availability: availability.data ?? [], activeMentees: active.count ?? 0 };
}

export type RequestEntry = Pick<MentorshipRequestRow, "id" | "goals" | "preferred_format" | "status" | "decline_note" | "created_at" | "decided_at"> & {
  person: NetworkMember;
};

type ReceivedRow = Omit<RequestEntry, "person"> & { person: NetworkMember | null };
type SentRow = Omit<RequestEntry, "person"> & { mentor: { member: NetworkMember | null } | null };

const REQUEST_COLUMNS = "id, goals, preferred_format, status, decline_note, created_at, decided_at";

export async function listRequests(viewerId: string): Promise<{ received: RequestEntry[]; sent: RequestEntry[]; failed?: boolean }> {
  const supabase = await createClient();
  const [received, sent] = await Promise.all([
    supabase
      .from("mentorship_requests")
      .select(`${REQUEST_COLUMNS}, person:profiles!mentorship_requests_mentee_id_fkey(${NETWORK_MEMBER_COLUMNS})`)
      .eq("mentor_id", viewerId)
      .order("created_at", { ascending: false })
      .limit(100)
      .overrideTypes<ReceivedRow[], { merge: false }>(),
    supabase
      .from("mentorship_requests")
      .select(`${REQUEST_COLUMNS}, mentor:mentor_profiles!mentorship_requests_mentor_id_fkey(${MEMBER})`)
      .eq("mentee_id", viewerId)
      .order("created_at", { ascending: false })
      .limit(100)
      .overrideTypes<SentRow[], { merge: false }>(),
  ]);
  if (received.error || sent.error) return { received: [], sent: [], failed: true };
  return {
    received: (received.data ?? []).flatMap(({ person, ...r }) => (person ? [{ ...r, person }] : [])),
    sent: (sent.data ?? []).flatMap(({ mentor, ...r }) => (mentor?.member ? [{ ...r, person: mentor.member }] : [])),
  };
}

export async function countPendingReceived(viewerId: string): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("mentorship_requests")
    .select("id", { count: "exact", head: true })
    .eq("mentor_id", viewerId)
    .eq("status", "pending");
  return count ?? 0;
}

export type MentorshipEntry = Pick<MentorshipRow, "id" | "status" | "started_at" | "ended_at" | "conversation_id"> & {
  role: "mentor" | "mentee";
  person: NetworkMember;
  myFeedback: { rating: number; comment: string | null } | null;
  theirFeedback: { rating: number; comment: string | null } | null;
};

type MentorshipQueryRow = Pick<MentorshipRow, "id" | "status" | "started_at" | "ended_at" | "conversation_id" | "mentor_id" | "mentee_id"> & {
  mentor: NetworkMember | null;
  mentee: NetworkMember | null;
};

export async function listMentorships(viewerId: string): Promise<{ entries: MentorshipEntry[]; failed?: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("mentorships")
    .select(
      `id, status, started_at, ended_at, conversation_id, mentor_id, mentee_id, mentor:profiles!mentorships_mentor_id_fkey(${NETWORK_MEMBER_COLUMNS}), mentee:profiles!mentorships_mentee_id_fkey(${NETWORK_MEMBER_COLUMNS})`,
    )
    .order("started_at", { ascending: false })
    .limit(100)
    .overrideTypes<MentorshipQueryRow[], { merge: false }>();
  if (error || !data) return { entries: [], failed: true };

  const ids = data.map((m) => m.id);
  const feedback = ids.length
    ? await supabase
        .from("mentorship_feedback")
        .select("mentorship_id, author_id, rating, comment")
        .in("mentorship_id", ids)
        .overrideTypes<{ mentorship_id: string; author_id: string; rating: number; comment: string | null }[], { merge: false }>()
    : { data: [] };

  const entries = data.flatMap((m): MentorshipEntry[] => {
    const role = m.mentor_id === viewerId ? "mentor" : "mentee";
    const person = role === "mentor" ? m.mentee : m.mentor;
    if (!person) return [];
    const mine = (feedback.data ?? []).find((f) => f.mentorship_id === m.id && f.author_id === viewerId);
    const theirs = (feedback.data ?? []).find((f) => f.mentorship_id === m.id && f.author_id !== viewerId);
    return [
      {
        id: m.id,
        status: m.status,
        started_at: m.started_at,
        ended_at: m.ended_at,
        conversation_id: m.conversation_id,
        role,
        person,
        myFeedback: mine ? { rating: mine.rating, comment: mine.comment } : null,
        theirFeedback: theirs ? { rating: theirs.rating, comment: theirs.comment } : null,
      },
    ];
  });
  return { entries };
}
