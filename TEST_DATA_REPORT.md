# Test data report (medyra-dev)

Generated from the live database after the reset and reseed on 2026-11-08. All people are fictional; real institutions and employers appear only as academic or geographic context. See [DATA_VALIDATION_REPORT.md](DATA_VALIDATION_REPORT.md) for what was verified and what is still open.

## What is in the database (live counts)

| Area | Table | Rows |
| --- | --- | ---: |
| Members | profiles (93 completed onboarding, 7 incomplete, plus the kept account) | 101 |
| | profile_education / profile_experience / profile_skills | 204 / 173 / 636 |
| | avatars and covers uploaded (Storage API) | 65 / 37 |
| Feed | posts (300 feed + 45 community posts) | 345 |
| | post_comments / post_likes | 600 / 1500 |
| | saved_items | 160 |
| Network | connections (80 accepted, 30 pending) / follows | 110 / 90 |
| | member_blocks / member_mutes | 3 / 3 |
| Forums | forum_questions / answers / replies | 120 / 172 / 99 |
| | forum_votes / forum_follows | 400 / 150 |
| Communities | communities (4 private) / members | 20 / 365 |
| | announcements / join requests / bans | 16 / 8 / 2 |
| Mentorship | mentor_profiles / availability windows | 16 / 32 |
| | requests (9 pending, 15 accepted, 6 declined) / mentorships / feedback | 30 / 15 / 4 |
| Messaging | conversations (23 direct, 3 groups, 15 from accepted mentorships) / messages | 41 / 189 |
| Safety | reports (4 open, 3 claimed, the rest decided) / member_notices / appeals | 15 / 5 / 1 |
| Verification | requests / credentials (dev fixtures) | 10 / 4 |
| Privacy | consent_records / data_requests (pending, not executed) | 279 / 2 |
| Notifications | created by the database triggers from the actions above | 3093 |

## Members

- **By role:** 38 students, 37 working professionals, 8 educators, 9 researchers, 8 independent practitioners.
- **By region (location_label, general only):** Montréal 50, Laval 12, Longueuil 10, Châteauguay 5, Brossard 5, Terrebonne 4, Saint-Jérôme 3, Vaudreuil-Dorion 3, Sherbrooke 3, Québec 3, Repentigny 2.
- **By language:** 72 French, 28 English. Posts: 210 French, 90 English (70/30). Comments: 420 / 180. Forum questions: 84 / 36.
- **Mentorship flags:** 12 open to mentor, 18 looking for a mentor. 16 mentor profiles (never students).
- **Privacy:** 6 profiles restricted to connections, 5 hidden from the directory.

## Feed

300 feed posts: Questions 70, and 38 or 39 in each of the other six categories. Includes one post of exactly 3000 characters, a 46-post heavy poster (pagination), posts with `<`, `>`, `&`, quotes and emoji, 8% edited posts, and members who never post.

## Forums

19 anonymous questions, 30 anonymous answers and 14 anonymous replies, all created through `ask_question`, `post_answer` and `post_reply`, so `author_id` is NULL and the writer exists only in `forum_identity`. 50 accepted answers.

## Not seeded (not built or out of scope)

Professional verification or badges (only the student credential feature exists), jobs and careers, events, articles, and push or email delivery. No call was made to Resend, Sentry, ProductBridge, Pinecone or Upstash.

## Known issues

- Interrupted runs left append-only rows that cannot be deleted: `moderation_actions` (31 in total) and `audit_logs` (72 in total, of which about 52 are from discarded attempts and have no actor). They are harmless but inflate the totals.
- Deleting accounts also writes 16 extra `community_audit_logs` rows (membership removals); they carry no actor.
- Feed, forum and community text reuse the same hand-written sentence pools in different combinations. Within each surface there are no duplicate or near-duplicate bodies; across surfaces some sentences repeat.
- 7 members are incomplete (not the 8 requested), 93 are complete.
- Member search is still plain `ilike` (not accent-insensitive); fixing it needs a schema change.
- Fixed during this work: `audit_logs` blocked account deletion (new migration `20261106000001_audit_log_account_deletion.sql`, applied to dev, covered by `supabase/tests/audit-log-deletion.test.ts`).
