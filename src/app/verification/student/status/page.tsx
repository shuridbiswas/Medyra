import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/layout/app-header";
import { AppPage } from "@/components/layout/app-page";
import { VerificationChip } from "@/components/verification-chip";
import { requireMember } from "@/lib/auth/session";
import { NEXT_STEP, STATUS_LABEL, parseLang, t, text } from "@/features/student-verification/content";
import { OPEN_STATUSES } from "@/features/student-verification/machine";
import { getBadges, getMyRequests } from "@/features/student-verification/queries";

export const metadata: Metadata = { title: "Verification status", robots: { index: false, follow: false } };
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default function StatusPage({ searchParams }: Props) {
  return (
    <AppPage label="verification status">
      <Content searchParams={searchParams} />
    </AppPage>
  );
}

async function Content({ searchParams }: Props) {
  const { profile, user } = await requireMember();
  const params = await searchParams;
  const lang = parseLang(Array.isArray(params.lang) ? params.lang[0] : params.lang);
  const suffix = lang === "fr" ? "&lang=fr" : "";
  const [requests, badges] = await Promise.all([getMyRequests(user.id), getBadges([user.id])]);
  const badge = badges.get(user.id) ?? null;
  const current = requests.filter((r) => OPEN_STATUSES.includes(r.status));

  return (
    <>
      <AppHeader member={profile} />
      <main id="main" className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6">
        <h1 className="text-2xl font-bold text-maroon-900">{text(t.status, lang)}</h1>
        <section aria-label={text(t.currentCredentials, lang)} className="space-y-2 rounded-xl border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-maroon-900">{text(t.currentCredentials, lang)}</h2>
          <VerificationChip badge={badge} lang={lang} />
          {badge ? (
            <ul className="text-sm">
              {badge.credentials.map((c) => (
                <li key={`${c.institution_id}${c.claim_type}${c.program_name ?? ""}`}>
                  {c.institution_name} · {c.program_name ?? text(t.noProgram, lang)} · {text(t.validUntil, lang)} {c.expires_at.slice(0, 10)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{text(t.noCredentials, lang)}</p>
          )}
        </section>
        {current.length === 0 ? (
          <p className="text-sm text-muted-foreground">{text(t.noRequests, lang)}</p>
        ) : (
          <ul className="space-y-3">
            {current.map((r) => (
              <li key={r.id} className="rounded-xl border border-border bg-surface p-4 text-sm">
                <Link href={`/verification/student?request=${r.id}${suffix}`} className="font-medium text-maroon-900 underline">
                  {lang === "fr" ? r.institution?.name_fr : r.institution?.name_en}
                </Link>
                <p>{text(STATUS_LABEL[r.status], lang)}</p>
                {NEXT_STEP[r.status] ? <p className="text-muted-foreground">{text(NEXT_STEP[r.status]!, lang)}</p> : null}
              </li>
            ))}
          </ul>
        )}
        <Link href={`/verification/student${lang === "fr" ? "?lang=fr" : ""}`} className="text-sm underline">{text(t.start, lang)}</Link>
      </main>
    </>
  );
}
