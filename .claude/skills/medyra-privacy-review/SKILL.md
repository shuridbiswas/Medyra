---
name: medyra-privacy-review
description: "Review Medyra changes for privacy-by-design: data minimisation, visibility, export, deletion, retention, consent, coarse location, external transmission and items needing counsel (Quebec Law 25). Use for changes to profiles, privacy settings, exports, logging, analytics or integrations."
---

# medyra-privacy-review

## Purpose and triggers
Review Medyra changes for privacy-by-design: data minimisation, visibility, export, deletion, retention, consent, coarse location, external transmission and items needing counsel (Quebec Law 25). Use for changes to profiles, privacy settings, exports, logging, analytics or integrations.

**Agents:** medyra-security-reviewer

**Required inputs:** Diff; src/features/privacy/, src/lib/monitoring/, src/lib/services.ts, docs/verification/STUDENT_PRIVACY_SECURITY_CHECKLIST.md.

## Workflow
1. New personal data: is it needed, who can read it, is it in toPublicProfile() whitelist only if public, is it in the export and covered by deletion and retention?
2. Location stays coarse and optional; no coordinates or addresses.
3. External services receive no member content or identity (Sentry scrubbed; ProductBridge links only; Pinecone structured tags only).
4. Email only through sendToMember/sendToAddress rules.
5. List questions for counsel (Law 25 impact, consent wording, minors, data location) without answering them.

## Medyra invariants
- DraftNotice stays on legal pages until counsel approves.
- No compliance claims.

## Validation
`npx vitest run src/features/privacy src/lib`

## Required evidence
Findings and the counsel question list.

## Prohibited
Editing privacy policy, terms or guidelines text.

## Failure handling
Unapproved external transmission of member data is a BLOCK.

## Output contract
Handoff JSON with findings and verdict.

Canonical rules: `CLAUDE.md`; system: `docs/engineering/AUTONOMOUS_ENGINEERING.md`.
