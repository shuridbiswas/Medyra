---
name: medyra-db-migration
description: "Write and verify a new Supabase migration for Medyra safely: ordering, immutability, private-schema grants, security-definer checks, audit logging, types, PGlite harness, cross-user tests and a recovery plan. Mandatory for any change under supabase/."
---

# medyra-db-migration

## Purpose and triggers
Write and verify a new Supabase migration for Medyra safely: ordering, immutability, private-schema grants, security-definer checks, audit logging, types, PGlite harness, cross-user tests and a recovery plan. Mandatory for any change under supabase/.

**Agents:** medyra-database-engineer

**Required inputs:** Schema need from the brief; current supabase/migrations/ and engineering/migrations.lock.json.

## Workflow
1. Name the file `YYYYMMDDHHMMSS_<snake_name>.sql` with a timestamp later than every existing migration.
2. Never modify a committed migration; the lock in engineering/migrations.lock.json fails CI if you do.
3. Enable RLS on new tables; revoke all from anon/authenticated, then grant only needed columns; policies use `(select auth.uid())` and `TO authenticated` with ownership predicates; UPDATE policies have USING and WITH CHECK.
4. Privileged writes go in `security definer` functions with `set search_path = ''` that check `auth.uid()` / `private.is_admin()` first and write audit rows in the same transaction.
5. After adding private functions: `revoke execute on all functions in schema private from public, anon, authenticated;` then re-grant ONLY the policy helpers (copy the full list from the latest migration).
6. If you re-create a shared function (submit_report, moderate_report), start from its latest definition, not an older one.
7. Update src/lib/supabase/database.types.ts and add the new tables to `h.reset()` in supabase/tests/helpers.ts.
8. Add PGlite tests: owner can, other member cannot, anonymous visitor cannot, admin-only paths, blocked members, and that a fresh database builds from all migrations.
9. Classify destructive operations; a destructive statement needs `-- medyra:destructive-approved <TASK-ID>` and an owner approval.
10. `npm run eng:migrations -- --record` to lock the new file in the same change.
11. Write a compatibility note (can the currently deployed app run against the new schema?) and a forward-recovery plan.

## Medyra invariants
- Hosted dev is migrated only by dev-migration.yml after approval; production only by a human.
- Never use the personal access token or a service-role key.
- forum_identity stays readable only by its owner.

## Validation
`npx vitest run supabase/tests`, `npm run eng:migrations`, then the full gates. Deep references: .agents/skills/supabase-postgres-best-practices/references/ (security-*, schema-*).

## Required evidence
PGlite test names covering each new policy; migration lock diff; compatibility and recovery notes in the handoff decisions.

## Prohibited
db:migrate, db:reset:dev, seed:*, supabase db push/reset, editing applied migrations, granting execute on all private functions.

## Failure handling
If PGlite cannot run an extension (for example pg_trgm), document the limit, test the rest, and mark the task for a hosted-dev parity check rather than skipping tests.

## Output contract
New migration, lock entry, types, harness and tests; handoff JSON with gate evidence.

Canonical rules: `CLAUDE.md`; system: `docs/engineering/AUTONOMOUS_ENGINEERING.md`.
