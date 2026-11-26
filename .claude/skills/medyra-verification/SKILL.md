---
name: medyra-verification
description: "Keep Medyra student verification honest: distinguish unverified, provisional institutional affiliation, manual document review, provider simulation, real provider verification and final approved credentials; protect evidence. Use for any change touching verification, badges or providers."
---

# medyra-verification

## Purpose and triggers
Keep Medyra student verification honest: distinguish unverified, provisional institutional affiliation, manual document review, provider simulation, real provider verification and final approved credentials; protect evidence. Use for any change touching verification, badges or providers.

**Agents:** medyra-security-reviewer, medyra-feature-engineer, medyra-database-engineer

**Required inputs:** Diff; docs/verification/*; src/features/{student-verification,verification}/.

## Workflow
1. A badge comes only from verified_badges() reading active student_verified_credentials issued by approve_verification; check nothing else can produce one.
2. Provisional SSO affiliation is private and never a badge; simulators (SheerID simulator, mock IdP, document analyzer) are labelled TEST ONLY and disabled outside development.
3. Provider results only advance attempts and become evidence; they never issue credentials.
4. Evidence stays in the private bucket, openable only after inspection (and AV clean when EVIDENCE_AV_REQUIRED); never sent to Sentry, Pinecone, ProductBridge, logs or external AI.
5. Status changes only inside security definer functions; members have no write grants.
6. UI wording distinguishes each state; never 'verified professional' or licence claims.

## Medyra invariants
- Never grant a badge from email ownership, an unvalidated upload, a pasted link or a client-sent status.
- Never enable a simulated or unconfigured provider as real.

## Validation
`npx vitest run supabase/tests/student-verification.test.ts supabase/tests/provider-verification.test.ts supabase/tests/provider-journey.test.ts supabase/tests/student-sso.test.ts src/features/student-verification src/features/verification`

## Required evidence
Test results for the exact SHA; list of states shown in the UI.

## Prohibited
Changing docs/verification/STUDENT_VERIFICATION_POLICY.md or provider enablement flags without owner approval.

## Failure handling
Any path to a badge without approve_verification is critical.

## Output contract
Handoff JSON with findings and verdict.

Canonical rules: `CLAUDE.md`; system: `docs/engineering/AUTONOMOUS_ENGINEERING.md`.
