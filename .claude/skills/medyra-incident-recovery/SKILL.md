---
name: medyra-incident-recovery
description: "Investigate a Medyra failure signal (CI failure, failed preview, health check, dependency advisory, migration parity, stale task) safely: deduplicate, classify, gather sanitized evidence, reproduce, add a regression test, fix in isolation, escalate when needed."
---

# medyra-incident-recovery

## Purpose and triggers
Investigate a Medyra failure signal (CI failure, failed preview, health check, dependency advisory, migration parity, stale task) safely: deduplicate, classify, gather sanitized evidence, reproduce, add a regression test, fix in isolation, escalate when needed.

**Agents:** medyra-maintenance-engineer, medyra-devops-engineer

**Required inputs:** The signal (workflow run, smoke output, audit report) and its commit SHA.

## Workflow
1. Deduplicate: is there already an open task for this signal? Update it instead of creating another.
2. Classify severity (critical: security, data exposure, site down; high: broken core journey; medium; low).
3. Gather evidence without member data, secrets or evidence files: error codes, failing test names, commit SHAs.
4. Reproduce locally or in CI; if it cannot be reproduced, record and stop.
5. Write the failing regression test, fix the root cause once, run all gates, request reviews.
6. Escalate to the founder only for critical severity, required authorization or a repeated failure (follow docs/engineering/INCIDENT_RUNBOOK.md).

## Medyra invariants
- Never modify production infrastructure or data automatically.
- Cancelling a workflow does not undo completed external operations.

## Validation
The regression test fails before and passes after the fix.

## Required evidence
Reproduction steps, test name, before/after results.

## Prohibited
Retrying the same failed fix more than twice; disabling checks to go green.

## Failure handling
After two failed attempts, transition to FAILED and escalate once.

## Output contract
Remediation branch and handoff JSON.

Canonical rules: `CLAUDE.md`; system: `docs/engineering/AUTONOMOUS_ENGINEERING.md`.
