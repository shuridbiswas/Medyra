---
name: medyra-documentation
description: "Keep Medyra documentation accurate and non-contradictory: one canonical source per fact, numbers from recorded evidence, stale statements removed, changelog and recovery notes updated. Use after any merged change and when reconciling docs."
---

# medyra-documentation

## Purpose and triggers
Keep Medyra documentation accurate and non-contradictory: one canonical source per fact, numbers from recorded evidence, stale statements removed, changelog and recovery notes updated. Use after any merged change and when reconciling docs.

**Agents:** medyra-documentation-steward, medyra-product-steward

**Required inputs:** The merged change and its evidence; docs/engineering/AUTONOMOUS_ENGINEERING.md 'Sources of truth'.

## Workflow
1. Decide which canonical document owns each changed fact; update it there and link from elsewhere.
2. Take numbers from CI output or run records for a named commit; write the commit next to the number.
3. Remove or correct statements the change made false (search for the feature name across *.md).
4. Keep CLAUDE.md to stable rules; put detail in docs/engineering or feature docs.
5. Add a CHANGELOG entry in docs/engineering/CHANGELOG.md for user-visible or operational changes.

## Medyra invariants
- Do not change legal, privacy or verification policy text.
- Mark unknowns as unknown.

## Validation
`grep -rn` for the old statement returns nothing outside history files.

## Required evidence
Files updated and the evidence source for each number.

## Prohibited
Inventing results; copying whole reports into prompts or CLAUDE.md.

## Failure handling
If two sources conflict and you cannot tell which is right, record a DOC task instead of guessing.

## Output contract
Doc edits and a handoff JSON.

Canonical rules: `CLAUDE.md`; system: `docs/engineering/AUTONOMOUS_ENGINEERING.md`.
