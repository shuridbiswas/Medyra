---
name: medyra-quality-gates
description: "The Medyra quality gates and how to record them: which checks are mandatory, how to run them, how to record PASSED/FAILED/NOT_APPLICABLE/NOT_EXECUTED/BLOCKED against an exact commit, and when evidence is stale. Use before any handoff, review or transition."
---

# medyra-quality-gates

## Purpose and triggers
The Medyra quality gates and how to record them: which checks are mandatory, how to run them, how to record PASSED/FAILED/NOT_APPLICABLE/NOT_EXECUTED/BLOCKED against an exact commit, and when evidence is stale. Use before any handoff, review or transition.

**Agents:** all medyra-* agents

**Required inputs:** Task requiredGates; engineering/policy.json mandatoryGates; the commit SHA.

## Workflow
1. Mandatory for every task: lint, typecheck, unit, pglite, build, secret-scan, code-review (engineering/policy.json).
2. Commands: lint `npm run lint`; typecheck `npm run typecheck`; unit+pglite `npm test` (or focused `npx vitest run src` / `npx vitest run supabase/tests`); build `npm run build` with Node 22; secret-scan `npm run eng:secrets`; migration-compatibility `npm run eng:migrations`; preview-smoke `npm run eng:smoke -- <url>`; dependency-scan `npm audit --omit=dev`.
3. Record each with `npm run eng -- gate --run <id> --gate <g> --result <R> --sha <sha> --detail "<counts>"`.
4. Evidence is valid only for the SHA it names; any new commit requires re-running affected gates (the engine rejects stale evidence).
5. Unexecuted mandatory checks are blockers; NOT_APPLICABLE is never allowed for a mandatory gate.
6. Never fabricate or infer results; copy the counts from the command output.

## Medyra invariants
- Never remove tests or weaken assertions to pass CI.
- Coverage may not drop without a written reason once a baseline exists (task ENG-005).

## Validation
`npm run eng -- validate`

## Required evidence
Gate entries in the run record.

## Prohibited
Recording PASSED for a check you did not run.

## Failure handling
A FAILED gate returns the task to IMPLEMENTING (or FAILED after the retry limit).

## Output contract
Gate entries plus the handoff JSON testEvidence array.

Canonical rules: `CLAUDE.md`; system: `docs/engineering/AUTONOMOUS_ENGINEERING.md`.
