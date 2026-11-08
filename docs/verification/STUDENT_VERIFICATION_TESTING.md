# Student verification: testing

## Automated

```bash
npx vitest run supabase/tests/student-verification.test.ts   # database policies and flows (PGlite)
npx vitest run src/features/student-verification             # inspection, hashing, actions, badge
npm run lint && npm run typecheck && npm test && npm run build
```

Mapping to the required scenarios:

| # | Scenario | Where |
| --- | --- | --- |
| 1 | New member is Not Verified | DB test "TEST 1", badge component test |
| 2 | School email alone gives no badge | DB test "TEST 2" |
| 3-4 | Evidence submitted and visible in the queue | DB test "TESTS 3-6" |
| 5-6 | Reviewer approves, member shows as Verified Student | DB test "TESTS 3-6" |
| 7 | No program evidence, no program credential | DB test "TESTS 7-8" |
| 8 | Confirmed program gives matching scope | DB test "TESTS 7-8" |
| 9 | Badge on profile, posts, comments | component test for the chip; wiring is in the feed, profile and network queries (see "Not run") |
| 10-11 | Expiry or revocation removes the badge at once | DB tests "TESTS 10-11", revocation |
| 12 | Cannot read another member's documents | DB tests (rows and Storage) |
| 13 | Cannot approve | DB test "TESTS 12-13", action tests |
| 14 | Conflicting requests | DB test "TEST 14", duplicate identity |
| 15 | Existing features still work | full suite (1,020 tests at the time of writing) |

## Fixtures

Ten fictional scenarios (valid enrolment, no program, email only, expired, historical, wrong program, name mismatch, duplicate identity, rejected evidence, revoked) are built inside the DB tests. For the dev project, `npm run seed:verification` (and `-- --clean`) applies the same ten, labelled `[DEV TEST DATA]`, to the fictional `seed+...@example.com` accounts. It refuses to run outside `SEED_ALLOWED_PROJECT_REF`, creates no document (the evidence is a plain fake text reference), and its rows are inserted directly, so they never pass through reviewers or real issuers. It has not been run.

## Manual walk-through (dev project, after applying the migration)

1. Make a reviewer: `insert into staff_roles (user_id, role) values ('<uuid>', 'admin');` and set `TWO_FACTOR_SECRET` and Resend.
2. As a member, open `/verification/student`, choose an institution, start a request, skip the email step, upload a small PDF (a fake one), accept consent, submit.
3. As the reviewer, open `/admin/student-verifications`, start review, Inspect file, Mark validated, fill the checklist (set an identity reference), Approve. Confirm the member's profile, posts and comments show the blue badge and its popover.
4. Set an expiry in the past with Set expiry (or SQL) and confirm the badge turns grey; revoke another and confirm the same.
5. Try as a third member: other people's `?request=` ids return a 404, and `/admin/student-verifications` returns a 404.

## Not run

Playwright is not installed in this repository, so no browser tests exist. The badge on profile, posts and comments was verified by type-checking, unit tests of the chip and the DB function, not in a browser. No test touches a live Supabase project, Storage, Resend, pg_cron, or any real institution or issuer. Nothing here shows that real institutional verification works.
