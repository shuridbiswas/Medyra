import type { ProfileRow } from "@/lib/supabase/database.types";
import type { MemberBadge } from "@/features/student-verification/types";

/** Only the author fields a post or comment needs. Never the whole profile row. */
export type PostAuthor = Pick<
  ProfileRow,
  "id" | "username" | "first_name" | "last_name" | "headline" | "avatar_path"
> & {
  /** The author's current valid student credentials (read at request time), or null when not verified. */
  badge?: MemberBadge | null;
};

export type FeedPost = {
  id: string;
  category: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  author: PostAuthor;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  /** Whether the viewer bookmarked it. Private to the viewer. */
  savedByMe: boolean;
  /** True when the signed-in viewer wrote it. Computed on the server from the verified user id. */
  isOwn: boolean;
};

export type FeedComment = {
  id: string;
  post_id: string;
  body: string;
  created_at: string;
  author: PostAuthor;
  isOwn: boolean;
};

export type FeedPage = {
  posts: FeedPost[];
  /** Opaque cursor for the next (older) page, or null when this is the last page. */
  nextCursor: string | null;
};

export type ActionResult<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

/** State for forms driven by useActionState. */
export type FormState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /** Changes on every success so a form can reset itself. */
  nonce?: number;
  /** What an edit saved, so the card can show it without a reload. */
  saved?: { category: string; body: string; editedAt: string };
};

export const idleForm: FormState = { status: "idle" };
