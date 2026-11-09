# Data validation report (medyra-dev)

Run on 2026-11-08 after the reset (see DATABASE_RESET_REPORT.md) and the reseed (see TEST_DATA_REPORT.md).

## Automated results

| Check | Result |
| --- | --- |
| `npm run lint`, `npm run typecheck` | pass |
| `npm test` (unit, component and PGlite policy tests) | 1027 passed |
| Seed generator tests (enums, limits, determinism, language split, duplicates, module plan) | 47 passed |
| `npm run build` | passes |
| `npm run seed:verify` against medyra-dev | **62 of 62 passed** |

## What `seed:verify` proves on the live data

- Counts match the plan for every seeded table (accounts, profiles, education, experience, skills, posts incl. community posts, comments, likes, connections, follows, images) and for communities, forum questions, answers, replies, mentor profiles, mentorship requests, conversations, reports. Audit rows exist from the real staff functions; student verification fixtures exist.
- No orphans (comments, likes, posts, skills, connections, images) and no duplicate usernames; nothing is dated in the future.
- As two real seeded members: B reads A's posts but cannot edit, delete or publish as A, and cannot delete A's comment; A's post is unchanged afterwards.
- Incomplete profiles are hidden; a restricted profile's education is hidden from a non-connection.
- Anonymous access is blocked on profiles, posts, comments, likes, connections and follows.
- Pending connections are private; accepted ones are visible.
- **Anonymity:** every anonymous forum question has `author_id` NULL; `forum_identity` shows a member only their own rows.
- **Private communities:** a non-member sees none of a private community's posts.
- **Private messages:** a member sees exactly the messages of their own conversations.
- Pagination returns 15, 15, 15, 1 for the 46-post member, with no duplicates; search finds members with and without accents; the avatar loads as a PNG.

## Append-only tables and account deletion (found, fixed, re-tested)

The first `npm run db:reset:dry-run` with real audit rows failed:

```
ERROR 42501: audit_logs is append-only
  SQL statement "UPDATE ONLY public.audit_logs SET actor_id = NULL WHERE actor_id = ..."
```

`audit_logs.actor_id` is `ON DELETE SET NULL`, and `private.deny_audit_change()` had no exemption for that update (the community and verification logs do). Fixed with the forward migration `20261106000001_audit_log_account_deletion.sql` (the update is allowed only when it clears `actor_id` and changes nothing else; every other change and delete stays refused, the retention purge keeps its path). Covered by `supabase/tests/audit-log-deletion.test.ts` (252 policy tests pass). No trigger was disabled and no bypass was used. The migration is applied to medyra-dev.

After the fix: the dry run passes with real rows (audit entries kept with a null actor); the real `seed:clean` removed 100 accounts and 102 images (0 left over) and left the kept account intact.

## `seed:clean` round trip

Clean found rows that outlive their account: orphaned `conversations` and `messages` (41 and 189) and `data_requests` with a null user. `seed:clean` now removes them too, along with communities (`seed-` slugs), tagged reports and the verification fixtures. (That orphan cleanup was added after this clean ran, and the orphans were removed by hand that time, so the new code path has not been exercised end to end yet.) The full seed was then run again in one pass and `seed:verify` passed 62 of 62 again.

## Not done

- Review of the new modules in the real app (forums, communities, messages, mentorship, admin pages) on desktop and mobile. The earlier 50-member review covered feed, profiles, a long post and mobile layout.
- Playwright was not used; checks used the public APIs.
- The administrator sign-in flow (two-step code, `MFA_ENFORCEMENT=off` locally) was not exercised in a browser.
