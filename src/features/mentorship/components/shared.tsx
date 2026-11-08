import Link from "next/link";
import { Briefcase, Clock, Languages } from "lucide-react";
import { Info } from "lucide-react";
import { MemberAvatar } from "@/components/member-avatar";
import { VerificationChip } from "@/components/verification-chip";
import { chipClass } from "@/components/forms/controls";
import { avatarUrl } from "@/lib/storage-url";
import { fieldLabels, memberTypeLabel } from "@/features/profile/format";
import { MENTORSHIP_LIMITS, SELF_DECLARED } from "@/features/mentorship/content";
import { formatLabel } from "@/features/mentorship/options";
import type { MentorListing } from "@/features/mentorship/queries";
import type { NetworkMember } from "@/features/network/types";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "overview", label: "Overview", href: "/mentorship" },
  { key: "find", label: "Find a mentor", href: "/mentorship/find" },
  { key: "requests", label: "Requests", href: "/mentorship/requests" },
  { key: "mine", label: "My mentorships", href: "/mentorship/my-mentorships" },
  { key: "become", label: "Become a mentor", href: "/mentorship/become-a-mentor" },
] as const;

export type MentorshipTab = (typeof TABS)[number]["key"];

export function MentorshipTabs({ current, pendingRequests = 0 }: { current: MentorshipTab | null; pendingRequests?: number }) {
  return (
    <nav aria-label="Mentorship" className="-mx-1 overflow-x-auto border-b border-border">
      <ul className="flex gap-1 px-1">
        {TABS.map((t) => (
          <li key={t.key} className="shrink-0">
            <Link
              href={t.href}
              aria-current={t.key === current ? "page" : undefined}
              className={cn(
                "-mb-px flex items-center gap-2 border-b-2 px-3.5 py-3 text-sm font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                t.key === current ? "border-maroon-600 text-maroon-700" : "border-transparent text-muted-foreground hover:text-maroon-900",
              )}
            >
              {t.label}
              {t.key === "requests" && pendingRequests > 0 ? (
                <span className="rounded-full bg-maroon-700 px-2 py-0.5 text-xs font-semibold text-white">{pendingRequests}</span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** What mentorship is and is not. Shown wherever mentoring is described or started. */
export function MentorshipLimits({ compact }: { compact?: boolean }) {
  if (compact) {
    return (
      <p className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0 text-maroon-700" aria-hidden="true" />
        <span>
          <strong className="font-semibold text-maroon-900">Mentors describe their own experience.</strong> Medyra doesn&apos;t verify or accredit them, and a mentor isn&apos;t
          automatically a qualified clinical supervisor.
        </span>
      </p>
    );
  }
  return (
    <section aria-labelledby="limits-heading" className="rounded-2xl border border-maroon-200 bg-maroon-50/70 p-4 sm:p-5">
      <h2 id="limits-heading" className="flex items-center gap-2 text-sm font-semibold text-maroon-900">
        <Info className="size-4 text-maroon-700" aria-hidden="true" />
        {MENTORSHIP_LIMITS.title}
      </h2>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-maroon-900/90">
        {MENTORSHIP_LIMITS.points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </section>
  );
}

export function MentorCard({ mentor }: { mentor: MentorListing }) {
  const m: NetworkMember = mentor.member;
  const name = [m.first_name, m.last_name].filter(Boolean).join(" ");
  const role = memberTypeLabel(m.member_type);
  const fields = fieldLabels(m.fields).slice(0, 2);
  return (
    <article aria-label={name} className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 shadow-xs sm:flex-row sm:p-5">
      <MemberAvatar name={m.first_name} src={avatarUrl(m.avatar_path)} className="size-14 text-lg" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="truncate text-base font-semibold text-maroon-900">
            <Link href={`/mentorship/${mentor.user_id}`} className="hover:underline">
              {name}
            </Link>
          </h3>
          <VerificationChip badge={m.badge} />
        </div>
        <p className="text-sm text-muted-foreground">
          {[role, ...fields].filter(Boolean).join(" · ")}
        </p>
        <p className="text-sm text-maroon-900/90">
          <span className="font-medium">{mentor.expertise}</span> <span className="text-xs text-muted-foreground">(self-declared)</span>
        </p>
        <p className="line-clamp-2 text-sm leading-relaxed text-maroon-900/80">{mentor.bio}</p>
        <ul className="flex flex-wrap gap-1.5">
          {mentor.topics.slice(0, 5).map((t) => (
            <li key={t} className={cn(chipClass, "capitalize")}>
              {t}
            </li>
          ))}
        </ul>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <Briefcase className="size-3.5 text-maroon-600" aria-hidden="true" />
            {mentor.experience_years} {mentor.experience_years === 1 ? "year" : "years"}
            {mentor.organization ? ` · ${mentor.organization}` : ""}
          </li>
          <li className="flex items-center gap-1.5 capitalize">
            <Languages className="size-3.5 text-maroon-600" aria-hidden="true" />
            {mentor.languages.join(", ")}
          </li>
          <li className="flex items-center gap-1.5">
            <Clock className="size-3.5 text-maroon-600" aria-hidden="true" />
            {mentor.session_formats.map(formatLabel).join(", ")} · up to {mentor.capacity} {mentor.capacity === 1 ? "mentee" : "mentees"}
          </li>
        </ul>
      </div>
    </article>
  );
}

export const SelfDeclaredNote = () => <p className="text-xs text-muted-foreground">{SELF_DECLARED}</p>;
