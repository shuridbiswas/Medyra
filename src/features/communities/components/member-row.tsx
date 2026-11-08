import Link from "next/link";
import { MemberAvatar } from "@/components/member-avatar";
import { VerificationChip } from "@/components/verification-chip";
import { avatarUrl } from "@/lib/storage-url";
import { memberTypeLabel } from "@/features/profile/format";
import { ROLE_LABELS } from "@/features/communities/options";
import type { NetworkMember } from "@/features/network/types";
import type { CommunityRole } from "@/lib/supabase/database.types";

/** One member in a community list: photo, name, self-reported role, community role, and optional controls. */
export function MemberRow({
  member,
  role,
  children,
}: {
  member: NetworkMember;
  role?: CommunityRole;
  children?: React.ReactNode;
}) {
  const name = [member.first_name, member.last_name].filter(Boolean).join(" ");
  const href = member.username ? `/profile/${member.username}` : null;
  const type = memberTypeLabel(member.member_type);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface p-3.5 sm:p-4">
      <MemberAvatar name={member.first_name} src={avatarUrl(member.avatar_path)} className="size-11" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="truncate font-semibold text-maroon-900">
            {href ? (
              <Link href={href} className="hover:underline">
                {name}
              </Link>
            ) : (
              name
            )}
          </p>
          {role && role !== "member" ? (
            <span className="rounded-full border border-maroon-200 px-2 py-0.5 text-xs font-medium text-maroon-700">{ROLE_LABELS[role]}</span>
          ) : null}
          <VerificationChip badge={member.badge} />
        </div>
        <p className="truncate text-sm text-muted-foreground">
          {[type, member.headline].filter(Boolean).join(" · ") || (member.username ? `@${member.username}` : "")}
        </p>
      </div>
      {children}
    </div>
  );
}
