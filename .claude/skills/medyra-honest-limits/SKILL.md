---
name: medyra-honest-limits
description: "Check every user-facing Medyra statement against what is actually implemented and configured: no unsupported claims of AI moderation, medical or therapeutic care, verification, encryption or legal compliance. Use for any copy, UI or documentation change."
---

# medyra-honest-limits

## Purpose and triggers
Check every user-facing Medyra statement against what is actually implemented and configured: no unsupported claims of AI moderation, medical or therapeutic care, verification, encryption or legal compliance. Use for any copy, UI or documentation change.

**Agents:** all medyra-* agents that write or review copy

**Required inputs:** Changed copy (content.ts files, components, docs).

## Workflow
1. For each claim, find the code or configuration that makes it true; if it is optional and unconfigured (Resend, Sentry, Upstash, SheerID, SSO), the copy must not say it is active.
2. Peer support is not therapy or crisis service; forum answers are educational, not clinical consultation; messages are not end-to-end encrypted; mentors are self-declared and unaccredited; verification covers students only.
3. Planned features are labelled planned; built ones are not listed as upcoming; illustrative UI is labelled illustrative.
4. Keep DraftNotice on privacy, terms and guidelines.

## Medyra invariants
- CLAUDE.md 'Honest limits' principle.
- Never manufacture badges or engagement.

## Validation
Search: `grep -rni "verified\|encrypted\|AI moderat\|complian" src/features src/app`

## Required evidence
Each changed claim with the file proving it.

## Prohibited
Changing legal, privacy or verification policy text without owner approval.

## Failure handling
An unsupported claim is a BLOCK.

## Output contract
Findings in the handoff JSON.

Canonical rules: `CLAUDE.md`; system: `docs/engineering/AUTONOMOUS_ENGINEERING.md`.
