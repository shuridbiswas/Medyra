import Link from "next/link";
import { GraduationCap, HandHeart, MapPin } from "lucide-react";
import { MemberAvatar } from "@/components/member-avatar";
import { VerificationChip } from "@/components/verification-chip";
import { avatarUrl } from "@/lib/storage-url";
import {
  fieldLabels,
  generalLocation,
  memberTypeLabel,
} from "@/features/profile/format";
import { RelationshipActions } from "@/features/network/components/relationship-actions";
import type { NetworkMember, Relationship } from "@/features/network/types";

export function MemberCard({
  member,
  relationship,
  actions = true,
}: {
  member: NetworkMember;
  /** The viewer's relationship with this member; omit to hide the buttons. */
  relationship?: Relationship;
  actions?: boolean;
}) {
  const name = [member.first_name, member.last_name].filter(Boolean).join(" ");
  const role = memberTypeLabel(member.member_type);
  const location = generalLocation(member.location_label, member.country);
  const fields = fieldLabels(member.fields).slice(0, 2);
  const href = `/profile/${member.username}`;

  return (
    <article
      aria-label={name}
      className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 shadow-xs sm:flex-row sm:items-start sm:p-5"
    >
      <Link href={href} tabIndex={-1} aria-hidden="true" className="shrink-0">
        <MemberAvatar
          name={member.first_name}
          src={avatarUrl(member.avatar_path)}
          className="size-14 text-lg"
        />
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="truncate text-base font-semibold text-maroon-900">
            <Link href={href} className="hover:underline">
              {name}
            </Link>
          </h3>
          <VerificationChip badge={member.badge} />
        </div>
        <p className="truncate text-sm text-muted-foreground">@{member.username}</p>
        {member.headline ? (
          <p className="mt-1 line-clamp-2 text-sm text-maroon-900/85">{member.headline}</p>
        ) : null}

        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {role || member.institution ? (
            <li className="flex items-center gap-1.5">
              <GraduationCap className="size-3.5 text-maroon-600" aria-hidden="true" />
              {[role, member.institution].filter(Boolean).join(" · ")}
            </li>
          ) : null}
          {location ? (
            <li className="flex items-center gap-1.5">
              <MapPin className="size-3.5 text-maroon-600" aria-hidden="true" />
              {location}
            </li>
          ) : null}
          {member.open_to_mentor || member.looking_for_mentorship ? (
            <li className="flex items-center gap-1.5">
              <HandHeart className="size-3.5 text-maroon-600" aria-hidden="true" />
              {[
                member.open_to_mentor ? "Open to mentoring" : null,
                member.looking_for_mentorship ? "Looking for a mentor" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </li>
          ) : null}
        </ul>

        {fields.length ? (
          <ul aria-label="Fields" className="mt-2 flex flex-wrap gap-1.5">
            {fields.map((f) => (
              <li
                key={f}
                className="rounded-full bg-maroon-50 px-2.5 py-0.5 text-xs font-medium text-maroon-700"
              >
                {f}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {actions && relationship ? (
        <RelationshipActions
          memberId={member.id}
          name={name}
          initial={relationship}
          compact
          className="sm:max-w-56 sm:justify-end"
        />
      ) : null}
    </article>
  );
}
