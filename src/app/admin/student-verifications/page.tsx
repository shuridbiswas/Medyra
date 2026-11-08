import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/layout/app-header";
import { AppPage } from "@/components/layout/app-page";
import { Button } from "@/components/ui/button";
import { controlClass, labelClass, textareaClass } from "@/components/forms/controls";
import { requireAdmin } from "@/lib/auth/session";
import { cn } from "@/lib/utils";
import { AdminNav, AdminNotice } from "@/features/admin/components/admin-nav";
import { METHOD_LABEL, REASON_LABEL, STATUS_LABEL, text } from "@/features/student-verification/content";
import {
  ADMIN_TABS,
  getAdminDetail,
  listAdminRequests,
  listAudit,
  parseAdminTab,
} from "@/features/student-verification/queries";
import {
  approveVerification,
  claimVerification,
  inspectEvidenceFile,
  openEvidenceFile,
  purgeDueEvidence,
  rejectVerification,
  requestMoreInformation,
  revokeCredential,
  reviewEvidenceItem,
  runExpiry,
  saveChecks,
  setCredentialExpiry,
} from "@/features/student-verification/admin-actions";

export const metadata: Metadata = { title: "Student verifications", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TAB_LABEL: Record<(typeof ADMIN_TABS)[number], string> = {
  pending: "Pending requests",
  review: "Under review",
  info: "More information required",
  approved: "Approved",
  rejected: "Rejected",
  ended: "Expired / revoked",
  audit: "Audit history",
};

export default function AdminStudentVerificationsPage({ searchParams }: Props) {
  return (
    <AppPage label="student verifications">
      <Content searchParams={searchParams} />
    </AppPage>
  );
}

const Hidden = ({ id }: { id: string }) => <input type="hidden" name="requestId" value={id} />;

async function Content({ searchParams }: Props) {
  const { profile } = await requireAdmin();
  const params = await searchParams;
  const tab = parseAdminTab(first(params.tab));
  const requestId = first(params.request);
  const notice = first(params.notice);
  const error = first(params.error);

  const [list, audit, detail] = await Promise.all([
    tab === "audit" ? Promise.resolve([]) : listAdminRequests(tab),
    tab === "audit" ? listAudit() : Promise.resolve([]),
    requestId && UUID.test(requestId) ? getAdminDetail(requestId) : Promise.resolve(null),
  ]);

  return (
    <>
      <AppHeader member={profile} />
      <main id="main" className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-6">
        <div>
          <h1 className="text-2xl font-bold text-maroon-900">Student verifications</h1>
          <p className="mt-1 text-sm text-muted-foreground">Quebec student credentials. Approve only what the evidence supports.</p>
        </div>
        <AdminNav current="verification" />
        <AdminNotice />
        {error ? <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
        {notice ? <p role="status" className="rounded-xl border border-border bg-maroon-50 p-3 text-sm">{notice}</p> : null}

        <nav aria-label="Verification queues" className="flex flex-wrap gap-2">
          {ADMIN_TABS.map((k) => (
            <Link
              key={k}
              href={`/admin/student-verifications?tab=${k}`}
              aria-current={k === tab ? "page" : undefined}
              className={cn("rounded-full border px-3 py-1 text-sm", k === tab ? "border-maroon-600 bg-maroon-50 text-maroon-800" : "border-border text-muted-foreground")}
            >
              {TAB_LABEL[k]}
            </Link>
          ))}
        </nav>

        {tab === "audit" ? (
          <section aria-label="Audit history" className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <form action={runExpiry}><Button type="submit" variant="outline">Run expiry check now</Button></form>
              <form action={purgeDueEvidence}><Button type="submit" variant="outline">Delete evidence past its retention date</Button></form>
            </div>
            <ul className="divide-y divide-border rounded-xl border border-border bg-surface text-sm">
              {audit.length === 0 ? <li className="p-3 text-muted-foreground">Nothing recorded yet.</li> : null}
              {audit.map((a) => (
                <li key={a.id} className="p-3">
                  <span className="font-medium">{a.action}</span> · {a.target_type} {a.target_id?.slice(0, 8) ?? ""} · {a.created_at.slice(0, 16).replace("T", " ")}
                  <span className="block text-xs text-muted-foreground">actor {a.actor_id?.slice(0, 8) ?? "system"} {Object.keys(a.metadata).length ? JSON.stringify(a.metadata) : ""}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <section aria-label={TAB_LABEL[tab]}>
            {list.length === 0 ? <p className="text-sm text-muted-foreground">Nothing here.</p> : null}
            <ul className="divide-y divide-border rounded-xl border border-border bg-surface text-sm">
              {list.map((r) => (
                <li key={r.id} className="p-3">
                  <Link href={`/admin/student-verifications?tab=${tab}&request=${r.id}`} className="font-medium text-maroon-900 underline">
                    {[r.member?.first_name, r.member?.last_name].filter(Boolean).join(" ") || "Member"} · {r.institution?.name}
                  </Link>
                  <span className="block text-xs text-muted-foreground">
                    {r.requested_claim_type === "CURRENT_STUDENT" ? "Student" : `Program: ${r.program?.official_name ?? ""}`} · {text(METHOD_LABEL[r.method] ?? METHOD_LABEL.OFFICIAL_ATTESTATION_REVIEW, "en")} · {r.submitted_at?.slice(0, 10) ?? "not submitted"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {detail ? (
          <section aria-label="Request detail" className="space-y-5 rounded-2xl border border-border bg-surface p-5">
            <header>
              <h2 className="text-lg font-semibold text-maroon-900">
                {[detail.member?.first_name, detail.member?.last_name].filter(Boolean).join(" ")} (@{detail.member?.username ?? "?"})
              </h2>
              <p className="text-xs text-muted-foreground">Request {detail.request.id}</p>
              <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <div><dt className="inline text-muted-foreground">Institution: </dt><dd className="inline">{detail.request.institution?.name}</dd></div>
                <div><dt className="inline text-muted-foreground">Claimed: </dt><dd className="inline">{detail.request.requested_claim_type === "CURRENT_STUDENT" ? "Current student" : `Current program student, ${detail.request.program?.official_name}`}</dd></div>
                <div><dt className="inline text-muted-foreground">Method: </dt><dd className="inline">{text(METHOD_LABEL[detail.request.method] ?? METHOD_LABEL.OFFICIAL_ATTESTATION_REVIEW, "en")}</dd></div>
                <div><dt className="inline text-muted-foreground">Status: </dt><dd className="inline">{text(STATUS_LABEL[detail.request.status], "en")}</dd></div>
                <div><dt className="inline text-muted-foreground">School email: </dt><dd className="inline">{detail.request.email_verified_at ? `confirmed (${detail.request.email_domain}); ownership only` : "not confirmed"}</dd></div>
                <div><dt className="inline text-muted-foreground">Term: </dt><dd className="inline">{detail.details?.term_start ?? "?"} to {detail.details?.term_end ?? "unconfirmed"}</dd></div>
              </dl>
            </header>

            {detail.request.status === "SUBMITTED" ? (
              <form action={claimVerification}><Hidden id={detail.request.id} /><Button type="submit">Start review</Button></form>
            ) : null}

            <div>
              <h3 className="text-sm font-semibold text-maroon-900">Evidence</h3>
              <ul className="mt-2 space-y-2 text-sm">
                {detail.evidence.length === 0 ? <li className="text-muted-foreground">None (registrar confirmation needs no file).</li> : null}
                {detail.evidence.map((e) => (
                  <li key={e.id} className="rounded-lg border border-border p-3">
                    <p>
                      {e.private_storage_path ? `File ${e.mime_type ?? ""} ${e.size_bytes ? `${Math.round(e.size_bytes / 1024)} KB` : ""}` : `Reference (never opened by Medyra): ${e.source_reference}`}
                      {" · "}scan: {e.scan_status} · validation: {e.validation_status}
                    </p>
                    {detail.request.status === "UNDER_REVIEW" ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {e.private_storage_path ? (
                          <>
                            <form action={inspectEvidenceFile}><Hidden id={detail.request.id} /><input type="hidden" name="evidenceId" value={e.id} /><Button type="submit" size="sm" variant="outline">Inspect file</Button></form>
                            <form action={openEvidenceFile}><Hidden id={detail.request.id} /><input type="hidden" name="evidenceId" value={e.id} /><Button type="submit" size="sm" variant="outline">Open (60 s link)</Button></form>
                          </>
                        ) : null}
                        <form action={reviewEvidenceItem}><Hidden id={detail.request.id} /><input type="hidden" name="evidenceId" value={e.id} /><input type="hidden" name="status" value="validated" /><Button type="submit" size="sm">Mark validated</Button></form>
                        <form action={reviewEvidenceItem}><Hidden id={detail.request.id} /><input type="hidden" name="evidenceId" value={e.id} /><input type="hidden" name="status" value="rejected" /><Button type="submit" size="sm" variant="ghost">Reject item</Button></form>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>

            {detail.request.status === "UNDER_REVIEW" ? (
              <>
                <form action={saveChecks} className="space-y-3 rounded-xl border border-border p-4">
                  <Hidden id={detail.request.id} />
                  <h3 className="text-sm font-semibold text-maroon-900">Verification checklist</h3>
                  <label className="flex gap-2 text-sm"><input type="checkbox" name="issuerVerified" defaultChecked={detail.details?.issuer_verified} /> I validated the issuer and the document&apos;s authenticity (not appearance, logos, signatures or QR codes alone)</label>
                  <div><label htmlFor="issuerName" className={labelClass}>Issuer</label><input id="issuerName" name="issuerName" defaultValue={detail.details?.issuer_name ?? ""} maxLength={200} className={controlClass} /></div>
                  <div>
                    <label htmlFor="identityLinkage" className={labelClass}>Identity linkage (document holder is this member)</label>
                    <select id="identityLinkage" name="identityLinkage" defaultValue={detail.details?.identity_linkage ?? "unchecked"} className={controlClass}>
                      {["unchecked", "matched", "mismatch", "ambiguous"].map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="identifier" className={labelClass}>Identity reference from the document (hashed, never stored{detail.details?.binding_hash ? "; one is already recorded, leave blank to keep it" : ""})</label>
                    <input id="identifier" name="identifier" autoComplete="off" className={controlClass} />
                  </div>
                  <label className="flex gap-2 text-sm"><input type="checkbox" name="enrolmentConfirmed" defaultChecked={detail.details?.enrolment_confirmed} /> Current enrolment confirmed for the present term</label>
                  <label className="flex gap-2 text-sm"><input type="checkbox" name="programConfirmed" defaultChecked={detail.details?.program_confirmed} /> The exact program is confirmed by official evidence</label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div><label htmlFor="termStart" className={labelClass}>Term start</label><input id="termStart" name="termStart" type="date" defaultValue={detail.details?.term_start ?? ""} className={controlClass} /></div>
                    <div><label htmlFor="termEnd" className={labelClass}>Term end (leave blank if not confirmed)</label><input id="termEnd" name="termEnd" type="date" defaultValue={detail.details?.term_end ?? ""} className={controlClass} /></div>
                  </div>
                  <div>
                    <label htmlFor="registrarResult" className={labelClass}>Registrar / issuer validation result</label>
                    <select id="registrarResult" name="registrarResult" defaultValue={detail.details?.registrar_result ?? "not_requested"} className={controlClass}>
                      {["not_requested", "pending", "confirmed", "not_confirmed", "ambiguous"].map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                  <div><label htmlFor="notes" className={labelClass}>Reviewer notes (private; never sent to the member)</label><textarea id="notes" name="notes" rows={3} maxLength={2000} defaultValue={detail.details?.reviewer_notes ?? ""} className={textareaClass} /></div>
                  <Button type="submit">Save checklist</Button>
                </form>

                <form action={approveVerification} className="flex flex-wrap items-end gap-3 rounded-xl border border-border p-4">
                  <Hidden id={detail.request.id} />
                  <div>
                    <label htmlFor="claim" className={labelClass}>Approve as</label>
                    <select id="claim" name="claim" defaultValue="CURRENT_STUDENT" className={controlClass}>
                      <option value="CURRENT_STUDENT">Current student (general)</option>
                      {detail.request.requested_claim_type === "CURRENT_PROGRAM_STUDENT" ? <option value="CURRENT_PROGRAM_STUDENT">Current program student (needs program evidence)</option> : null}
                    </select>
                  </div>
                  <div><label htmlFor="expiresOn" className={labelClass}>Expire on (optional, earlier than policy)</label><input id="expiresOn" name="expiresOn" type="date" className={controlClass} /></div>
                  <Button type="submit">Approve supported claim</Button>
                </form>

                <div className="grid gap-4 sm:grid-cols-2">
                  <form action={requestMoreInformation} className="space-y-2 rounded-xl border border-border p-4">
                    <Hidden id={detail.request.id} />
                    <label htmlFor="message" className={labelClass}>Request more information (the member sees this note)</label>
                    <textarea id="message" name="message" rows={3} maxLength={500} required className={textareaClass} />
                    <Button type="submit" variant="outline">Request more information</Button>
                  </form>
                  <form action={rejectVerification} className="space-y-2 rounded-xl border border-border p-4">
                    <Hidden id={detail.request.id} />
                    <label htmlFor="reason" className={labelClass}>Reject: reason</label>
                    <select id="reason" name="reason" className={controlClass}>
                      {["not_current", "program_not_confirmed", "identity_mismatch", "unverifiable_document", "duplicate_identity", "wrong_institution", "other"].map((v) => <option key={v} value={v}>{text(REASON_LABEL[v], "en")}</option>)}
                    </select>
                    <label htmlFor="rejectMessage" className={labelClass}>Short note for the member (optional)</label>
                    <textarea id="rejectMessage" name="message" rows={2} maxLength={500} className={textareaClass} />
                    <Button type="submit" variant="destructive">Reject</Button>
                  </form>
                </div>
              </>
            ) : null}

            {detail.credentials.length > 0 ? (
              <div>
                <h3 className="text-sm font-semibold text-maroon-900">Credentials issued from this request</h3>
                <ul className="mt-2 space-y-2 text-sm">
                  {detail.credentials.map((c) => {
                    const active = !c.revoked_at && !c.expired_at && new Date(c.expires_at) > new Date();
                    return (
                      <li key={c.id} className="rounded-lg border border-border p-3">
                        <p>{c.claim_type} · verified {c.verified_at.slice(0, 10)} · expires {c.expires_at.slice(0, 10)} · {c.revoked_at ? "revoked" : c.expired_at ? "expired" : active ? "active" : "lapsed"}</p>
                        {!c.revoked_at && !c.expired_at ? (
                          <div className="mt-2 flex flex-wrap gap-3">
                            <form action={revokeCredential} className="flex items-end gap-2">
                              <Hidden id={detail.request.id} /><input type="hidden" name="credentialId" value={c.id} />
                              <select name="reason" aria-label="Revocation reason" className={controlClass}>
                                {["revoked_error", "revoked_fraud", "revoked_member_request", "identity_mismatch", "other"].map((v) => <option key={v} value={v}>{v}</option>)}
                              </select>
                              <Button type="submit" size="sm" variant="destructive">Revoke</Button>
                            </form>
                            <form action={setCredentialExpiry} className="flex items-end gap-2">
                              <Hidden id={detail.request.id} /><input type="hidden" name="credentialId" value={c.id} />
                              <input type="date" name="expiresOn" required aria-label="New expiry" className={controlClass} />
                              <Button type="submit" size="sm" variant="outline">Set expiry</Button>
                            </form>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            <div>
              <h3 className="text-sm font-semibold text-maroon-900">History</h3>
              <ol className="mt-2 space-y-1 text-xs text-muted-foreground">
                {detail.events.map((ev) => (
                  <li key={ev.id}>{ev.created_at.slice(0, 16).replace("T", " ")} · {ev.event}{ev.to_status ? ` → ${ev.to_status}` : ""}</li>
                ))}
              </ol>
            </div>
          </section>
        ) : null}
      </main>
    </>
  );
}
