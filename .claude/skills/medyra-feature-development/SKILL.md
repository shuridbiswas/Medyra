---
name: medyra-feature-development
description: "Implement an approved Medyra feature in the existing src/features/<module>/ layout: zod schemas, queries, session-gated server actions, components, pages, content, tests and docs. Use for any application code change."
---

# medyra-feature-development

## Purpose and triggers
Implement an approved Medyra feature in the existing src/features/<module>/ layout: zod schemas, queries, session-gated server actions, components, pages, content, tests and docs. Use for any application code change.

**Agents:** medyra-feature-engineer, medyra-maintenance-engineer

**Required inputs:** Task brief with acceptance criteria and file scope.

## Workflow
1. Read the brief and the existing module (schemas.ts, queries.ts, actions.ts, components/, content.ts, tests) before writing code. Reuse helpers that exist.
2. For framework questions read node_modules/next/dist/docs/ (Next 16: proxy.ts not middleware, searchParams is a Promise, Cache Components need Suspense for dynamic reads).
3. Write the failing test first where practical (Vitest + Testing Library; recording Supabase double in src/test/db-mock.ts).
4. Implement: action → requireMember()/requireUser()/requireAdmin() → zod parse → checkRateLimit → supabase call; author ids only from the session; zero affected rows is an error.
5. UI: Server Components by default, client only for interaction; controlled fields where failure must keep text; loading, empty, error and success states; maroon tokens; labelled controls; visible focus; motion-reduce.
6. Copy in content.ts; run the medyra-honest-limits checklist on any user-facing statement.
7. Hand database needs to medyra-database-engineer instead of writing SQL yourself.

## Medyra invariants
- No service-role key; only src/lib/supabase/{client,server,proxy,anon}.ts create clients.
- Every new route handler is registered in src/lib/api-protection.test.ts; admin pages call requireAdmin().
- No new dependency without an owner 'dependency' approval.
- Anonymous forum content never gets an author object or badge.

## Validation
Focused: `npx vitest run <paths>`. Before handoff: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run eng:secrets`, `npm run eng:migrations`, `npm run eng -- validate`.

## Required evidence
Gate results for the handoff commit; list of tests added and what they prove.

## Prohibited
Touching files outside the brief's scope; weakening tests; disabling lint rules; editing applied migrations.

## Failure handling
If acceptance criteria conflict with CLAUDE.md invariants, stop and record a blocker for the product steward.

## Output contract
Commit(s) on the task branch and a handoff JSON block.

Canonical rules: `CLAUDE.md`; system: `docs/engineering/AUTONOMOUS_ENGINEERING.md`.
