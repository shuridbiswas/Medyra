# 09 · Security, privacy and autonomous permission boundaries

No destructive or active security testing was performed. Secret values were not opened; only variable **names** were read.

## 1. Security architecture (observed in code)

| Area | Implementation | Status |
| --- | --- | --- |
| Authentication | Supabase Auth email/password, cookie sessions via `@supabase/ssr`; `src/proxy.ts` refreshes and redirects; every page/action re-checks with `requireUser/requireMember/requireAdmin` (`src/lib/auth/session.ts`) | Implemented, tested |
| Passwords | Managed by Supabase (min length 10, letters+digits in `supabase/config.toml` for local; hosted settings in dashboard) | Hosted settings unverified |
| MFA | App-level emailed 6-digit code; HMAC-signed HttpOnly cookies bound to user + Supabase `session_id`; DB-counted attempt limits (`two_factor_events`); `MFA_ENFORCEMENT` required/off; admin always needs it | Implemented; **not configured** (no secret/Resend) |
| Re-auth | `requireRecentAuth` (10 min) for export/deletion | Implemented |
| Authorization | RLS on every `public` table; column grants; writes for sensitive domains only through `security definer` RPCs that check `auth.uid()` / `private.is_admin()` and write audit rows in the same transaction; `private` schema not executable except whitelisted helpers | Implemented, PGlite-tested |
| Admin | `staff_roles` row created by SQL; `requireAdmin()` + confirmed 2FA; `/admin` returns 404 otherwise | Implemented |
| Input validation | zod in every server action; cursor/filter strings sanitised before PostgREST (`CURSOR_PATTERN`, `cleanText`) | Implemented |
| Rate limiting | Hard hourly limits in DB triggers/RPCs (posts, comments, reports, messages, forum, mentorship, community, 2FA); Upstash app limits fail-open | DB active; Upstash off |
| Uploads | Avatars/covers checked by real bytes and size; verification evidence in a private bucket, opened only after reviewer-triggered inspection; AV scan gate exists but no scanner | Partial |
| Secrets | `.env.local` (git-ignored); Netlify env per context; only the publishable Supabase key in the app; no service-role key anywhere; machine writer uses hashed `VERIFICATION_WRITER_KEY` | Implemented |
| Logging | No `console.*` in `src`; Sentry `scrubEvent` (no cookies/bodies/query strings/emails); `reportError(operation, dbCode)` only | Implemented |
| Headers | HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, noindex outside production (`next.config.ts`) | Implemented; **no CSP** |
| Privacy | Profile visibility/directory listing, DB-enforced detail visibility, export, deletion request + 30 days, consent records, retention policies, anonymous forum identity isolation, notifications without content | Implemented; retention not scheduled |
| Data retention / deletion | `retention_policies`, `private.run_retention_purge()`, `admin_execute_deletion`, evidence deletion functions | Not scheduled |
| Dependencies | 5 moderate `npm audit` advisories (2026-11-25) | Open |
| Legal | Drafts flagged for counsel (Law 25, French, minors) | Open |

## 2. Sensitive data and credentials present in the working environment

| Item | Where | Risk for autonomous agents |
| --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` (personal access token; account-level unless scoped) | `.env.local` | **Critical.** Gives Management API access (SQL, migrations, project settings) to every project the token covers. Used by `scripts/seed/{audit,migrate,wipe,reset}.ts`. `PRODUCTION_READINESS.md` blocker 1 says an earlier token was exposed and must be revoked; whether this is that token is unknown. |
| Supabase URL + publishable key | `.env.local` | Low (public by design), but grants member-level access to the dev DB |
| `VERIFICATION_SECRET` | `.env.local` | Medium: keyed hashes and SSO state derivation for verification |
| `SEED_ALLOWED_PROJECT_REF`, `SEED_KEEP_EMAILS` | `.env.local` | Low; `SEED_KEEP_EMAILS` may contain a real email (personal data) |
| Seed account passwords | `scripts/.seed-output/accounts.json` (git-ignored) | Medium: fictional accounts on dev |
| Claude credentials | `~/.claude/.credentials.json` | Not read; must stay out of agent tooling |
| Live dev data | 100 fictional members, but `SEED_KEEP_EMAILS` kept at least one real account (`TEST_DATA_REPORT.md`: "plus the kept account") | Real personal data may exist in dev |
| Production data | **None exists** (no production project) | Will change at launch |

## 3. Could agents reach production data or restricted infrastructure today?

- **Production database:** none exists, so no. But the Netlify site labelled `environment: production` talks to the **dev** project (`PRODUCTION_READINESS.md` §2), so dev data is what the public site serves.
- **Dev database:** yes, through `.env.local` (publishable key = member-level; PAT = owner-level SQL via Management API). Any agent with shell access in this folder can run `npm run db:migrate`, `db:reset:dev`, `seed:wipe`.
- **GitHub:** pushes from this machine use the owner's git credentials (pushes succeeded in earlier sessions); `gh` CLI is not installed. An agent with Bash can `git push` to `dev`.
- **Netlify:** no CLI or token locally; deploys happen automatically on push, so **a push is effectively a deploy** of whatever Netlify builds.
- **Claude connectors in the desktop app:** Google Drive, Perplexity, docs connector, Apify, browser and computer-use tools are available to sessions (account-level), unrelated to the project but usable by agents.

## 4. Recommended permission boundaries (recommendations, not current state)

| Boundary | Recommendation |
| --- | --- |
| Secrets | Agents never read `.env.local`, `~/.claude/.credentials.json`, `scripts/.seed-output/`; deny via `permissions.deny` Read rules and hooks. Provide CI secrets only to CI. |
| Supabase | Revoke the PAT; give automation a **scoped** token limited to the dev project, used only by CI/migration jobs; never a service-role key in the app (existing rule). |
| Database changes | Agents may write new migration files and run PGlite tests; applying to dev requires a gated job; applying to production requires human approval. Never edit applied migrations. |
| Destructive scripts | `db:reset:dev`, `seed:wipe`, `seed:clean` human-only. |
| Git | Agents work on feature branches/worktrees; no direct push to `dev`/`main`; merges through PRs with CI green; human approval for `main` (production). |
| Deploy | Previews autonomous; production promotion and DNS human-approved (matches `DEPLOYMENT.md` "explicit approval step"). |
| Legal/policy copy | Changes to legal pages, `DraftNotice`, safety/honest-limit statements, anonymity, verification wording require human review. |
| Security-critical code | `src/lib/auth/**`, `src/proxy.ts`, `private` schema functions, RLS policies, `forum_identity`, verification RPCs: mandatory independent security review agent + human sign-off. |
| External services | No new vendors, accounts, paid services or webhooks without approval. |
| Personal data | No exporting dev data to external tools (Sentry, Pinecone, ProductBridge already forbidden by `CLAUDE.md`). |
