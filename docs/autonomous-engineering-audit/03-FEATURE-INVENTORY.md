# 03 · Feature inventory

Status vocabulary: **CV** complete and verified (automated tests + a documented live check on the dev project) · **CU** complete but unverified live (automated tests only) · **P** partially implemented · **PH** placeholder · **PL** planned · **B** broken · **U** unknown.

"Live checks" refers to documented checks against the `medyra-dev` Supabase project (`README.md` "What is verified", `DATA_VALIDATION_REPORT.md`, `PRODUCTION_READINESS.md`). No feature has been exercised by real members or in production. Test counts below are per-area test files, not coverage percentages (no coverage tool is configured).

## A. Summary counts

| Status | Count | Features |
| --- | ---: | --- |
| CV | 9 | 1, 3, 4, 5, 8, 9, 10, 11, 14 |
| CU | 28 | 2, 6, 7, 12, 13, 15-23, 25-35, 41, 42, 45 (works; copy stale) |
| P | 7 | 24, 36, 37, 38, 39, 43, 44 |
| PH | 1 | 40 (Careers) |
| PL | 12 | §C |
| B | 0 observed | — (some stale copy, see 45) |
| **Total identified** | **57** (45 built or partial + 12 planned) | |

Completed (CV+CU) = 37. Incomplete (P+PH+PL) = 20.

## B. Built features

| # | Feature | Routes / entry points | Key code | Database | External deps | Status | Tests | Known issues / missing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Public welcome page | `/welcome` | `src/features/landing/` | — | — | CV | `src/app/*.test`, landing tests | Illustrative UI must stay labelled |
| 2 | Info and legal pages | `/about`, `/contact`, `/privacy`, `/terms`, `/community-guidelines` | `src/features/pages/`, `src/components/layout/draft-notice.tsx`, `src/lib/legal.ts` | — | — | CU | `src/app/legal-pages.test.tsx` | Drafts pending counsel (`POLICY_VERSION` "-draft") |
| 3 | Email/password auth | `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/auth/callback` | `src/features/auth/`, `src/lib/auth/`, `src/proxy.ts` | `auth.users`, `profiles` trigger | Supabase Auth (email delivery via Supabase/Resend SMTP) | CV (dev) | auth + proxy + redirect tests | Real email delivery not verified; email confirmation OFF in dev |
| 4 | Onboarding | `/onboarding` | `src/features/onboarding/` | `profiles`, `onboarding_preferences`, `consent_records` | Storage (avatars) | CV (dev) | onboarding tests | Browser wizard not clicked through by hand |
| 5 | Session protection and routing | `proxy.ts`, `/` → `/welcome`, `/home` → `/` | `src/proxy.ts`, `src/lib/auth/session.ts` | — | — | CV (Netlify, Oct 31) | `src/proxy.test.ts`, `gates.test.ts` | — |
| 6 | Two-step sign-in by emailed code | `/mfa/verify` | `src/lib/auth/{mfa,two-factor}.ts`, `src/features/security/` | `two_factor_events` | Resend, `TWO_FACTOR_SECRET` | CU | `two-factor.test.ts`, security tests | **Not configured anywhere** → step skipped for members, admin area closed |
| 7 | Re-auth, sign-out others/everywhere | `/reauth`, `/settings/security` | `src/features/security/` | — | Supabase Auth | CU | security tests | No device list (Supabase limitation) |
| 8 | Profiles (view/edit, education, experience, skills, images, completeness) | `/profile/[username]`, `/profile/edit` | `src/features/profile/` | `profiles`, `profile_education/_experience/_skills`, storage buckets | Supabase Storage | CV (dev) | profile tests, `rls.test.ts` | Username changes out of scope |
| 9 | Home feed: posts, edit, delete, likes, comments, categories, Latest/Following, keyset pagination | `/`, `/post/[id]` | `src/features/feed/`, `src/features/home/` | `posts`, `post_likes`, `post_comments` | — | CV (dev) | `feed.test.ts` (PGlite), feed action/query/component tests | No post media; ranking minimal |
| 10 | Member directory / search | `/network` (`/search` redirects) | `src/features/network/` | `profiles` (+ GIN on `fields`) | — | CV (dev) | network tests | `ilike` only, not accent-insensitive; trigram indexes needed |
| 11 | Connections and follows | `/network/requests`, `/network/connections`, profile buttons | `src/features/network/` | `connections`, `follows` | — | CV (dev, two accounts) | `network.test.ts` | — |
| 12 | Blocking | profile, Settings | `src/features/network/`, `safety` | `member_blocks`, `private.has_block_between` | — | CU | network + safety DB tests | Reverse direction enforced on writes only (by design) |
| 13 | Muting | profile, Settings | `src/features/safety/` | `member_mutes` | — | CU | safety tests | — |
| 14 | Saved items | `/saved` | `src/features/saved/` | `saved_items` (post, forum_question, forum_answer) | — | CV (dev) | saved tests | — |
| 15 | In-app notifications + preferences | `/notifications`, header bell | `src/features/notifications/` | `notifications` (trigger-only), `notification_preferences` | — | CU (seeded 3,093 rows) | notifications tests | No email/push delivery; mentions not created |
| 16 | Reporting (post, comment, profile, question, answer, reply, community, message, mentor) | Report buttons | `src/features/safety/` | `reports`, `submit_report()` | — | CU | safety DB + unit tests | No automated screening (by design) |
| 17 | Admin moderation: queue, decisions, users, appeals, deletions, retention, audit log | `/admin`, `/admin/reports`, `/admin/users` | `src/features/admin/` | `staff_roles`, `moderation_actions`, `audit_logs`, `member_notices` | needs 2FA configured | CU | `admin.test.ts`, safety DB tests | **Closed** until 2FA configured; first admin created by SQL; no staffing process |
| 18 | Suspension and appeals | `/suspended` | safety + admin | `member_status`, `appeals` | — | CU | safety tests | — |
| 19 | Profile privacy (visibility, directory listing) | `/settings/privacy` | `src/features/privacy/`, `profile/visibility.ts` | `private.can_see_profile_details` | — | CU | privacy tests | Bio visibility enforced in app, not DB |
| 20 | Data export | `POST /settings/privacy/export` | `src/features/privacy/export.ts` | `record_data_export` | — | CU | `privacy.test.ts` | Requires recent sign-in |
| 21 | Account deletion (request + 30 days + admin) | `/settings/privacy`, `/admin` | privacy + admin | `data_requests`, `admin_execute_deletion` | — | CU | security-privacy + audit-log-deletion DB tests | No automatic execution |
| 22 | Consent records | onboarding | `src/features/privacy/actions.ts` | `consent_records` | — | CU | privacy tests | Policy version still draft |
| 23 | Retention purge function | SQL only | `private.run_retention_purge()` | `retention_policies` | — | CU (function) | security-privacy DB tests | **Not scheduled** (see 24) |
| 24 | Scheduled maintenance (purge, credential expiry, evidence deletion) | — | `expire_student_credentials`, `due_evidence_deletions` | — | pg_cron or external | P | functions tested | No scheduler wired |
| 25 | Communities (public/private, requests, roles, bans, announcements, rules, audit log, community posts) | `/communities`, `/communities/create`, `/communities/[slug]`, `/communities/[slug]/members` | `src/features/communities/` | 6 community tables + `posts.community_id` | — | CU (seeded 20) | `communities-forums.test.ts`, community tests | Comment-removal UI missing; browser review not done |
| 26 | Forums (questions, answers, replies, helpful votes, accept, topics, full-text search, follow, save) | `/forums`, `/forums/ask`, `/forums/[id]`, `/forums/topics/[slug]` | `src/features/forums/` | 7 forum tables | — | CU (seeded 120 Q) | forums tests | — |
| 27 | Anonymous posting (forums) | forum forms | `forum_identity`, `ask_question/post_answer/post_reply` | — | — | CU | anonymity leakage sweep in PGlite | Pseudonymity only (stated in UI) |
| 28 | Educational second-opinion framing | forum pages | `src/features/forums/content.ts` | `confirmed_deidentified` | — | CU | component tests | Needs counsel review |
| 29 | Private messaging (direct, groups, requests, read state, search, report, block) | `/messages`, `/messages/[conversationId]` | `src/features/messaging/` | `conversations`, `conversation_participants`, `messages` | Supabase Realtime (optional; 15 s polling fallback) | CU (seeded 41 conv.) | `messaging-mentorship.test.ts`, messaging tests | Not E2E encrypted (stated); no email/push; Realtime never exercised live; approximate unread |
| 30 | Mentorship (listings, availability, find/filter, requests, accept/decline, pause/complete, private feedback) | `/mentorship/*` (6 routes) | `src/features/mentorship/` | 5 mentorship tables | — | CU (seeded 16 mentors) | mentorship tests | Capacity is stated, not live; no calendar |
| 31 | Student verification (manual reviewer workflow, evidence upload, checklist, credentials, expiry, revocation) | `/verification`, `/verification/student`, `/status`, `/history`, `/admin/student-verifications` | `src/features/student-verification/` | 14+ verification tables | Storage (private bucket), Resend (optional) | CU (dev fixtures) | `student-verification.test.ts`, feature tests | AV scan not wired (`EVIDENCE_AV_REQUIRED`); registry data unconfirmed |
| 32 | Verified student badge | everywhere via `VerificationChip` | `src/components/verification-chip.tsx`, `verified_badges()` | `student_verified_credentials` | — | CU | badge tests | Only student claims exist |
| 33 | Institutional email challenge step | verification flow | `create_email_challenge`, `verify_email_challenge` | `institutional_email_challenges` | Resend | CU | verification tests | Needs Resend; domains unconfirmed |
| 34 | External provider verification (SheerID adapter, simulator, trusted writer, webhook) | `/api/verification/providers/sheerid/webhook`, Settings | `src/features/verification/{providers,server}` | `verification_provider_*`, `verification_attempts`, `verification_writer_keys` | SheerID (no contract) | CU (simulator only) | `provider-verification.test.ts`, `provider-journey.test.ts` | Off by default; awaiting contract |
| 35 | University SSO provisional affiliation (OIDC) + document-program analysis | `/api/verification/student/return` | `src/features/verification/{sso,documents}` | `institution_sso_*`, `document_program_analysis` | University IdPs (none approved), AI/OCR (none) | CU (simulator only) | `student-sso.test.ts`, `sso.test.ts`, `documents.test.ts` | Migration `20261109000001` reportedly **not applied** to dev |
| 36 | Rate limiting (app layer) | all write actions | `src/lib/rate-limit.ts` | DB hard limits active | Upstash | P | `redis-features.test.ts` | App layer off (no Upstash) |
| 37 | Error reporting | `src/instrumentation*.ts`, `reportError` | `src/lib/monitoring/` | — | Sentry | P | `infra.test.ts` | No DSN |
| 38 | Semantic member search | — | `src/lib/pinecone/` | — | Pinecone | P | `pinecone.test.ts` | Not called by any page |
| 39 | Health endpoint / service presence | `GET /api/health` | `src/lib/services.ts` | — | — | P (CV Oct 31 on Netlify; new flags since) | `infra.test.ts` | — |
| 40 | Careers | `/careers` | `ModulePage` | — | — | PH | layout tests | Planned feature |
| 41 | Settings (account, password, notification prefs, security, privacy, verification) | `/settings`, `/settings/*` | `src/features/settings/` | various | — | CU | settings tests | — |
| 42 | Feedback links | `/feedback` | `src/features/feedback/` | — | ProductBridge (links only) | CU | feedback tests | Off without org id |
| 43 | Dev seed / reset / audit tooling | `npm run seed:*`, `db:*` | `scripts/seed/` | all | Supabase Auth API + Management API (PAT) | P (CV for seed; orphan cleanup path not exercised) | `scripts/seed/seed.test.ts` | Uses a personal access token from `.env.local` |
| 44 | French localisation | `?lang=fr` (verification only) | `student-verification/content.ts` | — | — | P | — | Rest of UI English only |
| 45 | Home right rail "Planned features" | `/` | `src/features/home/content.ts` `UPCOMING_FEATURES` | — | — | **Stale** | — | Still lists Communities and Mentorship as upcoming although built |

## C. Planned features (documented intent, no code)

| # | Feature | Source | Depends on |
| --- | --- | --- | --- |
| P1 | Careers, internships, jobs | `CLAUDE.md` roadmap, `FUTURE_MODULES.careers` | Employer profiles, employer verification |
| P2 | Employer / organisation profiles | `CLAUDE.md` | Org verification |
| P3 | Professional licence / employer verification badges | `CLAUDE.md` (Phase 5), open question | Verification method decision |
| P4 | Articles / research sharing | `CLAUDE.md` roadmap | — |
| P5 | Personal stories | `CLAUDE.md` roadmap | — |
| P6 | Nearby communities and events | `CLAUDE.md` roadmap | — |
| P7 | Mental-health / peer-support space with human + AI-assisted moderation | `CLAUDE.md` roadmap | Moderation staffing, crisis resources |
| P8 | Automated / AI moderation | out-of-scope list | Vendor, policy |
| P9 | Post media (images/attachments) | out-of-scope list | Storage, scanning |
| P10 | Mentions | schema has `mention` notification type, nothing creates it | — |
| P11 | Email/push notifications for messages and activity | Phase 7 limits | Resend, push service |
| P12 | Per-field privacy settings; username changes | out-of-scope list | — |

## D. Mock data, placeholders, disabled functionality

- **Seed data:** 100 fictional Quebec members and content across every module, created only through `scripts/seed/` and locked to `SEED_ALLOWED_PROJECT_REF`; passwords in git-ignored `scripts/.seed-output/accounts.json`; dev verification fixtures labelled `[DEV TEST DATA]` (`npm run seed:verification`).
- **Simulators:** SheerID simulator (`providers/simulated.ts`, "TEST ONLY"), mock IdP (`sso/mock-idp.ts`).
- **Disabled by configuration:** 2FA, admin area, Upstash, Sentry, Resend, Pinecone, ProductBridge, SheerID (`SHEERID_ENABLED`, `VERIFICATION_LIVE_PROVIDERS_ENABLED`), AV gate (`EVIDENCE_AV_REQUIRED`).
- **Placeholder:** `/careers`. `FUTURE_MODULES.communities/mentorship` content is now dead copy.
- **No TODO/FIXME comments** were found in `src`, `scripts` or `supabase`.
