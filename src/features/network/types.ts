import type { ProfileRow } from "@/lib/supabase/database.types";

/** What the signed-in viewer has with another member. Computed on the server. */
export type ConnectionState =
  | "none"
  | "request_sent"
  | "request_received"
  | "connected";

export type Relationship = {
  state: ConnectionState;
  /** Needed to accept, decline, withdraw or remove. Null when state is "none". */
  connectionId: string | null;
  following: boolean;
};

export const noRelationship: Relationship = {
  state: "none",
  connectionId: null,
  following: false,
};

import type { MemberBadge } from "@/features/student-verification/types";

/** The profile fields a member card may show. Never the whole profile row. */
export type NetworkMember = Pick<
  ProfileRow,
  | "id"
  | "username"
  | "first_name"
  | "last_name"
  | "headline"
  | "avatar_path"
  | "member_type"
  | "institution"
  | "specialty"
  | "fields"
  | "country"
  | "location_label"
  | "open_to_mentor"
  | "looking_for_mentorship"
> & { badge?: MemberBadge | null };

export const NETWORK_MEMBER_COLUMNS =
  "id, username, first_name, last_name, headline, avatar_path, member_type, institution, specialty, fields, country, location_label, open_to_mentor, looking_for_mentorship";

export type NetworkCounts = {
  connections: number;
  followers: number;
  following: number;
};

export type NetworkRequest = {
  id: string;
  created_at: string;
  member: NetworkMember;
};

export type NetworkActionResult<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string };
