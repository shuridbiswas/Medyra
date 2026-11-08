import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  COMMENT_PAGE_LIMIT,
  FEED_PAGE_SIZE,
} from "@/features/feed/options";
import type { FeedRequest } from "@/features/feed/schemas";
import { getHiddenAuthorIds } from "@/features/safety/queries";
import { getBadges } from "@/features/student-verification/queries";
import type {
  FeedComment,
  FeedPage,
  FeedPost,
  PostAuthor,
} from "@/features/feed/types";

/**
 * Reads go through the member's own session, so row level security decides what is visible.
 * `viewerId` is only used to mark which posts are the viewer's own and which they have liked.
 */

const AUTHOR =
  "author:profiles!posts_author_id_fkey(id, username, first_name, last_name, headline, avatar_path)";
const POST_SELECT = `id, category, body, created_at, edited_at, ${AUTHOR}, likes:post_likes(count), comments:post_comments(count)`;

type PostQueryRow = {
  id: string;
  category: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  author: PostAuthor | null;
  likes: { count: number }[];
  comments: { count: number }[];
};

type CommentQueryRow = {
  id: string;
  post_id: string;
  body: string;
  created_at: string;
  author: PostAuthor | null;
};

const count = (rows: { count: number }[] | null | undefined) =>
  rows?.[0]?.count ?? 0;

export const encodeCursor = (post: { created_at: string; id: string }) =>
  `${post.created_at}|${post.id}`;

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Adds the viewer-specific flags (liked, saved, own) to raw post rows. */
async function hydratePosts(
  supabase: Supabase,
  viewerId: string,
  rows: PostQueryRow[],
): Promise<FeedPost[]> {
  const ids = rows.map((r) => r.id);
  let liked = new Set<string>();
  let saved = new Set<string>();
  if (ids.length > 0) {
    const [likes, saves] = await Promise.all([
      supabase
        .from("post_likes")
        .select("post_id")
        .eq("user_id", viewerId)
        .in("post_id", ids),
      supabase
        .from("saved_items")
        .select("item_id")
        .eq("user_id", viewerId)
        .eq("item_type", "post")
        .in("item_id", ids),
    ]);
    liked = new Set((likes.data ?? []).map((l) => l.post_id));
    saved = new Set((saves.data ?? []).map((i) => i.item_id));
  }

  const badges = await getBadges(rows.map((r) => r.author?.id ?? ""));
  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    body: r.body,
    created_at: r.created_at,
    edited_at: r.edited_at,
    author: { ...(r.author as PostAuthor), badge: badges.get(r.author?.id ?? "") ?? null },
    likeCount: count(r.likes),
    commentCount: count(r.comments),
    likedByMe: liked.has(r.id),
    savedByMe: saved.has(r.id),
    isOwn: r.author?.id === viewerId,
  }));
}

/** Posts by id (the order of `ids` is kept). Missing or hidden posts are simply absent. */
export async function getPostsByIds(
  viewerId: string,
  ids: string[],
): Promise<{ posts: FeedPost[]; failed?: boolean }> {
  if (ids.length === 0) return { posts: [] };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("posts")
    .select(POST_SELECT)
    .in("id", ids)
    .overrideTypes<PostQueryRow[], { merge: false }>();
  if (error || !data) return { posts: [], failed: true };

  const rows = data.filter((r) => r.author !== null);
  const posts = await hydratePosts(supabase, viewerId, rows);
  const position = new Map(ids.map((id, i) => [id, i]));
  return {
    posts: posts.sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0)),
  };
}

export async function getFeedPage(
  viewerId: string,
  { cursor, category, authorId, scope, communityId }: FeedRequest = {},
  pageSize = FEED_PAGE_SIZE,
): Promise<FeedPage & { failed?: boolean }> {
  const supabase = await createClient();

  let followedIds: string[] | undefined;
  if (scope === "following") {
    // Only posts by members the viewer follows (follows are separate from connections).
    const { data: follows, error: followError } = await supabase
      .from("follows")
      .select("followee_id")
      .eq("follower_id", viewerId)
      .limit(500)
      .overrideTypes<{ followee_id: string }[], { merge: false }>();
    if (followError) return { posts: [], nextCursor: null, failed: true };
    followedIds = (follows ?? []).map((f) => f.followee_id);
    if (followedIds.length === 0) return { posts: [], nextCursor: null };
  }

  // Members the viewer blocked or muted stay out of the main feed (a member's own page still shows).
  const hidden = authorId ? [] : await getHiddenAuthorIds(viewerId);

  let query = supabase.from("posts").select(POST_SELECT);
  if (followedIds) query = query.in("author_id", followedIds);
  if (hidden.length > 0) query = query.not("author_id", "in", `(${hidden.join(",")})`);
  if (category) query = query.eq("category", category);
  if (authorId) query = query.eq("author_id", authorId);
  // The home feed and the Following tab carry no community posts; each community has its own list.
  if (communityId) query = query.eq("community_id", communityId);
  else if (!authorId) query = query.is("community_id", null);
  if (cursor) {
    // Strictly older than the last post seen; the id breaks ties between equal timestamps.
    const [createdAt, id] = cursor.split("|");
    query = query.or(
      `created_at.lt."${createdAt}",and(created_at.eq."${createdAt}",id.lt.${id})`,
    );
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(pageSize + 1)
    .overrideTypes<PostQueryRow[], { merge: false }>();

  if (error || !data) return { posts: [], nextCursor: null, failed: true };

  const rows = data.filter((r) => r.author !== null);
  const hasMore = data.length > pageSize;
  const pageRows = rows.slice(0, pageSize);

  const posts = await hydratePosts(supabase, viewerId, pageRows);

  const last = pageRows.at(-1);
  return {
    posts,
    nextCursor: hasMore && last ? encodeCursor(last) : null,
  };
}

/** Oldest first, so a conversation reads top to bottom. */
export async function getComments(
  viewerId: string,
  postId: string,
): Promise<{ comments: FeedComment[]; failed?: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("post_comments")
    .select(
      "id, post_id, body, created_at, author:profiles!post_comments_author_id_fkey(id, username, first_name, last_name, headline, avatar_path)",
    )
    .eq("post_id", postId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(COMMENT_PAGE_LIMIT)
    .overrideTypes<CommentQueryRow[], { merge: false }>();

  if (error || !data) return { comments: [], failed: true };
  const hidden = new Set(await getHiddenAuthorIds(viewerId));
  const badges = await getBadges(data.map((c) => c.author?.id ?? ""));
  return {
    comments: data
      .filter((c) => c.author !== null && !hidden.has(c.author.id))
      .map((c) => ({
        id: c.id,
        post_id: c.post_id,
        body: c.body,
        created_at: c.created_at,
        author: { ...(c.author as PostAuthor), badge: badges.get(c.author?.id ?? "") ?? null },
        isOwn: c.author?.id === viewerId,
      })),
  };
}

/** Authoritative counts straight from the rows, used after a like or comment changes them. */
export async function getPostCounts(
  postId: string,
): Promise<{ likeCount: number; commentCount: number } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("posts")
    .select("likes:post_likes(count), comments:post_comments(count)")
    .eq("id", postId)
    .maybeSingle()
    .overrideTypes<
      { likes: { count: number }[]; comments: { count: number }[] },
      { merge: false }
    >();
  if (error || !data) return null;
  return { likeCount: count(data.likes), commentCount: count(data.comments) };
}
