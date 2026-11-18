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

- Migration `20261107000001`: provider configs (all off), attempts, events, member/admin functions. Migration `20261108000001`: attempts belong to a request of the same member (composite FK, history kept), `PROVIDER_VERIFICATION` method (general claim only), trusted writer (`verification_writer_keys`, `ingest_provider_result`, `provider_attempt_context`), forward-only result ranking, `provider_result` evidence rows, `apply_provider_result_to_review`, and a trigger that keeps attempt state in step with the request.
- `src/features/verification/`: policy engine, SheerID adapter, simulator, trusted writer, webhook processor, queries, server actions, member and admin panels; route `/api/verification/providers/sheerid/webhook`.

## Design decisions

1. **Trusted writer without a service key.** The app keeps its rule of never holding a service_role key. The webhook uses the anonymous connection plus a separate writer key whose SHA-256 sits in `verification_writer_keys`; the two database functions it can call can only record a result on an existing attempt. They cannot approve anything.
2. **A provider result never issues a credential.** It becomes a pending evidence row. A reviewer may copy a strong result (strong link, validated issuer, subject hash, not expired, not a test result in production) into the checklist and then approves with the unchanged `approve_verification`. SheerID gives partial linkage only, so it always needs manual review.
3. Results only move an attempt forward (pending < review < success/rejected); duplicates are no-ops.

## Remaining gaps

- Controls were built but not clicked in a browser.
- No InAcademia, MyCreds, CAF or ID.me adapters; no provider router; no scheduled re-verification.
- SheerID details-response fields beyond `currentStep` are unconfirmed.
- Migrations are **not applied** to the development Supabase project (see the report); the webhook route was never called over HTTP.
- Anonymous writer functions have no lockout against key guessing (key is 32+ random characters).

## Next.js advisory

`next` 16.4.3 was affected by GHSA-mfr8-8qww-v76h and GHSA-vc7v-qv4w-wrv8 (moderate, `use cache` leaks, versions 16.2.0 to 16.4.4) and the production build stopped on it. Upgraded to 16.4.6 (exact pin, with `eslint-config-next`). Build, lint, typecheck and tests pass. `npm audit --omit=dev` still lists 11 other findings in other packages (not addressed).

## Gates before any provider is switched on

1. Written provider approval for a public renewable badge (see the vendor checklist in the research file); record answers, unknown = `NOT_CONFIRMED`.
2. Sandbox credentials; test with the provider's own test mode; set `contract_state = 'sandbox'`.
3. Security and privacy review, DPA, Law 25 assessment.
4. `contract_state = 'live'`, `environment = 'production'`, `VERIFICATION_LIVE_PROVIDERS_ENABLED=true`, provider env variables set in Netlify (never committed), explicit owner approval.

## Tests

- `supabase/tests/provider-verification.test.ts` (16): configs, member write denial, forged state jumps, other members, private columns, admin-only recording, idempotency, duplicate identity, expiry, no credential created.
- `src/features/verification/providers/providers.test.ts` (16): policy fail-closed cases (production vs simulated/sandbox, program claims, weak link, stale proof) and SheerID request shape, HMAC, normalizer.
- Provider journey/writer tests (22), webhook tests (10), earlier provider tests (32 combined with the above updates). Full suite: 1094 passing.
