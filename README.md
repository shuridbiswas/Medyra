# Medyra

**Connect. Learn. Grow. Belong.**

A professional and social network for the healthcare and social services community. See [CLAUDE.md](CLAUDE.md) for the product vision, architecture and roadmap.

**Status:** Phase 1 (welcome page), Phase 2 (authentication and onboarding) and Phase 3 (professional profiles) Phase 4 (member home and community feed) Phase 4b (network, saved posts, notifications) and Phase 4A (production readiness: MFA, reporting and moderation, privacy workflows, legal drafts) are implemented. See `PRODUCTION_READINESS.md` for what is verified and the remaining blockers. Phases 2 to 4 were verified with automated tests, a database security test and a production build. It was exercised against a real Supabase development project (see [What is verified](#what-is-verified)). Netlify deployment, Resend, Sentry, Upstash, ProductBridge and Pinecone are integrated in code but need your account credentials before they can be tested live.

## Requirements

- Node.js 20.19+ (24 LTS recommended) and npm
- A [Supabase](https://supabase.com) project (free tier is fine) for sign-up, sign-in and onboarding

## Quick start

```bash
npm install
cp .env.example .env.local   # then fill in the Supabase values (next section)
npm run dev
```

Open http://localhost:3000. Without Supabase values the welcome page works, and the auth pages clearly say authentication isn't configured instead of failing silently.

## Development project and manual testing

This repository is connected to a Supabase **development** project (`medyra-dev`, Canada Central). All four migrations in `supabase/migrations/` have been applied to it, row level security is on for all eight tables, and the `avatars` and `covers` storage buckets exist. `.env.local` (git-ignored) holds its URL and publishable key.

- Launch: `npm install` then `npm run dev`, and open http://localhost:3000.
- Follow **[TESTING.md](TESTING.md)** to create two accounts, post, like, comment, and confirm that one account cannot change the other's content.
- Dashboard-only settings (redirect URLs, email confirmation, password length) are listed in TESTING.md section 0. Email confirmation must be turned **off in development only** (the built-in mailer allows 2 emails per hour) and **on** before real users sign up.
- Never use the project's secret or `service_role` key in this app, and never paste it in chat. A Supabase personal access token (`sbp_...`) was used once to create the project and apply the migrations; revoke it in Account > Access Tokens when you no longer need it.

## Supabase setup (required for sign-up and sign-in)

1. **Create a project** at supabase.com.
2. **Env vars.** In Project Settings > API Keys copy the project URL and the **publishable** key into `.env.local` as `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Never use the secret or service_role key in this app.
3. **Database.** Apply **all** migrations in `supabase/migrations/` in order (four files; Phase 3 adds `20261029000001_profile_system.sql`, Phase 4 adds `20261030000001_posts_and_interactions.sql`). Either:
   - paste each file into the SQL Editor, oldest first, or
   - `npx supabase login`, `npx supabase link --project-ref <ref>`, then `npx supabase db push`.

   They create `profiles`, `onboarding_preferences`, the signup trigger, `profile_education`, `profile_experience`, `profile_skills`, `posts`, `post_likes`, `post_comments`, row level security, and the `avatars` and `covers` storage buckets with their policies.
4. **Authentication > URL Configuration.** Set Site URL to your site (`http://localhost:3000` locally) and add `http://localhost:3000/auth/callback` (and your production URL's `/auth/callback`) to Redirect URLs.
5. **Authentication > Sign In / Providers > Email.** Keep **Confirm email** enabled and set **minimum password length to 10 or less** (the app requires 10 characters, a letter and a number).
6. **Authentication > Email Templates.** Replace the **Confirm sign up** and **Reset password** templates with the HTML in `supabase/templates/confirmation.html` and `recovery.html`. They link to `/auth/callback?token_hash=…`, which lets verification work from any device. (The default templates also work, but only in the same browser that requested the email.)
7. **Email delivery.** Supabase's built-in sender is heavily rate limited. Configure your own SMTP provider before real users sign up.
8. **Restart** `npm run dev` after editing `.env.local`.

## How authentication works

```
Visitor -> /signup -> verification email -> /auth/callback -> /onboarding -> / (home)
Member  -> /login ------------------------------------------> / (home)
Signed in, onboarding unfinished: any private route -> /onboarding
```

- **Sessions** are Supabase cookies managed by `@supabase/ssr` (`src/lib/supabase`). "Keep me signed in" keeps the persistent cookie; unticked, the session ends when the browser closes.
- **Protection happens on the server twice.** `src/proxy.ts` refreshes and verifies the session (`getClaims`) and redirects; every private page and action then re-checks through `src/lib/auth/session.ts` (`requireUser`, `requireMember`, `requireOnboardingPending`), which asks the Auth server (`getUser`) and requires a verified email.
- **Open redirects** are blocked: `?next=` values pass through `safeNextPath`, which only allows `/` and internal paths under `/onboarding` and `/reset-password`.
- **No account enumeration:** sign-up for an existing email and password reset for unknown emails show the same screen as success; login uses one message for bad email or password.
- **Data:** `profiles` holds only fields other members may see (no email, no credentials; those live in Supabase's `auth.users`, which is never exposed). Private answers (purposes, city) live in `onboarding_preferences`, readable only by their owner. Row level security, column-level grants and CHECK constraints are in `supabase/migrations/`.

## Profiles (Phase 3)

- `/profile/<username>` shows a member's profile to other signed-in members: header with cover and photo, About, Education, Experience, Skills & interests, Mentorship preferences, and an Activity tab that will list posts once the feed exists.
- `/profile/edit` lets the owner edit everything (photos, details, About, mentorship, skills, education, experience) with validation, save/cancel and success or error messages.
- `/settings` shows the account email (private), changes the password, and summarizes what is visible to members.
- Profile photos (2 MB) and cover images (5 MB) must be real JPEG, PNG or WebP files; the server checks the file's bytes, not just its name.
- Only signed-in, onboarded members can view profiles, and only the owner can change one. Email addresses are never part of a profile. Location is optional and only a general place the member types (for example "Montreal, QC") is shown, with their country.
- Mentorship preferences, skills and interests are **self-reported**; Medyra does not verify credentials and shows no verification badges.
- Storage buckets are public-by-URL (unguessable per-upload file names); uploads and deletes are limited to the member's own folder.

## Security, safety and privacy (Phase 4A)

Migrations `20261102000001_safety_and_moderation.sql` and `20261102000002_account_security_and_privacy.sql`. **Apply them before deploying** (see `DEPLOYMENT.md`).

- **Two-step sign-in by email code:** after the password, each new sign-in is confirmed with a 6-digit code emailed to the member (`/mfa/verify`), plus password re-confirmation for sensitive changes and sign-out of other devices (`/settings/security`). Needs `TWO_FACTOR_SECRET` and email delivery (Resend); without them the step is skipped for members and the admin area stays closed. `MFA_ENFORCEMENT=off` is the emergency switch.
- **Safety:** report a post, comment or profile; mute; block (blocks also stop liking and commenting); suspended members see only their notice and an appeal form (`/suspended`).
- **Moderation** at `/admin`, `/admin/reports`, `/admin/users` (administrators only, always with a second factor; administrators are created in SQL). Decisions go through database functions that write an append-only audit log. **There is no automated or AI moderation.**
- **Privacy** at `/settings/privacy`: profile visibility, directory listing, data download, account deletion (30-day cooling-off), consent records, retention, privacy contact (`PRIVACY_CONTACT_EMAIL`).
- **Legal pages** (`/privacy`, `/terms`, `/community-guidelines`) are drafts marked for qualified legal review; they do not assert legal compliance.
- Observability and uptime: `OBSERVABILITY.md`.

## Network, saved posts and notifications (Phase 4b)

Migration `20261101000001_network.sql` adds `connections`, `follows`, `member_blocks`, `saved_items` and `notifications` (all with row level security) and two in-app notification preferences. Apply it like the others.

- **Layout.** Every signed-in page has a fixed sidebar on large screens (Home, Network, Communities, Mentorship, Saved, Profile; Careers and Settings below a divider; New Post), a top bar (search, notification bell with unread count, account menu) and a bottom tab bar on phones. Only Careers is marked "Soon".
- **`/network`** is the member directory: search by name, member type (students, professionals, researchers), field, mentorship interest, institution, country and city or region. Results are paginated (12 per page). Every card says "Unverified" because credentials are not verified yet. `/network/requests` lists requests you received and sent; `/network/connections` lists your connections with counts.
- **Connections** are mutual: send, accept, decline, withdraw and remove. One row per pair (a duplicate or crossed request is refused), no self requests, nothing between blocked members. **Following** is separate and one-way. Counts are computed from the rows and shown on profiles; a profile also lists a member's connections.
- **Blocking** (profile page, listed in Settings) ends any connection or follow in both directions and stops new ones. It is private: the blocked member is not told. There is still no reporting.
- **`/saved`** lists posts you bookmarked (bookmark button on every post). `saved_items` uses `item_type` + `item_id`, so questions, research and jobs can be added later by extending one constraint. **`/post/[id]`** opens a single post (the target of saved items and notifications). The home feed has Latest and Following views.
- **`/notifications`** (connection requests, accepted requests, comments, replies) with read/unread state, "mark all as read", dismiss, and in-app preferences in Settings. Notifications are written only by database triggers and never contain post or comment text. Mentions, community and mentorship events are in the schema but nothing creates them yet.

## Communities and forums (Phase 6)

Migration `20261103000001_communities_and_forums.sql`. **Apply it before deploying.** Needs no new environment variables.

- **Communities** (`/communities`, `/communities/create`, `/communities/[slug]`, `/communities/[slug]/members`): profession, institution, research, regional and interest groups; public (anyone joins) or private (listed, but posts and members are members-only; a moderator approves each request). Rules, announcements, owner and moderator roles, member removal, and a moderator log. Community posts use the normal post system, comments, likes and bookmarks.
- **Forums** (`/forums`, `/forums/ask`, `/forums/[id]`, `/forums/topics/[slug]`): questions, answers, replies, helpful votes, accepted answers, topic and kind filters, full-text search, following, saving, and an "Unverified" chip plus the self-reported role on each author. Framed as educational peer discussion, never as clinical consultation or a patient-specific second opinion; asking requires confirming no identifiable patient information.
- **Anonymous posting** for questions, answers and replies: other members, search, notifications and exports never show the writer. Medyra keeps a private record so the writer can edit or delete and so abuse can be handled; staff act on reported anonymous posts without being shown who wrote them. This is anonymity from members, not from Medyra; the UI says so.
- Reporting, blocking, muting and the admin queue are the existing ones, extended to forum content and communities. There is no automated or AI moderation.

## Messaging and mentorship (Phase 7)

Migration `20261104000001_messaging_and_mentorship.sql`. **Apply it before deploying**, after the Phase 6 migration. For live updates, Supabase Realtime must be enabled for the project (the migration adds `messages` to the `supabase_realtime` publication); without it the thread checks for new messages every 15 seconds.

- **Messages** (`/messages`, `/messages/[conversationId]`): one-to-one and group conversations, message requests from people you aren't connected with (read before you reply, decline privately), read/unread, search by name or message text, report and block, profile links, and a mobile-first layout. Groups are made from your connections. **Messages are private to the participants but not end-to-end encrypted**, and the UI says so.
- **Mentorship** (`/mentorship`, `/mentorship/find`, `/mentorship/become-a-mentor`, `/mentorship/requests`, `/mentorship/my-mentorships`, `/mentorship/[mentorId]`): non-students can list as mentors with self-declared expertise, experience, organisation, topics, languages, capacity, formats and weekly availability; mentees filter by profession, topic, language, experience and format, send a request with their goals, and track it. Accepting starts a mentorship and opens a conversation; mentors can pause, either person can finish, and feedback after completion is private to the two people.
- Mentors are shown as "Unverified" and their credentials as self-declared. Mentorship here is not clinical supervision or accredited training. Scheduling is an internal list of times: no calendar integrations.

## Home feed (Phase 4)

- `/` is the member home (the default page; visitors who are not signed in are redirected to `/welcome`, and the old `/home` address redirects to `/`). It shows: greeting, post composer, category filters (Latest plus seven categories), a newest-first feed, and side rails. On phones the navigation moves to a bottom tab bar with a one-tap Post shortcut and a More menu.
- Members can post text in one of seven categories (General Discussion, Academic Life, Career Journey, Professional Advice, Research and Knowledge, Personal Achievement, Questions), edit or delete their own posts, like and unlike, and comment (and delete their own comments). Authors link to their real profiles, and each profile's Activity tab lists that member's posts.
- Counts come from the database rows. The feed loads 15 posts at a time ("Load more posts").
- Member search lives in the Network directory (`/network`); the old `/search` address redirects there. It does not search posts, jobs or topics.
- The right rail shows only real data: newest members, fields to explore, categories with posts in the last 7 days, members who say they can mentor, and a list of planned features marked "not available yet". `/communities`, `/mentorship` and `/careers` are informational pages for features that are not built.
- Safety: the composer and feed remind members not to share identifiable patient information. The [community guidelines](/community-guidelines) say posts are member views, not verified medical advice, and that **identity verification and automated moderation are not active** and **there is no reporting** (blocking exists, see above).
- Spam guard: at most 20 posts and 60 comments per member per hour (database trigger).
- **Development test data (optional):** `npm run seed:dev` fills the dev project with about 30 fictional members, 150 posts, comments, likes and images, and `npm run seed:clean` removes it. Development only, locked to one project id. See [TESTING.md](TESTING.md#0b-fill-the-dev-project-with-fictional-test-data-optional).

## Infrastructure and integrations

Documents: [ARCHITECTURE.md](ARCHITECTURE.md) (decisions, data ownership, risks), [DEPLOYMENT.md](DEPLOYMENT.md) (Netlify), [DNS_SETUP.md](DNS_SETUP.md) (domain and Cloudflare), [EMAIL_SETUP.md](EMAIL_SETUP.md) (Resend, SPF/DKIM/DMARC), [TESTING.md](TESTING.md).

| Service | Role | Status |
| --- | --- | --- |
| Supabase (Auth, PostgreSQL, Storage) | Identity, data, images | In use; tested on the dev project |
| Netlify | Hosting (official Next.js adapter) | `netlify.toml` written; production build passes; **not yet deployed** |
| Cloudflare, Netlify registrar | DNS and domain | Documented only |
| Resend | Auth email (via Supabase SMTP) and app email (SDK) | Code tested with mocks; **needs your Resend key and verified domain** |
| ProductBridge | Feedback, roadmap, changelog at `/feedback` | Implemented using documented direct URLs; **needs your organization id** |
| Sentry | Error monitoring (scrubbed, no replay) | Implemented; **needs your DSN** |
| Upstash Redis | Rate limiting and 60 s shared cache (fails open) | Implemented, tested with mocks; **needs credentials** |
| Pinecone | Future semantic search | Foundation only, disabled, not wired into any feature |
| Auth.js | Considered | **Not adopted**: Supabase Auth is kept (reasons in ARCHITECTURE.md) |

Every service except Supabase is optional and quietly turns off when its variables are missing. `GET /api/health` shows which are configured (never values). Copy `.env.example` to `.env.local`; all variable names and where each belongs are documented there.

## Scripts

| Command             | Purpose                                      |
| ------------------- | -------------------------------------------- |
| `npm run dev`       | Start the dev server                         |
| `npm run build`     | Production build                             |
| `npm run start`     | Serve the production build                   |
| `npm run lint`      | ESLint                                       |
| `npm run typecheck` | TypeScript (strict) check                    |
| `npm test`          | Vitest: unit, component and database tests   |

## Routes

Public: `/welcome`, `/login`, `/signup`, `/forgot-password`, `/about`, `/community-guidelines`, `/privacy`, `/terms`, `/contact`, `/auth/callback` (email links).
Signed-in: `/onboarding`, `/reset-password` (from a recovery link), `/` (home), `/communities`, `/communities/create`, `/communities/[slug]`, `/communities/[slug]/members`, `/forums`, `/forums/ask`, `/forums/[id]`, `/forums/topics/[slug]`, `/messages`, `/messages/[conversationId]`, `/mentorship`, `/mentorship/find`, `/mentorship/become-a-mentor`, `/mentorship/requests`, `/mentorship/my-mentorships`, `/mentorship/[mentorId]`, `/network`, `/network/requests`, `/network/connections`, `/saved`, `/notifications`, `/post/[id]`, `/profile/[username]`, `/profile/edit`, `/settings`, `/feedback`, plus the informational page `/careers`. `/search` redirects to `/network`.

## What is verified

Automatically, by `npm test` (348 tests), `npm run lint`, `npm run typecheck` and `npm run build`:

- Registration, existing-email handling, weak passwords, rate limiting, missing configuration
- Login success, invalid credentials, unverified email, session-only option, safe redirects
- Email verification and recovery links (`/auth/callback`), including invalid/expired links and open-redirect attempts
- Password reset (session required, reuse, validation) and sign-out
- Proxy and server-side gates: unauthorized access, unverified email, onboarding redirects
- Onboarding validation, username conflicts, avatar content checks
- Profile creation and updates, owner-only edits, unauthorized-edit attempts, image upload checks, missing or malformed usernames, tab keyboard navigation, empty states, and that no email or verification badges render
- The feed: creating, editing and deleting posts, unauthorized edit and delete attempts (zero rows matched), forged author ids, likes (duplicate and unlike), comments (own-only delete), keyset pagination and cursor validation, optimistic like rollback, "Load more", failed saves keeping the member's text, the mobile tab bar and More menu, the account menu, profile links from posts, and protected routes
- The SQL migrations, run in an in-memory Postgres (PGlite) with stand-ins for Supabase's `auth` and `storage` schemas: constraints, unique usernames, row level security (own-row updates only, no email exposure, anonymous blocked), column grants, education/experience/skills rules and limits, and avatar and cover folder policies

**Verified live against the development project:** the four migrations apply cleanly in order; all eight tables have row level security; anonymous requests are refused on every table (including inserts); both storage buckets exist with the right size and type limits; the Supabase security advisor reports no findings; the app boots with the project's values, serves the Medyra pages and redirects signed-out visitors to `/login`. With two real accounts created through the Auth API (since deleted) the following were checked live: automatic profile creation, onboarding data, education/experience/skills, publishing and editing posts, likes (duplicates refused), comments, exact counts, author embeds, keyset pagination, persistence across a fresh login, private onboarding answers hidden from other members, and that a second account cannot edit, delete, impersonate or like/comment as the first; storage: own-folder uploads work, uploads to another member's folder, non-images and files over 2 MB are refused, and public image URLs load. Sign-up through the real UI form lands on `/onboarding`. The five-step onboarding wizard and image upload through the browser UI were not clicked through by hand.

**Not verified (needs signed-in test accounts in your Supabase project):** real email delivery and links, Supabase Auth's actual error codes and rate limits, cookie behaviour across a real browser session, posting, liking and commenting against a live project (PostgREST embedded counts and author embeds, real RLS evaluation), the storage upload path against live `avatars` and `covers` buckets (including the Supabase size and type limits), and the real RLS evaluation by PostgREST. After completing the setup above, walk through: sign up, receive and click the email, finish onboarding, sign out and in, reset the password. Run `npx supabase db advisors` (or the dashboard's Security Advisor) as well.

## Deploying

Deploy to Netlify by following [DEPLOYMENT.md](DEPLOYMENT.md). Do not attach a production domain until a preview deployment passes its checklist.

## Student verification through external providers

Off by default and never issues a credential on its own. See `docs/verification/SHEERID_CONNECTION_SETUP.md` for setup and `docs/verification/PROVIDER_INTEGRATION_TESTING.md` for what is tested, mocked and still needs credentials, vendor approval and security review. Migrations `20261107000001` and `20261108000001` must be applied to the development project first (`npm run db:migrate`).
