---
name: medyra-anonymity-review
description: "Prove that anonymous forum authors cannot be identified through RPCs, queries, search, notifications, logs, analytics, exports, joins or external services. Use for any change touching forums, notifications, reports, exports, search, logging or moderation."
---

# medyra-anonymity-review

## Purpose and triggers
Prove that anonymous forum authors cannot be identified through RPCs, queries, search, notifications, logs, analytics, exports, joins or external services. Use for any change touching forums, notifications, reports, exports, search, logging or moderation.

**Agents:** medyra-security-reviewer, medyra-database-engineer, medyra-qa-engineer

**Required inputs:** The diff; supabase/tests/communities-forums.test.ts (anonymity leakage sweep).

## Workflow
1. Search the diff for forum_identity, author_id on forum tables, is_anonymous, notifications.actor_id, reports.target_member_id, moderation_actions.member_id and audit metadata.
2. Anonymous content must have author_id NULL; only ask_question / post_answer / post_reply write forum_identity; forum_identity is readable only by its owner.
3. Notifications about anonymous content carry actor_id NULL; reports keep target_member_id NULL; moderate_report resolves the writer only inside the function.
4. Exports include a member's own anonymous content only for that member; search and Pinecone never index author identity for anonymous content; Sentry and logs carry no content or identity.
5. Blocks hide anonymous content silently and errors are identical to 'not found'.
6. Add or extend the PGlite leakage sweep for any new read path.

## Medyra invariants
- Never add a query, embed, notification actor, export field or admin view that joins forum_identity for anyone but the member themself.
- No badge on anonymous content.

## Validation
`npx vitest run supabase/tests/communities-forums.test.ts src/features/forums`

## Required evidence
Leakage-sweep test names and results for the exact SHA.

## Prohibited
Weakening or deleting anonymity tests.

## Failure handling
Any possible disclosure path is a BLOCK until a test proves it closed.

## Output contract
Handoff JSON with findings and verdict.

Canonical rules: `CLAUDE.md`; system: `docs/engineering/AUTONOMOUS_ENGINEERING.md`.
