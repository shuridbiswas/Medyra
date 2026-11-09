# Seeding the development database

A development-only tool in `scripts/seed/` fills the `medyra-dev` Supabase project with **fictional** Quebec test data, in French and English. It needs Node 22.18+ (it runs TypeScript directly). Read [TEST_ACCOUNTS.md](TEST_ACCOUNTS.md) for the personas and [TEST_DATA_REPORT.md](TEST_DATA_REPORT.md) for the numbers that were actually inserted.

## Safety rules (enforced in code, covered by tests)

- It refuses to run unless `NEXT_PUBLIC_SUPABASE_URL` is `https://<ref>.supabase.co` and `<ref>` **exactly equals** `SEED_ALLOWED_PROJECT_REF` (set in `.env.local`), and `NODE_ENV` is not `production` (`scripts/seed/safety.ts`).
- Accounts are created only through the supported Auth API (`signUp`; email confirmation is off in dev). It never inserts into `auth.users`. Emails are `seed+<slug>@example.com` (non-deliverable); no email, SMS or paid API is called.
- Profile data, images and sections are written **as each member** (row level security applies). Only backdated posts, comments, likes, connections, follows and profile ages use SQL through the Management API, with a project-scoped `SUPABASE_ACCESS_TOKEN` passed for the command only. The service-role key is never used.
- Passwords are random and exist only in the git-ignored `scripts/.seed-output/accounts.json`. They are never printed. Secrets, `accounts.json` and `.env.local` are never committed.
- Every person is fictional. Every bio ends with "(Profil fictif de test)" or "(Fictional test profile)". Real institutions and employers (universities, CEGEPs, hospitals, CISSS/CIUSSS) appear only as academic or geographic context. No licence numbers, employee IDs, real photos, clinical details, patient information, invented research results or stated admission or licensing rules.
- Optional: set `NEXT_PUBLIC_DEMO_DATA_BANNER=true` on a dev preview to show a "DEMO DATA" banner on every page.

## Commands

| Command | What it does |
| --- | --- |
| `npm run seed:dev -- --dry-run` | Validates the plan against the database constraints and prints it. Writes nothing, needs no token |
| `npm run seed:dev` | Creates the data. Safe to rerun: fixed ids and `on conflict do nothing`, existing accounts are reused |
| `npm run seed:verify` | Compares database counts with the plan; checks orphans, duplicates, permissions between two real accounts, hidden incomplete profiles, anonymous blocking, pagination and search |
| `npm run seed:clean` | Deletes **only** `seed+...@example.com` accounts (everything cascades) and their images. Accounts in the keep list survive |
| `npm run seed:login -- <username>` | Copies a seeded member's password to the clipboard without printing it |
| `npm run seed:wipe` | **Preview only.** Lists every account and the row counts per table |
| `npm run seed:wipe -- --confirm-wipe=<ref>` | Deletes every account **not** in `SEED_KEEP_EMAILS`, after you type `DELETE <ref>` in an interactive terminal |

`seed:wipe` deletes storage files through the Storage API first (only possible for accounts whose password the tool holds, i.e. seeded ones), then deletes the users; the foreign keys cascade to profiles, posts, likes, comments, education, experience, skills, preferences and network rows. It never truncates, drops tables, or touches migrations, auth config, buckets or policies. If `SEED_KEEP_EMAILS` is empty it stops and asks. Files of non-seeded accounts cannot be removed through the Storage API without that member's session; the preview reports how many exist.

## Database reset and audit tools

| Command | What it does |
| --- | --- |
| `npm run db:audit` | Read-only. Writes `DATABASE_AUDIT.md` from the live database and the repo migrations |
| `npm run db:backup` | Exports every public table to git-ignored `scripts/.backup/<UTC timestamp>/` and verifies row counts. A data export, not a restore guarantee |
| `npm run db:migrate` | Applies repo migrations the dev project has not recorded yet, in order |
| `npm run db:reset:dry-run` | Deletes every non-kept account inside a transaction, counts what is left, and rolls back |
| `npm run db:reset:dev -- --confirm-wipe=<ref>` | The real reset: needs the flag, an interactive terminal and the typed phrase `DELETE <ref>`. Writes `DATABASE_RESET_REPORT.md` |
| `npm run seed:dev -- --modules-only` | Resumes the community, forum, mentorship, messaging and moderation phase without signing 100 accounts in again |

The safety guard also refuses when `NEXT_PUBLIC_APP_ENV=production` or when the project ref is in `SEED_PROTECTED_PROJECT_REFS`.

## How modules are seeded

Where the schema forbids direct inserts the seeder calls the real functions (`ask_question`, `post_answer`, `post_reply`, `start_direct_conversation`, `create_group_conversation`, `respond_to_message_request`, `decide_mentorship_request`, `set_mentorship_status`, `submit_report`, `claim_report`, `moderate_report`, `decide_appeal`) with the acting member set through `request.jwt.claims` inside one transaction, then backdates the rows. The administrator is a row in `staff_roles`. Communities are tagged with the slug prefix `seed-`; reports with `[seed]`; verification fixtures with `[DEV TEST DATA]`; `seed:clean` removes those too.

Known limit: the append-only logs keep rows from interrupted runs, and account deletion currently fails once `audit_logs` holds a row for the account (see DATA_VALIDATION_REPORT.md).

## What the plan contains

- **100 members** (93 complete, 7 left at onboarding to test "hidden until onboarded"): 18 students, 17 working professionals, 5 educators, 5 researchers and 5 independent practitioners. Locations are general only (`Montréal, QC`, `Laval, QC`, ...): Montréal 22, Laval 6, Longueuil 5, Châteauguay 3, Brossard 3, Terrebonne 2, Repentigny 2, Saint-Jérôme 2, Vaudreuil-Dorion 2, Sherbrooke 1, Québec 2.
- Roles map to the real `member_type`, `fields` and `career_stage` values. Programs with no enum value (nutrition, respiratory therapy, medical laboratory technology, biomedical sciences) use field `other` and say what they are in the headline, qualification and experience.
- **300 posts** (70 questions) across all 7 categories, **600 comments**, **1500 likes**, **110 connections** (80 accepted) and **90 follows**, plus communities, forums, mentorship, messaging and moderation (see TEST_DATA_REPORT.md), spread over the last 120 days, comments and likes after their posts. About 70% of the text is French and 30% English, each written separately (not translated).
- Edge cases: accented and very long names, an empty bio, a 1000-character bio, a 3000-character post, 1000-character comments, posts containing `<`, `>`, `&`, quotes and emoji, edited posts, one member with 46 posts (pagination), members who never post, and accounts of different ages.

## Changing the data

- Edit people in `scripts/seed/people.ts`, text in `content-fr.ts` and `content-en.ts`, and the generator in `plan.ts`. `validatePlan` mirrors the database constraints; keep it in sync with new migrations.
- Tests (`scripts/seed/seed.test.ts`) check enums and limits, determinism, the language split (65/35 within 3 points), and fail on duplicate or near-duplicate (shared word trigram) posts and comments.
- After changing content: `npm run seed:clean`, then `npm run seed:dev`.

## Not supported by the schema (so not seeded)

Professional verification or badges, jobs, events, articles, and threaded comment replies (`post_comments` has no parent column: "threads" are simply many comments on one post). Mentorship is the profile flags plus `mentorship_area` skills; questions are posts in the `questions` category.
