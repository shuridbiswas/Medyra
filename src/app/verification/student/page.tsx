import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/layout/app-header";
import { AppPage } from "@/components/layout/app-page";
import { requireMember } from "@/lib/auth/session";
import { parseLang, t, text } from "@/features/student-verification/content";
import { getInstitution, getPolicy, getRequestDetail, listInstitutions } from "@/features/student-verification/queries";
import { Banner, RequestPanel, StartPanel } from "@/features/student-verification/components/wizard";

export const metadata: Metadata = { title: "Student verification", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function StudentVerificationPage({ searchParams }: Props) {
  return (
    <AppPage label="student verification">
      <Content searchParams={searchParams} />
    </AppPage>
  );
}

async function Content({ searchParams }: Props) {
  const { profile, user } = await requireMember();
  const params = await searchParams;
  const lang = parseLang(first(params.lang));
  const requestId = first(params.request);
  const institutionId = first(params.institution);
  const suffix = lang === "fr" ? "?lang=fr" : "";

  let body: React.ReactNode;
  if (requestId && UUID.test(requestId)) {
    const detail = await getRequestDetail(requestId);
    // Row level security returns nothing for someone else's request.
    if (!detail || detail.request.user_id !== user.id) notFound();
    const [found, policy] = await Promise.all([getInstitution(detail.request.institution_id), getPolicy()]);
    if (!found) notFound();
    body = (
      <RequestPanel
        request={detail.request}
        institution={found.institution}
        evidence={detail.evidence}
        consentVersion={policy.consent_version}
        retentionDays={policy.evidence_retention_days}
        lang={lang}
      />
    );
  } else {
    const [institutions, selected] = await Promise.all([
      listInstitutions(),
      institutionId && UUID.test(institutionId) ? getInstitution(institutionId) : Promise.resolve(null),
    ]);
    body = <StartPanel institutions={institutions} selected={selected} lang={lang} />;
  }

  return (
    <>
      <AppHeader member={profile} />
      <main id="main" className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold text-maroon-900">{text(t.title, lang)}</h1>
          <nav aria-label="Language" className="flex gap-3 text-sm">
            <Link href="?lang=en" className="underline" lang="en">English</Link>
            <Link href="?lang=fr" className="underline" lang="fr">Français</Link>
          </nav>
        </div>
        <p className="text-sm text-muted-foreground">{text(t.intro, lang)}</p>
        <nav aria-label={text(t.title, lang)} className="flex gap-4 text-sm">
          <Link href={`/verification/student${suffix}`} className="underline">{text(t.start, lang)}</Link>
          <Link href={`/verification/student/status${suffix}`} className="underline">{text(t.status, lang)}</Link>
          <Link href={`/verification/student/history${suffix}`} className="underline">{text(t.history, lang)}</Link>
        </nav>
        <Banner notice={first(params.notice)} error={first(params.error)} />
        {body}
      </main>
    </>
  );
}
