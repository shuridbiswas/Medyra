import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { AppHeader } from "@/components/layout/app-header";
import { AppPage } from "@/components/layout/app-page";
import { MemberAvatar } from "@/components/member-avatar";
import { VerificationChip } from "@/components/verification-chip";
import { LinkButton } from "@/components/ui/link-button";
import { chipClass } from "@/components/forms/controls";
import { avatarUrl } from "@/lib/storage-url";
import { requireMember } from "@/lib/auth/session";
import { cn } from "@/lib/utils";
import { fieldLabels, memberTypeLabel } from "@/features/profile/format";
import { ReportButton } from "@/features/safety/components/report-button";
import { RequestForm, WithdrawRequestButton } from "@/features/mentorship/components/relationship-controls";
import { MentorshipLimits } from "@/features/mentorship/components/shared";
import { SELF_DECLARED } from "@/features/mentorship/content";
import { formatLabel, minutesToTime, WEEKDAYS } from "@/features/mentorship/options";
import { getMentor } from "@/features/mentorship/queries";
import { idSchema } from "@/features/mentorship/schemas";

export const metadata: Metadata = {
  title: "Mentor",
  robots: { index: false },
};

type Props = { params: Promise<{ mentorId: string }> };

export default function MentorPage({ params }: Props) {
  return (
    <AppPage label="the mentor">
      <MentorContent params={params} />
    </AppPage>
  );
}

async function MentorContent({ params }: Props) {
  const { mentorId } = await params;
  const { user, profile } = await requireMember();
  // A malformed id, a missing listing and one hidden by a block all look the same.
  if (!idSchema.safeParse(mentorId).success) notFound();
  const mentor = await getMentor(user.id, mentorId);
  if (!mentor) notFound();

  const isMe = mentor.user_id === user.id;
  const m = mentor.member;
  const name = [m.first_name, m.last_name].filter(Boolean).join(" ");
  const profession = [memberTypeLabel(m.member_type), ...fieldLabels(m.fields)].filter(Boolean).join(" · ");

  return (
    <>
      <AppHeader member={profile} />
      <main id="main" className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6">
        <Link href="/mentorship/find" className="inline-flex items-center gap-1.5 text-sm font-medium text-maroon-700 hover:underline">
          <ArrowLeft className="size-4" aria-hidden="true" />
          All mentors
        </Link>

        <header className="space-y-4 rounded-2xl border border-border bg-surface p-5 shadow-xs sm:p-6">
          <div className="flex items-center gap-4">
            <MemberAvatar name={m.first_name} src={avatarUrl(m.avatar_path)} className="size-16 text-xl" />
            <div className="min-w-0">
              <h1 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xl font-bold text-maroon-900">
                {name}
                <VerificationChip badge={m.badge} />
              </h1>
              {profession ? <p className="text-sm text-muted-foreground">{profession}</p> : null}
              {m.username ? (
                <Link href={`/profile/${m.username}`} className="text-sm font-medium text-maroon-700 hover:underline">
                  View full profile
                </Link>
              ) : null}
            </div>
          </div>
          {!mentor.accepting ? (
            <p role="status" className="rounded-xl bg-sand/70 p-3 text-sm text-maroon-900">This mentor isn&apos;t taking new requests right now.</p>
          ) : null}
        </header>

        <section aria-labelledby="about-heading" className="space-y-4 rounded-2xl border border-border bg-surface p-5 sm:p-6">
          <h2 id="about-heading" className="text-lg font-semibold text-maroon-900">About this mentor</h2>
          <p className="leading-relaxed whitespace-pre-wrap text-maroon-900/90">{mentor.bio}</p>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Expertise</dt>
              <dd className="font-medium text-maroon-900">{mentor.expertise}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Experience</dt>
              <dd className="font-medium text-maroon-900">
                {mentor.experience_years} {mentor.experience_years === 1 ? "year" : "years"}
              </dd>
            </div>
            {mentor.organization ? (
              <div>
                <dt className="text-xs text-muted-foreground">Institution or organisation</dt>
                <dd className="font-medium text-maroon-900">{mentor.organization}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-xs text-muted-foreground">Languages</dt>
              <dd className="font-medium text-maroon-900 capitalize">{mentor.languages.join(", ")}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Session formats</dt>
              <dd className="font-medium text-maroon-900">{mentor.session_formats.map(formatLabel).join(", ")}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Mentoring capacity</dt>
              <dd className="font-medium text-maroon-900">
                Up to {mentor.capacity} {mentor.capacity === 1 ? "mentee" : "mentees"} at a time
              </dd>
            </div>
          </dl>
          <div>
            <h3 className="mb-1.5 text-xs text-muted-foreground">Topics offered</h3>
            <ul className="flex flex-wrap gap-1.5">
              {mentor.topics.map((t) => (
                <li key={t} className={cn(chipClass, "capitalize")}>{t}</li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-muted-foreground">{SELF_DECLARED} The mentor wrote the expertise, experience and organisation themselves.</p>
        </section>

        <section aria-labelledby="availability-heading" className="space-y-3 rounded-2xl border border-border bg-surface p-5 sm:p-6">
          <h2 id="availability-heading" className="text-lg font-semibold text-maroon-900">Usually available</h2>
          {mentor.availability.length === 0 ? (
            <p className="text-sm text-muted-foreground">No times listed. Agree a time by message once you are matched.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {mentor.availability.map((w) => (
                <li key={w.id}>
                  <span className="font-medium text-maroon-900">{WEEKDAYS[w.weekday]}</span> {minutesToTime(w.start_minute)}–{minutesToTime(w.end_minute)}{" "}
                  <span className="text-muted-foreground">({w.timezone})</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">An informal guide only. Nothing is booked here and no calendar is connected.</p>
        </section>

        <MentorshipLimits compact />

        {isMe ? (
          <LinkButton href="/mentorship/become-a-mentor" variant="outline" className="h-10 px-4">Edit your listing</LinkButton>
        ) : mentor.mentorship ? (
          <section aria-labelledby="active-heading" className="space-y-3 rounded-2xl border border-maroon-200 bg-maroon-50/70 p-5">
            <h2 id="active-heading" className="text-lg font-semibold text-maroon-900">You are being mentored by {m.first_name}</h2>
            <div className="flex flex-wrap gap-2">
              {mentor.mentorship.conversation_id ? (
                <LinkButton href={`/messages/${mentor.mentorship.conversation_id}`} className="h-10 px-4">
                  <MessageSquare className="size-4" aria-hidden="true" />
                  Open the conversation
                </LinkButton>
              ) : null}
              <LinkButton href="/mentorship/my-mentorships" variant="outline" className="h-10 px-4">Manage</LinkButton>
            </div>
          </section>
        ) : mentor.pendingRequest ? (
          <section aria-labelledby="pending-heading" className="space-y-2 rounded-2xl border border-border bg-surface p-5">
            <h2 id="pending-heading" className="text-lg font-semibold text-maroon-900">Your request is waiting</h2>
            <p className="text-sm text-muted-foreground">{m.first_name} will accept or decline. You&apos;ll be told when they decide.</p>
            <WithdrawRequestButton requestId={mentor.pendingRequest.id} />
          </section>
        ) : mentor.accepting ? (
          <section aria-labelledby="request-heading" className="space-y-3 rounded-2xl border border-border bg-surface p-5 sm:p-6">
            <h2 id="request-heading" className="text-lg font-semibold text-maroon-900">Ask {m.first_name} to mentor you</h2>
            <RequestForm mentorId={mentor.user_id} mentorName={m.first_name} formats={mentor.session_formats} />
          </section>
        ) : null}

        {!isMe ? <ReportButton targetType="mentor" targetId={mentor.user_id} label="Report this listing" /> : null}
      </main>
    </>
  );
}
