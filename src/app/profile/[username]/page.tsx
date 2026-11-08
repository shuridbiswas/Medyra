import type { Metadata } from "next";
import { MessageSquare } from "lucide-react";
import { LinkButton } from "@/components/ui/link-button";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AppFrame } from "@/components/layout/app-frame";
import { AppHeader } from "@/components/layout/app-header";
import { avatarUrl, coverUrl, requireMember } from "@/lib/auth/session";
import { getBadges } from "@/features/student-verification/queries";
import { ProfileHeader } from "@/features/profile/components/profile-header";
import { ProfileTabs } from "@/features/profile/components/profile-tabs";
import {
  AboutCard,
  CompletenessCard,
  InterestsCard,
  NetworkCard,
  TimelineCard,
} from "@/features/profile/components/sections";
import { ProfileActivity } from "@/features/feed/components/profile-activity";
import { BlockButton } from "@/features/network/components/block-button";
import { MuteButton } from "@/features/safety/components/mute-button";
import { ReportButton } from "@/features/safety/components/report-button";
import { isMuted } from "@/features/safety/queries";
import { ProfileConnections } from "@/features/network/components/profile-connections";
import { RelationshipActions } from "@/features/network/components/relationship-actions";
import {
  getBlockedIds,
  getNetworkCounts,
  getRelationship,
  listConnections,
} from "@/features/network/queries";
import { getProfileByUsername } from "@/features/profile/queries";
import { restrictToCard, toPublicProfile } from "@/features/profile/visibility";

export const metadata: Metadata = {
  title: "Profile",
  robots: { index: false },
};

type Props = { params: Promise<{ username: string }> };

export default function ProfilePage({ params }: Props) {
  return (
    <AppFrame>
      <Suspense fallback={<ProfileFallback />}>
        <ProfileContent params={params} />
      </Suspense>
    </AppFrame>
  );
}

function ProfileFallback() {
  return (
    <div role="status" className="flex min-h-dvh items-center justify-center">
      <span className="size-8 animate-spin rounded-full border-2 border-maroon-200 border-t-maroon-700 motion-reduce:animate-none" />
      <span className="sr-only">Loading profile</span>
    </div>
  );
}

async function ProfileContent({ params }: Props) {
  const { username } = await params;
  // Viewers must be signed-in, verified members who finished onboarding.
  const { user, profile: me } = await requireMember();

  // Unknown usernames, malformed ones, and profiles the viewer isn't allowed to see are all "not found".
  const data = await getProfileByUsername(username);
  if (!data) notFound();

  const isOwner = data.profile.id === user.id;
  const fullProfile = toPublicProfile(data.profile);
  const { education, experience, skills } = data;
  const name = [fullProfile.first_name, fullProfile.last_name].filter(Boolean).join(" ");

  const [counts, preview, relationship, blockedIds, muted, badges] = await Promise.all([
    getNetworkCounts(fullProfile.id),
    listConnections(fullProfile.id, 1, 8),
    isOwner ? Promise.resolve(null) : getRelationship(user.id, fullProfile.id),
    isOwner ? Promise.resolve<string[]>([]) : getBlockedIds(user.id),
    isOwner ? Promise.resolve(false) : isMuted(user.id, fullProfile.id),
    getBadges([fullProfile.id]),
  ]);
  const blockedByMe = blockedIds.includes(fullProfile.id);
  // Members who limit details to connections show everyone else just their identity card.
  const detailsHidden =
    !isOwner && fullProfile.profile_visibility === "connections" && relationship?.state !== "connected";
  const profile = detailsHidden ? restrictToCard(fullProfile) : fullProfile;

  const actions =
    isOwner || !relationship ? null : (
      <div className="flex w-full flex-col items-center gap-3">
        {blockedByMe ? (
          <p className="text-center text-sm text-muted-foreground">
            You blocked {name}. Unblock to connect or follow again.
          </p>
        ) : (
          <RelationshipActions
            key={`${relationship.state}:${relationship.following}`}
            memberId={profile.id}
            name={name}
            initial={relationship}
            className="justify-center"
          />
        )}
        {blockedByMe ? null : (
          <LinkButton href={`/messages?to=${profile.id}`} variant="outline" className="h-9 px-4 text-sm">
            <MessageSquare className="size-4" aria-hidden="true" />
            Message
          </LinkButton>
        )}
        <div className="flex flex-wrap items-start justify-center gap-x-5 gap-y-2">
          <BlockButton memberId={profile.id} name={name} blocked={blockedByMe} />
          <MuteButton memberId={profile.id} name={name} muted={muted} />
          <ReportButton targetType="profile" targetId={profile.id} label="Report this member" />
        </div>
      </div>
    );

  return (
    <>
      <AppHeader member={me} />
      <main
        id="main"
        className="mx-auto grid max-w-6xl items-start gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[21rem_minmax(0,1fr)]"
      >
        <div className="space-y-5 lg:sticky lg:top-22">
          <ProfileHeader
            profile={profile}
            isOwner={isOwner}
            avatarSrc={avatarUrl(profile.avatar_path)}
            coverSrc={coverUrl(profile.cover_path)}
            actions={actions}
            badge={badges.get(fullProfile.id) ?? null}
          />
          {isOwner ? (
            <CompletenessCard
              profile={profile}
              education={education}
              experience={experience}
              skills={skills}
            />
          ) : null}
          <NetworkCard counts={counts} connections={preview.members} isOwner={isOwner} />
        </div>

        <div className="min-w-0 space-y-5">
          <div className="grid gap-5 xl:grid-cols-2">
            <AboutCard profile={profile} isOwner={isOwner} />
            <InterestsCard profile={profile} skills={skills} isOwner={isOwner} />
          </div>
          <TimelineCard
            education={education}
            experience={experience}
            isOwner={isOwner}
            firstName={profile.first_name}
          />
          <ProfileTabs
            tabs={[
              {
                id: "posts",
                label: "Posts",
                panel: (
                  <ProfileActivity
                    viewerId={user.id}
                    authorId={profile.id}
                    isOwner={isOwner}
                    firstName={profile.first_name}
                  />
                ),
              },
              {
                id: "connections",
                label: "Connections",
                count: counts.connections,
                panel: (
                  <Suspense
                    fallback={
                      <p role="status" className="text-sm text-muted-foreground">
                        Loading connections…
                      </p>
                    }
                  >
                    <ProfileConnections
                      profileId={profile.id}
                      isOwner={isOwner}
                      firstName={profile.first_name}
                    />
                  </Suspense>
                ),
              },
            ]}
          />
        </div>
      </main>
    </>
  );
}
