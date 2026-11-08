# Medyra

**Connect. Learn. Grow. Belong.** | _More than a career. A community that cares._

Medyra is a professional and social network exclusively for the healthcare and social services ecosystem: students, recent graduates, professionals, educators, researchers, mentors, employers and organizations. This is a long-term startup product, not a demo.

## Product vision

Combines LinkedIn-style professional identity, Reddit-style communities and forums, student-to-professional mentorship, research and knowledge sharing, careers and internships, personal stories, local communities, and peer emotional support. Core belief: no one should navigate their education, career or personal challenges alone.

Audience: nursing, medicine, psychology, social work, pharmacy, physiotherapy, occupational therapy, speech-language pathology, audiology, public health and related disciplines, at every career stage.

### Product principles

- Trust first: verified professionals and employers, clear moderation, zero tolerance for harassment.
- Privacy by design: anonymous options, optional and coarse location, patient-confidentiality rules (de-identified cases only).
- Honest limits: community advice does not replace professional care; peer support is not therapy or crisis intervention; AI moderation is not guaranteed to catch everything. Say so in the UI.
- Success should inspire, not breed competition.

### Brand and design

Credible, modern, welcoming and elegant; professional without being cold. White and rose-tinted neutrals with a maroon primary (`maroon-50..900` tokens). Plus Jakarta Sans (headings) + Inter (body). Product-style UI cards (profile, strength ring, goals) in the manner of the reference mock. Avoid generic SaaS-landing aesthetics, heavy gradients, glassmorphism, large emojis, stock medical imagery, and copying any existing network's look. Illustrative UI must be labelled as illustrative, never presented as live activity.

## Stack

Next.js (App Router) 16, React 19, TypeScript strict, Tailwind CSS v4, shadcn/ui (base-nova style, Base UI primitives), Lucide icons, Supabase (auth, Postgres, storage) via @supabase/ssr, zod, Vitest + Testing Library + PGlite, ESLint. Vercel-compatible.

Note: this Next.js version has breaking changes. `AGENTS.md` points at the bundled docs in `node_modules/next/dist/docs/`; read the relevant guide before using an unfamiliar API. Known gotchas: `new Date()` in a prerendered component fails the build; `searchParams` is a Promise; use the global `LayoutProps<"/">` helper types.

## Architecture

```
src/
  app/                 Routes only: layouts, pages, metadata, SEO files
  components/
    ui/                shadcn primitives (do not hand-edit casually)
    layout/            Signed-in chrome (app-header = sidebar + top bar, app-frame, app-page, sidebar-nav, mobile-tab-bar), public header/footer, pagination, empty state
    brand/             Logo and wordmark
  features/<name>/     Feature-oriented code (landing now; auth, profiles, mentorship, etc. later)
  lib/
    site.ts            Site config, navigation and footer links
    supabase/          Browser, server and proxy Supabase clients, env, session-cookie policy
    auth/              Data access layer (requireUser...) and safe redirects
    utils.ts           cn()
```

Conventions:

- Server Components by default; add `"use client"` only for interaction (e.g. `mobile-nav.tsx`).
- Design tokens live in `src/app/globals.css` (`--ink`, `--canvas`, `--surface`, `--sand`, `--clay`, `--maroon-50..900`, mapped to shadcn variables). Use token classes (`text-maroon-900`, `bg-sand`), not raw hex, in components.
- shadcn components here use Base UI: compose links with `render={<Link href="..." />}`, not `asChild`.
- Keep copy and structured content in `features/<name>/content.ts`, not buried in JSX.
- Accessibility is a requirement: semantic landmarks, labelled sections, visible focus, 4.5:1 contrast, reduced-motion support.

## Coding standards

- TypeScript strict; no `any`. Prefer small readable components over speculative abstractions.
- Never invent credentials. Secrets only via `.env.local` (see `.env.example`); never commit real values.
- Before finishing work: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.

## Current scope: Phases 1 to 4b, 4A, 6, 7 and student verification (done)

Phase 1: public welcome page at `/welcome` and informative placeholders (`/about`, `/community-guidelines`, `/privacy`, `/terms`, `/contact`; the legal pages are placeholders, not real policies).

Phase 2: Supabase email/password auth and onboarding. Routes `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/auth/callback`, `/onboarding`, and the member home at `/` (the community feed, Phase 4).

Auth architecture (see README for setup and verification status):

- `src/proxy.ts` (Next 16's replacement for middleware) refreshes the session and redirects; it is not the only gate. Every private page/action calls `requireUser` / `requireMember` / `requireOnboardingPending` from `src/lib/auth/session.ts`.
- `src/lib/supabase/{client,server,proxy}.ts` are the only places that create Supabase clients. Only the publishable key is ever used; never add the secret/service_role key to the app.
- Server actions in `src/features/*/actions.ts` validate all input with zod (`schemas.ts`) before touching Supabase. Redirect targets go through `safeNextPath`.
- Pages that read cookies or `searchParams` render their dynamic part inside `<Suspense>` (Cache Components requirement).
- Database: `supabase/migrations/`. `profiles` holds only member-visible fields; private answers live in `onboarding_preferences`; email never leaves `auth.users`. Option lists in `src/features/onboarding/options.ts` must match the SQL CHECK constraints. `supabase/tests/rls.test.ts` runs the migrations in PGlite; update it when policies change.
- Keep the test mocks in `src/test/mocks.ts` in sync when changing Supabase calls. Untested against a live project until the README setup is done.

Phase 3: professional profiles. Routes `/profile/[username]` (tabs: Overview, Education, Experience, Skills & interests, Activity placeholder), `/profile/edit` (owner only), `/settings` (account, change password, privacy summary). The home page (`/`) and every signed-in page render `AppHeader` (fixed sidebar, top bar, bell) inside `AppFrame` (or `AppPage`, which adds Suspense).

Profile architecture:

- Code lives in `src/features/profile/`: `schemas.ts` (zod), `actions.ts` (server actions), `queries.ts` (read), `visibility.ts`, `format.ts`, `components/` (view) and `components/edit/` (forms).
- **Public vs private:** every `profiles` column and every row of `profile_education`, `profile_experience` and `profile_skills` is readable by any signed-in member once the owner finishes onboarding. Private data goes in owner-only tables (`onboarding_preferences`, a future `profile_settings`), never `profiles`. Email exists only in `auth.users`; `/settings` reads it from the session.
- `toPublicProfile()` in `visibility.ts` is the whitelist that shapes what reaches the UI. A new `profiles` column stays hidden until added there, and future per-field privacy settings plug in at that one spot.
- Location: `profiles.location_label` is a free-text general place the member chooses (city or region, max 80, optional); the UI shows it plus the country. No coordinates or addresses are ever stored. The onboarding `city` stays private.
- Skills, interests and mentorship areas share `profile_skills` (`kind`). Mentorship flags are self-reported; the UI says so. Do not add verification badges or credentials claims until a real verification process exists.
- Every profile action starts with `requireMember()`, scopes writes to the verified user id (never an id from the form) and relies on RLS as the second layer. Images are checked by real file bytes and size (photo 2 MB, cover 5 MB) and stored under `<user id>/<uuid>.<ext>` in the `avatars` / `covers` buckets.
- Reserved usernames (`edit`, `profile`, `settings`, ...) are enforced in the DB constraint and `RESERVED_USERNAMES`; keep both in sync when adding top-level routes.
- Tests: `supabase/tests/rls.test.ts` (migrations in PGlite), `src/features/profile/*.test.*`, `src/test/{mocks,db-mock}.ts` (recording Supabase doubles).

Routing: `/` is the default page. Signed-in members see the home feed there; everyone else is redirected to `/welcome` (the public welcome page, which is where `siteConfig` anchors like `/welcome#why` point). The old `/home` address redirects to `/` (next.config.ts, query string kept). The Medyra logo links to `/`, so it means "home" when signed in and "welcome" when not. `proxy.ts` handles the `/` redirect first; `src/app/page.tsx` re-checks on the server.

Phase 4: member home and community feed. `/` is a three-column app page (left: profile card + navigation; center: greeting, composer, category filters, feed; right: new members, fields to explore, active categories, self-reported mentors, planned features). Also `/search` (member search by name/username, field, or open-to-mentor) and informational placeholders `/communities`, `/mentorship`, `/careers`, `/saved`. The profile Activity tab lists the member's real posts.

Feed architecture:

- Code lives in `src/features/feed/`: `options.ts` (7 categories, limits), `schemas.ts` (zod, cursor pattern), `queries.ts` (reads), `actions.ts` (server actions), `types.ts`, `components/`. Home rails and nav config are in `src/features/home/`. Shared pieces: `components/layout/{app-header,user-menu,mobile-tab-bar}.tsx`, `components/member-avatar.tsx`, `components/relative-time.tsx`.
- Tables: `posts`, `post_likes` (primary key post+user), `post_comments` (migration `20261030000001`). Categories and length limits are CHECK constraints; keep `POST_CATEGORIES` in sync with `posts_category_valid`.
- **Ownership:** every action starts with `requireMember()`. Author ids come only from the verified session, never from a form or argument, and edits/deletes add `.eq("author_id", user.id)`. RLS enforces it again (insert needs `author_id = auth.uid()`; update/delete only own rows; no UPDATE grant on comments or likes; column grants stop changing author or timestamps). Zero affected rows is reported as an error, never as success.
- **Counts** are computed from rows (`post_likes(count)` embeds), never stored, so they cannot drift. Like/unlike is idempotent; the client updates optimistically and rolls back on failure, then shows the server's count.
- **Pagination** is keyset (`created_at desc, id desc`) with an opaque cursor `"<created_at>|<id>"`, validated by `CURSOR_PATTERN` before it is put in a PostgREST filter. The server renders page one; `FeedList` (client) loads older pages through `loadMorePosts`. `FeedSection` re-keys the list whenever page one changes so extra pages never go stale.
- Forms that can fail (composer, post edit) use **controlled** fields because React 19 resets uncontrolled forms after every submit, which would discard a member's text on error.
- DB abuse guards: 20 posts and 60 comments per author per rolling hour (trigger `private.enforce_feed_rate_limit`). These are spam limits, not moderation.
- Safety copy lives in `SafetyNotice` and `/community-guidelines`: no identifiable patient information, member posts are not medical advice, and verification and automated moderation are NOT active. Keep these statements true and update them when that changes. Reporting is not built; blocking exists (profile page, Settings).
- Right-rail data is real or empty: no fabricated members or engagement. Development test data comes only from `scripts/seed/` (`npm run seed:dev|seed:clean|seed:verify`): fictional members created through the Auth API, locked to the project in `SEED_ALLOWED_PROJECT_REF`, never run against production, passwords only in git-ignored `scripts/.seed-output/accounts.json`. Change `scripts/seed/plan.ts` / `content.ts` and keep `validatePlan` in sync with the database constraints.
- Tests: `supabase/tests/feed.test.ts` (policies in PGlite), `src/features/feed/{actions,queries,feed}.test.*`, `components/feed-components.test.tsx`, `src/components/layout/layout.test.tsx`.

Development environment: the repo is wired to a Supabase development project (`medyra-dev`) through git-ignored `.env.local`. Migrations were applied through the Management API and recorded in `supabase_migrations.schema_migrations`, so `supabase db push` will not re-run them. New migrations go in `supabase/migrations/` with a later timestamp; never edit an applied migration. Manual test procedure: `TESTING.md`. Email confirmation is OFF in the dev project only (dev convenience); `signUp` handles both cases (a returned session continues to `/onboarding`). Never put a secret or service_role key in the app or in chat.

The product was renamed from Medoras to Medyra. The wordmark, copy, cookie (`medyra-session-only`) and package name use Medyra; `medoras` stays a reserved username so nobody can impersonate the old name.

Phase 4b: professional network, saved posts, notifications (migration `20261101000001`). Routes `/network` (directory), `/network/requests`, `/network/connections`, `/saved`, `/notifications`, `/post/[id]`; `/search` redirects to `/network`. The profile and home pages were redesigned (see `src/features/profile/components/{profile-header,sections}.tsx`, `src/features/home/components/{hero-banner,right-sidebar}.tsx`).

Network architecture:

- Code lives in `src/features/{network,saved,notifications}/` (`schemas`, `queries`, `actions`, `components`). Every action starts with `requireMember()`, takes the acting member only from that session and filters by it (`requester_id`, `addressee_id`, `follower_id`, `recipient_id`...); RLS repeats the rules.
- **Connections:** one row per pair in either direction (unique index on `least/greatest`), `status` pending or accepted. Accept is the only update (addressee only); decline, withdraw and remove are deletes. Pending rows are visible only to the two people; accepted ones to members (counts, lists). **Follows** are separate and one-way. Counts come from rows.
- **Blocks** are private to the blocker. Policies call `private.has_block_between()` (security definer, answers only for pairs that include the caller); the `private` schema is otherwise not executable by `authenticated` (`revoke execute on all functions in schema private`: do the same after adding functions there). Blocking deletes connections, follows and related notifications by trigger. Actions never say a block is the reason something failed. Directory results hide members the viewer blocked; the reverse direction is enforced on writes only.
- **Notifications** are inserted only by triggers (no insert grant), carry type, actor and entity ids and **never text**, skip self and blocked pairs, and honour `notification_preferences.inapp_connections|inapp_comments`. UI sentences come from `notifications/format.ts`. "Reply" = a comment on a post you already commented on (there is no threading). Mentions and community/mentorship events exist in the schema only.
- **Saved items:** `saved_items(item_type, item_id)`, private, one per member and item; extend `saved_items_type_valid` and the insert policy for new types. Deleting a post removes its saves and notifications (trigger).
- **Verification:** the badge comes only from the student verification feature (see below); anyone without a valid credential shows "Not Verified". Do not add other badges (professional licences, employers) before a real process exists.
- **Column grants vs upsert:** owner columns are not updatable, and a PostgREST `upsert` writes them, so it is denied. Use `saveNotificationPreferences` (update, then insert) for owner-keyed rows such as `notification_preferences`.
- Tests: `supabase/tests/network.test.ts` (PGlite policies and triggers), `src/features/{network,saved,notifications}/*.test.*`, `src/features/network/components/network-components.test.tsx`. The dev project was also checked live with two accounts.

Phase 4A: production readiness, security and trust (migrations `20261102000001` and `20261102000002`; report in `PRODUCTION_READINESS.md`). Read it for what is verified and the remaining blockers.

Phase 4A architecture:

- **Two-step sign-in (emailed code):** `src/lib/auth/mfa.ts` (policy, pure), `src/lib/auth/two-factor.ts` (HMAC-signed cookies `medyra-2fa-c` challenge and `medyra-2fa` proof, tied to the member and the Supabase `session_id`; needs `TWO_FACTOR_SECRET` plus Resend) and the gates in `src/lib/auth/session.ts`. `requireUser/requireMember({ mfa })`: `"enforce"` (default) or `"skip"` (the code page). `MFA_ENFORCEMENT` = required (default) | off; tests run with `off` (`vitest.setup.ts`). If the step is not configured, members are not challenged (never a lockout) but `requireAdmin()` stays closed; it also needs a confirmed sign-in always. Reading the session id fails closed. Codes are never stored or returned to the browser. `requireRecentAuth/isRecentAuth`: a sign-in within 10 minutes, else `/reauth`. Suspended members go to `/suspended`.
- **Security features:** `src/features/security/`. `sendEmailCode` (cooldown 1 min, 5/hour) and `verifyEmailCode` (5 wrong per 15 min) log to `two_factor_events`, which a member can insert into but never change or delete, so limits cannot be reset. Wrong guesses are counted in the DB because the app acts as the member; the secret never reaches the browser. There are no authenticator apps and no recovery codes (the email account is the recovery path).
- **Safety and moderation:** `src/features/{safety,admin}/`. Reports are created only by `submit_report()`; staff actions only by `claim_report/moderate_report/set_member_status/decide_appeal` (security definer, check `private.is_admin()`, write `audit_logs` in the same transaction; `audit_logs` is append-only). `member_notices` (shown to the member) are separate from `moderation_actions` (internal). `private.is_member()` now excludes suspended members, so every policy using it blocks them. Blocking and suspension also gate posting, liking and commenting. Never claim automated or AI moderation.
- **Privacy:** `src/features/privacy/`, `src/lib/legal.ts` (`POLICY_VERSION` keeps "-draft" until a lawyer approves). `profiles.profile_visibility/directory_listed`; education, experience and skills visibility is enforced in the DB (`private.can_see_profile_details`), bio fields by `restrictToCard` in the app. Export is a POST-only route; deletion is request + 30 days + administrator (`admin_execute_deletion`); `retention_policies` and `private.run_retention_purge()` (not scheduled). The privacy/terms/guidelines pages carry `DraftNotice`; do not remove it, or assert compliance, without counsel's approval.
- **Guards:** `src/lib/api-protection.test.ts` lists every route handler and its protection (add new routes there); admin pages must call `requireAdmin()`; every non-auth `actions.ts` must call a session gate. After adding functions to the `private` schema, re-run `revoke execute on all functions in schema private` and re-grant only the policy helpers.
- **Tests:** `supabase/tests/{safety,security-privacy}.test.ts` (shared `helpers.ts` stubs Supabase's auth schema), `src/lib/auth/{mfa,two-factor,gates}.test.ts`, `src/features/{security,safety,admin,privacy}/*.test.*`.

Phase 6: communities, forums and educational second opinions (migration `20261103000001_communities_and_forums.sql`). Routes `/communities`, `/communities/create`, `/communities/[slug]`, `/communities/[slug]/members`, `/forums`, `/forums/ask`, `/forums/[id]`, `/forums/topics/[slug]`.

Communities architecture:

- Code in `src/features/communities/`. `communities` (kind, public or private, rules), `community_members` (owner / moderator / member), `community_requests`, `community_bans`, `community_announcements`, `community_audit_logs`. **Community posts reuse `posts`** with `posts.community_id`; the home feed and Following filter `community_id is null`. Policies on `posts`, `post_comments` and `post_likes` call `private.can_read_community / post_visible`, so a private community's posts, comments and likes are readable only by members.
- Public: any member reads and joins instantly. Private: name, description and rules are listed, everything inside is members-only, joining needs a moderator's approval. Creating is limited to 3 a day; the creator becomes owner by trigger.
- **Moderation is done only through security definer functions** (`decide_join_request, set_community_role, community_set_ban, community_remove_post, community_remove_comment`) that check the caller's role and write the append-only `community_audit_logs` (reasons from a fixed list, never content). Owner: roles, settings, removing moderators. Moderators: requests, removing members and posts, announcements. Platform administrators can read community logs and close a community through a report (`moderate_report` sets `archived_at`); nothing else is writable by clients. The comment-removal function exists but has no UI yet.
- `private.protect_community_audit` keeps the log append-only but lets account deletion null the actor and a community delete cascade.

Forums architecture ("Ask, Answer, Discover"):

- Code in `src/features/forums/`. Tables `forum_topics` (fixed list), `forum_questions`, `forum_answers`, `forum_replies`, `forum_votes` (helpful), `forum_follows`, and `forum_identity`. Saved questions and answers use `saved_items` (`forum_question`, `forum_answer`); notifications use types `forum_answer, forum_reply, forum_answer_accepted` and entity `forum_question`. Search is Postgres full text (`forum_questions.search`, config `simple`).
- **Anonymity (do not weaken):** an anonymous question, answer or reply has `author_id = NULL` and `is_anonymous = true` (a CHECK ties them together). The writer exists only in `forum_identity`, readable by that member alone, with no client insert, update or delete. Content is created only by `ask_question / post_answer / post_reply`, which write both rows in one transaction. Edit, delete and accept resolve the writer through `private.is_content_author`. Never add a query, embed, notification actor, export field or admin view that joins `forum_identity` for anyone but the member themself. Notifications about anonymous answers have `actor_id = null`.
- **Moderation of anonymous content:** `reports.target_member_id` stays NULL for anonymous content, so neither reporters nor the staff queue see the writer; `moderate_report` resolves the writer inside the function to warn, remove or suspend, and `moderation_actions.member_id` and the audit metadata stay empty for it. Limit to state honestly: staff can see that someone was suspended around the time of a decision.
- **Blocks hide, never refuse:** forum content by a blocked member (anonymous or not) is hidden by RLS in both directions (`private.content_author_blocked`), and answering hidden content fails exactly like answering content that does not exist, so a block can never confirm who an anonymous writer is.
- Education framing lives in `forums/content.ts` and `EducationalNotice`: not a clinical consultation, diagnosis or patient-specific second opinion; asking requires confirming the question has no identifiable patient information (`forum_questions.confirmed_deidentified`); reports reuse the `patient_privacy` reason. Author lines show the self-reported role plus the shared "Unverified" chip; anonymous writers show nothing. No verification badges exist.
- Limits: 5 questions, 30 answers and 60 replies an hour per member (counted on the private record, so anonymity does not bypass them).
- Tests: `supabase/tests/communities-forums.test.ts` (PGlite: private permissions, moderator roles, bans, audit, anonymity leakage sweep, blocks, voting, acceptance, reports and moderation of anonymous content), `src/features/communities/*.test.*`, `src/features/forums/*.test.*`. The `private.post_visible`-based policies changed one old behaviour: liking or commenting on a missing post is now refused by RLS (42501) instead of a foreign-key error.

Phase 7: private messaging and professional mentorship (migration `20261104000001_messaging_and_mentorship.sql`). Routes `/messages`, `/messages/[conversationId]`, `/mentorship`, `/mentorship/find`, `/mentorship/become-a-mentor`, `/mentorship/requests`, `/mentorship/my-mentorships`, `/mentorship/[mentorId]`.

Messaging architecture (`src/features/messaging/`):

- Tables `conversations` (direct or group), `conversation_participants` (status active / pending / declined / left, `last_read_at`), `messages`. **Clients cannot insert conversations or participants**: they come from `start_direct_conversation / create_group_conversation / add_group_member / respond_to_message_request / leave_conversation`. Messages are inserted directly under RLS (sender = session, active participant, `private.can_send_in_conversation`).
- Access is participant-only through `private.can_read_conversation`; staff and outsiders get nothing, and reporting a message (`submit_report('message', …)`, 300-character snapshot) is the only way staff see one. Admins remove a reported message through `moderate_report`.
- **Message requests:** a first message to a non-connection leaves the recipient `pending`; they read it, accept or decline. Until accepted the sender may send 2 messages (trigger `enforce_message_limits`) and the recipient cannot reply. Declined rows are invisible to the sender. Every refusal in `start_direct_conversation` uses the same sentence so a block or decline is never revealed. Blocks stop sending both ways (history stays readable). Groups are made only from the creator's connections (max 20).
- Unread = messages from others newer than `last_read_at`; the recipient's marker starts at the epoch (not now) so the first message counts. `Thread` refreshes from Supabase Realtime (`messages` is added to the `supabase_realtime` publication when it exists; RLS filters events) and polls every 15 s if Realtime is unavailable; it fails soft.
- Never describe messaging as end-to-end encrypted (`messaging/content.ts`). No push or email notifications for messages yet; only a request notification.

Mentorship architecture (`src/features/mentorship/`):

- Tables `mentor_profiles`, `mentor_availability` (internal weekly windows, no calendar integration), `mentorship_requests`, `mentorships`, `mentorship_feedback`. Expertise, experience and organisation are **self-declared**: the UI says so, every mentor shows the shared "Unverified" chip, and a mentor must tick an acknowledgement (`acknowledged` CHECK) that they are not listing as a clinical supervisor. Never add accreditation or verification wording without a real process. Students (by member type or career stage) cannot list (policy `private.can_list_as_mentor`).
- Flow: mentee request (goals 20-1500, 5 a day, one pending per pair, blocked pairs refused) → mentor `decide_mentorship_request` (capacity check, opens or reopens the direct conversation, notifies the mentee) → `set_mentorship_status` (only the mentor pauses/resumes; either finishes) → feedback (completed only, one each, private to the two people). Mentors and requests use the existing `mentorship_event` notification.
- Reports of a mentor listing use `submit_report('mentor', …)`; removal deletes the listing.
- Tests: `supabase/tests/messaging-mentorship.test.ts` (three accounts, blocks, unauthorized access, requests, groups, capacity, feedback privacy), `src/features/{messaging,mentorship}/*.test.*`. `h.reset()` in `supabase/tests/helpers.ts` must list new tables.

Student verification (Quebec students; migration `20261105000001_student_verification.sql`, docs in `docs/verification/`). Routes `/verification` (redirects), `/verification/student`, `/verification/student/status`, `/verification/student/history`, `/admin/student-verifications`.

- Code in `src/features/student-verification/` (`machine.ts` status machine mirroring `private.can_transition`, `evidence.ts` byte inspection, `crypto.ts` keyed hashes, `content.ts` EN/FR wording via `?lang=fr`, `queries.ts`, `actions.ts` member steps, `admin-actions.ts` reviewer steps). Two claims: `CURRENT_STUDENT` and `CURRENT_PROGRAM_STUDENT`.
- **Never** grant a badge from email ownership, an unvalidated upload, a pasted link, or a client-sent status. Requests and credentials change only inside the `security definer` functions (`approve_verification` locks the request, checks the whole checklist and writes event and audit rows in one transaction). Members have no write grants on these tables. Keep it that way.
- Badges: `getBadges()`/`withBadges()` call `verified_badges()` on every request (expiry and revocation evaluated in SQL, no caching); any failure means Not Verified. Render only through `components/verification-chip.tsx`. Anonymous forum content has no author object and must never get a badge.
- Evidence: private bucket `student-verification-evidence`; a file is openable only after the reviewer-triggered inspection (`static_ok`); `EVIDENCE_AV_REQUIRED=true` keeps files closed until an antivirus scan sets `av_clean` (not wired yet). Pasted share links are text and are never fetched. No evidence goes to Sentry, Pinecone, ProductBridge or logs.
- Email: `sendToAddress` (in `lib/email/send.ts`) is allowed only for the member's own address, a database-confirmed school domain, or the address `verification_notice_recipient()` returns to an administrator.
- Registry data (institutions, methods, programs) is edited in SQL by administrators. Email domains and programs are unconfirmed until a person checks an official source. No institution integration exists or is claimed.
- Dev fixtures: `npm run seed:verification` (labelled `[DEV TEST DATA]`, dev project only).
- Tests: `supabase/tests/student-verification.test.ts`, `src/features/student-verification/*.test.*`. `h.reset()` lists the new tables.

Out of scope until later phases: employer and job features, jobs, automated or AI moderation, post media, AI features, per-field privacy settings, username changes, organization profiles (follows are member-only), mentions.

## Infrastructure (Netlify, Sentry, Upstash, Resend, ProductBridge, Pinecone)

Read ARCHITECTURE.md for decisions and risks. Conventions:

- **Auth stays Supabase Auth.** Do not add Auth.js or a second session system without the documented migration plan and the owner's approval (ARCHITECTURE.md section 4).
- **Every external service is optional and fail-soft.** Missing variables turn the feature off; a service outage must never block sign-up, onboarding, reading the feed, or saving a post. `src/lib/services.ts` + `GET /api/health` report presence (booleans only).
- **Secrets:** server-only variables are never `NEXT_PUBLIC_`; never log or return them; `.env.example` is the one list of names. Never add the Supabase secret/service_role key.
- **Rate limits** (`src/lib/rate-limit.ts`, Upstash, per verified member id, fail-open) back the database's hard hourly limits. Add a policy there and call `checkRateLimit` at the top of any new write action.
- **Cache** (`src/lib/cache.ts`) is only for public, member-independent aggregates with a short TTL. Never cache per-member data, content or tokens.
- **Errors:** report unexpected server failures with `reportError(operation, error)` (operation name and DB error code only, never member content). Sentry events pass through `scrubEvent`; Session Replay stays off.
- **Email:** `sendToMember` (src/lib/email/send.ts) emails only the verified signed-in member. Auth emails belong to Supabase (via Resend SMTP); do not send them from app code.
- **ProductBridge** gets no member data (links only). **Pinecone** embeds structured profile tags only, never free text; always re-check results against PostgreSQL RLS (`searchProfileIds`).
- **Netlify:** `netlify.toml` + the official adapter; no static export. `NEXT_PUBLIC_APP_ENV` labels the deploy context. Previews use the dev Supabase project, never production.
- Supabase client creation calls `connection()` so Cache Components never prerenders time-dependent auth work.

## Roadmap

1. **Phase 2 (done):** Supabase auth, onboarding, profile basics, RLS from day one.
2. **Phase 3 (done):** Professional profiles.
3. **Phase 4 (done):** Member home page and community feed (posts, likes, comments, categories, search).
4. **Phase 4b (connections, follows, blocking, saved posts, notifications: done):** still to do: communities, reporting and moderation tooling.
5. **Phase 5:** Verification badges. (Forums and communities shipped in Phase 6; messaging and mentorship in Phase 7.)
6. **Phase 6:** Careers and employer profiles, articles/research, stories.
7. **Phase 7:** Nearby communities and events, mental-health and peer-support space with human + AI-assisted moderation, reporting/blocking/muting.

Open product questions: professional verification method, anonymity vs. safety design, launch regions (privacy law and crisis resources), handling of minors, MVP cut line.
