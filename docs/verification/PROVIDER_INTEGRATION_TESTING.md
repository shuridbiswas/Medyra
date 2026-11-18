# Provider integration: what is tested, mocked and still missing

Run: `npx vitest run supabase/tests/provider-verification.test.ts supabase/tests/provider-journey.test.ts src/features/verification`, then `npm run lint && npm run typecheck && npm test && npm run build`.

## Real vs simulated vs mocked

| Piece | How it is tested | Real? |
| --- | --- | --- |
| Migrations, RLS, functions, triggers | `supabase/tests/provider-*.test.ts` against the real SQL in PGlite | Real SQL, in-memory Postgres. **Not applied to the development Supabase project.** |
| Request -> attempt -> result -> evidence -> checklist -> `approve_verification` -> badge -> revoke | `provider-journey.test.ts` with the development simulator | Real database logic, **fictional simulated student** |
| Policy engine | `providers.test.ts` | Pure code |
| SheerID create / details / hosted URL | `providers.test.ts` with mocked `fetch` | **Mocked.** No call to SheerID was ever made |
| SheerID webhook | `sheerid-webhook.test.ts` with synthetic signed bodies and injected dependencies | **Synthetic.** The route compiles and is in the build, but was not called over HTTP |
| Trusted writer (`ingest_provider_result`) | `provider-journey.test.ts` as the anonymous role with a test key | Real SQL |
| Admin / member buttons | type-checked, built, and the underlying functions tested; **not clicked in a browser** | Not exercised |

## Scenarios covered

Invalid, missing, altered-body and wrong-secret signatures; unconfigured provider, live switch, secret or writer key (fail closed, 503); unknown or forged verification id (ignored, nothing fetched or written); id in the payload naming a user (ignored); another SheerID program (422); duplicate and retried deliveries; out-of-order events (a later pending or error never overwrites success; a success never overwrites a rejection); pending then review then success; one provider identity on two accounts; cancelled and expired attempts; a member recording a result, approving, reading someone else's attempt or the private subject hash; attempt owner differing from the request owner; attempt retries keeping history; withdrawal cancelling attempts; general student proof never giving a program credential; weak link, expired proof and production-labelled test proof refused when copying to the checklist; reviewer cannot review their own request; revoked credential turns the badge off and marks the attempt revoked; simulator and sandbox proof refused in production by policy, database and app.

## Not tested (and why)

Concurrent approvals (PGlite is single-connection; the existing `approve_verification` uses a row lock and an advisory lock and has its own tests); real SheerID responses, signatures and retries; Netlify runtime; the new controls in a browser (no Playwright); load.

## Still needs

- **Credentials:** SheerID program, OAuth token, webhook secret, writer key (see `SHEERID_CONNECTION_SETUP.md`).
- **Vendor approval:** SheerID, InAcademia, Parchment/MyCreds, CANARIE (none contacted).
- **Production security review:** privacy impact assessment (Law 25), DPA, counsel, brute-force and rate limiting of the anonymous writer functions (the key is long and random, but there is no lockout), review of the "SheerID details" field mapping against the real sandbox.
