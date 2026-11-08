"use client";

import Link from "next/link";
import { useEffect, useId, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { MemberAvatar } from "@/components/member-avatar";
import { RelativeTime } from "@/components/relative-time";
import { Button } from "@/components/ui/button";
import { avatarUrl } from "@/lib/storage-url";
import {
  addComment,
  deleteComment,
  loadComments,
} from "@/features/feed/actions";
import { COMMENT_MAX_LENGTH } from "@/features/feed/options";
import type { FeedComment } from "@/features/feed/types";
import { VerificationChip } from "@/components/verification-chip";
import { ReportButton } from "@/features/safety/components/report-button";

const fullName = (a: FeedComment["author"]) =>
  [a.first_name, a.last_name].filter(Boolean).join(" ");

export function Comments({
  postId,
  onCountChange,
}: {
  postId: string;
  onCountChange: (count: number) => void;
}) {
  const id = useId();
  const [comments, setComments] = useState<FeedComment[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadComments(postId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setComments(result.comments);
        setLoadError(null);
      } else {
        setLoadError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [postId, attempt]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim()) {
      setError("Write a comment first.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await addComment(postId, text);
      if (result.ok) {
        setComments((list) => [...(list ?? []), result.comment]);
        onCountChange(result.commentCount);
        setText("");
      } else {
        setError(result.error);
      }
    });
  }

  function remove(commentId: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteComment(commentId, postId);
      if (result.ok) {
        setComments((list) => (list ?? []).filter((c) => c.id !== commentId));
        onCountChange(result.commentCount);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="mt-3 space-y-4 border-t border-border pt-4">
      {loadError ? (
        <div role="alert" className="text-sm text-destructive">
          {loadError}{" "}
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="font-medium underline underline-offset-2"
          >
            Try again
          </button>
        </div>
      ) : comments === null ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading comments…
        </p>
      ) : comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No comments yet. Start the conversation.
        </p>
      ) : (
        <ul className="space-y-4">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-2.5">
              <MemberAvatar
                name={c.author.first_name}
                src={avatarUrl(c.author.avatar_path)}
                className="size-8 text-xs"
              />
              <div className="min-w-0 flex-1 rounded-xl bg-sand/60 px-3.5 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="text-sm">
                    {c.author.username ? (
                      <Link
                        href={`/profile/${c.author.username}`}
                        className="font-semibold text-maroon-900 hover:underline"
                      >
                        {fullName(c.author)}
                      </Link>
                    ) : (
                      <span className="font-semibold text-maroon-900">
                        {fullName(c.author)}
                      </span>
                    )}{" "}
                    <VerificationChip badge={c.author.badge} />
                    <RelativeTime
                      iso={c.created_at}
                      className="ml-2 text-xs text-muted-foreground"
                    />
                  </p>
                  {c.isOwn ? (
                    <button
                      type="button"
                      onClick={() => remove(c.id)}
                      disabled={pending}
                      aria-label={`Delete your comment: ${c.body.slice(0, 40)}`}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:text-destructive focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                      Delete
                    </button>
                  ) : null}
                </div>
                <p className="mt-0.5 text-sm leading-relaxed break-words whitespace-pre-wrap text-maroon-900/90">
                  {c.body}
                </p>
                {!c.isOwn ? <ReportButton targetType="comment" targetId={c.id} className="mt-1" /> : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="space-y-2" noValidate>
        <label htmlFor={`${id}-comment`} className="sr-only">
          Add a comment
        </label>
        <textarea
          id={`${id}-comment`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          maxLength={COMMENT_MAX_LENGTH}
          placeholder="Write a respectful comment…"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="w-full resize-y rounded-xl border border-input bg-surface px-3 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground" aria-hidden="true">
            {text.length}/{COMMENT_MAX_LENGTH}
          </span>
          <Button type="submit" size="sm" disabled={pending} className="h-9 px-4">
            {pending ? "Sending…" : "Comment"}
          </Button>
        </div>
        {error ? (
          <p id={`${id}-error`} role="alert" className="text-xs font-medium text-destructive">
            {error}
          </p>
        ) : null}
      </form>
    </div>
  );
}
