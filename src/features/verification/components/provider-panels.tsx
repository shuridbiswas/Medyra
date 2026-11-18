import { Button } from "@/components/ui/button";
import { applyProviderResult, cancelProviderAttempt, checkProviderAttempt, startProviderVerification } from "@/features/verification/actions";
import { attemptEligibility, type ProviderAttemptRow } from "@/features/verification/queries";
import type { ProviderKey } from "@/features/verification/providers/types";

const OPEN = ["created", "redirected", "provider_pending"];
const LABEL: Record<ProviderKey, string> = {
  sheerid: "SheerID", simulated: "Development simulator (test only)", inacademia: "InAcademia", mycreds: "MyCreds", caf_saml: "CANARIE CAF", idme: "ID.me",
};
const when = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "never");

/** Member side. Renders nothing unless a provider is approved and switched on for this environment. */
export function MemberProviderPanel({
  providers, attempts, institutionId, requestId,
}: { providers: ProviderKey[]; attempts: ProviderAttemptRow[]; institutionId: string | null; requestId: string | null }) {
  if (providers.length === 0 && attempts.length === 0) return null;
  const open = attempts.find((a) => OPEN.includes(a.state));
  return (
    <section aria-labelledby="provider-heading" className="space-y-3 rounded-lg border bg-card p-4">
      <h2 id="provider-heading" className="text-base font-semibold text-maroon-900">Verify through an external provider</h2>
      <p className="text-sm text-muted-foreground">
        A provider can confirm that you are a current student. It does not prove your program, and a Medyra reviewer still
        decides before any badge appears. Medyra never asks for your school password.
      </p>
      {attempts.length > 0 ? (
        <ul className="space-y-2 text-sm">
          {attempts.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2">
              <span>
                {LABEL[a.provider]}: <strong>{a.state.replace("_", " ")}</strong>
                <span className="text-muted-foreground"> · last checked {when(a.last_checked_at)}</span>
                {a.provider === "simulated" ? <span className="ml-2 rounded bg-sand px-1.5 py-0.5 text-xs">TEST ONLY</span> : null}
              </span>
              {OPEN.includes(a.state) ? (
                <form action={cancelProviderAttempt}>
                  <input type="hidden" name="attemptId" value={a.id} />
                  <input type="hidden" name="requestId" value={requestId ?? ""} />
                  <Button type="submit" variant="outline" size="sm">Cancel</Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {!open && institutionId
        ? providers.map((p) => (
            <form key={p} action={startProviderVerification}>
              <input type="hidden" name="institutionId" value={institutionId} />
              <input type="hidden" name="provider" value={p} />
              <input type="hidden" name="requestId" value={requestId ?? ""} />
              <Button type="submit" variant="outline">
                {attempts.length > 0 ? "Try again with" : "Start with"} {LABEL[p]}
              </Button>
            </form>
          ))
        : null}
      {!open && !institutionId && providers.length > 0 ? (
        <p className="text-sm text-muted-foreground">Choose your institution first to start provider verification.</p>
      ) : null}
    </section>
  );
}

/** Reviewer side: linked attempts, what the policy says, and the two provider steps. */
export function AdminProviderPanel({
  requestId, status, attempts,
}: { requestId: string; status: string; attempts: ProviderAttemptRow[] }) {
  if (attempts.length === 0) return null;
  const anyReady = attempts.some((a) => attemptEligibility(a).eligible);
  return (
    <section aria-labelledby="admin-provider-heading" className="space-y-3 rounded-lg border p-4">
      <h3 id="admin-provider-heading" className="text-base font-semibold">Provider attempts</h3>
      <ul className="space-y-3 text-sm">
        {attempts.map((a) => {
          const { eligible, blockers } = attemptEligibility(a);
          return (
            <li key={a.id} className="space-y-1 rounded border p-2">
              <p>
                {LABEL[a.provider]} · <strong>{a.state}</strong> · scope: general student status only · link: {a.linkage ?? "n/a"} ·
                issuer validated: {a.issuer_validated === null ? "n/a" : String(a.issuer_validated)} · valid until {when(a.valid_until)} ·
                last checked {when(a.last_checked_at)}
              </p>
              <p className={eligible ? "text-green-800" : "text-muted-foreground"}>
                {eligible ? "Eligible: it can be copied into the checklist." : `Blocked: ${blockers.join(" ")}`}
              </p>
              {OPEN.includes(a.state) || a.state === "requires_review" ? (
                <form action={checkProviderAttempt} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="attemptId" value={a.id} />
                  <input type="hidden" name="requestId" value={requestId} />
                  {a.provider === "simulated" ? (
                    <select name="simulate" className="rounded border px-2 py-1" aria-label="Simulated outcome">
                      <option value="student">Simulate: current student</option>
                      <option value="no_link">Simulate: no account link</option>
                      <option value="member">Simulate: not a student</option>
                    </select>
                  ) : null}
                  <Button type="submit" variant="outline" size="sm">Check provider result</Button>
                </form>
              ) : null}
            </li>
          );
        })}
      </ul>
      {status === "UNDER_REVIEW" && anyReady ? (
        <form action={applyProviderResult}>
          <input type="hidden" name="requestId" value={requestId} />
          <Button type="submit">Copy eligible result into checklist</Button>
          <p className="mt-1 text-xs text-muted-foreground">This does not approve anything. Approval is a separate step below.</p>
        </form>
      ) : null}
    </section>
  );
}
