import { BookOpen, GraduationCap, MapPin, Pencil, Sprout } from "lucide-react";
import { LogoMark } from "@/components/brand/logo";
import { LinkButton } from "@/components/ui/link-button";
import {
  careerStageLabel,
  generalLocation,
} from "@/features/profile/format";
import { fullName, type PublicProfile } from "@/features/profile/visibility";
import { VerificationChip, type ChipBadge } from "@/components/verification-chip";

/**
 * The identity card: cover, photo, name and the few facts people scan first. Credentials are not
 * verified in Medyra yet, so the card says "Not Verified" unless a valid student credential exists. `actions`
 * holds connect / follow / block controls when someone else is looking.
 */
export function ProfileHeader({
  profile,
  isOwner,
  avatarSrc,
  coverSrc,
  actions,
  badge,
}: {
  profile: PublicProfile;
  badge?: ChipBadge;
  isOwner: boolean;
  avatarSrc: string | null;
  coverSrc: string | null;
  actions?: React.ReactNode;
}) {
  const name = fullName(profile);
  const location = generalLocation(profile.location_label, profile.country);
  const stage = careerStageLabel(profile.career_stage);
  const studyLine = [profile.qualification, profile.institution]
    .filter(Boolean)
    .join(" at ");

  return (
    <header className="overflow-hidden rounded-3xl border border-border bg-surface shadow-[0_24px_60px_-44px_rgba(110,16,38,0.45)]">
      <div className="relative h-32 overflow-hidden bg-maroon-100 sm:h-36">
        {coverSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={coverSrc} alt="" className="size-full object-cover" />
        ) : (
          <>
            <LogoMark className="absolute -top-8 -right-6 h-48 w-auto opacity-[0.22]" />
            <LogoMark className="absolute top-12 -left-10 h-32 w-auto opacity-[0.12]" />
          </>
        )}
      </div>

      <div className="px-5 pb-6">
        <div className="relative -mt-14 flex justify-center">
          <span className="flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-full border-4 border-surface bg-maroon-100 text-4xl font-bold text-maroon-700">
            {avatarSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarSrc}
                alt={`Photo of ${name}`}
                className="size-full object-cover"
              />
            ) : (
              <span aria-hidden="true">
                {profile.first_name.slice(0, 1).toUpperCase()}
              </span>
            )}
          </span>
        </div>

        <div className="mt-3 text-center">
          <h1 className="text-2xl leading-tight font-bold text-maroon-900">{name}</h1>
          <p className="mt-0.5 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            @{profile.username}
            <VerificationChip badge={badge} />
          </p>
          {profile.headline ? (
            <p className="mt-2 text-base text-maroon-900/90">{profile.headline}</p>
          ) : isOwner ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Add a headline so people know what you do.
            </p>
          ) : null}
        </div>

        <ul className="mt-5 space-y-3 text-sm">
          {studyLine ? (
            <li className="flex items-start gap-3">
              <GraduationCap className="mt-0.5 size-4.5 shrink-0 text-maroon-600" aria-hidden="true" />
              <span className="text-maroon-900/90">{studyLine}</span>
            </li>
          ) : null}
          {profile.specialty ? (
            <li className="flex items-start gap-3">
              <BookOpen className="mt-0.5 size-4.5 shrink-0 text-maroon-600" aria-hidden="true" />
              <span className="text-maroon-900/90">{profile.specialty}</span>
            </li>
          ) : null}
          {location ? (
            <li className="flex items-start gap-3">
              <MapPin className="mt-0.5 size-4.5 shrink-0 text-maroon-600" aria-hidden="true" />
              <span className="text-maroon-900/90">{location}</span>
            </li>
          ) : null}
          {stage ? (
            <li className="flex items-start gap-3">
              <Sprout className="mt-0.5 size-4.5 shrink-0 text-maroon-600" aria-hidden="true" />
              <span className="text-maroon-900/90">{stage}</span>
            </li>
          ) : null}
        </ul>

        {isOwner ? (
          <LinkButton
            href="/profile/edit"
            variant="outline"
            className="mt-5 h-11 w-full rounded-full border-maroon-200 text-sm font-semibold text-maroon-700"
          >
            <Pencil className="size-4" aria-hidden="true" />
            Edit Profile
          </LinkButton>
        ) : actions ? (
          <div className="mt-5 flex justify-center">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}
