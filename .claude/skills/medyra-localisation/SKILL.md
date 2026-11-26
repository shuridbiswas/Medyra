---
name: medyra-localisation
description: "Keep English and French copy correct where Medyra implements both (student verification today) and prepare new copy for future localisation. Use when changing user-facing text."
---

# medyra-localisation

## Purpose and triggers
Keep English and French copy correct where Medyra implements both (student verification today) and prepare new copy for future localisation. Use when changing user-facing text.

**Agents:** medyra-feature-engineer, medyra-documentation-steward

**Required inputs:** Changed copy; src/features/student-verification/content.ts (EN/FR with ?lang=fr).

## Workflow
1. Keep copy in features/<name>/content.ts, not in JSX.
2. Where a module has EN and FR, change both together and keep meaning identical; flag French you are unsure of for human review.
3. Do not add a localisation framework (decision pending, task ENG-004).
4. Use Quebec French conventions for Quebec-facing copy; never machine-translate legal or policy text.

## Medyra invariants
- UI is English-only except verification; do not claim French availability elsewhere.

## Validation
`npx vitest run src/features/student-verification`

## Required evidence
List of EN/FR pairs changed.

## Prohibited
Translating legal pages.

## Failure handling
Record missing translations as a task instead of shipping half-translated screens.

## Output contract
Handoff JSON.

Canonical rules: `CLAUDE.md`; system: `docs/engineering/AUTONOMOUS_ENGINEERING.md`.
