import { BadgeCheck } from "lucide-react";
import {
  METHOD_LABEL,
  credentialTitle,
  institutionName,
  t,
  text,
  type BadgeCredential,
  type Lang,
} from "@/features/student-verification/content";

/**
 * The one verification badge. A blue "Verified" pill only when the member has at least one valid
 * credential (the database already dropped expired and revoked ones); otherwise a grey
 * "Not Verified". Nothing on the client can switch it: the credentials come from the server's
 * verified_badges() call. Clicking the blue pill opens what exactly was verified, using a native
 * <details> element so it needs no script.
 */
export type ChipBadge = { credentials: BadgeCredential[] } | null | undefined;

export function VerificationChip({ badge, lang = "en" }: { badge?: ChipBadge; lang?: Lang }) {
  const credentials = badge?.credentials ?? [];
  if (credentials.length === 0) {
    return (
      <span className="inline-flex items-center rounded-full border border-border bg-sand px-2 py-0.5 text-[0.7rem] font-medium text-muted-foreground">
        {text(t.notVerified, lang)}
      </span>
    );
  }
  return (
    <details className="relative inline-block align-middle">
      <summary
        aria-label={`${text(t.verified, lang)}: ${credentialTitle(credentials[0], lang)}`}
        className="inline-flex cursor-pointer list-none items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[0.7rem] font-semibold text-blue-800 marker:hidden focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none [&::-webkit-details-marker]:hidden"
      >
        <BadgeCheck aria-hidden className="size-3.5 text-blue-600" />
        {text(t.verified, lang)}
      </summary>
      <div role="group" className="absolute left-0 z-20 mt-1 w-72 max-w-[80vw] space-y-2 rounded-xl border border-border bg-surface p-3 text-left text-xs shadow-lg">
        {credentials.map((c) => (
          <dl key={`${c.institution_name}-${c.claim_type}-${c.program_name ?? ""}`} className="space-y-0.5">
            <div>
              <dt className="inline text-muted-foreground">{text(t.credential, lang)}: </dt>
              <dd className="inline font-medium text-maroon-900">{credentialTitle(c, lang)}</dd>
            </div>
            <div>
              <dt className="inline text-muted-foreground">{text(t.institution, lang)}: </dt>
              <dd className="inline text-maroon-900">{institutionName(c, lang)}</dd>
            </div>
            <div>
              <dt className="inline text-muted-foreground">{text(t.verificationMethod, lang)}: </dt>
              <dd className="inline text-maroon-900">{text(METHOD_LABEL[c.verification_method] ?? METHOD_LABEL.OFFICIAL_ATTESTATION_REVIEW, lang)}</dd>
            </div>
            <div>
              <dt className="inline text-muted-foreground">{text(t.lastVerified, lang)}: </dt>
              <dd className="inline text-maroon-900">{c.verified_at.slice(0, 10)}</dd>
            </div>
          </dl>
        ))}
        <p className="border-t border-border pt-2 text-muted-foreground">{text(t.scopeNote, lang)}</p>
      </div>
    </details>
  );
}

export { VerificationChip as VerificationBadge };
