import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/layout/app-header";
import { AppPage } from "@/components/layout/app-page";
import { requireMember } from "@/lib/auth/session";
import { METHOD_LABEL, REASON_LABEL, STATUS_LABEL, parseLang, t, text } from "@/features/student-verification/content";
import { getMyCredentials, getMyRequests } from "@/features/student-verification/queries";

export const metadata: Metadata = { title: "Verification history", robots: { index: false, follow: false } };
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default function HistoryPage({ searchParams }: Props) {
  return (
    <AppPage label="verification history">
      <Content searchParams={searchParams} />
    </AppPage>
  );
}

async function Content({ searchParams }: Props) {
  const { profile, user } = await requireMember();
  const params = await searchParams;
  const lang = parseLang(Array.isArray(params.lang) ? params.lang[0] : params.lang);
  const [requests, credentials] = await Promise.all([getMyRequests(user.id), getMyCredentials(user.id)]);
  const suffix = lang === "fr" ? "&lang=fr" : "";
  return (
    <>
      <AppHeader member={profile} />
      <main id="main" className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6">
        <h1 className="text-2xl font-bold text-maroon-900">{text(t.history, lang)}</h1>
        {requests.length === 0 ? <p className="text-sm text-muted-foreground">{text(t.noRequests, lang)}</p> : null}
        <ul className="space-y-3">
          {requests.map((r) => (
            <li key={r.id} className="rounded-xl border border-border bg-surface p-4 text-sm">
              <Link href={`/verification/student?request=${r.id}${suffix}`} className="font-medium text-maroon-900 underline">
                {lang === "fr" ? r.institution?.name_fr : r.institution?.name_en}
              </Link>
              <p>{r.program?.official_name ?? text(t.noProgram, lang)} · {text(METHOD_LABEL[r.method] ?? METHOD_LABEL.OFFICIAL_ATTESTATION_REVIEW, lang)}</p>
              <p>{text(STATUS_LABEL[r.status], lang)} · {r.created_at.slice(0, 10)}</p>
              {r.decision_reason_code ? <p className="text-muted-foreground">{text(REASON_LABEL[r.decision_reason_code] ?? REASON_LABEL.other, lang)}</p> : null}
            </li>
          ))}
        </ul>
        {credentials.length > 0 ? (
          <section aria-label={text(t.currentCredentials, lang)}>
            <h2 className="text-sm font-semibold text-maroon-900">{text(t.currentCredentials, lang)}</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {credentials.map((c) => (
                <li key={c.id}>
                  {c.claim_type === "CURRENT_STUDENT" ? "Student" : "Program student"} · {c.verified_at.slice(0, 10)} → {c.expires_at.slice(0, 10)}
                  {c.revoked_at ? ` · ${text(REASON_LABEL[c.revocation_reason_code ?? "other"] ?? REASON_LABEL.other, lang)}` : c.expired_at ? ` · ${text(STATUS_LABEL.EXPIRED, lang)}` : ""}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </>
  );
}
