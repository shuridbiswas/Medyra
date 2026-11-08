import Link from "next/link";
import { Button } from "@/components/ui/button";
import { controlClass, labelClass } from "@/components/forms/controls";
import {
  METHOD_HELP,
  METHOD_LABEL,
  NEXT_STEP,
  REASON_LABEL,
  STATUS_LABEL,
  t,
  text,
  type Lang,
} from "@/features/student-verification/content";
import {
  addReference,
  confirmInstitutionalCode,
  sendInstitutionalCode,
  skipEmailStep,
  startVerification,
  submitVerification,
  uploadEvidence,
  withdrawVerification,
} from "@/features/student-verification/actions";
import { OPEN_STATUSES } from "@/features/student-verification/machine";
import type { EvidenceRow, InstitutionRow, MethodRow, ProgramRow, RequestRow } from "@/features/student-verification/types";

const LangField = ({ lang }: { lang: Lang }) => <input type="hidden" name="lang" value={lang} />;
const instName = (i: Pick<InstitutionRow, "name_en" | "name_fr">, lang: Lang) => (lang === "fr" ? i.name_fr : i.name_en);

export function Banner({ notice, error }: { notice?: string; error?: string }) {
  if (error) return <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>;
  if (notice) return <p role="status" className="rounded-xl border border-border bg-maroon-50 p-3 text-sm text-maroon-900">{notice}</p>;
  return null;
}

/** Steps 1 to 3: country, institution, program and method. */
export function StartPanel({
  institutions,
  selected,
  lang,
}: {
  institutions: InstitutionRow[];
  selected: { institution: InstitutionRow; methods: MethodRow[]; programs: ProgramRow[] } | null;
  lang: Lang;
}) {
  const universities = institutions.filter((i) => i.kind === "university");
  const colleges = institutions.filter((i) => i.kind !== "university");
  const methodChoices = selected
    ? (["OFFICIAL_ATTESTATION_REVIEW", "ISSUER_BACKED_DOCUMENT_SHARE", "REGISTRAR_CONFIRMATION"] as const).filter(
        (m) => m === "OFFICIAL_ATTESTATION_REVIEW" || selected.methods.some((x) => x.method === m),
      )
    : [];
  return (
    <div className="space-y-6">
      <section aria-labelledby="step-1" className="space-y-1">
        <h2 id="step-1" className="text-sm font-semibold text-maroon-900">1. {text(t.country, lang)}</h2>
        <p className="text-sm">{text(t.countryValue, lang)}</p>
      </section>

      <form method="get" className="space-y-2" aria-labelledby="step-2">
        <h2 id="step-2" className="text-sm font-semibold text-maroon-900">2. {text(t.institution, lang)}</h2>
        {lang === "fr" ? <input type="hidden" name="lang" value="fr" /> : null}
        <label htmlFor="institution" className={labelClass}>{text(t.institution, lang)}</label>
        <select id="institution" name="institution" defaultValue={selected?.institution.id ?? ""} required className={controlClass}>
          <option value="" disabled>—</option>
          <optgroup label={lang === "fr" ? "Universités" : "Universities"}>
            {universities.map((i) => <option key={i.id} value={i.id}>{instName(i, lang)}</option>)}
          </optgroup>
          <optgroup label={lang === "fr" ? "Cégeps et collèges" : "CEGEPs and colleges"}>
            {colleges.map((i) => <option key={i.id} value={i.id}>{instName(i, lang)}</option>)}
          </optgroup>
        </select>
        <Button type="submit" variant="outline">{text(t.continueTo, lang)}</Button>
      </form>

      {selected ? (
        <form action={startVerification} className="space-y-4" aria-labelledby="step-3">
          <LangField lang={lang} />
          <input type="hidden" name="institutionId" value={selected.institution.id} />
          <h2 id="step-3" className="text-sm font-semibold text-maroon-900">3. {text(t.program, lang)}</h2>
          <div>
            <label htmlFor="programId" className={labelClass}>{text(t.program, lang)}</label>
            <select id="programId" name="programId" defaultValue="" className={controlClass}>
              <option value="">{text(t.noProgram, lang)}</option>
              {selected.programs.filter((p) => p.source_reviewed_at).map((p) => (
                <option key={p.id} value={p.id}>{p.official_name}</option>
              ))}
            </select>
            {selected.programs.length === 0 ? <p className="mt-1 text-xs text-muted-foreground">{text(t.noPrograms, lang)}</p> : null}
          </div>
          <fieldset className="space-y-2">
            <legend className={labelClass}>{text(t.method, lang)}</legend>
            {methodChoices.map((m, i) => {
              const row = selected.methods.find((x) => x.method === m);
              return (
                <label key={m} className="flex items-start gap-2 rounded-lg border border-border bg-surface p-3 text-sm">
                  <input type="radio" name="method" value={m} defaultChecked={i === 0} required className="mt-1" />
                  <span>
                    <span className="block font-medium text-maroon-900">{text(METHOD_LABEL[m], lang)}</span>
                    <span className="block text-xs text-muted-foreground">{text(METHOD_HELP[m], lang)}</span>
                    {row?.status === "unverified" ? <span className="block text-xs text-muted-foreground">{lang === "fr" ? "Procédure de l'établissement non encore documentée." : "This institution's process is not yet documented."}</span> : null}
                  </span>
                </label>
              );
            })}
          </fieldset>
          <Button type="submit">{text(t.start, lang)}</Button>
        </form>
      ) : null}
    </div>
  );
}

function Instructions({ institution, lang }: { institution: InstitutionRow; lang: Lang }) {
  const body = lang === "fr" ? institution.instructions_fr : institution.instructions_en;
  const links = [institution.documents_url, institution.registrar_url].filter((u): u is string => Boolean(u));
  return (
    <section aria-label={text(t.officialSource, lang)} className="space-y-2 rounded-xl border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-maroon-900">{text(t.officialSource, lang)}</h3>
      <p className="text-sm text-maroon-900/90">{body ?? text(t.unconfirmedInstitution, lang)}</p>
      <ul className="list-inside list-disc text-sm">
        {links.map((u) => (
          <li key={u}><a href={u} target="_blank" rel="noopener noreferrer" className="text-maroon-700 underline">{text(t.openSource, lang)}: {new URL(u).hostname}</a></li>
        ))}
      </ul>
    </section>
  );
}

const SCAN_LABEL: Record<string, { en: string; fr: string }> = {
  pending: { en: "waiting for inspection", fr: "en attente d'inspection" },
  static_ok: { en: "inspected", fr: "inspecté" },
  av_clean: { en: "inspected", fr: "inspecté" },
  quarantined: { en: "quarantined", fr: "en quarantaine" },
};

/** Steps 4 to 8 for one request. */
export function RequestPanel({
  request,
  institution,
  evidence,
  consentVersion,
  retentionDays,
  lang,
}: {
  request: RequestRow;
  institution: InstitutionRow;
  evidence: EvidenceRow[];
  consentVersion: string;
  retentionDays: number;
  lang: Lang;
}) {
  const open = OPEN_STATUSES.includes(request.status);
  const emailStep = request.status === "DRAFT" || request.status === "AWAITING_EMAIL_VERIFICATION";
  const evidenceStep = request.status === "AWAITING_EVIDENCE" || request.status === "MORE_INFORMATION_REQUIRED";
  const next = NEXT_STEP[request.status];
  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold text-maroon-900">{instName(institution, lang)}</h2>
        <p className="text-sm text-muted-foreground">
          {request.program?.official_name ?? text(t.noProgram, lang)} · {text(METHOD_LABEL[request.method] ?? METHOD_LABEL.OFFICIAL_ATTESTATION_REVIEW, lang)}
        </p>
        <p className="text-sm"><span className="font-medium">{text(t.status, lang)}:</span> {text(STATUS_LABEL[request.status], lang)}</p>
        {next ? <p className="text-sm text-muted-foreground">{text(next, lang)}</p> : null}
        {request.student_message ? (
          <p className="rounded-lg bg-maroon-50 p-3 text-sm text-maroon-900"><span className="font-medium">{text(t.reviewerNote, lang)}:</span> {request.student_message}</p>
        ) : null}
        {request.decision_reason_code && !open && request.status !== "APPROVED" ? (
          <p className="text-sm text-muted-foreground">{text(REASON_LABEL[request.decision_reason_code] ?? REASON_LABEL.other, lang)}</p>
        ) : null}
        {request.status === "APPROVED" && request.expires_at ? (
          <p className="text-sm">{text(t.validUntil, lang)} {request.expires_at.slice(0, 10)}. {text(t.scopeNote, lang)}.</p>
        ) : null}
      </header>

      {emailStep ? (
        <section aria-label={text(t.schoolEmail, lang)} className="space-y-3 rounded-xl border border-border bg-surface p-4">
          <h3 className="text-sm font-semibold text-maroon-900">4. {text(t.schoolEmail, lang)}</h3>
          {institution.email_domains.length > 0 ? (
            <>
              <p className="text-xs text-muted-foreground">{text(t.schoolEmailHelp, lang)} ({institution.email_domains.map((d) => `@${d}`).join(", ")})</p>
              <form action={sendInstitutionalCode} className="flex flex-wrap items-end gap-2">
                <LangField lang={lang} />
                <input type="hidden" name="requestId" value={request.id} />
                <div className="min-w-56 flex-1">
                  <label htmlFor="email" className={labelClass}>{text(t.schoolEmail, lang)}</label>
                  <input id="email" name="email" type="email" required autoComplete="off" className={controlClass} />
                </div>
                <Button type="submit" variant="outline">{text(t.sendCode, lang)}</Button>
              </form>
              <form action={confirmInstitutionalCode} className="flex flex-wrap items-end gap-2">
                <LangField lang={lang} />
                <input type="hidden" name="requestId" value={request.id} />
                <div>
                  <label htmlFor="code" className={labelClass}>{text(t.code, lang)}</label>
                  <input id="code" name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="one-time-code" className={controlClass} />
                </div>
                <Button type="submit">{text(t.confirmCode, lang)}</Button>
              </form>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{text(t.noEmailStep, lang)}</p>
          )}
          <form action={skipEmailStep}>
            <LangField lang={lang} />
            <input type="hidden" name="requestId" value={request.id} />
            <Button type="submit" variant="ghost">{text(t.skip, lang)}</Button>
          </form>
        </section>
      ) : null}

      {evidenceStep || request.status === "SUBMITTED" || request.status === "UNDER_REVIEW" ? <Instructions institution={institution} lang={lang} /> : null}

      {evidenceStep ? (
        <section aria-label={text(t.evidence, lang)} className="space-y-4 rounded-xl border border-border bg-surface p-4">
          <h3 className="text-sm font-semibold text-maroon-900">5-6. {text(t.evidence, lang)}</h3>
          <p className="text-xs text-muted-foreground">{text(t.neverSend, lang)}</p>
          {evidence.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {evidence.map((e) => (
                <li key={e.id}>
                  {e.private_storage_path ? (lang === "fr" ? "Fichier" : "File") : (lang === "fr" ? "Référence" : "Reference")}
                  {e.mime_type ? ` (${e.mime_type})` : ""} · {text(SCAN_LABEL[e.scan_status] ?? SCAN_LABEL.pending, lang)}
                </li>
              ))}
            </ul>
          ) : null}
          {request.method !== "REGISTRAR_CONFIRMATION" ? (
            <>
              {request.method === "OFFICIAL_ATTESTATION_REVIEW" ? (
                <form action={uploadEvidence} className="flex flex-wrap items-end gap-2" encType="multipart/form-data">
                  <LangField lang={lang} />
                  <input type="hidden" name="requestId" value={request.id} />
                  <div className="min-w-56 flex-1">
                    <label htmlFor="file" className={labelClass}>{text(t.upload, lang)}</label>
                    <input id="file" name="file" type="file" accept="application/pdf,image/jpeg,image/png" required className="block w-full text-sm" />
                  </div>
                  <Button type="submit" variant="outline">{text(t.add, lang)}</Button>
                </form>
              ) : null}
              <form action={addReference} className="flex flex-wrap items-end gap-2">
                <LangField lang={lang} />
                <input type="hidden" name="requestId" value={request.id} />
                <div className="min-w-56 flex-1">
                  <label htmlFor="reference" className={labelClass}>{text(t.reference, lang)}</label>
                  <input id="reference" name="reference" maxLength={500} required className={controlClass} />
                  <p className="mt-1 text-xs text-muted-foreground">{text(t.referenceHelp, lang)}</p>
                </div>
                <Button type="submit" variant="outline">{text(t.add, lang)}</Button>
              </form>
            </>
          ) : null}
          <form action={submitVerification} className="space-y-3 border-t border-border pt-3">
            <LangField lang={lang} />
            <input type="hidden" name="requestId" value={request.id} />
            <input type="hidden" name="consentVersion" value={consentVersion} />
            <h3 className="text-sm font-semibold text-maroon-900">7. {text(t.consentTitle, lang)}</h3>
            <p className="text-sm">{text(t.consent, lang).replace("{days}", String(retentionDays))}</p>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="consent" required className="mt-1" />
              <span>{text(t.consentCheck, lang)}</span>
            </label>
            <Button type="submit">{text(t.submit, lang)}</Button>
          </form>
        </section>
      ) : null}

      {open ? (
        <form action={withdrawVerification}>
          <LangField lang={lang} />
          <input type="hidden" name="requestId" value={request.id} />
          <Button type="submit" variant="ghost">{text(t.withdraw, lang)}</Button>
        </form>
      ) : (
        <Link href={lang === "fr" ? "/verification/student?lang=fr" : "/verification/student"} className="text-sm text-maroon-700 underline">{text(t.start, lang)}</Link>
      )}
    </div>
  );
}
