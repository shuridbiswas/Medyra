# 04 · Roadmap and backlog

## 1. Development history (from `git log`, 30 commits on `dev`, 2026-10-28 → 2026-11-18)

| Order | Phase (as named in `CLAUDE.md` "Current scope") | Key commits |
| --- | --- | --- |
| 1 | Phase 1 welcome page | `b5df3d7` |
| 2 | Phase 2 auth + onboarding | `5938702` |
| 3 | Phase 3 profiles | `47023fd` |
| 4 | Phase 4 home feed | `e4fc069` |
| 5 | Rebrand, infra integrations, Netlify | `6095b8f`, `f279f1d`, `428019b` |
| 6 | Phase 4b network/saved/notifications + redesign | `fe579bf` |
| 7 | Phase 4A security, safety, privacy, admin, legal drafts | `b3c5908` … `fca9d95`, `31a2cf8` |
| 8 | Phase 6 communities + forums | `2527b56` |
| 9 | Phase 7 messaging + mentorship | `1237100` |
| 10 | Student verification | `a56dc32` |
| 11 | 100-member Quebec seed, reset/audit tools | `96d48f4` |
| 12 | External provider layer, trusted writer, SheerID webhook | `cbba318`, `9071e66` |
| 13 | University SSO provisional affiliation, document analysis | `008e754` (HEAD) |

## 2. Roadmap as documented, and the conflict

`CLAUDE.md` "Roadmap" (unchanged since early phases):
1. Phase 2 done · 2. Phase 3 done · 3. Phase 4 done · 4. Phase 4b done ("still to do: communities, reporting and moderation tooling" — **both now built**) · 5. Phase 5: verification badges (student badges now built) · 6. **Phase 6: careers and employer profiles, articles/research, stories** · 7. **Phase 7: nearby communities and events, peer-support space with human + AI-assisted moderation, reporting/blocking/muting**.

**Conflict:** the shipped work was labelled Phase 6 (communities/forums) and Phase 7 (messaging/mentorship), reusing numbers the roadmap assigns to careers and events. Real status of the roadmap items:

| Roadmap item | Status |
| --- | --- |
| Communities, reporting, moderation tooling | Done |
| Verification badges | Student only (manual review); professional/employer verification not started |
| Careers, employer profiles | Not started (placeholder page) |
| Articles/research, stories | Not started |
| Nearby communities, events | Not started |
| Peer-support space, AI-assisted moderation | Not started |
| Reporting/blocking/muting | Done (Phase 4A/4b) |

**Current phase:** none formally declared. The latest work (2026-11-17/18) is the student-verification provider/SSO layer, which waits on external contracts. The next approved roadmap item by the documented order is **careers/employer profiles**, but launch-readiness blockers (§4) are unresolved and arguably precede it.

## 3. Epics and stories

No epics, user stories, tickets, labels or milestones exist in the repository or (as far as can be seen without GitHub access) as GitHub issues (`gh` CLI is not installed; GitHub was not queried). Requirements arrive as pasted "PHASE N" prompts in chat and are summarised into `CLAUDE.md`.

## 4. Known blockers (approved, from `PRODUCTION_READINESS.md` §6 and addenda, plus verification docs)

| # | Blocker | Source | Type | Human needed |
| --- | --- | --- | --- | --- |
| B1 | Revoke the exposed Supabase personal access token; use scoped tokens. **A `SUPABASE_ACCESS_TOKEN` is still present in `.env.local` (value not inspected).** Whether it is the old exposed one is unknown. | PR §6.1 | Security | Yes |
| B2 | Apply pending migrations to dev and verify live (Phase 4A ones were applied by 2026-11-09; `20261107000001`, `20261108000001` status unknown; `20261109000001` documented as not applied) | PR §6.2, `DATABASE_AUDIT.md`, `MONTREAL_STUDENT_SSO_ARCHITECTURE.md` | Ops | Yes |
| B3 | Email delivery (Resend verified domain) + `TWO_FACTOR_SECRET`; until then no 2FA and the admin area is closed | PR §6.3 | Ops | Yes |
| B4 | Separate production Supabase project | PR §6.4 | Infra | Yes |
| B5 | Legal review (Law 25, French, minors, data location), privacy officer, `PRIVACY_CONTACT_EMAIL` | PR §6.5 | Legal | Yes |
| B6 | Moderation operating process and staffing; crisis resources | PR §6.6 | Ops | Yes |
| B7 | Schedule retention purge, deletions, credential expiry, evidence deletion | PR §6.7 | Infra | Partly |
| B8 | Monitoring: Sentry DSN + alerts, uptime monitor, Upstash | PR §6.8 | Infra | Yes (accounts) |
| B9 | Content-Security-Policy | PR §6.9, `next.config.ts` | Security | No (code) |
| B10 | Backups / PITR and restore test | PR §6.10 | Infra | Yes |
| B11 | Invite-only launch controls | PR §6.11 | Product | Decision |
| B12 | Trigram search indexes | PR §6.12 | DB | No |
| B13 | State known limits to testers | PR §6.13 | Product | — |
| B14 | Independent penetration test | PR §6.14 | Security | Yes |
| B15 | Retention/disclosure policy for `forum_identity`; moderation staffing for patient-privacy reports; French text-search config | PR §2b | Legal/Product | Yes |
| B16 | Message retention, harassment/grooming safeguards, minors messaging adults | PR §2c | Legal/Product | Yes |
| B17 | Student verification: Law 25 PIA, AV scanning, AI/OCR vendor DPA, institution agreements, SheerID contract | `docs/verification/STUDENT_PRIVACY_SECURITY_CHECKLIST.md`, `INSTITUTION_*`, `SHEERID_CONNECTION_SETUP.md` | Legal/Vendor | Yes |
| B18 | No CI: nothing enforces lint/typecheck/test/build before deploy | this audit | Engineering | No |
| B19 | `main` branch unrelated to `dev`; Netlify production branch configuration unknown | this audit | Engineering | Decision |
| B20 | Live browser review of Phase 6/7 and verification modules not done | `DATA_VALIDATION_REPORT.md` "Not done" | QA | No |

## 5. Technical debt (observed)

Stale right-rail "upcoming" copy; hand-written DB types; unused Pinecone search; comment-removal RPC without UI; approximate unread counts; append-only junk rows in dev; `supabase/config.toml` never run; roadmap numbering; README "What is verified" cites 348 tests (now 1,145); 5 moderate `npm audit` advisories; Vitest isolation cost (~58 s full run).

## 6. Consolidated backlog

Distinguishes **[Approved]** (documented requirement or blocker) from **[Recommended]** (this audit's suggestion, not approved).

| Priority | Item | Tag | Notes |
| --- | --- | --- | --- |
| P0 | B1 revoke/scope Supabase token; keep it out of agent reach | Approved | Prerequisite for any autonomy |
| P0 | Add CI (lint, typecheck, test, build) on push/PR | Recommended | Gate for autonomous merges |
| P0 | Resolve `main` vs `dev` and Netlify production branch | Recommended | Needed for safe release flow |
| P0 | B2 apply/verify pending migrations on dev; regenerate `DATABASE_AUDIT.md` | Approved | |
| P1 | B3 email delivery + 2FA secret (opens admin area) | Approved | Human accounts |
| P1 | B20 browser/E2E review of Phase 6/7/verification (add Playwright) | Approved (review) / Recommended (Playwright) | |
| P1 | B9 CSP in Report-Only first | Approved | |
| P1 | B7 schedule maintenance jobs | Approved | |
| P1 | B8 monitoring + uptime | Approved | |
| P1 | Fix stale `UPCOMING_FEATURES` copy | Recommended | Honest-limits principle |
| P1 | Update roadmap numbering in `CLAUDE.md` | Recommended | |
| P2 | B4 production Supabase project; B10 backups | Approved | |
| P2 | B12 trigram indexes; accent-insensitive search | Approved | |
| P2 | Community comment-removal UI | Recommended (gap noted in CLAUDE.md) | |
| P2 | Generate DB types from schema | Recommended | |
| P2 | `npm audit` remediation | Recommended | |
| P2 | French localisation beyond verification | Recommended (Quebec market) | Decision needed |
| P3 | Careers/employer profiles (roadmap next) | Approved roadmap | After launch blockers |
| P3 | Articles/research, stories, events, peer support | Approved roadmap | |
| P3 | Email/push notifications for messages | Recommended | |
| P3 | Wire or remove Pinecone | Recommended | |
| Blocked | B5, B6, B11, B14-B17 | Approved | Human/legal/vendor |
