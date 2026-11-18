# External student-verification providers: status, design and gates

Research basis: `Medyra_Existing_Student_Verification_Providers_Integration.md` (checked 2026-11-17). No vendor has been contacted, no contract or credential exists, and nothing here has run against a live provider.

## Provider status

| Provider | Status | What exists in the repo |
| --- | --- | --- |
| SheerID | `ADAPTER_IMPLEMENTED` (unit-tested with mocked HTTP; `AWAITING_CONTRACT`) | create session, hosted URL, details fetch, HMAC check helper, normalizer |
| Simulator | `SANDBOX_TESTED` (development only) | fixtures; refused in production by the app, the policy and a DB constraint |
| InAcademia | `RESEARCHED_ONLY` | row in `verification_provider_configs`; no OIDC adapter (needs provider-issued discovery and claim docs) |
| MyCreds / Parchment | `RESEARCHED_ONLY` | the existing reviewer workflow (`ISSUER_BACKED_DOCUMENT_SHARE`) is the manual path; no receiver API |
| CANARIE CAF | `RESEARCHED_ONLY` | config row only |
| ID.me | `RESEARCHED_ONLY` | config row only |

## What was built

- Migration `20261107000001_provider_verification.sql`: `verification_provider_configs` (all real providers off, cannot be enabled without a `sandbox`/`live` state, simulator development-only), `verification_attempts`, `verification_provider_events`, and three functions.
- `src/features/verification/providers/`: provider-neutral types, `policy.ts` (fails closed), `sheerid.ts`, `simulated.ts`.
- `src/features/verification/actions.ts`: `beginProviderAttempt` (member) and `confirmProviderAttempt` (administrator).

## Design decisions (and why they differ from the spec)

1. **No service key, so no trusted webhook writer.** Medyra's rule is that the app only ever acts as the signed-in member. A member can call any function the app can, so a function that records "the provider said yes" would be forgeable. Therefore a provider result is recorded only by `record_provider_result`, which requires an administrator, after that administrator's action re-fetched the result from the provider. A SheerID webhook route was **not** added: it could not write anything safely and would be an extra unauthenticated endpoint. `verifySheerIdSignature` is ready if a trusted writer is added later.
2. **Never issues a credential.** The result states are `proof_received`, `requires_review`, `rejected`, `provider_error`. Issuing the badge stays with the existing `approve_verification` reviewer flow. This also fits the spec's own rule that a general student result without a strong account link must not silently grant a high-assurance badge: SheerID results are always `partial` linkage.
3. **Subject hash in the attempts row** (unique per provider, only for live states) replaces a separate bindings table. It is not readable by members.
4. The existing request/credential/badge tables are reused; no parallel credential table was created.

## Not built (honest list)

- No UI: nothing calls the two actions yet, and the admin page has no "check provider result" button.
- No InAcademia/CAF/ID.me/MyCreds adapters, no provider router, no `/api/verification/*` routes, no scheduled re-verification, no circuit breaker.
- Linking an attempt to a `student_verification_requests` row, so an approval cites the provider result, is not done.
- Privacy impact assessment and counsel review are still required before real students.

## Gates before any provider is switched on

1. Written provider approval for a public renewable badge (see the vendor checklist in the research file); record answers, unknown = `NOT_CONFIRMED`.
2. Sandbox credentials; test with the provider's own test mode; set `contract_state = 'sandbox'`.
3. Security and privacy review, DPA, Law 25 assessment.
4. `contract_state = 'live'`, `environment = 'production'`, `VERIFICATION_LIVE_PROVIDERS_ENABLED=true`, provider env variables set in Netlify (never committed), explicit owner approval.

## Tests

- `supabase/tests/provider-verification.test.ts` (16): configs, member write denial, forged state jumps, other members, private columns, admin-only recording, idempotency, duplicate identity, expiry, no credential created.
- `src/features/verification/providers/providers.test.ts` (16): policy fail-closed cases (production vs simulated/sandbox, program claims, weak link, stale proof) and SheerID request shape, HMAC, normalizer.
- Full suite: 1061 passing; lint and typecheck clean.
