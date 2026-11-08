"use client";

import Link from "next/link";
import {
  useActionState,
  useEffect,
  useId,
  useState,
  useTransition,
} from "react";
import { Bookmark, Heart, MessageCircle, Pencil, Trash2 } from "lucide-react";
import { MemberAvatar } from "@/components/member-avatar";
import { RelativeTime } from "@/components/relative-time";
import { FormAlert } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { avatarUrl } from "@/lib/storage-url";
import { deletePost, setLike, updatePost } from "@/features/feed/actions";
import { setSaved } from "@/features/saved/actions";
import { Comments } from "@/features/feed/components/comments";
import { ReportButton } from "@/features/safety/components/report-button";
import {
  categoryLabel,
  POST_CATEGORIES,
  POST_MAX_LENGTH,
} from "@/features/feed/options";
import { idleForm, type FeedPost, type FormState } from "@/features/feed/types";
import { cn } from "@/lib/utils";
import { VerificationChip } from "@/components/verification-chip";

const actionButton =
  "inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-maroon-50 hover:text-maroon-900 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60";

function EditForm({
  post,
  onCancel,
  onSaved,
}: {
  post: FeedPost;
  onCancel: () => void;
  onSaved: (saved: NonNullable<FormState["saved"]>) => void;
}) {
  const id = useId();
  // Controlled so a failed save keeps the member's edits (React resets uncontrolled forms).
  const [text, setText] = useState(post.body);
  const [category, setCategory] = useState(post.category);
  const [state, action, pending] = useActionState(updatePost, idleForm);
  useEffect(() => {
    if (state.status === "success" && state.saved) onSaved(state.saved);
  }, [state, onSaved]);
  const bodyError = state.fieldErrors?.body?.[0];

  return (
    <form action={action} className="mt-3 space-y-3" noValidate>
      <input type="hidden" name="id" value={post.id} />
      <div>
        <label htmlFor={`${id}-body`} className="sr-only">
          Edit your post
        </label>
        <textarea
          id={`${id}-body`}
          name="body"
          rows={4}
          maxLength={POST_MAX_LENGTH}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-invalid={bodyError ? true : undefined}
          className="w-full resize-y rounded-xl border border-input bg-surface px-3.5 py-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        {bodyError ? (
          <p role="alert" className="mt-1 text-xs font-medium text-destructive">
            {bodyError}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <label
            htmlFor={`${id}-category`}
            className="mb-1 block text-xs font-semibold text-maroon-900"
          >
            Category
          </label>
          <select
            id={`${id}-category`}
            name="category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-10 rounded-lg border border-input bg-surface px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {POST_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onCancel} className="h-10 px-4">
            Cancel
          </Button>
          <Button type="submit" disabled={pending} className="h-10 px-4">
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
      {state.status === "error" && !state.fieldErrors ? (
        <FormAlert tone="error">{state.message}</FormAlert>
      ) : null}
    </form>
  );
}

export function PostCard({
  post: initial,
  onDeleted,
  onUnsaved,
  moderation,
}: {
  post: FeedPost;
  onDeleted: (id: string) => void;
  /** Extra controls for community moderators, shown beside Report. */
  moderation?: React.ReactNode;
  /** Called after the viewer removes the post from their saved items. */
  onUnsaved?: (id: string) => void;
}) {
  const [post, setPost] = useState(initial);
  const [liked, setLiked] = useState({
    on: initial.likedByMe,
    count: initial.likeCount,
  });
  const [commentCount, setCommentCount] = useState(initial.commentCount);
  const [showComments, setShowComments] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSavedState] = useState(initial.savedByMe);
  const [likePending, startLike] = useTransition();
  const [savePending, startSave] = useTransition();
  const [deletePending, startDelete] = useTransition();
  const id = useId();

  const name = [post.author.first_name, post.author.last_name]
    .filter(Boolean)
    .join(" ");
  const profileHref = post.author.username
    ? `/profile/${post.author.username}`
    : null;
  const avatar = (
    <MemberAvatar name={post.author.first_name} src={avatarUrl(post.author.avatar_path)} />
  );

  function toggleLike() {
    const previous = liked;
    const next = !liked.on;
    setError(null);
    // Optimistic, and safe: the server answer replaces it, and a failure puts it back.
    setLiked({ on: next, count: Math.max(0, liked.count + (next ? 1 : -1)) });
    startLike(async () => {
      const result = await setLike(post.id, next);
      if (result.ok) setLiked({ on: result.liked, count: result.likeCount });
      else {
        setLiked(previous);
        setError(result.error);
      }
    });
  }

  function toggleSaved() {
    const previous = saved;
    setError(null);
    setSavedState(!previous);
    startSave(async () => {
      const result = await setSaved(post.id, !previous);
      if (result.ok) {
        setSavedState(result.saved);
        if (!result.saved) onUnsaved?.(post.id);
      } else {
        setSavedState(previous);
        setError(result.error);
      }
    });
  }

  function remove() {
    setError(null);
    startDelete(async () => {
      const result = await deletePost(post.id);
      if (result.ok) onDeleted(post.id);
      else {
        setError(result.error);
        setConfirmDelete(false);
      }
    });
  }

  return (
    <article
      aria-labelledby={`${id}-author`}
      className="rounded-2xl border border-border bg-surface p-4 shadow-xs sm:p-5"
    >
      <header className="flex items-start gap-3">
        {profileHref ? (
          <Link href={profileHref} tabIndex={-1} aria-hidden="true">
            {avatar}
          </Link>
        ) : (
          avatar
        )}
        <div className="min-w-0 flex-1">
          <p id={`${id}-author`} className="truncate font-semibold text-maroon-900">
            {profileHref ? (
              <Link href={profileHref} className="hover:underline">
                {name}
              </Link>
            ) : (
              name
            )}{" "}
            <VerificationChip badge={post.author.badge} />
          </p>
          {post.author.headline ? (
            <p className="truncate text-sm text-muted-foreground">
              {post.author.headline}
            </p>
          ) : null}
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <RelativeTime iso={post.created_at} />
            {post.edited_at ? <span>· Edited</span> : null}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-maroon-50 px-2.5 py-1 text-xs font-medium text-maroon-800">
          {categoryLabel(post.category)}
        </span>
      </header>

      {editing ? (
        <EditForm
          post={post}
          onCancel={() => setEditing(false)}
          onSaved={(saved) => {
            setPost((p) => ({
              ...p,
              body: saved.body,
              category: saved.category,
              edited_at: saved.editedAt,
            }));
            setEditing(false);
          }}
        />
      ) : (
        <p className="mt-3 text-[0.95rem] leading-relaxed break-words whitespace-pre-wrap text-maroon-900/90">
          {post.body}
        </p>
      )}

      {error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-border pt-2">
        <button
          type="button"
          onClick={toggleLike}
          disabled={likePending}
          aria-pressed={liked.on}
          aria-label={`${liked.on ? "Unlike" : "Like"} this post. ${liked.count} ${liked.count === 1 ? "like" : "likes"}`}
          className={cn(actionButton, liked.on && "text-maroon-700")}
        >
          <Heart
            className={cn("size-4", liked.on && "fill-maroon-700")}
            aria-hidden="true"
          />
          <span aria-hidden="true">{liked.count}</span>
        </button>
        <button
          type="button"
          onClick={() => setShowComments((v) => !v)}
          aria-expanded={showComments}
          aria-controls={`${id}-comments`}
          aria-label={`${showComments ? "Hide" : "Show"} comments. ${commentCount} ${commentCount === 1 ? "comment" : "comments"}`}
          className={actionButton}
        >
          <MessageCircle className="size-4" aria-hidden="true" />
          <span aria-hidden="true">{commentCount}</span>
        </button>

        <div className="ml-auto flex items-center gap-1">
          {post.isOwn && !editing ? (
            confirmDelete ? (
              <>
                <span className="text-sm text-muted-foreground">Delete this post?</span>
                <button
                  type="button"
                  onClick={remove}
                  disabled={deletePending}
                  className={cn(actionButton, "text-destructive hover:text-destructive")}
                >
                  {deletePending ? "Deleting…" : "Yes, delete"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className={actionButton}
                >
                  Keep
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className={actionButton}
                  aria-label="Edit your post"
                >
                  <Pencil className="size-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Edit</span>
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className={actionButton}
                  aria-label="Delete your post"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Delete</span>
                </button>
              </>
            )
          ) : null}
          <button
            type="button"
            onClick={toggleSaved}
            disabled={savePending}
            aria-pressed={saved}
            aria-label={saved ? "Remove from saved" : "Save this post"}
            className={cn(actionButton, saved && "text-maroon-700")}
          >
            <Bookmark
              className={cn("size-4", saved && "fill-maroon-700")}
              aria-hidden="true"
            />
          </button>
        </div>
      </div>

      {!post.isOwn ? (
        <div className="mt-1 flex flex-wrap items-start gap-x-3">
          <ReportButton targetType="post" targetId={post.id} />
          {moderation}
        </div>
      ) : null}

      <div id={`${id}-comments`}>
        {showComments ? (
          <Comments postId={post.id} onCountChange={setCommentCount} />
        ) : null}
      </div>
    </article>
  );
}
