import Link from "next/link";
import { EyeOff } from "lucide-react";
import { MemberAvatar } from "@/components/member-avatar";
import { RelativeTime } from "@/components/relative-time";
import { VerificationChip } from "@/components/verification-chip";
import { avatarUrl } from "@/lib/storage-url";
import { memberTypeLabel } from "@/features/profile/format";
import { ANONYMOUS_AUTHOR } from "@/features/forums/content";
import type { ForumAuthor } from "@/features/forums/types";

/**
 * Who wrote something. A public writer shows their name, their self-reported role and the shared
 * verification chip (Not Verified unless a valid credential exists). An anonymous writer shows only "Anonymous member":
 * no role, no photo, no link, nothing that could narrow them down.
 */
export function AuthorLine({
  author,
  anonymous,
  createdAt,
  edited,
  size = "md",
}: {
  author: ForumAuthor | null;
  anonymous: boolean;
  createdAt: string;
  edited?: boolean;
  size?: "sm" | "md";
}) {
  const avatarClass = size === "sm" ? "size-8 text-xs" : "size-10";
  if (anonymous || !author) {
    return (
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className={`flex shrink-0 items-center justify-center rounded-full bg-sand text-maroon-700 ${avatarClass}`}
        >
          <EyeOff className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-maroon-900">{ANONYMOUS_AUTHOR}</p>
          <p className="text-xs text-muted-foreground">
            <RelativeTime iso={createdAt} />
            {edited ? " · Edited" : ""}
          </p>
        </div>
      </div>
    );
  }
  const name = [author.first_name, author.last_name].filter(Boolean).join(" ");
  const href = author.username ? `/profile/${author.username}` : null;
  const role = memberTypeLabel(author.member_type);
  return (
    <div className="flex items-center gap-3">
      <MemberAvatar name={author.first_name} src={avatarUrl(author.avatar_path)} className={avatarClass} />
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate font-semibold text-maroon-900">
            {href ? (
              <Link href={href} className="hover:underline">
                {name}
              </Link>
            ) : (
              name
            )}
          </span>
          <VerificationChip badge={author.badge} />
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {role ? `${role} (self-reported) · ` : ""}
          <RelativeTime iso={createdAt} />
          {edited ? " · Edited" : ""}
        </p>
      </div>
    </div>
  );
}
