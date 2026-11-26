---
name: medyra-rls-security
description: "Review or design Medyra row-level security, column grants, private-schema helpers and security-definer RPCs. Use for any authorization change and for security reviews of supabase/ or src/lib/auth/."
---

# medyra-rls-security

## Purpose and triggers
Review or design Medyra row-level security, column grants, private-schema helpers and security-definer RPCs. Use for any authorization change and for security reviews of supabase/ or src/lib/auth/.

**Agents:** medyra-database-engineer, medyra-security-reviewer

**Required inputs:** The diff or the proposed policy; existing policies in supabase/migrations/.

## Workflow
1. List every table and function the change touches; confirm RLS is on and anon has no grants.
2. For each policy: which role, which rows, does it use an ownership predicate, can a member read or write another member's rows, does UPDATE have WITH CHECK.
3. For each security definer function: search_path set, caller checked first, no dynamic SQL from input, audit written in the same transaction, EXECUTE granted only to authenticated (and revoked from public/anon).
4. Private schema: helpers re-granted explicitly; nothing else executable by clients.
5. Column grants: owner/timestamp columns not updatable; remember a PostgREST upsert writes the owner column and is denied (use update then insert).
6. Blocks and suspension: private.is_member() excludes suspended members; has_block_between() only answers for pairs including the caller; actions never reveal that a block was the reason.
7. Run or require PGlite tests proving cross-user denial.

## Medyra invariants
- Never user_metadata in authorization.
- No service-role key.
- Views must be security_invoker or unexposed.

## Validation
`npx vitest run supabase/tests`

## Required evidence
Findings list with file:line and a PASS/BLOCK verdict.

## Prohibited
Adding security definer to fix a permission error; broad grants.

## Failure handling
Missing tests for an authorization change is a BLOCK.

## Output contract
Handoff JSON with reviewFindings and verdict.

Canonical rules: `CLAUDE.md`; system: `docs/engineering/AUTONOMOUS_ENGINEERING.md`.
