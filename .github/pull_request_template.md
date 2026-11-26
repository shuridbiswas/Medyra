## Task

Task id: <!-- e.g. FEAT-001 --> · Run id: <!-- run-… or "human" --> · Commit reviewed: <!-- exact SHA -->

## What changed and why

## Evidence for this exact commit

| Gate | Result (PASSED / FAILED / NOT_APPLICABLE / NOT_EXECUTED / BLOCKED) | Detail |
| --- | --- | --- |
| lint | | |
| typecheck | | |
| unit + pglite (`npm test`) | | |
| build | | |
| secret-scan | | |
| migration lock | | |
| code review (medyra-code-reviewer) | | |
| QA (medyra-qa-engineer) | | |
| security review (if sensitive) | | |
| preview smoke (if deployed) | | |

Unexecuted mandatory checks are blockers. Agent review reports are not GitHub approvals.

## Risk

- [ ] Touches auth, proxy, RLS, private schema, security-definer RPCs, forum identity, verification, uploads, rate limits, admin, legal/privacy copy, CI, deploy config or engineering policy (needs security review and owner approval)
- [ ] Adds or changes a migration (lock updated, PGlite tests, recovery plan)
- [ ] Adds a dependency (needs owner approval)
- [ ] User-facing claims checked against medyra-honest-limits

## Rollback / recovery
